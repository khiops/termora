<template>
	<div class="channel-sidebar">
		<!-- Header: host label + new channel button -->
		<div class="sidebar-header">
			<span class="sidebar-header__label" :title="hostLabel">{{ hostLabel }}</span>
			<button
				class="sidebar-header__new-btn"
				:disabled="activeHostId === null || spawning"
				:title="activeHostId === null ? 'Select a host first' : 'New channel'"
				aria-label="New channel"
				@click="onNewChannel"
			>
				<span class="sidebar-header__new-icon" aria-hidden="true">+</span>
			</button>
		</div>

		<!-- Channel list, grouped -->
		<div class="sidebar-list">
			<!-- Loading state -->
			<div v-if="channelsStore.loading" class="sidebar-state">Loading…</div>

			<!-- Error state -->
			<div v-else-if="channelsStore.error" class="sidebar-state sidebar-state--error">
				{{ channelsStore.error }}
			</div>

			<!-- Empty state: no host selected -->
			<div v-else-if="activeHostId === null" class="sidebar-state">
				Select a host to view channels.
			</div>

			<!-- Empty state: host has no channels yet -->
			<div
				v-else-if="channelsStore.channels.length === 0"
				class="sidebar-state"
			>
				No channels yet — click + to start one.
			</div>

			<!-- Populated channel list -->
			<template v-else>
				<!-- Groups defined by user -->
				<template
					v-for="group in channelsStore.groups.filter((g) => g.hostId === activeHostId || g.hostId === '')"
					:key="group.id"
				>
					<ChannelGroupHeader
						:group="group"
						:count="(channelsStore.channelsByGroup.get(group.id) ?? []).length"
						@toggle="channelsStore.toggleGroupCollapsed(group.id)"
						@rename="channelsStore.renameGroup"
						@delete="channelsStore.removeGroup"
					/>
					<template v-if="!group.collapsed">
						<ChannelItem
							v-for="(ch, idx) in channelsStore.channelsByGroup.get(group.id) ?? []"
							:key="ch.id"
							:channel="ch"
							:index="idx + 1"
							:is-selected="ch.id === channelsStore.selectedChannelId"
							:is-unread="channelsStore.unreadChannels.has(ch.id)"
							:available-groups="otherGroups(group.id)"
							@select="emit('select-channel', ch.id)"
							@close-channel="onCloseChannel"
							@move-to-group="channelsStore.moveChannelToGroup"
							@rename="onRenameChannel"
						/>
					</template>
				</template>

				<!-- "General" group — ungrouped channels (null bucket) -->
				<ChannelGroupHeader
					:group="generalGroup"
					:count="(channelsStore.channelsByGroup.get(null) ?? []).length"
					@toggle="toggleGeneral"
					@rename="() => {}"
					@delete="() => {}"
				/>
				<template v-if="!generalCollapsed">
					<ChannelItem
						v-for="(ch, idx) in channelsStore.channelsByGroup.get(null) ?? []"
						:key="ch.id"
						:channel="ch"
						:index="idx + 1"
						:is-selected="ch.id === channelsStore.selectedChannelId"
						:is-unread="channelsStore.unreadChannels.has(ch.id)"
						:available-groups="channelsStore.groups.filter((g) => g.hostId === activeHostId || g.hostId === '')"
						@select="emit('select-channel', ch.id)"
						@close-channel="onCloseChannel"
						@move-to-group="channelsStore.moveChannelToGroup"
						@rename="onRenameChannel"
					/>
				</template>
			</template>
		</div>

		<!-- Footer: add group button -->
		<div v-if="activeHostId !== null" class="sidebar-footer">
			<button
				class="sidebar-footer__add-group"
				title="Add channel group"
				@click="onAddGroup"
			>
				+ Add group
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChannelGroup } from "@nexterm/shared";
import { useChannelsStore } from "../stores/channels.js";
import { useHostsStore } from "../stores/hosts.js";
import ChannelGroupHeader from "./ChannelGroupHeader.vue";
import ChannelItem from "./ChannelItem.vue";

const emit = defineEmits<{
	"select-channel": [channelId: string];
}>();

const channelsStore = useChannelsStore();
const hostsStore = useHostsStore();

const activeHostId = computed(() => channelsStore.activeHostId);

const spawning = ref(false);

const hostLabel = computed(() => {
	const id = activeHostId.value;
	if (id === null) return "No host selected";
	const host = hostsStore.hosts.find((h) => h.id === id);
	return host?.label ?? id;
});

// -------------------------------------------------------------------------
// Synthetic "General" group for ungrouped channels
// -------------------------------------------------------------------------

const generalCollapsed = ref(false);

/** Pseudo-group object for the ungrouped bucket. Not persisted. */
const generalGroup = computed<ChannelGroup>(() => ({
	id: "__general__",
	hostId: activeHostId.value ?? "",
	name: "General",
	sortOrder: -1,
	collapsed: generalCollapsed.value,
	createdAt: "",
}));

function toggleGeneral(): void {
	generalCollapsed.value = !generalCollapsed.value;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Groups available for "Move to" context-menu, excluding the one the channel is already in. */
function otherGroups(currentGroupId: string): ChannelGroup[] {
	return channelsStore.groups.filter(
		(g) =>
			g.id !== currentGroupId &&
			(g.hostId === activeHostId.value || g.hostId === ""),
	);
}

// -------------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------------

async function onNewChannel(): Promise<void> {
	if (activeHostId.value === null || spawning.value) return;
	spawning.value = true;
	try {
		await channelsStore.spawnChannel(activeHostId.value);
	} catch (err) {
		console.error("[ChannelSidebar] spawn failed:", err);
	} finally {
		spawning.value = false;
	}
}

function onCloseChannel(channelId: string): void {
	channelsStore.removeChannel(channelId);
}

function onRenameChannel(channelId: string, title: string): void {
	channelsStore.renameChannel(channelId, title);
}

function onAddGroup(): void {
	const name = `Group ${channelsStore.groups.length + 1}`;
	channelsStore.addGroup(name);
}
</script>

<style scoped>
.channel-sidebar {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	height: 100%;
}

/* Header */
.sidebar-header {
	display: flex;
	align-items: center;
	padding: 10px 8px 8px;
	gap: 6px;
	flex-shrink: 0;
	border-bottom: 1px solid var(--nt-border);
}

.sidebar-header__label {
	flex: 1;
	font-size: 12px;
	font-weight: 600;
	color: var(--nt-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	user-select: none;
}

.sidebar-header__new-btn {
	flex-shrink: 0;
	width: 22px;
	height: 22px;
	border-radius: 4px;
	border: none;
	background: transparent;
	color: var(--nt-text-secondary);
	font-size: 18px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	transition: background 0.1s, color 0.1s;
	padding: 0;
}

.sidebar-header__new-btn:not(:disabled):hover {
	background: var(--nt-border);
	color: var(--nt-accent);
}

.sidebar-header__new-btn:disabled {
	cursor: not-allowed;
	opacity: 0.35;
}

.sidebar-header__new-icon {
	display: block;
	line-height: 1;
	margin-top: -1px;
}

/* Scrollable list */
.sidebar-list {
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 4px 0;
	scrollbar-width: thin;
	scrollbar-color: var(--nt-border) transparent;
}

.sidebar-list::-webkit-scrollbar {
	width: 4px;
}

.sidebar-list::-webkit-scrollbar-track {
	background: transparent;
}

.sidebar-list::-webkit-scrollbar-thumb {
	background: var(--nt-border);
	border-radius: 2px;
}

/* State messages */
.sidebar-state {
	padding: 8px 12px;
	font-size: 12px;
	color: var(--nt-tab-hover);
	font-style: italic;
}

.sidebar-state--error {
	color: var(--nt-badge);
	font-style: normal;
}

/* Footer */
.sidebar-footer {
	flex-shrink: 0;
	padding: 6px 8px;
	border-top: 1px solid var(--nt-border);
}

.sidebar-footer__add-group {
	width: 100%;
	padding: 5px 8px;
	background: none;
	border: 1px dashed var(--nt-tab-hover);
	border-radius: 4px;
	color: var(--nt-text-secondary);
	font-size: 11px;
	cursor: pointer;
	transition: border-color 0.1s, color 0.1s;
	text-align: center;
}

.sidebar-footer__add-group:hover {
	border-color: var(--nt-accent);
	color: var(--nt-accent);
}
</style>
