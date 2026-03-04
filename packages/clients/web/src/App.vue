<template>
	<div class="app-root">
		<!-- Write-request dialog — rendered globally, outside layout, via Teleport -->
		<WriteRequestDialog />

		<!-- Pairing overlay — shown when no token yet, or AUTH_FAIL -->
		<PairingScreen
			v-if="needsPairing"
			@authenticated="onAuthenticated"
		/>

		<!-- Main layout — only shown when authenticated and WS ready -->
		<div v-else class="app-layout">
			<HostRail class="host-rail" />
			<ChannelSidebar class="channel-sidebar" />
			<TerminalPane class="terminal-main" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "./stores/auth.js";
import { useSessionStore } from "./stores/session.js";
import HostRail from "./components/HostRail.vue";
import ChannelSidebar from "./components/ChannelSidebar.vue";
import TerminalPane from "./components/TerminalPane.vue";
import PairingScreen from "./components/PairingScreen.vue";
import WriteRequestDialog from "./components/WriteRequestDialog.vue";

const authStore = useAuthStore();
const sessionStore = useSessionStore();

/**
 * Show pairing screen when:
 * - No token stored in localStorage, OR
 * - The hub responded AUTH_FAIL (token revoked / rotated on server)
 */
const needsPairing = computed(
	() => authStore.token === null || sessionStore.authFailed,
);

/**
 * Called by PairingScreen when it has obtained a new token and
 * successfully completed WS AUTH. We just clear authFailed —
 * the session store will already be authenticated.
 */
function onAuthenticated(): void {
	// sessionStore.authFailed is reset inside connect() on AUTH_OK,
	// so no explicit action needed here — the computed will flip.
	// Force a reactive refresh by reading sessionStore.authenticated.
	void sessionStore.authenticated;
}
</script>

<style>
/* Global reset — applied to document root */
*,
*::before,
*::after {
	box-sizing: border-box;
}

html,
body,
#app {
	margin: 0;
	padding: 0;
	height: 100%;
	overflow: hidden;
	font-family: system-ui, -apple-system, sans-serif;
	font-size: 13px;
}

.app-root {
	height: 100%;
}

.app-layout {
	display: grid;
	grid-template-columns: 56px 200px 1fr;
	height: 100vh;
	background: #1e1e2e;
	color: #cdd6f4;
}

.host-rail {
	background: #181825;
}

.channel-sidebar {
	background: #1e1e2e;
	border-right: 1px solid #313244;
}

.terminal-main {
	overflow: hidden;
}
</style>
