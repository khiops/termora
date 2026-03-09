<template>
	<div class="vacant-pane">
		<div class="vacant-header">Empty Pane</div>
		<div class="vacant-options">
			<button class="vacant-btn vacant-btn-new" @click="emit('new-terminal', vacantId)">
				+ New Terminal
			</button>
			<div v-if="detachedChannels.length > 0" class="vacant-divider" />
			<button
				v-for="ch in detachedChannels"
				:key="ch.id"
				class="vacant-channel"
				@click="emit('select-channel', vacantId, ch.id)"
			>
				{{ ch.title || "Terminal" }}
			</button>
		</div>
		<button class="vacant-rearrange" @click="emit('rearrange', vacantId)">
			Remove slot
		</button>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useChannelsStore } from "../stores/channels.js";

const props = defineProps<{
	vacantId: string;
	hostId: string | null;
}>();

const emit = defineEmits<{
	(e: "select-channel", vacantId: string, channelId: string): void;
	(e: "new-terminal", vacantId: string): void;
	(e: "rearrange", vacantId: string): void;
}>();

const channelsStore = useChannelsStore();

/**
 * Channels that are alive and could be attached to this vacant slot.
 * Full "detached" filtering (not in any visible pane) will be refined
 * in later blocks.
 */
const detachedChannels = computed(() => {
	if (!props.hostId) return [];
	return channelsStore.channels.filter(
		(c) => c.status !== "dead" && channelsStore.channelHostMap.get(c.id) === props.hostId,
	);
});
</script>

<style scoped>
.vacant-pane {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	gap: 16px;
	background: var(--nt-bg-surface, var(--nt-bg));
	border: 1px dashed var(--nt-border);
}

.vacant-header {
	font-size: 13px;
	font-weight: 600;
	color: var(--nt-text-secondary);
	letter-spacing: 0.04em;
}

.vacant-options {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 4px;
	min-width: 180px;
	max-width: 260px;
}

.vacant-btn {
	padding: 8px 14px;
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	background: transparent;
	color: var(--nt-fg);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
	text-align: left;
	transition: background 0.12s;
}

.vacant-btn:hover {
	background: var(--nt-tab-hover);
}

.vacant-btn-new {
	font-weight: 600;
	color: var(--nt-accent, var(--nt-fg));
}

.vacant-divider {
	height: 1px;
	background: var(--nt-border);
	margin: 4px 0;
}

.vacant-channel {
	padding: 6px 14px;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--nt-fg);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
	text-align: left;
	transition: background 0.12s;
}

.vacant-channel:hover {
	background: var(--nt-tab-hover);
}

.vacant-rearrange {
	padding: 4px 10px;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--nt-text-muted);
	font-size: 11px;
	font-family: inherit;
	cursor: pointer;
	transition: color 0.12s;
}

.vacant-rearrange:hover {
	color: var(--nt-fg);
}
</style>
