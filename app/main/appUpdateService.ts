/**
 * Application update rules
 *
 * 1. Update checks are informational and must never start a download. A download
 *    is authorized only by an explicit Update/Retry action from the user.
 * 2. Only one check, prompt, download, or installation may own the update flow at
 *    a time. Duplicate checks are coalesced and stale async results are ignored.
 * 3. Download and downloaded events are accepted only for the currently approved
 *    version. A declined, superseded, or failed approval grants no future consent.
 * 4. A failed download may retry the latest version currently reported by the
 *    provider. If no version is available, retry is disabled with a visible reason.
 * 5. A downloaded update must not install while a WTF backup is running. The UI
 *    must explain that installation is waiting and mirror the backup progress.
 * 6. Installation may put the app into its quitting state only after the backup
 *    gate is clear. A synchronously rejected install request must restore normal
 *    app state and allow a manual retry.
 * 7. Platform-specific installation, elevation, replacement, and relaunch behavior
 *    belongs to electron-updater and is invoked only through its public API.
 * 8. Release-webhook rechecks retain the announced target version and must not
 *    prompt for an older cached release. Skipped checks do not consume the budget.
 * 9. The renderer is only an observer/controller. Reloading or losing its window
 *    must not alter update consent or the main-process update transaction.
 * 10. autoDownload and autoInstallOnAppQuit remain disabled. All update lifecycle
 *     decisions must stay centralized in this service.
 */
import {
	Notification,
	ipcMain,
	type BrowserWindow,
	type MessageBoxOptions,
	type MessageBoxReturnValue,
	type NativeImage,
} from 'electron';
import type { AppUpdater } from 'electron-updater';
import log from 'electron-log/main';
import { IPC_EVENTS, type AppUpdateDownloadState, type BackupProgress } from '@/events';
import type BackupService from '@/main/backupService';

const RELEASE_RECHECK_INTERVAL_MS = 30 * 1000;
const MAX_RELEASE_RECHECKS = 20;
const INITIAL_INSTALL_DELAY_MS = 5 * 1000;

type AvailableUpdateInfo = {
	version: string;
	releaseDate?: string;
	releaseName?: string | null;
};

type DownloadedUpdateInfo = {
	version: string;
};

type DownloadProgressInfo = {
	bytesPerSecond: number;
	percent: number;
	transferred: number;
	total: number;
};

type RetryStage = 'download' | 'install';

type AppUpdateServiceOptions = {
	updater: AppUpdater;
	backupService: BackupService;
	getMainWindow: () => BrowserWindow | null;
	showDialog: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
	notificationIcon: NativeImage;
	setAppQuitting: (isQuitting: boolean) => void;
};

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeReleaseVersion(version: unknown): string | null {
	if (typeof version !== 'string') return null;
	const normalized = version.trim().replace(/^v(?=\d)/i, '');
	return normalized || null;
}

function parseReleaseVersion(version: string): { core: [number, number, number]; prerelease: string | null } | null {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] || null,
	};
}

function isReleaseAtLeast(actualVersion: string, expectedVersion: string): boolean {
	const actual = parseReleaseVersion(actualVersion);
	const expected = parseReleaseVersion(expectedVersion);
	if (!actual || !expected) return actualVersion === expectedVersion;

	for (let index = 0; index < actual.core.length; index += 1) {
		if (actual.core[index] !== expected.core[index]) return actual.core[index] > expected.core[index];
	}
	if (actual.prerelease === expected.prerelease) return true;
	if (actual.prerelease === null) return true;
	if (expected.prerelease === null) return false;
	return actual.prerelease.localeCompare(expected.prerelease, undefined, { numeric: true }) >= 0;
}

/**
 * Owns the complete application-update lifecycle. Callers can request a check
 * or schedule release rechecks, but only this service can grant download
 * consent, publish update state, or start installation.
 */
export default class AppUpdateService {
	private readonly updater: AppUpdater;
	private readonly backupService: BackupService;
	private readonly promptedVersions = new Set<string>();
	private downloadState: AppUpdateDownloadState | null = null;
	private availableVersion: string | null = null;
	private promptInProgressVersion: string | null = null;
	private approvedVersion: string | null = null;
	private updatePending = false;
	private installationStarted = false;
	private installAttemptInProgress = false;
	private installAttemptError: Error | null = null;
	private retryStage: RetryStage | null = null;
	private downloadAttemptSequence = 0;
	private activeCheck: Promise<boolean> | null = null;
	private releaseRecheckTimer: NodeJS.Timeout | null = null;
	private releaseRecheckAttempts = 0;
	private releaseRecheckInProgress = false;
	private releaseRecheckSequence = 0;
	private expectedReleaseVersion: string | null = null;
	private installTimer: NodeJS.Timeout | null = null;
	private disposed = false;

	constructor(private readonly options: AppUpdateServiceOptions) {
		this.updater = options.updater;
		this.backupService = options.backupService;

		this.updater.autoDownload = false;
		this.updater.autoInstallOnAppQuit = false;
		this.updater.allowPrerelease = false;
		this.updater.logger = log;

		this.updater.on('update-available', this.onUpdateAvailable);
		this.updater.on('update-not-available', this.onUpdateNotAvailable);
		this.updater.on('error', this.onUpdaterError);
		this.updater.on('download-progress', this.onDownloadProgress);
		this.updater.on('update-downloaded', this.onUpdateDownloaded);

		this.backupService.on('backup-started', this.onBackupStarted);
		this.backupService.on('backup-progress', this.onBackupProgress);
		this.backupService.on('backup-completed', this.onBackupCompleted);

		ipcMain.handle(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_GET, () => this.getDownloadState());
		ipcMain.on(IPC_EVENTS.APP_UPDATE_RETRY, this.onRetryRequested);
	}

	async checkForUpdates(reason: string): Promise<boolean> {
		if (this.disposed) return false;
		if (this.promptInProgressVersion || this.approvedVersion || this.updatePending || this.installationStarted) {
			log.info(`Skipping ${reason} app update check while another update action is active`);
			return false;
		}
		if (this.activeCheck) {
			log.info(`App update check already running; coalescing ${reason} check`);
			return this.activeCheck;
		}

		const check = this.runUpdateCheck(reason);
		this.activeCheck = check;
		try {
			return await check;
		} finally {
			if (this.activeCheck === check) this.activeCheck = null;
		}
	}

	startReleaseRechecks(expectedVersion?: string): void {
		if (this.disposed) return;

		this.stopReleaseRechecks();
		this.releaseRecheckSequence += 1;
		const recheckSequence = this.releaseRecheckSequence;
		this.expectedReleaseVersion = normalizeReleaseVersion(expectedVersion);
		this.releaseRecheckAttempts = 0;
		this.releaseRecheckTimer = setInterval(() => {
			void this.runReleaseRecheck(recheckSequence);
		}, RELEASE_RECHECK_INTERVAL_MS);
		log.info(`Scheduled app update release rechecks${this.expectedReleaseVersion ? ` for ${this.expectedReleaseVersion}` : ''}`);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.stopReleaseRechecks();
		this.clearInstallTimer();

		this.updater.removeListener('update-available', this.onUpdateAvailable);
		this.updater.removeListener('update-not-available', this.onUpdateNotAvailable);
		this.updater.removeListener('error', this.onUpdaterError);
		this.updater.removeListener('download-progress', this.onDownloadProgress);
		this.updater.removeListener('update-downloaded', this.onUpdateDownloaded);

		this.backupService.off('backup-started', this.onBackupStarted);
		this.backupService.off('backup-progress', this.onBackupProgress);
		this.backupService.off('backup-completed', this.onBackupCompleted);
		ipcMain.removeHandler(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_GET);
		ipcMain.removeListener(IPC_EVENTS.APP_UPDATE_RETRY, this.onRetryRequested);
	}

	private async runUpdateCheck(reason: string): Promise<boolean> {
		try {
			// Checks remain informational. downloadUpdate() is reachable only after
			// the matching version is explicitly approved in promptForUpdate().
			this.updater.autoDownload = false;
			const result = await this.updater.checkForUpdates();
			log.info(`App update check completed (${reason}):`, result);
		} catch (error) {
			// All entry points deliberately terminate here so startup/socket callbacks
			// cannot produce an unhandled rejection when the update provider is down.
			log.error(`App update check failed (${reason}):`, error);
		}
		return true;
	}

	private async runReleaseRecheck(recheckSequence: number): Promise<void> {
		if (this.disposed || !this.releaseRecheckTimer || this.releaseRecheckInProgress) return;
		if (recheckSequence !== this.releaseRecheckSequence) return;
		if (this.releaseRecheckAttempts >= MAX_RELEASE_RECHECKS) {
			this.stopReleaseRechecks();
			return;
		}

		this.releaseRecheckInProgress = true;
		const nextAttempt = this.releaseRecheckAttempts + 1;
		try {
			const didCheck = await this.checkForUpdates(`release recheck ${nextAttempt}/${MAX_RELEASE_RECHECKS}`);
			if (recheckSequence !== this.releaseRecheckSequence) return;
			if (!didCheck) return;
			this.releaseRecheckAttempts = nextAttempt;
			if (this.releaseRecheckAttempts >= MAX_RELEASE_RECHECKS && this.releaseRecheckTimer) {
				this.stopReleaseRechecks();
			}
		} finally {
			this.releaseRecheckInProgress = false;
		}
	}

	private readonly onUpdateAvailable = (info: AvailableUpdateInfo) => {
		if (this.disposed) return;

		log.info(`Update available Version: ${info.version} Release Date: ${info.releaseDate || 'unknown'}`);
		this.availableVersion = info.version;
		const normalizedAvailableVersion = normalizeReleaseVersion(info.version);
		if (
			this.expectedReleaseVersion
			&& (!normalizedAvailableVersion || !isReleaseAtLeast(normalizedAvailableVersion, this.expectedReleaseVersion))
		) {
			log.info(
				`Update provider still reports ${info.version}; waiting for announced release ${this.expectedReleaseVersion}`,
			);
			return;
		}
		this.stopReleaseRechecks();
		this.retargetFailedDownload(info.version);

		if (this.promptedVersions.has(info.version)) {
			log.info(`Update dialog for version ${info.version} was already handled; skipping duplicate`);
			return;
		}

		// Reserve before awaiting the dialog so concurrent checks cannot queue a
		// duplicate. A dialog failure releases the reservation for a later retry.
		this.promptedVersions.add(info.version);
		this.promptInProgressVersion = info.version;
		this.showUpdateNotification(info.version);
		void this.promptForUpdate(info);
	};

	private readonly onUpdateNotAvailable = () => {
		if (this.disposed) return;
		this.availableVersion = null;
		log.info('Application is up to date');
	};

	private readonly onUpdaterError = (error: Error) => {
		if (this.disposed) return;
		log.error('Error in auto-updater:', error);
		if (this.installAttemptInProgress) {
			this.installAttemptError ??= error;
			return;
		}
		this.failDownload(error);
	};

	private readonly onRetryRequested = () => {
		if (this.disposed || this.downloadState?.status !== 'error' || this.downloadState.canRetry !== true) return;

		if (this.retryStage === 'download') {
			const retryVersion = this.availableVersion;
			if (!retryVersion) {
				this.retryStage = null;
				this.publishDownloadState({
					...this.downloadState,
					error: 'The failed update is no longer available. Please wait for the next update check.',
					canRetry: false,
				});
				return;
			}

			// The currently displayed version is the consent boundary. If the provider
			// changed versions, show the new version and require another explicit click.
			if (this.retargetFailedDownload(retryVersion)) return;
			this.startDownload(retryVersion);
			return;
		}
		if (
			this.retryStage === 'install'
			&& this.updatePending
			&& this.approvedVersion === this.downloadState.version
		) {
			this.clearInstallTimer();
			this.coordinatePendingInstallation();
		}
	};

	private readonly onDownloadProgress = (progress: DownloadProgressInfo) => {
		const state = this.downloadState;
		if (
			this.disposed
			|| state?.status !== 'downloading'
			|| this.approvedVersion !== state.version
		) return;

		const percent = Math.min(100, Math.max(0, Number.isFinite(progress.percent) ? progress.percent : 0));
		log.info(
			`App update download ${percent.toFixed(2)}% `
			+ `(${(progress.transferred / (1024 * 1024)).toFixed(2)}/${(progress.total / (1024 * 1024)).toFixed(2)} MB) `
			+ `at ${(progress.bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`,
		);
		this.publishDownloadState({
			status: 'downloading',
			version: state.version,
			percent,
			bytesPerSecond: progress.bytesPerSecond,
			transferred: progress.transferred,
			total: progress.total,
		});
		this.setWindowProgress(percent / 100);
	};

	private readonly onUpdateDownloaded = (info: DownloadedUpdateInfo) => {
		const state = this.downloadState;
		if (
			this.disposed
			|| state?.status !== 'downloading'
			|| !this.approvedVersion
			|| this.approvedVersion !== info.version
			|| state.version !== info.version
		) {
			log.warn(`Ignoring downloaded app update ${info.version}: no matching user approval`);
			return;
		}

		this.setWindowProgress(-1);
		this.publishDownloadState({
			status: 'downloaded',
			version: state.version,
			percent: 100,
			bytesPerSecond: 0,
			transferred: state.total || state.transferred || 0,
			total: state.total || 0,
		});
		this.updatePending = true;
		this.installationStarted = false;
		this.retryStage = null;
		this.coordinatePendingInstallation();
	};

	private readonly onBackupStarted = () => {
		this.coordinatePendingInstallation();
	};

	private readonly onBackupProgress = (progress: BackupProgress | null) => {
		if (!this.updatePending || this.downloadState?.status !== 'waiting-for-backup') return;
		this.publishDownloadState({
			...this.downloadState,
			backupProgress: progress ?? undefined,
		});
	};

	private readonly onBackupCompleted = () => {
		this.coordinatePendingInstallation();
	};

	private async promptForUpdate(info: AvailableUpdateInfo): Promise<void> {
		try {
			const { response } = await this.options.showDialog({
				buttons: ['Update', 'Later'],
				defaultId: 0,
				cancelId: 1,
				title: 'Rak Gaming Updater',
				message: info.releaseName || 'Update Available',
				detail: `A new version ${info.version} is available. Do you want to update now?`,
				noLink: true,
			});
			if (this.disposed) return;

			if (response !== 0) {
				log.info(`User declined app update ${info.version}`);
				return;
			}

			log.info(`User approved app update ${info.version}`);
			this.startDownload(info.version);
		} catch (error) {
			// Let a later check prompt again if Electron could not display the dialog.
			this.promptedVersions.delete(info.version);
			log.error(`Could not display app update dialog for ${info.version}:`, error);
		} finally {
			if (this.promptInProgressVersion === info.version) this.promptInProgressVersion = null;
		}
	}

	private showUpdateNotification(version: string): void {
		try {
			if (!Notification.isSupported()) return;
			new Notification({
				title: 'Update available',
				body: `Rak Gaming Updater ${version} is available.`,
				icon: this.options.notificationIcon,
			}).show();
		} catch (error) {
			// A platform notification is optional and must never suppress the prompt.
			log.warn(`Could not show app update notification for ${version}:`, error);
		}
	}

	private startDownload(version: string): void {
		if (this.disposed) return;
		if (this.approvedVersion || this.updatePending || this.installationStarted) {
			log.info(`An app update is already active; ignoring a second request for ${version}`);
			return;
		}
		if (this.availableVersion !== version) {
			log.warn(
				`Ignoring approval for stale app update ${version}; current available version is ${this.availableVersion || 'none'}`,
			);
			return;
		}

		// This is the sole point where explicit user consent becomes download
		// authorization. All updater events are matched against this version.
		this.approvedVersion = version;
		this.retryStage = null;
		this.downloadAttemptSequence += 1;
		const downloadAttemptSequence = this.downloadAttemptSequence;
		this.publishDownloadState({
			status: 'downloading',
			version,
			percent: 0,
			bytesPerSecond: 0,
			transferred: 0,
			total: 0,
		});

		void this.downloadApprovedUpdate(version, downloadAttemptSequence);
	}

	private async downloadApprovedUpdate(version: string, downloadAttemptSequence: number): Promise<void> {
		try {
			await this.updater.downloadUpdate();
			if (downloadAttemptSequence !== this.downloadAttemptSequence || this.approvedVersion !== version) return;
		} catch (error) {
			if (downloadAttemptSequence === this.downloadAttemptSequence) this.failDownload(error);
		}
	}

	private failDownload(error: unknown): void {
		if (this.downloadState?.status !== 'downloading') return;

		const failedVersion = this.downloadState.version;
		this.downloadAttemptSequence += 1;
		this.publishDownloadState({
			...this.downloadState,
			status: 'error',
			error: getErrorMessage(error),
			canRetry: true,
		});
		this.approvedVersion = null;
		this.updatePending = false;
		this.retryStage = 'download';
		this.promptedVersions.delete(failedVersion);
		this.clearInstallTimer();
		this.setWindowProgress(-1);
	}

	private coordinatePendingInstallation(): void {
		if (this.disposed || !this.updatePending || !this.approvedVersion || this.installationStarted) return;

		if (this.backupService.IsBackupInProgress()) {
			this.clearInstallTimer();
			if (this.downloadState && this.downloadState.status !== 'waiting-for-backup') {
				this.publishDownloadState({
					...this.downloadState,
					status: 'waiting-for-backup',
					error: undefined,
					canRetry: undefined,
					backupProgress: this.backupService.GetBackupProgress() ?? undefined,
				});
				log.info('Update installation is waiting for the backup to finish');
			}
			return;
		}

		if (this.installTimer) return;
		if (this.downloadState?.status === 'waiting-for-backup') {
			this.publishDownloadState({
				...this.downloadState,
				status: 'downloaded',
				error: undefined,
				canRetry: undefined,
				backupProgress: undefined,
			});
		}

		this.scheduleInstallAttempt(INITIAL_INSTALL_DELAY_MS);
	}

	private scheduleInstallAttempt(delayMs: number): void {
		if (this.disposed || this.installTimer || !this.updatePending || !this.approvedVersion) return;

		log.info(`Update downloaded; installation attempt scheduled in ${delayMs / 1000} seconds`);
		this.installTimer = setTimeout(() => {
			this.installTimer = null;
			if (this.backupService.IsBackupInProgress()) {
				this.coordinatePendingInstallation();
				return;
			}
			this.tryInstallUpdate();
		}, delayMs);
	}

	private tryInstallUpdate(): void {
		if (this.disposed || !this.updatePending || !this.approvedVersion || this.installationStarted) return;
		if (this.backupService.IsBackupInProgress()) {
			this.coordinatePendingInstallation();
			return;
		}

		const version = this.approvedVersion;
		this.retryStage = null;
		this.installAttemptError = null;
		this.installAttemptInProgress = true;
		if (this.downloadState?.status === 'error') {
			this.publishDownloadState({
				...this.downloadState,
				status: 'downloaded',
				error: undefined,
				canRetry: undefined,
			});
		}

		try {
			this.options.setAppQuitting(true);
			this.updater.quitAndInstall(true, true);
			if (this.installAttemptError) throw this.installAttemptError;

			this.installAttemptInProgress = false;
			this.installationStarted = true;
			this.updatePending = false;
			this.approvedVersion = null;
			this.retryStage = null;
		} catch (error) {
			this.installAttemptInProgress = false;
			this.options.setAppQuitting(false);
			this.handleInstallFailure(version, error);
		}
	}

	private retargetFailedDownload(version: string): boolean {
		const state = this.downloadState;
		if (this.retryStage !== 'download' || state?.status !== 'error' || state.version === version) return false;

		log.info(`Available app update changed from failed version ${state.version} to ${version}; requesting fresh retry consent`);
		this.publishDownloadState({
			status: 'error',
			version,
			percent: 0,
			bytesPerSecond: 0,
			transferred: 0,
			total: 0,
			error: 'A different update version is now available. Review the version above, then select Retry Update to download it.',
			canRetry: true,
		});
		return true;
	}

	private handleInstallFailure(version: string, error: unknown): void {
		const errorMessage = getErrorMessage(error);
		log.error(`Failed to start installation of app update ${version}:`, error);
		this.retryStage = 'install';
		if (this.downloadState) {
			this.publishDownloadState({
				...this.downloadState,
				status: 'error',
				error: errorMessage,
				canRetry: true,
				backupProgress: undefined,
			});
		}
	}

	private publishDownloadState(state: AppUpdateDownloadState): void {
		this.downloadState = state;
		try {
			const webContents = this.options.getMainWindow()?.webContents;
			if (!webContents || webContents.isDestroyed()) return;
			webContents.send(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_CALLBACK, state);
		} catch (error) {
			// Losing the renderer while closing/reloading must not affect updater state.
			log.warn('Could not send app update state to renderer:', error);
		}
	}

	private getDownloadState(): AppUpdateDownloadState | null {
		if (!this.downloadState) return null;
		return {
			...this.downloadState,
			backupProgress: this.downloadState.backupProgress
				? { ...this.downloadState.backupProgress }
				: undefined,
		};
	}

	private setWindowProgress(progress: number): void {
		try {
			const window = this.options.getMainWindow();
			if (!window || window.isDestroyed()) return;
			window.setProgressBar(progress);
		} catch (error) {
			log.warn('Could not update taskbar download progress:', error);
		}
	}

	private stopReleaseRechecks(): void {
		this.releaseRecheckSequence += 1;
		this.expectedReleaseVersion = null;
		if (this.releaseRecheckTimer) {
			clearInterval(this.releaseRecheckTimer);
			this.releaseRecheckTimer = null;
			log.info('App update release recheck timer cleared');
		}
	}

	private clearInstallTimer(): void {
		if (!this.installTimer) return;
		clearTimeout(this.installTimer);
		this.installTimer = null;
	}
}
