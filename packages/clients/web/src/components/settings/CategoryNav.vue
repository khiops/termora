<template>
	<nav class="category-nav" aria-label="Settings categories">
		<button
			v-for="cat in visibleCategories"
			:key="cat.id"
			class="category-item"
			:class="{ active: modelValue === cat.id }"
			@click="emit('update:modelValue', cat.id)"
		>
			{{ cat.label }}
		</button>
	</nav>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import type { Scope } from "../../stores/settings.js";
import { getVisibleSettingsCategories } from "./settingsCategories.js";

const props = defineProps<{
	modelValue: string;
	scope: Scope;
	showDesktop?: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
}>();

const visibleCategories = computed(() =>
	getVisibleSettingsCategories(props.scope, props.showDesktop === true),
);

// Auto-select first visible category if the active one becomes hidden after scope change
watch(
	visibleCategories,
	(cats) => {
		if (cats.length > 0 && !cats.some((c) => c.id === props.modelValue)) {
			emit("update:modelValue", cats[0]!.id);
		}
	},
	{ immediate: true },
);
</script>

<style scoped>
.category-nav {
	width: 160px;
	min-width: 160px;
	border-right: 1px solid var(--nt-border);
	padding: 12px 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	overflow-y: auto;
}

.category-item {
	display: block;
	width: 100%;
	padding: 8px 20px;
	font-size: 13px;
	color: var(--nt-text-secondary);
	background: transparent;
	border: none;
	text-align: left;
	cursor: pointer;
	transition:
		color 0.15s ease,
		background 0.15s ease;
	border-radius: 0;
}

.category-item:hover {
	color: var(--nt-fg);
	background: var(--nt-hover);
}

.category-item.active {
	color: var(--nt-fg);
	font-weight: 600;
	background: var(--nt-bg-surface);
}
</style>
