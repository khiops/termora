import { describe, expect, it } from "vitest";
import { getConfigDir, getStateDir, parseArgs } from "./cli.js";

describe("parseArgs", () => {
	describe("start", () => {
		it("parses bare start", () => {
			const r = parseArgs(["start"]);
			expect(r).not.toBeNull();
			expect(r?.command).toBe("start");
			expect(r?.port).toBeUndefined();
			expect(r?.daemon).toBeUndefined();
		});

		it("parses start --port 4200", () => {
			const r = parseArgs(["start", "--port", "4200"]);
			expect(r?.command).toBe("start");
			expect(r?.port).toBe(4200);
		});

		it("parses start --daemon", () => {
			const r = parseArgs(["start", "--daemon"]);
			expect(r?.command).toBe("start");
			expect(r?.daemon).toBe(true);
		});

		it("parses start --port 4200 --daemon", () => {
			const r = parseArgs(["start", "--port", "4200", "--daemon"]);
			expect(r?.command).toBe("start");
			expect(r?.port).toBe(4200);
			expect(r?.daemon).toBe(true);
		});
	});

	describe("stop / status", () => {
		it("parses stop", () => {
			const r = parseArgs(["stop"]);
			expect(r?.command).toBe("stop");
		});

		it("parses status", () => {
			const r = parseArgs(["status"]);
			expect(r?.command).toBe("status");
		});

		it("parses status --json", () => {
			const r = parseArgs(["status", "--json"]);
			expect(r?.command).toBe("status");
			expect(r?.json).toBe(true);
		});
	});

	describe("host add", () => {
		it("parses host add --label prod --host 10.0.0.1", () => {
			const r = parseArgs(["host", "add", "--label", "prod", "--host", "10.0.0.1"]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("prod");
			expect(r?.host).toBe("10.0.0.1");
		});

		it("parses host add with all flags", () => {
			const r = parseArgs([
				"host",
				"add",
				"--label",
				"staging",
				"--host",
				"192.168.1.5",
				"--ssh-port",
				"2222",
				"--user",
				"deploy",
				"--auth",
				"key",
			]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("staging");
			expect(r?.host).toBe("192.168.1.5");
			expect(r?.sshPort).toBe(2222);
			expect(r?.user).toBe("deploy");
			expect(r?.authMethod).toBe("key");
		});

		it("parses host list", () => {
			const r = parseArgs(["host", "list"]);
			expect(r?.command).toBe("host-list");
		});

		it("parses host list --json", () => {
			const r = parseArgs(["host", "list", "--json"]);
			expect(r?.command).toBe("host-list");
			expect(r?.json).toBe(true);
		});

		it("parses host remove <label>", () => {
			const r = parseArgs(["host", "remove", "old-server"]);
			expect(r?.command).toBe("host-remove");
			expect(r?.label).toBe("old-server");
		});
	});

	describe("session", () => {
		it("parses session list", () => {
			const r = parseArgs(["session", "list"]);
			expect(r?.command).toBe("session-list");
		});

		it("parses session list --json", () => {
			const r = parseArgs(["session", "list", "--json"]);
			expect(r?.command).toBe("session-list");
			expect(r?.json).toBe(true);
		});
	});

	describe("pair", () => {
		it("parses bare pair (generate mode)", () => {
			const r = parseArgs(["pair"]);
			expect(r?.command).toBe("pair");
			expect(r?.code).toBeUndefined();
		});

		it("parses pair --code 123456", () => {
			const r = parseArgs(["pair", "--code", "123456"]);
			expect(r?.command).toBe("pair");
			expect(r?.code).toBe("123456");
		});
	});

	describe("config edit", () => {
		it("parses config edit", () => {
			const r = parseArgs(["config", "edit"]);
			expect(r?.command).toBe("config-edit");
		});
	});

	describe("unknown commands", () => {
		it("returns null for empty argv", () => {
			expect(parseArgs([])).toBeNull();
		});

		it("returns null for unknown top-level command", () => {
			expect(parseArgs(["foobar"])).toBeNull();
		});

		it("returns null for 'host' with no sub-command", () => {
			expect(parseArgs(["host"])).toBeNull();
		});

		it("returns null for 'host bogus'", () => {
			expect(parseArgs(["host", "bogus"])).toBeNull();
		});

		it("returns null for 'session' with no sub-command", () => {
			expect(parseArgs(["session"])).toBeNull();
		});

		it("returns null for 'config' with no sub-command", () => {
			expect(parseArgs(["config"])).toBeNull();
		});
	});

	describe("flag ordering", () => {
		it("handles flags before positional args", () => {
			const r = parseArgs(["--label", "prod", "host", "add", "--host", "1.2.3.4"]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("prod");
			expect(r?.host).toBe("1.2.3.4");
		});
	});
});

describe("path helpers", () => {
	it("getStateDir returns a non-empty string", () => {
		expect(getStateDir().length).toBeGreaterThan(0);
		expect(getStateDir()).toContain("termora");
	});

	it("getConfigDir returns a non-empty string", () => {
		expect(getConfigDir().length).toBeGreaterThan(0);
		expect(getConfigDir()).toContain("termora");
	});

	it.skipIf(process.platform === "win32")("getStateDir uses XDG_STATE_HOME when set", () => {
		const orig = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = "/tmp/xdg-state";
		expect(getStateDir()).toBe("/tmp/xdg-state/termora");
		process.env.XDG_STATE_HOME = orig;
	});

	it.skipIf(process.platform === "win32")("getConfigDir uses XDG_CONFIG_HOME when set", () => {
		const orig = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = "/tmp/xdg-cfg";
		expect(getConfigDir()).toBe("/tmp/xdg-cfg/termora");
		process.env.XDG_CONFIG_HOME = orig;
	});
});
