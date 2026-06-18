<template>
	<div class="desktop-category">
		<SettingRow
			label="Window Close Behavior"
			description="Choose what the desktop app does when the main window is closed."
			scope="global"
			:is-overridden="true"
		>
			<SettingControl
				:model-value="closeBehavior"
				type="select"
				:options="closeBehaviorOptions"
				@update:model-value="onCloseBehaviorChange"
			/>
		</SettingRow>
	</div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
	type CloseBehavior,
	isCloseBehavior,
	readCloseBehavior,
	writeCloseBehavior,
} from "../../../utils/close-behavior.js";
import SettingControl from "../SettingControl.vue";
import SettingRow from "../SettingRow.vue";

const closeBehaviorOptions = [
	{ label: "Ask every time", value: "ask" },
	{ label: "Minimize to tray", value: "tray" },
	{ label: "Quit completely", value: "quit" },
];

const closeBehavior = ref<CloseBehavior>(readCloseBehavior());

function onCloseBehaviorChange(value: unknown): void {
	if (!isCloseBehavior(value)) return;
	closeBehavior.value = value;
	writeCloseBehavior(value);
}
</script>
