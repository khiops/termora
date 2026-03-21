
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useLogs } from "../composables/useLogs.js";

const props = defineProps<{
	/** Channel ID to show logs for. If absent, shows hub logs. */
	channelId?: string;
}>();

const LEVELS = ["trace", "debug", "info", "warn", "error"] as const;

const levelFilter = ref<string>("info");
const searchText = ref<string>("");

const { entries, total, loading, error, fetch: fetchLogs, loadMore } = useLogs({
	channelId: props.channelId,
});

// ── Debounce ─────────────────────────────────────────────────────────────────

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefetch(): void {
	if (_debounceTimer !== null) clearTimeout(_debounceTimer);
	_debounceTimer = setTimeout(() => {
		_debounceTimer = null;
		fetchLogs({
			level: levelFilter.value || undefined,
			search: searchText.value || undefined,
		});
	}, 300);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
	fetchLogs({ level: levelFilter.value });
});

onUnmounted(() => {
	if (_debounceTimer !== null) clearTimeout(_debounceTimer);
});

watch([levelFilter, searchText], () => {
	scheduleRefetch();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(entry: { t?: number; ts?: string }): string {
	if (entry.t != null) return `${entry.t}ms`;
	if (entry.ts) return entry.ts.substring(11, 23);
	return "";
}
</script>

<template>
	<div class="log-viewer">
		<!-- Toolbar -->
		<div class="log-toolbar">
			<div class="log-level-filters">
				<button
					v-for="lvl in LEVELS"
					:key="lvl"
					:class="['log-level-chip', { active: levelFilter === lvl }]"
					@click="levelFilter = lvl"
				>
					{{ lvl }}
				</button>
			</div>
			<input
				v-model="searchText"
				type="text"
				placeholder="Search logs..."
				class="log-search-input"
				aria-label="Search logs"
			/>
		</div>

		<!-- Log entries -->
		<div class="log-entries">
			<div v-if="loading && entries.length === 0" class="log-loading">Loading…</div>
			<div v-else-if="error" class="log-error">{{ error }}</div>
			<div v-else-if="entries.length === 0" class="log-empty">No log entries</div>
			<template v-else>
				<div
					v-for="(entry, i) in entries"
					:key="i"
					class="log-entry"
					:class="`log-level-${entry.lvl}`"
				>
					<span class="log-time">{{ formatTime(entry) }}</span>
					<span
						v-if="entry.src"
						class="log-src"
						:class="`log-src-${entry.src}`"
					>{{ entry.src }}</span>
					<span class="log-lvl">{{ entry.lvl }}</span>
					<span class="log-msg">{{ entry.msg }}</span>
				</div>
			</template>
		</div>

		<!-- Load more -->
		<div v-if="entries.length > 0 && entries.length < total" class="log-load-more">
			<button :disabled="loading" @click="loadMore">
				Load more ({{ entries.length }}/{{ total }})
			</button>
		</div>
	</div>
</template>

<style scoped>
.log-viewer {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--nt-bg, #1e1e2e);
	color: var(--nt-fg, #cdd6f4);
	font-family: var(--nt-font-family, monospace);
	font-size: 12px;
}

/* ── Toolbar ──────────────────────────────────────────────────────────────── */

.log-toolbar {
	display: flex;
	gap: 8px;
	padding: 8px;
	border-bottom: 1px solid var(--nt-border, #313244);
	flex-shrink: 0;
	align-items: center;
}

.log-level-filters {
	display: flex;
	gap: 4px;
}

.log-level-chip {
	padding: 2px 8px;
	border-radius: 4px;
	border: 1px solid var(--nt-border, #313244);
	background: transparent;
	color: var(--nt-fg-muted, #a6adc8);
	cursor: pointer;
	font-size: 11px;
	transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.log-level-chip:hover {
	border-color: var(--nt-accent, #89b4fa);
	color: var(--nt-fg, #cdd6f4);
}

.log-level-chip.active {
	background: var(--nt-accent, #89b4fa);
	color: var(--nt-bg, #1e1e2e);
	border-color: var(--nt-accent, #89b4fa);
}

.log-search-input {
	flex: 1;
	padding: 4px 8px;
	border: 1px solid var(--nt-border, #313244);
	border-radius: 4px;
	background: var(--nt-bg-surface, #181825);
	color: var(--nt-fg, #cdd6f4);
	font-size: 12px;
	outline: none;
}

.log-search-input:focus {
	border-color: var(--nt-accent, #89b4fa);
}

/* ── Entries ──────────────────────────────────────────────────────────────── */

.log-entries {
	flex: 1;
	overflow-y: auto;
	padding: 4px 8px;
}

.log-entry {
	display: flex;
	gap: 8px;
	padding: 2px 0;
	line-height: 1.4;
	border-bottom: 1px solid color-mix(in srgb, var(--nt-border, #313244) 25%, transparent);
}

.log-time {
	color: var(--nt-fg-muted, #a6adc8);
	min-width: 80px;
	flex-shrink: 0;
}

.log-src {
	min-width: 40px;
	flex-shrink: 0;
	font-weight: 600;
}

.log-src-hub { color: var(--nt-accent, #89b4fa); }
.log-src-agent { color: #a6e3a1; }

.log-lvl {
	min-width: 40px;
	flex-shrink: 0;
	text-transform: uppercase;
	font-weight: 600;
}

.log-msg {
	flex: 1;
	word-break: break-word;
}

/* Level colour overrides — only the row text that doesn't have its own colour */
.log-level-error .log-lvl,
.log-level-error .log-msg { color: #f38ba8; }

.log-level-warn .log-lvl,
.log-level-warn .log-msg { color: #fab387; }

.log-level-debug .log-lvl,
.log-level-debug .log-msg { color: var(--nt-fg-muted, #a6adc8); }

.log-level-trace .log-lvl,
.log-level-trace .log-msg { color: var(--nt-fg-muted, #6c7086); }

/* ── Status messages ─────────────────────────────────────────────────────── */

.log-empty,
.log-loading,
.log-error {
	padding: 16px;
	text-align: center;
	color: var(--nt-fg-muted, #a6adc8);
}

.log-error { color: #f38ba8; }

/* ── Load more ───────────────────────────────────────────────────────────── */

.log-load-more {
	padding: 8px;
	text-align: center;
	border-top: 1px solid var(--nt-border, #313244);
	flex-shrink: 0;
}

.log-load-more button {
	padding: 4px 16px;
	border: 1px solid var(--nt-border, #313244);
	border-radius: 4px;
	background: var(--nt-bg-surface, #181825);
	color: var(--nt-fg, #cdd6f4);
	cursor: pointer;
	font-size: 12px;
	transition: border-color 0.1s;
}

.log-load-more button:hover:not(:disabled) {
	border-color: var(--nt-accent, #89b4fa);
}

.log-load-more button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
