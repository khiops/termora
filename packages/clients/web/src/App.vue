<template>
	<div class="app-root" @keydown="onGlobalKeydown">
		<!-- Write-request dialog — rendered globally, outside layout, via Teleport -->
		<WriteRequestDialog />

		<!-- Command Palette — Teleport to body, triggered by Ctrl+P / Cmd+P -->
		<CommandPalette />

		<!-- Pairing overlay — shown when no token yet, or AUTH_FAIL -->
		<PairingScreen
			v-if="needsPairing"
			@authenticated="onAuthenticated"
		/>

		<!-- Main layout — only shown when authenticated and WS ready -->
		<div v-else class="app-layout">
			<HostRail class="host-rail" />
			<ChannelSidebar class="channel-sidebar" />

			<!-- Terminal main: tab bar + recursive pane layout -->
			<div class="terminal-main">
				<TabBar
					:tabs="layout.tabs.value"
					:active-tab-index="layout.activeTabIndex.value"
					@select-tab="layout.setActiveTab"
					@close-tab="layout.closeTab"
					@add-tab="onAddTab"
				/>
				<div class="pane-area">
					<!-- First-run welcome banner: shown while auto-spawning the first terminal -->
					<div v-if="showWelcome" class="pane-welcome">
						<div class="pane-welcome-content">
							<div class="pane-welcome-title">Welcome to nexterm!</div>
							<div class="pane-welcome-subtitle">Your local terminal is ready. Opening it now…</div>
						</div>
					</div>
					<PaneLayout
						v-else-if="layout.layout.value !== null"
						:node="layout.layout.value"
						@split="onSplit"
						@close-pane="onClosePane"
						@update-ratio="layout.updateRatio"
					/>
					<div v-else class="pane-empty">
						Select a channel or click + to open a terminal.
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "./stores/auth.js";
import { useSessionStore } from "./stores/session.js";
import { useHostsStore } from "./stores/hosts.js";
import { useChannelsStore } from "./stores/channels.js";
import { useLayout } from "./composables/useLayout.js";
import { useCommandPalette } from "./composables/useCommandPalette.js";
import { generateId } from "@nexterm/shared";
import HostRail from "./components/HostRail.vue";
import ChannelSidebar from "./components/ChannelSidebar.vue";
import TabBar from "./components/TabBar.vue";
import PaneLayout from "./components/PaneLayout.vue";
import PairingScreen from "./components/PairingScreen.vue";
import WriteRequestDialog from "./components/WriteRequestDialog.vue";
import CommandPalette from "./components/CommandPalette.vue";

const authStore = useAuthStore();
const sessionStore = useSessionStore();
const hostsStore = useHostsStore();
const channelsStore = useChannelsStore();
const layout = useLayout();
const commandPalette = useCommandPalette();

/**
 * Show pairing screen when:
 * - No token stored in localStorage, OR
 * - The hub responded AUTH_FAIL (token revoked / rotated on server)
 */
const needsPairing = computed(
	() => authStore.token === null || sessionStore.authFailed,
);

/**
 * First-run welcome banner: shown while we auto-spawn the initial terminal.
 * Cleared once the channel is open or if channels already exist.
 */
const showWelcome = ref(false);

/**
 * When the selected host changes, fetch the channel list for that host.
 * This is the primary trigger for populating the ChannelSidebar.
 * On first run (no existing channels), auto-spawn a local terminal.
 */
watch(
	() => hostsStore.selectedHostId,
	async (hostId) => {
		if (hostId === null) return;
		await channelsStore.fetchChannels(hostId);
		// First-run: if no channels exist after the first fetch, auto-spawn one
		if (channelsStore.channels.length === 0 && layout.tabs.value.length === 0) {
			showWelcome.value = true;
			try {
				await channelsStore.spawnChannel(hostId);
			} catch (err) {
				console.error("[App] first-run auto-spawn failed:", err);
			} finally {
				showWelcome.value = false;
			}
		}
	},
	{ immediate: true },
);

/**
 * Route CHANNEL_STATE WebSocket messages to the channels store so that
 * status changes (live → orphan → dead) are reflected in real time.
 */
watch(
	() => sessionStore.authenticated,
	(authed) => {
		if (!authed) return;
		sessionStore.wsClient.on("CHANNEL_STATE", (msg) => {
			if (msg.type === "CHANNEL_STATE") {
				channelsStore.updateChannelStatus(msg.channelId, msg.status, msg.exitCode);
			}
		});
	},
	{ immediate: true },
);

/**
 * When a channel is selected in the sidebar, open (or switch to) its tab.
 */
watch(
	() => channelsStore.selectedChannelId,
	(channelId) => {
		if (channelId === null) return;
		const channel = channelsStore.channels.find((c) => c.id === channelId);
		const label = channel?.title ?? `Terminal ${channelId.slice(-8)}`;
		layout.openTab(channelId, label);
	},
);

/**
 * Global keydown handler attached to the app root.
 * Intercepts Ctrl+P (Windows/Linux) and Cmd+P (macOS) to toggle the palette.
 */
function onGlobalKeydown(event: KeyboardEvent): void {
	const isP = event.key === "p" || event.key === "P";
	const modifier = event.ctrlKey || event.metaKey;
	if (isP && modifier) {
		event.preventDefault();
		commandPalette.toggle();
	}
}

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

/**
 * "+" button in the tab bar: spawn a new channel on the active host.
 */
async function onAddTab(): Promise<void> {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;
	try {
		await channelsStore.spawnChannel(hostId);
		// spawnChannel calls selectChannel internally, which triggers the
		// watch above to openTab.
	} catch (err) {
		console.error("[App] spawn for new tab failed:", err);
	}
}

/**
 * Split a pane. We generate a new channelId for the new pane, then
 * call spawnChannel so the hub creates the backing channel. Once SPAWN_OK
 * arrives, the tab/pane layout is already set; we wire the new channelId.
 */
async function onSplit(
	existingChannelId: string,
	direction: "horizontal" | "vertical",
): Promise<void> {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;

	// Optimistically pre-allocate an ID for the new pane before spawning
	// so we can insert it in the layout immediately. The real SPAWN_OK will
	// arrive and addChannel will register it in the store.
	const tempId = generateId();
	const tempLabel = `Terminal ${tempId.slice(-8)}`;

	layout.splitPane(existingChannelId, direction, tempId, tempLabel);

	try {
		// Spawn the real channel; the SPAWN_OK will call addChannel + selectChannel
		const realId = await channelsStore.spawnChannel(hostId);

		// If the real ID differs from our temp ID, patch the layout tree
		if (realId !== tempId) {
			// Find the temp node in the layout and replace it with the real ID.
			// The simplest way: re-run unsplitPane on tempId then split again,
			// but that would reset the ratio. Instead we do an in-place tree walk
			// by updating via the store directly.
			//
			// For simplicity we close the temp pane and re-split with the real ID.
			// The terminal that was spawned will attach when PaneLayout renders it.
			layout.unsplitPane(tempId);
			layout.splitPane(existingChannelId, direction, realId, `Terminal ${realId.slice(-8)}`);
		}
	} catch (err) {
		// If spawn fails, remove the optimistic pane
		layout.unsplitPane(tempId);
		console.error("[App] split spawn failed:", err);
	}
}

/**
 * Close a single pane (not the whole tab). If the pane is the last one in
 * the tab, close the tab entirely.
 */
function onClosePane(channelId: string): void {
	const activeTab = layout.activeTab.value;
	if (activeTab === null) return;

	if (activeTab.channelId === channelId) {
		// Closing the root pane of the tab → close the whole tab
		const idx = layout.tabs.value.findIndex((t) => t.channelId === channelId);
		if (idx !== -1) layout.closeTab(idx);
	} else {
		// Closing a split pane → collapse the split
		layout.unsplitPane(channelId);
	}

	channelsStore.updateChannelStatus(channelId, "dead");
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
	grid-template-columns: 48px 200px 1fr;
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
	display: flex;
	flex-direction: column;
}

.pane-area {
	flex: 1;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.pane-empty {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #45475a;
	font-size: 13px;
	font-style: italic;
}

.pane-welcome {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #1e1e2e;
}

.pane-welcome-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
}

.pane-welcome-title {
	color: #cdd6f4;
	font-size: 18px;
	font-weight: 600;
}

.pane-welcome-subtitle {
	color: #6c7086;
	font-size: 13px;
}
</style>
