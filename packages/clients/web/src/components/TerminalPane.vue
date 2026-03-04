<template>
	<div class="terminal-pane">
		<!-- Pane header with channel info and write-lock indicator -->
		<div v-if="ready" class="pane-header">
			<span class="pane-title">Terminal</span>
			<WriteLockIndicator :channel-id="sessionStore.currentChannelId" class="pane-lock" />
			<span
				v-if="sessionStore.currentChannelId && !isWriter"
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
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useSessionStore } from "../stores/session.js";
import { useWriteLockStore } from "../stores/writelock.js";
import { useTerminal } from "../composables/useTerminal.js";
import WriteLockIndicator from "./WriteLockIndicator.vue";

const sessionStore = useSessionStore();
const writeLockStore = useWriteLockStore();
const terminalContainer = ref<HTMLElement | null>(null);
const ready = ref(false);
const error = ref<string | null>(null);

const { init, attachChannel, dispose, canWrite } = useTerminal(
	terminalContainer,
	sessionStore.wsClient,
);

const isWriter = computed(() => {
	const chId = sessionStore.currentChannelId;
	return chId ? writeLockStore.isWriter(chId) : false;
});

// Sync write-lock state into the composable's canWrite gate.
watch(isWriter, (writerNow) => {
	canWrite.value = writerNow;
}, { immediate: true });

onMounted(async () => {
	try {
		await sessionStore.connect();
		const channelId = await sessionStore.spawnTerminal();

		// init() must happen after the container is in the DOM (onMounted guarantees this)
		init();
		attachChannel(channelId);
		ready.value = true;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
		console.error("[TerminalPane] Initialization failed:", err);
	}
});

onUnmounted(() => {
	dispose();
});
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
	background: #181825;
	border-bottom: 1px solid #313244;
	flex-shrink: 0;
	min-height: 28px;
}

.pane-title {
	font-size: 11px;
	font-weight: 600;
	color: #585b70;
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
	color: #f9e2af;
	background: rgba(249, 226, 175, 0.12);
	border: 1px solid rgba(249, 226, 175, 0.3);
	border-radius: 3px;
	padding: 1px 6px;
	letter-spacing: 0.04em;
	flex-shrink: 0;
}

.terminal-container {
	flex: 1;
	overflow: hidden;
}

.terminal-loading,
.terminal-error {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 13px;
	color: #585b70;
	pointer-events: none;
	z-index: 1;
}

.terminal-error {
	color: #f38ba8;
}
</style>
