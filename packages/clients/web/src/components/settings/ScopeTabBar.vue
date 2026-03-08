<template>
	<div class="scope-tabs" role="tablist">
		<button
			role="tab"
			class="scope-tab"
			:class="{ active: modelValue === 'global' }"
			:aria-selected="modelValue === 'global'"
			@click="emit('update:modelValue', 'global')"
		>
			Global
		</button>
		<button
			v-if="showHost"
			role="tab"
			class="scope-tab"
			:class="{ active: modelValue === 'host' }"
			:aria-selected="modelValue === 'host'"
			@click="emit('update:modelValue', 'host')"
		>
			Host: {{ hostName ?? "—" }}
		</button>
		<button
			v-if="showChannel"
			role="tab"
			class="scope-tab"
			:class="{ active: modelValue === 'channel' }"
			:aria-selected="modelValue === 'channel'"
			@click="emit('update:modelValue', 'channel')"
		>
			Channel: {{ channelName ?? "—" }}
		</button>
	</div>
</template>

<script setup lang="ts">
import type { Scope } from "../../stores/settings.js";

defineProps<{
	modelValue: Scope;
	hostName?: string;
	channelName?: string;
	showHost: boolean;
	showChannel: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: Scope];
}>();
</script>

<style scoped>
.scope-tabs {
	display: flex;
	gap: 0;
	border-bottom: 1px solid var(--nt-border);
	flex-shrink: 0;
	padding: 0 20px;
}

.scope-tab {
	position: relative;
	padding: 10px 16px;
	font-size: 12px;
	font-weight: 500;
	color: var(--nt-text-secondary);
	background: transparent;
	border: none;
	cursor: pointer;
	white-space: nowrap;
	transition: color 0.15s ease;
}

.scope-tab:hover {
	color: var(--nt-fg);
}

.scope-tab.active {
	color: var(--nt-accent);
}

.scope-tab.active::after {
	content: "";
	position: absolute;
	bottom: -1px;
	left: 0;
	right: 0;
	height: 2px;
	background: var(--nt-accent);
	border-radius: 1px 1px 0 0;
}
</style>
