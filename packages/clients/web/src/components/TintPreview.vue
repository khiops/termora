<template>
	<div class="tint-preview">
		<div class="tint-preview__terminal">
			<div class="tint-preview__line">$ ssh production</div>
			<div class="tint-preview__line tint-preview__line--dim">Connected to 10.0.1.5</div>
			<div class="tint-preview__line">deploy@prod:~$</div>
		</div>
		<div v-if="tintColor && opacity > 0" class="tint-preview__overlay" :style="overlayStyle" />
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
	tintColor: string;
	opacity: number;
}>();

const overlayStyle = computed(() => {
	const hex = props.tintColor;
	if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return {};
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return {
		backgroundColor: `rgba(${r}, ${g}, ${b}, ${props.opacity / 100})`,
	};
});
</script>

<style scoped>
.tint-preview {
	position: relative;
	background: #1e1e1e;
	border-radius: 4px;
	padding: 8px 10px;
	font-family: "Consolas", "Liberation Mono", monospace;
	font-size: 11px;
	line-height: 1.5;
	overflow: hidden;
}

.tint-preview__line {
	color: #d4d4d4;
}

.tint-preview__line--dim {
	color: #6a737d;
}

.tint-preview__overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
}
</style>
