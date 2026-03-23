
import { ref, type Ref } from "vue";
import { hubBaseUrl } from "../utils/hub-url.js";
import { useAuthStore } from "../stores/auth.js";

export interface LogEntry {
	t?: number; // channel log: offset in ms
	ts?: string; // hub log: ISO 8601 timestamp
	src?: "hub" | "agent";
	lvl: string;
	msg: string;
	[key: string]: unknown;
}

interface FetchParams {
	level?: string;
	search?: string;
	offset?: number;
}

export interface UseLogsOptions {
	/** If set, fetch channel logs. If absent/undefined, fetch hub logs. */
	channelId?: string;
	/** Page size — default 100. */
	limit?: number;
}

export interface UseLogsReturn {
	entries: Ref<LogEntry[]>;
	total: Ref<number>;
	loading: Ref<boolean>;
	error: Ref<string | null>;
	fetch: (params?: FetchParams) => Promise<void>;
	loadMore: () => Promise<void>;
}

export function useLogs(options: UseLogsOptions): UseLogsReturn {
	const { channelId, limit = 100 } = options;

	const entries: Ref<LogEntry[]> = ref([]);
	const total: Ref<number> = ref(0);
	const loading: Ref<boolean> = ref(false);
	const error: Ref<string | null> = ref(null);

	/** Last params used for fetch — stored so loadMore can append. */
	let _lastParams: FetchParams = {};

	function buildUrl(params: FetchParams & { offset?: number }): string {
		const base = hubBaseUrl();
		const path =
			channelId !== undefined
				? `${base}/api/logs/channels/${encodeURIComponent(channelId)}`
				: `${base}/api/logs/hub`;

		const qs = new URLSearchParams();
		if (params.level) qs.set("level", params.level);
		if (params.search) qs.set("search", params.search);
		qs.set("limit", String(limit));
		if (params.offset !== undefined) qs.set("offset", String(params.offset));

		const query = qs.toString();
		return query ? `${path}?${query}` : path;
	}

	async function fetch(params: FetchParams = {}): Promise<void> {
		const authStore = useAuthStore();
		if (authStore.token === null) {
			error.value = "Not authenticated";
			return;
		}

		_lastParams = params;
		loading.value = true;
		error.value = null;

		try {
			const url = buildUrl({ ...params, offset: 0 });
			const res = await globalThis.fetch(url, {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});

			if (!res.ok) {
				error.value = `Request failed: ${res.status} ${res.statusText}`;
				return;
			}

			const data = (await res.json()) as { entries: LogEntry[]; total: number };
			entries.value = data.entries;
			total.value = data.total;
		} catch (err) {
			error.value = err instanceof Error ? err.message : "Unknown error";
		} finally {
			loading.value = false;
		}
	}

	async function loadMore(): Promise<void> {
		const authStore = useAuthStore();
		if (authStore.token === null) return;
		if (loading.value) return;
		if (entries.value.length >= total.value) return;

		loading.value = true;
		error.value = null;

		try {
			const url = buildUrl({ ..._lastParams, offset: entries.value.length });
			const res = await globalThis.fetch(url, {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});

			if (!res.ok) {
				error.value = `Request failed: ${res.status} ${res.statusText}`;
				return;
			}

			const data = (await res.json()) as { entries: LogEntry[]; total: number };
			entries.value = [...entries.value, ...data.entries];
			total.value = data.total;
		} catch (err) {
			error.value = err instanceof Error ? err.message : "Unknown error";
		} finally {
			loading.value = false;
		}
	}

	return { entries, total, loading, error, fetch, loadMore };
}
