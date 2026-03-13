<template>
	<div class="setting-control">
		<input
			v-if="type === 'text'"
			type="text"
			class="control-text"
			:value="modelValue"
			:disabled="disabled"
			:placeholder="placeholder"
			@input="onInput"
		/>

		<input
			v-else-if="type === 'number'"
			type="number"
			class="control-number"
			:value="modelValue"
			:min="min"
			:max="max"
			:step="step"
			:disabled="disabled"
			@input="onInput"
		/>

		<select
			v-else-if="type === 'select'"
			class="control-select"
			:value="modelValue"
			:disabled="disabled"
			@change="onSelectChange"
		>
			<option
				v-for="opt in options"
				:key="String(opt.value)"
				:value="opt.value"
			>
				{{ opt.label }}
			</option>
		</select>

		<label v-else-if="type === 'toggle'" class="control-toggle">
			<input
				type="checkbox"
				:checked="Boolean(modelValue)"
				:disabled="disabled"
				@change="onToggleChange"
			/>
			<span class="toggle-track">
				<span class="toggle-thumb" />
			</span>
		</label>

		<div v-else-if="type === 'range'" class="control-range-wrapper">
			<input
				type="range"
				class="control-range"
				:value="modelValue"
				:min="min"
				:max="max"
				:step="step"
				:disabled="disabled"
				@input="onInput"
			/>
			<span class="range-value">{{ modelValue }}</span>
		</div>

		<input
			v-else-if="type === 'color'"
			type="color"
			class="control-color"
			:value="modelValue"
			:disabled="disabled"
			@input="onInput"
		/>
	</div>
</template>

<script setup lang="ts">
defineProps<{
	modelValue: unknown;
	type: "text" | "number" | "select" | "toggle" | "range" | "color";
	options?: { label: string; value: string | number }[];
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	placeholder?: string;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: unknown];
}>();

function onInput(event: Event): void {
	const target = event.target as HTMLInputElement;
	const inputType = target.type;
	if (inputType === "number" || inputType === "range") {
		const parsed = Number.parseFloat(target.value);
		emit("update:modelValue", Number.isNaN(parsed) ? target.value : parsed);
	} else {
		emit("update:modelValue", target.value);
	}
}

function onSelectChange(event: Event): void {
	const target = event.target as HTMLSelectElement;
	emit("update:modelValue", target.value);
}

function onToggleChange(event: Event): void {
	const target = event.target as HTMLInputElement;
	emit("update:modelValue", target.checked);
}
</script>

<style scoped>
.setting-control {
	display: inline-flex;
	align-items: center;
}

.control-text,
.control-number {
	padding: 4px 8px;
	font-size: 12px;
	background: var(--nt-border);
	color: var(--nt-fg);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	min-width: 120px;
}

.control-number {
	min-width: 80px;
}

.control-text:focus,
.control-number:focus {
	outline: 1px solid var(--nt-accent);
}

.control-select {
	padding: 4px 8px;
	font-size: 12px;
	background: var(--nt-border);
	color: var(--nt-fg);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	cursor: pointer;
	min-width: 140px;
}

.control-select:focus {
	outline: 1px solid var(--nt-accent);
}

/* ── Toggle switch ─────────────────────────────────────────────────── */

.control-toggle {
	cursor: pointer;
	display: inline-flex;
	align-items: center;
}

.control-toggle input {
	position: absolute;
	opacity: 0;
	width: 0;
	height: 0;
}

.toggle-track {
	position: relative;
	display: inline-block;
	width: 36px;
	height: 20px;
	background: var(--nt-border);
	border-radius: 10px;
	transition: background 0.2s ease;
}

.control-toggle input:checked + .toggle-track {
	background: var(--nt-accent);
}

.toggle-thumb {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 16px;
	height: 16px;
	background: #fff;
	border-radius: 50%;
	transition: transform 0.2s ease;
}

.control-toggle input:checked + .toggle-track .toggle-thumb {
	transform: translateX(16px);
}

/* ── Range ─────────────────────────────────────────────────────────── */

.control-range-wrapper {
	display: flex;
	align-items: center;
	gap: 8px;
}

.control-range {
	flex: 1;
	max-width: 140px;
	accent-color: var(--nt-accent);
	cursor: pointer;
}

.range-value {
	font-size: 12px;
	color: var(--nt-text-secondary);
	min-width: 32px;
	text-align: right;
}

/* ── Color ─────────────────────────────────────────────────────────── */

.control-color {
	width: 32px;
	height: 24px;
	padding: 0;
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	cursor: pointer;
	background: transparent;
}

/* ── Disabled state ────────────────────────────────────────────────── */

.control-text:disabled,
.control-number:disabled,
.control-select:disabled,
.control-range:disabled,
.control-color:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.control-toggle:has(input:disabled) {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
