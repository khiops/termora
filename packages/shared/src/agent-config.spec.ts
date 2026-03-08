import { describe, expect, it } from "vitest";
import {
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
});

describe("parseAgentConfig", () => {
	it("returns defaults when no section provided", () => {
		const config = parseAgentConfig();

		expect(config.bufferPerChannel).toBe(DEFAULT_BUFFER_PER_CHANNEL);
		expect(config.bufferGlobal).toBe(DEFAULT_BUFFER_GLOBAL);
		expect(config.logLevel).toBe("info");
		expect(config.socketPath).toBeUndefined();
	});

	it("returns defaults when undefined passed", () => {
		const config = parseAgentConfig(undefined);

		expect(config.bufferPerChannel).toBe(DEFAULT_BUFFER_PER_CHANNEL);
		expect(config.bufferGlobal).toBe(DEFAULT_BUFFER_GLOBAL);
		expect(config.logLevel).toBe("info");
		expect(config.socketPath).toBeUndefined();
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

	it("reads log_level", () => {
		const config = parseAgentConfig({ log_level: "debug" });

		expect(config.logLevel).toBe("debug");
	});
});
