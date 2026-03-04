<template>
	<Teleport to="body">
		<div v-if="request" class="wrd-backdrop" role="dialog" aria-modal="true" aria-labelledby="wrd-title">
			<div class="wrd-card">
				<h3 id="wrd-title" class="wrd-title">Write Access Request</h3>
				<p class="wrd-body">
					Client <code class="wrd-client-id">{{ request.fromClientId }}</code> is requesting
					write access to channel <code class="wrd-channel-id">{{ shortChannel }}</code>.
				</p>

				<div class="wrd-countdown-wrap" :title="`Auto-deny in ${secondsLeft}s`">
					<div
						class="wrd-countdown-bar"
						:style="{ width: `${(secondsLeft / AUTO_DENY_SECS) * 100}%` }"
						:class="{ urgent: secondsLeft <= 5 }"
					/>
				</div>
				<p class="wrd-countdown-label">Auto-deny in {{ secondsLeft }}s</p>

				<div class="wrd-actions">
					<button class="wrd-btn wrd-deny" @click="handleDeny">Deny</button>
					<button class="wrd-btn wrd-allow" @click="handleAllow">Allow</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useWriteLockStore } from "../stores/writelock.js";

const AUTO_DENY_SECS = 30;

const writeLockStore = useWriteLockStore();

const request = computed(() => writeLockStore.incomingRequest);

const secondsLeft = ref(AUTO_DENY_SECS);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const shortChannel = computed(() =>
	request.value ? request.value.channelId.slice(-8) : "",
);

function startCountdown(): void {
	clearCountdownTimer();
	secondsLeft.value = AUTO_DENY_SECS;
	countdownTimer = setInterval(() => {
		secondsLeft.value--;
		if (secondsLeft.value <= 0) {
			autoDeny();
		}
	}, 1_000);
}

function clearCountdownTimer(): void {
	if (countdownTimer !== null) {
		clearInterval(countdownTimer);
		countdownTimer = null;
	}
}

watch(
	request,
	(newReq) => {
		if (newReq) {
			startCountdown();
		} else {
			clearCountdownTimer();
		}
	},
	{ immediate: true },
);

onUnmounted(() => {
	clearCountdownTimer();
});

function handleAllow(): void {
	const req = request.value;
	if (!req) return;
	clearCountdownTimer();
	writeLockStore.grant(req.channelId, req.fromClientId);
}

function handleDeny(): void {
	const req = request.value;
	if (!req) return;
	clearCountdownTimer();
	writeLockStore.deny(req.channelId, req.fromClientId);
}

function autoDeny(): void {
	const req = request.value;
	if (!req) return;
	clearCountdownTimer();
	writeLockStore.deny(req.channelId, req.fromClientId);
}
</script>

<style scoped>
.wrd-backdrop {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: flex-end;
	justify-content: flex-end;
	padding: 24px;
	pointer-events: none;
	z-index: 900;
}

.wrd-card {
	background: #1e1e2e;
	border: 1px solid #45475a;
	border-radius: 10px;
	padding: 20px 24px;
	width: 320px;
	max-width: calc(100vw - 48px);
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
	pointer-events: all;
	display: flex;
	flex-direction: column;
	gap: 10px;
	animation: slide-in 0.2s ease-out;
}

@keyframes slide-in {
	from {
		transform: translateY(16px);
		opacity: 0;
	}
	to {
		transform: translateY(0);
		opacity: 1;
	}
}

.wrd-title {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	color: #cdd6f4;
}

.wrd-body {
	margin: 0;
	font-size: 12px;
	color: #a6adc8;
	line-height: 1.5;
}

.wrd-client-id,
.wrd-channel-id {
	font-family: "Cascadia Code", "Fira Code", monospace;
	font-size: 11px;
	background: #181825;
	border: 1px solid #313244;
	border-radius: 3px;
	padding: 1px 4px;
	color: #89b4fa;
}

.wrd-countdown-wrap {
	width: 100%;
	height: 3px;
	background: #313244;
	border-radius: 2px;
	overflow: hidden;
}

.wrd-countdown-bar {
	height: 100%;
	background: #89b4fa;
	border-radius: 2px;
	transition: width 1s linear, background 0.3s;
}

.wrd-countdown-bar.urgent {
	background: #f38ba8;
}

.wrd-countdown-label {
	margin: 0;
	font-size: 10px;
	color: #585b70;
}

.wrd-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
	margin-top: 4px;
}

.wrd-btn {
	height: 32px;
	padding: 0 14px;
	border-radius: 6px;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	border: 1px solid transparent;
	transition: background 0.12s, opacity 0.12s;
}

.wrd-deny {
	background: #313244;
	border-color: #45475a;
	color: #a6adc8;
}

.wrd-deny:hover {
	background: #45475a;
	color: #cdd6f4;
}

.wrd-allow {
	background: #a6e3a1;
	color: #1e1e2e;
}

.wrd-allow:hover {
	background: #c3f0bf;
}
</style>
