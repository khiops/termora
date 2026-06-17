import { isTauriRuntime } from "./hub-url.js";

export interface DesktopAgentImportFiles {
	binary: File | null;
	manifest: File | null;
}

type AgentFileKind = "binary" | "manifest";
type PickedAgentFile = {
	name: string;
	bytes: number[] | Uint8Array<ArrayBuffer>;
};
type PickAndReadAgentFile = (kind: AgentFileKind) => Promise<PickedAgentFile | null>;

export async function pickDesktopAgentImportFiles(): Promise<DesktopAgentImportFiles | null> {
	if (!isTauriRuntime()) return null;

	const { invoke } = await import("@tauri-apps/api/core");
	const pickAndReadAgentFile: PickAndReadAgentFile = (kind) =>
		invoke("pick_and_read_agent_file", { kind });
	const binary = await pickAgentFile("binary", pickAndReadAgentFile);
	if (binary === null) return null;
	const manifest = await pickAgentFile("manifest", pickAndReadAgentFile);
	return { binary, manifest };
}

async function pickAgentFile(
	kind: AgentFileKind,
	pickAndReadAgentFile: PickAndReadAgentFile,
): Promise<File | null> {
	const picked = await pickAndReadAgentFile(kind);
	if (picked === null) return null;
	const bytes = picked.bytes instanceof Uint8Array ? picked.bytes : Uint8Array.from(picked.bytes);
	return new File([bytes], picked.name, { type: mimeTypeForName(picked.name) });
}

function mimeTypeForName(name: string): string {
	return name.toLowerCase().endsWith(".txt") ? "text/plain" : "application/octet-stream";
}
