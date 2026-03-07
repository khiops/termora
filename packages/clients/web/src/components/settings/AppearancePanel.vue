<template>
	<Teleport to="body">
		<div
			v-if="visible"
			class="appearance-overlay"
			@mousedown.self="$emit('close')"
		>
			<div
				class="appearance-panel"
				role="dialog"
				aria-label="Appearance"
				aria-modal="true"
			>
				<div class="appearance-header">
					<h2 class="appearance-title">Appearance</h2>
					<button
						class="appearance-close"
						type="button"
						aria-label="Close appearance panel"
						@click="$emit('close')"
					>
						&#10005;
					</button>
				</div>
				<div class="appearance-body">
					<ThemeEditor
						v-if="editorMode === 'editor'"
						v-bind="editorProps"
						@saved="handleEditorSaved"
						@close="editorMode = 'picker'"
					/>
					<template v-else>
						<ThemePicker
							@create-theme="openNewTheme"
							@edit-theme="openEditTheme"
						/>

						<section class="appearance-section">
							<h3 class="section-title">Auto-Switch</h3>
							<div class="setting-row">
								<label class="setting-label">Follow OS dark mode</label>
								<input
									type="checkbox"
									class="setting-checkbox"
									:checked="autoSwitch.enabled.value"
									@change="onAutoSwitchToggle"
								/>
							</div>
							<div v-if="autoSwitch.enabled.value" class="setting-row">
								<label class="setting-label">Dark theme</label>
								<select
									class="setting-select"
									:value="autoSwitch.darkThemeName.value"
									@change="onAutoSwitchDarkChange"
								>
									<option
										v-for="t in darkThemes"
										:key="t.name"
										:value="t.name"
									>
										{{ t.name }}
									</option>
								</select>
							</div>
							<div v-if="autoSwitch.enabled.value" class="setting-row">
								<label class="setting-label">Light theme</label>
								<select
									class="setting-select"
									:value="autoSwitch.lightThemeName.value"
									@change="onAutoSwitchLightChange"
								>
									<option
										v-for="t in lightThemes"
										:key="t.name"
										:value="t.name"
									>
										{{ t.name }}
									</option>
								</select>
							</div>
						</section>

						<section class="appearance-section">
							<h3 class="section-title">Opacity</h3>
							<div
								v-for="(label, key) in opacityLabels"
								:key="key"
								class="setting-row"
							>
								<label class="setting-label">{{ label }}</label>
								<input
									type="range"
									class="setting-range"
									min="20"
									max="100"
									:value="opacity[key]"
									@input="onOpacityInput(key, $event)"
								/>
								<span class="setting-value">{{ opacity[key] }}%</span>
							</div>
						</section>

						<section class="appearance-section">
							<h3 class="section-title">Scrollbar</h3>
							<div class="setting-row">
								<label class="setting-label">Style</label>
								<select
									class="setting-select"
									:value="scrollbarStyle"
									@change="onScrollbarChange"
								>
									<option value="thin">Thin (6px)</option>
									<option value="wide">Wide (14px)</option>
									<option value="hidden">Hidden</option>
								</select>
							</div>
						</section>
					</template>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from "vue";
import type { AppearanceConfig, NexTermTheme } from "@nexterm/shared";
import ThemePicker from "./ThemePicker.vue";
import ThemeEditor from "./ThemeEditor.vue";
import { useAutoSwitch } from "../../composables/useAutoSwitch.js";
import { useThemeStore } from "../../stores/theme.js";

defineProps<{
	visible: boolean;
}>();

defineEmits<{
	close: [];
}>();

const themeStore = useThemeStore();
const autoSwitch = useAutoSwitch();

// ── Editor state ──────────────────────────────────────────────────────

const editorMode = ref<"picker" | "editor">("picker");
const editingTheme = ref<NexTermTheme | undefined>(undefined);
const baseTheme = ref<NexTermTheme | undefined>(undefined);

/** Build props conditionally to satisfy exactOptionalPropertyTypes. */
const editorProps = computed(() => {
	const p: Record<string, NexTermTheme> = {};
	if (editingTheme.value !== undefined) {
		p.theme = editingTheme.value;
	}
	if (baseTheme.value !== undefined) {
		p.baseTheme = baseTheme.value;
	}
	return p;
});

function openNewTheme() {
	editingTheme.value = undefined;
	baseTheme.value = undefined;
	editorMode.value = "editor";
}

function openEditTheme(theme: NexTermTheme) {
	editingTheme.value = theme;
	baseTheme.value = undefined;
	editorMode.value = "editor";
}

function handleEditorSaved(_theme: NexTermTheme) {
	editorMode.value = "picker";
	editingTheme.value = undefined;
	baseTheme.value = undefined;
}

// ── Auto-switch ───────────────────────────────────────────────────────

const darkThemes = computed(() =>
	themeStore.availableThemes.filter((t) => t.type === "dark"),
);

const lightThemes = computed(() =>
	themeStore.availableThemes.filter((t) => t.type === "light"),
);

// Sync auto-switch state from appearance config
watch(
	() => themeStore.appearance,
	(cfg) => {
		autoSwitch.enabled.value = cfg.autoSwitch.enabled;
		autoSwitch.darkThemeName.value = cfg.autoSwitch.darkTheme;
		autoSwitch.lightThemeName.value = cfg.autoSwitch.lightTheme;
	},
	{ immediate: true },
);

function onAutoSwitchToggle(event: Event) {
	const checked = (event.target as HTMLInputElement).checked;
	autoSwitch.enabled.value = checked;
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: checked,
			darkTheme: autoSwitch.darkThemeName.value,
			lightTheme: autoSwitch.lightThemeName.value,
		},
	});
}

function onAutoSwitchDarkChange(event: Event) {
	const value = (event.target as HTMLSelectElement).value;
	autoSwitch.darkThemeName.value = value;
	autoSwitch.applyCurrentPreference();
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: autoSwitch.enabled.value,
			darkTheme: value,
			lightTheme: autoSwitch.lightThemeName.value,
		},
	});
}

function onAutoSwitchLightChange(event: Event) {
	const value = (event.target as HTMLSelectElement).value;
	autoSwitch.lightThemeName.value = value;
	autoSwitch.applyCurrentPreference();
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: autoSwitch.enabled.value,
			darkTheme: autoSwitch.darkThemeName.value,
			lightTheme: value,
		},
	});
}

// ── Opacity ───────────────────────────────────────────────────────────

const opacityLabels: Record<keyof AppearanceConfig["opacity"], string> = {
	terminal: "Terminal",
	sidebar: "Sidebar",
	hostRail: "Host rail",
	tabBar: "Tab bar",
};

const opacity = reactive({
	terminal: 100,
	sidebar: 100,
	hostRail: 100,
	tabBar: 100,
});

// Sync from appearance config
watch(
	() => themeStore.appearance.opacity,
	(val) => {
		opacity.terminal = val.terminal;
		opacity.sidebar = val.sidebar;
		opacity.hostRail = val.hostRail;
		opacity.tabBar = val.tabBar;
	},
	{ immediate: true },
);

let opacityDebounce: ReturnType<typeof setTimeout> | null = null;

let opacityRaf: number | null = null;

function onOpacityInput(
	key: keyof AppearanceConfig["opacity"],
	event: Event,
) {
	const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
	opacity[key] = value;

	// Apply immediately for visual feedback (coalesced via rAF)
	if (opacityRaf !== null) cancelAnimationFrame(opacityRaf);
	opacityRaf = requestAnimationFrame(() => {
		themeStore.applyOpacity({ ...opacity });
		opacityRaf = null;
	});

	// Debounce the API persist
	if (opacityDebounce !== null) clearTimeout(opacityDebounce);
	opacityDebounce = setTimeout(() => {
		themeStore.updateAppearance({ opacity: { ...opacity } });
		opacityDebounce = null;
	}, 300);
}

// ── Scrollbar ─────────────────────────────────────────────────────────

const scrollbarStyle = ref<AppearanceConfig["scrollbar"]["style"]>("thin");

watch(
	() => themeStore.appearance.scrollbar,
	(val) => {
		scrollbarStyle.value = val.style;
	},
	{ immediate: true },
);

function onScrollbarChange(event: Event) {
	const value = (event.target as HTMLSelectElement)
		.value as AppearanceConfig["scrollbar"]["style"];
	scrollbarStyle.value = value;
	themeStore.updateAppearance({
		scrollbar: {
			...themeStore.appearance.scrollbar,
			style: value,
		},
	});
}
</script>

<style scoped>
.appearance-overlay {
	position: fixed;
	inset: 0;
	background: var(--nt-overlay);
	display: flex;
	justify-content: flex-end;
	z-index: 900;
}

.appearance-panel {
	width: 480px;
	max-width: calc(100vw - 64px);
	height: 100%;
	background: var(--nt-bg);
	border-left: 1px solid var(--nt-border);
	box-shadow: var(--nt-shadow);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.appearance-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	border-bottom: 1px solid var(--nt-border);
	flex-shrink: 0;
}

.appearance-title {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--nt-fg);
}

.appearance-close {
	background: transparent;
	border: none;
	color: var(--nt-text-secondary);
	font-size: 16px;
	cursor: pointer;
	padding: 4px;
	line-height: 1;
	border-radius: 4px;
}

.appearance-close:hover {
	color: var(--nt-fg);
	background: var(--nt-border);
}

.appearance-body {
	flex: 1;
	overflow-y: auto;
	padding: 20px;
	scrollbar-width: thin;
	scrollbar-color: var(--nt-scrollbar-thumb) var(--nt-scrollbar-track);
}

.appearance-body::-webkit-scrollbar {
	width: var(--nt-scrollbar-width);
}

.appearance-body::-webkit-scrollbar-track {
	background: var(--nt-scrollbar-track);
}

.appearance-body::-webkit-scrollbar-thumb {
	background: var(--nt-scrollbar-thumb);
	border-radius: 3px;
}

/* ── Sections ────────────────────────────────────────────────────────── */

.appearance-section {
	margin-top: 24px;
	padding-top: 16px;
	border-top: 1px solid var(--nt-border);
}

.section-title {
	margin: 0 0 12px 0;
	font-size: 13px;
	font-weight: 600;
	color: var(--nt-fg);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.setting-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 6px 0;
}

.setting-label {
	flex: 1;
	font-size: 13px;
	color: var(--nt-fg);
}

.setting-checkbox {
	width: 16px;
	height: 16px;
	accent-color: var(--nt-accent);
	cursor: pointer;
}

.setting-select {
	padding: 4px 8px;
	font-size: 12px;
	background: var(--nt-border);
	color: var(--nt-fg);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	cursor: pointer;
	min-width: 160px;
}

.setting-select:focus {
	outline: 1px solid var(--nt-accent);
}

.setting-range {
	flex: 1;
	max-width: 160px;
	accent-color: var(--nt-accent);
	cursor: pointer;
}

.setting-value {
	font-size: 12px;
	color: var(--nt-text-secondary);
	min-width: 40px;
	text-align: right;
}
</style>
