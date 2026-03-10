<template>
	<Teleport to="body">
		<div
			v-if="visible"
			ref="menuEl"
			class="ctx-menu"
			:style="{ left: `${x}px`, top: `${y}px` }"
			@click.stop
		>
			<button v-if="!isGeneral" class="ctx-item" @click="onRename">
				Rename Group
			</button>
			<button v-if="hasDeadChannels" class="ctx-item" @click="onPurgeDead">
				Clean Up Dead Terminals
			</button>
			<template v-if="!isGeneral">
				<div class="ctx-sep" />
				<button class="ctx-item ctx-item--danger" @click="onDelete">
					Delete Group
				</button>
			</template>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
	visible: boolean;
	groupId: string;
	groupName: string;
	x: number;
	y: number;
	hasDeadChannels?: boolean;
}>();

const emit = defineEmits<{
	(e: "close"): void;
	(e: "rename", groupId: string): void;
	(e: "delete-group", groupId: string): void;
	(e: "purge-dead", groupId: string): void;
}>();

const isGeneral = computed(() => props.groupId === "__general__");

const menuEl = ref<HTMLElement | null>(null);

// ── Click-outside close ──────────────────────────────────────────────────

function onClickOutside(event: MouseEvent): void {
	if (menuEl.value && !menuEl.value.contains(event.target as Node)) {
		emit("close");
	}
}

onMounted(() => {
	document.addEventListener("mousedown", onClickOutside, true);
});

onUnmounted(() => {
	document.removeEventListener("mousedown", onClickOutside, true);
});

// ── Action handlers ──────────────────────────────────────────────────────

function onRename(): void {
	emit("rename", props.groupId);
	emit("close");
}

function onDelete(): void {
	emit("delete-group", props.groupId);
	emit("close");
}

function onPurgeDead(): void {
	emit("purge-dead", props.groupId);
	emit("close");
}
</script>

<style scoped>
.ctx-menu {
	position: fixed;
	z-index: 9999;
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 6px;
	padding: 4px 0;
	min-width: 180px;
	box-shadow: var(--nt-shadow);
}

.ctx-item {
	display: block;
	width: 100%;
	padding: 6px 12px;
	font-size: 12px;
	font-family: inherit;
	color: var(--nt-fg);
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;
	transition: background 0.08s;
}

.ctx-item:hover:not(:disabled) {
	background: var(--nt-tab-hover);
}

.ctx-item--danger {
	color: var(--nt-red, #e06c75);
}

.ctx-item--danger:hover {
	background: rgba(224, 108, 117, 0.12);
}

.ctx-sep {
	border-top: 1px solid var(--nt-border);
	margin: 4px 0;
}
</style>
