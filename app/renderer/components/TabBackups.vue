<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import log from 'electron-log/renderer';

import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const backupsEnabled = getElectronStoreRef('backupsEnabled', false);
const maxBackupsFolderSize = getElectronStoreRef('maxBackupsFolderSize', 524); // Default to 500MB
const backupsPath = getElectronStoreRef('backupsPath', '');
const lastBackupTime = getElectronStoreRef('lastBackupTime', 0);
const lastBackupTimeDisplay = computed(() => {
	return lastBackupTime.value ?
		`${t('backups.lastbackuptime')}: ${new Date(lastBackupTime.value).toLocaleString()}` :
		`${t('backups.lastbackuptime')}: ${t('backups.lastbackuptime.never')}`;
});

const backupsPathDisplay = computed(() => {
	return backupsPath.value ?
		`${t('backups.backupspath')}: ${backupsPath.value}` :
		`${t('backups.backupspath')}: ${t('backups.backupspath.notset')}`;
});

const backupsStatus = ref('???');

const backupCurrentFolderSize = ref(0);
const backupChecksStatus = ref('');

const backupCurrentFolderSizeDisplay = computed(() => {
	return `${t('backups.backupssize')}: ${backupChecksStatus.value || `${backupCurrentFolderSize.value} MB`}`
});


function updateBackupsTexts() {
	log.info('Updating backups texts...');
	backupChecksStatus.value = t('backups.status.inprogress');
	api.getSizeOfBackupsFolder().then((backupsSize) => {
		if (backupsSize.size) { // finished checks
			backupCurrentFolderSize.value = backupsSize.size;
			backupChecksStatus.value = ''
		} else if (backupsSize.aborted) { // retry in progress

		} else { // .error or no folder found
			backupChecksStatus.value = backupsSize.error || t('backups.status.nofolder');
			backupCurrentFolderSize.value = 0;
		}
	}).catch((error) => {
		backupChecksStatus.value = t('backups.status.error') + `: ${error.message}`;
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
	backupsStatus.value = t(data)
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
		<Checkbox :label="$t('backups.enablebackups')" v-model="backupsEnabled" />
		<div id="backupsPath">
			<div class="backups-button-container">
				<UIButton :label="$t('backups.setbackupspath')"
					@click="selectBackupsPath"
				/>
				<UIButton :label="$t('backups.openbackupspath')"
					@click="openBackupsPath"
				/>
			</div>
			<div>
				<p class="backup-text">{{ backupsPathDisplay }}</p>
				<p class="backup-text">{{ backupCurrentFolderSizeDisplay }}</p>
				<p class="backup-text">{{ lastBackupTimeDisplay }}</p>
				<p class="backup-text">{{ backupsStatus }}</p>
			</div>
				<UIButton id="btn-backup-now" :label="$t('backups.backupnow')"
				@click="backupNow"
			/>
		</div>
		<Dropdown :label="$t('backups.maxbackupsfoldersize')"
			class="dropdown"
			v-model="maxBackupsFolderSize"
			:options="backupFolderSizeOptions"
		/>

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
