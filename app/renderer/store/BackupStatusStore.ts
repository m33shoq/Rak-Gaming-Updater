import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n'
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

type BackupStatus = {
	status: string;
	desc?: string;
}

export const useBackupStatusStore = defineStore('BackupStatus', () => {
	const { t } = useI18n()

	const backupStatus = ref({
		status: '',
		desc: '',
	} as BackupStatus);

	function updateBackupStatus(statusInfo: BackupStatus) {
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

	ipc.on(IPC_EVENTS.BACKUPS_STATUS_CALLBACK, (event, statusInfo: {status: string, desc: string}) => {
		backupStatus.value.status = statusInfo.status;
		backupStatus.value.desc = statusInfo.desc || '';
	});

	return {
		backupStatus,
		updateBackupStatus,
		backupStatusText
	};
});
