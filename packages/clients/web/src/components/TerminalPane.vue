<template>
	<div class="terminal-pane">
		<div v-if="error" class="terminal-error">
			<span>{{ error }}</span>
		</div>
		<div v-else-if="!ready" class="terminal-loading">
			<span>Connecting...</span>
		</div>
		<div ref="terminalContainer" class="terminal-container" />
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useSessionStore } from "../stores/session.js";
import { useTerminal } from "../composables/useTerminal.js";

const sessionStore = useSessionStore();
const terminalContainer = ref<HTMLElement | null>(null);
const ready = ref(false);
const error = ref<string | null>(null);

const { init, attachChannel, dispose } = useTerminal(
	terminalContainer,
	sessionStore.wsClient,
);

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
}

.terminal-container {
	width: 100%;
	height: 100%;
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
