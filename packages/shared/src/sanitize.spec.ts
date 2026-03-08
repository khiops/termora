import { describe, expect, it } from "vitest";
import { sanitizeTitle, truncateTitle } from "./sanitize.js";

describe("sanitizeTitle", () => {
	it("strips HTML tags but preserves tag content (safe: rendered via .textContent)", () => {
		// Tag content like "alert(1)" is kept — Vue renders via .textContent so it's
		// not executable. Stripping content would be overly aggressive for legitimate titles.
		expect(sanitizeTitle("<script>alert(1)</script>vim")).toBe("alert(1)vim");
	});

	it("strips control characters", () => {
		expect(sanitizeTitle("vim\x07\x1b[31m file.ts")).toBe("vim[31m file.ts");
	});

	it("truncates to maxRawLength (default 256)", () => {
		const long = "a".repeat(500);
		expect(sanitizeTitle(long)).toHaveLength(256);
	});

	it("truncates to custom maxRawLength", () => {
		expect(sanitizeTitle("abcdefghij", 5)).toBe("abcde");
	});

	it("passes through clean title unchanged", () => {
		expect(sanitizeTitle("bash — ~/projects")).toBe("bash — ~/projects");
	});

	it("returns empty string for empty input", () => {
		expect(sanitizeTitle("")).toBe("");
	});

	it("preserves Unicode characters (CJK, emoji)", () => {
		expect(sanitizeTitle("vim 文件.ts")).toBe("vim 文件.ts");
		expect(sanitizeTitle("htop 🖥️")).toBe("htop 🖥️");
	});

	it("trims surrounding whitespace", () => {
		expect(sanitizeTitle("  hello world  ")).toBe("hello world");
	});

	it("handles combined HTML + control chars + whitespace", () => {
		expect(sanitizeTitle("  <b>title\x00</b>  ")).toBe("title");
	});
});

describe("truncateTitle", () => {
	it("passes through title shorter than maxLength", () => {
		expect(truncateTitle("short", 20)).toBe("short");
	});

	it("passes through title exactly at maxLength", () => {
		expect(truncateTitle("exact", 5)).toBe("exact");
	});

	it("truncates at 'end' with correct ellipsis placement", () => {
		const result = truncateTitle("vim: src/components/very-long-name.vue", 25, "end");
		expect(result).toHaveLength(25);
		expect(result).toBe("vim: src/components/very\u2026");
	});

	it("truncates at 'middle' with correct split", () => {
		const result = truncateTitle("vim: src/components/very-long-component-name.vue", 25, "middle");
		expect(result).toHaveLength(25);
		// left = ceil(24/2) = 12, right = floor(24/2) = 12
		expect(result).toBe("vim: src/com\u2026ent-name.vue");
	});

	it("truncates at 'start' with correct ellipsis placement", () => {
		const result = truncateTitle("vim: src/components/very-long-name.vue", 25, "start");
		expect(result).toHaveLength(25);
		expect(result).toBe("\u2026nents/very-long-name.vue");
	});

	it("returns empty string for empty title", () => {
		expect(truncateTitle("", 10)).toBe("");
	});

	it("returns just ellipsis for maxLength of 1", () => {
		expect(truncateTitle("something", 1)).toBe("\u2026");
	});

	it("preserves Unicode characters during truncation", () => {
		const title = "\u6587\u5b57\u5316\u3051\u3057\u305f\u30bf\u30a4\u30c8\u30eb";
		const result = truncateTitle(title, 5, "end");
		expect(result).toHaveLength(5);
		expect(result).toBe("\u6587\u5b57\u5316\u3051\u2026");
	});

	it("defaults position to 'end'", () => {
		const explicit = truncateTitle("a long title here", 10, "end");
		const implicit = truncateTitle("a long title here", 10);
		expect(implicit).toBe(explicit);
	});

	it("returns empty string for maxLength of 0", () => {
		expect(truncateTitle("something", 0)).toBe("");
	});

	it("handles middle truncation with odd maxLength", () => {
		// maxLength=6 → left=ceil(5/2)=3, right=floor(5/2)=2
		const result = truncateTitle("abcdefghij", 6, "middle");
		expect(result).toHaveLength(6);
		expect(result).toBe("abc\u2026ij");
	});
});
