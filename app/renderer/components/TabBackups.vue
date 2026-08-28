<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

import { ref, computed, watch, onMounted } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { useBackupStatusStore } from '@/renderer/store/BackupStatusStore';

import { useIpcOn } from '@/renderer/composables/useIpcOn'

import { BACKUP_INTERVAL_ONE_WEK } from '@/constants'

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const backupsStatusStore = useBackupStatusStore();

const backupInProgress = computed(() => backupsStatusStore.backupProgress !== null);
const backupCanBeAborted = computed(() => backupsStatusStore.backupProgress?.cancellable === true);
const backupProgressPercent = computed(() => backupsStatusStore.backupProgress?.percent ?? null);
const backupProgressWidth = computed(() => `${backupProgressPercent.value ?? 0}%`);
const backupProgressText = computed(() => {
	const progress = backupsStatusStore.backupProgress;
	if (!progress) return '';

	const processedMB = (progress.processedBytes / (1024 * 1024)).toFixed(1);
	if (progress.phase === 'scanning') return `${processedMB} MB`;
	if (progress.phase !== 'creating' && progress.phase !== 'validating') return '';
	if (progress.totalBytes <= 0) {
		return progress.percent === null ? '' : `${progress.percent.toFixed(1)}%`;
	}

	const totalMB = (progress.totalBytes / (1024 * 1024)).toFixed(1);
	const percentText = progress.percent === null ? '' : `${progress.percent.toFixed(1)}% · `;
	return `${percentText}${processedMB} / ${totalMB} MB`;
});
const lowDiskSpaceWarning = computed(() => {
	const warning = backupsStatusStore.backupProgress?.diskSpaceWarning;
	if (!warning) return '';
	return t('backups.warning.lowdiskspace', {
		available: formatBytes(warning.availableBytes),
		recommended: formatBytes(warning.recommendedBytes),
	});
});

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
	ipc.invoke(IPC_EVENTS.BACKUPS_GET_BACKUPS_SIZE).then((backupsSize) => {
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

useIpcOn(IPC_EVENTS.BACKUPS_CREATED_CALLBACK, (event, data) => {
	updateBackupsTexts();
});

watch(backupsPath, (newPath) => {
	updateBackupsTexts();
});

async function selectBackupsPath() {
	if (backupInProgress.value) return;
	const path = await ipc.invoke(IPC_EVENTS.BACKUPS_SELECT_BACKUP_FOLDER);
	if (path.success) {
		backupsPath.value = path.path;
		ipc.send(IPC_EVENTS.BACKUPS_INITIATE, false);
	}
	updateBackupsTexts();
}

async function openBackupsPath() {
	ipc.send(IPC_EVENTS.BACKUPS_OPEN_BACKUPS_FOLDER);
}
async function backupNow() {
	ipc.send(IPC_EVENTS.BACKUPS_INITIATE, true);
}
function abortBackup() {
	if (!backupCanBeAborted.value) return;
	ipc.send(IPC_EVENTS.BACKUPS_ABORT);
}

function formatBytes(bytes: number) {
	const nonNegativeBytes = Math.max(0, bytes || 0);
	const gigabytes = nonNegativeBytes / (1024 ** 3);
	if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
	return `${(nonNegativeBytes / (1024 ** 2)).toFixed(1)} MB`;
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
					:disabled="backupInProgress"
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
				:disabled="backupInProgress"
				@click="backupNow"
			/>
			<UIButton v-if="backupCanBeAborted" class="mt-4 ml-2 !bg-red-600 hover:!bg-red-500"
				:label="$t('backups.abort')"
				@click="abortBackup"
			/>
			<div class="mt-3">
				<p class="backup-text">{{ backupCurrentFolderSizeDisplay }}</p>
				<p class="backup-text">{{ lastBackupTimeDisplay }}</p>
				<p class="backup-text">{{ nextBackupTimeDisplay }}</p>
				<p class="backup-text">{{ backupsStatusStore.backupStatusText }}</p>
				<div v-if="backupsStatusStore.backupProgress" class="mt-2 max-w-xl">
					<div class="relative h-2 overflow-hidden border border-slate-600/80 bg-slate-800">
						<div
							v-if="backupProgressPercent === null"
							class="backup-progress-indeterminate absolute inset-y-0 w-1/3 bg-primary"
						/>
						<div
							v-else
							class="h-full bg-primary transition-[width] duration-200 ease-out"
							:style="{ width: backupProgressWidth }"
						/>
					</div>
					<p v-if="backupProgressText" class="mt-1 font-mono text-xs tabular-nums opacity-75">
						{{ backupProgressText }}
					</p>
					<p v-if="lowDiskSpaceWarning" class="mt-2 text-sm font-medium text-amber-300">
						{{ lowDiskSpaceWarning }}
					</p>
				</div>
			</div>
		</div>
	</TabContent>
</template>

<style scoped>

.backup-text {
	margin-top: 2px;
	margin-bottom: 2px;
}

@keyframes backup-progress-slide {
	from { transform: translateX(-100%); }
	to { transform: translateX(400%); }
}

.backup-progress-indeterminate {
	animation: backup-progress-slide 1.1s ease-in-out infinite;
}


</style>
