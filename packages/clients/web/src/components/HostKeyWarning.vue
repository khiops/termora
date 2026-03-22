<template>
	<Teleport to="body">
		<div
			v-if="prompt"
			class="hkw-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="hkw-title"
		>
			<div class="hkw-card">
				<div class="hkw-header">
					<span class="hkw-icon" aria-hidden="true">&#9888;</span>
					<h3 id="hkw-title" class="hkw-title">
						{{ prompt.firstConnect ? 'First SSH Connection' : 'SSH Host Key Changed' }}
					</h3>
				</div>

				<p class="hkw-hostname">{{ prompt.hostname }}</p>

				<p class="hkw-warning">
					<template v-if="prompt.firstConnect">
						First connection to this host. Verify the fingerprint before trusting it.
					</template>
					<template v-else>
						The SSH host key for this server has changed. This could indicate a
						man-in-the-middle attack.
					</template>
				</p>

				<template v-if="!prompt.firstConnect && prompt.oldFingerprint">
					<div class="hkw-fingerprint-block">
						<span class="hkw-fp-label">Previous key</span>
						<button
							class="hkw-fp-value"
							type="button"
							:title="copiedOld ? 'Copied!' : 'Click to copy'"
							@click="copyOld"
						>{{ prompt.oldFingerprint }}</button>
					</div>
				</template>

				<div class="hkw-fingerprint-block">
					<span class="hkw-fp-label">{{ prompt.firstConnect ? 'Server fingerprint' : 'New key' }}</span>
					<button
						class="hkw-fp-value"
						:class="{ 'hkw-fp-new': !prompt.firstConnect }"
						type="button"
						:title="copiedNew ? 'Copied!' : 'Click to copy'"
						@click="copyNew"
					>{{ prompt.fingerprint }}</button>
				</div>

				<div class="hkw-actions">
					<button class="hkw-btn hkw-reject" @click="handleReject">Reject</button>
					<button class="hkw-btn hkw-trust-once" @click="handleTrustOnce">Trust Once</button>
					<button class="hkw-btn hkw-accept" @click="handleAccept">
						{{ prompt.firstConnect ? 'Trust Permanently' : 'Accept New Key' }}
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useHostVerifyStore } from "../stores/host-verify.js";

const store = useHostVerifyStore();
const prompt = computed(() => store.pendingPrompt);

const copiedOld = ref(false);
const copiedNew = ref(false);

async function copyOld(): Promise<void> {
	if (!prompt.value) return;
	await navigator.clipboard.writeText(prompt.value.oldFingerprint);
	copiedOld.value = true;
	setTimeout(() => {
		copiedOld.value = false;
	}, 1500);
}

async function copyNew(): Promise<void> {
	if (!prompt.value) return;
	await navigator.clipboard.writeText(prompt.value.fingerprint);
	copiedNew.value = true;
	setTimeout(() => {
		copiedNew.value = false;
	}, 1500);
}

function handleAccept(): void {
	store.accept();
}

function handleTrustOnce(): void {
	store.trustOnce();
}

function handleReject(): void {
	store.reject();
}
</script>

<style scoped>
.hkw-backdrop {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.55);
	z-index: 10200;
}

.hkw-card {
	background: var(--nt-bg);
	border: 1px solid var(--nt-border);
	border-radius: 10px;
	padding: 24px 28px;
	width: 440px;
	max-width: calc(100vw - 48px);
	box-shadow: var(--nt-shadow);
	display: flex;
	flex-direction: column;
	gap: 14px;
	animation: hkw-slide-in 0.2s ease-out;
}

@keyframes hkw-slide-in {
	from {
		transform: translateY(-12px);
		opacity: 0;
	}
	to {
		transform: translateY(0);
		opacity: 1;
	}
}

.hkw-header {
	display: flex;
	align-items: center;
	gap: 10px;
}

.hkw-icon {
	font-size: 20px;
	color: #e5534b;
	flex-shrink: 0;
}

.hkw-title {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	color: #e5534b;
}

.hkw-hostname {
	margin: 0;
	font-size: 13px;
	font-weight: 500;
	color: var(--nt-fg);
}

.hkw-warning {
	margin: 0;
	font-size: 12px;
	color: var(--nt-text-muted);
	line-height: 1.5;
}

.hkw-fingerprint-block {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.hkw-fp-label {
	font-size: 11px;
	color: var(--nt-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.hkw-fp-value {
	font-family: monospace;
	font-size: 11px;
	background: var(--nt-tab-bar);
	border: 1px solid var(--nt-border);
	border-radius: 4px;
	padding: 6px 8px;
	color: var(--nt-fg);
	cursor: pointer;
	text-align: left;
	word-break: break-all;
	transition: border-color 0.12s;
}

.hkw-fp-value:hover {
	border-color: var(--nt-accent);
}

.hkw-fp-new {
	border-color: rgba(229, 83, 75, 0.4);
}

.hkw-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
	margin-top: 4px;
}

.hkw-btn {
	height: 32px;
	padding: 0 14px;
	border-radius: 6px;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	border: 1px solid transparent;
	transition: background 0.12s, opacity 0.12s;
}

.hkw-reject {
	background: var(--nt-border);
	border-color: var(--nt-tab-hover);
	color: var(--nt-text-muted);
}

.hkw-reject:hover {
	background: var(--nt-tab-hover);
	color: var(--nt-fg);
}

.hkw-trust-once {
	background: var(--nt-border);
	border-color: var(--nt-tab-hover);
	color: var(--nt-accent);
}

.hkw-trust-once:hover {
	background: var(--nt-tab-hover);
	color: var(--nt-accent);
	opacity: 0.9;
}

.hkw-accept {
	background: #e5534b;
	color: #fff;
}

.hkw-accept:hover {
	opacity: 0.85;
}
</style>
