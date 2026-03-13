<template>
	<div class="quick-command" @keydown.escape.stop="emit('close')">
		<input
			ref="inputRef"
			v-model="commandText"
			class="quick-command__input"
			type="text"
			placeholder="Type command..."
			autocomplete="off"
			spellcheck="false"
			@keydown.enter.prevent="submit"
			@keydown.escape.prevent="emit('close')"
		/>
	</div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useProfilesStore } from "../stores/profiles.js";

const profilesStore = useProfilesStore();

const inputRef = ref<HTMLInputElement | null>(null);
const commandText = ref("");

const emit = defineEmits<{
	(e: "close"): void;
}>();

onMounted(async () => {
	await nextTick();
	inputRef.value?.focus();
});

function submit(): void {
	const trimmed = commandText.value.trim();
	if (trimmed === "") return; // SC-29: no-op on empty
	profilesStore.spawnQuickCommand(trimmed);
	commandText.value = "";
	emit("close");
}
</script>

<style scoped>
.quick-command {
	padding: 4px 6px;
}

.quick-command__input {
	width: 100%;
	background: var(--nt-bg);
	border: 1px solid var(--nt-accent);
	border-radius: 4px;
	color: var(--nt-fg);
	font-family: inherit;
	font-size: 12px;
	padding: 4px 8px;
	outline: none;
	box-sizing: border-box;
}

.quick-command__input::placeholder {
	color: var(--nt-text-secondary);
}
</style>
