import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n'
import log from 'electron-log/renderer';
import { IPC_EVENTS, type BackupProgress, type BackupStatus } from '@/events';

export const useBackupStatusStore = defineStore('BackupStatus', () => {
	const { t } = useI18n()

	const backupStatus = ref({
		status: '',
		desc: '',
	} as BackupStatus);
	const backupProgress = ref<BackupProgress | null>(null);

	function updateBackupStatus(statusInfo: BackupStatus) {
		backupProgress.value = statusInfo.progress ?? null;
		if (backupStatus.value.status === statusInfo.status && backupStatus.value.desc === statusInfo.desc) {
			return; // No change, do not update
		}
		backupStatus.value = { ...statusInfo };
	}

	const backupStatusText = computed(() => {
		if (backupStatus.value.desc) {
			return `${t(backupStatus.value.status)} ${backupStatus.value.desc}`;
		} else {
			return t(backupStatus.value.status);
		}
	});

	let receivedBackupStatusCallback = false;
	ipc.on(IPC_EVENTS.BACKUPS_STATUS_CALLBACK, (event, statusInfo: BackupStatus) => {
		receivedBackupStatusCallback = true;
		updateBackupStatus(statusInfo);
	});
	void ipc.invoke(IPC_EVENTS.BACKUPS_STATUS_GET).then((statusInfo: BackupStatus) => {
		// Restore the label, controls, and progress if the renderer loaded or reloaded mid-backup.
		if (!receivedBackupStatusCallback) updateBackupStatus(statusInfo);
	}).catch((error) => {
		log.warn('Failed to restore backup status', error);
	});

	return {
		backupStatus,
		backupProgress,
		updateBackupStatus,
		backupStatusText
	};
});
