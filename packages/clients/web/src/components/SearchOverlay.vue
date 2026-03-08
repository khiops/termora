<template>
	<div
		v-show="isOpen"
		role="search"
		aria-label="Terminal search"
		:class="['search-overlay', `search-overlay--${position}`]"
		@keydown.stop
	>
		<div class="search-overlay__input-row">
			<div class="search-overlay__input-wrapper">
				<input
					ref="inputRef"
					type="text"
					aria-label="Search terminal"
					class="search-overlay__input"
					:class="{ 'search-overlay__input--error': regexError }"
					placeholder="Search..."
					:value="query"
					@input="onInput"
					@keydown.enter.exact.prevent="onEnter"
					@keydown.enter.shift.prevent="onShiftEnter"
					@keydown.escape.prevent="$emit('close')"
					@keydown.tab.prevent
					@focus="inputFocused = true"
					@blur="onInputBlur"
				/>
				<span v-if="regexError" class="search-overlay__regex-error">{{ regexError }}</span>

				<!-- History dropdown (SC-15) -->
				<div
					v-if="showHistoryDropdown"
					class="search-overlay__history"
					@mousedown.prevent
				>
					<button
						v-for="entry in history"
						:key="entry.query + (entry.regex ? ':regex' : '')"
						class="search-overlay__history-item"
						@click="onSelectHistory(entry)"
					>
						<span class="search-overlay__history-query">{{ entry.query }}</span>
						<span v-if="entry.regex" class="search-overlay__history-badge">[.*]</span>
					</button>
				</div>
			</div>

			<span class="search-overlay__match-count">
				{{ matchCount > 0 ? `${currentMatch}/${matchCount}` : "0/0" }}
			</span>

			<button
				class="search-overlay__btn"
				title="Previous match (Shift+Enter)"
				:disabled="matchCount === 0"
				@click="$emit('find-previous')"
			>
				&#9650;
			</button>
			<button
				class="search-overlay__btn"
				title="Next match (Enter)"
				:disabled="matchCount === 0"
				@click="$emit('find-next')"
			>
				&#9660;
			</button>

			<span class="search-overlay__separator" />

			<!-- Scope toggle (SC-12): only visible when tab has multiple panes -->
			<button
				v-if="showScopeToggle"
				class="search-overlay__toggle"
				:class="{ 'search-overlay__toggle--active': scope === 'all' }"
				:title="scope === 'pane' ? 'Search this pane (click for all panes)' : 'Search all panes (click for this pane)'"
				@click="$emit('update:scope', scope === 'pane' ? 'all' : 'pane')"
			>
				{{ scope === "pane" ? "1" : "All" }}
			</button>

			<span v-if="showScopeToggle" class="search-overlay__separator" />

			<button
				class="search-overlay__toggle"
				:class="{ 'search-overlay__toggle--active': options.caseSensitive }"
				title="Match Case"
				@click="toggleOption('caseSensitive')"
			>
				Aa
			</button>
			<button
				class="search-overlay__toggle"
				:class="{ 'search-overlay__toggle--active': options.regex }"
				title="Use Regular Expression"
				@click="toggleOption('regex')"
			>
				.*
			</button>
			<button
				class="search-overlay__toggle"
				:class="{ 'search-overlay__toggle--active': options.wholeWord }"
				title="Match Whole Word"
				@click="toggleOption('wholeWord')"
			>
				W
			</button>

			<span class="search-overlay__separator" />

			<button
				class="search-overlay__btn search-overlay__btn--close"
				title="Close (Escape)"
				@click="$emit('close')"
			>
				&#10005;
			</button>
		</div>

		<!-- Cross-pane match indicator (SC-11) -->
		<div
			v-if="matchPane && scope === 'all'"
			class="search-overlay__match-pane"
		>
			Match in: {{ matchPane }}
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import type { SearchHistoryEntry } from "../composables/useSearchHistory.js";
import type { SearchOptions } from "../composables/useTerminalSearch.js";
import type { SearchScope } from "../composables/useMultiPaneSearch.js";

// ---------------------------------------------------------------------------
// Props + emits
// ---------------------------------------------------------------------------

const props = withDefaults(
	defineProps<{
		isOpen: boolean;
		matchCount: number;
		currentMatch: number;
		regexError: string | null;
		query: string;
		options: SearchOptions;
		position?: "top-right" | "bottom-right" | "bottom-bar";
		/** Show scope toggle when tab has multiple panes (SC-12). */
		showScopeToggle?: boolean;
		/** Current search scope. */
		scope?: SearchScope;
		/** Name of the pane where the current match is (cross-pane indicator). */
		matchPane?: string | null;
		/** Search history entries for dropdown (SC-15). */
		history?: SearchHistoryEntry[];
	}>(),
	{
		position: "top-right",
		showScopeToggle: false,
		scope: "pane",
		matchPane: null,
		history: () => [],
	},
);

const emit = defineEmits<{
	(e: "search", query: string): void;
	(e: "find-next"): void;
	(e: "find-previous"): void;
	(e: "close"): void;
	(e: "update:options", options: SearchOptions): void;
	(e: "update:scope", scope: SearchScope): void;
	(e: "select-history", entry: SearchHistoryEntry): void;
	(e: "add-to-history", query: string, regex: boolean): void;
}>();

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

const inputRef = ref<HTMLInputElement | null>(null);
const inputFocused = ref(false);

/** Show history dropdown when input is focused, empty, and history exists. */
const showHistoryDropdown = computed(
	() => inputFocused.value && !props.query && props.history.length > 0,
);

// ---------------------------------------------------------------------------
// Auto-focus when opened
// ---------------------------------------------------------------------------

watch(
	() => props.isOpen,
	async (open) => {
		if (open) {
			await nextTick();
			inputRef.value?.focus();
			inputRef.value?.select();
		}
	},
);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function onInput(event: Event): void {
	const value = (event.target as HTMLInputElement).value;
	emit("search", value);
}

function onEnter(): void {
	if (props.query) {
		emit("add-to-history", props.query, props.options.regex);
	}
	emit("find-next");
}

function onShiftEnter(): void {
	if (props.query) {
		emit("add-to-history", props.query, props.options.regex);
	}
	emit("find-previous");
}

function onInputBlur(): void {
	inputFocused.value = false;
}

function onSelectHistory(entry: SearchHistoryEntry): void {
	emit("select-history", entry);
	inputFocused.value = false;
}

function toggleOption(key: keyof SearchOptions): void {
	emit("update:options", {
		...props.options,
		[key]: !props.options[key],
	});
}
</script>

<style scoped>
/* ------------------------------------------------------------------ */
/* Base overlay                                                        */
/* ------------------------------------------------------------------ */

.search-overlay {
	position: absolute;
	z-index: 10;
	background: var(--nt-tab-bar);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	box-shadow: var(--nt-shadow);
	padding: 4px 6px;
	font-size: 12px;
	font-family: inherit;
}

/* ------------------------------------------------------------------ */
/* Position variants                                                   */
/* ------------------------------------------------------------------ */

.search-overlay--top-right {
	top: 4px;
	right: 20px;
}

.search-overlay--bottom-right {
	bottom: 4px;
	right: 20px;
}

.search-overlay--bottom-bar {
	position: sticky;
	bottom: 0;
	left: 0;
	right: 0;
	width: 100%;
	border-radius: 0;
	border-left: none;
	border-right: none;
	border-bottom: none;
}

/* ------------------------------------------------------------------ */
/* Input row layout                                                    */
/* ------------------------------------------------------------------ */

.search-overlay__input-row {
	display: flex;
	align-items: center;
	gap: 4px;
}

.search-overlay__input-wrapper {
	position: relative;
	flex: 1;
	min-width: 160px;
}

.search-overlay__input {
	width: 100%;
	padding: 3px 6px;
	font-size: 12px;
	font-family: inherit;
	color: var(--nt-fg);
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 3px;
	outline: none;
	box-sizing: border-box;
}

.search-overlay__input:focus {
	border-color: var(--nt-accent);
}

.search-overlay__input--error {
	border-color: var(--nt-badge);
}

/* ------------------------------------------------------------------ */
/* Regex error tooltip                                                 */
/* ------------------------------------------------------------------ */

.search-overlay__regex-error {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	margin-top: 2px;
	padding: 3px 6px;
	font-size: 11px;
	color: var(--nt-badge);
	background: var(--nt-tab-bar);
	border: 1px solid var(--nt-badge);
	border-radius: 3px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	z-index: 11;
}

/* ------------------------------------------------------------------ */
/* Match count                                                         */
/* ------------------------------------------------------------------ */

.search-overlay__match-count {
	color: var(--nt-text-muted);
	font-size: 11px;
	min-width: 36px;
	text-align: center;
	flex-shrink: 0;
	user-select: none;
}

/* ------------------------------------------------------------------ */
/* Cross-pane match indicator                                          */
/* ------------------------------------------------------------------ */

.search-overlay__match-pane {
	padding: 2px 6px;
	font-size: 10px;
	color: var(--nt-accent);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* ------------------------------------------------------------------ */
/* Buttons: nav + close                                                */
/* ------------------------------------------------------------------ */

.search-overlay__btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	padding: 0;
	background: none;
	border: none;
	border-radius: 3px;
	color: var(--nt-text-muted);
	font-size: 10px;
	cursor: pointer;
	flex-shrink: 0;
	transition: color 0.1s, background 0.1s;
}

.search-overlay__btn:hover:not(:disabled) {
	color: var(--nt-fg);
	background: var(--nt-tab-hover);
}

.search-overlay__btn:disabled {
	opacity: 0.35;
	cursor: default;
}

.search-overlay__btn--close {
	font-size: 12px;
}

/* ------------------------------------------------------------------ */
/* Toggle buttons: Aa, .*, W, scope                                    */
/* ------------------------------------------------------------------ */

.search-overlay__toggle {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 22px;
	height: 22px;
	padding: 0 3px;
	background: none;
	border: 1px solid transparent;
	border-radius: 3px;
	color: var(--nt-text-muted);
	font-size: 11px;
	font-weight: 600;
	font-family: inherit;
	cursor: pointer;
	flex-shrink: 0;
	transition: color 0.1s, background 0.1s, border-color 0.1s;
}

.search-overlay__toggle:hover {
	color: var(--nt-fg);
	background: var(--nt-tab-hover);
}

.search-overlay__toggle--active {
	color: var(--nt-accent);
	border-color: var(--nt-accent);
	background: rgba(var(--nt-accent-rgb), 0.1);
}

/* ------------------------------------------------------------------ */
/* Separator                                                           */
/* ------------------------------------------------------------------ */

.search-overlay__separator {
	width: 1px;
	height: 16px;
	background: var(--nt-border);
	flex-shrink: 0;
}

/* ------------------------------------------------------------------ */
/* History dropdown (SC-15)                                            */
/* ------------------------------------------------------------------ */

.search-overlay__history {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	margin-top: 2px;
	max-height: 200px;
	overflow-y: auto;
	background: var(--nt-tab-bar);
	border: 1px solid var(--nt-border);
	border-radius: 3px;
	box-shadow: var(--nt-shadow);
	z-index: 12;
}

.search-overlay__history-item {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 4px 6px;
	background: none;
	border: none;
	color: var(--nt-fg);
	font-size: 11px;
	font-family: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.1s;
}

.search-overlay__history-item:hover {
	background: var(--nt-tab-hover);
}

.search-overlay__history-query {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.search-overlay__history-badge {
	flex-shrink: 0;
	font-size: 9px;
	font-weight: 700;
	color: var(--nt-accent);
	padding: 0 3px;
	border: 1px solid var(--nt-accent);
	border-radius: 2px;
	line-height: 1.4;
}
</style>
