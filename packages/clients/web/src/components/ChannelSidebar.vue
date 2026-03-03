<template>
	<div class="channel-sidebar">
		<div class="sidebar-header">Channels</div>
		<div
			v-if="sessionStore.currentChannelId"
			class="channel-item active"
		>
			<span class="channel-icon">&#x276F;</span>
			<span class="channel-label">Terminal 1</span>
		</div>
		<div v-else class="channel-empty">
			<span>No channels</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { useSessionStore } from "../stores/session.js";

const sessionStore = useSessionStore();
</script>

<style scoped>
.channel-sidebar {
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.sidebar-header {
	padding: 12px 12px 8px;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #585b70;
	user-select: none;
}

.channel-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	cursor: pointer;
	font-size: 13px;
	color: #a6adc8;
	border-radius: 4px;
	margin: 0 4px;
	transition: background 0.1s, color 0.1s;
}

.channel-item:hover {
	background: #313244;
	color: #cdd6f4;
}

.channel-item.active {
	background: #313244;
	color: #cdd6f4;
}

.channel-icon {
	font-size: 10px;
	color: #a6e3a1;
}

.channel-empty {
	padding: 8px 12px;
	font-size: 12px;
	color: #45475a;
	font-style: italic;
}
</style>
