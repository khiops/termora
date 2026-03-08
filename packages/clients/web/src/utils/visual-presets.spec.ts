import { describe, expect, it } from "vitest";
import { resolvePreset } from "./visual-presets.js";

describe("resolvePreset", () => {
	it("returns disabled banner/border/tint for 'none'", () => {
		const p = resolvePreset("none");
		expect(p.preset).toBe("none");
		expect(p.banner.enabled).toBe(false);
		expect(p.border.style).toBe("none");
		expect(p.tint.enabled).toBe(false);
		expect(p.tint.opacity).toBe(0);
	});

	it("returns enabled banner with red bg, strong border, 5% tint for 'danger'", () => {
		const p = resolvePreset("danger");
		expect(p.preset).toBe("danger");
		expect(p.banner.enabled).toBe(true);
		expect(p.banner.bgColor).toBe("#e06c75");
		expect(p.banner.textColor).toBe("#ffffff");
		expect(p.border.style).toBe("strong");
		expect(p.border.color).toBe("#e06c75");
		expect(p.tint.enabled).toBe(true);
		expect(p.tint.opacity).toBe(5);
	});

	it("returns enabled banner with yellow bg, subtle border, 3% tint for 'caution'", () => {
		const p = resolvePreset("caution");
		expect(p.preset).toBe("caution");
		expect(p.banner.enabled).toBe(true);
		expect(p.banner.bgColor).toBe("#e5c07b");
		expect(p.banner.textColor).toBe("#1e1e1e");
		expect(p.border.style).toBe("subtle");
		expect(p.border.color).toBe("#e5c07b");
		expect(p.tint.enabled).toBe(true);
		expect(p.tint.opacity).toBe(3);
	});

	it("returns defaults with preset='custom' for 'custom'", () => {
		const p = resolvePreset("custom");
		expect(p.preset).toBe("custom");
		expect(p.banner.enabled).toBe(false);
		expect(p.border.style).toBe("none");
		expect(p.tint.enabled).toBe(false);
	});
});
