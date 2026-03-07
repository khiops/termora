import type { Host, SshConfigEntry } from "@nexterm/shared";
import { computed, ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useHostsStore } from "../stores/hosts.js";

export interface HostFormData {
	label: string;
	type: "local" | "ssh";
	sshHost: string;
	sshPort: number;
	sshUser: string;
	sshAuth: "agent" | "key" | "password";
	sshKeyPath: string;
	iconType: "auto" | "emoji" | "image";
	iconValue: string;
	color: string;
	hostGroup: string;
	defaultShell: string;
	keepAliveSeconds: number;
	historyRetentionDays: number;
	trustRemoteHints: "apply" | "ask" | "ignore";
}

export function useHostForm(editHost?: Host) {
	const hostsStore = useHostsStore();
	const authStore = useAuthStore();

	const isEdit = !!editHost;

	const form = ref<HostFormData>({
		label: editHost?.label ?? "",
		type: editHost?.type ?? "ssh",
		sshHost: editHost?.sshHost ?? "",
		sshPort: editHost?.sshPort ?? 22,
		sshUser: editHost?.sshUser ?? "",
		sshAuth: editHost?.sshAuth ?? "key",
		sshKeyPath: editHost?.sshKeyPath ?? "",
		iconType: editHost?.iconType ?? "auto",
		iconValue: editHost?.iconValue ?? "",
		color: editHost?.color ?? "",
		hostGroup: editHost?.hostGroup ?? "",
		defaultShell: editHost?.defaultShell ?? "",
		keepAliveSeconds: editHost?.keepAliveSeconds ?? 60,
		historyRetentionDays: editHost?.historyRetentionDays ?? 30,
		trustRemoteHints: editHost?.trustRemoteHints ?? "apply",
	});

	// Source: "manual" or "ssh-config"
	const source = ref<"manual" | "ssh-config">("manual");
	const sshConfigEntries = ref<SshConfigEntry[]>([]);
	const sshConfigHasInclude = ref(false);
	const selectedSshConfigHost = ref<string>("");
	const loadingSshConfig = ref(false);

	const testResult = ref<{ ok: boolean; message?: string } | null>(null);
	const testing = ref(false);
	const saving = ref(false);

	// New group creation inline
	const newGroupName = ref("");
	const showNewGroup = ref(false);

	const labelError = computed(() => {
		const label = form.value.label.trim();
		if (!label) return "Label is required";
		if (label.length > 64) return "Label must be 64 characters or fewer";
		if (!/^[a-zA-Z0-9._-]+$/.test(label)) return "Only letters, numbers, dots, dashes, underscores";
		// Check for duplicate (excluding self if editing)
		const existing = hostsStore.hosts.find((h) => h.label.toLowerCase() === label.toLowerCase());
		if (existing && (!isEdit || existing.id !== editHost?.id)) return "Host name already exists";
		return null;
	});

	const canSave = computed(() => {
		if (labelError.value) return false;
		if (form.value.type === "ssh") {
			if (!form.value.sshHost) return false;
			if (form.value.sshAuth === "key" && !form.value.sshKeyPath) return false;
		}
		return true;
	});

	async function loadSshConfig(): Promise<void> {
		loadingSshConfig.value = true;
		try {
			const res = await fetch("/api/ssh-config", {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (!res.ok) {
				if (res.status === 404) {
					sshConfigEntries.value = [];
					return;
				}
				throw new Error("Failed to load SSH config");
			}
			const data = (await res.json()) as {
				entries: SshConfigEntry[];
				has_include: boolean;
			};
			sshConfigEntries.value = data.entries;
			sshConfigHasInclude.value = data.has_include;
		} finally {
			loadingSshConfig.value = false;
		}
	}

	function applySshConfigEntry(name: string): void {
		const entry = sshConfigEntries.value.find((e) => e.name === name);
		if (!entry) return;
		selectedSshConfigHost.value = name;
		if (entry.hostname) form.value.sshHost = entry.hostname;
		form.value.sshPort = entry.port;
		if (entry.user) form.value.sshUser = entry.user;
		if (entry.identityFile) {
			form.value.sshKeyPath = entry.identityFile;
			form.value.sshAuth = "key";
		}
		if (!form.value.label) form.value.label = name;
	}

	async function testConnectionInline(): Promise<void> {
		testing.value = true;
		testResult.value = null;
		try {
			if (isEdit && editHost) {
				testResult.value = await hostsStore.testConnection(editHost.id);
			} else {
				// Test unsaved host
				const res = await fetch("/api/hosts/test", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${authStore.token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						hostname: form.value.sshHost,
						port: form.value.sshPort,
						ssh_auth: form.value.sshAuth,
						ssh_key_path: form.value.sshKeyPath || undefined,
						ssh_user: form.value.sshUser || undefined,
					}),
				});
				testResult.value = (await res.json()) as {
					ok: boolean;
					message?: string;
				};
			}
		} catch {
			testResult.value = { ok: false, message: "Connection test failed" };
		} finally {
			testing.value = false;
		}
	}

	async function save(extraBody?: Record<string, unknown>): Promise<Host | null> {
		if (!canSave.value) return null;
		saving.value = true;
		try {
			const group =
				showNewGroup.value && newGroupName.value.trim()
					? newGroupName.value.trim()
					: form.value.hostGroup || undefined;

			const body: Record<string, unknown> = {
				label: form.value.label.trim(),
				type: form.value.type,
				...(form.value.type === "ssh" && {
					ssh_host: form.value.sshHost,
					ssh_port: form.value.sshPort,
					...(form.value.sshUser && { ssh_user: form.value.sshUser }),
					ssh_auth: form.value.sshAuth,
					...(form.value.sshAuth === "key" && {
						ssh_key_path: form.value.sshKeyPath,
					}),
				}),
				icon_type: form.value.iconType,
				...(form.value.iconValue && { icon_value: form.value.iconValue }),
				...(form.value.color && { color: form.value.color }),
				...(group !== undefined && { host_group: group }),
				...(form.value.defaultShell && {
					default_shell: form.value.defaultShell,
				}),
				keep_alive_seconds: form.value.keepAliveSeconds,
				history_retention_days: form.value.historyRetentionDays,
				trust_remote_hints: form.value.trustRemoteHints,
				...extraBody,
			};

			if (isEdit && editHost) {
				return await hostsStore.updateHost(editHost.id, body);
			}
			return await hostsStore.createHost(body);
		} finally {
			saving.value = false;
		}
	}

	return {
		form,
		isEdit,
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
	};
}
