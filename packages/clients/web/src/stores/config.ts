import { DEFAULT_PROFILE, type TerminalProfile } from "@nexterm/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useAuthStore } from "./auth.js";

interface FontFile {
	style: string;
	weight: number;
	url: string;
}

interface FontFamily {
	family: string;
	files: FontFile[];
}

/**
 * Inject @font-face rules into the document head so the browser
 * can resolve custom font families referenced in the terminal profile.
 */
function injectFontFaces(families: FontFamily[]): void {
	// Remove any previously injected style element
	const existing = document.getElementById("nexterm-fonts");
	if (existing) existing.remove();

	if (families.length === 0) return;

	const rules: string[] = [];
	for (const family of families) {
		for (const file of family.files) {
			const format = file.url.endsWith(".woff2")
				? "woff2"
				: file.url.endsWith(".woff")
					? "woff"
					: file.url.endsWith(".ttf")
						? "truetype"
						: "opentype";
			rules.push(
				`@font-face {
	font-family: "${family.family}";
	src: url("${file.url}") format("${format}");
	font-weight: ${file.weight};
	font-style: ${file.style};
	font-display: swap;
}`,
			);
		}
	}

	const style = document.createElement("style");
	style.id = "nexterm-fonts";
	style.textContent = rules.join("\n");
	document.head.appendChild(style);
}

/**
 * Config store — holds the resolved terminal profile and available fonts.
 * Fetches both from the hub on load.
 */
interface UiConfig {
	onChannelDead: "close" | "readonly";
}

export const useConfigStore = defineStore("config", () => {
	const profile = ref<TerminalProfile>({ ...DEFAULT_PROFILE });
	const fonts = ref<FontFamily[]>([]);
	const loaded = ref(false);
	const uiConfig = ref<UiConfig>({ onChannelDead: "close" });

	/**
	 * Load fonts from the hub (no auth needed).
	 * Call early — before terminals are created — so @font-face rules
	 * are injected and fonts are downloaded for canvas rendering.
	 */
	async function loadFonts(): Promise<void> {
		try {
			const fontList: FontFamily[] = await fetch("/api/fonts").then((r) => r.json());
			fonts.value = fontList;
			injectFontFaces(fontList);

			// Force-load fonts so canvas-based xterm.js can use them.
			// document.fonts.load() triggers actual download; without this,
			// @font-face with font-display:swap stays "unloaded" until DOM text uses it.
			const loadPromises: Promise<FontFace[]>[] = [];
			for (const family of fontList) {
				for (const file of family.files) {
					loadPromises.push(
						document.fonts.load(
							`${file.weight} ${file.style === "italic" ? "italic " : ""}14px "${family.family}"`,
						),
					);
				}
			}
			await Promise.allSettled(loadPromises);
		} catch (err) {
			console.warn("[config] failed to load fonts:", err);
		}
	}

	/**
	 * Load the resolved terminal profile from the hub (requires auth).
	 * Call after authentication is established.
	 */
	async function loadProfile(): Promise<void> {
		try {
			const authStore = useAuthStore();
			const resp = await fetch("/api/config/resolved", {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (resp.ok) {
				profile.value = await resp.json();
			}
		} catch (err) {
			console.warn("[config] failed to load resolved config:", err);
		}
		loaded.value = true;
	}

	/**
	 * Load UI behaviour config from the hub (requires auth).
	 * Controls how the client reacts to dead channels, etc.
	 */
	async function loadUiConfig(): Promise<void> {
		try {
			const authStore = useAuthStore();
			const resp = await fetch("/api/config/ui", {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (resp.ok) {
				uiConfig.value = await resp.json();
			}
		} catch (err) {
			console.warn("[config] failed to load UI config:", err);
		}
	}

	return {
		profile,
		fonts,
		loaded,
		uiConfig,
		loadFonts,
		loadProfile,
		loadUiConfig,
	};
});
