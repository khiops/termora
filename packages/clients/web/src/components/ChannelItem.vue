<template>
	<div
		class="channel-item"
		:class="{
			'channel-item--selected': isSelected,
			'channel-item--dead': channel.status === 'dead',
		}"
		:title="displayLabel"
		@click="emit('select')"
		@contextmenu.prevent="onContextMenu"
	>
		<span class="channel-item__status" :class="`channel-item__status--${channel.status}`"></span>
		<input
			v-if="isEditing"
			ref="editInput"
			v-model="editValue"
			class="channel-rename-input"
			@keydown.enter="commitRename"
			@keydown.escape="cancelRename"
			@blur="commitRename"
		/>
		<span v-else class="channel-item__label" @dblclick="startRename">{{ displayLabel }}</span>
		<span v-if="isUnread" class="channel-item__unread" aria-label="Unread output"></span>
	</div>

	<!-- Context menu -->
	<Teleport to="body">
		<div
			v-if="contextMenuVisible"
			class="channel-context-menu"
			:style="{ top: `${contextMenuY}px`, left: `${contextMenuX}px` }"
			@click.stop
		>
			<button class="channel-context-menu__item" @click="onCloseChannel">Close channel</button>
			<div class="channel-context-menu__sep"></div>
			<button class="channel-context-menu__item" @click="onMoveToGroup(null)">
				Move to General
			</button>
			<button
				v-for="group in availableGroups"
				:key="group.id"
				class="channel-context-menu__item"
				@click="onMoveToGroup(group.id)"
			>
				Move to {{ group.name }}
			</button>
		</div>
		<div
			v-if="contextMenuVisible"
			class="channel-context-menu__backdrop"
			@click="contextMenuVisible = false"
			@contextmenu.prevent="contextMenuVisible = false"
		></div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import type { Channel, ChannelGroup } from "@nexterm/shared";
import { useRename } from "../composables/useRename.js";

const props = defineProps<{
	channel: Channel;
	/** 1-based display index within its group, used as fallback label. */
	index: number;
	isSelected: boolean;
	isUnread: boolean;
	availableGroups: ChannelGroup[];
}>();

const emit = defineEmits<{
	select: [];
	closeChannel: [channelId: string];
	moveToGroup: [channelId: string, groupId: string | null];
	rename: [channelId: string, title: string];
}>();

const displayLabel = computed(
	() => props.channel.title ?? "Terminal",
);

// -------------------------------------------------------------------------
// Inline rename
// -------------------------------------------------------------------------

const { isEditing, editValue, editInput, startRename: startRenameRaw, commitRename, cancelRename } = useRename({
	onCommit: (newValue) => emit("rename", props.channel.id, newValue),
});

function startRename(): void {
	startRenameRaw(displayLabel.value);
}

// -------------------------------------------------------------------------
// Context menu
// -------------------------------------------------------------------------

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

function onContextMenu(event: MouseEvent): void {
	contextMenuX.value = event.clientX;
	contextMenuY.value = event.clientY;
	contextMenuVisible.value = true;
}

function onCloseChannel(): void {
	contextMenuVisible.value = false;
	emit("closeChannel", props.channel.id);
}

function onMoveToGroup(groupId: string | null): void {
	contextMenuVisible.value = false;
	emit("moveToGroup", props.channel.id, groupId);
}

// Close on Escape
function onKeydown(e: KeyboardEvent): void {
	if (e.key === "Escape") contextMenuVisible.value = false;
}

window.addEventListener("keydown", onKeydown);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<style scoped>
.channel-item {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 5px 10px 5px 20px;
	cursor: pointer;
	font-size: 13px;
	color: #a6adc8;
	border-radius: 4px;
	margin: 0 4px;
	transition: background 0.1s, color 0.1s;
	user-select: none;
	position: relative;
}

.channel-item:hover {
	background: #313244;
	color: #cdd6f4;
}

.channel-item--selected {
	background: #45475a;
	color: #cdd6f4;
}

.channel-item--dead {
	opacity: 0.45;
}

/* Status dot */
.channel-item__status {
	flex-shrink: 0;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #45475a;
}

.channel-item__status--live {
	background: #a6e3a1; /* catppuccin green */
}

.channel-item__status--born {
	background: #f9e2af; /* catppuccin yellow — starting up */
	animation: pulse 1.4s ease-in-out infinite;
}

.channel-item__status--orphan {
	background: #585b70; /* catppuccin surface2 — disconnected */
}

.channel-item__status--dead {
	background: #45475a; /* surface1 — dimmed */
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

.channel-item__label {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.channel-rename-input {
	flex: 1;
	background: transparent;
	border: none;
	border-bottom: 1px solid #555;
	color: inherit;
	font: inherit;
	outline: none;
	width: 100%;
	padding: 0;
}

/* Unread indicator dot */
.channel-item__unread {
	flex-shrink: 0;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #89b4fa; /* catppuccin blue */
}

/* Context menu */
.channel-context-menu__backdrop {
	position: fixed;
	inset: 0;
	z-index: 999;
}

.channel-context-menu {
	position: fixed;
	z-index: 1000;
	background: #313244;
	border: 1px solid #45475a;
	border-radius: 6px;
	padding: 4px;
	min-width: 160px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.channel-context-menu__item {
	display: block;
	width: 100%;
	padding: 6px 10px;
	text-align: left;
	background: none;
	border: none;
	border-radius: 4px;
	color: #cdd6f4;
	font-size: 13px;
	cursor: pointer;
	transition: background 0.1s;
}

.channel-context-menu__item:hover {
	background: #45475a;
}

.channel-context-menu__sep {
	height: 1px;
	background: #45475a;
	margin: 4px 0;
}
</style>
