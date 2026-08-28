import { ipcMain, dialog, shell, Notification } from 'electron';
import { IPC_EVENTS, type BackupProgress, type BackupStatus } from '@/events';
import { validateZipFile, zipFile } from '@/main/zipHandler';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import store from '@/main/store';
import EventEmitter from 'eventemitter3';
import mainWindowWrapper from './MainWindowWrapper';
import { getWoWPath, isPathWithin, getFolderSize } from '@/main/wowPathUtility';
import log from 'electron-log/main';
import {
	BACKUP_STATUS_DISABLED,
	BACKUP_INTERVAL_ONE_WEK,
	BACKUP_STATUS_DELETED,
	BACKUP_STATUS_DELETING_OLD,
	BACKUP_STATUS_SCANNING,
	BACKUP_STATUS_CHECKING_SPACE,
	BACKUP_STATUS_CREATING,
	BACKUP_STATUS_VALIDATING,
	BACKUP_STATUS_WAITING_FOR_STABLE_SOURCE,
	BACKUP_STATUS_CANCELLING,
	BACKUP_STATUS_ABORTED,
	BACKUP_STATUS_LOW_DISK_SPACE,
	BACKUP_STATUS_COMPLETED,
	BACKUPS_ERROR_NO_PATH_SET,
	BACKUP_STATUS_FAILED,
} from '@/constants';

const MAX_BACKUP_ATTEMPTS = 3;
const SOURCE_SETTLE_INTERVAL_MS = 1000;
const SOURCE_SETTLE_CHECKS = 5;
const BACKUP_DISK_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const BACKUP_DISK_SPACE_OVERHEAD_RATIO = 0.05;
const LOW_DISK_NOTIFICATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

type SourceSnapshot = {
	totalBytes: number;
	entries: Map<string, string>;
};

type DiskSpaceWarning = NonNullable<BackupProgress['diskSpaceWarning']>;
type BackupProgressUpdate = Omit<BackupProgress, 'cancellable' | 'diskSpaceWarning'>;

class SourceChangedDuringBackupError extends Error {
	constructor(detail: string) {
		super(`WTF files changed while the backup was being created (${detail})`);
		this.name = 'SourceChangedDuringBackupError';
	}
}

class BackupAbortedError extends Error {
	constructor() {
		super('Backup aborted by user');
		this.name = 'AbortError';
	}
}

class BackupService extends EventEmitter {
	private folderSizeAbortController: AbortController | null = null;
	private isBackupInProgress = false;
	private readonly isAppClosing: () => boolean;
	private backupProgress: BackupProgress | null = null;
	private backupStatus: Omit<BackupStatus, 'progress'> = { status: '' };
	private lastProgressNotificationAt = 0;
	private backupAbortController: AbortController | null = null;
	private backupCanBeAborted = false;
	private diskSpaceWarning: DiskSpaceWarning | null = null;
	private lastLowDiskNotificationAt = 0;

	constructor(isAppClosing: () => boolean = () => false) {
		super();
		this.isAppClosing = isAppClosing;

		ipcMain.on(IPC_EVENTS.BACKUPS_INITIATE, (_event, force) => void this.InitiateBackup(Boolean(force)));
		ipcMain.on(IPC_EVENTS.BACKUPS_ABORT, () => this.AbortBackup());
		ipcMain.handle(IPC_EVENTS.BACKUPS_STATUS_GET, () => this.GetBackupStatus());
		ipcMain.handle(IPC_EVENTS.BACKUPS_SELECT_BACKUP_FOLDER, async () => await this.SelectBackupsFolder());
		ipcMain.handle(IPC_EVENTS.BACKUPS_GET_BACKUPS_SIZE, async () => await this.GetBackupFolderSize());
		ipcMain.on(IPC_EVENTS.BACKUPS_OPEN_BACKUPS_FOLDER, () => void this.OpenBackupsFolder());

		setInterval(() => {
			void this.InitiateBackup(false);
		}, 1000 * 60 * 10);
	}

	async GetBackupFolderSize(): Promise<any> {
		this.folderSizeAbortController?.abort();

		const abortController = new AbortController();
		this.folderSizeAbortController = abortController;
		const signal = abortController.signal;
		const folderPath = store.get('backupsPath');

		try {
			if (!folderPath) {
				log.info('get-size-of-backups-folder: No path set');
				return { error: BACKUPS_ERROR_NO_PATH_SET };
			}

			const size = await getFolderSize(folderPath, signal);
			return { size };
		} catch (error: any) {
			if (signal.aborted || error.message === 'Operation aborted') {
				return { aborted: true };
			}
			throw error;
		} finally {
			// An older, aborted request must not clear the controller for a newer request.
			if (this.folderSizeAbortController === abortController) {
				this.folderSizeAbortController = null;
			}
		}
	}

	IsBackupInProgress(): boolean {
		return this.isBackupInProgress;
	}

	GetBackupProgress(): BackupProgress | null {
		return this.backupProgress ? {
			...this.backupProgress,
			diskSpaceWarning: this.backupProgress.diskSpaceWarning
				? { ...this.backupProgress.diskSpaceWarning }
				: undefined,
		} : null;
	}

	GetBackupStatus(): BackupStatus {
		return {
			...this.backupStatus,
			progress: this.GetBackupProgress(),
		};
	}

	SendNotificationToRenderer(status: string, desc?: string, progress: BackupProgress | null = this.backupProgress) {
		this.backupStatus = { status, desc };
		this.SendRendererEvent(IPC_EVENTS.BACKUPS_STATUS_CALLBACK, { status, desc, progress });
	}

	private SendRendererEvent(channel: string, ...args: unknown[]) {
		try {
			const webContents = mainWindowWrapper.webContents;
			if (!webContents || webContents.isDestroyed()) return;
			webContents.send(channel, ...args);
		} catch (error) {
			// Closing/reloading the renderer must never change the result of a backup.
			log.warn(`Could not send backup event to renderer (${channel}):`, error);
		}
	}

	private EmitSafely(event: string, ...args: unknown[]) {
		try {
			this.emit(event, ...args);
		} catch (error) {
			// Event consumers (for example the updater UI) are observers, not part of the backup transaction.
			log.warn(`Backup event listener failed (${event}):`, error);
		}
	}

	private UpdateBackupProgress(status: string, progress: BackupProgressUpdate, force = false) {
		const nextProgress: BackupProgress = {
			...progress,
			cancellable: this.backupCanBeAborted,
			diskSpaceWarning: this.diskSpaceWarning ?? undefined,
		};
		this.backupProgress = nextProgress;
		this.backupStatus = { status };
		const now = Date.now();
		if (!force && nextProgress.percent !== 100 && now - this.lastProgressNotificationAt < 200) return;

		this.lastProgressNotificationAt = now;
		this.SendNotificationToRenderer(status, undefined, nextProgress);
		this.EmitSafely('backup-progress', { ...nextProgress });
	}

	private ResetBackupProgress() {
		this.backupProgress = null;
		this.lastProgressNotificationAt = 0;
		this.EmitSafely('backup-progress', null);
	}

	AbortBackup() {
		const abortController = this.backupAbortController;
		if (!abortController || abortController.signal.aborted || !this.backupCanBeAborted) return;

		this.backupCanBeAborted = false;
		const currentProgress = this.backupProgress;
		this.UpdateBackupProgress(BACKUP_STATUS_CANCELLING, {
			phase: 'cancelling',
			percent: currentProgress?.percent ?? null,
			processedBytes: currentProgress?.processedBytes ?? 0,
			totalBytes: currentProgress?.totalBytes ?? 0,
		}, true);
		log.info('User requested backup cancellation');
		abortController.abort(new BackupAbortedError());
	}

	async OpenBackupsFolder() {
		const folderPath = store.get('backupsPath');
		log.info('Opening backups folder:', folderPath);
		if (!folderPath) return;

		const errorMessage = await shell.openPath(folderPath);
		if (errorMessage) {
			log.error('Failed to open backups folder:', errorMessage);
		}
	}

	async SelectBackupsFolder() {
		if (this.IsBackupInProgress()) {
			return { success: false, message: 'Cannot change the backups path while a backup is in progress' };
		}
		const result = await dialog.showOpenDialog(mainWindowWrapper.getWindow(), {
			properties: ['openDirectory'],
		});

		if (result.canceled) {
			return { success: false, message: 'User cancelled folder selection' };
		}

		const selectedPath = result.filePaths[0];
		if (selectedPath) {
			if (this.IsBackupInProgress()) {
				return { success: false, message: 'Cannot change the backups path while a backup is in progress' };
			}
			const wowPath = await getWoWPath();
			if (wowPath && isPathWithin(wowPath, selectedPath)) {
				log.info('Selected path is within WoW folder, skipping');
				return { success: false, message: 'Selected path is within WoW folder' };
			}
			if (this.IsBackupInProgress()) {
				return { success: false, message: 'Cannot change the backups path while a backup is in progress' };
			}

			log.info('Backups path:', selectedPath);
			// Commit the selection in the main process so the final in-progress check and
			// the setting change cannot be separated by renderer IPC scheduling.
			store.set('backupsPath', selectedPath);
			return { success: true, path: selectedPath };
		}
		return { success: false, message: 'No path selected' };
	}

	async InitiateBackup(force = false) {
		if (this.isAppClosing()) {
			log.info('App is closing, skipping backup');
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
		const lastBackupIsValid = typeof lastBackup === 'number' && Number.isFinite(lastBackup);
		const backupIsDue = !lastBackupIsValid || lastBackup > now || now - lastBackup >= BACKUP_INTERVAL_ONE_WEK;
		if (force || backupIsDue) {
			await this.PerformBackup();
		} else {
			log.info('Backup not needed at this time');
		}
	}

	async PerformBackup() {
		log.info('Performing backup');

		const abortController = new AbortController();
		this.backupAbortController = abortController;
		this.backupCanBeAborted = true;
		this.diskSpaceWarning = null;
		this.isBackupInProgress = true;
		try {
			this.EmitSafely('backup-started');
			this.UpdateBackupProgress(BACKUP_STATUS_DELETING_OLD, {
				phase: 'cleaning',
				percent: null,
				processedBytes: 0,
				totalBytes: 0,
			}, true);
			await this.TryCleanupPartialBackups(abortController.signal);
			const backupFilePath = await this.BackupWTFFolder(abortController.signal);
			store.set('lastBackupTime', Date.now());
			log.info('Backup committed:', backupFilePath);
			this.SendRendererEvent(IPC_EVENTS.BACKUPS_CREATED_CALLBACK);
			this.UpdateBackupProgress(BACKUP_STATUS_DELETING_OLD, {
				phase: 'cleaning',
				percent: null,
				processedBytes: 0,
				totalBytes: 0,
			}, true);
			await this.TryDeleteOversized(path.dirname(backupFilePath), path.basename(backupFilePath));
			this.ResetBackupProgress();
			this.SendNotificationToRenderer(BACKUP_STATUS_COMPLETED, undefined, null);
		} catch (error: any) {
			const wasAborted = isBackupAborted(error, abortController.signal);
			const diskWarning = this.diskSpaceWarning;
			if (wasAborted) {
				log.info('Backup aborted by user');
			} else {
				log.error('Error during backup:', error);
			}
			this.ResetBackupProgress();
			if (wasAborted) {
				this.SendNotificationToRenderer(BACKUP_STATUS_ABORTED, undefined, null);
			} else if (isNoSpaceError(error)) {
				const warning = diskWarning ? formatDiskSpaceWarning(diskWarning) : (error?.message || 'No free disk space');
				this.NotifyLowDiskSpace(warning);
				this.SendNotificationToRenderer(
					BACKUP_STATUS_LOW_DISK_SPACE,
					warning,
					null,
				);
			} else {
				this.SendNotificationToRenderer(BACKUP_STATUS_FAILED, error?.message || 'Unknown error', null);
			}
		} finally {
			if (this.backupAbortController === abortController) this.backupAbortController = null;
			this.backupCanBeAborted = false;
			this.diskSpaceWarning = null;
			this.isBackupInProgress = false;
			this.EmitSafely('backup-completed');
		}
	}

	private async TryCleanupPartialBackups(signal: AbortSignal) {
		try {
			await this.CleanupPartialBackups(signal);
		} catch (error) {
			if (isBackupAborted(error, signal)) throw error;
			// Stale partial cleanup is best-effort and must not prevent a new backup.
			log.warn('Failed to clean incomplete backups:', error);
		}
	}

	private async TryDeleteOversized(backupsPath: string, protectedBackupName: string) {
		try {
			await this.DeleteOversized(backupsPath, protectedBackupName);
		} catch (error) {
			// Retention is best-effort. A pruning problem must not invalidate the new backup.
			log.warn('Failed to prune old backups:', error);
		}
	}

	private async CleanupPartialBackups(signal: AbortSignal) {
		const backupsPath = store.get('backupsPath');
		if (!backupsPath) return;

		const entries = await fsp.readdir(backupsPath, { withFileTypes: true });
		const partialBackups = entries.filter((entry) => entry.isFile() && isPartialBackupName(entry.name));
		for (const partialBackup of partialBackups) {
			throwIfBackupAborted(signal);
			const partialPath = path.join(backupsPath, partialBackup.name);
			try {
				await fsp.unlink(partialPath);
				log.info('Removed incomplete backup:', partialPath);
			} catch (error: any) {
				if (error.code !== 'ENOENT') {
					log.warn('Failed to remove incomplete backup:', partialPath, error);
				}
			}
		}
	}

	private async DeleteOversized(backupsPath: string, protectedBackupName: string) {
		const maxSizeMB = Number(store.get('maxBackupsFolderSize'));
		if (!Number.isFinite(maxSizeMB) || maxSizeMB <= 0) {
			log.info('Max backup size not set');
			return;
		}
		const maxSize = maxSizeMB * 1024 * 1024;
		const backups = await fsp.readdir(backupsPath, { withFileTypes: true });
		const backupFiles = backups.filter((entry) => entry.isFile() && isBackupArchiveName(entry.name));
		if (backupFiles.length <= 1) {
			log.info('Only one backup found, skipping delete');
			return;
		}

		let totalSize = 0;
		const files: Array<{ file: string; size: number; createdAt: number }> = [];
		for (const backup of backupFiles) {
			const filePath = path.join(backupsPath, backup.name);
			try {
				const stats = await fsp.stat(filePath);
				totalSize += stats.size;
				files.push({ file: backup.name, size: stats.size, createdAt: getBackupTimestamp(backup.name) ?? stats.mtimeMs });
			} catch (error: any) {
				if (error.code !== 'ENOENT') throw error;
			}
		}

		log.info('Total size of backups:', totalSize);
		if (totalSize <= maxSize) {
			log.info('Total size is less than max size, skipping delete');
			return;
		}

		if (!files.some((file) => file.file === protectedBackupName)) {
			// Never prune unless the archive validated in this run is still present.
			throw new Error('The verified backup is missing; old backups will not be deleted');
		}

		files.sort((a, b) => a.createdAt - b.createdAt);
		let deletedSize = 0;
		// The newly created archive passed a complete read/CRC validation. Preserve it even
		// if it alone exceeds the configured limit; legacy files have no such guarantee.
		for (const file of files.filter((candidate) => candidate.file !== protectedBackupName)) {
			const filePath = path.join(backupsPath, file.file);
			await fsp.unlink(filePath);
			deletedSize += file.size;
			log.info('Deleted:', filePath);
			this.SendNotificationToRenderer(BACKUP_STATUS_DELETED, file.file);
			if (totalSize - deletedSize <= maxSize) {
				break;
			}
		}

		log.info('Deleted size:', deletedSize);
		if (deletedSize > 0) {
			this.SendRendererEvent(IPC_EVENTS.BACKUPS_CREATED_CALLBACK);
		}
	}

	private async CheckAvailableDiskSpace(backupsPath: string, sourceSize: number, signal: AbortSignal) {
		throwIfBackupAborted(signal);

		let availableBytes: number;
		try {
			const stats = await fsp.statfs(backupsPath);
			availableBytes = stats.bavail * stats.bsize;
		} catch (error) {
			if (isBackupAborted(error, signal)) throw error;
			// Some network and virtual file systems do not expose free-space information.
			// Continue with normal ENOSPC handling rather than making backups unavailable.
			log.warn('Could not check available space in the backups folder:', error);
			return;
		}

		throwIfBackupAborted(signal);
		const recommendedBytes = sourceSize + Math.max(
			BACKUP_DISK_SPACE_RESERVE_BYTES,
			Math.ceil(sourceSize * BACKUP_DISK_SPACE_OVERHEAD_RATIO),
		);
		if (!Number.isFinite(availableBytes) || availableBytes >= recommendedBytes) {
			this.diskSpaceWarning = null;
			return;
		}

		this.diskSpaceWarning = { availableBytes, recommendedBytes };
		this.UpdateBackupProgress(BACKUP_STATUS_CHECKING_SPACE, {
			phase: 'checking-space',
			percent: null,
			processedBytes: 0,
			totalBytes: sourceSize,
		}, true);

		const warning = formatDiskSpaceWarning(this.diskSpaceWarning);
		log.warn(`Low disk space in backups folder: ${warning}`);
		this.NotifyLowDiskSpace(warning);
	}

	private NotifyLowDiskSpace(warning: string) {
		const now = Date.now();
		if (now - this.lastLowDiskNotificationAt < LOW_DISK_NOTIFICATION_INTERVAL_MS) return;

		try {
			if (!Notification.isSupported()) return;
			new Notification({
				title: 'Rak Gaming Updater - Low disk space',
				body: `The WTF backup may fail: ${warning}.`,
			}).show();
			this.lastLowDiskNotificationAt = now;
		} catch (error) {
			log.warn('Could not show low disk space notification:', error);
		}
	}

	private async RemovePartialBackup(partialFilePath: string) {
		for (let attempt = 1; attempt <= 5; attempt += 1) {
			try {
				await fsp.rm(partialFilePath, { force: true });
				return;
			} catch (error: any) {
				const canRetry = error?.code === 'EBUSY' || error?.code === 'EPERM' || error?.code === 'EACCES';
				if (!canRetry || attempt === 5) {
					log.warn('Failed to remove partial backup:', partialFilePath, error);
					return;
				}
				// On Windows, stream handles can take a moment to close after cancellation.
				await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
			}
		}
	}

	async BackupWTFFolder(signal: AbortSignal): Promise<string> {
		throwIfBackupAborted(signal);
		const wowPath = await getWoWPath();
		throwIfBackupAborted(signal);
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

		let wtfStats: fs.Stats;
		try {
			wtfStats = await fsp.stat(wtfPath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') throw error;
			log.error('WTF folder not found:', wtfPath);
			throw new Error('WTF folder not found: ' + wtfPath);
		}
		if (!wtfStats.isDirectory()) {
			throw new Error('WTF path is not a folder: ' + wtfPath);
		}

		let backupsStats: fs.Stats;
		try {
			backupsStats = await fsp.stat(backupsPath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') throw error;
			log.error('Backups folder not found:', backupsPath);
			throw new Error('Backups folder not found: ' + backupsPath);
		}
		if (!backupsStats.isDirectory()) {
			throw new Error('Backups path is not a folder: ' + backupsPath);
		}
		const [realWowPath, realWtfPath, realBackupsPath] = await Promise.all([
			fsp.realpath(wowPath),
			fsp.realpath(wtfPath),
			fsp.realpath(backupsPath),
		]);
		if (
			isPathWithin(realWowPath, realBackupsPath)
			|| isPathWithin(realWtfPath, realBackupsPath)
		) {
			throw new Error('Backups folder cannot be inside the WoW folder');
		}
		await fsp.access(backupsPath, fs.constants.W_OK);
		throwIfBackupAborted(signal);

		for (let attempt = 1; attempt <= MAX_BACKUP_ATTEMPTS; attempt += 1) {
			throwIfBackupAborted(signal);
			this.UpdateBackupProgress(BACKUP_STATUS_SCANNING, {
				phase: 'scanning',
				percent: null,
				processedBytes: 0,
				totalBytes: 0,
			}, true);
			let sourceSnapshot: SourceSnapshot;
			try {
				sourceSnapshot = await this.CaptureSourceSnapshot(wtfPath, true, signal);
			} catch (error) {
				if (isBackupAborted(error, signal)) throw error;
				if (!isLikelySourceMutationError(error)) throw error;
				if (attempt >= MAX_BACKUP_ATTEMPTS) {
					throw new SourceChangedDuringBackupError('the WTF folder changed during every scan');
				}
				log.warn('WTF changed during the initial scan; waiting for it to settle before retrying', error);
				await this.WaitForSourceToSettle(wtfPath, signal);
				continue;
			}
			const sourceSize = sourceSnapshot.totalBytes;
			await this.CheckAvailableDiskSpace(backupsPath, sourceSize, signal);
			this.UpdateBackupProgress(BACKUP_STATUS_CREATING, {
				phase: 'creating',
				percent: sourceSize > 0 ? 0 : null,
				processedBytes: 0,
				totalBytes: sourceSize,
			}, true);

			log.info(`Backing up WTF folder (attempt ${attempt}/${MAX_BACKUP_ATTEMPTS}):`, wtfPath);
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupName = `WTF-${timestamp}.zip`;
			const backupFilePath = path.join(backupsPath, backupName);
			const partialFilePath = `${backupFilePath}.${process.pid}.partial`;

			try {
				await zipFile(wtfPath, partialFilePath, ({ processedBytes }) => {
					const clampedProcessedBytes = Math.min(processedBytes, sourceSize);
					const percent = sourceSize > 0
						? Math.min(85, (clampedProcessedBytes / sourceSize) * 85)
						: null;
					this.UpdateBackupProgress(BACKUP_STATUS_CREATING, {
						phase: 'creating',
						percent,
						processedBytes: clampedProcessedBytes,
						totalBytes: sourceSize,
					});
				}, signal);
				throwIfBackupAborted(signal);
				const partialStats = await fsp.stat(partialFilePath);
				if (!partialStats.isFile() || partialStats.size === 0) {
					throw new Error('Created backup archive is empty');
				}

				// Flush all archive bytes before verifying and atomically publishing the file.
				const partialHandle = await fsp.open(partialFilePath, 'r+');
				try {
					await partialHandle.sync();
				} finally {
					await partialHandle.close();
				}
				throwIfBackupAborted(signal);

				this.UpdateBackupProgress(BACKUP_STATUS_VALIDATING, {
					phase: 'validating',
					percent: sourceSize > 0 ? 85 : null,
					processedBytes: 0,
					totalBytes: sourceSize,
				}, true);
				await validateZipFile(partialFilePath, ({ processedBytes }) => {
					const clampedProcessedBytes = Math.min(processedBytes, sourceSize);
					const percent = sourceSize > 0
						? Math.min(99, 85 + (clampedProcessedBytes / sourceSize) * 14)
						: null;
					this.UpdateBackupProgress(BACKUP_STATUS_VALIDATING, {
						phase: 'validating',
						percent,
						processedBytes: clampedProcessedBytes,
						totalBytes: sourceSize,
					});
				}, signal);

				const sourceAfterBackup = await this.CaptureSourceSnapshot(wtfPath, false, signal);
				const sourceChange = this.FindSourceChange(sourceSnapshot, sourceAfterBackup);
				if (sourceChange) {
					throw new SourceChangedDuringBackupError(sourceChange);
				}

				throwIfBackupAborted(signal);
				this.backupCanBeAborted = false;
				this.UpdateBackupProgress(BACKUP_STATUS_VALIDATING, {
					phase: 'validating',
					percent: 99,
					processedBytes: sourceSize,
					totalBytes: sourceSize,
				}, true);
				await fsp.rename(partialFilePath, backupFilePath);
				await syncDirectoryBestEffort(backupsPath);
				this.UpdateBackupProgress(BACKUP_STATUS_VALIDATING, {
					phase: 'validating',
					percent: 100,
					processedBytes: sourceSize,
					totalBytes: sourceSize,
				}, true);
				return backupFilePath;
			} catch (error) {
				await this.RemovePartialBackup(partialFilePath);
				if (isBackupAborted(error, signal)) throw error;
				if (isNoSpaceError(error)) throw error;

				const sourceChangeError = await this.GetSourceChangeError(error, sourceSnapshot, wtfPath, signal);
				if (sourceChangeError && attempt < MAX_BACKUP_ATTEMPTS) {
					log.warn(`${sourceChangeError.message}; waiting for the WTF folder to settle before retrying`);
					await this.WaitForSourceToSettle(wtfPath, signal);
					continue;
				}
				throw sourceChangeError ?? error;
			}
		}

		throw new Error('Backup attempts exhausted');
	}

	private async CaptureSourceSnapshot(sourcePath: string, reportProgress: boolean, signal: AbortSignal): Promise<SourceSnapshot> {
		let totalBytes = 0;
		const entriesSnapshot = new Map<string, string>();

		const scanDirectory = async (directoryPath: string): Promise<void> => {
			throwIfBackupAborted(signal);
			const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
			for (const entry of entries) {
				throwIfBackupAborted(signal);
				const entryPath = path.join(directoryPath, entry.name);
				const relativePath = path.relative(sourcePath, entryPath);
				const stats = await fsp.lstat(entryPath, { bigint: true });
				const kind = stats.isDirectory() ? 'directory'
					: stats.isFile() ? 'file'
						: stats.isSymbolicLink() ? 'symlink'
							: 'other';
				entriesSnapshot.set(
					relativePath,
					`${kind}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`,
				);
				if (stats.isDirectory()) {
					await scanDirectory(entryPath);
					continue;
				}
				if (!stats.isFile()) continue;

				totalBytes += Number(stats.size);
				if (reportProgress) {
					this.UpdateBackupProgress(BACKUP_STATUS_SCANNING, {
						phase: 'scanning',
						percent: null,
						processedBytes: totalBytes,
						totalBytes: 0,
					});
				}
			}
		};

		await scanDirectory(sourcePath);
		return { totalBytes, entries: entriesSnapshot };
	}

	private FindSourceChange(before: SourceSnapshot, after: SourceSnapshot): string | null {
		if (before.entries.size !== after.entries.size) {
			return `entry count changed from ${before.entries.size} to ${after.entries.size}`;
		}
		for (const [relativePath, fingerprint] of before.entries) {
			const currentFingerprint = after.entries.get(relativePath);
			if (currentFingerprint === undefined) return `${relativePath} was removed`;
			if (currentFingerprint !== fingerprint) return `${relativePath} was modified`;
		}
		return null;
	}

	private async GetSourceChangeError(
		error: unknown,
		before: SourceSnapshot,
		sourcePath: string,
		signal: AbortSignal,
	): Promise<SourceChangedDuringBackupError | null> {
		throwIfBackupAborted(signal);
		if (error instanceof SourceChangedDuringBackupError) return error;
		try {
			const after = await this.CaptureSourceSnapshot(sourcePath, false, signal);
			const detail = this.FindSourceChange(before, after);
			return detail ? new SourceChangedDuringBackupError(detail) : null;
		} catch (scanError) {
			if (isBackupAborted(scanError, signal)) throw scanError;
			// A removed or renamed source path is itself a source mutation worth retrying.
			return new SourceChangedDuringBackupError('the WTF folder could not be rescanned');
		}
	}

	private async WaitForSourceToSettle(sourcePath: string, signal: AbortSignal): Promise<void> {
		this.UpdateBackupProgress(BACKUP_STATUS_WAITING_FOR_STABLE_SOURCE, {
			phase: 'waiting-for-stable-source',
			percent: null,
			processedBytes: 0,
			totalBytes: 0,
		}, true);
		let previous: SourceSnapshot | null = null;
		for (let check = 0; check <= SOURCE_SETTLE_CHECKS; check += 1) {
			if (check > 0) {
				await waitForDelay(SOURCE_SETTLE_INTERVAL_MS, signal);
			}
			try {
				const current = await this.CaptureSourceSnapshot(sourcePath, false, signal);
				if (previous && !this.FindSourceChange(previous, current)) return;
				previous = current;
			} catch (error) {
				if (isBackupAborted(error, signal)) throw error;
				previous = null;
				log.info('WTF is still changing while waiting to retry:', error);
			}
		}
		throw new SourceChangedDuringBackupError('the WTF folder did not become stable');
	}
}

function isLikelySourceMutationError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EBUSY';
}

function throwIfBackupAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new BackupAbortedError();
}

function isBackupAborted(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true
		|| error instanceof BackupAbortedError
		|| (error instanceof Error && error.name === 'AbortError');
}

function isNoSpaceError(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; current && depth < 4; depth += 1) {
		if ((current as NodeJS.ErrnoException).code === 'ENOSPC') return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			try {
				throwIfBackupAborted(signal);
			} catch (error) {
				reject(error);
			}
			return;
		}

		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		const abort = () => {
			clearTimeout(timeout);
			try {
				throwIfBackupAborted(signal);
			} catch (error) {
				reject(error);
			}
		};
		signal.addEventListener('abort', abort, { once: true });
	});
}

function formatDiskSpaceWarning(warning: DiskSpaceWarning): string {
	return `${formatBytes(warning.availableBytes)} available; ${formatBytes(warning.recommendedBytes)} recommended`;
}

function formatBytes(bytes: number): string {
	const nonNegativeBytes = Math.max(0, bytes);
	const gibibytes = nonNegativeBytes / (1024 ** 3);
	if (gibibytes >= 1) return `${gibibytes.toFixed(gibibytes >= 10 ? 1 : 2)} GB`;
	return `${(nonNegativeBytes / (1024 ** 2)).toFixed(1)} MB`;
}

async function syncDirectoryBestEffort(directoryPath: string): Promise<void> {
	// Windows does not support opening directory handles this way. On Unix, syncing
	// the parent makes the atomic rename durable across a sudden power loss.
	if (process.platform === 'win32') return;

	let directoryHandle: fsp.FileHandle | null = null;
	try {
		directoryHandle = await fsp.open(directoryPath, 'r');
		await directoryHandle.sync();
	} catch (error) {
		// Some network/virtual file systems do not support directory fsync. The archive
		// is already fully written and atomically published, so this remains best-effort.
		log.warn('Could not sync the backups directory after publishing the archive:', error);
	} finally {
		await directoryHandle?.close().catch((error) => {
			log.warn('Could not close the backups directory handle:', error);
		});
	}
}

function isBackupArchiveName(fileName: string): boolean {
	return getBackupTimestamp(fileName) !== null;
}

function isPartialBackupName(fileName: string): boolean {
	return /^WTF-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3}Z)?\.zip\.\d+\.partial$/i.test(fileName);
}

function getBackupTimestamp(fileName: string): number | null {
	// Supports both the legacy second-resolution name and the new millisecond-resolution name.
	const match = /^WTF-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3})Z)?\.zip$/i.exec(fileName);
	if (!match) return null;

	const [, year, month, day, hours, minutes, seconds, milliseconds = '0'] = match;
	const parts = [year, month, day, hours, minutes, seconds, milliseconds].map(Number);
	const [yearNumber, monthNumber, dayNumber, hoursNumber, minutesNumber, secondsNumber, millisecondsNumber] = parts;
	const timestamp = Date.UTC(yearNumber, monthNumber - 1, dayNumber, hoursNumber, minutesNumber, secondsNumber, millisecondsNumber);
	const date = new Date(timestamp);
	const isValid = date.getUTCFullYear() === yearNumber
		&& date.getUTCMonth() === monthNumber - 1
		&& date.getUTCDate() === dayNumber
		&& date.getUTCHours() === hoursNumber
		&& date.getUTCMinutes() === minutesNumber
		&& date.getUTCSeconds() === secondsNumber
		&& date.getUTCMilliseconds() === millisecondsNumber;
	return isValid ? timestamp : null;
}

export default BackupService;
