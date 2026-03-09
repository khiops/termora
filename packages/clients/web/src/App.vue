<template>
	<div class="app-root">
		<!-- Write-request dialog — rendered globally, outside layout, via Teleport -->
		<WriteRequestDialog />

		<!-- Command Palette — Teleport to body, triggered by Ctrl+P / Cmd+P -->
		<CommandPalette />

		<!-- Settings panel — rendered globally, outside layout, via Teleport -->
		<SettingsPanel :visible="showSettings" @close="showSettings = false" />

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

		<!-- Add/Edit Host modal — opened from rail "+" or host context menu -->
		<HostModal
			v-if="showHostModal"
			:visible="true"
			:edit-host="editingHost"
			@close="showHostModal = false; editingHost = null"
			@saved="onHostSaved"
			@batch-import="showHostModal = false; showBatchImport = true"
		/>

		<!-- Context menus — host badge and group header right-click -->
		<HostContextMenu
			:visible="hostContextMenu !== null"
			:host-id="hostContextMenu?.hostId ?? ''"
			:x="hostContextMenu?.x ?? 0"
			:y="hostContextMenu?.y ?? 0"
			@close="hostContextMenu = null"
			@edit="onEditHost"
			@delete="onDeleteHost"
			@connect="onConnectHost"
			@disconnect="onDisconnectHost"
			@new-group="onNewGroupForHost"
		/>

		<GroupContextMenu
			:visible="groupContextMenu !== null"
			:group-name="groupContextMenu?.groupName ?? ''"
			:x="groupContextMenu?.x ?? 0"
			:y="groupContextMenu?.y ?? 0"
			@close="groupContextMenu = null"
			@rename="onRenameGroup"
			@delete-group="onDeleteGroup"
		/>

		<!-- Rename group dialog -->
		<GroupActionDialog
			v-if="renameGroupName !== null"
			:visible="true"
			title="Rename Group"
			:message="`Rename group '${renameGroupName}'.`"
			confirm-label="Rename"
			input-label="NEW NAME"
			:input-value="renameGroupName"
			input-placeholder="Group name"
			@close="renameGroupName = null"
			@confirm="onRenameGroupConfirmed"
		/>

		<!-- Delete group confirmation -->
		<GroupActionDialog
			v-if="deleteGroupName !== null"
			:visible="true"
			title="Delete Group"
			:message="`Delete group '${deleteGroupName}'? Hosts will move to Ungrouped.`"
			confirm-label="Delete"
			:confirm-danger="true"
			@close="deleteGroupName = null"
			@confirm="onDeleteGroupConfirmed"
		/>

		<!-- Delete host confirmation modal -->
		<DeleteHostModal
			:visible="deleteHostId !== null"
			:host-id="deleteHostId ?? ''"
			@close="deleteHostId = null"
			@deleted="deleteHostId = null; void hostsStore.fetchHosts()"
		/>

		<!-- Batch import from SSH config -->
		<BatchImportModal
			v-model:show="showBatchImport"
			@imported="void hostsStore.fetchHosts()"
		/>

		<!-- Pairing overlay — shown when no token yet, or AUTH_FAIL -->
		<PairingScreen
			v-if="needsPairing"
			@authenticated="onAuthenticated"
		/>

		<!-- Main layout — only shown when authenticated and WS ready -->
		<div v-else class="app-layout" :style="layoutStyle">
			<HostRail
			class="host-rail"
			@toggle-settings="showSettings = !showSettings"
			@add-host="showHostModal = true"
			@host-context-menu="onHostContextMenu"
			@group-context-menu="onGroupContextMenu"
		/>
			<!-- Resize handle after host rail -->
			<div
				class="resize-handle"
				:style="{ left: railResize.width.value + 'px' }"
				@mousedown="railResize.onMouseDown"
				@dblclick="railResize.reset"
			/>
			<ChannelSidebar
			v-show="!sidebarResize.collapsed.value"
			class="channel-sidebar"
			@select-channel="onSelectChannel"
			@open-new-tab="onSidebarOpenNewTab"
			@open-current-tab="onSidebarOpenCurrentTab"
			@configure-command="onConfigureCommand"
			@set-welcome="onSetWelcome"
		/>
			<!-- Resize handle after channel sidebar -->
			<div
				class="resize-handle"
				:style="{ left: (railResize.width.value + (sidebarResize.collapsed.value ? 0 : sidebarResize.width.value)) + 'px' }"
				@mousedown="sidebarResize.onMouseDown"
				@dblclick="sidebarResize.reset"
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
import { computed, onMounted, onUnmounted, provide, ref, toRef, watch } from "vue";
import { useResizable } from "./composables/useResizable.js";
import { generateId } from "@nexterm/shared";
import type { Host } from "@nexterm/shared";
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
import { useTabTitle } from "./composables/useTabTitle.js";
import { useMultiPaneSearch, MULTI_PANE_SEARCH_KEY } from "./composables/useMultiPaneSearch.js";
import HostRail from "./components/HostRail.vue";
import ChannelSidebar from "./components/ChannelSidebar.vue";
import TabBar from "./components/TabBar.vue";
import PaneLayout from "./components/PaneLayout.vue";
import PairingScreen from "./components/PairingScreen.vue";
import WriteRequestDialog from "./components/WriteRequestDialog.vue";
import CommandPalette from "./components/CommandPalette.vue";
import SettingsPanel from "./components/settings/SettingsPanel.vue";
import ConfigureCommandDialog from "./components/ConfigureCommandDialog.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import HostModal from "./components/HostModal.vue";
import HostContextMenu from "./components/HostContextMenu.vue";
import GroupContextMenu from "./components/GroupContextMenu.vue";
import DeleteHostModal from "./components/DeleteHostModal.vue";
import BatchImportModal from "./components/BatchImportModal.vue";
import GroupActionDialog from "./components/GroupActionDialog.vue";

const authStore = useAuthStore();
const sessionStore = useSessionStore();
const configStore = useConfigStore();

// ─── Resizable panels ────────────────────────────────────────────────────────

function saveLayoutWidth(key: string, value: number): void {
	if (authStore.token === null) return;
	void fetch("/api/config/ui", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${authStore.token}`,
		},
		body: JSON.stringify({ layout: { [key]: value } }),
	}).then(() => configStore.loadUiConfig());
}

const railResize = useResizable({
	initialWidth: 48,
	minWidth: 48,
	maxWidth: 120,
	onResizeEnd: (width) => saveLayoutWidth("hostRailWidth", width),
});

const sidebarResize = useResizable({
	initialWidth: 200,
	minWidth: 140,
	maxWidth: 400,
	collapseThreshold: 80,
	onResizeEnd: (width) => saveLayoutWidth("sidebarWidth", width),
});

// Apply persisted layout widths once the config loads (after auth).
watch(
	() => configStore.uiConfig.layout,
	(layout) => {
		if (!layout) return;
		if (layout.hostRailWidth > 0) {
			railResize.width.value = layout.hostRailWidth;
		}
		const sw = layout.sidebarWidth;
		if (sw === 0) {
			sidebarResize.collapsed.value = true;
			sidebarResize.width.value = 0;
		} else if (sw > 0) {
			sidebarResize.collapsed.value = false;
			sidebarResize.width.value = sw;
		}
	},
	{ once: true },
);

const layoutStyle = computed(() => ({
	"--rail-w": `${railResize.width.value}px`,
	"--sidebar-w": `${sidebarResize.collapsed.value ? 0 : sidebarResize.width.value}px`,
}));
const hostsStore = useHostsStore();
const channelsStore = useChannelsStore();
const themeStore = useThemeStore();
const layout = useLayout();
const multiPaneSearch = useMultiPaneSearch();
provide(MULTI_PANE_SEARCH_KEY, multiPaneSearch);
const commandPalette = useCommandPalette();
const showSettings = ref(false);
const showConfigureDialog = ref(false);
const configureChannelId = ref<string | null>(null);
const showHostModal = ref(false);
const editingHost = ref<Host | null>(null);
const deleteHostId = ref<string | null>(null);
const showBatchImport = ref(false);

// Wire up palette external actions (add-host, settings, ssh-import, toggle-sidebar)
commandPalette.onExternalAction.value = (actionId: string) => {
	switch (actionId) {
		case "action:add-host":
			editingHost.value = null;
			showHostModal.value = true;
			break;
		case "action:settings":
			showSettings.value = true;
			break;
		case "action:ssh-import":
			showBatchImport.value = true;
			break;
		case "action:toggle-sidebar":
			sidebarResize.collapsed.value = !sidebarResize.collapsed.value;
			break;
		default:
			console.warn("[CommandPalette] unhandled external action:", actionId);
	}
};
const hostContextMenu = ref<{
	hostId: string;
	x: number;
	y: number;
} | null>(null);
const groupContextMenu = ref<{
	groupName: string;
	x: number;
	y: number;
} | null>(null);
const renameGroupName = ref<string | null>(null);
const deleteGroupName = ref<string | null>(null);

// ─── Per-channel theme cascade ───────────────────────────────────────────────

/**
 * When the active channel changes, fetch the resolved cascade for that
 * host+channel and apply the correct theme. Falls back to global theme
 * when no channel is selected.
 */
/**
 * Resolve and apply the cascade theme for a given channel.
 * Extracted so it can be called from both the watcher and onMounted.
 */
async function applyCascadeTheme(channelId: string): Promise<void> {
	if (themeStore.availableThemes.length === 0) return;
	const hostId = channelsStore.channelHostMap.get(channelId) ?? null;
	if (authStore.token === null) return;
	try {
		const params = new URLSearchParams();
		if (hostId) params.set("host_id", hostId);
		params.set("channel_id", channelId);
		const res = await fetch(`/api/config/cascade?${params.toString()}`, {
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) return;
		const data = await res.json() as {
			terminal: {
				resolved: { theme?: string };
				host?: { theme?: string } | null;
				channel?: { theme?: string } | null;
			};
		};
		// Only apply scope override if there's an explicit host or channel theme
		const hasChannelOverride = data.terminal.channel?.theme != null;
		const hasHostOverride = data.terminal.host?.theme != null;
		if (!hasChannelOverride && !hasHostOverride) {
			// No explicit scope override — use global appearance theme
			themeStore.setScopeOverride(null);
			if (themeStore.currentTheme !== null) {
				themeStore.applyTheme(themeStore.currentTheme);
			}
			return;
		}
		const themeName = data.terminal.resolved.theme;
		if (!themeName) return;
		const theme = themeStore.availableThemes.find((t) => t.name === themeName);
		if (theme) {
			themeStore.setScopeOverride(theme);
			themeStore.applyTheme(theme);
		}
	} catch {
		// Non-critical — leave current theme applied
	}
}

watch(
	() => channelsStore.selectedChannelId,
	async (channelId) => {
		if (channelId === null) {
			// No channel selected — reapply global theme
			themeStore.setScopeOverride(null);
			if (themeStore.currentTheme !== null) {
				themeStore.applyTheme(themeStore.currentTheme);
			}
			return;
		}
		await applyCascadeTheme(channelId);
	},
);

// ─── Window title ────────────────────────────────────────────────────────────

const windowTitleEnabled = computed(
	() => configStore.uiConfig.title?.windowTitle !== false,
);

const windowTitleFormat = computed(
	() => configStore.uiConfig.title?.windowFormat ?? "nexterm - {prefix}{host} - {title}",
);

const activeChannelId = computed(() => layout.activeTab.value?.channelId ?? null);
/** Resolved title of the active tab's channel (no prefix, no truncation). */
const { resolvedTitle: _resolvedTitle } = useTabTitle(
	activeChannelId,
	toRef(channelsStore, "channels"),
);
const activeTitle = computed(() => (activeChannelId.value === null ? "" : _resolvedTitle.value));

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
	// Ctrl+K / Cmd+K must be captured before Chrome's omnibox intercepts it (SC-14)
	window.addEventListener("keydown", onGlobalKeydown, { capture: true });

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
			// Apply channel/host theme override if an active channel exists
			if (channelsStore.selectedChannelId) {
				await applyCascadeTheme(channelsStore.selectedChannelId);
			}
		} catch (err) {
			console.error("[App] startup connect failed:", err);
		}
	}
});

onUnmounted(() => {
	window.removeEventListener("keydown", onGlobalKeydown, { capture: true });
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

		// Auto-spawn only for local hosts with no live channels and no tabs open.
		// SSH hosts require an explicit connection — auto-spawn would timeout.
		const host = hostsStore.hosts.find((h) => h.id === hostId);
		const hasAliveChannels = channelsStore.channels.some((c) => c.status !== "dead");
		if (host?.type === "local" && !hasAliveChannels && layout.tabs.value.length === 0) {
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
	{ immediate: true },
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
 * Intercepts Ctrl+K (Windows/Linux) and Cmd+K (macOS) to toggle the palette (SC-14).
 */
function onGlobalKeydown(event: KeyboardEvent): void {
	const isK = event.key === "k" || event.key === "K";
	const modifier = event.ctrlKey || event.metaKey;
	if (isK && modifier) {
		event.preventDefault();
		commandPalette.toggle();
		return;
	}
	if (event.key === "Escape" && showSettings.value) {
		showSettings.value = false;
	}
}

/**
 * Handle host modal save — refresh the host list and close the modal.
 */
function onHostSaved(_host: Host): void {
	showHostModal.value = false;
	editingHost.value = null;
	void hostsStore.fetchHosts();
}

/**
 * Handle right-click on a host badge in the rail.
 * Stores position + hostId for the context menu component (Block 6).
 */
function onHostContextMenu(payload: {
	hostId: string;
	event: MouseEvent;
}): void {
	hostContextMenu.value = {
		hostId: payload.hostId,
		x: payload.event.clientX,
		y: payload.event.clientY,
	};
}

/**
 * Handle right-click on a group header in the rail.
 * Stores position + groupName for the context menu component (Block 6).
 */
function onGroupContextMenu(payload: {
	groupName: string;
	event: MouseEvent;
}): void {
	groupContextMenu.value = {
		groupName: payload.groupName,
		x: payload.event.clientX,
		y: payload.event.clientY,
	};
}

// ─── Context menu action handlers ─────────────────────────────────────────

function onEditHost(hostId: string): void {
	const host = hostsStore.hosts.find((h) => h.id === hostId) ?? null;
	editingHost.value = host;
	showHostModal.value = true;
}

function onDeleteHost(hostId: string): void {
	deleteHostId.value = hostId;
}

function onConnectHost(hostId: string): void {
	hostsStore.selectHost(hostId);
}

function onDisconnectHost(_hostId: string): void {
	// TODO: implement disconnect via session store
}

function onNewGroupForHost(hostId: string): void {
	// Open the host modal in edit mode so the user can set a new group
	onEditHost(hostId);
}

function onRenameGroup(groupName: string): void {
	renameGroupName.value = groupName;
}

function onRenameGroupConfirmed(newName?: string): void {
	const oldName = renameGroupName.value;
	renameGroupName.value = null;
	if (!oldName || !newName?.trim()) return;
	void fetch(
		`/api/hosts/groups/${encodeURIComponent(oldName)}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authStore.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: newName.trim() }),
		},
	).then(() => hostsStore.fetchHosts());
}

function onDeleteGroup(groupName: string): void {
	deleteGroupName.value = groupName;
}

function onDeleteGroupConfirmed(): void {
	const name = deleteGroupName.value;
	deleteGroupName.value = null;
	if (!name) return;
	void fetch(
		`/api/hosts/groups/${encodeURIComponent(name)}`,
		{
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${authStore.token}`,
			},
		},
	).then(() => hostsStore.fetchHosts());
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
	grid-template-columns: var(--rail-w, 48px) var(--sidebar-w, 200px) 1fr;
	height: 100vh;
	background: var(--nt-bg);
	color: var(--nt-fg);
	position: relative;
}

.resize-handle {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 6px;
	margin-left: -3px;
	cursor: col-resize;
	z-index: 20;
	transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle:active {
	background: rgba(var(--nt-accent-rgb), 0.3);
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
