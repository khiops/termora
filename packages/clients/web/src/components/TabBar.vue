<template>
	<div ref="tabBarEl" class="tab-bar" role="tablist" aria-label="Open terminals" @wheel.prevent="onWheel">
		<button
			v-for="(tab, idx) in tabs"
			:key="tab.channelId"
			role="tab"
			:aria-selected="idx === activeTabIndex"
			:class="['tab', { 'tab--active': idx === activeTabIndex }]"
			:title="getTabLabel(tab.channelId)"
			@click="emit('select-tab', idx)"
			@mousedown.middle.prevent="emit('close-tab', idx)"
		>
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
	</div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { Tab } from "../composables/useLayout.js";
import { useRename } from "../composables/useRename.js";

const props = defineProps<{
	tabs: Tab[];
	activeTabIndex: number;
	getTabLabel: (channelId: string) => string;
}>();

const emit = defineEmits<{
	(e: "select-tab", index: number): void;
	(e: "close-tab", index: number): void;
	(e: "add-tab"): void;
	(e: "rename-tab", channelId: string, title: string): void;
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

.tab__label {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: left;
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
