import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLOSE_BEHAVIOR_KEY,
	quitCompletely,
	readCloseBehavior,
	resolveCloseAction,
	shouldStartHubFromWebview,
	writeCloseBehavior,
} from "./lifecycle.js";

function response(status: number, body: unknown = {}): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	} as Response;
}

const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

describe("desktop lifecycle helpers", () => {
	beforeEach(() => {
		localStorageMap.clear();
	});

	it("maps closeBehavior to safe actions", () => {
		expect(resolveCloseAction("ask")).toBe("modal");
		expect(resolveCloseAction("tray")).toBe("hide");
		expect(resolveCloseAction("quit")).toBe("quit");
		expect(resolveCloseAction(undefined)).toBe("modal");
		expect(resolveCloseAction("unknown")).toBe("modal");
	});

	it("reads and writes the desktop-local close preference", () => {
		expect(readCloseBehavior()).toBe("ask");
		writeCloseBehavior("quit");
		expect(localStorage.getItem(CLOSE_BEHAVIOR_KEY)).toBe("quit");
		expect(readCloseBehavior()).toBe("quit");
	});

	it("gates the webview hub spawner to dev only", () => {
		expect(shouldStartHubFromWebview({ DEV: true })).toBe(true);
		expect(shouldStartHubFromWebview({ DEV: false })).toBe(false);
		expect(shouldStartHubFromWebview(undefined)).toBe(false);
	});

	it("retries quit with force after the user confirms a 409 guard", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(response(409, { others: 3 }))
			.mockResolvedValueOnce(response(200));
		const exitApp = vi.fn().mockResolvedValue(undefined);
		const confirmForce = vi.fn().mockResolvedValue(true);

		const result = await quitCompletely({
			fetch: fetchImpl,
			getShutdownTarget: () =>
				Promise.resolve({ port: 4100, ownerToken: "owner-token", clientId: "client-1" }),
			confirmForce,
			exitApp,
		});

		expect(confirmForce).toHaveBeenCalledWith(3);
		expect(fetchImpl).toHaveBeenNthCalledWith(
			1,
			"http://localhost:4100/api/shutdown",
			expect.objectContaining({
				method: "POST",
				headers: {
					"X-Termora-Owner": "owner-token",
					"X-Termora-Client-Id": "client-1",
				},
			}),
		);
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			"http://localhost:4100/api/shutdown?force=1",
			expect.objectContaining({ method: "POST" }),
		);
		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toBe("exited");
	});

	it("treats hub fetch failure as already down and exits", async () => {
		const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("connection refused"));
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			fetch: fetchImpl,
			getShutdownTarget: () => Promise.resolve({ port: 4100, ownerToken: "owner-token" }),
			exitApp,
		});

		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toBe("exited");
	});
});
