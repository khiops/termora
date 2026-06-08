import { describe, expect, it } from "vitest";
import {
	DEFAULT_BIND_TIMEOUT,
	DEFAULT_BUFFER_GLOBAL,
	DEFAULT_BUFFER_PER_CHANNEL,
	parseAgentConfig,
	parseSize,
} from "./agent-config.js";

describe("parseSize", () => {
	it("parses numeric values as-is", () => {
		expect(parseSize(1024)).toBe(1024);
		expect(parseSize(0)).toBe(0);
	});

	it("parses MB strings", () => {
		expect(parseSize("1MB")).toBe(1024 * 1024);
		expect(parseSize("20MB")).toBe(20 * 1024 * 1024);
	});

	it("parses KB strings", () => {
		expect(parseSize("512KB")).toBe(512 * 1024);
	});

	it("parses GB strings", () => {
		expect(parseSize("2GB")).toBe(2 * 1024 * 1024 * 1024);
	});

	it("is case-insensitive", () => {
		expect(parseSize("1mb")).toBe(1024 * 1024);
		expect(parseSize("1Mb")).toBe(1024 * 1024);
		expect(parseSize("512kb")).toBe(512 * 1024);
	});

	it("returns NaN for non-string/non-number values without throwing", () => {
		expect(() => parseSize(true)).not.toThrow();
		expect(Number.isNaN(parseSize(true))).toBe(true);
	});
});

describe("parseAgentConfig", () => {
	it("returns defaults when no section provided", () => {
		const config = parseAgentConfig();

		expect(config.bufferPerChannel).toBe(DEFAULT_BUFFER_PER_CHANNEL);
		expect(config.bufferGlobal).toBe(DEFAULT_BUFFER_GLOBAL);
		expect(config.logLevel).toBe("info");
		expect(config.logFormat).toBe("jsonl");
		expect(config.socketPath).toBeUndefined();
		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});

	it("returns defaults when undefined passed", () => {
		const config = parseAgentConfig(undefined);

		expect(config.bufferPerChannel).toBe(DEFAULT_BUFFER_PER_CHANNEL);
		expect(config.bufferGlobal).toBe(DEFAULT_BUFFER_GLOBAL);
		expect(config.logLevel).toBe("info");
		expect(config.logFormat).toBe("jsonl");
		expect(config.socketPath).toBeUndefined();
		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});

	it("parses buffer_per_channel as size string", () => {
		const config = parseAgentConfig({ buffer_per_channel: "2MB" });

		expect(config.bufferPerChannel).toBe(2 * 1024 * 1024);
	});

	it("parses buffer_global as size string", () => {
		const config = parseAgentConfig({ buffer_global: "50MB" });

		expect(config.bufferGlobal).toBe(50 * 1024 * 1024);
	});

	it("reads socket_path when provided", () => {
		const config = parseAgentConfig({
			socket_path: "/custom/agent.sock",
		});

		expect(config.socketPath).toBe("/custom/agent.sock");
	});

	it("omits socketPath when empty string", () => {
		const config = parseAgentConfig({ socket_path: "" });

		expect(config.socketPath).toBeUndefined();
	});

	it("leaves log_level to the shared [logging] contract", () => {
		const config = parseAgentConfig({ log_level: "debug" });

		expect(config.logLevel).toBe("info");
	});

	it("reads bind_timeout as a positive integer", () => {
		const config = parseAgentConfig({ bind_timeout: 3000 });

		expect(config.bindTimeout).toBe(3000);
	});

	it("falls back to default bindTimeout when bind_timeout is zero", () => {
		const config = parseAgentConfig({ bind_timeout: 0 });

		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});

	it("falls back to default bindTimeout when bind_timeout is negative", () => {
		const config = parseAgentConfig({ bind_timeout: -1 });

		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});

	it("falls back to default bindTimeout when bind_timeout is not a number", () => {
		const config = parseAgentConfig({ bind_timeout: "fast" });

		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});

	it("falls back to defaults for wrong-typed values without throwing", () => {
		expect(() =>
			parseAgentConfig({
				buffer_per_channel: true,
				buffer_global: [],
				socket_path: false,
				bind_timeout: "fast",
				log_level: 5,
				format: [],
			}),
		).not.toThrow();

		const config = parseAgentConfig({
			buffer_per_channel: true,
			buffer_global: [],
			socket_path: false,
			bind_timeout: "fast",
			log_level: 5,
			format: [],
		});

		expect(config.bufferPerChannel).toBe(DEFAULT_BUFFER_PER_CHANNEL);
		expect(config.bufferGlobal).toBe(DEFAULT_BUFFER_GLOBAL);
		expect(config.logLevel).toBe("info");
		expect(config.logFormat).toBe("jsonl");
		expect(config.socketPath).toBeUndefined();
		expect(config.bindTimeout).toBe(DEFAULT_BIND_TIMEOUT);
	});
});
