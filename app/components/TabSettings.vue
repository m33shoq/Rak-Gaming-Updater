<script setup lang="ts">
import Checkbox from '@/components/Checkbox.vue';
import log from 'electron-log/renderer';
import { getElectronStoreRef } from '@/store/ElectronRefStore';

const startWithWindows = getElectronStoreRef('startWithWindows', false);
const startMinimized = getElectronStoreRef('startMinimized', false);
const quitOnClose = getElectronStoreRef('quitOnClose', false);

</script>

<template>
	<div class="tab-content">
		<Checkbox label="Start with Windows" v-model="startWithWindows" />
		<Checkbox label="Start minimized" v-model="startMinimized" />
		<Checkbox label="Close the application instead of minimizing when clicking close" v-model="quitOnClose" />
	</div>
</template>

<style scoped>

</style>
