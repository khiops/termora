import { afterEach, describe, expect, it } from "vitest";
import {
	assetTokenReady,
	namedPublicAssetUrl,
	publicAssetUrl,
	setAssetTokenForTests,
} from "./hub-url.js";

describe("public asset URL helpers", () => {
	afterEach(() => {
		setAssetTokenForTests(null);
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	});

	it("appends the boot asset token and preserves extra query parameters", () => {
		setAssetTokenForTests("asset-token");

		expect(namedPublicAssetUrl("wallpapers", "desktop image.jpg", { t: 123 })).toBe(
			"/public/wallpapers/desktop%20image.jpg?asset_token=asset-token&t=123",
		);
	});

	it("signs existing public asset paths without dropping their query string", () => {
		setAssetTokenForTests("asset-token");

		expect(publicAssetUrl("/public/fonts/Hack-Regular.ttf?variant=regular")).toBe(
			"/public/fonts/Hack-Regular.ttf?variant=regular&asset_token=asset-token",
		);
	});

	it("prefixes signed public assets with the hub base URL in Tauri runtime", () => {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			value: {},
			configurable: true,
		});
		setAssetTokenForTests("asset-token");

		expect(namedPublicAssetUrl("sounds", "bell.mp3")).toBe(
			"http://localhost:4100/public/sounds/bell.mp3?asset_token=asset-token",
		);
	});

	it("omits asset_token from URL when no token is set", () => {
		// Token not set (default state after afterEach reset)
		const url = namedPublicAssetUrl("wallpapers", "bg.png");
		expect(url).not.toContain("asset_token");
	});

	it("assetTokenReady is false before setAssetTokenForTests and true after", () => {
		expect(assetTokenReady.value).toBe(false);
		setAssetTokenForTests("tok");
		expect(assetTokenReady.value).toBe(true);
		setAssetTokenForTests(null);
		expect(assetTokenReady.value).toBe(false);
	});
});
