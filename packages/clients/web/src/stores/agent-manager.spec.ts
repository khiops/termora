import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentManagerStore } from "./agent-manager.js";

const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeJsonResponse(data: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: String(status),
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data)),
	} as Response;
}

const targetsResponse = {
	hub_version: "1.2.3",
	targets: [
		{
			os: "linux",
			arch: "x64",
			triple: "linux-x64",
			status: "bundled",
			version: "1.2.3",
			expected_version: "1.2.3",
		},
		{
			os: "linux",
			arch: "arm64",
			triple: "linux-arm64",
			status: "missing",
			expected_version: "1.2.3",
		},
	],
};

describe("useAgentManagerStore", () => {
	beforeEach(() => {
		localStorageMap.clear();
		localStorageMap.set("termora_token", "test-token");
		setActivePinia(createPinia());
		mockFetch.mockReset();
	});

	it("loadTargets fetches targets with Bearer auth and maps snake_case fields", async () => {
		mockFetch.mockResolvedValueOnce(makeJsonResponse(targetsResponse));

		const store = useAgentManagerStore();
		await store.loadTargets();

		expect(mockFetch).toHaveBeenCalledWith(
			"/api/agents/targets",
			expect.objectContaining({
				headers: { Authorization: "Bearer test-token" },
			}),
		);
		expect(store.hubVersion).toBe("1.2.3");
		expect(store.targets[1]).toMatchObject({
			os: "linux",
			arch: "arm64",
			expectedVersion: "1.2.3",
		});
	});

	it("fetchTarget handles already_cached by refreshing targets", async () => {
		mockFetch
			.mockResolvedValueOnce(makeJsonResponse({ status: "already_cached" }))
			.mockResolvedValueOnce(makeJsonResponse(targetsResponse));

		const store = useAgentManagerStore();
		const result = await store.fetchTarget("linux", "arm64");

		expect(result).toEqual({ status: "already_cached" });
		expect(mockFetch).toHaveBeenNthCalledWith(
			1,
			"/api/agents/fetch",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ os: "linux", arch: "arm64" }),
			}),
		);
		expect(mockFetch).toHaveBeenNthCalledWith(
			2,
			"/api/agents/targets",
			expect.objectContaining({
				headers: { Authorization: "Bearer test-token" },
			}),
		);
		expect(store.hubVersion).toBe("1.2.3");
	});

	it("fetchTarget handles 202 by tracking the job snapshot by target", async () => {
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse(
				{
					job_id: "job-1",
					snapshot: {
						downloaded: 10,
						total: 100,
						phase: "download",
					},
				},
				202,
			),
		);

		const store = useAgentManagerStore();
		const result = await store.fetchTarget("linux", "arm64");

		expect(result).toEqual({ status: "accepted", jobId: "job-1" });
		expect(store.progressFor("linux", "arm64")).toMatchObject({
			jobId: "job-1",
			downloaded: 10,
			total: 100,
			phase: "download",
		});
		expect(store.jobsById["job-1"]).toBeDefined();
	});

	it("importAgent appends validated fields before file parts", async () => {
		mockFetch
			.mockResolvedValueOnce(makeJsonResponse({ verified: true, version: "1.2.3" }))
			.mockResolvedValueOnce(makeJsonResponse(targetsResponse));

		const store = useAgentManagerStore();
		const binary = new File(["binary"], "termora-agent-linux-arm64");
		const manifest = new File(["checksum"], "SHA256SUMS-1.2.3.txt");

		await store.importAgent({
			binary,
			manifest,
			os: "linux",
			arch: "arm64",
			version: "1.2.3",
			attested: true,
		});

		const request = mockFetch.mock.calls[0]![1] as { body: FormData };
		expect(Array.from(request.body.entries()).map(([key]) => key)).toEqual([
			"os",
			"arch",
			"version",
			"attested",
			"binary",
			"manifest",
		]);
	});
});
