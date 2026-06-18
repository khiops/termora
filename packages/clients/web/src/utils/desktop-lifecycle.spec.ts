import { describe, expect, it, vi } from "vitest";
import { quitCompletely } from "./desktop-lifecycle.js";

describe("quitCompletely", () => {
	it("retries with force after a 409 confirmation", async () => {
		const stopHub = vi
			.fn()
			.mockResolvedValueOnce({ status: "conflict", others: 2 })
			.mockResolvedValueOnce({ status: "stopped" });
		const confirmForce = vi.fn().mockResolvedValue(true);
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			stopHub,
			confirmForce,
			exitApp,
		});

		expect(confirmForce).toHaveBeenCalledWith(2);
		expect(stopHub).toHaveBeenNthCalledWith(1, false);
		expect(stopHub).toHaveBeenNthCalledWith(2, true);
		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: "exited" });
	});

	it("keeps the app alive when the user cancels the force confirmation", async () => {
		const stopHub = vi.fn().mockResolvedValueOnce({ status: "conflict", others: 1 });
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			stopHub,
			confirmForce: () => Promise.resolve(false),
			exitApp,
		});

		expect(stopHub).toHaveBeenCalledOnce();
		expect(exitApp).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "cancelled", others: 1 });
	});

	it("logs missing native conflict counts and confirms with a conservative count", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const stopHub = vi
			.fn()
			.mockResolvedValueOnce({ status: "conflict" })
			.mockResolvedValueOnce({ status: "stopped" });
		const confirmForce = vi.fn().mockResolvedValue(true);
		const exitApp = vi.fn().mockResolvedValue(undefined);

		try {
			const result = await quitCompletely({
				stopHub,
				confirmForce,
				exitApp,
			});

			expect(warn).toHaveBeenCalledWith(
				"[desktop] native shutdown conflict response missing others count",
				{ others: undefined },
			);
			expect(confirmForce).toHaveBeenCalledWith(1);
			expect(exitApp).toHaveBeenCalledOnce();
			expect(result).toEqual({ status: "exited" });
		} finally {
			warn.mockRestore();
		}
	});

	it("exits after the native stop reports the hub pid is gone", async () => {
		const stopHub = vi.fn().mockResolvedValueOnce({ status: "stopped" });
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			stopHub,
			exitApp,
		});

		expect(stopHub).toHaveBeenCalledWith(false);
		expect(exitApp).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: "exited" });
	});

	it("keeps the app alive when the native stop cannot confirm pid exit", async () => {
		const stopHub = vi.fn().mockRejectedValue(new Error("hub pid is still alive"));
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			stopHub,
			exitApp,
		});

		expect(stopHub).toHaveBeenCalledOnce();
		expect(exitApp).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "failed", error: expect.any(Error) });
	});

	it("keeps the app alive if the forced native stop still conflicts", async () => {
		const stopHub = vi
			.fn()
			.mockResolvedValueOnce({ status: "conflict", others: 1 })
			.mockResolvedValueOnce({ status: "conflict", others: 1 });
		const exitApp = vi.fn().mockResolvedValue(undefined);

		const result = await quitCompletely({
			stopHub,
			confirmForce: () => Promise.resolve(true),
			exitApp,
		});

		expect(stopHub).toHaveBeenNthCalledWith(1, false);
		expect(stopHub).toHaveBeenNthCalledWith(2, true);
		expect(exitApp).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "failed", error: expect.any(Error) });
	});
});
