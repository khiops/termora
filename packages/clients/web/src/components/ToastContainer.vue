<template>
	<Teleport to="body">
		<TransitionGroup name="toast" tag="div" class="toast-container" aria-live="polite" aria-atomic="false">
			<div
				v-for="msg in toastStore.messages"
				:key="msg.id"
				class="toast-item"
				:class="`toast-item--${msg.level}`"
				role="alert"
			>
				<span class="toast-icon" aria-hidden="true">
					{{ msg.level === 'error' ? '✕' : msg.level === 'warning' ? '⚠' : 'ℹ' }}
				</span>
				<span class="toast-text">{{ msg.text }}</span>
				<button
					class="toast-close"
					type="button"
					aria-label="Dismiss"
					@click="toastStore.dismiss(msg.id)"
				>
					&#10005;
				</button>
			</div>
		</TransitionGroup>
	</Teleport>
</template>

<script setup lang="ts">
import { useToastStore } from '../stores/toast.js';

const toastStore = useToastStore();
</script>

<style scoped>
.toast-container {
	position: fixed;
	bottom: 20px;
	right: 20px;
	z-index: 9999;
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-width: 420px;
	pointer-events: none;
}

.toast-item {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 10px 12px;
	border-radius: 6px;
	font-size: 13px;
	line-height: 1.4;
	pointer-events: all;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	border: 1px solid transparent;
	background: var(--nt-sidebar-bg, #21252b);
	color: var(--nt-fg, #abb2bf);
	word-break: break-word;
}

.toast-item--error {
	border-color: var(--nt-red, #e06c75);
	background: rgba(224, 108, 117, 0.12);
	color: var(--nt-red, #e06c75);
}

.toast-item--warning {
	border-color: var(--nt-yellow, #e5c07b);
	background: rgba(229, 192, 123, 0.12);
	color: var(--nt-yellow, #e5c07b);
}

.toast-item--info {
	border-color: var(--nt-accent, #61afef);
	background: rgba(97, 175, 239, 0.12);
	color: var(--nt-fg, #abb2bf);
}

.toast-icon {
	flex-shrink: 0;
	font-size: 12px;
	line-height: 1.4;
}

.toast-text {
	flex: 1;
	min-width: 0;
}

.toast-close {
	flex-shrink: 0;
	background: none;
	border: none;
	cursor: pointer;
	font-size: 11px;
	color: inherit;
	opacity: 0.6;
	padding: 0 2px;
	line-height: 1.4;
}

.toast-close:hover {
	opacity: 1;
}

/* TransitionGroup animations */
.toast-enter-active {
	transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-leave-active {
	transition: opacity 0.15s ease, transform 0.15s ease;
}

.toast-enter-from {
	opacity: 0;
	transform: translateX(20px);
}

.toast-leave-to {
	opacity: 0;
	transform: translateX(20px);
}

.toast-move {
	transition: transform 0.2s ease;
}
</style>
