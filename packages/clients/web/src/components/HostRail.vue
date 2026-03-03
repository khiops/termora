<template>
	<div class="host-rail">
		<div class="host-icon active" title="Local (this machine)">
			<span>L</span>
		</div>
	</div>
</template>

<style scoped>
.host-rail {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding-top: 12px;
	gap: 8px;
}

.host-icon {
	width: 36px;
	height: 36px;
	border-radius: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	font-size: 14px;
	font-weight: 600;
	color: #585b70;
	background: #313244;
	transition: background 0.15s, color 0.15s;
	user-select: none;
}

.host-icon:hover {
	background: #45475a;
	color: #cdd6f4;
}

.host-icon.active {
	background: #89b4fa;
	color: #1e1e2e;
}
</style>
