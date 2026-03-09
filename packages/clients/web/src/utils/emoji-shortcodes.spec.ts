import { describe, expect, it } from "vitest";
import { EMOJI_SHORTCODES, resolveEmojiShortcode } from "./emoji-shortcodes.js";

describe("resolveEmojiShortcode", () => {
	it("resolves :rocket: to the rocket emoji", () => {
		expect(resolveEmojiShortcode(":rocket:")).toBe("🚀");
	});

	it("resolves :star: to the star emoji", () => {
		expect(resolveEmojiShortcode(":star:")).toBe("⭐");
	});

	it("resolves :fire: to the fire emoji", () => {
		expect(resolveEmojiShortcode(":fire:")).toBe("🔥");
	});

	it("resolves :gear: to the gear emoji", () => {
		expect(resolveEmojiShortcode(":gear:")).toBe("⚙️");
	});

	it("resolves :bug: to the bug emoji", () => {
		expect(resolveEmojiShortcode(":bug:")).toBe("🐛");
	});

	it("is case-insensitive (:Rocket: resolves to rocket emoji)", () => {
		expect(resolveEmojiShortcode(":Rocket:")).toBe("🚀");
		expect(resolveEmojiShortcode(":STAR:")).toBe("⭐");
	});

	it("returns unknown shortcode as-is", () => {
		expect(resolveEmojiShortcode(":totally_unknown:")).toBe(":totally_unknown:");
	});

	it("returns plain emoji as-is", () => {
		expect(resolveEmojiShortcode("🚀")).toBe("🚀");
	});

	it("returns empty string as-is", () => {
		expect(resolveEmojiShortcode("")).toBe("");
	});

	it("returns arbitrary text without colons as-is", () => {
		expect(resolveEmojiShortcode("hello")).toBe("hello");
	});

	it("trims surrounding whitespace before matching", () => {
		expect(resolveEmojiShortcode(" :rocket: ")).toBe("🚀");
	});
});

describe("EMOJI_SHORTCODES map", () => {
	it("contains at least 100 entries", () => {
		expect(EMOJI_SHORTCODES.size).toBeGreaterThanOrEqual(100);
	});

	it("all values are non-empty strings", () => {
		for (const [, value] of EMOJI_SHORTCODES) {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});
});
