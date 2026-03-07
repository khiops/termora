<template>
	<div class="app-root" @keydown="onGlobalKeydown">
		<!-- Write-request dialog — rendered globally, outside layout, via Teleport -->
		<WriteRequestDialog />

		<!-- Command Palette — Teleport to body, triggered by Ctrl+P / Cmd+P -->
		<CommandPalette />

		<!-- Appearance panel — rendered globally, outside layout, via Teleport -->
		<AppearancePanel :visible="showAppearance" @close="showAppearance = false" />

		<!-- Configure Command dialog — opened from tab context menu or exit overlay -->
		<ConfigureCommandDialog
			:visible="showConfigureDialog"
			:channel-id="configureChannelId"
			@close="showConfigureDialog = false"
			@applied="showConfigureDialog = false"
		/>

		<!-- Confirm dialog — used for Close All / Close Others confirmations -->
		<ConfirmDialog
			:visible="confirmDialog.visible"
			:title="confirmDialog.title"
			:message="confirmDialog.message"
			confirm-label="Close"
			:show-remember="true"
			@confirm="onConfirmAction"
			@cancel="confirmDialog.visible = false"
		/>

		<!-- Pairing overlay — shown when no token yet, or AUTH_FAIL -->
		<PairingScreen
			v-if="needsPairing"
			@authenticated="onAuthenticated"
		/>

		<!-- Main layout — only shown when authenticated and WS ready -->
		<div v-else class="app-layout">
			<HostRail class="host-rail" @toggle-appearance="showAppearance = !showAppearance" />
			<ChannelSidebar
			class="channel-sidebar"
			@select-channel="onSelectChannel"
			@open-new-tab="onSidebarOpenNewTab"
			@open-current-tab="onSidebarOpenCurrentTab"
			@configure-command="onConfigureCommand"
			@set-welcome="onSetWelcome"
		/>

			<!-- Terminal main: tab bar + recursive pane layout -->
			<div class="terminal-main">
				<TabBar
					:tabs="layout.tabs.value"
					:active-tab-index="layout.activeTabIndex.value"
					:get-tab-label="layout.getTabLabel"
					@select-tab="layout.setActiveTab"
					@close-tab="layout.closeTab"
					@close-others="onCloseOthers"
					@close-to-right="layout.closeToRight"
					@close-all="onCloseAll"
					@add-tab="onAddTab"
					@rename-tab="onRenameTab"
					@split="onSplit"
					@set-welcome="onSetWelcome"
					@move-to-new-tab="onMoveToNewTab"
				@configure-command="onConfigureCommand"
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
							:host-id="channelsStore.activeHostId"
							:tab-channel-id="tab.channelId"
							:has-multiple-panes="tabHasMultiplePanes(tab.channelId)"
							@split="onSplit"
							@close-pane="onClosePane"
							@update-ratio="layout.updateRatio"
							@channel-spawned="onChannelSpawned"
							@fill-vacant="onFillVacant"
							@new-terminal-vacant="onNewTerminalVacant"
							@rearrange-vacant="onRearrangeVacant"
							@drop-pane="onDropPane"
							@configure-command="onConfigureCommand"
							@search-all-panes="onSearchAllPanes"
							@find-next-all="onFindNextAll"
							@find-previous-all="onFindPreviousAll"
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
import { computed, onMounted, provide, ref, watch } from "vue";
import { DEFAULT_CHANNEL_NAME } from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { useAuthStore } from "./stores/auth.js";
import { useSessionStore } from "./stores/session.js";
import { useHostsStore } from "./stores/hosts.js";
import { useChannelsStore } from "./stores/channels.js";
import { useConfigStore } from "./stores/config.js";
import { useThemeStore } from "./stores/theme.js";
import { countPanes, purgeDeadTabs, useLayout } from "./composables/useLayout.js";
import type { DropZone } from "./composables/useLayout.js";
import { useCommandPalette } from "./composables/useCommandPalette.js";
import { useWindowTitle } from "./composables/useWindowTitle.js";
import { useMultiPaneSearch, MULTI_PANE_SEARCH_KEY } from "./composables/useMultiPaneSearch.js";
import HostRail from "./components/HostRail.vue";
import ChannelSidebar from "./components/ChannelSidebar.vue";
import TabBar from "./components/TabBar.vue";
import PaneLayout from "./components/PaneLayout.vue";
import PairingScreen from "./components/PairingScreen.vue";
import WriteRequestDialog from "./components/WriteRequestDialog.vue";
import CommandPalette from "./components/CommandPalette.vue";
import AppearancePanel from "./components/settings/AppearancePanel.vue";
import ConfigureCommandDialog from "./components/ConfigureCommandDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";

const authStore = useAuthStore();
const sessionStore = useSessionStore();
const hostsStore = useHostsStore();
const channelsStore = useChannelsStore();
const configStore = useConfigStore();
const themeStore = useThemeStore();
const layout = useLayout();
const multiPaneSearch = useMultiPaneSearch();
provide(MULTI_PANE_SEARCH_KEY, multiPaneSearch);
const commandPalette = useCommandPalette();
const showAppearance = ref(false);
const showConfigureDialog = ref(false);
const configureChannelId = ref<string | null>(null);

// ─── Window title ────────────────────────────────────────────────────────────

const windowTitleEnabled = computed(
	() => configStore.uiConfig.title?.windowTitle !== false,
);

const windowTitleFormat = computed(
	() => configStore.uiConfig.title?.windowFormat ?? "nexterm - {prefix}{host} - {title}",
);

/** Resolved title of the active tab's channel (no prefix, no truncation). */
const activeTitle = computed(() => {
	const tab = layout.activeTab.value;
	if (tab === null) return "";
	const ch = channelsStore.channels.find((c) => c.id === tab.channelId);
	if (ch?.title) return ch.title;
	if (ch?.dynamicTitle) return ch.dynamicTitle;
	return DEFAULT_CHANNEL_NAME;
});

/** Label of the host that owns the active tab's channel. */
const activeHost = computed(() => {
	const hostId = hostsStore.selectedHostId;
	if (hostId === null) return "";
	const host = hostsStore.hosts.find((h) => h.id === hostId);
	return host?.label ?? "";
});

/** Per-host prefix from config (global default from [title] section). */
const activePrefix = computed(() => {
	return configStore.uiConfig.title?.prefix ?? "";
});

useWindowTitle({
	enabled: windowTitleEnabled,
	format: windowTitleFormat,
	activeTitle,
	activeHost,
	activePrefix,
});

// ─── Confirm dialog state ────────────────────────────────────────────────────

const confirmDialog = ref({
	visible: false,
	title: "",
	message: "",
	action: null as (() => void) | null,
	actionKey: "" as string,
});

/**
 * Check if a confirmation should be skipped based on localStorage preferences.
 */
function shouldSkipConfirm(action: string): boolean {
	if (localStorage.getItem(`nexterm:skip${action}`) === "true") return true;
	const hostId = channelsStore.activeHostId;
	if (hostId) {
		if (localStorage.getItem(`nexterm:skip${action}:${hostId}`) === "true") return true;
	}
	return false;
}

/**
 * Handle confirm dialog result, including "Remember" persistence.
 */
function onConfirmAction(remember: { host: boolean; global: boolean }): void {
	const action = confirmDialog.value.action;
	const actionKey = confirmDialog.value.actionKey;

	if (remember.global) {
		localStorage.setItem(`nexterm:skip${actionKey}`, "true");
	}
	if (remember.host && channelsStore.activeHostId) {
		localStorage.setItem(`nexterm:skip${actionKey}:${channelsStore.activeHostId}`, "true");
	}

	action?.();
	confirmDialog.value.visible = false;
}

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
			await themeStore.loadThemes();
			await themeStore.loadAppearance();
			// Apply the persisted theme if it exists in available themes
			const savedThemeName = themeStore.appearance.theme;
			const savedTheme = themeStore.availableThemes.find(
				(t) => t.name === savedThemeName,
			);
			if (savedTheme) {
				themeStore.currentTheme = savedTheme;
				themeStore.applyTheme(savedTheme);
			}
			themeStore.applyOpacity(themeStore.appearance.opacity);
			themeStore.applyScrollbar(themeStore.appearance.scrollbar);
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
		if (configStore.uiConfig.onChannelDead === "close") {
			purgeDeadTabs(channelsStore.channels, layout.tabs.value, layout.closeTab);
		}
		// Auto-open welcome tab if one exists and is alive
		const welcomeCh = channelsStore.channels.find(
			(c) => c.isWelcome && c.status !== "dead",
		);
		if (welcomeCh) {
			layout.openTab(welcomeCh.id, layout.getTabLabel(welcomeCh.id));
		}

		// Auto-spawn only if no live channels AND no tabs open
		// (in "readonly" mode, dead channel tabs are kept so tabs may still exist)
		const hasAliveChannels = channelsStore.channels.some((c) => c.status !== "dead");
		if (!hasAliveChannels && layout.tabs.value.length === 0) {
			openPendingTab(hostId);
		}
	},
	{ immediate: true },
);

/**
 * When a channel is selected programmatically (e.g. after removeChannel
 * fallback or fetchChannels auto-select), open its tab.
 */
watch(
	() => channelsStore.selectedChannelId,
	(channelId) => {
		if (channelId === null) return;
		layout.openTab(channelId, layout.getTabLabel(channelId));
	},
);

/**
 * Sidebar click handler. Always opens a tab — even when re-clicking the
 * same channel (the watcher above only fires on value *changes*).
 */
function onSelectChannel(channelId: string): void {
	channelsStore.selectChannel(channelId);
	layout.openTab(channelId, layout.getTabLabel(channelId));
}

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
 * React to channels transitioning to "dead" or being removed.
 * - "close" mode: immediately close the tab when a channel dies.
 * - "readonly" mode: keep the tab (Closed badge, read-only content).
 * - Explicit removal (DELETE): always close the tab regardless of mode.
 */
watch(
	() => channelsStore.channels.map((c) => ({ id: c.id, status: c.status })),
	(current, previous) => {
		if (!previous) return;

		// Close tabs for channels that died (only in "close" mode)
		if (configStore.uiConfig.onChannelDead === "close") {
			for (const ch of current) {
				if (ch.status !== "dead") continue;
				const prev = previous.find((p) => p.id === ch.id);
				if (prev && prev.status !== "dead") {
					const idx = layout.tabs.value.findIndex((t) => t.channelId === ch.id);
					if (idx !== -1) layout.closeTab(idx);
				}
			}
		}

		// Always close tabs for channels removed from the list (explicit DELETE)
		const currentIds = new Set(current.map((c) => c.id));
		for (const prev of previous) {
			if (!currentIds.has(prev.id)) {
				const idx = layout.tabs.value.findIndex((t) => t.channelId === prev.id);
				if (idx !== -1) layout.closeTab(idx);
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
		return;
	}
	if (event.key === "Escape" && showAppearance.value) {
		showAppearance.value = false;
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
 * Close all tabs, but protect the welcome tab (if any).
 * Shows confirmation dialog if configured (default: true).
 */
function onCloseAll(): void {
	const welcomeId = channelsStore.welcomeChannel?.id;
	const closingCount = welcomeId
		? layout.tabs.value.filter((t) => t.channelId !== welcomeId).length
		: layout.tabs.value.length;

	if (
		closingCount > 0 &&
		configStore.uiConfig.tabs?.confirmCloseAll !== false &&
		!shouldSkipConfirm("ConfirmCloseAll")
	) {
		confirmDialog.value = {
			visible: true,
			title: `Close ${closingCount} terminal${closingCount > 1 ? "s" : ""}?`,
			message: "Terminals will be detached but continue running.",
			action: () => layout.closeAll(welcomeId),
			actionKey: "ConfirmCloseAll",
		};
	} else {
		layout.closeAll(welcomeId);
	}
}

/**
 * Close all tabs except the one at the given index.
 * Shows confirmation dialog if configured (default: true).
 */
function onCloseOthers(keepIndex: number): void {
	const closingCount = layout.tabs.value.length - 1;

	if (
		closingCount > 0 &&
		configStore.uiConfig.tabs?.confirmCloseOthers !== false &&
		!shouldSkipConfirm("ConfirmCloseOthers")
	) {
		confirmDialog.value = {
			visible: true,
			title: `Close ${closingCount} other terminal${closingCount > 1 ? "s" : ""}?`,
			message: "Terminals will be detached but continue running.",
			action: () => layout.closeOthers(keepIndex),
			actionKey: "ConfirmCloseOthers",
		};
	} else {
		layout.closeOthers(keepIndex);
	}
}

/**
 * Toggle a channel as the welcome tab for its host.
 * If the channel is already the welcome tab, unset it; otherwise set it.
 */
async function onSetWelcome(channelId: string): Promise<void> {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;

	const channel = channelsStore.channels.find((c) => c.id === channelId);
	if (channel?.isWelcome) {
		await channelsStore.clearWelcomeChannel(hostId);
	} else {
		await channelsStore.setWelcomeChannel(hostId, channelId);
	}
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
 * the tab, close the tab entirely. INV-03: closing a pane detaches the
 * terminal — it keeps running in the background.
 */
function onClosePane(channelId: string): void {
	const activeTab = layout.activeTab.value;
	if (activeTab === null) return;

	if (activeTab.channelId === channelId) {
		// Closing the root pane of the tab → close the whole tab
		// Terminal detaches and stays alive
		const idx = layout.tabs.value.findIndex((t) => t.channelId === channelId);
		if (idx !== -1) layout.closeTab(idx);
	} else {
		// Closing a split pane → leave vacant slot
		layout.vacatePane(channelId);
	}
	// INV-03: closing a pane detaches, never kills the terminal
}

/**
 * Fill a vacant slot with an existing channel.
 */
function onFillVacant(vacantId: string, channelId: string): void {
	layout.fillVacant(vacantId, channelId);
}

/**
 * Spawn a new terminal in a vacant slot.
 */
function onNewTerminalVacant(vacantId: string): void {
	const hostId = channelsStore.activeHostId;
	if (hostId === null) return;

	const tempId = generateId();
	channelsStore.registerPendingSpawn(tempId, hostId);
	layout.fillVacant(vacantId, tempId);
}

/**
 * Remove a vacant pane slot and give its space to the sibling.
 */
function onRearrangeVacant(vacantId: string): void {
	layout.rearrangeVacant(vacantId);
}

/**
 * Handle cross-tab pane DnD: move sourceChannelId into the target tab.
 * Validates max-4-panes (for non-center drops) before delegating to layout.
 */
function onDropPane(
	sourceChannelId: string,
	targetPaneId: string,
	targetTabChannelId: string,
	zone: DropZone,
): void {
	// For non-center zone, check max panes in target tab
	if (zone !== "center") {
		const targetRoot = layout.layouts.value[targetTabChannelId];
		if (targetRoot && countPanes(targetRoot) >= 4) return;
	}
	layout.movePaneTo(sourceChannelId, targetPaneId, targetTabChannelId, zone);
}

/**
 * Open the Configure Command dialog for a channel.
 */
function onConfigureCommand(channelId: string): void {
	configureChannelId.value = channelId;
	showConfigureDialog.value = true;
}

/**
 * Handle tab-bar drop: move a pane out to its own new tab.
 */
function onMoveToNewTab(sourceChannelId: string, insertAtIndex: number): void {
	layout.moveToNewTab(sourceChannelId, insertAtIndex);
}

/**
 * Sidebar context menu: open a channel in a new tab.
 */
function onSidebarOpenNewTab(channelId: string): void {
	layout.openTab(channelId, layout.getTabLabel(channelId));
}

/**
 * Sidebar context menu: open a channel in the current (active) tab,
 * replacing whatever is there.
 */
function onSidebarOpenCurrentTab(channelId: string): void {
	const activeTab = layout.activeTab.value;
	if (activeTab === null) {
		// No active tab — just open a new one
		layout.openTab(channelId, layout.getTabLabel(channelId));
		return;
	}
	// Replace the active tab's root pane with this channel
	layout.replaceChannelId(activeTab.channelId, channelId);
}

// ---------------------------------------------------------------------------
// Multi-pane search (SC-11, SC-12)
// ---------------------------------------------------------------------------

/**
 * Check if a tab has multiple panes (SC-12: scope toggle visibility).
 */
function tabHasMultiplePanes(tabChannelId: string): boolean {
	const root = layout.layouts.value[tabChannelId];
	if (root === null || root === undefined) return false;
	return countPanes(root) > 1;
}

/**
 * Broadcast search query to all panes in the active tab.
 */
function onSearchAllPanes(query: string): void {
	multiPaneSearch.searchAll(query, layout.layout.value);
}

/**
 * Navigate to next match across all panes (SC-11).
 */
function onFindNextAll(currentChannelId: string): void {
	multiPaneSearch.findNextAll(currentChannelId, layout.layout.value);
}

/**
 * Navigate to previous match across all panes.
 */
function onFindPreviousAll(currentChannelId: string): void {
	multiPaneSearch.findPreviousAll(currentChannelId, layout.layout.value);
}

// Set up the focus-pane callback for cross-pane search navigation (SC-11).
// When multi-pane search needs to focus a different pane, we could implement
// pane focusing here. For MVP, the match indicator shows which pane has the
// match — actual terminal focus would require a ref registry.
// TODO: Implement pane focus for SC-11 (requires TerminalPane ref registry)
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
	background: var(--nt-bg);
	color: var(--nt-fg);
}

.host-rail {
	background: rgba(var(--nt-host-rail-rgb), var(--nt-host-rail-alpha));
}

.channel-sidebar {
	background: rgba(var(--nt-sidebar-rgb), var(--nt-sidebar-alpha));
	border-right: 1px solid var(--nt-border);
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
	color: var(--nt-tab-hover);
	font-size: 13px;
	font-style: italic;
}

body.nexterm-dragging * {
	cursor: grabbing !important;
}
</style>
