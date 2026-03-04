<template>
	<Teleport to="body">
		<div
			v-if="palette.isOpen.value"
			class="palette-overlay"
			@mousedown.self="palette.close"
		>
			<div
				class="palette-card"
				role="dialog"
				aria-label="Command Palette"
				aria-modal="true"
			>
				<!-- Search input -->
				<div class="palette-search">
					<span class="palette-search-icon" aria-hidden="true">🔍</span>
					<input
						ref="inputRef"
						v-model="localQuery"
						class="palette-input"
						type="text"
						placeholder="Type a command..."
						autocomplete="off"
						spellcheck="false"
						@input="palette.search(localQuery)"
						@keydown.up.prevent="palette.moveUp"
						@keydown.down.prevent="palette.moveDown"
						@keydown.enter.prevent="palette.executeSelected"
						@keydown.esc.prevent="palette.close"
					/>
				</div>

				<!-- Results list -->
				<div
					v-if="palette.results.value.length > 0"
					class="palette-results"
					role="listbox"
				>
					<template
						v-for="[groupKey, group] in groupedResults"
						:key="groupKey"
					>
						<div class="palette-group-label">{{ groupLabel(groupKey) }}</div>
						<button
							v-for="item in group"
							:key="item.id"
							class="palette-item"
							:class="{ selected: palette.results.value.indexOf(item) === palette.selectedIndex.value }"
							role="option"
							:aria-selected="palette.results.value.indexOf(item) === palette.selectedIndex.value"
							type="button"
							@click="palette.execute(item)"
							@mouseenter="palette.selectedIndex.value = palette.results.value.indexOf(item)"
						>
							<span class="palette-item-icon" aria-hidden="true">{{ item.icon }}</span>
							<span class="palette-item-label">{{ item.label }}</span>
							<span class="palette-item-badge" :data-type="item.type">
								{{ typeBadge(item.type) }}
							</span>
							<span v-if="item.shortcut" class="palette-item-shortcut">
								{{ item.shortcut }}
							</span>
						</button>
					</template>
				</div>

				<!-- Empty state -->
				<div v-else class="palette-empty">No results for "{{ localQuery }}"</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from "vue";
import { useCommandPalette, type PaletteItemType } from "../composables/useCommandPalette.js";

const palette = useCommandPalette();

const inputRef = ref<HTMLInputElement | null>(null);
const localQuery = ref("");

// Auto-focus input whenever the palette opens
watch(
	() => palette.isOpen.value,
	async (open) => {
		if (open) {
			localQuery.value = "";
			await nextTick();
			inputRef.value?.focus();
		}
	},
);

// ── Grouping ──────────────────────────────────────────────────────────────────

/**
 * Returns an ordered array of [groupKey, items] tuples so v-for can
 * iterate with fully-typed destructuring in the template.
 */
const groupedResults = computed((): [PaletteItemType, typeof palette.results.value][] => {
	const map = new Map<PaletteItemType, typeof palette.results.value>();
	for (const item of palette.results.value) {
		const bucket = map.get(item.type) ?? [];
		bucket.push(item);
		map.set(item.type, bucket);
	}
	return Array.from(map.entries()) as [PaletteItemType, typeof palette.results.value][];
});

function groupLabel(type: PaletteItemType): string {
	switch (type) {
		case "host":
			return "Hosts";
		case "channel":
			return "Channels";
		case "action":
			return "Actions";
	}
}

function typeBadge(type: PaletteItemType): string {
	switch (type) {
		case "host":
			return "Host";
		case "channel":
			return "Channel";
		case "action":
			return "Action";
	}
}
</script>

<style scoped>
/* ── Overlay ──────────────────────────────────────────────────────────────── */
.palette-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: flex-start;
	justify-content: center;
	padding-top: 80px;
	z-index: 1000;
}

/* ── Card ─────────────────────────────────────────────────────────────────── */
.palette-card {
	background: #1e1e2e;
	border: 1px solid #313244;
	border-radius: 8px;
	box-shadow:
		0 8px 32px rgba(0, 0, 0, 0.6),
		0 2px 8px rgba(0, 0, 0, 0.4);
	width: 560px;
	max-width: calc(100vw - 32px);
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

/* ── Search row ───────────────────────────────────────────────────────────── */
.palette-search {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	border-bottom: 1px solid #313244;
}

.palette-search-icon {
	font-size: 16px;
	flex-shrink: 0;
	opacity: 0.6;
}

.palette-input {
	flex: 1;
	background: transparent;
	border: none;
	outline: none;
	color: #cdd6f4;
	font-size: 15px;
	font-family: inherit;
	caret-color: #89b4fa;
}

.palette-input::placeholder {
	color: #45475a;
}

/* ── Results list ─────────────────────────────────────────────────────────── */
.palette-results {
	max-height: 360px;
	overflow-y: auto;
	padding: 4px 0;
	scrollbar-width: thin;
	scrollbar-color: #313244 transparent;
}

.palette-results::-webkit-scrollbar {
	width: 6px;
}

.palette-results::-webkit-scrollbar-track {
	background: transparent;
}

.palette-results::-webkit-scrollbar-thumb {
	background: #313244;
	border-radius: 3px;
}

/* ── Group label ──────────────────────────────────────────────────────────── */
.palette-group-label {
	padding: 6px 16px 2px;
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: #585b70;
	user-select: none;
}

/* ── Result item ──────────────────────────────────────────────────────────── */
.palette-item {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 7px 16px;
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;
	color: #cdd6f4;
	font-size: 13px;
	font-family: inherit;
	transition: background 0.08s;
}

.palette-item:hover,
.palette-item.selected {
	background: #313244;
}

.palette-item-icon {
	font-size: 14px;
	flex-shrink: 0;
	width: 20px;
	text-align: center;
}

.palette-item-label {
	flex: 1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* ── Type badge ───────────────────────────────────────────────────────────── */
.palette-item-badge {
	font-size: 10px;
	font-weight: 600;
	padding: 2px 6px;
	border-radius: 4px;
	letter-spacing: 0.04em;
	flex-shrink: 0;
}

.palette-item-badge[data-type="host"] {
	background: rgba(137, 180, 250, 0.12);
	color: #89b4fa;
	border: 1px solid rgba(137, 180, 250, 0.25);
}

.palette-item-badge[data-type="channel"] {
	background: rgba(166, 227, 161, 0.12);
	color: #a6e3a1;
	border: 1px solid rgba(166, 227, 161, 0.25);
}

.palette-item-badge[data-type="action"] {
	background: rgba(203, 166, 247, 0.12);
	color: #cba6f7;
	border: 1px solid rgba(203, 166, 247, 0.25);
}

/* ── Shortcut hint ────────────────────────────────────────────────────────── */
.palette-item-shortcut {
	font-size: 11px;
	color: #585b70;
	font-family: ui-monospace, monospace;
	flex-shrink: 0;
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
.palette-empty {
	padding: 24px 16px;
	text-align: center;
	color: #45475a;
	font-size: 13px;
	font-style: italic;
}
</style>
