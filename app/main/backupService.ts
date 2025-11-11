import type { Socket } from "socket.io-client";
import { ipcMain, dialog, shell } from "electron";
import { IPC_EVENTS } from "@/events";
import { zipFile } from '@/main/zipHandler';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import store from '@/main/store';
import EventEmitter from "eventemitter3";
import mainWindowWrapper from './MainWindowWrapper';
import { getWoWPath, validateWoWPath, isPathWithin, getFolderSize } from '@/main/wowPathUtility';
import log from 'electron-log/main';
import { BACKUP_STATUS_DISABLED, BACKUP_INTERVAL_ONE_WEK, BACKUP_STATUS_DELETED, BACKUP_STATUS_DELETING_OLD, BACKUP_STATUS_CREATING, BACKUP_STATUS_COMPLETED, BACKUPS_ERROR_NO_PATH_SET, BACKUP_STATUS_FAILED } from "@/constants";


class BackupService extends EventEmitter {
	private folderSizeAbortController: AbortController | null = null;
	// private backupTimer: NodeJS.Timeout | null = null;
	private notificationTimer: NodeJS.Timeout | null = null;
	private isBackupInProgress: boolean = false;
	// private status: string | null = null;
	private socket: Socket;

	constructor(socket: Socket) {
		super();

		this.socket = socket;

		ipcMain.on(IPC_EVENTS.BACKUPS_INITIATE, (event, force) => this.InitiateBackup(force));
		ipcMain.handle(IPC_EVENTS.BACKUPS_SELECT_BACKUP_FOLDER, async () => await this.SelectBackupsFolder());
		ipcMain.handle(IPC_EVENTS.BACKUPS_GET_BACKUPS_SIZE, async () => await this.GetBackupFolderSize());
		ipcMain.on(IPC_EVENTS.BACKUPS_OPEN_BACKUPS_FOLDER, () => this.OpenBackupsFolder());

		setInterval(async () => {
			this.InitiateBackup(false);
		}, 1000 * 60 * 10);
	}


	async GetBackupFolderSize(): Promise<any> {
		if (this.folderSizeAbortController) {
			this.folderSizeAbortController.abort();
		}

		this.folderSizeAbortController = new AbortController();
		const signal = this.folderSizeAbortController.signal;

		const folderPath = store.get('backupsPath');
		if (!folderPath) {
			log.info('get-size-of-backups-folder: No path set');
			return { error: BACKUPS_ERROR_NO_PATH_SET };
		}

		try {
		const size = await getFolderSize(folderPath, signal as AbortSignal);
			return { size };
		} catch (error: any) {
			if (error.message === 'Operation aborted') {
				return { aborted: true };
			}
			throw error;
		} finally {
			this.folderSizeAbortController = null; // Reset the controller after the operation
		}
	}

	IsBackupInProgress(): boolean {
		return this.isBackupInProgress;
	}

	SendNotificationToRenderer(status: string, desc?: string) {
		mainWindowWrapper?.webContents.send(IPC_EVENTS.BACKUPS_STATUS_CALLBACK, { status, desc });
	}

	ScheduleRendererNotification(status: string) {
		if (this.notificationTimer) {
			clearInterval(this.notificationTimer);
		}

		let c = 1;
		this.notificationTimer = setInterval(() => {
			this.SendNotificationToRenderer(status, '.'.repeat(c));
			c++;
			if (c > 3) c = 1;
		}, 500);
	}


	OpenBackupsFolder() {
		const folderPath = store.get('backupsPath');
		log.info('Opening backups folder:', folderPath);
		if (folderPath) {
			shell.openPath(folderPath);
		}
	}

	async SelectBackupsFolder() {
		const result = await dialog.showOpenDialog(mainWindowWrapper.getWindow(), {
			properties: ['openDirectory'],
		});

		if (result.canceled) {
			return { success: false, message: 'User cancelled folder selection' };
		}

		const selectedPath = result.filePaths[0];
		// check if selected path is not somewhere within the WoW folder
		if (selectedPath) {
			const wowPath = await getWoWPath();
			if (wowPath && isPathWithin(wowPath, selectedPath)) {
				log.info('Selected path is within WoW folder, skipping');
				return { success: false, message: 'Selected path is within WoW folder!!!' };
			}

			log.info('Backups path:', selectedPath);
			return { success: true, path: selectedPath };
		}
		return { success: false, message: 'No path selected' };
	}

	async InitiateBackup(force: boolean = false) {
		if (!this.socket.connected) {
			log.info('Socket is not connected, skipping backup');
			return;
		}

		if (this.IsBackupInProgress()) {
			log.info('Backup is already in progress, skipping backup');
			return;
		}

		const backupsEnabled = store.get('backupsEnabled');
		if (!backupsEnabled && !force) {
			log.info('Backups are disabled, skipping');
			this.SendNotificationToRenderer(BACKUP_STATUS_DISABLED);
			return;
		}

		const lastBackup = store.get('lastBackupTime');
		const now = Date.now();
		if (force || !lastBackup || now - lastBackup > BACKUP_INTERVAL_ONE_WEK) {
			this.PerformBackup();
		} else {
			log.info('Backup not needed at this time');
		}
	}

	async PerformBackup() {
		log.info('Performing backup');

		this.isBackupInProgress = true;
		try {
			this.ScheduleRendererNotification(BACKUP_STATUS_DELETING_OLD);
			await this.DeleteOversized();
			this.ScheduleRendererNotification(BACKUP_STATUS_CREATING);
			await this.BackupWTFFolder();
			store.set('lastBackupTime', Date.now());
			this.ScheduleRendererNotification(BACKUP_STATUS_DELETING_OLD);
			await this.DeleteOversized();
			this.SendNotificationToRenderer(BACKUP_STATUS_COMPLETED);
		} catch (error: any) {
			log.error('Error during backup:', error);
			this.SendNotificationToRenderer(BACKUP_STATUS_FAILED, error?.message || 'Unknown error');

		} finally {
			this.isBackupInProgress = false;
			if (this.notificationTimer) {
				clearInterval(this.notificationTimer);
				this.notificationTimer = null;
			}
			this.emit('backup-completed');
		}
	}

	async DeleteOversized() {
		const backupsPath = store.get('backupsPath');
		if (!backupsPath) {
			log.error('Backups path not set');
			throw new Error('Backups path not set');
		}
		// delete old backups untill there is only 1 backup left or the folder size is less than maxSise setting
		const maxSiseMB = store.get('maxBackupsFolderSize'); // in MB
		if (!maxSiseMB) {
			log.info('Max backup size not set');
			return;
		}
		const maxSise = maxSiseMB * 1024 * 1024; // convert to bytes
		const backups = await fsp.readdir(backupsPath);
		if (backups.length <= 1) {
			log.info('Only one backup found, skipping delete');
			return;
		}
		let totalSize = 0;
		let files = [];
		for (let file of backups) {
			if (file.startsWith('WTF-')) {
				const filePath = path.join(backupsPath, file);
				const stats = fs.statSync(filePath);
				totalSize += stats.size;
				files.push({ file, size: stats.size, mtime: stats.mtime.getTime() }); // todo test
			}
		}
		log.info('Total size of backups:', totalSize);
		if (totalSize < maxSise) {
			log.info('Total size is less than max size, skipping delete');
			return;
		}
		files.sort((a, b) => a.mtime - b.mtime);
		let deletedSize = 0;
		for (let file of files) {
			const filePath = path.join(backupsPath, file.file);
			await fsp.rm(filePath, { recursive: true });
			deletedSize += file.size;
			log.info('Deleted:', filePath);
			this.SendNotificationToRenderer(BACKUP_STATUS_DELETED, filePath);
			if (totalSize - deletedSize < maxSise) {
				break;
			}
		}
		log.info('Deleted size:', deletedSize);
		mainWindowWrapper?.webContents.send(IPC_EVENTS.BACKUPS_CREATED_CALLBACK);
	}

	async BackupWTFFolder() {
		const wowPath = await getWoWPath();
		if (!wowPath) {
			log.error('WoW path not set');
			throw new Error('WoW path not set');
		}
		const wtfPath = path.join(wowPath, '_retail_', 'WTF');
		const backupsPath = store.get('backupsPath');
		if (!backupsPath) {
			log.error('Backups path not set');
			throw new Error('Backups path not set');
		}

		if (!fs.existsSync(wtfPath)) {
			log.error('WTF folder not found:', wtfPath);
			throw new Error('WTF folder not found: ' + wtfPath);
		}

		if (!fs.existsSync(backupsPath)) {
			log.error('Backups folder not found:', backupsPath);
			throw new Error('Backups folder not found: ' + backupsPath);
		}
		log.info('Backing up WTF folder:', wtfPath);
		//.split('T')[0];
		const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
		const backupName = `WTF-${timestamp}.zip`;
		const backupFilePath = path.join(backupsPath, backupName);

		await zipFile(wtfPath, backupFilePath);
	}
}

export default BackupService;
