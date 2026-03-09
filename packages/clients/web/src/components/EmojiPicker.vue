<template>
	<div class="emoji-picker" @mousedown.prevent>
		<input
			v-model="search"
			type="text"
			class="emoji-search"
			placeholder="Search emojis..."
			autocomplete="off"
		/>
		<div class="emoji-grid">
			<button
				v-for="[shortcode, emoji] in filteredEmojis"
				:key="shortcode"
				type="button"
				class="emoji-cell"
				:title="':' + shortcode + ':'"
				@click="onSelect(emoji)"
			>
				{{ emoji }}
			</button>
			<span v-if="filteredEmojis.length === 0" class="emoji-empty">
				No results
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { EMOJI_SHORTCODES } from "../utils/emoji-shortcodes.js";

const props = defineProps<{
	modelValue: string;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
	close: [];
}>();

const search = ref("");

const filteredEmojis = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return Array.from(EMOJI_SHORTCODES.entries());
	return Array.from(EMOJI_SHORTCODES.entries()).filter(([shortcode]) =>
		shortcode.includes(q),
	);
});

function onSelect(emoji: string): void {
	emit("update:modelValue", emoji);
	emit("close");
}

// Reset search when picker is opened externally
function reset(): void {
	search.value = "";
}

defineExpose({ reset });
</script>

<style scoped>
.emoji-picker {
	position: absolute;
	z-index: 200;
	top: calc(100% + 4px);
	left: 0;
	width: 280px;
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 8px;
	box-shadow: var(--nt-shadow);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.emoji-search {
	padding: 6px 10px;
	border: none;
	border-bottom: 1px solid var(--nt-border);
	background: var(--nt-input-bg, var(--nt-bg-raised, #2a2a2a));
	color: var(--nt-fg);
	font-size: 0.8rem;
	outline: none;
	width: 100%;
	box-sizing: border-box;
}

.emoji-search::placeholder {
	color: var(--nt-fg-muted, #888);
}

.emoji-grid {
	display: grid;
	grid-template-columns: repeat(8, 1fr);
	gap: 2px;
	padding: 6px;
	max-height: 220px;
	overflow-y: auto;
	scrollbar-width: thin;
}

.emoji-cell {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	font-size: 1.1rem;
	background: transparent;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	padding: 0;
	line-height: 1;
	transition: background 0.1s;
}

.emoji-cell:hover {
	background: var(--nt-hover, rgba(255, 255, 255, 0.1));
}

.emoji-empty {
	grid-column: 1 / -1;
	text-align: center;
	color: var(--nt-fg-muted, #888);
	font-size: 0.8rem;
	padding: 12px 0;
}
</style>
