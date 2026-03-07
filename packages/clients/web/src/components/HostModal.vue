<template>
	<Teleport to="body">
		<div v-if="visible" class="dialog-overlay" @click.self="$emit('close')">
			<div class="dialog-content host-modal">
				<div class="dialog-header">
					<h3 class="dialog-title">
						{{ editHost ? "Edit Host" : "Add Host" }}
					</h3>
					<button class="dialog-close" @click="$emit('close')">
						&times;
					</button>
				</div>

				<div class="dialog-body">
					<!-- Source selector (only for add) -->
					<div v-if="!editHost" class="field">
						<label class="field-label">Source</label>
						<div class="source-tabs">
							<button
								:class="['source-tab', { active: source === 'manual' }]"
								@click="source = 'manual'"
							>
								Manual
							</button>
							<button
								:class="[
									'source-tab',
									{ active: source === 'ssh-config' },
								]"
								@click="onSelectSshConfig"
							>
								From SSH config
							</button>
						</div>
					</div>

					<!-- SSH config dropdown (when source = ssh-config) -->
					<div v-if="source === 'ssh-config'" class="field">
						<label class="field-label">SSH Host</label>
						<div v-if="sshConfigHasInclude" class="warning-banner">
							Include directives detected — included hosts may be
							missing
						</div>
						<select
							v-if="!loadingSshConfig"
							v-model="selectedSshConfigHost"
							class="field-select"
							@change="applySshConfigEntry(selectedSshConfigHost)"
						>
							<option value="">Select a host...</option>
							<option
								v-for="entry in serverHosts"
								:key="entry.name"
								:value="entry.name"
							>
								{{ entry.name }} ({{
									entry.hostname ?? "no hostname"
								}})
							</option>
						</select>
						<span v-else class="field-hint">
							Loading SSH config...
						</span>
						<button
							v-if="!loadingSshConfig"
							class="btn-link batch-import-link"
							@click="$emit('batch-import')"
						>
							Import multiple hosts at once...
						</button>
					</div>

					<!-- Name -->
					<div class="field">
						<label class="field-label">Name</label>
						<input
							v-model="form.label"
							type="text"
							class="field-input"
							placeholder="prod-server"
							maxlength="64"
						/>
						<span v-if="labelError" class="field-error">
							{{ labelError }}
						</span>
					</div>

					<!-- Group selector -->
					<div class="field">
						<label class="field-label">Group</label>
						<div class="group-selector">
							<select
								v-if="!showNewGroup"
								v-model="form.hostGroup"
								class="field-select"
							>
								<option value="">Ungrouped</option>
								<option
									v-for="g in groups"
									:key="g"
									:value="g"
								>
									{{ g }}
								</option>
							</select>
							<button
								v-if="!showNewGroup"
								class="btn-link"
								@click="showNewGroup = true"
							>
								+ New group
							</button>
							<input
								v-if="showNewGroup"
								v-model="newGroupName"
								type="text"
								class="field-input"
								placeholder="Group name"
								maxlength="32"
							/>
							<button
								v-if="showNewGroup"
								class="btn-link"
								@click="showNewGroup = false"
							>
								Cancel
							</button>
						</div>
					</div>

					<!-- SSH fields (only for type=ssh) -->
					<template v-if="form.type === 'ssh'">
						<div class="form-row">
							<div class="field flex-2">
								<label class="field-label">Hostname</label>
								<input
									v-model="form.sshHost"
									type="text"
									class="field-input"
									placeholder="192.168.1.100"
								/>
							</div>
							<div class="field flex-1">
								<label class="field-label">Port</label>
								<input
									v-model.number="form.sshPort"
									type="number"
									class="field-input"
									min="1"
									max="65535"
								/>
							</div>
						</div>

						<div class="field">
							<label class="field-label">Username</label>
							<input
								v-model="form.sshUser"
								type="text"
								class="field-input"
								placeholder="deploy"
							/>
						</div>

						<div class="field">
							<label class="field-label">Auth Method</label>
							<select v-model="form.sshAuth" class="field-select">
								<option value="key">SSH Key</option>
								<option value="agent">SSH Agent</option>
								<option value="password">
									Password (prompted)
								</option>
							</select>
						</div>

						<div v-if="form.sshAuth === 'key'" class="field">
							<label class="field-label">Key Path</label>
							<input
								v-model="form.sshKeyPath"
								type="text"
								class="field-input"
								placeholder="~/.ssh/id_ed25519"
							/>
						</div>

						<!-- Test Connection -->
						<div class="field field-test">
							<button
								class="btn btn-test"
								:disabled="!form.sshHost || testing"
								@click="testConnectionInline"
							>
								{{ testing ? "Testing..." : "Test Connection" }}
							</button>
							<span
								v-if="testResult"
								:class="
									testResult.ok ? 'test-ok' : 'test-fail'
								"
							>
								{{
									testResult.ok
										? "Connected"
										: testResult.message
								}}
							</span>
						</div>
					</template>

					<!-- Advanced section (collapsible) -->
					<details class="advanced-section">
						<summary>Advanced</summary>
						<div class="field">
							<label class="field-label">Default Shell</label>
							<input
								v-model="form.defaultShell"
								type="text"
								class="field-input"
								placeholder="/bin/bash"
							/>
						</div>
						<div class="form-row">
							<div class="field flex-1">
								<label class="field-label">
									Keep Alive (s)
								</label>
								<input
									v-model.number="form.keepAliveSeconds"
									type="number"
									class="field-input"
									min="0"
								/>
							</div>
							<div class="field flex-1">
								<label class="field-label">
									History (days)
								</label>
								<input
									v-model.number="form.historyRetentionDays"
									type="number"
									class="field-input"
									min="1"
								/>
							</div>
						</div>
						<div class="field">
							<label class="field-label">Remote Hints</label>
							<select
								v-model="form.trustRemoteHints"
								class="field-select"
							>
								<option value="apply">Apply</option>
								<option value="ask">Ask</option>
								<option value="ignore">Ignore</option>
							</select>
						</div>
					</details>
				</div>

				<div class="dialog-actions">
					<button class="btn btn-secondary" @click="$emit('close')">
						Cancel
					</button>
					<button
						class="btn btn-primary"
						:disabled="!canSave || saving"
						@click="onSave"
					>
						{{
							saving
								? "Saving..."
								: editHost
									? "Save"
									: "Add Host"
						}}
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, type PropType } from "vue";
import type { Host } from "@nexterm/shared";
import { useHostForm } from "../composables/useHostForm.js";
import { useHostsStore } from "../stores/hosts.js";

const props = defineProps({
	visible: { type: Boolean, required: true },
	editHost: { type: Object as PropType<Host | null>, default: null },
});

const emit = defineEmits<{
	close: [];
	saved: [host: Host];
	"batch-import": [];
}>();

const hostsStore = useHostsStore();
const {
	form,
	source,
	sshConfigEntries,
	sshConfigHasInclude,
	selectedSshConfigHost,
	loadingSshConfig,
	testResult,
	testing,
	saving,
	labelError,
	canSave,
	newGroupName,
	showNewGroup,
	loadSshConfig,
	applySshConfigEntry,
	testConnectionInline,
	save,
} = useHostForm(props.editHost ?? undefined);

const groups = computed(() => hostsStore.getHostGroups());
const serverHosts = computed(() =>
	sshConfigEntries.value.filter((e) => !e.isGitHost),
);

function onSelectSshConfig(): void {
	source.value = "ssh-config";
	if (sshConfigEntries.value.length === 0) void loadSshConfig();
}

async function onSave(): Promise<void> {
	const host = await save();
	if (host) {
		emit("saved", host);
		emit("close");
	}
}
</script>

<style scoped>
.dialog-overlay {
	position: fixed;
	inset: 0;
	background: var(--nt-overlay-heavy);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 10000;
}

.dialog-content.host-modal {
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 8px;
	padding: 0;
	min-width: 420px;
	max-width: 520px;
	width: 100%;
	box-shadow: var(--nt-shadow);
	max-height: 85vh;
	display: flex;
	flex-direction: column;
}

.dialog-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px 0;
}

.dialog-title {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	color: var(--nt-fg);
}

.dialog-close {
	background: none;
	border: none;
	color: var(--nt-text-secondary);
	font-size: 18px;
	cursor: pointer;
	padding: 0 4px;
	line-height: 1;
}

.dialog-close:hover {
	color: var(--nt-fg);
}

.dialog-body {
	padding: 16px 20px;
	overflow-y: auto;
	flex: 1;
}

.dialog-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
	padding: 12px 20px 16px;
	border-top: 1px solid var(--nt-border);
}

.field {
	margin-bottom: 12px;
}

.field-label {
	display: block;
	font-size: 11px;
	font-weight: 600;
	color: var(--nt-text-secondary);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin-bottom: 4px;
}

.field-input,
.field-select {
	width: 100%;
	padding: 6px 8px;
	font-size: 12px;
	font-family: inherit;
	background: var(--nt-tab-bar);
	color: var(--nt-fg);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	outline: none;
	transition: border-color 0.15s;
}

.field-input:focus,
.field-select:focus {
	border-color: var(--nt-accent);
}

.field-error {
	display: block;
	font-size: 11px;
	color: var(--nt-red, #e06c75);
	margin-top: 3px;
}

.field-hint {
	font-size: 11px;
	color: var(--nt-text-secondary);
}

.field-test {
	display: flex;
	align-items: center;
	gap: 10px;
}

.form-row {
	display: flex;
	gap: 12px;
}

.flex-1 {
	flex: 1;
}

.flex-2 {
	flex: 2;
}

.source-tabs {
	display: flex;
	gap: 0;
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	overflow: hidden;
}

.source-tab {
	flex: 1;
	padding: 5px 10px;
	font-size: 12px;
	font-family: inherit;
	background: var(--nt-tab-bar);
	color: var(--nt-text-secondary);
	border: none;
	cursor: pointer;
	transition:
		background 0.12s,
		color 0.12s;
}

.source-tab + .source-tab {
	border-left: 1px solid var(--nt-border);
}

.source-tab.active {
	background: var(--nt-accent);
	color: #fff;
}

.group-selector {
	display: flex;
	gap: 8px;
	align-items: center;
}

.group-selector .field-select,
.group-selector .field-input {
	flex: 1;
}

.btn-link {
	background: none;
	border: none;
	color: var(--nt-accent);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
	padding: 0;
	white-space: nowrap;
}

.btn-link:hover {
	text-decoration: underline;
}

.batch-import-link {
	display: block;
	margin-top: 6px;
	font-size: 11px;
}

.btn {
	padding: 6px 14px;
	font-size: 12px;
	font-family: inherit;
	font-weight: 500;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	transition:
		background 0.12s,
		opacity 0.12s;
}

.btn:hover {
	opacity: 0.85;
}

.btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.btn-secondary {
	background: var(--nt-tab-hover);
	color: var(--nt-fg);
}

.btn-primary {
	background: var(--nt-accent);
	color: #fff;
}

.btn-test {
	background: var(--nt-tab-hover);
	color: var(--nt-fg);
}

.warning-banner {
	padding: 6px 10px;
	font-size: 11px;
	color: var(--nt-yellow, #e5c07b);
	background: rgba(229, 192, 123, 0.1);
	border: 1px solid var(--nt-yellow, #e5c07b);
	border-radius: 4px;
	margin-bottom: 8px;
}

.test-ok {
	font-size: 12px;
	color: var(--nt-green, #98c379);
}

.test-fail {
	font-size: 12px;
	color: var(--nt-red, #e06c75);
}

.advanced-section {
	margin-top: 8px;
	border-top: 1px solid var(--nt-border);
	padding-top: 8px;
}

.advanced-section summary {
	font-size: 12px;
	font-weight: 500;
	color: var(--nt-text-secondary);
	cursor: pointer;
	padding: 4px 0;
	user-select: none;
}

.advanced-section summary:hover {
	color: var(--nt-fg);
}

.advanced-section[open] summary {
	margin-bottom: 12px;
}
</style>
