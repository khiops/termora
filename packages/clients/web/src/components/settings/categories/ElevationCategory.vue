<template>
	<div class="elevation-category">
		<!-- Linux -->
		<section class="settings-section settings-section--first">
			<h3 class="section-title">Linux</h3>
			<SettingRow
				label="Method"
				:scope="scope"
				:is-overridden="true"
				description="Elevation method for Linux hosts"
			>
				<SettingControl
					type="select"
					:model-value="methodLinux"
					:options="linuxOptions"
					@update:model-value="(v) => onMethodChange('methodLinux', v)"
				/>
			</SettingRow>
			<SettingRow
				label="Custom Command"
				:scope="scope"
				:is-overridden="true"
			>
				<SettingControl
					type="text"
					:model-value="customCommandLinux"
					:disabled="methodLinux !== 'custom'"
					:placeholder="methodLinux === 'custom' ? '/usr/local/bin/my-elevate' : `Select 'Custom' method to configure`"
					@update:model-value="(v) => onCustomChange('customCommandLinux', v)"
				/>
			</SettingRow>
		</section>

		<!-- macOS -->
		<section class="settings-section">
			<h3 class="section-title">macOS</h3>
			<SettingRow
				label="Method"
				:scope="scope"
				:is-overridden="true"
				description="Elevation method for macOS hosts"
			>
				<SettingControl
					type="select"
					:model-value="methodDarwin"
					:options="darwinOptions"
					@update:model-value="(v) => onMethodChange('methodDarwin', v)"
				/>
			</SettingRow>
			<SettingRow
				label="Custom Command"
				:scope="scope"
				:is-overridden="true"
			>
				<SettingControl
					type="text"
					:model-value="customCommandDarwin"
					:disabled="methodDarwin !== 'custom'"
					:placeholder="methodDarwin === 'custom' ? '/usr/local/bin/my-elevate' : `Select 'Custom' method to configure`"
					@update:model-value="(v) => onCustomChange('customCommandDarwin', v)"
				/>
			</SettingRow>
		</section>

		<!-- Windows -->
		<section class="settings-section">
			<h3 class="section-title">Windows</h3>
			<SettingRow
				label="Method"
				:scope="scope"
				:is-overridden="true"
				description="Elevation method for Windows hosts"
			>
				<SettingControl
					type="select"
					:model-value="methodWindows"
					:options="windowsOptions"
					@update:model-value="(v) => onMethodChange('methodWindows', v)"
				/>
			</SettingRow>
			<SettingRow
				label="Custom Command"
				:scope="scope"
				:is-overridden="true"
			>
				<SettingControl
					type="text"
					:model-value="customCommandWindows"
					:disabled="methodWindows !== 'custom'"
					:placeholder="methodWindows === 'custom' ? 'C:\\tools\\my-elevate.exe' : `Select 'Custom' method to configure`"
					@update:model-value="(v) => onCustomChange('customCommandWindows', v)"
				/>
			</SettingRow>
		</section>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SettingRow from "../SettingRow.vue";
import SettingControl from "../SettingControl.vue";
import { useSettingsStore } from "../../../stores/settings.js";
import type { Scope } from "../../../stores/settings.js";

const props = defineProps<{
	scope: Scope;
}>();

const settingsStore = useSettingsStore();

// ── Options ────────────────────────────────────────────────────────────

const linuxOptions = [
	{ label: "sudo", value: "sudo" },
	{ label: "doas", value: "doas" },
	{ label: "pkexec", value: "pkexec" },
	{ label: "Custom", value: "custom" },
];

const darwinOptions = [
	{ label: "sudo", value: "sudo" },
	{ label: "doas", value: "doas" },
	{ label: "Custom", value: "custom" },
];

const windowsOptions = [
	{ label: "gsudo", value: "gsudo" },
	{ label: "Custom", value: "custom" },
];

// ── Reactive values ────────────────────────────────────────────────────

const methodLinux = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "methodLinux") as string | undefined) ?? "sudo",
);

const methodDarwin = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "methodDarwin") as string | undefined) ?? "sudo",
);

const methodWindows = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "methodWindows") as string | undefined) ?? "gsudo",
);

const customCommandLinux = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "customCommandLinux") as string | undefined) ?? "",
);

const customCommandDarwin = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "customCommandDarwin") as string | undefined) ?? "",
);

const customCommandWindows = computed(
	() => (settingsStore.getValue(props.scope, "elevation", "customCommandWindows") as string | undefined) ?? "",
);

// ── Handlers ───────────────────────────────────────────────────────────

function onMethodChange(key: string, value: unknown): void {
	void settingsStore.updateSetting(props.scope, "elevation", key, String(value));
}

function onCustomChange(key: string, value: unknown): void {
	void settingsStore.updateSetting(props.scope, "elevation", key, String(value));
}
</script>

<style scoped>
.elevation-category {
	display: flex;
	flex-direction: column;
}

.settings-section {
	margin-top: 24px;
	padding-top: 16px;
	border-top: 1px solid var(--nt-border);
}

.settings-section--first {
	margin-top: 0;
	padding-top: 0;
	border-top: none;
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
