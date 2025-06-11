<script setup lang="ts">
import Checkbox from '@/components/Checkbox.vue';

import { ref } from 'vue';


</script>

<template>
	<div class="tab-content">
		<p id="version">Version</p>
		<Checkbox label="Start with Windows" @change="" />
		<Checkbox label="Start minimized" @change="" />
		<Checkbox label="Close the application instead of minimizing when clicking close" @change="" />

		<div id="logs" class="logs-header">
			<h2>Logs</h2>
		</div>
		<div id="logs-frame" class="scroll-frame">
			<ul id="logs-list" class="scroll-frame-text"></ul>
		</div>
	</div>

</template>

<style scoped>

</style>
