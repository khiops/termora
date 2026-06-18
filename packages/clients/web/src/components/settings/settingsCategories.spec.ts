import { describe, expect, it } from "vitest";
import { getVisibleSettingsCategories } from "./settingsCategories.js";

describe("settings category visibility", () => {
	it("hides the desktop category outside Tauri", () => {
		const categories = getVisibleSettingsCategories("global", false);

		expect(categories.map((cat) => cat.id)).not.toContain("desktop");
	});

	it("shows the desktop category in Tauri", () => {
		const categories = getVisibleSettingsCategories("global", true);

		expect(categories.map((cat) => cat.id)).toContain("desktop");
	});

	it("hides global-only desktop settings for host and channel scopes", () => {
		expect(getVisibleSettingsCategories("host", true).map((cat) => cat.id)).not.toContain(
			"desktop",
		);
		expect(getVisibleSettingsCategories("channel", true).map((cat) => cat.id)).not.toContain(
			"desktop",
		);
	});
});
