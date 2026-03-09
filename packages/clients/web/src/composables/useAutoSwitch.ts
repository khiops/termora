import { onScopeDispose, ref, watch } from "vue";
import { useThemeStore } from "../stores/theme.js";

/**
 * Composable that listens to `prefers-color-scheme` media query
 * and auto-switches themes when the OS dark/light preference changes.
 */
export function useAutoSwitch() {
	const themeStore = useThemeStore();

	const enabled = ref(false);
	const darkThemeName = ref("catppuccin-mocha");
	const lightThemeName = ref("one-half-light");

	let mediaQuery: MediaQueryList | null = null;
	let handler: ((e: MediaQueryListEvent) => void) | null = null;

	function applyCurrentPreference(): void {
		if (!enabled.value || !mediaQuery) return;
		const targetName = mediaQuery.matches ? darkThemeName.value : lightThemeName.value;
		const theme = themeStore.availableThemes.find((t) => t.name === targetName);
		if (theme) {
			themeStore.currentTheme = theme;
			themeStore.applyTheme(theme);
		}
	}

	function start(): void {
		if (mediaQuery) stop();
		mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		handler = (e: MediaQueryListEvent) => {
			if (!enabled.value) return;
			const targetName = e.matches ? darkThemeName.value : lightThemeName.value;
			const theme = themeStore.availableThemes.find((t) => t.name === targetName);
			if (theme) {
				themeStore.currentTheme = theme;
				themeStore.applyTheme(theme);
			}
		};
		mediaQuery.addEventListener("change", handler);
		applyCurrentPreference();
	}

	function stop(): void {
		if (mediaQuery && handler) {
			mediaQuery.removeEventListener("change", handler);
		}
		mediaQuery = null;
		handler = null;
	}

	watch(
		enabled,
		(val) => {
			if (val) start();
			else stop();
		},
		{ flush: "sync" },
	);

	onScopeDispose(() => stop());

	return { enabled, darkThemeName, lightThemeName, applyCurrentPreference };
}
