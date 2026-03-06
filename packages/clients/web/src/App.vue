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
					:get-tab-label="layout.getTabLabel"
					@select-tab="layout.setActiveTab"
					@close-tab="layout.closeTab"
					@add-tab="onAddTab"
					@rename-tab="onRenameTab"
				/>
				<div class="pane-area">
					<div
						v-for="(tab, idx) in layout.tabs.value"
						:key="tab.channelId"
						v-show="idx === layout.activeTabIndex.value"
						class="pane-tab-container"
					>
						<PaneLayout
							v-if="layout.layouts.value[tab.channelId]"
							:node="layout.layouts.value[tab.channelId]!"
							@split="onSplit"
							@close-pane="onClosePane"
							@update-ratio="layout.updateRatio"
							@channel-spawned="onChannelSpawned"
						/>
					</div>
					<div v-if="layout.tabs.value.length === 0" class="pane-empty">
						Select a channel or click + to open a terminal.
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useAuthStore } from "./stores/auth.js";
import { useSessionStore } from "./stores/session.js";
import { useHostsStore } from "./stores/hosts.js";
import { useChannelsStore } from "./stores/channels.js";
import { useConfigStore } from "./stores/config.js";
import { purgeDeadTabs, useLayout } from "./composables/useLayout.js";
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
const configStore = useConfigStore();
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

/** Helper: open a tab backed by a pending spawn (TerminalPane handles the actual SPAWN). */
function openPendingTab(hostId: string): void {
	const tempId = generateId();
	channelsStore.registerPendingSpawn(tempId, hostId);
	layout.openTab(tempId, "Starting\u2026");
}

/**
 * On mount: if we have a token, connect the WebSocket and fetch hosts.
 */
onMounted(async () => {
	// Load fonts before terminals are created (no auth needed)
	await configStore.loadFonts();

	if (authStore.token !== null) {
		try {
			await sessionStore.connect();
			// Load resolved profile + UI behaviour config now that auth is established
			await configStore.loadProfile();
			await configStore.loadUiConfig();
			await hostsStore.fetchHosts();
		} catch (err) {
			console.error("[App] startup connect failed:", err);
		}
	}
});

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
		purgeDeadTabs(channelsStore.channels, layout.tabs.value, layout.closeTab);
		// Auto-spawn if no live channels exist (all dead after hub restart, or first run).
		// Opens a pending tab — TerminalPane handles the actual SPAWN with correct dimensions.
		const hasAliveChannels = channelsStore.channels.some((c) => c.status !== "dead");
		if (!hasAliveChannels && layout.tabs.value.length === 0) {
			openPendingTab(hostId);
		}
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
		// Allow dead channels — the hub will transparently respawn them on ATTACH.
		// Unknown channels (spawnChannel selects before fetchChannels resolves) also pass through.
		layout.openTab(channelId, layout.getTabLabel(channelId));
	},
);

/**
 * Reverse sync: when the active tab changes (e.g. user clicks a tab),
 * update the sidebar selection to match.
 */
watch(
	() => layout.activeTab.value,
	(tab) => {
		if (tab !== null && tab.channelId !== channelsStore.selectedChannelId) {
			channelsStore.selectChannel(tab.channelId);
		}
	},
);

/**
 * React to channels transitioning to "dead" in real-time.
 * - "close" mode: immediately close the tab.
 * - "readonly" mode: do nothing — the write-lock mechanism already
 *   prevents input and TerminalPane shows a "Closed" badge.
 */
watch(
	() => channelsStore.channels.map((c) => ({ id: c.id, status: c.status })),
	(current, previous) => {
		if (!previous) return;
		for (const ch of current) {
			if (ch.status !== "dead") continue;
			const prev = previous.find((p) => p.id === ch.id);
			if (prev && prev.status !== "dead") {
				// Channel just died
				if (configStore.uiConfig.onChannelDead === "close") {
					const idx = layout.tabs.value.findIndex((t) => t.channelId === ch.id);
					if (idx !== -1) layout.closeTab(idx);
				}
			}
		}
	},
	{ deep: true },
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
 * "+" button in the tab bar: open a pending tab whose TerminalPane
 * will handle the actual SPAWN with correct terminal dimensions.
 */
function onAddTab(): void {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;
	openPendingTab(hostId);
}

/**
 * Rename a tab (and its channel) via inline edit in the tab bar.
 */
function onRenameTab(channelId: string, title: string): void {
	channelsStore.renameChannel(channelId, title);
}

/**
 * Split a pane. Creates a pending-spawn pane in the split — TerminalPane
 * will handle the actual SPAWN with correct terminal dimensions.
 * onChannelSpawned then patches the layout with the real channelId.
 */
function onSplit(
	existingChannelId: string,
	direction: "horizontal" | "vertical",
): void {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;

	const tempId = generateId();
	channelsStore.registerPendingSpawn(tempId, hostId);
	layout.splitPane(existingChannelId, direction, tempId, "Starting\u2026");
}

/**
 * Called by PaneLayout when a TerminalPane completes a deferred spawn.
 * Patches the layout tree to replace the temp ID with the real channel ID,
 * then selects the new channel in the sidebar.
 */
function onChannelSpawned(tempId: string, realId: string): void {
	layout.replaceChannelId(tempId, realId);
	channelsStore.selectChannel(realId);
	// Refresh channel list so the new channel (after respawn) appears in the sidebar.
	if (channelsStore.activeHostId) {
		void channelsStore.fetchChannels(channelsStore.activeHostId);
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
	position: relative;
}

.pane-tab-container {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	position: absolute;
	inset: 0;
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

</style>
