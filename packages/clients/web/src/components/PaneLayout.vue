<template>
	<div ref="containerEl" :class="containerClass">
		<!-- Terminal leaf node -->
		<template v-if="node.type === 'terminal'">
			<TerminalPane
				:channel-id="node.channelId"
				@split-right="(chId) => emit('split', chId, 'vertical')"
				@split-down="(chId) => emit('split', chId, 'horizontal')"
				@close-pane="(chId) => emit('close-pane', chId)"
			/>
		</template>

		<!-- Split node: two children with a splitter between them -->
		<template v-else>
			<!-- First child -->
			<PaneLayout
				:node="node.first"
				:node-path="firstChildPath"
				:style="firstStyle"
				@split="(chId, dir) => emit('split', chId, dir)"
				@close-pane="(chId) => emit('close-pane', chId)"
				@update-ratio="(path, ratio) => emit('update-ratio', path, ratio)"
			/>

			<!-- Drag handle between the two panes -->
			<PaneSplitter
				:direction="node.direction"
				:node-path="effectivePath"
				:container-el="containerEl"
				@update-ratio="(path, ratio) => emit('update-ratio', path, ratio)"
			/>

			<!-- Second child -->
			<PaneLayout
				:node="node.second"
				:node-path="secondChildPath"
				:style="secondStyle"
				@split="(chId, dir) => emit('split', chId, dir)"
				@close-pane="(chId) => emit('close-pane', chId)"
				@update-ratio="(path, ratio) => emit('update-ratio', path, ratio)"
			/>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { NodePath, PaneNode } from "../composables/useLayout.js";
import PaneSplitter from "./PaneSplitter.vue";
import TerminalPane from "./TerminalPane.vue";

// Vue 3 supports recursive components — the component references itself by name.
// The component name is inferred from the filename: "PaneLayout".

const props = defineProps<{
	node: PaneNode;
	/**
	 * Path from the root to this node. Used to pass the correct path to the
	 * PaneSplitter so ratio updates reference the right split node.
	 * Defaults to [] (root).
	 */
	nodePath?: NodePath;
}>();

const emit = defineEmits<{
	(e: "split", channelId: string, direction: "horizontal" | "vertical"): void;
	(e: "close-pane", channelId: string): void;
	(e: "update-ratio", nodePath: NodePath, ratio: number): void;
}>();

const containerEl = ref<HTMLElement | null>(null);

const effectivePath = computed<NodePath>(() => props.nodePath ?? []);

const firstChildPath = computed<NodePath>(() => [...effectivePath.value, "first"]);
const secondChildPath = computed<NodePath>(() => [...effectivePath.value, "second"]);

const containerClass = computed(() => {
	if (props.node.type === "terminal") return "pane-layout pane-layout--terminal";
	return [
		"pane-layout",
		"pane-layout--split",
		props.node.direction === "vertical"
			? "pane-layout--split-vertical"
			: "pane-layout--split-horizontal",
	];
});

const firstStyle = computed(() => {
	if (props.node.type !== "split") return {};
	const r = props.node.ratio;
	return props.node.direction === "vertical"
		? { flexBasis: `${r * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: 0 }
		: { flexBasis: `${r * 100}%`, flexGrow: 0, flexShrink: 0, minHeight: 0 };
});

const secondStyle = computed(() => {
	if (props.node.type !== "split") return {};
	const r = props.node.ratio;
	return props.node.direction === "vertical"
		? { flexBasis: `${(1 - r) * 100}%`, flexGrow: 0, flexShrink: 0, minWidth: 0 }
		: { flexBasis: `${(1 - r) * 100}%`, flexGrow: 0, flexShrink: 0, minHeight: 0 };
});
</script>

<style scoped>
.pane-layout {
	overflow: hidden;
}

.pane-layout--terminal {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
}

.pane-layout--split {
	display: flex;
	width: 100%;
	height: 100%;
}

.pane-layout--split-vertical {
	flex-direction: row;
}

.pane-layout--split-horizontal {
	flex-direction: column;
}
</style>
