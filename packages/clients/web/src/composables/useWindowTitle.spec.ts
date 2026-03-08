import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { formatWindowTitle, useWindowTitle } from "./useWindowTitle.js";

// ─── formatWindowTitle unit tests ─────────────────────────────────────────────

describe("formatWindowTitle", () => {
	it("replaces all tokens when all vars are provided", () => {
		const result = formatWindowTitle("nexterm - {prefix}{host} - {title}", {
			prefix: "PROD ",
			host: "server-1",
			title: "htop",
		});
		expect(result).toBe("nexterm - PROD server-1 - htop");
	});

	it("trims trailing separator when title is empty", () => {
		const result = formatWindowTitle("nexterm - {prefix}{host} - {title}", {
			prefix: "PROD ",
			host: "myhost",
			title: "",
		});
		expect(result).toBe("nexterm - PROD myhost");
	});

	it("trims trailing em dash separator", () => {
		const result = formatWindowTitle("nexterm \u2014 {host} \u2014 {title}", {
			host: "myhost",
			title: "",
		});
		expect(result).toBe("nexterm \u2014 myhost");
	});

	it("handles empty prefix without double space", () => {
		const result = formatWindowTitle("nexterm - {prefix}{host} - {title}", {
			prefix: "",
			host: "server-1",
			title: "vim",
		});
		expect(result).toBe("nexterm - server-1 - vim");
	});

	it("returns 'nexterm' when all tokens are empty and format collapses", () => {
		const result = formatWindowTitle("{prefix}{host} - {title}", {
			prefix: "",
			host: "",
			title: "",
		});
		expect(result).toBe("nexterm");
	});

	it("supports {channel} and {shell} tokens", () => {
		const result = formatWindowTitle("{channel} on {shell}", {
			channel: "Terminal 1",
			shell: "/bin/bash",
		});
		expect(result).toBe("Terminal 1 on /bin/bash");
	});

	it("handles custom format string", () => {
		const result = formatWindowTitle("[{host}] {title}", {
			host: "prod",
			title: "vim",
		});
		expect(result).toBe("[prod] vim");
	});

	it("trims leading separator when host/prefix are empty", () => {
		const result = formatWindowTitle("{host} - {title}", {
			host: "",
			title: "vim",
		});
		expect(result).toBe("vim");
	});

	it("collapses duplicate separators from adjacent missing tokens", () => {
		const result = formatWindowTitle("{prefix} - {host} - {title}", {
			prefix: "",
			host: "",
			title: "vim",
		});
		expect(result).toBe("vim");
	});
});

// ─── useWindowTitle composable tests ──────────────────────────────────────────

describe("useWindowTitle", () => {
	afterEach(() => {
		document.title = "";
		vi.restoreAllMocks();
	});

	it("sets document.title when enabled", async () => {
		vi.useFakeTimers();
		const scope = effectScope();

		scope.run(() => {
			useWindowTitle({
				enabled: ref(true),
				format: ref("nexterm - {host} - {title}"),
				activeTitle: ref("vim"),
				activeHost: ref("prod"),
				activePrefix: ref(""),
			});
		});

		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm - prod - vim");

		scope.stop();
		vi.useRealTimers();
	});

	it("sets document.title to 'nexterm' when disabled", () => {
		vi.useFakeTimers();
		const scope = effectScope();

		scope.run(() => {
			useWindowTitle({
				enabled: ref(false),
				format: ref("nexterm - {host} - {title}"),
				activeTitle: ref("vim"),
				activeHost: ref("prod"),
				activePrefix: ref(""),
			});
		});

		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm");

		scope.stop();
		vi.useRealTimers();
	});

	it("restores 'nexterm' on scope dispose", () => {
		vi.useFakeTimers();
		const scope = effectScope();

		scope.run(() => {
			useWindowTitle({
				enabled: ref(true),
				format: ref("nexterm - {title}"),
				activeTitle: ref("vim"),
				activeHost: ref(""),
				activePrefix: ref(""),
			});
		});

		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm - vim");

		scope.stop();
		expect(document.title).toBe("nexterm");

		vi.useRealTimers();
	});

	it("updates reactively when title changes", async () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const title = ref("vim");

		scope.run(() => {
			useWindowTitle({
				enabled: ref(true),
				format: ref("nexterm - {title}"),
				activeTitle: title,
				activeHost: ref(""),
				activePrefix: ref(""),
			});
		});

		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm - vim");

		title.value = "htop";
		await nextTick(); // flush Vue watcher queue
		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm - htop");

		scope.stop();
		vi.useRealTimers();
	});

	it("debounces rapid updates", async () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const title = ref("a");

		scope.run(() => {
			useWindowTitle({
				enabled: ref(true),
				format: ref("{title}"),
				activeTitle: title,
				activeHost: ref(""),
				activePrefix: ref(""),
			});
		});

		// Rapid changes within debounce window
		title.value = "b";
		await nextTick();
		vi.advanceTimersByTime(50);
		title.value = "c";
		await nextTick();
		vi.advanceTimersByTime(50);
		title.value = "d";
		await nextTick();
		vi.advanceTimersByTime(150);

		// Only the last value should be applied
		expect(document.title).toBe("d");

		scope.stop();
		vi.useRealTimers();
	});

	it("includes prefix in window title", () => {
		vi.useFakeTimers();
		const scope = effectScope();

		scope.run(() => {
			useWindowTitle({
				enabled: ref(true),
				format: ref("nexterm - {prefix}{host} - {title}"),
				activeTitle: ref("vim"),
				activeHost: ref("server"),
				activePrefix: ref("PROD "),
			});
		});

		vi.advanceTimersByTime(150);
		expect(document.title).toBe("nexterm - PROD server - vim");

		scope.stop();
		vi.useRealTimers();
	});
});
