<template>
	<Teleport to="body">
		<Transition name="settings-fade">
			<div
				v-if="visible"
				class="settings-overlay"
				@mousedown.self="$emit('close')"
				@keydown.escape="$emit('close')"
			>
				<Transition name="settings-slide">
					<div
						v-if="visible"
						class="settings-panel"
						role="dialog"
						aria-label="Settings"
						aria-modal="true"
						tabindex="-1"
					>
						<div class="settings-header">
							<h2 class="settings-title">Settings</h2>
							<button
								class="settings-close"
								type="button"
								aria-label="Close settings panel"
								@click="$emit('close')"
							>
								&#10005;
							</button>
						</div>

						<ScopeTabBar
							v-model="settingsStore.activeScope"
							:host-name="hostName"
							:channel-name="channelName"
							:show-host="showHost"
							:show-channel="showChannel"
						/>

						<div class="settings-body">
							<CategoryNav
								v-model="settingsStore.activeCategory"
								:scope="settingsStore.activeScope"
							/>
							<div class="settings-content">
								<div v-if="settingsStore.loading" class="settings-loading">
									Loading settings...
								</div>
								<template v-else>
									<AppearanceCategory
										v-if="settingsStore.activeCategory === 'appearance'"
										:scope="settingsStore.activeScope"
									/>
									<WallpaperCategory
										v-else-if="settingsStore.activeCategory === 'wallpaper'"
										:scope="settingsStore.activeScope"
									/>
									<SchemaCategory
										v-else-if="settingsStore.activeCategory !== 'keybindings'"
										:category="settingsStore.activeCategory"
										:scope="settingsStore.activeScope"
										:host-name="hostName"
									/>
									<KeybindingsCategory v-else />
								</template>
							</div>
						</div>
					</div>
				</Transition>
			</div>
		</Transition>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import ScopeTabBar from "./ScopeTabBar.vue";
import CategoryNav from "./CategoryNav.vue";
import AppearanceCategory from "./categories/AppearanceCategory.vue";
import WallpaperCategory from "./categories/WallpaperCategory.vue";
import SchemaCategory from "./categories/SchemaCategory.vue";
import KeybindingsCategory from "./categories/KeybindingsCategory.vue";
import { useSettingsStore } from "../../stores/settings.js";
import { useHostsStore } from "../../stores/hosts.js";
import { useChannelsStore } from "../../stores/channels.js";

const props = defineProps<{
	visible: boolean;
}>();

defineEmits<{
	close: [];
}>();

const settingsStore = useSettingsStore();
const hostsStore = useHostsStore();
const channelsStore = useChannelsStore();

// ─── Derived context ──────────────────────────────────────────────────

const showHost = computed(() => hostsStore.selectedHostId !== null);
const showChannel = computed(() => channelsStore.selectedChannelId !== null);

const hostName = computed(() => {
	if (!hostsStore.selectedHostId) return undefined;
	const host = hostsStore.hosts.find((h) => h.id === hostsStore.selectedHostId);
	return host?.label ?? undefined;
});

const channelName = computed(() => {
	if (!channelsStore.selectedChannelId) return undefined;
	const ch = channelsStore.channels.find((c) => c.id === channelsStore.selectedChannelId);
	return ch?.title ?? ch?.dynamicTitle ?? "Terminal";
});

// ─── Load cascade when panel opens ────────────────────────────────────

watch(
	() => props.visible,
	(isVisible) => {
		if (isVisible) {
			void settingsStore.loadCascade(
				hostsStore.selectedHostId ?? undefined,
				channelsStore.selectedChannelId ?? undefined,
			);
		}
	},
);

// ─── Auto-fallback scope when context changes ─────────────────────────

watch(
	() => showHost.value,
	(hasHost) => {
		if (!hasHost && settingsStore.activeScope === "host") {
			settingsStore.activeScope = "global";
		}
	},
);

watch(
	() => showChannel.value,
	(hasChannel) => {
		if (!hasChannel && settingsStore.activeScope === "channel") {
			settingsStore.activeScope = "global";
		}
	},
);
</script>

<style scoped>
.settings-overlay {
	position: fixed;
	inset: 0;
	background: var(--nt-overlay);
	display: flex;
	justify-content: flex-end;
	z-index: 900;
}

.settings-panel {
	width: 680px;
	max-width: calc(100vw - 64px);
	height: 100%;
	background: var(--nt-bg);
	border-left: 1px solid var(--nt-border);
	box-shadow: var(--nt-shadow);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.settings-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	border-bottom: 1px solid var(--nt-border);
	flex-shrink: 0;
}

.settings-title {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--nt-fg);
}

.settings-close {
	background: transparent;
	border: none;
	color: var(--nt-text-secondary);
	font-size: 16px;
	cursor: pointer;
	padding: 4px;
	line-height: 1;
	border-radius: 4px;
}

.settings-close:hover {
	color: var(--nt-fg);
	background: var(--nt-border);
}

.settings-body {
	flex: 1;
	display: flex;
	overflow: hidden;
}

.settings-content {
	flex: 1;
	overflow-y: auto;
	padding: 20px;
	scrollbar-width: thin;
	scrollbar-color: var(--nt-scrollbar-thumb) var(--nt-scrollbar-track);
}

.settings-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: var(--nt-text-secondary);
	font-size: 13px;
}

/* ── Transitions ──────────────────────────────────────────────────────── */

.settings-fade-enter-active,
.settings-fade-leave-active {
	transition: opacity 0.2s ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
	opacity: 0;
}

.settings-slide-enter-active,
.settings-slide-leave-active {
	transition: transform 0.3s ease;
}

.settings-slide-enter-from,
.settings-slide-leave-to {
	transform: translateX(100%);
}
</style>
