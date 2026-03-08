import { describe, expect, it } from "vitest";
import { getColorFromLabel, getInitials } from "./useHostIcon.js";

describe("getInitials", () => {
	it("returns uppercased first letter of the label", () => {
		expect(getInitials("server-01")).toBe("S");
		expect(getInitials("myHost")).toBe("M");
	});

	it("returns '?' for empty string", () => {
		expect(getInitials("")).toBe("?");
	});

	it("returns '?' for whitespace-only string", () => {
		expect(getInitials("   ")).toBe("?");
	});

	it("trims leading whitespace before extracting", () => {
		expect(getInitials("  hello")).toBe("H");
	});
});

describe("getColorFromLabel", () => {
	it("returns a valid HSL string", () => {
		const color = getColorFromLabel("my-host");
		expect(color).toMatch(/^hsl\(\d+, 65%, 52%\)$/);
	});

	it("is deterministic for the same label", () => {
		const a = getColorFromLabel("production");
		const b = getColorFromLabel("production");
		expect(a).toBe(b);
	});

	it("produces different colors for different labels", () => {
		const a = getColorFromLabel("alpha");
		const b = getColorFromLabel("beta");
		// Not guaranteed by spec, but highly likely with djb2 — guard against trivial bugs
		expect(a).not.toBe(b);
	});

	it("returns a valid hue from the palette (0–330 range)", () => {
		const labels = ["a", "bb", "ccc", "dddd", "eeee", "server-01", "prod-db", "web-frontend"];
		const validHues = [210, 145, 20, 280, 0, 170, 330, 60, 240, 100];
		for (const label of labels) {
			const match = getColorFromLabel(label).match(/^hsl\((\d+), 65%, 52%\)$/);
			expect(match).not.toBeNull();
			const hue = Number(match?.[1]);
			expect(validHues).toContain(hue);
		}
	});

	it("handles empty string without throwing", () => {
		const color = getColorFromLabel("");
		expect(color).toMatch(/^hsl\(\d+, 65%, 52%\)$/);
	});
});
