<template>
	<div class="setting-row" :class="{ overridden: isNonGlobal && isOverridden, inherited: isNonGlobal && !isOverridden }">
		<div v-if="isNonGlobal && isOverridden" class="override-bar" />
		<div class="setting-main">
			<div class="setting-info">
				<label class="setting-label">{{ label }}</label>
				<p v-if="description" class="setting-description">{{ description }}</p>
				<p v-if="isNonGlobal && !isOverridden && inheritedFrom" class="setting-inherited">
					(inherited: {{ formatInheritedValue(inheritedFrom.value) }}
					<template v-if="inheritedFrom.source === 'host' && hostName">
						— from Host: {{ hostName }}
					</template>
					<template v-else-if="inheritedFrom.source === 'global'">
						— from Global
					</template>
					<template v-else-if="inheritedFrom.source === 'defaults'">
						— default
					</template>)
				</p>
			</div>
			<div class="setting-actions">
				<slot />
				<button
					v-if="isNonGlobal && isOverridden"
					class="reset-button"
					type="button"
					:title="resetLabel"
					@click="emit('reset')"
				>
					{{ resetLabel }}
				</button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Scope } from "../../stores/settings.js";

const props = defineProps<{
	label: string;
	description?: string;
	scope: Scope;
	isOverridden: boolean;
	inheritedFrom?: { value: unknown; source: string } | null;
	hostName?: string;
}>();

const emit = defineEmits<{
	reset: [];
}>();

const isNonGlobal = computed(() => props.scope !== "global");

const resetLabel = computed(() => {
	if (props.scope === "channel") {
		return props.inheritedFrom?.source === "host" ? "reset to host" : "reset to global";
	}
	return "reset to global";
});

function formatInheritedValue(value: unknown): string {
	if (value === null || value === undefined) return "none";
	if (typeof value === "boolean") return value ? "on" : "off";
	return String(value);
}
</script>

<style scoped>
.setting-row {
	position: relative;
	padding: 8px 0;
	border-bottom: 1px solid var(--nt-border);
}

.setting-row.inherited {
	opacity: 0.6;
}

.override-bar {
	position: absolute;
	left: -12px;
	top: 4px;
	bottom: 4px;
	width: 4px;
	background: #3b82f6;
	border-radius: 2px;
}

.setting-main {
	display: flex;
	align-items: center;
	gap: 12px;
}

.setting-info {
	flex: 1;
	min-width: 0;
}

.setting-label {
	font-size: 13px;
	font-weight: 500;
	color: var(--nt-fg);
	display: block;
}

.setting-description {
	margin: 2px 0 0;
	font-size: 11px;
	color: var(--nt-text-secondary);
}

.setting-inherited {
	margin: 2px 0 0;
	font-size: 11px;
	color: var(--nt-text-secondary);
	font-style: italic;
}

.setting-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-shrink: 0;
}

.reset-button {
	padding: 2px 8px;
	font-size: 11px;
	color: #3b82f6;
	background: transparent;
	border: 1px solid #3b82f6;
	border-radius: 3px;
	cursor: pointer;
	white-space: nowrap;
	transition:
		background 0.15s ease,
		color 0.15s ease;
}

.reset-button:hover {
	background: #3b82f6;
	color: #fff;
}
</style>
