<template>
	<div class="settings-category">
		<!-- Scope override banner (host/channel only) -->
		<div v-if="hasWallpaperOverride && scope !== 'global'" class="scope-override-banner">
			<span>This scope has wallpaper overrides.</span>
			<button class="scope-override-reset" type="button" @click="resetWallpaperOverride">
				Reset to inherited
			</button>
		</div>

		<!-- Wallpaper picker section -->
		<section class="settings-section">
			<h3 class="section-title">Wallpaper</h3>

			<div class="wallpaper-grid">
				<!-- "None" option -->
				<button
					class="wallpaper-thumb"
					:class="{ active: !currentWallpaper }"
					type="button"
					@click="clearWallpaper"
				>
					<span class="wallpaper-none">None</span>
				</button>

				<!-- Wallpaper thumbnails -->
				<div
					v-for="wp in wallpapers"
					:key="wp"
					class="wallpaper-thumb-wrapper"
				>
					<button
						class="wallpaper-thumb"
						:class="{ active: currentWallpaper === wp }"
						type="button"
						@click="selectWallpaper(wp)"
					>
						<img
							:src="`/public/wallpapers/${encodeURIComponent(wp)}`"
							:alt="wp"
							loading="lazy"
						/>
					</button>
					<button
						class="wallpaper-delete"
						type="button"
						title="Delete wallpaper"
						@click="deleteWallpaper(wp)"
					>
						&times;
					</button>
				</div>
			</div>

			<!-- Upload -->
			<input
				ref="fileInput"
				type="file"
				accept="image/*"
				style="display: none"
				@change="handleUpload"
			/>
			<button class="wallpaper-upload-btn" type="button" @click="triggerUpload">
				Upload wallpaper
			</button>
			<div v-if="uploadError" class="wallpaper-upload-error">
				{{ uploadError }}
				<button type="button" @click="uploadError = ''">&times;</button>
			</div>
		</section>

		<!-- Blur / Dim sliders -->
		<section class="settings-section">
			<h3 class="section-title">Effects</h3>

			<SettingRow
				label="Blur"
				description="Background blur in pixels (0 = sharp)"
				:scope="scope"
				:is-overridden="settingsStore.isOverridden(scope, 'terminal', 'wallpaperBlur')"
				:inherited-from="settingsStore.inheritedFrom(scope, 'terminal', 'wallpaperBlur')"
				@reset="settingsStore.resetSetting(scope, 'terminal', 'wallpaperBlur')"
			>
				<SettingControl
					type="range"
					:model-value="currentBlur"
					:min="0"
					:max="20"
					:step="1"
					@update:model-value="updateBlur"
				/>
			</SettingRow>

			<SettingRow
				label="Dim"
				description="Background dimming percentage (0 = no dimming)"
				:scope="scope"
				:is-overridden="settingsStore.isOverridden(scope, 'terminal', 'wallpaperDim')"
				:inherited-from="settingsStore.inheritedFrom(scope, 'terminal', 'wallpaperDim')"
				@reset="settingsStore.resetSetting(scope, 'terminal', 'wallpaperDim')"
			>
				<SettingControl
					type="range"
					:model-value="currentDim"
					:min="0"
					:max="100"
					:step="5"
					@update:model-value="updateDim"
				/>
			</SettingRow>
		</section>
	</div>
</template>

<script setup lang="ts">
import { MAX_WALLPAPER_SIZE, WALLPAPER_EXTENSIONS } from "@nexterm/shared";
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../../../stores/auth.js";
import { useSettingsStore } from "../../../stores/settings.js";
import type { Scope } from "../../../stores/settings.js";
import SettingRow from "../SettingRow.vue";
import SettingControl from "../SettingControl.vue";

const props = defineProps<{
	scope: Scope;
}>();

const settingsStore = useSettingsStore();
const authStore = useAuthStore();

const wallpapers = ref<string[]>([]);
const uploadError = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

// ─── Computed ──────────────────────────────────────────────────────────

const currentWallpaper = computed(() => {
	return (settingsStore.getValue(props.scope, "terminal", "wallpaper") as string) ?? "";
});

const currentBlur = computed(() => {
	return (settingsStore.getValue(props.scope, "terminal", "wallpaperBlur") as number) ?? 0;
});

const currentDim = computed(() => {
	return (settingsStore.getValue(props.scope, "terminal", "wallpaperDim") as number) ?? 0;
});

const hasWallpaperOverride = computed(() => {
	if (props.scope === "global") return false;
	return (
		settingsStore.isOverridden(props.scope, "terminal", "wallpaper") ||
		settingsStore.isOverridden(props.scope, "terminal", "wallpaperBlur") ||
		settingsStore.isOverridden(props.scope, "terminal", "wallpaperDim")
	);
});

// ─── Methods ───────────────────────────────────────────────────────────

async function loadWallpapers(): Promise<void> {
	try {
		const resp = await fetch("/api/wallpapers");
		if (resp.ok) {
			const data = await resp.json();
			wallpapers.value = data.wallpapers;
		}
	} catch {
		// Silent fail — empty grid
	}
}

async function selectWallpaper(filename: string): Promise<void> {
	await settingsStore.updateSetting(props.scope, "terminal", "wallpaper", filename);
}

async function clearWallpaper(): Promise<void> {
	await settingsStore.updateSetting(props.scope, "terminal", "wallpaper", "");
}

function triggerUpload(): void {
	uploadError.value = "";
	fileInput.value?.click();
}

async function handleUpload(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;

	// Client-side size check
	if (file.size > MAX_WALLPAPER_SIZE) {
		uploadError.value = "File too large (max 10 MB)";
		input.value = "";
		return;
	}

	// Extension check
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (!WALLPAPER_EXTENSIONS.includes(ext)) {
		uploadError.value = `Unsupported format. Use: ${WALLPAPER_EXTENSIONS.join(", ")}`;
		input.value = "";
		return;
	}

	const formData = new FormData();
	formData.append("image", file);

	try {
		const resp = await fetch("/api/wallpapers", {
			method: "POST",
			headers: { Authorization: `Bearer ${authStore.token ?? ""}` },
			body: formData,
		});

		if (!resp.ok) {
			const data = await resp.json().catch(() => ({}));
			uploadError.value = (data as { message?: string }).message ?? `Upload failed (${resp.status})`;
			input.value = "";
			return;
		}

		const { filename } = await resp.json() as { filename: string };
		await loadWallpapers();
		await selectWallpaper(filename);
		uploadError.value = "";
	} catch {
		uploadError.value = "Upload failed";
	}

	input.value = "";
}

async function deleteWallpaper(filename: string): Promise<void> {
	try {
		await fetch(`/api/wallpapers/${encodeURIComponent(filename)}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${authStore.token ?? ""}` },
		});
		await loadWallpapers();
		// If the deleted wallpaper was selected, clear it
		if (currentWallpaper.value === filename) {
			await clearWallpaper();
		}
	} catch {
		// Silent fail
	}
}

async function updateBlur(value: unknown): Promise<void> {
	await settingsStore.updateSetting(props.scope, "terminal", "wallpaperBlur", value as number);
}

async function updateDim(value: unknown): Promise<void> {
	await settingsStore.updateSetting(props.scope, "terminal", "wallpaperDim", value as number);
}

async function resetWallpaperOverride(): Promise<void> {
	await settingsStore.resetSetting(props.scope, "terminal", "wallpaper");
	await settingsStore.resetSetting(props.scope, "terminal", "wallpaperBlur");
	await settingsStore.resetSetting(props.scope, "terminal", "wallpaperDim");
}

onMounted(loadWallpapers);
</script>

<style scoped>
.settings-category {
	padding: 0 16px 24px;
}

.scope-override-banner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 12px;
	margin-bottom: 12px;
	border: 1px solid var(--nt-accent);
	border-radius: 6px;
	background: rgba(var(--nt-accent-rgb, 100, 100, 255), 0.1);
	font-size: 13px;
}

.scope-override-reset {
	padding: 4px 10px;
	background: transparent;
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	color: var(--nt-text);
	cursor: pointer;
	font-size: 12px;
	white-space: nowrap;
}

.scope-override-reset:hover {
	border-color: var(--nt-accent);
	color: var(--nt-accent);
}

.settings-section {
	margin-top: 24px;
	padding-top: 16px;
	border-top: 1px solid var(--nt-border);
}

.settings-section:first-child {
	margin-top: 0;
	padding-top: 0;
	border-top: none;
}

.section-title {
	margin: 0 0 12px;
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--nt-text-muted);
}

.wallpaper-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
	gap: 8px;
	margin-bottom: 12px;
}

.wallpaper-thumb-wrapper {
	position: relative;
}

.wallpaper-thumb {
	width: 100%;
	aspect-ratio: 16 / 9;
	border: 2px solid var(--nt-border);
	border-radius: 6px;
	overflow: hidden;
	cursor: pointer;
	background: var(--nt-bg);
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: border-color 0.15s;
}

.wallpaper-thumb:hover {
	border-color: var(--nt-text-muted);
}

.wallpaper-thumb.active {
	border-color: var(--nt-accent);
	box-shadow: 0 0 0 1px var(--nt-accent);
}

.wallpaper-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.wallpaper-none {
	font-size: 12px;
	color: var(--nt-text-muted);
}

.wallpaper-delete {
	position: absolute;
	top: 4px;
	right: 4px;
	width: 20px;
	height: 20px;
	padding: 0;
	background: rgba(0, 0, 0, 0.6);
	color: white;
	border: none;
	border-radius: 50%;
	cursor: pointer;
	font-size: 14px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0;
	transition: opacity 0.15s;
}

.wallpaper-thumb-wrapper:hover .wallpaper-delete {
	opacity: 1;
}

.wallpaper-upload-btn {
	padding: 6px 14px;
	background: transparent;
	border: 1px solid var(--nt-border);
	border-radius: 6px;
	color: var(--nt-text);
	cursor: pointer;
	font-size: 13px;
}

.wallpaper-upload-btn:hover {
	border-color: var(--nt-accent);
	color: var(--nt-accent);
}

.wallpaper-upload-error {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
	padding: 6px 10px;
	background: rgba(255, 80, 80, 0.1);
	border: 1px solid rgba(255, 80, 80, 0.3);
	border-radius: 4px;
	font-size: 12px;
	color: #ff5050;
}

.wallpaper-upload-error button {
	background: none;
	border: none;
	color: inherit;
	cursor: pointer;
	padding: 0 2px;
	font-size: 14px;
}
</style>
