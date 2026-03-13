import { getCurrentWindow } from "@tauri-apps/api/window";
import { startHub, stopHub } from "./lib";

const HUB_PORT = 4100;

async function init(): Promise<void> {
	try {
		await startHub(HUB_PORT);

		// Navigate webview to hub
		const mainWindow = getCurrentWindow();
		// The window URL is set in tauri.conf.json, but we can also
		// programmatically navigate after hub is ready
		console.log("[nexterm-desktop] hub ready, webview loading...");

		// Handle window close — stop hub gracefully
		await mainWindow.onCloseRequested(async (event) => {
			event.preventDefault();
			await stopHub();
			await mainWindow.destroy();
		});
	} catch (err) {
		console.error("[nexterm-desktop] failed to start:", err);
	}
}

init();
