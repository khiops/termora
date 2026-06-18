import { isTauriRuntime } from "./hub-url.js";

export async function loadDesktopVersion(): Promise<string | undefined> {
	if (!isTauriRuntime()) return undefined;

	try {
		const { getVersion } = await import("@tauri-apps/api/app");
		return await getVersion();
	} catch (error) {
		console.warn("[desktop-version] failed to read Tauri app version:", error);
		return undefined;
	}
}
