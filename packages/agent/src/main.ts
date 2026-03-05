import { encodeFrame } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { AgentHandler } from "./handler.js";

function main(): void {
	// The agent speaks only via stdin/stdout (length-prefixed MessagePack).
	// All diagnostic output goes to stderr so it never corrupts the frame stream.

	// Backpressure: when stdout can't keep up (write returns false), pause
	// stdin so the hub stops sending frames. Resume on drain.
	let stdoutPaused = false;

	const handler = new AgentHandler((msg: ProtocolMessage) => {
		const frame = encodeFrame(msg);
		const ok = process.stdout.write(Buffer.from(frame));
		if (!ok && !stdoutPaused) {
			stdoutPaused = true;
			process.stdin.pause();
		}
	});

	process.stdout.on("drain", () => {
		if (stdoutPaused) {
			stdoutPaused = false;
			process.stdin.resume();
		}
	});

	// Announce ourselves immediately; hub will not send commands until it
	// receives HELLO.
	handler.sendHello();

	process.stdin.on("data", (data: Buffer) => {
		try {
			handler.onData(data);
		} catch (err) {
			console.error("[nexterm-agent] frame error:", err);
		}
	});

	process.stdin.on("end", () => {
		// Hub closed its end of the pipe — shut down cleanly.
		handler.shutdown();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		handler.shutdown();
		process.exit(0);
	});
}

main();
