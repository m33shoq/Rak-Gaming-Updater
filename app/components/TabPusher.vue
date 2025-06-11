<script setup lang="ts">
import { ref } from 'vue';


</script>

<template>
	<div class="tab-content">
		<div id="files" class="files-header">
			<div id="relativePath">
				<button id="set-relative-path-btn" class="rounded-button">Set Relative Path</button>
				<p id="relative-path"></p>
			</div>
			<div id="'files-header-buttons'">
				<button id="add-folder-btn" class="rounded-button toggle-button">Add Folder</button>
				<button id="add-files-btn" class="rounded-button toggle-button">Add File</button>
			</div>
		</div>
		<div id="files-frame" class="scroll-frame">
			<ul id="files-list"></ul>
		</div>
	</div>
</template>

<style scoped>

</style>
