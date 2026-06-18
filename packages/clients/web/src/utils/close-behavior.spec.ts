import { beforeEach, describe, expect, it } from "vitest";
import {
	CLOSE_BEHAVIOR_KEY,
	readCloseBehavior,
	resolveCloseAction,
	writeCloseBehavior,
} from "./close-behavior.js";

describe("close behavior helpers", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("defaults to ask when localStorage is empty", () => {
		expect(readCloseBehavior()).toBe("ask");
		expect(resolveCloseAction(undefined)).toBe("modal");
	});

	it("persists close behavior in localStorage", () => {
		writeCloseBehavior("tray");

		expect(localStorage.getItem(CLOSE_BEHAVIOR_KEY)).toBe("tray");
		expect(readCloseBehavior()).toBe("tray");
		expect(resolveCloseAction(readCloseBehavior())).toBe("hide");
	});

	it("treats unknown values as ask", () => {
		localStorage.setItem(CLOSE_BEHAVIOR_KEY, "close-now");

		expect(readCloseBehavior()).toBe("ask");
		expect(resolveCloseAction("close-now")).toBe("modal");
	});
});
