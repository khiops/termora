import type { Client as SshClient } from "ssh2";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Execute a command over SSH and return { stdout, stderr, exitCode }.
 * Resolves when the command exits. Rejects on SSH-level errors or timeout.
 *
 * Uses ssh2 Client.exec() (not child_process.exec) - no shell injection risk.
 * Commands are sent verbatim over the SSH channel to the remote host.
 */
export function sshExec(
	client: SshClient,
	command: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error(`SSH exec timed out after ${timeoutMs}ms: ${command}`));
		}, timeoutMs);

		client.exec(command, (err, stream) => {
			if (err) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(err);
				return;
			}

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			stream.on("data", (chunk: Buffer) => {
				stdoutChunks.push(chunk);
			});

			stream.stderr.on("data", (chunk: Buffer) => {
				stderrChunks.push(chunk);
			});

			stream.on("close", (code: number | null) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString("utf8"),
					stderr: Buffer.concat(stderrChunks).toString("utf8"),
					exitCode: code ?? 1,
				});
			});

			stream.on("error", (streamErr: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(streamErr);
			});
		});
	});
}
