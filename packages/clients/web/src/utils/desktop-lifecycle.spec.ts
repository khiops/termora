import { describe, expect, it, vi } from "vitest";
import { quitCompletely } from "./desktop-lifecycle.js";

function response(status: number, body: unknown = {}): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	} as Response;
}

function malformedJsonResponse(status: number): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.reject(new Error("bad json")),
	} as Response;
}

describe("quitCompletely", () => {
	it("retries with force after a 409 confirmation", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(response(409, { others: 2 }))
			.mockResolvedValueOnce(response(200));
		const confirmForce = vi.fn().mockResolvedValue(true);
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			fetch: fetchImpl,
			getShutdownTarget: () =>
				Promise.resolve({ port: 4100, ownerToken: "owner-token", clientId: "client-1" }),
			confirmForce,
			exitApp,
		});

		expect(confirmForce).toHaveBeenCalledWith(2);
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
		expect(result).toEqual({ status: "exited" });
	});

	it("keeps the app alive when the user cancels the force confirmation", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(response(409, { others: 1 }));
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			fetch: fetchImpl,
			getShutdownTarget: () => Promise.resolve({ port: 4100, ownerToken: "owner-token" }),
			confirmForce: () => Promise.resolve(false),
			exitApp,
		});

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(exitApp).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "cancelled", others: 1 });
	});

	it("logs malformed 409 bodies and confirms with a conservative count", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(malformedJsonResponse(409))
			.mockResolvedValueOnce(response(200));
		const confirmForce = vi.fn().mockResolvedValue(true);
		const exitApp = vi.fn().mockResolvedValue(undefined);

		try {
			const result = await quitCompletely({
				fetch: fetchImpl,
				getShutdownTarget: () => Promise.resolve({ port: 4100, ownerToken: "owner-token" }),
				confirmForce,
				exitApp,
			});

			expect(warn).toHaveBeenCalledWith(
				"[desktop] malformed shutdown conflict response",
				expect.any(Error),
			);
			expect(confirmForce).toHaveBeenCalledWith(1);
			expect(exitApp).toHaveBeenCalledOnce();
			expect(result).toEqual({ status: "exited" });
		} finally {
			warn.mockRestore();
		}
	});

	it("exits when the shutdown request cannot reach the hub", async () => {
		const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			fetch: fetchImpl,
			getShutdownTarget: () => Promise.resolve({ port: 4100, ownerToken: "owner-token" }),
			exitApp,
		});

		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: "exited" });
	});

	it("uses the legacy hub stop fallback before exiting a no-owner-token runtime", async () => {
		const stopLegacyHub = vi.fn().mockResolvedValue(true);
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			getShutdownTarget: () => Promise.resolve({ pid: 1234, port: 4100, ownerToken: null }),
			stopLegacyHub,
			exitApp,
		});

		expect(stopLegacyHub).toHaveBeenCalledOnce();
		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: "exited" });
	});

	it("keeps the app alive when the legacy hub stop fallback fails", async () => {
		const stopLegacyHub = vi.fn().mockRejectedValue(new Error("kill failed"));
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			getShutdownTarget: () => Promise.resolve({ pid: 1234, port: 4100, ownerToken: null }),
			stopLegacyHub,
			exitApp,
		});

		expect(stopLegacyHub).toHaveBeenCalledOnce();
		expect(exitApp).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "failed", error: expect.any(Error) });
	});
});
