<script setup lang="ts">
import { computed } from "vue";
import SettingRow from "../SettingRow.vue";
import SettingControl from "../SettingControl.vue";
import { useSettingsStore, type Scope } from "../../../stores/settings.js";
import {
	getSchemaForCategoryScope,
	toStoreParams,
	type SettingDefinition,
} from "../settingsSchema.js";

const props = defineProps<{
	category: string;
	scope: Scope;
	hostName?: string;
}>();

const settingsStore = useSettingsStore();

const filteredSchema = computed(() =>
	getSchemaForCategoryScope(props.category, props.scope),
);

function storeFor(def: SettingDefinition) {
	return toStoreParams(def);
}

function getValueForDef(def: SettingDefinition): unknown {
	const { storeSection, storeKey } = storeFor(def);
	return settingsStore.getValue(props.scope, storeSection, storeKey);
}

function getResolvedForDef(def: SettingDefinition): unknown {
	const { storeSection, storeKey } = storeFor(def);
	return settingsStore.getResolved(storeSection, storeKey);
}

function isOverriddenForDef(def: SettingDefinition): boolean {
	const { storeSection, storeKey } = storeFor(def);
	return settingsStore.isOverridden(props.scope, storeSection, storeKey);
}

function inheritedFromForDef(def: SettingDefinition) {
	const { storeSection, storeKey } = storeFor(def);
	return settingsStore.inheritedFrom(props.scope, storeSection, storeKey);
}

function handleUpdate(def: SettingDefinition, value: unknown) {
	const { storeSection, storeKey } = storeFor(def);
	settingsStore.updateSetting(props.scope, storeSection, storeKey, value);
}

function handleReset(def: SettingDefinition) {
	const { storeSection, storeKey } = storeFor(def);
	settingsStore.resetSetting(props.scope, storeSection, storeKey);
}

function displayValue(def: SettingDefinition): unknown {
	if (props.scope === "global" || isOverriddenForDef(def)) {
		return getValueForDef(def) ?? getResolvedForDef(def);
	}
	return getResolvedForDef(def);
}
</script>

<template>
	<div class="schema-category">
		<SettingRow
			v-for="def in filteredSchema"
			:key="`${def.section}.${def.key}`"
			:label="def.label"
			:description="def.description"
			:scope="scope"
			:is-overridden="isOverriddenForDef(def)"
			:inherited-from="inheritedFromForDef(def)"
			:host-name="hostName"
			@reset="handleReset(def)"
		>
			<SettingControl
				:model-value="displayValue(def)"
				:type="def.type"
				:options="def.options"
				:min="def.min"
				:max="def.max"
				:step="def.step"
				:disabled="scope !== 'global' && !isOverriddenForDef(def)"
				@update:model-value="handleUpdate(def, $event)"
			/>
		</SettingRow>
	</div>
</template>
