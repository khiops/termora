<template>
	<div
		:class="['pane-splitter', `pane-splitter--${direction}`]"
		role="separator"
		:aria-orientation="direction === 'vertical' ? 'vertical' : 'horizontal'"
		@mousedown="onMouseDown"
	/>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import type { NodePath } from "../composables/useLayout.js";

const props = defineProps<{
	direction: "horizontal" | "vertical";
	/**
	 * Path to the split node in the pane tree. Passed back to the parent
	 * via `update-ratio` so the layout composable can update the right node.
	 */
	nodePath: NodePath;
	/**
	 * DOM element reference for the containing split container, used to
	 * compute the new ratio from mouse position.
	 */
	containerEl: HTMLElement | null;
}>();

const emit = defineEmits<{
	(e: "update-ratio", nodePath: NodePath, ratio: number): void;
}>();

let dragging = false;

function onMouseDown(event: MouseEvent): void {
	event.preventDefault();
	dragging = true;
	document.addEventListener("mousemove", onMouseMove);
	document.addEventListener("mouseup", onMouseUp);
}

function onMouseMove(event: MouseEvent): void {
	if (!dragging || props.containerEl === null) return;

	const rect = props.containerEl.getBoundingClientRect();
	let ratio: number;

	if (props.direction === "vertical") {
		// Vertical split: left | right — ratio controls width of first pane
		ratio = (event.clientX - rect.left) / rect.width;
	} else {
		// Horizontal split: top / bottom — ratio controls height of first pane
		ratio = (event.clientY - rect.top) / rect.height;
	}

	emit("update-ratio", props.nodePath, ratio);
}

function onMouseUp(): void {
	dragging = false;
	document.removeEventListener("mousemove", onMouseMove);
	document.removeEventListener("mouseup", onMouseUp);
}

onUnmounted(() => {
	document.removeEventListener("mousemove", onMouseMove);
	document.removeEventListener("mouseup", onMouseUp);
});
</script>

<style scoped>
.pane-splitter {
	background: var(--nt-border);
	flex-shrink: 0;
	transition: background 0.15s;
	z-index: 10;
}

.pane-splitter:hover,
.pane-splitter:active {
	background: var(--nt-text-secondary);
}

.pane-splitter--vertical {
	width: 4px;
	cursor: col-resize;
	height: 100%;
}

.pane-splitter--horizontal {
	height: 4px;
	cursor: row-resize;
	width: 100%;
}
</style>
