<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, watch, onMounted } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { useBackupStatusStore } from '@/renderer/store/BackupStatusStore';

import { BACKUP_INTERVAL_ONE_WEK } from '@/constants'

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const backupsStatusStore = useBackupStatusStore();

const backupsEnabled = getElectronStoreRef('backupsEnabled', false);
const maxBackupsFolderSize = getElectronStoreRef('maxBackupsFolderSize', 524); // Default to 500MB
const backupsPath = getElectronStoreRef('backupsPath', '');
const lastBackupTime = getElectronStoreRef('lastBackupTime', 0);
const lastBackupTimeDisplay = computed(() => {
	return lastBackupTime.value ?
		`${t('backups.lastbackuptime')}: ${new Date(lastBackupTime.value).toLocaleString()}` :
		`${t('backups.lastbackuptime')}: ${t('backups.lastbackuptime.never')}`;
});
const nextBackupTimeDisplay = computed(() => {
	return lastBackupTime.value ?
		`${t('backups.nextbackup')}: ${new Date(lastBackupTime.value + BACKUP_INTERVAL_ONE_WEK).toLocaleString()}` :
		`${t('backups.nextbackup')}: ${t('backups.lastbackuptime.never')}`;
});

const backupCurrentFolderSize = ref(0);
const backupChecksStatus = ref('');

const backupCurrentFolderSizeDisplay = computed(() => {
	return `${t('backups.foldersize')}: ${backupChecksStatus.value || `${backupCurrentFolderSize.value} MB`}`
});

function updateBackupsTexts() {
	log.info('Updating backups texts...');
	backupChecksStatus.value = t('backups.foldersize.inprogress');
	api.getSizeOfBackupsFolder().then((backupsSize) => {
		if (backupsSize.aborted) return // retry in progress
		if (backupsSize.size) { // finished checks
			backupCurrentFolderSize.value = backupsSize.size;
			backupChecksStatus.value = ''
		} else { // .error or no folder found
			backupChecksStatus.value = t(backupsSize.error);
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
	<TabContent>
		<Checkbox :label="$t('backups.enablebackups')" v-model="backupsEnabled" />
		<div id="backupsPath">
			<div class="flex flex-row items-center my-2.5">
				<PathSelector class="mb-2.5 mt-2.5"
					:title="$t('backups.backupspath')"
					:placeholder="$t('backups.backupspath.notset')"
					:click="selectBackupsPath"
					:label="backupsPath"
				>
					<button @click="openBackupsPath" v-show="backupsPath" :title="$t('backups.openbackupsfolder')">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
							class="size-7 hover:text-primary transition-all ease-in hover:scale-105"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
						</svg>

					</button>
				</PathSelector>
			</div>
			<Dropdown :label="$t('backups.maxbackupsfoldersize')"
				v-model="maxBackupsFolderSize"
				:options="backupFolderSizeOptions"
			/>
			<UIButton class="mt-4"
				:label="$t('backups.backupnow')"
				@click="backupNow"
			/>
			<div class="mt-3">
				<p class="backup-text">{{ backupCurrentFolderSizeDisplay }}</p>
				<p class="backup-text">{{ lastBackupTimeDisplay }}</p>
				<p class="backup-text">{{ nextBackupTimeDisplay }}</p>
				<p class="backup-text">{{ backupsStatusStore.backupStatusText }}</p>
			</div>
		</div>
	</TabContent>
</template>

<style scoped>

.backup-text {
	margin-top: 2px;
	margin-bottom: 2px;
}


</style>
