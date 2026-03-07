<template>
	<div class="rail-settings">
		<h4 class="settings-title">Host Rail</h4>
		<label class="settings-row">
			<input
				v-model="settings.showLabels"
				type="checkbox"
				class="settings-checkbox"
			/>
			<span class="settings-label">Show labels</span>
		</label>
		<label class="settings-row">
			<input
				v-model="settings.showStatusDots"
				type="checkbox"
				class="settings-checkbox"
			/>
			<span class="settings-label">Show status dots</span>
		</label>
	</div>
</template>

<script setup lang="ts">
import { useHostRailSettings } from "../composables/useHostRailSettings.js";

const settings = useHostRailSettings();
</script>

<style scoped>
.rail-settings {
	padding: 12px 0;
}

.settings-title {
	margin: 0 0 8px;
	font-size: 11px;
	font-weight: 600;
	color: var(--nt-text-secondary);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

.settings-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 0;
	cursor: pointer;
	font-size: 12px;
}

.settings-checkbox {
	accent-color: var(--nt-accent);
	flex-shrink: 0;
}

.settings-label {
	color: var(--nt-fg);
}
</style>
