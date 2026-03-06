<template>
	<div v-if="!isDead" class="wl-indicator" :class="stateClass" :title="tooltip">
		<span class="wl-dot" aria-hidden="true" />
		<span class="wl-label">{{ label }}</span>

		<button
			v-if="isReader && channelId && !isDead"
			class="wl-action-btn"
			@click="handleClaim"
			title="Request write access"
		>
			Request Write
		</button>

		<button
			v-if="isReader && channelId && !isDead"
			class="wl-action-btn wl-force"
			@click="handleForce"
			title="Force-take write lock immediately"
		>
			Force Take
		</button>

		<button
			v-if="isCurrentWriter && channelId && !isDead"
			class="wl-action-btn wl-release"
			@click="handleRelease"
			title="Release your write lock"
		>
			Release
		</button>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useWriteLockStore } from "../stores/writelock.js";
import { useAuthStore } from "../stores/auth.js";

const props = defineProps<{
	channelId: string | null;
	isDead?: boolean;
}>();

const writeLockStore = useWriteLockStore();
const authStore = useAuthStore();

const lockState = computed(() => {
	if (!props.channelId) return null;
	return writeLockStore.locks.get(props.channelId) ?? null;
});

const isCurrentWriter = computed(() => {
	if (!props.channelId) return false;
	return writeLockStore.isWriter(props.channelId);
});

const isReader = computed(() => {
	if (!props.channelId) return false;
	// Reader = authenticated but not the current writer
	return authStore.clientId !== null && !isCurrentWriter.value;
});

const hasHolder = computed(() => lockState.value?.holder !== null && lockState.value?.holder !== undefined);

const stateClass = computed(() => {
	if (isCurrentWriter.value) return "state-writer";
	if (hasHolder.value) return "state-reader";
	return "state-free";
});

const label = computed(() => {
	if (isCurrentWriter.value) return "Writer";
	if (hasHolder.value) return "Reader";
	return "No lock";
});

const tooltip = computed(() => {
	const holder = lockState.value?.holder;
	if (isCurrentWriter.value) return "You have write access";
	if (holder) return `Client ${holder} holds write access`;
	return "No client holds write access";
});

function handleClaim(): void {
	if (props.channelId) writeLockStore.claim(props.channelId);
}

function handleForce(): void {
	if (props.channelId) writeLockStore.forceTake(props.channelId);
}

function handleRelease(): void {
	if (props.channelId) writeLockStore.release(props.channelId);
}
</script>

<style scoped>
.wl-indicator {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 3px 8px;
	border-radius: 4px;
	font-size: 11px;
	font-weight: 500;
	user-select: none;
	background: rgba(0, 0, 0, 0.2);
}

.wl-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	flex-shrink: 0;
}

.state-writer .wl-dot {
	background: #a6e3a1;
	box-shadow: 0 0 6px #a6e3a1;
}

.state-writer .wl-label {
	color: #a6e3a1;
}

.state-reader .wl-dot {
	background: #585b70;
}

.state-reader .wl-label {
	color: #a6adc8;
}

.state-free .wl-dot {
	background: #45475a;
}

.state-free .wl-label {
	color: #585b70;
}

.wl-action-btn {
	height: 18px;
	padding: 0 6px;
	background: #313244;
	border: 1px solid #45475a;
	border-radius: 3px;
	color: #a6adc8;
	font-size: 10px;
	cursor: pointer;
	transition: background 0.12s, color 0.12s;
	white-space: nowrap;
	line-height: 1;
}

.wl-action-btn:hover {
	background: #45475a;
	color: #cdd6f4;
}

.wl-force {
	border-color: #f38ba8;
	color: #f38ba8;
}

.wl-force:hover {
	background: rgba(243, 139, 168, 0.15);
	color: #f38ba8;
}

.wl-release {
	border-color: #f9e2af;
	color: #f9e2af;
}

.wl-release:hover {
	background: rgba(249, 226, 175, 0.15);
	color: #f9e2af;
}
</style>
