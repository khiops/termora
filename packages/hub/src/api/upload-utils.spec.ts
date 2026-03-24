import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./upload-utils.js";

describe("sanitizeFilename", () => {
	it("returns a plain valid filename unchanged", () => {
		expect(sanitizeFilename("font.woff2")).toBe("font.woff2");
	});

	it("returns a filename with multiple dots unchanged", () => {
		expect(sanitizeFilename("my.cool.font.ttf")).toBe("my.cool.font.ttf");
	});

	it("returns null for path traversal with ../", () => {
		expect(sanitizeFilename("../secret.txt")).toBeNull();
	});

	it("returns null for path traversal with ../../", () => {
		expect(sanitizeFilename("../../etc/passwd")).toBeNull();
	});

	it("returns null for embedded forward slash", () => {
		expect(sanitizeFilename("sub/dir/file.ttf")).toBeNull();
	});

	it("returns null for embedded backslash", () => {
		expect(sanitizeFilename("sub\\dir\\file.ttf")).toBeNull();
	});

	it("returns null for a lone dot", () => {
		expect(sanitizeFilename(".")).toBeNull();
	});

	it("returns null for double dot", () => {
		expect(sanitizeFilename("..")).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(sanitizeFilename("")).toBeNull();
	});

	it("returns null when raw contains a path separator but basename strips it", () => {
		// basename("dir/file.ttf") === "file.ttf" but raw !== name so it must be rejected
		expect(sanitizeFilename("dir/file.ttf")).toBeNull();
	});

	it("accepts a filename that starts with a dot (hidden file)", () => {
		expect(sanitizeFilename(".hidden")).toBe(".hidden");
	});
});
