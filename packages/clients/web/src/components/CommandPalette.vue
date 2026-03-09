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
							<span class="palette-item-icon" aria-hidden="true">
							<img v-if="item.iconUrl" :src="item.iconUrl" class="palette-icon-img" />
							<template v-else>{{ item.icon }}</template>
						</span>
							<span class="palette-item-text">
								<span class="palette-item-label">{{ item.label }}</span>
								<span v-if="item.description" class="palette-item-desc">{{ item.description }}</span>
							</span>
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
import { useCommandPalette, type PaletteItem, type PaletteItemType } from "../composables/useCommandPalette.js";

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

type GroupKey = PaletteItemType | "recent";

/**
 * Returns an ordered array of [groupKey, items] tuples so v-for can
 * iterate with fully-typed destructuring in the template.
 *
 * When query is empty and there are recent items, they appear first under
 * a "Recent" heading (SC-21). The remaining items are grouped by type.
 */
const groupedResults = computed((): [GroupKey, PaletteItem[]][] => {
	const groups: [GroupKey, PaletteItem[]][] = [];

	// Recent section (SC-21) — only shown on empty query / no prefix
	const recent = palette.recentResults.value;
	if (recent.length > 0) {
		groups.push(["recent", recent]);
	}

	// Non-recent items grouped by type
	const recentIds = new Set(recent.map((it) => it.id));
	const remaining = palette.results.value.filter((it) => !recentIds.has(it.id));

	const map = new Map<PaletteItemType, PaletteItem[]>();
	for (const item of remaining) {
		const bucket = map.get(item.type) ?? [];
		bucket.push(item);
		map.set(item.type, bucket);
	}
	for (const [type, items] of map.entries()) {
		groups.push([type, items]);
	}

	return groups;
});

function groupLabel(type: GroupKey): string {
	switch (type) {
		case "recent":
			return "Recent";
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
	background: var(--nt-overlay);
	display: flex;
	align-items: flex-start;
	justify-content: center;
	padding-top: 80px;
	z-index: 1000;
}

/* ── Card ─────────────────────────────────────────────────────────────────── */
.palette-card {
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 8px;
	box-shadow: var(--nt-shadow);
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
	border-bottom: 1px solid var(--nt-border);
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
	color: var(--nt-fg);
	font-size: 15px;
	font-family: inherit;
	caret-color: var(--nt-accent);
}

.palette-input::placeholder {
	color: var(--nt-tab-hover);
}

/* ── Results list ─────────────────────────────────────────────────────────── */
.palette-results {
	max-height: 360px;
	overflow-y: auto;
	padding: 4px 0;
	scrollbar-width: thin;
	scrollbar-color: var(--nt-border) transparent;
}

.palette-results::-webkit-scrollbar {
	width: 6px;
}

.palette-results::-webkit-scrollbar-track {
	background: transparent;
}

.palette-results::-webkit-scrollbar-thumb {
	background: var(--nt-border);
	border-radius: 3px;
}

/* ── Group label ──────────────────────────────────────────────────────────── */
.palette-group-label {
	padding: 6px 16px 2px;
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nt-text-secondary);
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
	color: var(--nt-fg);
	font-size: 13px;
	font-family: inherit;
	transition: background 0.08s;
}

.palette-item:hover,
.palette-item.selected {
	background: var(--nt-border);
}

.palette-item-icon {
	font-size: 14px;
	flex-shrink: 0;
	width: 20px;
	height: 20px;
	text-align: center;
	display: flex;
	align-items: center;
	justify-content: center;
}

.palette-icon-img {
	width: 18px;
	height: 18px;
	border-radius: 4px;
	object-fit: cover;
}

.palette-item-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.palette-item-label {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.palette-item-desc {
	font-size: 11px;
	color: var(--nt-text-secondary);
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
	background: rgba(var(--nt-accent-rgb), 0.12);
	color: var(--nt-accent);
	border: 1px solid rgba(var(--nt-accent-rgb), 0.25);
}

.palette-item-badge[data-type="channel"] {
	background: rgba(var(--nt-green-rgb), 0.12);
	color: var(--nt-green);
	border: 1px solid rgba(var(--nt-green-rgb), 0.25);
}

.palette-item-badge[data-type="action"] {
	background: rgba(var(--nt-accent-rgb), 0.12);
	color: var(--nt-magenta);
	border: 1px solid rgba(var(--nt-accent-rgb), 0.25);
}

/* ── Shortcut hint ────────────────────────────────────────────────────────── */
.palette-item-shortcut {
	font-size: 11px;
	color: var(--nt-text-secondary);
	font-family: ui-monospace, monospace;
	flex-shrink: 0;
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
.palette-empty {
	padding: 24px 16px;
	text-align: center;
	color: var(--nt-tab-hover);
	font-size: 13px;
	font-style: italic;
}
</style>
