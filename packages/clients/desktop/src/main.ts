import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startHub } from "./lib";
import {
	quitCompletely,
	readCloseBehavior,
	resolveCloseAction,
	type ShutdownTarget,
	shouldStartHubFromWebview,
	writeCloseBehavior,
} from "./lifecycle";

const HUB_PORT = 4100;
type DesktopImportMeta = ImportMeta & { env?: { DEV?: boolean } };

async function init(): Promise<void> {
	try {
		if (shouldStartHubFromWebview((import.meta as DesktopImportMeta).env)) {
			await startHub(HUB_PORT);
		}

		// Navigate webview to hub
		const mainWindow = getCurrentWindow();
		// The window URL is set in tauri.conf.json, but we can also
		// programmatically navigate after hub is ready
		console.log("[termora-desktop] hub ready, webview loading...");

		// Handle window close. Always prevent the native close first so the
		// webview stays alive until the shutdown or hide decision resolves.
		await mainWindow.onCloseRequested(async (event) => {
			event.preventDefault();
			const action = resolveCloseAction(readCloseBehavior());
			if (action === "hide") {
				await hideOrMinimize(mainWindow);
				return;
			}
			if (action === "quit") {
				await quitFromWebview();
				return;
			}
			const choice = window.confirm("Quit Termora completely? Cancel minimizes to tray.");
			if (choice) {
				if (window.confirm("Remember this close behavior?")) {
					writeCloseBehavior("quit");
				}
				await quitFromWebview();
			} else {
				if (window.confirm("Remember minimize to tray for future closes?")) {
					writeCloseBehavior("tray");
				}
				await hideOrMinimize(mainWindow);
			}
		});
	} catch (err) {
		console.error("[termora-desktop] failed to start:", err);
	}
}

async function hideOrMinimize(mainWindow: ReturnType<typeof getCurrentWindow>): Promise<void> {
	let trayAvailable = false;
	try {
		trayAvailable = await invoke<boolean>("is_tray_available");
	} catch {
		trayAvailable = false;
	}
	if (trayAvailable) {
		await mainWindow.hide();
	} else {
		await mainWindow.minimize();
	}
}

async function quitFromWebview(): Promise<void> {
	await quitCompletely({
		getShutdownTarget: async (): Promise<ShutdownTarget | null> =>
			invoke<ShutdownTarget>("get_hub_runtime"),
		exitApp: () => invoke("exit_app"),
	});
}

init();
