import { describe, expect, it } from "vitest";
import { parseUnameOutput, parseWindowsArchOutput } from "./os-detect.js";

describe("parseUnameOutput", () => {
	it("parses Linux x86_64", () => {
		expect(parseUnameOutput("Linux x86_64")).toEqual({ os: "linux", arch: "x64" });
	});

	it("parses Linux aarch64", () => {
		expect(parseUnameOutput("Linux aarch64")).toEqual({ os: "linux", arch: "arm64" });
	});

	it("parses Darwin arm64", () => {
		expect(parseUnameOutput("Darwin arm64")).toEqual({ os: "darwin", arch: "arm64" });
	});

	it("parses Darwin x86_64", () => {
		expect(parseUnameOutput("Darwin x86_64")).toEqual({ os: "darwin", arch: "x64" });
	});

	it("parses Linux amd64 (alias)", () => {
		expect(parseUnameOutput("Linux amd64")).toEqual({ os: "linux", arch: "x64" });
	});

	it("returns null for empty string", () => {
		expect(parseUnameOutput("")).toBeNull();
	});

	it("returns null for whitespace-only string", () => {
		expect(parseUnameOutput("   ")).toBeNull();
	});

	it("returns null for unknown OS", () => {
		expect(parseUnameOutput("FreeBSD amd64")).toBeNull();
	});

	it("returns null for unknown arch", () => {
		expect(parseUnameOutput("Linux riscv64")).toBeNull();
	});

	it("returns null for single token (no arch)", () => {
		expect(parseUnameOutput("Linux")).toBeNull();
	});

	it("handles trailing newline from SSH exec", () => {
		expect(parseUnameOutput("Linux x86_64\n")).toEqual({ os: "linux", arch: "x64" });
	});
});

describe("parseWindowsArchOutput", () => {
	it("parses AMD64", () => {
		expect(parseWindowsArchOutput("AMD64")).toEqual({ os: "windows", arch: "x64" });
	});

	it("parses ARM64", () => {
		expect(parseWindowsArchOutput("ARM64")).toEqual({ os: "windows", arch: "arm64" });
	});

	it("is case-insensitive", () => {
		expect(parseWindowsArchOutput("amd64")).toEqual({ os: "windows", arch: "x64" });
		expect(parseWindowsArchOutput("arm64")).toEqual({ os: "windows", arch: "arm64" });
	});

	it("handles trailing newline from SSH exec", () => {
		expect(parseWindowsArchOutput("AMD64\r\n")).toEqual({ os: "windows", arch: "x64" });
	});

	it("returns null for empty string", () => {
		expect(parseWindowsArchOutput("")).toBeNull();
	});

	it("returns null for unknown value", () => {
		expect(parseWindowsArchOutput("x86")).toBeNull();
		expect(parseWindowsArchOutput("garbage")).toBeNull();
	});
});
