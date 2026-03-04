<template>
	<div class="host-rail">
		<div class="rail-badges">
			<div
				v-for="host in hostsStore.sortedHosts"
				:key="host.id"
				class="badge-wrapper"
				:class="{ selected: host.id === hostsStore.selectedHostId }"
				:title="host.label"
				@click="hostsStore.selectHost(host.id)"
			>
				<div
					class="badge"
					:style="{ backgroundColor: getColorFromLabel(host.label) }"
				>
					<span class="badge-initials">{{ getInitials(host.label) }}</span>
					<span
						class="status-dot"
						:class="`status-dot--${hostsStore.getHostStatus(host.id)}`"
					></span>
				</div>
			</div>

			<div
				v-if="hostsStore.hosts.length === 0 && !hostsStore.loading"
				class="badge-wrapper"
				title="Local (this machine)"
				:class="{ selected: true }"
			>
				<div class="badge" :style="{ backgroundColor: getColorFromLabel('local') }">
					<span class="badge-initials">L</span>
					<span class="status-dot status-dot--offline"></span>
				</div>
			</div>
		</div>

		<div class="rail-footer">
			<button
				class="add-host-btn"
				title="Add host (coming soon)"
				disabled
				aria-label="Add new host"
			>
				<span class="add-icon">+</span>
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useHostsStore } from "../stores/hosts.js";
import { getInitials, getColorFromLabel } from "../composables/useHostIcon.js";

const hostsStore = useHostsStore();

onMounted(() => {
	void hostsStore.fetchHosts();
});
</script>

<style scoped>
.host-rail {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding-top: 8px;
	overflow-y: auto;
	overflow-x: hidden;
	scrollbar-width: none; /* Firefox */
}

.host-rail::-webkit-scrollbar {
	display: none; /* Chrome/Safari */
}

.rail-badges {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	flex: 1;
	width: 100%;
	padding: 4px 0;
}

.badge-wrapper {
	position: relative;
	width: 36px;
	height: 36px;
	cursor: pointer;
	flex-shrink: 0;
}

/* Selected indicator — white left pill, same approach as Discord */
.badge-wrapper.selected::before {
	content: "";
	position: absolute;
	left: -6px;
	top: 50%;
	transform: translateY(-50%);
	width: 4px;
	height: 20px;
	background: #cdd6f4;
	border-radius: 0 3px 3px 0;
}

.badge-wrapper.selected .badge {
	border-radius: 12px;
}

.badge-wrapper:not(.selected):hover .badge {
	border-radius: 12px;
}

.badge {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	transition: border-radius 0.15s ease;
	user-select: none;
}

.badge-initials {
	font-size: 14px;
	font-weight: 700;
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	line-height: 1;
}

/* Status dot — bottom-right corner of badge */
.status-dot {
	position: absolute;
	bottom: -1px;
	right: -1px;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	border: 2px solid #181825; /* matches rail background */
}

.status-dot--live {
	background: #a6e3a1; /* catppuccin green */
}

.status-dot--offline {
	background: #45475a; /* catppuccin surface1 — subtle gray */
}

.status-dot--error {
	background: #f38ba8; /* catppuccin red */
}

.status-dot--reconnecting {
	background: #f9e2af; /* catppuccin yellow */
	animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

.rail-footer {
	padding: 8px 0 12px;
	display: flex;
	flex-direction: column;
	align-items: center;
}

.add-host-btn {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: 2px dashed #45475a;
	background: transparent;
	color: #585b70;
	font-size: 20px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: not-allowed;
	transition: border-color 0.15s, color 0.15s;
	padding: 0;
}

.add-host-btn:not(:disabled):hover {
	border-color: #89b4fa;
	color: #89b4fa;
	cursor: pointer;
}

.add-icon {
	display: block;
	line-height: 1;
	margin-top: -1px; /* optical centering */
}
</style>
