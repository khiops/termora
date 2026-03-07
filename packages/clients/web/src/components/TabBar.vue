<template>
	<div
		ref="tabBarEl"
		class="tab-bar"
		role="tablist"
		aria-label="Open terminals"
		@wheel.prevent="onWheel"
		@dragover.prevent="onTabBarDragOver"
		@dragleave="onTabBarDragLeave"
		@drop="onTabBarDrop"
	>
		<button
			v-for="(tab, idx) in tabs"
			:key="tab.channelId"
			role="tab"
			:aria-selected="idx === activeTabIndex"
			:class="['tab', { 'tab--active': idx === activeTabIndex, 'tab--drop-before': dropInsertIndex === idx, 'tab--drop-after': dropInsertIndex === idx + 1 && idx === tabs.length - 1 }]"
			:title="getTabLabel(tab.channelId)"
			@click="emit('select-tab', idx)"
			@mousedown.middle.prevent="emit('close-tab', idx)"
			@contextmenu.prevent="onTabContextMenu(idx, $event)"
		>
			<span v-if="isWelcomeTab(tab.channelId)" class="tab__welcome-star" title="Welcome Tab">&#x2605;</span>
			<input
				v-if="editingTabIndex === idx"
				ref="editInput"
				v-model="editValue"
				class="tab-rename-input"
				@keydown.enter="commitRename"
				@keydown.escape="cancelRename"
				@blur="commitRename"
				@click.stop
			/>
			<span v-else class="tab__label" @dblclick="startRename(idx)">{{ getTabLabel(tab.channelId) }}</span>
			<span
				v-if="notificationStore.activityDots.get(tab.channelId) && idx !== activeTabIndex"
				class="tab__activity-dot"
				aria-label="New activity"
			></span>
			<span
				v-if="(notificationStore.bellCounts.get(tab.channelId) ?? 0) > 0"
				class="tab__bell-badge"
			>{{ notificationStore.bellCounts.get(tab.channelId) }}</span>
			<span
				class="tab__close"
				role="button"
				:aria-label="`Close ${getTabLabel(tab.channelId)}`"
				title="Close tab"
				@click.stop="emit('close-tab', idx)"
			>×</span>
		</button>

		<button
			class="tab-bar__add"
			aria-label="Open new terminal"
			title="New terminal"
			@click="emit('add-tab')"
		>+</button>

		<TabContextMenu
			:visible="ctxMenu.visible"
			:x="ctxMenu.x"
			:y="ctxMenu.y"
			:tab="ctxMenu.tabIndex >= 0 ? tabs[ctxMenu.tabIndex] ?? null : null"
			:tab-index="ctxMenu.tabIndex"
			:tab-count="tabs.length"
			:is-welcome="ctxMenu.tabIndex >= 0 && tabs[ctxMenu.tabIndex] ? isWelcomeTab(tabs[ctxMenu.tabIndex]!.channelId) : false"
			:is-custom-title="isCtxTabCustomTitle"
			@close="ctxMenu.visible = false"
			@rename="onCtxRename"
			@reset-title="onCtxResetTitle"
			@close-tab="(idx) => emit('close-tab', idx)"
			@close-others="(idx) => emit('close-others', idx)"
			@close-to-right="(idx) => emit('close-to-right', idx)"
			@close-all="emit('close-all')"
			@split-right="(id) => emit('split', id, 'horizontal')"
			@split-down="(id) => emit('split', id, 'vertical')"
			@set-welcome="(id) => emit('set-welcome', id)"
			@configure-command="(id) => emit('configure-command', id)"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from "vue";
import type { Tab } from "../composables/useLayout.js";
import { useRename } from "../composables/useRename.js";
import { useChannelsStore } from "../stores/channels.js";
import { useNotificationStore } from "../stores/notifications.js";
import TabContextMenu from "./TabContextMenu.vue";

const channelsStore = useChannelsStore();
const notificationStore = useNotificationStore();

const props = defineProps<{
	tabs: Tab[];
	activeTabIndex: number;
	getTabLabel: (channelId: string) => string;
}>();

const emit = defineEmits<{
	(e: "select-tab", index: number): void;
	(e: "close-tab", index: number): void;
	(e: "close-others", index: number): void;
	(e: "close-to-right", index: number): void;
	(e: "close-all"): void;
	(e: "add-tab"): void;
	(e: "rename-tab", channelId: string, title: string): void;
	(e: "split", channelId: string, direction: "horizontal" | "vertical"): void;
	(e: "set-welcome", channelId: string): void;
	(e: "move-to-new-tab", sourceChannelId: string, insertAtIndex: number): void;
	(e: "configure-command", channelId: string): void;
}>();

// -------------------------------------------------------------------------
// Horizontal scroll
// -------------------------------------------------------------------------

const tabBarEl = ref<HTMLElement | null>(null);

function onWheel(e: WheelEvent): void {
	if (tabBarEl.value) {
		tabBarEl.value.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
	}
}

/** Scroll the active tab into view whenever it changes. */
watch(
	() => props.activeTabIndex,
	async () => {
		await nextTick();
		const el = tabBarEl.value;
		if (!el) return;
		const tab = el.children[props.activeTabIndex] as HTMLElement | undefined;
		tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
	},
);

// -------------------------------------------------------------------------
// Inline rename
// -------------------------------------------------------------------------

const editingTabIndex = ref<number | null>(null);

const { editValue, editInput, isEditing, startRename: startRenameRaw, commitRename, cancelRename } = useRename({
	onCommit: (newValue) => {
		if (editingTabIndex.value === null) return;
		const tab = props.tabs[editingTabIndex.value];
		if (tab !== undefined) {
			emit("rename-tab", tab.channelId, newValue);
		}
	},
});

watch(isEditing, (editing) => {
	if (!editing) editingTabIndex.value = null;
});

function startRename(idx: number): void {
	const tab = props.tabs[idx];
	if (tab === undefined) return;
	editingTabIndex.value = idx;
	startRenameRaw(props.getTabLabel(tab.channelId));
}

// -------------------------------------------------------------------------
// Welcome tab check
// -------------------------------------------------------------------------

function isWelcomeTab(channelId: string): boolean {
	return channelsStore.welcomeChannel?.id === channelId;
}

// -------------------------------------------------------------------------
// Context menu
// -------------------------------------------------------------------------

const ctxMenu = reactive({ visible: false, x: 0, y: 0, tabIndex: -1 });

function onTabContextMenu(idx: number, event: MouseEvent): void {
	ctxMenu.x = event.clientX;
	ctxMenu.y = event.clientY;
	ctxMenu.tabIndex = idx;
	ctxMenu.visible = true;
}

function onCtxRename(channelId: string): void {
	const idx = props.tabs.findIndex((t) => t.channelId === channelId);
	if (idx !== -1) startRename(idx);
}

/** Whether the context-menu'd tab has a user-set custom title. */
const isCtxTabCustomTitle = computed(() => {
	const tab = ctxMenu.tabIndex >= 0 ? props.tabs[ctxMenu.tabIndex] : undefined;
	if (!tab) return false;
	const ch = channelsStore.channels.find((c) => c.id === tab.channelId);
	return ch?.title != null && ch.title !== "";
});

function onCtxResetTitle(channelId: string): void {
	channelsStore.clearTitle(channelId);
}

// -------------------------------------------------------------------------
// Tab bar drop (move pane to new tab between existing tabs)
// -------------------------------------------------------------------------

const dropInsertIndex = ref<number | null>(null);

/**
 * Determine the insertion index for a tab-bar drop based on mouse position.
 * Returns the index at which a new tab would be inserted.
 */
function getDropInsertIndex(event: DragEvent): number {
	const el = tabBarEl.value;
	if (!el) return props.tabs.length;

	// Iterate over tab buttons to find the insertion point
	const buttons = Array.from(el.querySelectorAll<HTMLElement>("[role=tab]"));
	for (let i = 0; i < buttons.length; i++) {
		const btn = buttons[i];
		if (!btn) continue;
		const rect = btn.getBoundingClientRect();
		const midX = rect.left + rect.width / 2;
		if (event.clientX < midX) return i;
	}
	return props.tabs.length;
}

function onTabBarDragOver(event: DragEvent): void {
	if (!event.dataTransfer?.types.includes("text/x-nexterm-pane")) return;
	event.dataTransfer.dropEffect = "move";
	dropInsertIndex.value = getDropInsertIndex(event);
}

function onTabBarDragLeave(event: DragEvent): void {
	const el = event.currentTarget as HTMLElement;
	const related = event.relatedTarget as Node | null;
	if (related && el.contains(related)) return;
	dropInsertIndex.value = null;
}

function onTabBarDrop(event: DragEvent): void {
	dropInsertIndex.value = null;

	if (!event.dataTransfer) return;
	const raw = event.dataTransfer.getData("text/x-nexterm-pane");
	if (!raw) return;

	let data: { channelId: string; paneId: string; hostId: string | null };
	try {
		data = JSON.parse(raw) as typeof data;
	} catch {
		return;
	}

	// Prevent drops from propagating to PaneLayout drop zones
	event.stopPropagation();

	const insertIdx = getDropInsertIndex(event);
	emit("move-to-new-tab", data.channelId, insertIdx);
}
</script>

<style scoped>
.tab-bar {
	display: flex;
	align-items: stretch;
	background: rgba(var(--nt-tab-bar-rgb), var(--nt-tab-bar-alpha));
	border-bottom: 1px solid var(--nt-border);
	overflow-x: auto;
	overflow-y: hidden;
	flex-shrink: 0;
	min-height: 32px;
	scrollbar-width: thin;
	scrollbar-color: var(--nt-border) transparent;
}

.tab-bar::-webkit-scrollbar {
	height: 3px;
}

.tab-bar::-webkit-scrollbar-track {
	background: transparent;
}

.tab-bar::-webkit-scrollbar-thumb {
	background: var(--nt-border);
	border-radius: 2px;
}

.tab {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 0 10px 0 12px;
	min-width: 80px;
	max-width: 180px;
	background: var(--nt-host-rail);
	border: none;
	border-right: 1px solid var(--nt-border);
	color: var(--nt-text-secondary);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	transition: background 0.1s, color 0.1s;
	position: relative;
	flex-shrink: 0;
}

.tab:hover {
	background: var(--nt-bg);
	color: var(--nt-sidebar-text);
}

.tab--active {
	background: var(--nt-border);
	color: var(--nt-fg);
	border-bottom: 2px solid var(--nt-accent);
}

.tab--active:hover {
	background: var(--nt-border);
}

.tab--drop-before::before {
	content: "";
	position: absolute;
	left: -1px;
	top: 4px;
	bottom: 4px;
	width: 2px;
	background: var(--nt-accent, #6495ed);
	z-index: 10;
}

.tab--drop-after::after {
	content: "";
	position: absolute;
	right: -1px;
	top: 4px;
	bottom: 4px;
	width: 2px;
	background: var(--nt-accent, #6495ed);
	z-index: 10;
}

.tab__welcome-star {
	flex-shrink: 0;
	font-size: 10px;
	color: var(--nt-accent);
	line-height: 1;
}

.tab__label {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: left;
}

.tab__activity-dot {
	flex-shrink: 0;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--nt-blue, #3b82f6);
}

.tab__bell-badge {
	flex-shrink: 0;
	min-width: 16px;
	height: 16px;
	padding: 0 4px;
	border-radius: 8px;
	background: var(--nt-badge);
	color: var(--nt-bright-white, #fff);
	font-size: 10px;
	font-weight: 700;
	line-height: 16px;
	text-align: center;
}

.tab__close {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 3px;
	font-size: 14px;
	line-height: 1;
	opacity: 0;
	color: var(--nt-text-secondary);
	transition: opacity 0.1s, background 0.1s, color 0.1s;
}

.tab:hover .tab__close,
.tab--active .tab__close {
	opacity: 1;
}

.tab__close:hover {
	background: var(--nt-tab-hover);
	color: var(--nt-badge);
}

.tab-rename-input {
	flex: 1;
	background: transparent;
	border: none;
	border-bottom: 1px solid var(--nt-tab-hover);
	color: inherit;
	font: inherit;
	outline: none;
	width: 100%;
	padding: 0;
	min-width: 0;
}

.tab-bar__add {
	flex-shrink: 0;
	width: 32px;
	background: transparent;
	border: none;
	color: var(--nt-tab-hover);
	font-size: 18px;
	line-height: 1;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: color 0.1s, background 0.1s;
	align-self: stretch;
}

.tab-bar__add:hover {
	color: var(--nt-accent);
	background: var(--nt-bg);
}
</style>
