<template>
	<div class="app-layout">
		<HostRail class="host-rail" />
		<ChannelSidebar class="channel-sidebar" />
		<TerminalPane class="terminal-main" />
	</div>
</template>

<script setup lang="ts">
import HostRail from "./components/HostRail.vue";
import ChannelSidebar from "./components/ChannelSidebar.vue";
import TerminalPane from "./components/TerminalPane.vue";
</script>

<style>
/* Global reset — applied to document root */
*,
*::before,
*::after {
	box-sizing: border-box;
}

html,
body,
#app {
	margin: 0;
	padding: 0;
	height: 100%;
	overflow: hidden;
	font-family: system-ui, -apple-system, sans-serif;
	font-size: 13px;
}

.app-layout {
	display: grid;
	grid-template-columns: 56px 200px 1fr;
	height: 100vh;
	background: #1e1e2e;
	color: #cdd6f4;
}

.host-rail {
	background: #181825;
}

.channel-sidebar {
	background: #1e1e2e;
	border-right: 1px solid #313244;
}

.terminal-main {
	overflow: hidden;
}
</style>
