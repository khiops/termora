<template>
	<div
		v-if="text"
		class="environment-banner"
		:style="{ backgroundColor: bgColor, color: textColor }"
	>
		{{ text }}
	</div>
</template>

<script setup lang="ts">
defineProps<{
	text: string;
	bgColor: string;
	textColor: string;
}>();
</script>

<style scoped>
.environment-banner {
	flex-shrink: 0;
	padding: 2px 10px;
	font-size: 11px;
	font-weight: 700;
	text-align: center;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	user-select: none;
}
</style>
