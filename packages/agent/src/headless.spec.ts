import { afterEach, describe, expect, it } from "vitest";
import { HeadlessTerminal } from "./headless.js";

describe("HeadlessTerminal", () => {
	let term: HeadlessTerminal;

	afterEach(() => {
		term.dispose();
	});

	it("creates terminal with specified dimensions", () => {
		term = new HeadlessTerminal(120, 40);
		const snapshot = term.serialize();
		expect(snapshot.cols).toBe(120);
		expect(snapshot.rows).toBe(40);
	});

	it("serialize() produces a non-empty string after write()", async () => {
		term = new HeadlessTerminal(80, 24);
		await term.writeSync("hello world\r\n");
		const snapshot = term.serialize();
		expect(snapshot.serialized.length).toBeGreaterThan(0);
	});

	it("write() processes ANSI escape sequences correctly", async () => {
		term = new HeadlessTerminal(80, 24);
		await term.writeSync("ABCDE");
		const snapshot = term.serialize();
		// cursor should be at column 5 after writing 5 chars
		expect(snapshot.cursorX).toBe(5);
		expect(snapshot.cursorY).toBe(0);
	});

	it("resize() changes terminal dimensions", () => {
		term = new HeadlessTerminal(80, 24);
		term.resize(132, 50);
		const snapshot = term.serialize();
		expect(snapshot.cols).toBe(132);
		expect(snapshot.rows).toBe(50);
	});

	it("snapshot includes correct cursor position after writes", async () => {
		term = new HeadlessTerminal(80, 24);
		await term.writeSync("line1\r\nline2\r\nline3");
		const snapshot = term.serialize();
		expect(snapshot.cursorY).toBe(2); // 0-indexed, 3rd line
		expect(snapshot.cursorX).toBe(5); // "line3" is 5 chars
	});

	it("serialize() completes in < 100ms for 120×40 terminal with 5000 lines scrollback", async () => {
		term = new HeadlessTerminal(120, 40, 5000);

		// Fill terminal with content — 5000 lines of 100 chars each
		const line = `${"A".repeat(100)}\r\n`;
		const bigContent = line.repeat(5000);
		await term.writeSync(bigContent);

		const start = performance.now();
		term.serialize();
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(100);
	});

	it("write() accepts Uint8Array input", async () => {
		term = new HeadlessTerminal(80, 24);
		const data = new TextEncoder().encode("hello");
		term.write(data);
		// writeSync with empty string to flush the parser queue
		await term.writeSync("");
		const snapshot = term.serialize();
		expect(snapshot.serialized).toContain("hello");
	});
});
