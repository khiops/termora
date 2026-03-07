import type { IDisposable, Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalSearch } from "./useTerminalSearch.js";

// ── Mock SearchAddon ────────────────────────────────────────────────────

let onDidChangeResultsHandler: ((e: { resultIndex: number; resultCount: number }) => void) | null =
	null;

const mockAddon = {
	findNext: vi.fn().mockReturnValue(true),
	findPrevious: vi.fn().mockReturnValue(true),
	clearDecorations: vi.fn(),
	clearActiveDecoration: vi.fn(),
	dispose: vi.fn(),
	activate: vi.fn(),
	onDidChangeResults: vi.fn((cb: (e: { resultIndex: number; resultCount: number }) => void) => {
		onDidChangeResultsHandler = cb;
		return { dispose: vi.fn() } as IDisposable;
	}),
};

vi.mock("@xterm/addon-search", () => ({
	SearchAddon: vi.fn().mockImplementation(() => ({ ...mockAddon })),
}));

// ── Mock getComputedStyle for decoration colors ─────────────────────────

const cssVars: Record<string, string> = {
	"--nt-search-highlight": "#e6db74",
	"--nt-search-highlight-active": "#f92672",
};

vi.stubGlobal(
	"getComputedStyle",
	vi.fn(() => ({
		getPropertyValue: (prop: string) => cssVars[prop] ?? "",
	})),
);

// ── Mock terminal ───────────────────────────────────────────────────────

function createMockTerminal(): Terminal {
	return {
		loadAddon: vi.fn(),
	} as unknown as Terminal;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("useTerminalSearch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		onDidChangeResultsHandler = null;
	});

	describe("init", () => {
		it("creates SearchAddon and loads it on the terminal", () => {
			const term = createMockTerminal();
			const { init } = useTerminalSearch();
			init(term);

			expect(term.loadAddon).toHaveBeenCalledOnce();
			expect(term.loadAddon).toHaveBeenCalledWith(
				expect.objectContaining({ findNext: expect.any(Function) }),
			);
		});

		it("subscribes to onDidChangeResults", () => {
			const term = createMockTerminal();
			const { init } = useTerminalSearch();
			init(term);

			expect(onDidChangeResultsHandler).toBeTypeOf("function");
		});
	});

	describe("search", () => {
		it("calls findNext with correct options and incremental flag", () => {
			const term = createMockTerminal();
			const { init, search } = useTerminalSearch();
			init(term);

			search("hello");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.findNext).toHaveBeenCalledWith("hello", {
				caseSensitive: false,
				regex: false,
				wholeWord: false,
				incremental: true,
				decorations: {
					matchBackground: "#e6db74",
					matchOverviewRuler: "#e6db74",
					activeMatchBackground: "#f92672",
					activeMatchColorOverviewRuler: "#f92672",
				},
			});
		});

		it("sets query ref", () => {
			const term = createMockTerminal();
			const { init, search, query } = useTerminalSearch();
			init(term);

			search("test");
			expect(query.value).toBe("test");
		});

		it("clears decorations and resets counts for empty query", () => {
			const term = createMockTerminal();
			const { init, search, matchCount, currentMatch } = useTerminalSearch();
			init(term);

			// Search first to establish state
			search("hello");

			// Now search empty
			search("");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.clearDecorations).toHaveBeenCalled();
			expect(matchCount.value).toBe(0);
			expect(currentMatch.value).toBe(0);
		});

		it("passes options (caseSensitive, wholeWord) through to findNext", () => {
			const term = createMockTerminal();
			const { init, search, options } = useTerminalSearch();
			init(term);

			options.value = { caseSensitive: true, regex: false, wholeWord: true };
			search("Error");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.findNext).toHaveBeenCalledWith(
				"Error",
				expect.objectContaining({
					caseSensitive: true,
					wholeWord: true,
				}),
			);
		});

		it("passes regex option through to findNext", () => {
			const term = createMockTerminal();
			const { init, search, options } = useTerminalSearch();
			init(term);

			options.value = { caseSensitive: false, regex: true, wholeWord: false };
			search("err.*");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.findNext).toHaveBeenCalledWith(
				"err.*",
				expect.objectContaining({ regex: true }),
			);
		});

		it("sets regexError on invalid regex and does not call findNext", () => {
			const term = createMockTerminal();
			const { init, search, options, regexError } = useTerminalSearch();
			init(term);

			options.value = { caseSensitive: false, regex: true, wholeWord: false };
			search("[invalid");

			expect(regexError.value).toBeTypeOf("string");
			expect(regexError.value).not.toBeNull();

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.findNext).not.toHaveBeenCalled();
		});

		it("clears regexError when regex is valid", () => {
			const term = createMockTerminal();
			const { init, search, options, regexError } = useTerminalSearch();
			init(term);

			options.value = { caseSensitive: false, regex: true, wholeWord: false };
			search("[invalid");
			expect(regexError.value).not.toBeNull();

			search("valid.*pattern");
			expect(regexError.value).toBeNull();
		});

		it("clears regexError when regex mode is off", () => {
			const term = createMockTerminal();
			const { init, search, options, regexError } = useTerminalSearch();
			init(term);

			// First set regex error
			options.value = { caseSensitive: false, regex: true, wholeWord: false };
			search("[invalid");
			expect(regexError.value).not.toBeNull();

			// Switch off regex mode and search again
			options.value = { caseSensitive: false, regex: false, wholeWord: false };
			search("[literal");
			expect(regexError.value).toBeNull();
		});

		it("is a no-op when called before init", () => {
			const { search, query } = useTerminalSearch();
			// Should not throw
			search("test");
			expect(query.value).toBe("test");
		});
	});

	describe("findNext", () => {
		it("calls addon.findNext with current query and options", () => {
			const term = createMockTerminal();
			const { init, search, findNext } = useTerminalSearch();
			init(term);

			search("hello");
			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			addon.findNext.mockClear();

			findNext();

			expect(addon.findNext).toHaveBeenCalledWith("hello", {
				caseSensitive: false,
				regex: false,
				wholeWord: false,
				decorations: expect.any(Object),
			});
		});

		it("is a no-op when query is empty", () => {
			const term = createMockTerminal();
			const { init, findNext } = useTerminalSearch();
			init(term);

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			findNext();

			expect(addon.findNext).not.toHaveBeenCalled();
		});
	});

	describe("findPrevious", () => {
		it("calls addon.findPrevious with current query and options", () => {
			const term = createMockTerminal();
			const { init, search, findPrevious } = useTerminalSearch();
			init(term);

			search("hello");
			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

			findPrevious();

			expect(addon.findPrevious).toHaveBeenCalledWith("hello", {
				caseSensitive: false,
				regex: false,
				wholeWord: false,
				decorations: expect.any(Object),
			});
		});

		it("is a no-op when query is empty", () => {
			const term = createMockTerminal();
			const { init, findPrevious } = useTerminalSearch();
			init(term);

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			findPrevious();

			expect(addon.findPrevious).not.toHaveBeenCalled();
		});
	});

	describe("onDidChangeResults", () => {
		it("updates matchCount and currentMatch when results change", () => {
			const term = createMockTerminal();
			const { init, matchCount, currentMatch } = useTerminalSearch();
			init(term);

			// Simulate SearchAddon emitting results
			if (onDidChangeResultsHandler) {
				onDidChangeResultsHandler({ resultIndex: 2, resultCount: 5 });
			}

			expect(matchCount.value).toBe(5);
			expect(currentMatch.value).toBe(3); // 0-based → 1-based
		});

		it("sets currentMatch to 0 when resultIndex is -1 (threshold exceeded)", () => {
			const term = createMockTerminal();
			const { init, matchCount, currentMatch } = useTerminalSearch();
			init(term);

			if (onDidChangeResultsHandler) {
				onDidChangeResultsHandler({ resultIndex: -1, resultCount: 1500 });
			}

			expect(matchCount.value).toBe(1500);
			expect(currentMatch.value).toBe(0);
		});
	});

	describe("clear", () => {
		it("resets all state and clears decorations", () => {
			const term = createMockTerminal();
			const { init, search, clear, query, matchCount, currentMatch, regexError } =
				useTerminalSearch();
			init(term);

			// Establish state
			search("test");

			clear();

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.clearDecorations).toHaveBeenCalled();
			expect(query.value).toBe("");
			expect(matchCount.value).toBe(0);
			expect(currentMatch.value).toBe(0);
			expect(regexError.value).toBeNull();
		});
	});

	describe("open / close", () => {
		it("open sets isOpen to true", () => {
			const { open, isOpen } = useTerminalSearch();
			expect(isOpen.value).toBe(false);
			open();
			expect(isOpen.value).toBe(true);
		});

		it("close sets isOpen to false and clears search state", () => {
			const term = createMockTerminal();
			const { init, search, open, close, isOpen, query } = useTerminalSearch();
			init(term);

			open();
			search("test");
			expect(isOpen.value).toBe(true);
			expect(query.value).toBe("test");

			close();
			expect(isOpen.value).toBe(false);
			expect(query.value).toBe("");
		});
	});

	describe("dispose", () => {
		it("disposes the SearchAddon", () => {
			const term = createMockTerminal();
			const { init, dispose } = useTerminalSearch();
			init(term);

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			dispose();

			expect(addon.dispose).toHaveBeenCalledOnce();
		});

		it("is safe to call multiple times", () => {
			const term = createMockTerminal();
			const { init, dispose } = useTerminalSearch();
			init(term);

			dispose();
			// Should not throw
			dispose();
		});

		it("is safe to call before init", () => {
			const { dispose } = useTerminalSearch();
			// Should not throw
			dispose();
		});
	});

	describe("decoration colors", () => {
		it("reads colors from CSS custom properties", () => {
			const term = createMockTerminal();
			const { init, search } = useTerminalSearch();
			init(term);

			search("test");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(addon.findNext).toHaveBeenCalledWith(
				"test",
				expect.objectContaining({
					decorations: {
						matchBackground: "#e6db74",
						matchOverviewRuler: "#e6db74",
						activeMatchBackground: "#f92672",
						activeMatchColorOverviewRuler: "#f92672",
					},
				}),
			);
		});
	});

	describe("scrollbar markers", () => {
		it("includes overview ruler colors by default (scrollbarMarkers=true)", () => {
			const term = createMockTerminal();
			const { init, search } = useTerminalSearch();
			init(term);

			search("test");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			const decorations = addon.findNext.mock.calls[0]?.[1].decorations;
			expect(decorations).toHaveProperty("matchOverviewRuler", "#e6db74");
			expect(decorations).toHaveProperty("activeMatchColorOverviewRuler", "#f92672");
		});

		it("includes overview ruler colors when explicitly enabled", () => {
			const term = createMockTerminal();
			const { init, search } = useTerminalSearch();
			init(term, { scrollbarMarkers: true });

			search("test");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			const decorations = addon.findNext.mock.calls[0]?.[1].decorations;
			expect(decorations).toHaveProperty("matchOverviewRuler", "#e6db74");
			expect(decorations).toHaveProperty("activeMatchColorOverviewRuler", "#f92672");
		});

		it("uses transparent overview ruler colors when scrollbarMarkers=false", () => {
			const term = createMockTerminal();
			const { init, search } = useTerminalSearch();
			init(term, { scrollbarMarkers: false });

			search("test");

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			const decorations = addon.findNext.mock.calls[0]?.[1].decorations;
			expect(decorations).toHaveProperty("matchOverviewRuler", "transparent");
			expect(decorations).toHaveProperty("activeMatchColorOverviewRuler", "transparent");
			// Match backgrounds should still be present
			expect(decorations).toHaveProperty("matchBackground", "#e6db74");
			expect(decorations).toHaveProperty("activeMatchBackground", "#f92672");
		});

		it("setScrollbarMarkers toggles overview ruler at runtime", () => {
			const term = createMockTerminal();
			const { init, search, setScrollbarMarkers } = useTerminalSearch();
			init(term, { scrollbarMarkers: true });

			search("test");
			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

			// Disable markers
			addon.findNext.mockClear();
			addon.clearDecorations.mockClear();
			setScrollbarMarkers(false);

			// Should have cleared and re-searched
			expect(addon.clearDecorations).toHaveBeenCalledOnce();
			expect(addon.findNext).toHaveBeenCalledOnce();
			const disabledDecorations = addon.findNext.mock.calls[0]?.[1].decorations;
			expect(disabledDecorations).toHaveProperty("matchOverviewRuler", "transparent");
			expect(disabledDecorations).toHaveProperty("activeMatchColorOverviewRuler", "transparent");
		});

		it("setScrollbarMarkers re-enables overview ruler at runtime", () => {
			const term = createMockTerminal();
			const { init, search, setScrollbarMarkers } = useTerminalSearch();
			init(term, { scrollbarMarkers: false });

			search("test");
			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

			// Enable markers
			addon.findNext.mockClear();
			addon.clearDecorations.mockClear();
			setScrollbarMarkers(true);

			expect(addon.clearDecorations).toHaveBeenCalledOnce();
			expect(addon.findNext).toHaveBeenCalledOnce();
			const enabledDecorations = addon.findNext.mock.calls[0]?.[1].decorations;
			expect(enabledDecorations).toHaveProperty("matchOverviewRuler", "#e6db74");
			expect(enabledDecorations).toHaveProperty("activeMatchColorOverviewRuler", "#f92672");
		});

		it("setScrollbarMarkers is a no-op when no active search", () => {
			const term = createMockTerminal();
			const { init, setScrollbarMarkers } = useTerminalSearch();
			init(term);

			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			// No search active — setScrollbarMarkers should not trigger findNext
			setScrollbarMarkers(false);

			expect(addon.findNext).not.toHaveBeenCalled();
			expect(addon.clearDecorations).not.toHaveBeenCalled();
		});

		it("markers cleared when search is closed", () => {
			const term = createMockTerminal();
			const { init, search, open, close } = useTerminalSearch();
			init(term);

			open();
			search("test");
			const addon = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

			close();

			// close() calls clear() which calls clearDecorations
			expect(addon.clearDecorations).toHaveBeenCalled();
		});
	});
});
