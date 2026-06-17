import { isTauriRuntime } from "./hub-url.js";

export interface DesktopAgentImportFiles {
	binary: File | null;
	manifest: File | null;
}

type ReadAgentFile = (path: string) => Promise<number[] | Uint8Array<ArrayBuffer>>;

const SHA256SUMS_MANIFEST_RE = /^SHA256SUMS-.+\.txt$/i;

export async function pickDesktopAgentImportFiles(): Promise<DesktopAgentImportFiles | null> {
	if (!isTauriRuntime()) return null;

	const [{ open }, { invoke }] = await Promise.all([
		import("@tauri-apps/plugin-dialog"),
		import("@tauri-apps/api/core"),
	]);
	const readAgentFile: ReadAgentFile = (path) => invoke("read_agent_file", { path });

	const selected = await open({
		title: "Select agent binary and SHA256SUMS manifest",
		multiple: true,
		directory: false,
		canCreateDirectories: false,
		filters: [
			{ name: "Agent binaries and SHA256SUMS manifests", extensions: ["exe", "txt"] },
			{ name: "All files", extensions: ["*"] },
		],
	});

	const paths = Array.isArray(selected) ? selected : selected === null ? [] : [selected];
	if (paths.length === 0) return null;

	return classifyFiles(await Promise.all(paths.map((path) => readPathAsFile(path, readAgentFile))));
}

function classifyFiles(files: File[]): DesktopAgentImportFiles {
	const manifest =
		files.find((file) => SHA256SUMS_MANIFEST_RE.test(file.name)) ??
		files.find((file) => file.name.toLowerCase().endsWith(".txt")) ??
		null;
	const binary = files.find((file) => file !== manifest) ?? null;
	return { binary, manifest };
}

async function readPathAsFile(path: string, readFile: ReadAgentFile): Promise<File> {
	const rawBytes = await readFile(path);
	const bytes = rawBytes instanceof Uint8Array ? rawBytes : Uint8Array.from(rawBytes);
	const name = basename(path);
	return new File([bytes], name, { type: mimeTypeForName(name) });
}

function basename(path: string): string {
	if (path.startsWith("file:")) {
		try {
			const urlPath = new URL(path).pathname;
			return decodeURIComponent(urlPath.split(/[\\/]/).filter(Boolean).pop() ?? "selected-file");
		} catch {
			return "selected-file";
		}
	}

	return path.split(/[\\/]/).filter(Boolean).pop() ?? "selected-file";
}

function mimeTypeForName(name: string): string {
	return name.toLowerCase().endsWith(".txt") ? "text/plain" : "application/octet-stream";
}
