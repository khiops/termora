<template>
	<div class="appearance-category">
		<!-- Theme Picker / Editor -->
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

			<!-- Auto-Switch (global scope only) -->
			<section v-if="scope === 'global'" class="settings-section">
				<h3 class="section-title">Auto-Switch</h3>
				<SettingRow
					label="Follow OS dark mode"
					:scope="scope"
					:is-overridden="true"
				>
					<SettingControl
						type="toggle"
						:model-value="autoSwitch.enabled.value"
						@update:model-value="onAutoSwitchToggle"
					/>
				</SettingRow>
				<template v-if="autoSwitch.enabled.value">
					<SettingRow
						label="Dark theme"
						:scope="scope"
						:is-overridden="true"
					>
						<SettingControl
							type="select"
							:model-value="autoSwitch.darkThemeName.value"
							:options="darkThemeOptions"
							@update:model-value="onAutoSwitchDarkChange"
						/>
					</SettingRow>
					<SettingRow
						label="Light theme"
						:scope="scope"
						:is-overridden="true"
					>
						<SettingControl
							type="select"
							:model-value="autoSwitch.lightThemeName.value"
							:options="lightThemeOptions"
							@update:model-value="onAutoSwitchLightChange"
						/>
					</SettingRow>
				</template>
			</section>

			<!-- Opacity (global scope only) -->
			<section v-if="scope === 'global'" class="settings-section">
				<h3 class="section-title">Opacity</h3>
				<SettingRow
					v-for="(label, key) in opacityLabels"
					:key="key"
					:label="label"
					:scope="scope"
					:is-overridden="true"
				>
					<SettingControl
						type="range"
						:model-value="opacity[key]"
						:min="20"
						:max="100"
						:step="1"
						@update:model-value="(v: unknown) => onOpacityInput(key, v as number)"
					/>
				</SettingRow>
			</section>

			<!-- Scrollbar (global scope only) -->
			<section v-if="scope === 'global'" class="settings-section">
				<h3 class="section-title">Scrollbar</h3>
				<SettingRow
					label="Style"
					:scope="scope"
					:is-overridden="true"
				>
					<SettingControl
						type="select"
						:model-value="scrollbarStyle"
						:options="scrollbarOptions"
						@update:model-value="onScrollbarChange"
					/>
				</SettingRow>
			</section>
		</template>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from "vue";
import type { AppearanceConfig, NexTermTheme } from "@nexterm/shared";
import ThemePicker from "../ThemePicker.vue";
import ThemeEditor from "../ThemeEditor.vue";
import SettingRow from "../SettingRow.vue";
import SettingControl from "../SettingControl.vue";
import { useAutoSwitch } from "../../../composables/useAutoSwitch.js";
import { useThemeStore } from "../../../stores/theme.js";
import type { Scope } from "../../../stores/settings.js";

defineProps<{
	scope: Scope;
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

const darkThemeOptions = computed(() =>
	themeStore.availableThemes
		.filter((t) => t.type === "dark")
		.map((t) => ({ label: t.name, value: t.name })),
);

const lightThemeOptions = computed(() =>
	themeStore.availableThemes
		.filter((t) => t.type === "light")
		.map((t) => ({ label: t.name, value: t.name })),
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

function onAutoSwitchToggle(value: unknown) {
	const checked = Boolean(value);
	autoSwitch.enabled.value = checked;
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: checked,
			darkTheme: autoSwitch.darkThemeName.value,
			lightTheme: autoSwitch.lightThemeName.value,
		},
	});
}

function onAutoSwitchDarkChange(value: unknown) {
	const name = String(value);
	autoSwitch.darkThemeName.value = name;
	autoSwitch.applyCurrentPreference();
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: autoSwitch.enabled.value,
			darkTheme: name,
			lightTheme: autoSwitch.lightThemeName.value,
		},
	});
}

function onAutoSwitchLightChange(value: unknown) {
	const name = String(value);
	autoSwitch.lightThemeName.value = name;
	autoSwitch.applyCurrentPreference();
	themeStore.updateAppearance({
		autoSwitch: {
			enabled: autoSwitch.enabled.value,
			darkTheme: autoSwitch.darkThemeName.value,
			lightTheme: name,
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
	value: number,
) {
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
	}, 500);
}

// ── Scrollbar ─────────────────────────────────────────────────────────

const scrollbarOptions = [
	{ label: "Thin (6px)", value: "thin" },
	{ label: "Wide (14px)", value: "wide" },
	{ label: "Hidden", value: "hidden" },
];

const scrollbarStyle = ref<AppearanceConfig["scrollbar"]["style"]>("thin");

watch(
	() => themeStore.appearance.scrollbar,
	(val) => {
		scrollbarStyle.value = val.style;
	},
	{ immediate: true },
);

function onScrollbarChange(value: unknown) {
	const style = String(value) as AppearanceConfig["scrollbar"]["style"];
	scrollbarStyle.value = style;
	themeStore.updateAppearance({
		scrollbar: {
			...themeStore.appearance.scrollbar,
			style,
		},
	});
}
</script>

<style scoped>
.appearance-category {
	display: flex;
	flex-direction: column;
}

.settings-section {
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
</style>
