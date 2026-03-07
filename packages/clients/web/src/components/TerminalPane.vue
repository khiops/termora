<template>
	<div class="terminal-pane" @contextmenu.prevent="showContextMenu">
		<!-- Pane header — always rendered so fitAddon.fit() calculates correct rows -->
		<div class="pane-header">
			<span class="pane-title">{{ paneTitle }}</span>
			<WriteLockIndicator :channel-id="effectiveChannelId" :is-dead="isDead" class="pane-lock" />
			<span v-if="isDead" class="dead-badge" title="Channel has exited">
				Closed
			</span>
			<span
				v-else-if="effectiveChannelId && !isWriter"
				class="readonly-badge"
				title="You are in read-only mode"
			>
				Read-only
			</span>
		</div>

		<div v-if="error" class="terminal-error">
			<span>{{ error }}</span>
		</div>
		<div v-else-if="!ready" class="terminal-loading">
			<span>Connecting…</span>
		</div>
		<div ref="terminalContainer" class="terminal-container" />

		<!-- Reconnecting overlay — shown when WS drops after terminal was initialized -->
		<div v-if="ready && !sessionStore.connected" class="reconnecting-overlay">
			<span class="reconnecting-text">Reconnecting<span class="reconnecting-dots" /></span>
		</div>

		<!-- Context menu -->
		<div
			v-if="contextMenuVisible"
			class="context-menu"
			:style="{ top: `${contextMenuY}px`, left: `${contextMenuX}px` }"
			@mouseleave="contextMenuVisible = false"
		>
			<button class="context-menu__item" @click="onSplitRight">Split Right</button>
			<button class="context-menu__item" @click="onSplitDown">Split Down</button>
			<hr class="context-menu__divider" />
			<button class="context-menu__item context-menu__item--danger" @click="onClosePane">
				Close Pane
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { DEFAULT_CHANNEL_NAME } from "@nexterm/shared";
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { useSessionStore } from "../stores/session.js";
import { useChannelsStore } from "../stores/channels.js";
import { useWriteLockStore } from "../stores/writelock.js";
import { useConfigStore } from "../stores/config.js";
import { useTerminal } from "../composables/useTerminal.js";
import WriteLockIndicator from "./WriteLockIndicator.vue";

// ---------------------------------------------------------------------------
// Props + emits
// ---------------------------------------------------------------------------

const props = withDefaults(
	defineProps<{
		/**
		 * If provided, this pane manages an already-spawned channel (e.g. when
		 * routed from a tab or split). If null/undefined, the pane spawns its
		 * own channel on mount (legacy single-pane behaviour).
		 */
		channelId?: string | null;
	}>(),
	{ channelId: null },
);

const emit = defineEmits<{
	(e: "split-right", channelId: string): void;
	(e: "split-down", channelId: string): void;
	(e: "close-pane", channelId: string): void;
	(e: "channel-spawned", tempId: string, realId: string): void;
}>();

// ---------------------------------------------------------------------------
// Stores + terminal composable
// ---------------------------------------------------------------------------

const sessionStore = useSessionStore();
const channelsStore = useChannelsStore();
const writeLockStore = useWriteLockStore();
const configStore = useConfigStore();
const terminalContainer = ref<HTMLElement | null>(null);
const ready = ref(false);
const error = ref<string | null>(null);

const { init, attachChannel, reattachChannel, applyProfile, suppressNextResize, dispose, canWrite } = useTerminal(
	terminalContainer,
	sessionStore.wsClient,
	configStore.profile,
);

/**
 * The channel this pane is currently showing. When channelId prop is set,
 * we use that; otherwise we fall back to the channel we spawned internally.
 */
const internalChannelId = ref<string | null>(null);

const effectiveChannelId = computed<string | null>(
	() => props.channelId ?? internalChannelId.value,
);

const paneTitle = computed(() => {
	const ch = effectiveChannelId.value;
	if (ch === null) return DEFAULT_CHANNEL_NAME;
	const channel = channelsStore.channels.find((c) => c.id === ch);
	return channel?.title ?? DEFAULT_CHANNEL_NAME;
});

// ---------------------------------------------------------------------------
// Write-lock awareness
// ---------------------------------------------------------------------------

const isWriter = computed(() => {
	const chId = effectiveChannelId.value;
	return chId ? writeLockStore.isWriter(chId) : false;
});

watch(
	isWriter,
	(writerNow) => {
		canWrite.value = writerNow;
	},
	{ immediate: true },
);

// ---------------------------------------------------------------------------
// Dead-channel awareness
// ---------------------------------------------------------------------------

const isDead = computed(() => {
	const chId = effectiveChannelId.value;
	if (!chId) return false;
	const channel = channelsStore.channels.find((c) => c.id === chId);
	return channel?.status === "dead";
});

watch(isDead, (dead) => {
	if (dead) canWrite.value = false;
});

// ---------------------------------------------------------------------------
// Lifecycle: init terminal + attach/reattach channel
// ---------------------------------------------------------------------------

onMounted(async () => {
	try {
		await sessionStore.connect();

		const { cols, rows } = init();

		if (props.channelId !== null && props.channelId !== undefined) {
			// Check if this is a pending spawn (temp ID created by App.vue)
			const hostId = channelsStore.consumePendingSpawn(props.channelId);

			if (hostId !== null) {
				// Fresh spawn — PTY is created with actual terminal dimensions
				// so no RESIZE is needed → no SIGWINCH → no duplicate prompt
				const realId = await channelsStore.spawnChannel(hostId, {
					cols,
					rows,
					select: false,
				});
				internalChannelId.value = realId;
				// PTY was spawned at exact terminal dims — suppress the RESIZE
				// that attachChannel would otherwise send (prevents SIGWINCH)
				suppressNextResize();
				attachChannel(realId);
				emit("channel-spawned", props.channelId, realId);
			} else {
				// Existing channel — reattach (fetch snapshot + tail).
				// Write-lock state is set by the WRITE_LOCK WS message handler
				// (fired by WriteLockManager.attach on the hub side), not from
				// the ATTACH_OK payload — avoids a microtask race where
				// setInitialHolder would overwrite a more recent WRITE_LOCK.
				await reattachChannel(props.channelId);
			}
			ready.value = true;
			applyProfile(configStore.profile);
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
		console.error("[TerminalPane] Initialization failed:", err);
	}
});

// Re-attach when the channelId prop changes (e.g. pane reuse after tab switch).
// Skip when the new ID matches internalChannelId (happens after pending spawn
// resolution — replaceChannelId updates the prop from tempId to realId but
// the channel is already attached).
watch(
	() => props.channelId,
	async (newId) => {
		if (newId !== null && newId !== undefined && ready.value) {
			if (newId === internalChannelId.value) return;
			try {
				error.value = null;
				await reattachChannel(newId);
			} catch (err) {
				error.value = err instanceof Error ? err.message : String(err);
			}
		}
	},
);

// Re-attach terminal channels after hub reconnect (session persistence).
// When the hub restarts, WS auto-reconnects and session store increments
// reconnectCount. Each pane then re-attaches its channel to restore the
// snapshot from spool.db + connect to the new PTY output stream.
watch(
	() => sessionStore.reconnectCount,
	async () => {
		if (effectiveChannelId.value && ready.value) {
			try {
				error.value = null;
				await reattachChannel(effectiveChannelId.value);
			} catch (err) {
				error.value = err instanceof Error ? err.message : String(err);
			}
		}
	},
);

// Re-apply profile when config store updates (covers initial load + reconnect reload).
// loadProfile() runs async — terminal may already be initialized with DEFAULT_PROFILE.
watch(
	() => configStore.profile,
	(p) => {
		applyProfile(p);
	},
	{ deep: true },
);

onUnmounted(() => {
	dispose();
});

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

function showContextMenu(event: MouseEvent): void {
	contextMenuX.value = event.offsetX;
	contextMenuY.value = event.offsetY;
	contextMenuVisible.value = true;
}

function onSplitRight(): void {
	contextMenuVisible.value = false;
	const chId = effectiveChannelId.value;
	if (chId !== null) emit("split-right", chId);
}

function onSplitDown(): void {
	contextMenuVisible.value = false;
	const chId = effectiveChannelId.value;
	if (chId !== null) emit("split-down", chId);
}

function onClosePane(): void {
	contextMenuVisible.value = false;
	const chId = effectiveChannelId.value;
	if (chId !== null) emit("close-pane", chId);
}

// Dismiss context menu on any outside click
function onDocumentClick(): void {
	contextMenuVisible.value = false;
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<style scoped>
.terminal-pane {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.pane-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 10px;
	background: var(--nt-tab-bar);
	border-bottom: 1px solid var(--nt-border);
	flex-shrink: 0;
	min-height: 28px;
}

.pane-title {
	font-size: 11px;
	font-weight: 600;
	color: var(--nt-text-secondary);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	flex: 1;
}

.pane-lock {
	flex-shrink: 0;
}

.readonly-badge {
	font-size: 10px;
	font-weight: 600;
	color: var(--nt-yellow);
	background: rgba(var(--nt-yellow-rgb), 0.12);
	border: 1px solid rgba(var(--nt-yellow-rgb), 0.3);
	border-radius: 3px;
	padding: 1px 6px;
	letter-spacing: 0.04em;
	flex-shrink: 0;
}

.dead-badge {
	font-size: 10px;
	font-weight: 600;
	color: var(--nt-text-muted);
	background: rgba(var(--nt-fg-rgb), 0.12);
	border: 1px solid rgba(var(--nt-fg-rgb), 0.3);
	border-radius: 3px;
	padding: 1px 6px;
	letter-spacing: 0.04em;
	flex-shrink: 0;
}

.terminal-container {
	flex: 1;
	overflow: hidden;
	background: rgba(var(--nt-bg-rgb), var(--nt-terminal-alpha));
}

.terminal-loading,
.terminal-error {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 13px;
	color: var(--nt-text-secondary);
	pointer-events: none;
	z-index: 1;
}

.terminal-error {
	color: var(--nt-badge);
}

/* Context menu */
.context-menu {
	position: absolute;
	background: var(--nt-bg);
	border: 1px solid var(--nt-tab-hover);
	border-radius: 6px;
	padding: 4px 0;
	min-width: 140px;
	z-index: 100;
	box-shadow: var(--nt-shadow);
}

.context-menu__item {
	display: block;
	width: 100%;
	padding: 6px 12px;
	background: none;
	border: none;
	color: var(--nt-fg);
	font-size: 12px;
	font-family: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.1s;
}

.context-menu__item:hover {
	background: var(--nt-border);
}

.context-menu__item--danger {
	color: var(--nt-badge);
}

.context-menu__divider {
	border: none;
	border-top: 1px solid var(--nt-border);
	margin: 4px 0;
}

/* Reconnecting overlay */
.reconnecting-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--nt-overlay-heavy);
	z-index: 10;
	pointer-events: none;
}

.reconnecting-text {
	color: var(--nt-fg);
	font-size: 14px;
	font-weight: 500;
}

.reconnecting-dots::after {
	content: "";
	animation: dots 1.4s steps(4, end) infinite;
}

@keyframes dots {
	0% {
		content: "";
	}
	25% {
		content: ".";
	}
	50% {
		content: "..";
	}
	75% {
		content: "...";
	}
}
</style>
