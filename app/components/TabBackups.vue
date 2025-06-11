<script setup lang="ts">
import { ref } from 'vue';


</script>

<template>
	<div class="tab-content">
		<div class="checkbox-container">
			<input type="checkbox" id="backups-enable" />
			<label>Do backups of WTF folder every 7 days</label>
		</div>
		<div id="backupsPath">
			<div class="backups-button-container">
				<button id="set-backups-path-btn" class="rounded-button">Set Backups Folder Path</button>
				<button id="open-backups-path-btn" class="rounded-button">Open Backups Folder</button>
			</div>
			<p id="backups-path">Backups Path:</p>
			<p id="backups-folder-size">Current Folder Size:</p>
			<p id="backups-last-backup-time">Last backup time:</p>
			<p id="backups-status">???</p>
			<button id="backup-now-btn" class="rounded-button">Backup Now</button>
		</div>
		<div class="dropdown-container">
			<label for="max-backups-folder-size-select">Max Backups Folder Size:</label>
			<select id="max-backups-folder-size-select" class="dropdown">
				<option value="524">500MB</option>
				<option value="1048">1GB</option>
				<option value="2096">2GB</option>
				<option value="4192">4GB</option>
				<option value="8384">8GB</option>
				<option value="16768">16GB</option>
				<option value="33536">32GB</option>
			</select>
		</div>
	</div>
</template>

<style scoped>

</style>
