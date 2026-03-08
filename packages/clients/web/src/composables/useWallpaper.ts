import type { TerminalProfile } from "@nexterm/shared";
import type { CSSProperties } from "vue";
import { type Ref, computed, ref } from "vue";

/**
 * Composable: reactive wallpaper style computation for a terminal pane.
 *
 * Returns CSS style objects for the wallpaper background layer and the dim
 * overlay, both null when no wallpaper is configured (zero perf impact).
 */
export function useWallpaper(profile: Ref<TerminalProfile>) {
	const cacheBust = ref(Date.now());

	const wallpaperStyle = computed<CSSProperties | null>(() => {
		if (!profile.value.wallpaper) return null;
		const url = `/public/wallpapers/${encodeURIComponent(profile.value.wallpaper)}?t=${cacheBust.value}`;
		const blur = profile.value.wallpaperBlur ?? 0;
		return {
			backgroundImage: `url(${url})`,
			backgroundSize: "cover",
			backgroundPosition: "center",
			...(blur > 0 ? { filter: `blur(${blur}px)`, willChange: "filter" as const } : {}),
		};
	});

	const dimStyle = computed<CSSProperties | null>(() => {
		if (!profile.value.wallpaper) return null;
		const dim = profile.value.wallpaperDim ?? 0;
		if (dim === 0) return null;
		return { background: `rgba(0, 0, 0, ${dim / 100})` };
	});

	function refreshCache(): void {
		cacheBust.value = Date.now();
	}

	return { wallpaperStyle, dimStyle, refreshCache };
}
