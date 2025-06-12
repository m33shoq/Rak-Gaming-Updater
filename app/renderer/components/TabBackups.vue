<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import log from 'electron-log/renderer';

import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

const backupsEnabled = getElectronStoreRef('backupsEnabled', false);
const maxBackupsFolderSize = getElectronStoreRef('maxBackupsFolderSize', 524); // Default to 500MB
const backupsPath = getElectronStoreRef('backupsPath', '');
const lastBackupTime = getElectronStoreRef('lastBackupTime', 0);
const lastBackupTimeDisplay = computed(() => {
	return lastBackupTime.value ?
		`Last Backup Time: ${new Date(lastBackupTime.value).toLocaleString()}` :
		'Last Backup Time: Not Set';
});

const backupsPathDisplay = computed(() => {
	return backupsPath.value ?
		`Backups Path: ${backupsPath.value}` :
		'Backups Path: Not Set';
});

const backupsStatus = ref('???');

const backupCurrentFolderSize = ref(0);
const backupChecksStatus = ref('');

const backupCurrentFolderSizeDisplay = computed(() => {
	return `Backups Folder Size: ${backupChecksStatus.value || `${backupCurrentFolderSize.value} MB`}`
});


function updateBackupsTexts() {
	log.info('Updating backups texts...');
	backupChecksStatus.value = 'In progress...';
	api.getSizeOfBackupsFolder().then((backupsSize) => {
		if (backupsSize.size) { // finished checks
			backupCurrentFolderSize.value = backupsSize.size;
			backupChecksStatus.value = ''
		} else if (backupsSize.aborted) { // retry in progress

		} else { // .error or no folder found
			backupChecksStatus.value = backupsSize.error || 'No backups folder found';
			backupCurrentFolderSize.value = 0;
		}
	}).catch((error) => {
		backupChecksStatus.value = 'Error checking backups folder size';
		log.error('Error getting backups folder size:', error);
		backupCurrentFolderSize.value = 0;
	});
}

api.IR_onBackupCreated((event, data) => {
	updateBackupsTexts();
});

watch(backupsPath, (newPath) => {
	updateBackupsTexts();
});

async function selectBackupsPath() {
	const path = await api.IR_selectBackupsPath();
	if (path.success) {
		backupsPath.value = path.path;
		api.IR_InitiateBackup(false);
	} else {
		backupsPath.value = '';
	}
	updateBackupsTexts();
}

async function openBackupsPath() {
	api.IR_openBackupsFolder();
}
async function backupNow() {
	api.IR_InitiateBackup(true);
}

api.IR_onBackupStatus((event, data) => {
	backupsStatus.value = data
});

const backupFolderSizeOptions = [
	{ value: 524, label: '500MB' },
	{ value: 1048, label: '1GB' },
	{ value: 2096, label: '2GB' },
	{ value: 4192, label: '4GB' },
	{ value: 8384, label: '8GB' },
	{ value: 16768, label: '16GB' },
	{ value: 33536, label: '32GB' }
];

onMounted(() => {
	updateBackupsTexts();
});

</script>

<template>
	<div class="tab-content">
		<Checkbox label="Do backups of WTF folder every 7 days" v-model="backupsEnabled" />
		<div id="backupsPath">
			<div class="backups-button-container">
				<UIButton label="Set Backups Folder Path"
					@click="selectBackupsPath"
				/>
				<UIButton label="Open Backups Folder"
					@click="openBackupsPath"
				/>
			</div>
			<div>
				<p class="backup-text" v-text="backupsPathDisplay"></p>
				<p class="backup-text" v-text="backupCurrentFolderSizeDisplay"></p>
				<p class="backup-text" v-text="lastBackupTimeDisplay"></p>
				<p class="backup-text" v-text="backupsStatus"></p>
			</div>
				<UIButton id="btn-backup-now" label="Backup Now"
				@click="backupNow"
			/>
		</div>
		<Dropdown label="Max Backups Folder Size:"
			class="dropdown"
			v-model="maxBackupsFolderSize"
		>
			<option v-for="option in backupFolderSizeOptions" :value="option.value" :key="option.value">
				{{ option.label }}
			</option>
		</Dropdown>
	</div>
</template>

<style scoped>
.backups-button-container {
	display: flex;
	flex-direction: row;
	justify-content: start;
	gap: 10px;
	margin: 10px 0;
}

.backup-text {
	margin-top: 2px;
	margin-bottom: 2px;
}

#btn-backup-now{
	margin-top: 10px;
}

</style>
