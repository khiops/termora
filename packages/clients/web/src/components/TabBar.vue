<template>
	<div class="tab-bar" role="tablist" aria-label="Open terminals">
		<button
			v-for="(tab, idx) in tabs"
			:key="tab.channelId"
			role="tab"
			:aria-selected="idx === activeTabIndex"
			:class="['tab', { 'tab--active': idx === activeTabIndex }]"
			:title="tab.label"
			@click="emit('select-tab', idx)"
			@mousedown.middle.prevent="emit('close-tab', idx)"
		>
			<span class="tab__label">{{ tab.label }}</span>
			<span
				class="tab__close"
				role="button"
				:aria-label="`Close ${tab.label}`"
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
import type { Tab } from "../composables/useLayout.js";

defineProps<{
	tabs: Tab[];
	activeTabIndex: number;
}>();

const emit = defineEmits<{
	(e: "select-tab", index: number): void;
	(e: "close-tab", index: number): void;
	(e: "add-tab"): void;
}>();
</script>

<style scoped>
.tab-bar {
	display: flex;
	align-items: stretch;
	background: #181825;
	border-bottom: 1px solid #313244;
	overflow-x: auto;
	overflow-y: hidden;
	flex-shrink: 0;
	min-height: 32px;
	scrollbar-width: none;
}

.tab-bar::-webkit-scrollbar {
	display: none;
}

.tab {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 0 10px 0 12px;
	min-width: 80px;
	max-width: 180px;
	background: #11111b;
	border: none;
	border-right: 1px solid #313244;
	color: #585b70;
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
	background: #1e1e2e;
	color: #bac2de;
}

.tab--active {
	background: #313244;
	color: #cdd6f4;
	border-bottom: 2px solid #89b4fa;
}

.tab--active:hover {
	background: #313244;
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
	color: #585b70;
	transition: opacity 0.1s, background 0.1s, color 0.1s;
}

.tab:hover .tab__close,
.tab--active .tab__close {
	opacity: 1;
}

.tab__close:hover {
	background: #45475a;
	color: #f38ba8;
}

.tab-bar__add {
	flex-shrink: 0;
	width: 32px;
	background: transparent;
	border: none;
	color: #45475a;
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
	color: #89b4fa;
	background: #1e1e2e;
}
</style>
