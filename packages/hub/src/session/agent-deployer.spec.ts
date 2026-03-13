import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SFTPWrapper, Client as SshClient } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkRemoteAgent,
	deployAgentIfNeeded,
	detectRemoteOsArch,
	getBinaryCacheDir,
	uploadAgentBinary,
} from "./agent-deployer.js";

// ---------- Mock SSH helpers --------------------------------------------------

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

class MockSshStream extends EventEmitter {
	readonly stderr = new EventEmitter();
}

type SshExecCallback = (err: Error | undefined, stream: MockSshStream) => void;

/**
 * Create a mock SshClient whose ssh-exec calls respond via a lookup map.
 * Commands not in the map return exitCode=1 with empty output.
 */
function makeMockClient(
	responses: Record<string, ExecResult>,
	sftpImpl?: (cb: (err: Error | undefined, sftp: SFTPWrapper) => void) => void,
): SshClient {
	const sshExecImpl = vi.fn((command: string, cb: SshExecCallback) => {
		let result: ExecResult = { stdout: "", stderr: "", exitCode: 1 };
		for (const [pattern, resp] of Object.entries(responses)) {
			if (command === pattern || command.startsWith(pattern)) {
				result = resp;
				break;
			}
		}
		const stream = new MockSshStream();
		cb(undefined, stream);
		setImmediate(() => {
			if (result.stdout) stream.emit("data", Buffer.from(result.stdout));
			if (result.stderr) stream.stderr.emit("data", Buffer.from(result.stderr));
			stream.emit("close", result.exitCode);
		});
	});

	return {
		exec: sshExecImpl,
		sftp: sftpImpl ?? vi.fn(),
	} as unknown as SshClient;
}

// ---------- Mock SFTP helpers -------------------------------------------------

interface MockSftpOptions {
	mkdirError?: Error;
	fastPutError?: Error;
	chmodError?: Error;
}

function makeMockSftp(opts: MockSftpOptions = {}): SFTPWrapper {
	return {
		mkdir: vi.fn((_path: string, cb: (err: Error | undefined) => void) => {
			cb(opts.mkdirError);
		}),
		fastPut: vi.fn((_local: string, _remote: string, cb: (err: Error | undefined) => void) => {
			cb(opts.fastPutError);
		}),
		chmod: vi.fn((_path: string, _mode: number, cb: (err: Error | undefined) => void) => {
			cb(opts.chmodError);
		}),
		end: vi.fn(),
	} as unknown as SFTPWrapper;
}

function makeSftpClient(sftp: SFTPWrapper, sftpError?: Error): SshClient {
	return {
		exec: vi.fn(),
		sftp: vi.fn((cb: (err: Error | undefined, sftp: SFTPWrapper) => void) => {
			cb(sftpError, sftp);
		}),
	} as unknown as SshClient;
}

// ---------- Test fixture: binary cache ----------------------------------------

let cacheDir: string;

beforeEach(() => {
	cacheDir = join(tmpdir(), `nexterm-deployer-test-${Date.now()}`);
	mkdirSync(cacheDir, { recursive: true });
});

afterEach(() => {
	rmSync(cacheDir, { recursive: true, force: true });
});

// ---------- checkRemoteAgent --------------------------------------------------

describe("checkRemoteAgent", () => {
	it("returns path when which succeeds", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "/usr/local/bin/nexterm-agent\n", stderr: "", exitCode: 0 },
		});
		const result = await checkRemoteAgent(client);
		expect(result).toBe("/usr/local/bin/nexterm-agent");
	});

	it("returns path when where succeeds (Windows)", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": {
				stdout: "C:\\Users\\user\\AppData\\Local\\nexterm\\nexterm-agent.exe\n",
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await checkRemoteAgent(client);
		expect(result).toBe("C:\\Users\\user\\AppData\\Local\\nexterm\\nexterm-agent.exe");
	});

	it("falls through to common Unix paths when which/where fail", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"test -x ~/.local/bin/nexterm-agent && echo ok": {
				stdout: "ok",
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await checkRemoteAgent(client);
		expect(result).toBe("~/.local/bin/nexterm-agent");
	});

	it("returns null when agent is not found anywhere", async () => {
		const client = makeMockClient({});
		const result = await checkRemoteAgent(client);
		expect(result).toBeNull();
	});

	it("returns trimmed path (strips trailing newline)", async () => {
		const client = makeMockClient({
			"which nexterm-agent": {
				stdout: "/usr/bin/nexterm-agent\n\n",
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await checkRemoteAgent(client);
		expect(result).toBe("/usr/bin/nexterm-agent");
	});
});

// ---------- detectRemoteOsArch ------------------------------------------------

describe("detectRemoteOsArch", () => {
	it("detects Linux x64 via uname -sm", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "Linux x86_64\n", stderr: "", exitCode: 0 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toEqual({ os: "linux", arch: "x64" });
	});

	it("detects Darwin arm64 via uname -sm", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "Darwin arm64\n", stderr: "", exitCode: 0 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toEqual({ os: "darwin", arch: "arm64" });
	});

	it("falls back to PROCESSOR_ARCHITECTURE for Windows x64", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "", stderr: "not found", exitCode: 1 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "AMD64\n", stderr: "", exitCode: 0 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toEqual({ os: "windows", arch: "x64" });
	});

	it("falls back to PROCESSOR_ARCHITECTURE for Windows arm64", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "", stderr: "", exitCode: 1 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "ARM64\n", stderr: "", exitCode: 0 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toEqual({ os: "windows", arch: "arm64" });
	});

	it("returns null when both detection methods fail", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "", stderr: "", exitCode: 1 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "", stderr: "", exitCode: 1 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toBeNull();
	});

	it("returns null when uname output is unrecognized", async () => {
		const client = makeMockClient({
			"uname -sm": { stdout: "FreeBSD amd64\n", stderr: "", exitCode: 0 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "", stderr: "", exitCode: 1 },
		});
		const result = await detectRemoteOsArch(client);
		expect(result).toBeNull();
	});
});

// ---------- uploadAgentBinary -------------------------------------------------

describe("uploadAgentBinary", () => {
	it("calls mkdir, fastPut, and chmod in order", async () => {
		const sftp = makeMockSftp();
		const client = makeSftpClient(sftp);

		await uploadAgentBinary(client, "/local/binary", "/remote/.local/bin/nexterm-agent");

		expect(sftp.mkdir).toHaveBeenCalledWith("/remote/.local/bin", expect.any(Function));
		expect(sftp.fastPut).toHaveBeenCalledWith(
			"/local/binary",
			"/remote/.local/bin/nexterm-agent",
			expect.any(Function),
		);
		expect(sftp.chmod).toHaveBeenCalledWith(
			"/remote/.local/bin/nexterm-agent",
			0o755,
			expect.any(Function),
		);
	});

	it("calls sftp.end() even when fastPut fails", async () => {
		const sftp = makeMockSftp({ fastPutError: new Error("disk full") });
		const client = makeSftpClient(sftp);

		await expect(
			uploadAgentBinary(client, "/local/binary", "/remote/nexterm-agent"),
		).rejects.toThrow("disk full");

		expect(sftp.end).toHaveBeenCalled();
	});

	it("rejects when sftp channel open fails", async () => {
		const sftp = makeMockSftp();
		const client = makeSftpClient(sftp, new Error("SFTP not available"));

		await expect(
			uploadAgentBinary(client, "/local/binary", "/remote/nexterm-agent"),
		).rejects.toThrow("SFTP not available");
	});

	it("swallows mkdir errors (parent may already exist)", async () => {
		const sftp = makeMockSftp({ mkdirError: new Error("EEXIST") });
		const client = makeSftpClient(sftp);

		await expect(
			uploadAgentBinary(client, "/local/binary", "/remote/.local/bin/nexterm-agent"),
		).resolves.toBeUndefined();
	});

	it("handles Windows backslash paths for parent dir extraction", async () => {
		const sftp = makeMockSftp();
		const client = makeSftpClient(sftp);

		await uploadAgentBinary(
			client,
			"C:\\local\\nexterm-agent.exe",
			"%LOCALAPPDATA%\\nexterm\\nexterm-agent.exe",
		);

		expect(sftp.mkdir).toHaveBeenCalledWith("%LOCALAPPDATA%\\nexterm", expect.any(Function));
	});
});

// ---------- deployAgentIfNeeded -----------------------------------------------

describe("deployAgentIfNeeded", () => {
	it("returns deployed=false when agent is already present", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "/usr/local/bin/nexterm-agent\n", stderr: "", exitCode: 0 },
		});

		const result = await deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, cacheDir);

		expect(result.deployed).toBe(false);
		expect(result.remotePath).toBe("/usr/local/bin/nexterm-agent");
		expect(result.os).toBeNull();
		expect(result.arch).toBeNull();
	});

	it("deploys binary when agent not found and os/arch are known", async () => {
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "binary-content");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"test -x ~/.local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /opt/nexterm/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"echo $HOME": { stdout: "/home/user\n", stderr: "", exitCode: 0 },
			},
			sftpImpl,
		);

		const result = await deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, cacheDir);

		expect(result.deployed).toBe(true);
		expect(result.remotePath).toBe("/home/user/.local/bin/nexterm-agent");
		expect(result.os).toBe("linux");
		expect(result.arch).toBe("x64");
		expect(sftp.fastPut).toHaveBeenCalledWith(
			join(cacheDir, binaryName),
			"/home/user/.local/bin/nexterm-agent",
			expect.any(Function),
		);
	});

	it("detects os/arch when they are null on the host", async () => {
		const binaryName = "nexterm-agent-linux-arm64";
		writeFileSync(join(cacheDir, binaryName), "binary-content");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"test -x ~/.local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /opt/nexterm/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"uname -sm": { stdout: "Linux aarch64\n", stderr: "", exitCode: 0 },
				"echo $HOME": { stdout: "/home/user\n", stderr: "", exitCode: 0 },
			},
			sftpImpl,
		);

		const result = await deployAgentIfNeeded(client, { os: null, arch: null }, cacheDir);

		expect(result.deployed).toBe(true);
		expect(result.os).toBe("linux");
		expect(result.arch).toBe("arm64");
	});

	it("throws when binary is not in the cache", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"test -x ~/.local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /usr/local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /usr/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /opt/nexterm/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
		});

		await expect(
			deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, cacheDir),
		).rejects.toThrow("Agent binary not found in cache");
	});

	it("throws when OS/arch cannot be detected and they are unknown", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"test -x ~/.local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /usr/local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /usr/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"test -x /opt/nexterm/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			"uname -sm": { stdout: "", stderr: "", exitCode: 1 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "", stderr: "", exitCode: 1 },
		});

		await expect(deployAgentIfNeeded(client, { os: null, arch: null }, cacheDir)).rejects.toThrow(
			"Cannot detect remote OS/arch",
		);
	});

	it("uses windows path for windows host", async () => {
		const binaryName = "nexterm-agent-windows-x64.exe";
		writeFileSync(join(cacheDir, binaryName), "binary-content");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"test -x ~/.local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/local/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /usr/bin/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
				"test -x /opt/nexterm/nexterm-agent && echo ok": { stdout: "", stderr: "", exitCode: 1 },
			},
			sftpImpl,
		);

		const result = await deployAgentIfNeeded(client, { os: "windows", arch: "x64" }, cacheDir);

		expect(result.deployed).toBe(true);
		expect(result.remotePath).toBe("%LOCALAPPDATA%\\nexterm\\nexterm-agent.exe");
		expect(sftp.fastPut).toHaveBeenCalledWith(
			join(cacheDir, binaryName),
			"%LOCALAPPDATA%\\nexterm\\nexterm-agent.exe",
			expect.any(Function),
		);
	});
});

// ---------- getBinaryCacheDir ------------------------------------------------

describe("getBinaryCacheDir", () => {
	it("returns path under XDG_STATE_HOME when set", () => {
		const orig = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = "/custom/state";
		try {
			const result = getBinaryCacheDir();
			expect(result).toBe("/custom/state/nexterm/binaries");
		} finally {
			if (orig === undefined) delete process.env.XDG_STATE_HOME;
			else process.env.XDG_STATE_HOME = orig;
		}
	});

	it("returns path under ~/.local/state when XDG_STATE_HOME is not set", () => {
		const orig = process.env.XDG_STATE_HOME;
		delete process.env.XDG_STATE_HOME;
		try {
			const result = getBinaryCacheDir();
			expect(result).toMatch(/nexterm[\/\\]binaries$/);
			if (process.platform !== "win32") {
				expect(result).toContain(".local/state");
			}
		} finally {
			if (orig !== undefined) process.env.XDG_STATE_HOME = orig;
		}
	});
});
