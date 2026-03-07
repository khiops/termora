<template>
	<div class="host-rail">
		<div class="rail-hosts">
			<!-- Local host always first -->
			<div
				v-if="localHost"
				class="badge-wrapper"
				:class="{ selected: localHost.id === hostsStore.selectedHostId }"
				:title="localHost.label"
				@click="hostsStore.selectHost(localHost.id)"
				@contextmenu.prevent="
					$emit('host-context-menu', {
						hostId: localHost.id,
						event: $event,
					})
				"
			>
				<div
					class="badge"
					:style="{
						backgroundColor: getColorFromLabel(localHost.label),
					}"
				>
					<span class="badge-initials">{{
						getInitials(localHost.label)
					}}</span>
					<span
						class="status-dot"
						:class="`status-dot--${hostsStore.getHostStatus(localHost.id)}`"
					></span>
				</div>
			</div>

			<!-- Separator after local host -->
			<div
				v-if="localHost && sections.length > 0"
				class="rail-separator"
			></div>

			<!-- Group sections -->
			<template
				v-for="section in sections"
				:key="
					section.type === 'group' ? section.name : 'ungrouped'
				"
			>
				<!-- Group header -->
				<div
					v-if="section.type === 'group'"
					class="group-header"
					:title="`${section.name} (${section.hosts.length} hosts)`"
					@click="toggleGroup(section.name)"
					@contextmenu.prevent="
						$emit('group-context-menu', {
							groupName: section.name,
							event: $event,
						})
					"
				>
					<span
						class="group-chevron"
						:class="{ collapsed: section.collapsed }"
						>&#x25B8;</span
					>
					<span class="group-label">{{ section.name }}</span>
				</div>

				<!-- Hosts in section (hidden if collapsed) -->
				<template
					v-if="
						section.type === 'ungrouped' || !section.collapsed
					"
				>
					<div
						v-for="host in section.hosts"
						:key="host.id"
						class="badge-wrapper"
						:class="{
							selected:
								host.id === hostsStore.selectedHostId,
						}"
						:title="getTooltip(host)"
						draggable="true"
						@click="hostsStore.selectHost(host.id)"
						@contextmenu.prevent="
							$emit('host-context-menu', {
								hostId: host.id,
								event: $event,
							})
						"
						@dragstart="onDragStart($event, host)"
						@dragover.prevent="onDragOver($event)"
						@drop="onDrop($event, host, section)"
					>
						<div
							class="badge"
							:style="{
								backgroundColor:
									host.color ||
									getColorFromLabel(host.label),
							}"
						>
							<span class="badge-initials">{{
								getInitials(host.label)
							}}</span>
							<span
								class="status-dot"
								:class="`status-dot--${hostsStore.getHostStatus(host.id)}`"
							></span>
						</div>
					</div>
				</template>

				<!-- Separator between groups -->
				<div
					v-if="section.type === 'group'"
					class="rail-separator"
				></div>
			</template>
		</div>

		<div class="rail-footer">
			<button
				class="rail-icon-btn"
				title="Appearance"
				aria-label="Open appearance panel"
				@click="$emit('toggle-appearance')"
			>
				<svg
					class="rail-icon-svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="5" />
					<path
						d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
					/>
				</svg>
			</button>
			<button
				class="add-host-btn"
				title="Add host"
				aria-label="Add new host"
				@click="$emit('add-host')"
			>
				<span class="add-icon">+</span>
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useHostsStore } from "../stores/hosts.js";
import {
	useHostGroups,
	type HostSection,
} from "../composables/useHostGroups.js";
import {
	getInitials,
	getColorFromLabel,
} from "../composables/useHostIcon.js";
import type { Host } from "@nexterm/shared";

defineEmits<{
	"toggle-appearance": [];
	"add-host": [];
	"host-context-menu": [payload: { hostId: string; event: MouseEvent }];
	"group-context-menu": [
		payload: { groupName: string; event: MouseEvent },
	];
}>();

const hostsStore = useHostsStore();
const { sections, localHost, toggleGroup } = useHostGroups();

let dragHostId: string | null = null;

function getTooltip(host: Host): string {
	const parts = [host.label];
	if (host.sshHost)
		parts.push(
			`${host.sshUser ?? ""}@${host.sshHost}:${host.sshPort ?? 22}`,
		);
	if (host.hostGroup) parts.push(`Group: ${host.hostGroup}`);
	return parts.join("\n");
}

function onDragStart(event: DragEvent, host: Host): void {
	dragHostId = host.id;
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", host.id);
	}
}

function onDragOver(event: DragEvent): void {
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "move";
	}
}

function onDrop(
	_event: DragEvent,
	targetHost: Host,
	section: HostSection,
): void {
	if (!dragHostId || dragHostId === targetHost.id) return;

	const group = section.type === "group" ? section.name : null;
	const hostsInSection = section.hosts;
	const draggedIdx = hostsInSection.findIndex(
		(h) => h.id === dragHostId,
	);
	const targetIdx = hostsInSection.findIndex(
		(h) => h.id === targetHost.id,
	);

	// Build new order
	const orderedIds = hostsInSection.map((h) => h.id);
	if (draggedIdx >= 0) {
		// Reorder within same section
		orderedIds.splice(draggedIdx, 1);
		orderedIds.splice(targetIdx, 0, dragHostId);
	} else {
		// Move from different section
		orderedIds.splice(targetIdx, 0, dragHostId);
	}

	void hostsStore.reorderHosts(group, orderedIds);
	void hostsStore.fetchHosts(); // re-fetch to get server-canonical order
	dragHostId = null;
}

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

.rail-hosts {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
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
	background: var(--nt-fg);
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
	color: var(--nt-bright-white);
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
	border: 2px solid var(--nt-tab-bar);
}

.status-dot--live {
	background: var(--nt-green);
}

.status-dot--offline {
	background: var(--nt-tab-hover);
}

.status-dot--error {
	background: var(--nt-badge);
}

.status-dot--reconnecting {
	background: var(--nt-yellow);
	animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.4;
	}
}

.rail-separator {
	width: 24px;
	height: 1px;
	background: var(--nt-tab-hover);
	flex-shrink: 0;
	margin: 2px 0;
}

.group-header {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 4px;
	width: 100%;
	padding: 4px 6px;
	font-size: 9px;
	text-transform: uppercase;
	color: var(--nt-text-secondary);
	cursor: pointer;
	user-select: none;
}

.group-header:hover {
	color: var(--nt-fg);
}

.group-chevron {
	display: inline-block;
	font-size: 10px;
	line-height: 1;
	transition: transform 0.15s ease;
	transform: rotate(90deg);
}

.group-chevron.collapsed {
	transform: rotate(0deg);
}

.group-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	flex: 1;
	min-width: 0;
}

.rail-footer {
	padding: 8px 0 12px;
	display: flex;
	flex-direction: column;
	align-items: center;
}

.rail-icon-btn {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: none;
	background: transparent;
	color: var(--nt-text-secondary);
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	padding: 0;
	transition:
		color 0.15s,
		background 0.15s;
}

.rail-icon-btn:hover {
	color: var(--nt-accent);
	background: rgba(var(--nt-accent-rgb), 0.12);
}

.rail-icon-svg {
	width: 18px;
	height: 18px;
}

.add-host-btn {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: 2px dashed var(--nt-tab-hover);
	background: transparent;
	color: var(--nt-text-secondary);
	font-size: 20px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	transition:
		border-color 0.15s,
		color 0.15s;
	padding: 0;
}

.add-host-btn:hover {
	border-color: var(--nt-accent);
	color: var(--nt-accent);
}

.add-icon {
	display: block;
	line-height: 1;
	margin-top: -1px; /* optical centering */
}
</style>
