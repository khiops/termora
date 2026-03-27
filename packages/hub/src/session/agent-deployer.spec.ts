import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SFTPWrapper, Client as SshClient } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DeployError,
	checkRemoteAgent,
	deployAgentIfNeeded,
	detectRemoteOsArch,
	getBinaryCacheDir,
	getLocalSha256,
	getRemoteSha256,
	uploadAgentBinary,
} from "./agent-deployer.js";
import type { DeployOptions } from "./agent-deployer.js";

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

// ---------- Helpers for deploy tests ------------------------------------------

/** The fake SHA256 used as the "local" hash in tests. */
const LOCAL_SHA = "a".repeat(64);

/** A different SHA256 representing a remote binary that differs from local. */
const REMOTE_SHA_DIFFERENT = "b".repeat(64);

/** Build default DeployOptions with no callbacks and no trust state. */
function makeOptions(overrides: Partial<DeployOptions> = {}): DeployOptions {
	return {
		binaryCache: cacheDir,
		hostname: "myhost.example.com",
		hostId: "host-1",
		...overrides,
	};
}

/**
 * Create a mock SSH client that:
 *  - returns `existingPath` from `which nexterm-agent`
 *  - returns `remoteSha` from `sha256sum '<existingPath>'`
 *  - fails all other commands
 */
function makeAgentFoundClient(existingPath: string, remoteSha: string | null): SshClient {
	const responses: Record<string, ExecResult> = {
		"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
	};
	if (remoteSha !== null) {
		responses[`sha256sum '${existingPath}'`] = {
			stdout: `${remoteSha}  ${existingPath}\n`,
			stderr: "",
			exitCode: 0,
		};
	} else {
		// sha256sum fails
		responses[`sha256sum '${existingPath}'`] = { stdout: "", stderr: "error", exitCode: 1 };
	}
	return makeMockClient(responses);
}

/**
 * Create a mock SSH client that claims agent is NOT present (all lookups fail),
 * responds to uname, $HOME for upload flow, and attaches SFTP.
 */
function makeAgentNotFoundClient(sftp: SFTPWrapper): SshClient {
	const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
		cb(undefined, sftp);
	};
	return makeMockClient(
		{
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/usr/local/bin/nexterm-agent" && echo "/usr/local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/usr/bin/nexterm-agent" && echo "/usr/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/opt/nexterm/nexterm-agent" && echo "/opt/nexterm/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			"echo $HOME": { stdout: "/home/user\n", stderr: "", exitCode: 0 },
		},
		sftpImpl,
	);
}

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
			'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': {
				stdout: "/home/user/.local/bin/nexterm-agent\n",
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await checkRemoteAgent(client);
		expect(result).toBe("/home/user/.local/bin/nexterm-agent");
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

// ---------- deployAgentIfNeeded — Branch A: agent found ----------------------

describe("deployAgentIfNeeded — agent already present", () => {
	const existingPath = "/usr/local/bin/nexterm-agent";

	it("1. SHA256 match (local cache) → deployed: false, no upload", async () => {
		// Write a local binary and compute its real SHA256
		const binaryName = "nexterm-agent-linux-x64";
		const binaryContent = Buffer.from("fake-binary-content");
		writeFileSync(join(cacheDir, binaryName), binaryContent);
		const localSha = getLocalSha256(join(cacheDir, binaryName));
		if (!localSha) throw new Error("getLocalSha256 returned null for a freshly written file");

		// Remote returns the same hash
		const client = makeMockClient({
			"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
			[`sha256sum '${existingPath}'`]: {
				stdout: `${localSha}  ${existingPath}\n`,
				stderr: "",
				exitCode: 0,
			},
		});

		const result = await deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, makeOptions());

		expect(result.deployed).toBe(false);
		expect(result.remotePath).toBe(existingPath);
	});

	it("2. SHA256 mismatch (local cache) → re-upload, onAgentUpdated called", async () => {
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "local-binary");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
				[`sha256sum '${existingPath}'`]: {
					stdout: `${REMOTE_SHA_DIFFERENT}  ${existingPath}\n`,
					stderr: "",
					exitCode: 0,
				},
			},
			sftpImpl,
		);

		const onAgentUpdated = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ onAgentUpdated }),
		);

		expect(result.deployed).toBe(true);
		expect(result.remotePath).toBe(existingPath);
		expect(onAgentUpdated).toHaveBeenCalledWith("host-1");
		expect(sftp.fastPut).toHaveBeenCalled();
	});

	it("2b. SHA256 mismatch (local cache) → re-upload, onAgentPinned called with local SHA", async () => {
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "local-binary");
		const localSha = getLocalSha256(join(cacheDir, binaryName));
		if (!localSha) throw new Error("getLocalSha256 returned null");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
				[`sha256sum '${existingPath}'`]: {
					stdout: `${REMOTE_SHA_DIFFERENT}  ${existingPath}\n`,
					stderr: "",
					exitCode: 0,
				},
			},
			sftpImpl,
		);

		const onAgentPinned = vi.fn();
		await deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, makeOptions({ onAgentPinned }));

		// Pin must be updated to the local (trusted) binary's hash after re-upload
		expect(onAgentPinned).toHaveBeenCalledWith("host-1", localSha);
	});

	it("3. remoteSha null + local binary → re-upload (precaution)", async () => {
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "local-binary");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
				[`sha256sum '${existingPath}'`]: { stdout: "", stderr: "error", exitCode: 1 },
			},
			sftpImpl,
		);

		const onAgentUpdated = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ onAgentUpdated }),
		);

		expect(result.deployed).toBe(true);
		expect(sftp.fastPut).toHaveBeenCalled();
	});

	it("4. No local binary, no pin → calls promptBinaryVerify", async () => {
		// Do NOT write local binary — cacheDir is empty
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_once");
		await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ promptBinaryVerify }),
		);

		expect(promptBinaryVerify).toHaveBeenCalledWith(
			"host-1",
			"myhost.example.com",
			existingPath,
			REMOTE_SHA_DIFFERENT,
			"linux",
			"x64",
			false, // mismatch=false when no pin
			undefined, // no pinnedSha256
		);
	});

	it("5. No local binary, pin matches remote → skip prompt, deployed: false", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ pinnedSha256: REMOTE_SHA_DIFFERENT, promptBinaryVerify }),
		);

		expect(result.deployed).toBe(false);
		expect(promptBinaryVerify).not.toHaveBeenCalled();
	});

	it("6. No local binary, pin mismatches → prompt with mismatch=true", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_once");
		await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ pinnedSha256: LOCAL_SHA, promptBinaryVerify }),
		);

		expect(promptBinaryVerify).toHaveBeenCalledWith(
			"host-1",
			"myhost.example.com",
			existingPath,
			REMOTE_SHA_DIFFERENT,
			"linux",
			"x64",
			true, // mismatch=true (pin differs from remote)
			LOCAL_SHA,
		);
	});

	it("7. No local binary, sessionTrusted matches remote → skip, deployed: false", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ sessionTrustedSha256: REMOTE_SHA_DIFFERENT, promptBinaryVerify }),
		);

		expect(result.deployed).toBe(false);
		expect(promptBinaryVerify).not.toHaveBeenCalled();
	});

	it("8. No local binary, trust_permanent → onAgentPinned called", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_permanent");
		const onAgentPinned = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ promptBinaryVerify, onAgentPinned }),
		);

		expect(result.deployed).toBe(false);
		expect(onAgentPinned).toHaveBeenCalledWith("host-1", REMOTE_SHA_DIFFERENT);
	});

	it("9. No local binary, trust_once → onAgentTrustOnce called", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_once");
		const onAgentTrustOnce = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ promptBinaryVerify, onAgentTrustOnce }),
		);

		expect(result.deployed).toBe(false);
		expect(onAgentTrustOnce).toHaveBeenCalledWith("host-1", REMOTE_SHA_DIFFERENT);
	});

	it("10. No local binary, reject → throws AGENT_BINARY_REJECTED", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const promptBinaryVerify = vi.fn().mockResolvedValue("reject");
		const error = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ promptBinaryVerify }),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeployError);
		expect((error as DeployError).code).toBe("AGENT_BINARY_REJECTED");
	});

	it("11. No local binary, no prompt fn → throws AGENT_BINARY_UNTRUSTED", async () => {
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const error = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions(), // no promptBinaryVerify
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeployError);
		expect((error as DeployError).code).toBe("AGENT_BINARY_UNTRUSTED");
	});
});

// ---------- deployAgentIfNeeded — Branch B: agent not found ------------------

describe("deployAgentIfNeeded — agent not found", () => {
	it("12. Agent not found + local binary → upload, deployed: true", async () => {
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "binary-content");

		const sftp = makeMockSftp();
		const client = makeAgentNotFoundClient(sftp);

		const result = await deployAgentIfNeeded(client, { os: "linux", arch: "x64" }, makeOptions());

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

	it("13. Agent not found + no local binary → throws AGENT_NOT_AVAILABLE", async () => {
		// cacheDir is empty — no binary
		const sftp = makeMockSftp();
		const client = makeAgentNotFoundClient(sftp);

		const error = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions(),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeployError);
		expect((error as DeployError).code).toBe("AGENT_NOT_AVAILABLE");
	});

	it("deploys binary when os/arch auto-detected (host record has nulls)", async () => {
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
				'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/local/bin/nexterm-agent" && echo "/usr/local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/bin/nexterm-agent" && echo "/usr/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/opt/nexterm/nexterm-agent" && echo "/opt/nexterm/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				"uname -sm": { stdout: "Linux aarch64\n", stderr: "", exitCode: 0 },
				"echo $HOME": { stdout: "/home/user\n", stderr: "", exitCode: 0 },
			},
			sftpImpl,
		);

		const result = await deployAgentIfNeeded(client, { os: null, arch: null }, makeOptions());

		expect(result.deployed).toBe(true);
		expect(result.os).toBe("linux");
		expect(result.arch).toBe("arm64");
	});

	it("throws when OS/arch cannot be detected and they are unknown", async () => {
		const client = makeMockClient({
			"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
			'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/usr/local/bin/nexterm-agent" && echo "/usr/local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/usr/bin/nexterm-agent" && echo "/usr/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			'test -x "/opt/nexterm/nexterm-agent" && echo "/opt/nexterm/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			"uname -sm": { stdout: "", stderr: "", exitCode: 1 },
			"echo %PROCESSOR_ARCHITECTURE%": { stdout: "", stderr: "", exitCode: 1 },
		});

		await expect(
			deployAgentIfNeeded(client, { os: null, arch: null }, makeOptions()),
		).rejects.toThrow("Cannot detect remote OS/arch");
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
				'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/local/bin/nexterm-agent" && echo "/usr/local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/bin/nexterm-agent" && echo "/usr/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/opt/nexterm/nexterm-agent" && echo "/opt/nexterm/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
			},
			sftpImpl,
		);

		const result = await deployAgentIfNeeded(client, { os: "windows", arch: "x64" }, makeOptions());

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
	it.skipIf(process.platform === "win32")("returns path under XDG_STATE_HOME when set", () => {
		const orig = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = "/custom/state";
		try {
			const result = getBinaryCacheDir();
			expect(result).toBe("/custom/state/nexterm/binaries");
		} finally {
			// biome-ignore lint/performance/noDelete: env var removal requires delete
			if (orig === undefined) delete process.env.XDG_STATE_HOME;
			else process.env.XDG_STATE_HOME = orig;
		}
	});

	it("returns path under ~/.local/state when XDG_STATE_HOME is not set", () => {
		const orig = process.env.XDG_STATE_HOME;
		// biome-ignore lint/performance/noDelete: env var removal requires delete
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

// ---------- getRemoteSha256 --------------------------------------------------

describe("getRemoteSha256", () => {
	it("parses sha256sum output on Linux", async () => {
		const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
		const client = makeMockClient({
			"sha256sum '/usr/local/bin/nexterm-agent'": {
				stdout: `${hash}  /usr/local/bin/nexterm-agent\n`,
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await getRemoteSha256(client, "/usr/local/bin/nexterm-agent", "linux");
		expect(result).toBe(hash);
	});

	it("parses shasum -a 256 output on macOS (darwin)", async () => {
		const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
		const client = makeMockClient({
			"shasum -a 256 '/usr/local/bin/nexterm-agent'": {
				stdout: `${hash}  /usr/local/bin/nexterm-agent\n`,
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await getRemoteSha256(client, "/usr/local/bin/nexterm-agent", "darwin");
		expect(result).toBe(hash);
	});

	it("parses PowerShell Get-FileHash output on Windows", async () => {
		const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
		const client = makeMockClient({
			"powershell -c": {
				stdout: `${hash}\n`,
				stderr: "",
				exitCode: 0,
			},
		});
		const result = await getRemoteSha256(client, "C:\\nexterm\\nexterm-agent.exe", "windows");
		expect(result).toBe(hash);
	});

	it("returns null when command exits with non-zero", async () => {
		const client = makeMockClient({
			'sha256sum "/missing/path"': { stdout: "", stderr: "No such file", exitCode: 1 },
		});
		const result = await getRemoteSha256(client, "/missing/path", "linux");
		expect(result).toBeNull();
	});

	it("returns null when sshExec throws", async () => {
		const throwingClient = {
			exec: vi.fn((_cmd: string, cb: (err: Error) => void) => {
				cb(new Error("Connection reset"));
			}),
			sftp: vi.fn(),
		} as unknown as SshClient;
		const result = await getRemoteSha256(throwingClient, "/some/path", "linux");
		expect(result).toBeNull();
	});
});

// ---------- getLocalSha256 ---------------------------------------------------

describe("getLocalSha256", () => {
	it("computes SHA256 of a file", () => {
		const filePath = join(cacheDir, "test-file.bin");
		writeFileSync(filePath, "hello nexterm");
		// sha256("hello nexterm") = known value
		const result = getLocalSha256(filePath);
		expect(result).toMatch(/^[a-f0-9]{64}$/);
		// Verify determinism: same content → same hash
		expect(result).toBe(getLocalSha256(filePath));
	});

	it("returns null for missing file", () => {
		const result = getLocalSha256("/nonexistent/path/to/file");
		expect(result).toBeNull();
	});
});

// ---------- deploy + verify integration ---------------------------------------

describe("deploy + verify integration", () => {
	it("deploys from cache, then skips on second connect (SHA256 match)", async () => {
		// First connect: agent NOT found on remote, local binary exists → upload
		const binaryName = "nexterm-agent-linux-x64";
		const binaryContent = Buffer.from("fake-binary-content-for-integration");
		const localBinaryPath = join(cacheDir, binaryName);
		writeFileSync(localBinaryPath, binaryContent);

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const clientFirst = makeMockClient(
			{
				"which nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				"where nexterm-agent": { stdout: "", stderr: "", exitCode: 1 },
				'test -x "$HOME/.local/bin/nexterm-agent" && echo "$HOME/.local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/local/bin/nexterm-agent" && echo "/usr/local/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/usr/bin/nexterm-agent" && echo "/usr/bin/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				'test -x "/opt/nexterm/nexterm-agent" && echo "/opt/nexterm/nexterm-agent"': { stdout: "", stderr: "", exitCode: 1 },
				"echo $HOME": { stdout: "/home/user\n", stderr: "", exitCode: 0 },
			},
			sftpImpl,
		);

		const resultFirst = await deployAgentIfNeeded(
			clientFirst,
			{ os: "linux", arch: "x64" },
			makeOptions(),
		);

		expect(resultFirst.deployed).toBe(true);
		expect(resultFirst.remotePath).toBe("/home/user/.local/bin/nexterm-agent");
		expect(sftp.fastPut).toHaveBeenCalledTimes(1);

		// Second connect: agent IS found at deployed path, SHA256 matches local cache
		const deployedPath = resultFirst.remotePath;
		const localSha = getLocalSha256(localBinaryPath);
		if (!localSha) throw new Error("getLocalSha256 returned null");

		const clientSecond = makeMockClient({
			"which nexterm-agent": { stdout: `${deployedPath}\n`, stderr: "", exitCode: 0 },
			[`sha256sum '${deployedPath}'`]: {
				stdout: `${localSha}  ${deployedPath}\n`,
				stderr: "",
				exitCode: 0,
			},
		});

		const resultSecond = await deployAgentIfNeeded(
			clientSecond,
			{ os: "linux", arch: "x64" },
			makeOptions(),
		);

		expect(resultSecond.deployed).toBe(false);
		expect(resultSecond.remotePath).toBe(deployedPath);
	});

	it("re-uploads when remote SHA256 differs from local cache", async () => {
		// Local binary exists; remote agent at existingPath has a different hash
		const binaryName = "nexterm-agent-linux-x64";
		writeFileSync(join(cacheDir, binaryName), "local-binary-content");

		const sftp = makeMockSftp();
		const sftpImpl = (cb: (err: Error | undefined, sftp: SFTPWrapper) => void): void => {
			cb(undefined, sftp);
		};
		const existingPath = "/usr/local/bin/nexterm-agent";
		const client = makeMockClient(
			{
				"which nexterm-agent": { stdout: `${existingPath}\n`, stderr: "", exitCode: 0 },
				[`sha256sum '${existingPath}'`]: {
					stdout: `${REMOTE_SHA_DIFFERENT}  ${existingPath}\n`,
					stderr: "",
					exitCode: 0,
				},
			},
			sftpImpl,
		);

		const onAgentUpdated = vi.fn();
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ onAgentUpdated }),
		);

		expect(result.deployed).toBe(true);
		expect(sftp.fastPut).toHaveBeenCalledTimes(1);
		expect(onAgentUpdated).toHaveBeenCalledWith("host-1");
	});

	it("prompts user on first use (no pin, no cache), pins on trust_permanent", async () => {
		// Remote agent found, no local binary, no pin — must prompt
		const existingPath = "/usr/local/bin/nexterm-agent";
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const onAgentPinned = vi.fn();
		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_permanent");

		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ promptBinaryVerify, onAgentPinned }),
		);

		expect(promptBinaryVerify).toHaveBeenCalledWith(
			"host-1",
			"myhost.example.com",
			existingPath,
			REMOTE_SHA_DIFFERENT,
			"linux",
			"x64",
			false, // mismatch=false — no prior pin
			undefined,
		);
		expect(onAgentPinned).toHaveBeenCalledWith("host-1", REMOTE_SHA_DIFFERENT);
		expect(result.deployed).toBe(false);
		expect(result.remotePath).toBe(existingPath);
	});

	it("skips prompt when session-trusted SHA matches remote", async () => {
		// Remote agent found with hash REMOTE_SHA_DIFFERENT;
		// sessionTrustedSha256 matches → no prompt needed
		const existingPath = "/usr/local/bin/nexterm-agent";
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		// No promptBinaryVerify provided — would throw AGENT_BINARY_UNTRUSTED if reached
		const result = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({ sessionTrustedSha256: REMOTE_SHA_DIFFERENT }),
		);

		expect(result.deployed).toBe(false);
		expect(result.remotePath).toBe(existingPath);
	});

	it("prompts with mismatch=true when pinned SHA differs from remote", async () => {
		// Remote agent exists with new hash; stored pin is the old LOCAL_SHA
		const existingPath = "/usr/local/bin/nexterm-agent";
		const client = makeAgentFoundClient(existingPath, REMOTE_SHA_DIFFERENT);

		const onAgentPinned = vi.fn();
		const promptBinaryVerify = vi.fn().mockResolvedValue("trust_permanent");

		await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions({
				pinnedSha256: LOCAL_SHA, // old pin differs from REMOTE_SHA_DIFFERENT
				promptBinaryVerify,
				onAgentPinned,
			}),
		);

		expect(promptBinaryVerify).toHaveBeenCalledWith(
			"host-1",
			"myhost.example.com",
			existingPath,
			REMOTE_SHA_DIFFERENT,
			"linux",
			"x64",
			true, // mismatch=true — pin differs from remote
			LOCAL_SHA,
		);
		expect(onAgentPinned).toHaveBeenCalledWith("host-1", REMOTE_SHA_DIFFERENT);
	});

	it("throws AGENT_NOT_AVAILABLE when no agent on remote and no local binary", async () => {
		// All remote lookups fail, cacheDir is empty — no binary to upload
		const sftp = makeMockSftp();
		const client = makeAgentNotFoundClient(sftp);

		const error = await deployAgentIfNeeded(
			client,
			{ os: "linux", arch: "x64" },
			makeOptions(),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeployError);
		expect((error as DeployError).code).toBe("AGENT_NOT_AVAILABLE");
	});
});
