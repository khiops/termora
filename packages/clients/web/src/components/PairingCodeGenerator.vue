<template>
	<div class="generator">
		<button class="gen-btn" :disabled="loading || !!activeCode" @click="generate">
			<span v-if="loading" class="spinner" aria-hidden="true" />
			{{ loading ? "Generating…" : "Generate Pairing Code" }}
		</button>

		<div v-if="activeCode" class="code-display">
			<div class="code-row">
				<span class="code-value">{{ activeCode }}</span>
				<button class="copy-btn" :class="{ copied }" @click="copyCode" :aria-label="copied ? 'Copied' : 'Copy code'">
					{{ copied ? "Copied!" : "Copy" }}
				</button>
			</div>
			<div class="countdown-bar-wrap" :title="`Expires in ${secondsLeft}s`">
				<div
					class="countdown-bar"
					:style="{ width: `${(secondsLeft / 60) * 100}%` }"
					:class="{ urgent: secondsLeft <= 10 }"
				/>
			</div>
			<p class="countdown-label">Expires in {{ secondsLeft }}s</p>
		</div>

		<p v-if="errorMsg" class="gen-error" role="alert">{{ errorMsg }}</p>
	</div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { useAuthStore } from "../stores/auth.js";

const authStore = useAuthStore();

const loading = ref(false);
const activeCode = ref<string | null>(null);
const secondsLeft = ref(60);
const copied = ref(false);
const errorMsg = ref<string | null>(null);

let countdown: ReturnType<typeof setInterval> | null = null;
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function clearCountdown(): void {
	if (countdown !== null) {
		clearInterval(countdown);
		countdown = null;
	}
}

onUnmounted(() => {
	clearCountdown();
	if (copyTimer !== null) clearTimeout(copyTimer);
});

async function generate(): Promise<void> {
	loading.value = true;
	errorMsg.value = null;
	activeCode.value = null;
	secondsLeft.value = 60;
	clearCountdown();

	try {
		const res = await fetch("/api/pair", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authStore.token ?? ""}`,
			},
		});

		if (!res.ok) {
			const body = (await res.json().catch(() => ({ message: "Request failed" }))) as {
				message?: string;
			};
			throw new Error(body.message ?? `HTTP ${res.status}`);
		}

		const data = (await res.json()) as { code: string; expiresIn?: number };
		activeCode.value = data.code;
		secondsLeft.value = data.expiresIn ?? 60;

		countdown = setInterval(() => {
			secondsLeft.value--;
			if (secondsLeft.value <= 0) {
				clearCountdown();
				activeCode.value = null;
			}
		}, 1_000);
	} catch (err) {
		errorMsg.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
	}
}

async function copyCode(): Promise<void> {
	if (!activeCode.value) return;
	try {
		await navigator.clipboard.writeText(activeCode.value);
		copied.value = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied.value = false;
		}, 2_000);
	} catch {
		// Clipboard unavailable — silently ignore
	}
}
</script>

<style scoped>
.generator {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px 0;
}

.gen-btn {
	height: 36px;
	padding: 0 16px;
	background: #313244;
	border: 1px solid #45475a;
	border-radius: 6px;
	color: #cdd6f4;
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s;
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.gen-btn:hover:not(:disabled) {
	background: #45475a;
}

.gen-btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.code-display {
	background: #181825;
	border: 1px solid #313244;
	border-radius: 8px;
	padding: 12px 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.code-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.code-value {
	font-size: 26px;
	font-weight: 700;
	letter-spacing: 0.25em;
	font-family: "Cascadia Code", "Fira Code", monospace;
	color: #89b4fa;
}

.copy-btn {
	height: 28px;
	padding: 0 10px;
	background: #313244;
	border: 1px solid #45475a;
	border-radius: 4px;
	color: #a6adc8;
	font-size: 12px;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
	white-space: nowrap;
}

.copy-btn:hover {
	background: #45475a;
	color: #cdd6f4;
}

.copy-btn.copied {
	color: #a6e3a1;
	border-color: #a6e3a1;
}

.countdown-bar-wrap {
	width: 100%;
	height: 3px;
	background: #313244;
	border-radius: 2px;
	overflow: hidden;
}

.countdown-bar {
	height: 100%;
	background: #89b4fa;
	border-radius: 2px;
	transition: width 1s linear, background 0.3s;
}

.countdown-bar.urgent {
	background: #f38ba8;
}

.countdown-label {
	margin: 0;
	font-size: 11px;
	color: #585b70;
}

.gen-error {
	margin: 0;
	font-size: 12px;
	color: #f38ba8;
}

.spinner {
	width: 12px;
	height: 12px;
	border: 2px solid rgba(205, 214, 244, 0.2);
	border-top-color: #cdd6f4;
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
	flex-shrink: 0;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
