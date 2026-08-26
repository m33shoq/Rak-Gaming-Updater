import 'dotenv/config';

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, shell, Notification, net, powerMonitor } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log/main';
import { io as Socket } from 'socket.io-client';
import { jwtDecode } from 'jwt-decode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import validator from 'validator';
import { fileURLToPath } from "node:url";
import { GetFileData, CalculateHashForPath } from '@/main/fileDataUtility';
import { zipFile, unzipFile } from '@/main/zipHandler';
import { FileManagementService, InstallFile } from '@/main/fileManagement';
import { getWoWPath, validateWoWPath } from '@/main/wowPathUtility';
import mainWindowWrapper from '@/main/MainWindowWrapper';
import store from '@/main/store';
import { RegisterSVCallback } from '@/main/svWatcher';
import BackupService from '@/main/backupService';
import { getSafeInitialWindowBounds, getWindowSettingsFromWindow, type StoredWindowSettings } from '@/main/windowBounds';
import ObsWebsocketService, { type ObsSettings as ObsServiceSettings } from '@/main/obsWebsocketService';
import { registerRendererStoreSync } from '@/main/rendererStoreSync';
import TimelineWindowController from '@/main/timelineWindowController';


// @ts-ignore
store.delete('youtubeVideoInfo'); // reset
// store.set('authToken', null); // reset

import {
	SERVER_URL,
	SERVER_LOGIN_ENDPOINT,
	SERVER_UPLOADS_ENDPOINT,
	SERVER_EXISTING_FILES_ENDPOINT,
	SERVER_DOWNLOAD_ENDPOINT
} from '@/main/serverEndpoints';

import {
	DOWNLOAD_REASON_NO_PATH_SET,
	DOWNLOAD_REASON_SYMLINK,
	DOWNLOAD_REASON_UPDATE,
	DOWNLOAD_REASON_INSTALL,
	DOWNLOAD_REASON_UP_TO_DATE,
	BACKUPS_ERROR_NO_PATH_SET,
	BACKUP_STATUS_DISABLED,
	BACKUP_STATUS_DELETING_OLD,
	BACKUP_STATUS_CREATING,
	BACKUP_STATUS_COMPLETED,
	BACKUP_STATUS_FAILED,
	BACKUP_STATUS_DELETED,
	BACKUP_INTERVAL_ONE_WEK,
} from '@/constants'

import { IPC_EVENTS, SOCKET_EVENTS, type AppUpdateDownloadState } from '@/events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

log.transports.file.level = 'info';
log.initialize({ preload: true });
registerRendererStoreSync();

process.on("uncaughtException", (error) => {
  log.error("uncaughtException", error);
  mainWindow?.webContents.send(IPC_EVENTS.APP_UNCAUGHT_EXCEPTION_CALLBACK, error);
});

process.on("unhandledRejection", (error) => {
  log.error("unhandledRejection", error);
  mainWindow?.webContents.send(IPC_EVENTS.APP_UNHANDLED_REJECTION_CALLBACK, error);
});

let isQuiting = false;
let isSystemShutdown = false;
let shutdownInProgress = false;

let updatedRecheckTimer: NodeJS.Timeout | null = null;
let rechekTries = 0;
let lastQueuedUpdateVersion: string | null = null;

const TEMP_DIR = path.join(app.getPath('temp'), app.getName()); // Temporary directory for unzipped/zipped files

function getStoredWindowSettings(): StoredWindowSettings {
	return (store.get('windowSettings') || {}) as StoredWindowSettings;
}

function persistWindowSettings(win: BrowserWindow) {
	store.set('windowSettings', getWindowSettingsFromWindow(win));
}

let persistWindowSettingsTimeout: NodeJS.Timeout | null = null;

function persistWindowSettingsDebounced(win: BrowserWindow, delayMs = 250) {
	if (persistWindowSettingsTimeout) {
		clearTimeout(persistWindowSettingsTimeout);
	}

	persistWindowSettingsTimeout = setTimeout(() => {
		persistWindowSettings(win);
		persistWindowSettingsTimeout = null;
	}, delayMs);
}

const socket = Socket(SERVER_URL, { autoConnect: false });
const backupService = new BackupService(socket);

const isDev = process.env.npm_lifecycle_event === 'app:dev' ? true : false;
if (isDev) {
	// store.delete('authToken'); // Clear auth token on startup for testing
	// store.delete('WCL_REFRESH_TOKEN'); // Clear auth token on startup for testing
}

const fileManagementService = new FileManagementService(socket);

const startupLoginItemSettings = app.getLoginItemSettings();
log.info('Login item settings at startup:', startupLoginItemSettings);
log.info('process.argv:', process.argv);

function updateLoginItems() {
	if (!app.isPackaged) return; // Don't set login item settings in development mode

	// app was renamed at some point and
	// this login item may break the startup
	// settings so remove it
	const oldAppUserModelId = 'electron.app.Rak Gaming Updater'
	app.setLoginItemSettings({
		name: oldAppUserModelId,
		openAtLogin: false,
	})

	if (store.get('startWithWindows')) {
		app.setLoginItemSettings({
			openAtLogin: true,
			args: ['--hidden'],
		});
	} else {
		app.setLoginItemSettings({
			openAtLogin: false,
		});
	}
}

store.onDidChange('startWithWindows', (newValue) => {
	updateLoginItems();
});

store.onDidChange('startMinimized', (newValue) => {
	updateLoginItems();
});

function getObsSettingsFromStore(): ObsServiceSettings {
	const obsPort = Number(store.get('obsPort'));

	return {
		enabled: store.get('obsEnabled'),
		port: Number.isFinite(obsPort) ? obsPort : 4455,
		password: String(store.get('obsPassword') || ''),
	};
}


import taskBarIcon from '@/assets/taskbaricon.png';
import notificationIcon from '@/assets/icon.png';

let taskBarIconImage: Electron.NativeImage;
let notificationIconImage: Electron.NativeImage;

// 1) data:… ⇒ use createFromDataURL
if (taskBarIcon.startsWith('data:')) {
	taskBarIconImage = nativeImage.createFromDataURL(taskBarIcon);
	// 2) “/assets/…” or “assets/…” ⇒ resolve to your built files
} else {
	// __dirname in your bundled main.js points to dist/
	const iconOnDisk = path.join(__dirname, taskBarIcon.replace(/^\//, ''));
	taskBarIconImage = nativeImage.createFromPath(iconOnDisk);
}

if (notificationIcon.startsWith('data:')) {
	notificationIconImage = nativeImage.createFromDataURL(notificationIcon);
} else {
	const iconOnDisk = path.join(__dirname, notificationIcon.replace(/^\//, ''));
	notificationIconImage = nativeImage.createFromPath(iconOnDisk);
}

const preload = path.join(__dirname, 'preload.cjs');
const html = path.join(__dirname, 'index.html');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }]);

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
log.transports.file.level = 'info';
autoUpdater.logger = log;

log.info('App starting...');

const queuedDialogs = [] as Array<{ dialogOptions: Electron.MessageBoxOptions; onSuccessCallback: (value: Electron.MessageBoxReturnValue) => void }>;

function queueDialog(dialogOptions: Electron.MessageBoxOptions, onSuccessCallback: (value: Electron.MessageBoxReturnValue) => void) {
	if (mainWindow?.isVisible()) {
		dialog.showMessageBox(mainWindow, dialogOptions).then(onSuccessCallback);
	} else {
		queuedDialogs.push({ dialogOptions, onSuccessCallback });
	}
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isYouTubePlayerFullscreen = false;
let desiredYouTubePlayerFullscreen = false;
let lastYouTubePlayerPointerActivityAt = 0;
let pendingYouTubePlayerDoubleClick = false;
let youtubePlayerPointerBounds: { left: number; top: number; right: number; bottom: number } | null = null;
type YouTubeFullscreenTransition = {
	targetWindow: BrowserWindow;
	fullscreen: boolean;
	promise: Promise<boolean>;
	resolve: (fullscreen: boolean) => void;
	timeout: ReturnType<typeof setTimeout>;
};
let youtubeFullscreenTransition: YouTubeFullscreenTransition | null = null;
const YOUTUBE_FULLSCREEN_TRANSITION_TIMEOUT_MS = 3000;

function publishYouTubePlayerFullscreenState() {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_CHANGED, isYouTubePlayerFullscreen);
}

function finishYouTubeFullscreenTransition(transition: YouTubeFullscreenTransition, actualFullscreen: boolean) {
	if (youtubeFullscreenTransition !== transition) return;

	clearTimeout(transition.timeout);
	youtubeFullscreenTransition = null;
	if (actualFullscreen === transition.fullscreen) {
		isYouTubePlayerFullscreen = actualFullscreen;
	} else if (desiredYouTubePlayerFullscreen === transition.fullscreen) {
		// Stop retrying a transition that Electron did not complete.
		desiredYouTubePlayerFullscreen = isYouTubePlayerFullscreen;
	}
	publishYouTubePlayerFullscreenState();
	transition.resolve(isYouTubePlayerFullscreen);
}

async function reconcileYouTubePlayerFullscreen(targetWindow: BrowserWindow): Promise<boolean> {
	if (targetWindow !== mainWindow || targetWindow.isDestroyed()) return false;

	if (youtubeFullscreenTransition) {
		await youtubeFullscreenTransition.promise;
		return reconcileYouTubePlayerFullscreen(targetWindow);
	}

	const requestedFullscreen = desiredYouTubePlayerFullscreen;
	if (targetWindow.isFullScreen() === requestedFullscreen) {
		if (isYouTubePlayerFullscreen !== requestedFullscreen) {
			isYouTubePlayerFullscreen = requestedFullscreen;
			publishYouTubePlayerFullscreenState();
		}
		return isYouTubePlayerFullscreen;
	}

	let resolveTransition!: (fullscreen: boolean) => void;
	const promise = new Promise<boolean>((resolve) => {
		resolveTransition = resolve;
	});
	const transition = {
		targetWindow,
		fullscreen: requestedFullscreen,
		promise,
		resolve: resolveTransition,
		timeout: undefined as unknown as ReturnType<typeof setTimeout>,
	};
	transition.timeout = setTimeout(() => {
		finishYouTubeFullscreenTransition(transition, !targetWindow.isDestroyed() && targetWindow.isFullScreen());
	}, YOUTUBE_FULLSCREEN_TRANSITION_TIMEOUT_MS);
	youtubeFullscreenTransition = transition;

	try {
		targetWindow.setFullScreen(requestedFullscreen);
	} catch (error) {
		log.warn('Failed to transition YouTube player fullscreen state', error);
		finishYouTubeFullscreenTransition(transition, !targetWindow.isDestroyed() && targetWindow.isFullScreen());
	}

	await promise;
	return reconcileYouTubePlayerFullscreen(targetWindow);
}

function setYouTubePlayerFullscreen(targetWindow: BrowserWindow, fullscreen: boolean): Promise<boolean> {
	if (targetWindow !== mainWindow || targetWindow.isDestroyed()) return Promise.resolve(false);
	desiredYouTubePlayerFullscreen = fullscreen;
	return reconcileYouTubePlayerFullscreen(targetWindow);
}

function onYouTubePlayerFullscreenChanged(targetWindow: BrowserWindow, fullscreen: boolean) {
	const transition = youtubeFullscreenTransition;
	if (transition?.targetWindow === targetWindow && transition.fullscreen === fullscreen) {
		finishYouTubeFullscreenTransition(transition, fullscreen);
		return;
	}

	if (targetWindow !== mainWindow) return;
	if (!fullscreen && isYouTubePlayerFullscreen) {
		desiredYouTubePlayerFullscreen = false;
		isYouTubePlayerFullscreen = false;
		publishYouTubePlayerFullscreenState();
		return;
	}
	if (fullscreen === desiredYouTubePlayerFullscreen) {
		isYouTubePlayerFullscreen = fullscreen;
		publishYouTubePlayerFullscreenState();
		return;
	}

	void reconcileYouTubePlayerFullscreen(targetWindow);
}

const timelineWindowController = new TimelineWindowController({
	getMainWindow: () => mainWindow,
	preloadPath: preload,
	htmlPath: html,
	devUrl: isDev ? 'http://localhost:5173/?window=timeline' : undefined,
	icon: taskBarIconImage,
	isAppClosing: () => isQuiting || isSystemShutdown,
});

let appUpdateDownloadState: AppUpdateDownloadState | null = null;

function publishAppUpdateDownloadState(state: AppUpdateDownloadState) {
	appUpdateDownloadState = state;
	mainWindow?.webContents.send(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_CALLBACK, state);
}

function failAppUpdateDownload(error: unknown) {
	if (appUpdateDownloadState?.status !== 'downloading') return;

	const errorMessage = error instanceof Error ? error.message : String(error);
	publishAppUpdateDownloadState({
		...appUpdateDownloadState,
		status: 'error',
		error: errorMessage,
	});
	mainWindow?.setProgressBar(-1);
}

function startAppUpdateDownload(version: string) {
	publishAppUpdateDownloadState({
		status: 'downloading',
		version,
		percent: 0,
		bytesPerSecond: 0,
		transferred: 0,
		total: 0,
	});

	void (async () => {
		try {
			await autoUpdater.downloadUpdate();
		} catch (error) {
			failAppUpdateDownload(error);
		}
	})();
}

ipcMain.handle(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_GET, () => appUpdateDownloadState);

const obsService = new ObsWebsocketService({
	onStatus: (status) => {
		mainWindow?.webContents.send(IPC_EVENTS.OBS_STATUS_UPDATED, status);
	},
	onStreamStarted: (payload) => {
		log.info('[OBS] Stream is live', payload.youtubeUrl);

		if (!socket.connected) {
			log.warn('[OBS] Server socket is disconnected, skipping YouTube URL emit');
			return;
		}

		socket.emit(SOCKET_EVENTS.YOUTUBE_VIDEO_INFO_ADD, { URL: payload.youtubeUrl }, (response: { success: boolean; error?: string }) => {
			if (response.success) {
				log.info('[OBS] Sent YouTube URL to server', payload.youtubeUrl);
			} else {
				log.warn('[OBS] Failed to send YouTube URL to server', response.error);
			}
		});
	},
	log,
});

const OBS_STORE_KEYS = ['obsEnabled', 'obsPort', 'obsPassword'] as const;
for (const key of OBS_STORE_KEYS) {
	store.onDidChange(key, () => {
		void obsService.updateSettings(getObsSettingsFromStore());
	});
}

const DEEP_LINK_PROTOCOL = 'rak-gaming-updater';

type AppDeepLinkPayload = {
	tab: 'reviews';
	action: 'open-video';
	videoId: string;
	timestampSeconds: number;
	rawUrl: string;
};

const queuedDeepLinks: AppDeepLinkPayload[] = [];
let isMainWindowReadyForDeepLinks = false;

function extractDeepLinkUrlFromArgv(argv: string[]): string | null {
	return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) ?? null;
}

function parseDeepLinkUrl(url: string): AppDeepLinkPayload | null {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;

		const normalizedPathname = parsedUrl.pathname.replace(/\/+$/, '');
		const normalizedRoute = parsedUrl.hostname
			? `/${parsedUrl.hostname}${normalizedPathname}`
			: normalizedPathname;

		if (normalizedRoute !== '/open/reviews') return null;

		const videoId = parsedUrl.searchParams.get('videoId')?.trim();
		if (!videoId) return null;

		const timestampRaw = parsedUrl.searchParams.get('t') ?? parsedUrl.searchParams.get('timestamp') ?? '0';
		const timestampSeconds = Number(timestampRaw);
		if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) return null;

		return {
			tab: 'reviews',
			action: 'open-video',
			videoId,
			timestampSeconds,
			rawUrl: url,
		};
	} catch (error) {
		log.warn('Failed to parse deep link URL', url, error);
		return null;
	}
}

function flushQueuedDeepLinks() {
	if (!mainWindow || !isMainWindowReadyForDeepLinks || queuedDeepLinks.length === 0) return;

	while (queuedDeepLinks.length > 0) {
		const payload = queuedDeepLinks.shift();
		if (!payload) continue;
		log.info('Dispatching deep link payload to renderer', payload);
		mainWindow.webContents.send(IPC_EVENTS.APP_DEEP_LINK_CALLBACK, payload);
	}
}

function ensureMainWindowForDeepLink() {
	if (!app.isReady()) return;

	if (!mainWindow) {
		startProcess();
	}

	if (!mainWindow) return;

	if (!mainWindow.isVisible()) {
		mainWindow.show();
	}

	mainWindow.focus();

	if (process.platform === 'darwin') {
		void app.dock.show();
	}
}

function queueDeepLinkUrl(url: string, source: string) {
	const payload = parseDeepLinkUrl(url);
	if (!payload) {
		log.warn(`Ignoring unsupported deep link from ${source}:`, url);
		return;
	}

	log.info(`Queueing deep link from ${source}:`, payload);
	queuedDeepLinks.push(payload);
	flushQueuedDeepLinks();
}

function registerDeepLinkProtocolClient() {
	if (app.isPackaged) {
		app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
		return;
	}

	if (process.defaultApp) {
		const entryPoint = process.argv[1];
		if (entryPoint) {
			app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(entryPoint)]);
			return;
		}
	}

	app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

function beginSystemShutdown(source: string) {
	if (shutdownInProgress) return;
	shutdownInProgress = true;

	isSystemShutdown = true;
	isQuiting = true;
	forceClose = true;

	log.info(`System shutdown requested from ${source}`);

	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		updatedRecheckTimer = null;
	}

	try {
		if (socket.connected) {
			socket.disconnect();
		}
	} catch (error) {
		log.warn('Failed to disconnect socket during shutdown', error);
	}

	void obsService.dispose();

	try {
		tray?.destroy();
		tray = null;
	} catch (error) {
		log.warn('Failed to destroy tray during shutdown', error);
	}

	socket.disconnect();
	mainWindow?.close();
	app.quit();
}

async function startProcess() {
	if (!app.isReady() || mainWindow) return;
	createWindow();
	autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
		log.info('Update check results:', UpdateCheckResults);
	});
	backupService.InitiateBackup(false);
}

let forceClose = false;
function shouldAppClose(): boolean {
	if (isSystemShutdown) {
		return true;
	}

	if (backupService.IsBackupInProgress() && !forceClose) {
		const dialogOpts = {
			buttons: ['Okay', 'Force Close'],
			title: 'Rak Gaming Updater',
			message: `Backup in process`,
			detail: `Backup is currently running. Please wait until it finishes.`,
			noLink: true,
			modal: true,
			parent: mainWindow,
		} as Electron.MessageBoxOptions;

		queueDialog(dialogOpts, ({ response }) => {
			if (response === 1) {
				log.info('Forcing close of the app');
				forceClose = true;
				app.quit();
			} else {
				isQuiting = false;
				log.info('User chose to wait for backup to finish');
			}
		});
		mainWindow?.show();
		return false;
	}

	return true; // if true then app should close
}

async function createWindow() {
	updateLoginItems();
	isMainWindowReadyForDeepLinks = false;

	const startMinimized = process.argv.includes('--hidden') && store.get('startMinimized');
	log.info('Creating window', { startMinimized });
	const windowSettings = getStoredWindowSettings();
	const initialBounds = getSafeInitialWindowBounds(windowSettings);
	mainWindow = new BrowserWindow({
		x: initialBounds.x,
		y: initialBounds.y,
		width: initialBounds.width,
		height: initialBounds.height,
		minWidth: 900,
		minHeight: 600,
		icon: taskBarIconImage,
		minimizable: true,
		resizable: true,
		fullscreenable: true,
		frame: false,
		backgroundColor: '#00000000',
		titleBarStyle: 'hidden',
		webPreferences: {
			preload: preload,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			partition: 'persist:youtube', // keeps cookies / sessions stable
		},
		skipTaskbar: startMinimized,
		show: !startMinimized,
	});

	mainWindow.on('enter-full-screen', () => {
		if (mainWindow) onYouTubePlayerFullscreenChanged(mainWindow, true);
	});
	mainWindow.on('leave-full-screen', () => {
		if (mainWindow) onYouTubePlayerFullscreenChanged(mainWindow, false);
	});
	mainWindow.on('minimize', () => {
		if ((desiredYouTubePlayerFullscreen || isYouTubePlayerFullscreen) && mainWindow) {
			void setYouTubePlayerFullscreen(mainWindow, false);
		}
	});
	mainWindow.on('hide', () => {
		if ((desiredYouTubePlayerFullscreen || isYouTubePlayerFullscreen) && mainWindow) {
			void setYouTubePlayerFullscreen(mainWindow, false);
		}
	});

	const sess = mainWindow.webContents.session;

	// fix no referer for youtube embeds
	const filter = { urls: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*", "*://*.googlevideo.com/*"] };
	sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
		// log.info('yt embed url:', details.url);

		details.requestHeaders['Referer'] = 'file:///'; // or 'https://example.com'

		callback({ requestHeaders: details.requestHeaders });
	});

	if (windowSettings?.maximized) {
		mainWindow?.maximize();
	}

	mainWindowWrapper.init(mainWindow);

	mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https:')) {
			void shell.openExternal(url);
		}
		return { action: 'deny' };
	});

	mainWindow?.once('ready-to-show', () => {
		log.info(`Ready to show. Start args: ${process.argv.join(' ')}`);

		log.debug('AUTH TOKEN:', store.get('authToken') ? 'SET' : 'NOT SET');
		// mainWindow?.webContents.openDevTools({ mode: "detach" });
	});

	mainWindow?.webContents.once('did-finish-load', () => {
		log.info('Renderer finished loading; deep links can now be dispatched');
		isMainWindowReadyForDeepLinks = true;
		mainWindow?.webContents.send(IPC_EVENTS.OBS_STATUS_UPDATED, obsService.getStatus());
		flushQueuedDeepLinks();
	});

	mainWindow?.setMenu(null);

	if (isDev) {
		log.info('Running in development mode');
		mainWindow.loadURL('http://localhost:5173/');
		mainWindow.webContents.openDevTools({ mode: 'detach' }); // Open the DevTools.
	} else {
		log.info(`Loading File: ${html}`);
		mainWindow?.loadFile(html);
	}

	mainWindow?.on('closed', () => {
		if (youtubeFullscreenTransition) {
			clearTimeout(youtubeFullscreenTransition.timeout);
			youtubeFullscreenTransition.resolve(false);
			youtubeFullscreenTransition = null;
		}
		mainWindow = null;
		isYouTubePlayerFullscreen = false;
		desiredYouTubePlayerFullscreen = false;
		youtubePlayerPointerBounds = null;
		isMainWindowReadyForDeepLinks = false;
	});

	tray = new Tray(taskBarIconImage);
	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show', click: () => mainWindow?.show() },
		{
			label: 'Quit',
			click: () => {
				isQuiting = true;
				if (shouldAppClose()) {
					app.quit();
				}
			},
		},
	]);
	tray?.setToolTip('Rak Gaming Updater');
	tray?.setContextMenu(contextMenu);
	tray?.setIgnoreDoubleClickEvents(true);

	tray?.on('right-click', () => tray?.popUpContextMenu(contextMenu));
	tray?.on('click', () => {
		if (mainWindow?.isVisible()) {
			mainWindow?.hide();

			if (process.platform === 'darwin') {
				app.dock.hide();
			}
		} else {
			mainWindow?.show();

			if (process.platform === 'darwin') {
				void app.dock.show();
			}
		}
	});

	mainWindow?.webContents.on('will-navigate', (event) => {
		// if (mainWindow?.webContents.getURL() !== winURL) {
		event.preventDefault();
		// }
	});

	mainWindow?.on('show', () => {
		mainWindow?.setSkipTaskbar(false);

		if (queuedDialogs.length > 0) {
			queuedDialogs.forEach(({ dialogOptions, onSuccessCallback }) => {
				if (onSuccessCallback) {
					dialog.showMessageBox(mainWindow as BrowserWindow, dialogOptions).then(onSuccessCallback);
				}
			});
			// wipe the queue
			queuedDialogs.length = 0; // Clear the queue
		}
	});

	mainWindow?.on('unmaximize', () => {
		mainWindow?.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, false);
		if (mainWindow) {
			persistWindowSettings(mainWindow);
		}
	});

	mainWindow?.on('maximize', () => {
		mainWindow?.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, true);
		if (mainWindow) {
			persistWindowSettings(mainWindow);
		}
	});

	mainWindow?.on('resized', () => {
		if (!mainWindow) return;
		persistWindowSettingsDebounced(mainWindow);
	});

	mainWindow?.on('moved', () => {
		if (!mainWindow) return;
		persistWindowSettingsDebounced(mainWindow);
	});

	mainWindow?.on('move', () => {
		if (!mainWindow) return;
		persistWindowSettingsDebounced(mainWindow);
	});

	mainWindow?.on('close', async (event: Electron.Event) => {
		if (mainWindow) {
			persistWindowSettings(mainWindow);
		}

		if (!isQuiting && !isSystemShutdown && !store.get('quitOnClose')) {
			event.preventDefault();
			mainWindow?.hide();
			return;
		}

		if (!shouldAppClose()) {
			event.preventDefault();
		}
	});

	mainWindow?.on('query-session-end', () => {
		beginSystemShutdown('query-session-end');
	});

	mainWindow?.on('session-end', () => {
		beginSystemShutdown('session-end');
	});

	timelineWindowController.bindMainWindowLifecycle(mainWindow);
}

if (!app.requestSingleInstanceLock()) {
	log.info('Second instance detected, quitting');
	app.quit();
} else {
	app.on('second-instance', (event, argv) => {
		log.info('Second instance started');
		ensureMainWindowForDeepLink();

		const deepLinkUrl = extractDeepLinkUrlFromArgv(argv);
		if (deepLinkUrl) {
			queueDeepLinkUrl(deepLinkUrl, 'second-instance');
		}
	});

	app.whenReady().then(() => {
		log.info('App is ready');
		(powerMonitor as any).on('shutdown', (event: Electron.Event) => {
			log.info('Power monitor reported system shutdown');
			event.preventDefault();
			beginSystemShutdown('powerMonitor-shutdown');
		});

		startProcess();

		const initialDeepLinkUrl = extractDeepLinkUrlFromArgv(process.argv);
		if (initialDeepLinkUrl) {
			queueDeepLinkUrl(initialDeepLinkUrl, 'startup');
		}
	});
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('before-quit', () => {
	isQuiting = true;
	timelineWindowController.destroyForQuit();
	if (isSystemShutdown) {
		forceClose = true;
	}
});

app.on('will-quit', (event) => {
	if (isQuiting) {
		socket.disconnect();
	}
	void obsService.dispose();
});

app.on('activate', () => {
	if (mainWindow === null) {
		createWindow();

		if (process.platform === 'darwin') {
			void app.dock.show();
		}
	}
});

// important for notifications on Windows
app.setAppUserModelId('com.rak-gaming-updater');
registerDeepLinkProtocolClient();

function isYouTubePlayerFrameUrl(frameUrl?: string): boolean {
	if (!frameUrl) return false;

	try {
		const hostname = new URL(frameUrl).hostname.toLowerCase();
		return hostname === 'youtube.com'
			|| hostname.endsWith('.youtube.com')
			|| hostname === 'youtube-nocookie.com'
			|| hostname.endsWith('.youtube-nocookie.com');
	} catch {
		return false;
	}
}

// Protocol handler for macOS
app.on('open-url', (event, url) => {
	event.preventDefault();
	ensureMainWindowForDeepLink();
	queueDeepLinkUrl(url, 'open-url');
});

// Ctrl+Shift+I to open devTools, Ctrl+Shift+R to reload
app.on('web-contents-created', (webContentsCreatedEvent, webContents) => {
	webContents.on('before-input-event', (beforeInputEvent, input) => {
		const { code, key, alt, control, shift, meta, type, isAutoRepeat } = input;

		// Shortcut: toggle devTools
		if (shift && control && !alt && !meta && code === 'KeyI') {
			mainWindow?.webContents.openDevTools({ mode: 'detach' });
		}

		if (webContents !== mainWindow?.webContents || type !== 'keyDown') return;

		if (code === 'Escape' && (desiredYouTubePlayerFullscreen || isYouTubePlayerFullscreen)) {
			beforeInputEvent.preventDefault();
			void setYouTubePlayerFullscreen(mainWindow, false);
			return;
		}

		const isArrowSeekHotkey = code === 'ArrowLeft' || code === 'ArrowRight';
		const hasModifier = alt || control || shift || meta;
		const isUnmodifiedPlayerHotkey = !hasModifier && (
			code === 'Space'
			|| code === 'KeyK'
			|| code === 'KeyJ'
			|| code === 'KeyL'
			|| code === 'KeyM'
			|| code === 'KeyF'
			|| code === 'Comma'
			|| code === 'Period'
		);
		const isPlayerHotkey = isArrowSeekHotkey || isUnmodifiedPlayerHotkey;

		const isYouTubePlayerFocused = isYouTubePlayerFrameUrl(webContents.focusedFrame?.url);
		if (isPlayerHotkey && isYouTubePlayerFocused) {
			// The focused cross-origin iframe does not bubble its keyboard event to the
			// renderer. Cancel YouTube's copy and forward exactly one app-owned shortcut.
			beforeInputEvent.preventDefault();
			mainWindow?.webContents.send(IPC_EVENTS.YOUTUBE_PLAYER_HOTKEY_CALLBACK, {
				key,
				code,
				altKey: alt,
				ctrlKey: control,
				metaKey: meta,
				repeat: isAutoRepeat,
				shiftKey: shift,
			});
		}

		// Shortcut: window reload
		// if (shift && control && !alt && !meta && code === "KeyR") {
		//   mainWindow.reload();
		// }
	});

	webContents.on('before-mouse-event', (beforeMouseEvent, mouse) => {
		if (webContents !== mainWindow?.webContents) return;
		if (mouse.type === 'mouseMove') {
			const bounds = youtubePlayerPointerBounds;
			if (!bounds
				|| mouse.x < bounds.left
				|| mouse.x > bounds.right
				|| mouse.y < bounds.top
				|| mouse.y > bounds.bottom) return;
			const now = Date.now();
			if (now - lastYouTubePlayerPointerActivityAt >= 50) {
				lastYouTubePlayerPointerActivityAt = now;
				mainWindow.webContents.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_ACTIVITY_CALLBACK);
			}
			return;
		}
		if (mouse.type === 'mouseDown') {
			pendingYouTubePlayerDoubleClick = false;
			if (mouse.button !== 'left' || mouse.clickCount !== 2) return;
			if (!isYouTubePlayerFrameUrl(webContents.focusedFrame?.url)) return;

			// Suppress YouTube's second press, but wait for its matching release before
			// resizing the BrowserWindow. Resizing mid-click can retarget the release to
			// one of the app controls after they move into their fullscreen positions.
			pendingYouTubePlayerDoubleClick = true;
			beforeMouseEvent.preventDefault();
			return;
		}

		if (mouse.type !== 'mouseUp' || !pendingYouTubePlayerDoubleClick) return;
		pendingYouTubePlayerDoubleClick = false;
		if (mouse.button !== 'left') return;

		beforeMouseEvent.preventDefault();
		mainWindow.webContents.send(IPC_EVENTS.YOUTUBE_PLAYER_DOUBLE_CLICK_CALLBACK, {
			clickCount: 2,
		});
	});
});

// Auto-updater events
autoUpdater.on('update-available', (info) => {
	log.info(`Update available Version: ${info.version} Release Date: ${info.releaseDate}`);
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}

	if (lastQueuedUpdateVersion === info.version) {
		log.info(`Update dialog for version ${info.version} was already queued; skipping duplicate`);
		return;
	}

	// Record the version before queueing so concurrent update checks cannot add
	// another dialog for the same release while the window is hidden.
	lastQueuedUpdateVersion = info.version;

	new Notification({
		title: 'Update available',
		body: `Rak Gaming Updater ${info.version} is available.`,
		icon: notificationIconImage,
	}).show();

	const dialogOpts = {
		buttons: ['Update', 'Later'],
		title: 'Rak Gaming Updater',
		message: info.releaseName || 'Update Available',
		detail: `A new version ${info.version} is available. Do you want to update now?`,
		noLink: true,
		modal: true,
		parent: mainWindow,
	} as Electron.MessageBoxOptions;

	queueDialog(dialogOpts, ({ response }) => {
		if (response === 0) {
			startAppUpdateDownload(info.version);
		}
	});
});

autoUpdater.on('update-not-available', () => {
	log.info('Application is up to date');
});

autoUpdater.on('error', (err) => {
	log.info('Error in auto-updater. ' + err);
	failAppUpdateDownload(err);
});

autoUpdater.on('download-progress', (progress) => {
	if (appUpdateDownloadState?.status !== 'downloading') return;

	// Convert bytes per second to megabytes per second and format to 2 decimal places
	const speedInMbps = (progress.bytesPerSecond / (1024 * 1024)).toFixed(2);
	// Convert transferred and total bytes to megabytes and format to 2 decimal places
	const transferredInMB = (progress.transferred / (1024 * 1024)).toFixed(2);
	const totalInMB = (progress.total / (1024 * 1024)).toFixed(2);
	// Format the percent to 2 decimal places
	const percentFormatted = progress.percent.toFixed(2);

	log.info(`Download speed: ${speedInMbps} MB/s - Downloaded ${percentFormatted}% (${transferredInMB}/${totalInMB} MB)`);
	const percent = Math.min(100, Math.max(0, Number.isFinite(progress.percent) ? progress.percent : 0));
	publishAppUpdateDownloadState({
		status: 'downloading',
		version: appUpdateDownloadState?.version || '',
		percent,
		bytesPerSecond: progress.bytesPerSecond,
		transferred: progress.transferred,
		total: progress.total,
	});
	mainWindow?.setProgressBar(percent / 100);
});

let updatePending = false
autoUpdater.on('update-downloaded', () => {
	mainWindow?.setProgressBar(-1);
	publishAppUpdateDownloadState({
		status: 'downloaded',
		version: appUpdateDownloadState?.version || '',
		percent: 100,
		bytesPerSecond: 0,
		transferred: appUpdateDownloadState?.total || appUpdateDownloadState?.transferred || 0,
		total: appUpdateDownloadState?.total || 0,
	});

	updatePending = true;

	CheckPendingAppUpdate()
});

function CheckPendingAppUpdate() {
	if (updatePending && !backupService.IsBackupInProgress()) {
		log.info('Update downloaded; will install in 5 seconds');
		setTimeout(() => {
			// Shenanigans to make sure the app closes properly
			isQuiting = true;
			mainWindow?.close();
			autoUpdater.quitAndInstall(true, true);
			setTimeout(() => {
				app.quit();
			}, 1000);
		}, 5000);
	}
}

function sanitizeInput(input: string): string {
	let res = validator.escape(input);
	res = res.trim();
	return res;
}

ipcMain.handle(IPC_EVENTS.UPDATER_GET_WOW_PATH, async () => {
	return await getWoWPath();
});

async function onFilePathSelected(folderPath: string) {
	const relativePath = store.get('relativePath');
	log.info('Selected path:', folderPath, 'relative path:', relativePath);
	if (!relativePath) {
		log.info('Relative path not set, skipping');
		return;
	}

	if (folderPath) {
		const fileData = await GetFileData(folderPath, relativePath);
		const stats = await fsp.stat(folderPath);

		if (stats.isDirectory()) {
			compressAndSend(folderPath, fileData);
		} else if (stats.isFile()) {
			const fileExtension = path.extname(folderPath);
			log.info('File extension:', fileExtension);

			if (fileExtension === '.zip') {
				// Send the .zip file directly
				await sendFile(folderPath, fileData);
			} else {
				// normal file
				compressAndSend(folderPath, fileData);
			}
		}
	} else {
		log.info('No path selected');
	}
}

ipcMain.handle(IPC_EVENTS.LOGIN_CHECK, async () => {
	const token = store.get('authToken');
	log.info('Checking for login:', token ? 'token present' : 'no token');
	if (token) {
		try {
			const decoded = jwtDecode(token) as { username: string; role: string };
			return { username: decoded.username, role: decoded.role };
		} catch (error) {
			console.error('Error decoding token:', error);
			return null;
		}
	}
	return null;
});

ipcMain.handle(IPC_EVENTS.OBS_SETTINGS_GET, async () => {
	return {
		settings: getObsSettingsFromStore(),
		status: obsService.getStatus(),
	};
});

ipcMain.handle(IPC_EVENTS.OBS_SETTINGS_SET, async (event, nextSettings: Partial<ObsServiceSettings>) => {
	const currentSettings = getObsSettingsFromStore();
	const normalizedSettings: ObsServiceSettings = {
		enabled: typeof nextSettings.enabled === 'boolean' ? nextSettings.enabled : currentSettings.enabled,
		port: Number.isFinite(Number(nextSettings.port)) ? Math.max(1, Math.min(65535, Number(nextSettings.port))) : currentSettings.port,
		password: typeof nextSettings.password === 'string' ? nextSettings.password : currentSettings.password,
	};

	store.set('obsEnabled', normalizedSettings.enabled);
	store.set('obsPort', normalizedSettings.port);
	store.set('obsPassword', normalizedSettings.password);

	await obsService.updateSettings(normalizedSettings);

	return {
		success: true,
		settings: normalizedSettings,
		status: obsService.getStatus(),
	};
});

ipcMain.handle(IPC_EVENTS.OBS_RECONNECT, async () => {
	await obsService.reconnectNow();
	return {
		success: true,
		status: obsService.getStatus(),
	};
});

ipcMain.handle(IPC_EVENTS.APP_GET_VERSION, () => {
	return {
		version: app.getVersion(),
		releaseType: app.isPackaged ? 'release' : 'development',
	};
});

ipcMain.handle(IPC_EVENTS.APP_GET_LANGUAGE, async () => {
	const storedLanguage = store.get('locale');
	if (storedLanguage) {
		log.info('Stored language found:', storedLanguage);
		return storedLanguage;
	}

	let language = 'en'
	const availableLocales = ['en', 'ru', 'ko', 'uk'];
	const preferredLanguages: string[] = app.getPreferredSystemLanguages();
	for (const lang of preferredLanguages) {
		const processedLang = lang.split('-')[0];
		if (availableLocales.includes(processedLang)) {
			language = processedLang;
			break;
		}
	}

	log.info(`Most preffered locale: ${language}`)
	return language;
});

ipcMain.on(IPC_EVENTS.WINDOW_MINIMIZE, (event) => {
	BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on(IPC_EVENTS.WINDOW_CLOSE, (event) => {
	const targetWindow = BrowserWindow.fromWebContents(event.sender);
	if (!targetWindow) return;
	if (targetWindow === mainWindow) targetWindow.setSkipTaskbar(true);
	targetWindow.close();
});

ipcMain.on(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE, (event) => {
	const targetWindow = BrowserWindow.fromWebContents(event.sender);
	if (!targetWindow) return;

	if (targetWindow.isMaximized()) {
		targetWindow.unmaximize();
	} else {
		targetWindow.maximize();
	}
});

ipcMain.handle(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET, (event, fullscreen: unknown) => {
	const targetWindow = BrowserWindow.fromWebContents(event.sender);
	if (!targetWindow || typeof fullscreen !== 'boolean') return false;
	return setYouTubePlayerFullscreen(targetWindow, fullscreen);
});

ipcMain.handle(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_STATUS_GET, (event) => {
	return event.sender === mainWindow?.webContents && isYouTubePlayerFullscreen;
});

ipcMain.on(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, (event, bounds: unknown) => {
	if (event.sender !== mainWindow?.webContents) return;
	if (bounds === null) {
		youtubePlayerPointerBounds = null;
		return;
	}
	if (!bounds || typeof bounds !== 'object') return;

	const candidate = bounds as Record<string, unknown>;
	if (!['left', 'top', 'right', 'bottom'].every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))) return;
	const left = candidate.left as number;
	const top = candidate.top as number;
	const right = candidate.right as number;
	const bottom = candidate.bottom as number;
	if (right <= left || bottom <= top) return;
	youtubePlayerPointerBounds = { left, top, right, bottom };
});

ipcMain.handle(IPC_EVENTS.UPDATER_SELECT_WOW_PATH, async () => {
	const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
		properties: ['openDirectory'],
	});
	log.info('Selected path(select-update-path):', result.filePaths);
	if (result.filePaths.length > 0) {
		return validateWoWPath(result.filePaths[0]);
	}
});
ipcMain.handle(IPC_EVENTS.PUSHER_SELECT_RELATIVE_PATH, async () => {
	const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
		properties: ['openDirectory'],
	});
	if (result.filePaths.length > 0) {
		let pathToWow = validateWoWPath(result.filePaths[0]);
		if (!pathToWow) {
			return null;
		}
		let relativePath = path.relative(pathToWow, result.filePaths[0]);
		log.info('Relative path:', relativePath);
		return relativePath;
	}
});

ipcMain.on(IPC_EVENTS.APP_OPEN_LOGS_FOLDER, async () => {
	log.info('Opening logs folder');
	const logsPath = app.getPath('logs')
	if (logsPath) {
		shell.openPath(logsPath);
	}

});

ipcMain.handle(IPC_EVENTS.LOGIN_SEND_CREDENTIALS, async (event, { username, password }) => {
	try {
		const sanitizedUsername = sanitizeInput(username); // Implement sanitizeInput to sanitize user inputs
		const sanitizedPassword = sanitizeInput(password);

		const response = await net.fetch(SERVER_LOGIN_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: sanitizedUsername, password: sanitizedPassword }),
		});

		if (!response.ok) {
			return { success: false, error: `Server responded with status ${response.status}: ${await response.text()}` };
		}

		const data = await response.json();
		if (data.token) {
			store.set('authToken', data.token);
			log.info('Login successful');
			return { success: true, error: null };
		} else {
			log.info('Login failed invalid credentials');
			return { success: false, error: 'invalid credentials' };
		}
	} catch (err: any) {
		log.info('Login error:', err);
		mainWindow?.webContents.send(IPC_EVENTS.SOCKET_CONNECT_ERROR_CALLBACK, err);
		return { success: false, error: `error logging in: ${err.code}` };
	}
});

ipcMain.handle(IPC_EVENTS.UPDATER_SHOULD_DOWNLOAD_FILE, (event, serverFile) => {
	return shouldDownloadFile(serverFile);
});

ipcMain.handle(IPC_EVENTS.UPDATER_FETCH_FILES_LIST, async (event) => {
	return await net
		.fetch(SERVER_EXISTING_FILES_ENDPOINT, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${store.get('authToken')}`,
			},
		})
		.then((response) => response.json())
		.catch((error) => console.error('Error fetching files data:', error));
});

ipcMain.on(IPC_EVENTS.SOCKET_INITIATE_CONNECT, async () => {
	log.info('Connecting to server');
	const token = store.get('authToken');
	const updaterInfo = store.get('updaterInfo') || { byChar: {} };
	socket.auth = {
		token,
		APP_VERSION: app.getVersion(),
		NICKNAME: updaterInfo.MY_NICKNAME || null,
	};
	socket.connect();
});

/*
data = {
	fileName: 'example.zip',
	relativePath: 'path/to/file/inside/wow/folder',
	timestamp: 1633072800,
	hash: 'abc123',
	displayName: 'Example File',
}
*/
ipcMain.on(IPC_EVENTS.UPDATER_DOWNLOAD_FILE, async (event, fileData) => {
	try {
		const zipPath = await fileManagementService.DownloadWithRetries(fileData);
		try {
			await InstallFile(fileData, zipPath);
		} finally {
			log.info('Removing zip file:', zipPath);
			await fsp.rm(zipPath, { recursive: false });
		}
	} catch (error) {
		log.info('Error requesting file:', error);
	}
});

socket.on(SOCKET_EVENTS.SOCKET_CONNECTED, () => {
	autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
		log.info('Update check results:', UpdateCheckResults);
	});
	log.info('Connected to server');
	BrowserWindow.getAllWindows().forEach(window => {
		if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
			window.webContents.send(IPC_EVENTS.SOCKET_CONNECTED_CALLBACK);
		}
	});

	void obsService.updateSettings(getObsSettingsFromStore());

	backupService.InitiateBackup(false);

	const updaterInfo = store.get('updaterInfo');
	// clean old entries
	if (updaterInfo && updaterInfo.byChar) {
		for (const char in updaterInfo.byChar) {
			const charInfo = updaterInfo.byChar[char];
			// .lastUpdate is UNIX time in seconds, delete entries older than 7 days
			if (charInfo.lastUpdate + 7 * 24 * 60 * 60 < Math.floor(Date.now() / 1000)) {
				log.info('Removing old updater entry for character:', char);
				delete updaterInfo.byChar[char];
			}
		}
		store.set('updaterInfo', updaterInfo);
		socket.emit(SOCKET_EVENTS.SV_INFO_UPDATE, updaterInfo)
	}

	const WCL_REFRESH_TOKEN = store.get('WCL_REFRESH_TOKEN');
	if (WCL_REFRESH_TOKEN) {
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_TOKEN_REFRESH, { WCL_REFRESH_TOKEN }, (response: { success: boolean; error?: string }) => {
			if (response.success) {
				log.info('WCL refresh token sent successfully');
			} else {
				log.info('Error sending WCL refresh token:', response.error);
			}
		});
	}
});

socket.on('connect_error', async (error: Error) => {
	// change xhr poll error with server is not avaliable
	if (error.message.includes('xhr poll error')) {
		error = new Error('Server is unavailable.');
	}

	mainWindow?.webContents.send(IPC_EVENTS.SOCKET_CONNECT_ERROR_CALLBACK, error);
	log.error('Connection error:', error.message);
});

socket.on(SOCKET_EVENTS.SOCKET_DISCONNECTED, (reason, details) => {
	log.info('Disconnected from server', reason, details);
	mainWindow?.webContents.send(IPC_EVENTS.SOCKET_DISCONNECTED_CALLBACK, details || reason);
});

socket.on(SOCKET_EVENTS.UPDATER_NEW_FILE, (fileData) => {
	log.info('New file:', fileData);
	mainWindow?.webContents.send(IPC_EVENTS.UPDATER_NEW_FILE_CALLBACK, fileData);
});

socket.on(SOCKET_EVENTS.UPDATER_FILE_NOT_FOUND, (fileData) => {
	mainWindow?.webContents.send(IPC_EVENTS.UPDATER_FILE_NOT_FOUND_CALLBACK, fileData);
});

socket.on(SOCKET_EVENTS.UPDATER_FILE_DELETED, (fileData) => {
	log.info('File deleted:', fileData);
	mainWindow?.webContents.send(IPC_EVENTS.UPDATER_FILE_DELETED_CALLBACK, fileData);
});

ipcMain.on(IPC_EVENTS.PUSHER_FILE_DELETE, (event, fileData) => {
	log.info('Deleting file:', fileData);
	socket.emit(SOCKET_EVENTS.UPDATER_DELETE_FILE, fileData);
});

socket.on(SOCKET_EVENTS.NEW_RELEASE, (data) => {
	log.info('New release:', data);
	rechekTries = 0;
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}
	updatedRecheckTimer = setInterval(() => {
		rechekTries++;
		if (rechekTries > 20) {
			if (updatedRecheckTimer) {
				clearInterval(updatedRecheckTimer);
			}
			log.info('Recheck timer cleared');
			return;
		}
		autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
			log.info('Update check results:', UpdateCheckResults);
		}).catch((error) => {
			log.error('Error checking for updates:', error);
		});
	}, 30 * 1000);
});

socket.on(SOCKET_EVENTS.STATUS_CONNECTED_CLIENTS, (data) => {
	// log.debug('Connected clients:', data);
	mainWindow?.webContents.send(IPC_EVENTS.STATUS_CONNECTED_CLIENTS_CALLBACK, data);
});

ipcMain.on(IPC_EVENTS.STATUS_REQUEST_LOGS, (event, clientId) => {
	log.info('Requesting logs for client:', clientId);
	socket.emit(SOCKET_EVENTS.STATUS_REQUEST_LOGS, { clientId }, async (response: { logData?: {content: string}; error?: string }) => {
		if (response.logData) {
			// save log data to file and open it
			const logFilePath = path.join(TEMP_DIR, `client_${clientId}_logs.txt`);
			await fsp.mkdir(path.dirname(logFilePath), { recursive: true });
			await fsp.writeFile(logFilePath, response.logData.content, 'utf-8');
			log.info('Logs saved to file:', logFilePath);
			shell.openPath(logFilePath);
		} else {
			log.info('Error sending logs request for client:', clientId, response.error);
		}
	});
});

socket.on(SOCKET_EVENTS.GET_LOG, ({requester}) => {
	const logPath = log.transports.file.getFile().path;
	log.info('Received request to send log file:', logPath, 'to requester:', requester);
	fsp.readFile(logPath, 'utf-8')
		.then((data) => {
			socket.emit(SOCKET_EVENTS.SEND_LOG, { content: data });
			log.info('Log file sent:', logPath);
		})
		.catch((error) => {
			log.error('Error reading log file:', error);
		});
});



socket.on(SOCKET_EVENTS.ERROR, (error) => {
	log.error('Socket error:', error);
});

ipcMain.on(IPC_EVENTS.PUSHER_OPEN_FOLDER_DIALOG, async () => {
	log.info('Opening file dialog: open-file-dialog');
	const { canceled, filePaths } = await dialog.showOpenDialog({
		properties: ['openDirectory'],
	});
	if (!canceled && filePaths.length > 0) {
		onFilePathSelected(filePaths[0]);
	}
});

ipcMain.on(IPC_EVENTS.PUSHER_OPEN_FILE_DIALOG, async () => {
	log.info('Opening file dialog: open-file-dialog');
	const { canceled, filePaths } = await dialog.showOpenDialog({
		properties: ['openFile'],
	});
	if (!canceled && filePaths.length > 0) {
		onFilePathSelected(filePaths[0]);
	}
});

socket.on(SOCKET_EVENTS.NOT_ENOUGH_PERMISSIONS, (data) => {
	log.error('Not enough permissions:', data);
	mainWindow?.webContents.send(IPC_EVENTS.SOCKET_NOT_ENOUGH_PERMISSIONS_CALLBACK, data);
});

socket.on(SOCKET_EVENTS.SERVER_SHUTDOWN, (data) => {
	log.info('Server shutdown:', data);
});

async function shouldDownloadFile(serverFile: FileData): Promise<[boolean, string]> {
	const wowPath = await getWoWPath();
	if (!wowPath) {
		return [false, DOWNLOAD_REASON_NO_PATH_SET];
	}

	const localFilePath = path.join(wowPath, serverFile.relativePath, serverFile.fileName.replace(/\.zip$/, ''));
	log.info(`Checking file: ${localFilePath}`);
	// Check if the file exists
	if (!fs.existsSync(localFilePath)) {
		log.info(`File does not exist: ${localFilePath}, should download`);
		return [true, DOWNLOAD_REASON_INSTALL]; // If the file doesn't exist, return true to download it
	}
	const stats = fs.lstatSync(localFilePath);
	if (stats.isSymbolicLink()) {
		log.info(`File is a symbolic link: ${localFilePath}, should download`);
		return [false, DOWNLOAD_REASON_SYMLINK];
	}

	const localFileHash = await CalculateHashForPath(localFilePath);
	log.info(`Local File Hash: ${localFileHash}, Server File Hash: ${serverFile.hash}`);
	const shouldDownload = localFileHash !== serverFile.hash;
	if (shouldDownload) {
		return [shouldDownload, DOWNLOAD_REASON_UPDATE];
	} else {
		return [shouldDownload, DOWNLOAD_REASON_UP_TO_DATE];
	}
}

async function compressAndSend(folderPath: string, fileData: FileData) {
	log.info('Compressing and sending file:', folderPath, 'with data:', fileData);
	const baseName = path.basename(folderPath);
	const outputPath = path.join(TEMP_DIR, baseName + '.zip');

	log.info('Creating output directory if it does not exist:', path.dirname(outputPath));
	await fsp.mkdir(path.dirname(outputPath), { recursive: true });

	try {
		log.info('Compressing:', folderPath, 'to:', outputPath);
		await zipFile(folderPath, outputPath);
		log.info('File compressed and saved:', outputPath);
		// Send the file
		await sendFile(outputPath, fileData);
	} catch (error: any) {
		log.error('Error compressing and sending file:', error);
		return;
	} finally {
		// Clean up the zip file after sending
		await fsp.rm(outputPath, { recursive: true });
	}
}

async function sendFile(filePath: string, fileData: FileData) {
	log.info('Sending file:', filePath, fileData);
	const fileBuffer = await fsp.readFile(filePath);

	const payload = {
		fileData,
		file: fileBuffer.toString('base64'),
	};

	log.info('SERVER_UPLOADS_ENDPOINT:', SERVER_UPLOADS_ENDPOINT);

	const req = net.request({
		url: SERVER_UPLOADS_ENDPOINT,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${store.get('authToken')}`,
		},
	});

	req.on('response', (response) => {
		log.info('Upload response status:', response.statusCode);
		response.on('data', (data) => {
			log.info('Upload response data:', data.toString());
		});
	});

	// Write the JSON payload and end the request
	req.write(JSON.stringify(payload));
	req.end();
	log.info('File sent successfully:', filePath);
}

/*
data = {
	fileName: string,
	relativePath: string,
	timestamp: number,
	hash: string,
	displayName: string,
}

Эталоном даты считаеться дата которая храниться на сервере
Есть 3 кейса отправки даты на сервер
1. Обычный файл
2. Папка
3. Архив

На сервере файл всегда храниться в виде архива, поэтому .zip можно опустить

Примеры:
1. file.lua
	Отправляеться на сервер как file.lua.zip
	{
		fileName: file.lua
		relativePath: _retail_/Interface/Addons/
		timestamp: 1631712000
		hash: 123456
	}

2. MyAddon
	Отправляеться на сервер как MyAddon.zip
	{
		fileName: MyAddon
		relativePath: _retail_/Interface/Addons/
		timestamp: 1631712000
		hash: 123456
	}

3. MyAddon.zip
	Отправкляеться на сервер как MyAddon.zip
	{
		fileName: MyAddon
		relativePath: _retail_/Interface/Addons/
		timestamp: 1631712000
		hash: 123456
	}
	Перед отправкой разархивируеться для определения имени файла и хеша
	Имя файла соотвествует имени первого файла/папки? в архиве

*/


RegisterSVCallback('ExRT_Reminder', 'RGDB', (svPath, RGDB) => {
	log.info('SV callback for ExRT_Reminder');
	// Handle the changed SV file

	const updaterInfo = store.get('updaterInfo') || { byChar: {} };
	updaterInfo.byChar = updaterInfo.byChar || {};

	// RGDB.UpdaterInfo
	if (RGDB && RGDB.UpdaterInfo && RGDB.UpdaterInfo.byChar) {
		for (const charName in RGDB.UpdaterInfo.byChar) {
			if (!RGDB.UpdaterInfo.byChar.hasOwnProperty(charName)) continue;
			const charInfo = RGDB.UpdaterInfo.byChar[charName];

			// Validate charInfo structure
			if (
				!charInfo ||
				typeof charInfo.lastUpdate !== 'number' ||
				typeof charInfo.currencies !== 'object' ||
				typeof charInfo.lastAddonVersion !== 'number'
			) {
				log.info(`Invalid character info for ${charName}:`, charInfo);
				continue;
			}

			const prevInfo = updaterInfo.byChar[charName];
			if (!prevInfo || prevInfo.lastUpdate < charInfo.lastUpdate) {
				updaterInfo.byChar[charName] = charInfo;
			}
		}

		updaterInfo.MY_NICKNAME = RGDB.UpdaterInfo.MY_NICKNAME || updaterInfo.MY_NICKNAME;
		updaterInfo.LAST_RELOAD = RGDB.UpdaterInfo.LAST_RELOAD || updaterInfo.LAST_RELOAD;
		updaterInfo.APP_VERSION = app.getVersion();
	}

	store.set('updaterInfo', updaterInfo)

	if (!socket.connected) {
		log.info('Socket is not connected, skipping SV file change handling');
		return;
	}
	socket.emit('sv-updater-info', updaterInfo);
});

async function requestWCLAuthLink() {
	return new Promise<string>((resolve, reject) => {
		console.log('Requesting WCL auth link');
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_AUTH_LINK, null, (response: { authLink: string; error?: string }) => {
			if (response.error) {
				reject(new Error(response.error));
			} else {
				console.log('WCL Auth Link:', response.authLink);
				resolve(response.authLink);
			}
		});
		setTimeout(() => {
			reject(new Error('Timeout waiting for WCL auth link'));
		}, 15000);
	});
}

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_AUTH_LINK, async () => {
	try {
		const link = await requestWCLAuthLink();
		// follow link in default browser
		void shell.openExternal(link);
		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle(IPC_EVENTS.WCL_AUTH_STATUS_GET, () => {
	return Boolean(store.get('WCL_REFRESH_TOKEN'));
});

socket.on(SOCKET_EVENTS.WCL_REFRESH_TOKEN_UPDATE, (data) => {
	// log.info('Received WCL refresh token:', data);
	store.set('WCL_REFRESH_TOKEN', data);
	mainWindow?.webContents.send(IPC_EVENTS.WCL_AUTH_STATUS_UPDATED, Boolean(data));
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_REPORTS_LIST, async (event, { endTime }) => {
	return new Promise<any[]>((resolve) => {
		log.info(`Requesting WCL reports list, endTime: ${endTime}`);
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_REPORTS_LIST, { endTime }, (response: { reports: any[]; error?: string }) => {
			if (response.reports) {
				log.info('Received reports list, count:', response.reports.length);
				resolve(response.reports);
			} else {
				log.error('Error receiving reports list:', response.error);
				resolve([]);
			}
		});
		setTimeout(() => {
			resolve([]);
		}, 15000);
	});
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_REPORT_DATA, async (event, { reportCode }) => {
	// Handle the request for WCL fight details
	return new Promise<any[]>((resolve) => {
		log.info('Requesting WCL fight details for report', reportCode);
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_REPORT_DATA, { reportCode }, (response: { reportData: any; error?: string }) => {
			if (response.reportData) {
				log.info('Received fight details for report', reportCode);
				resolve(response.reportData);
			} else {
				log.error('Error receiving fight details for report', reportCode, response.error);
				resolve([]);
			}
		});
		setTimeout(() => {
			resolve([]);
		}, 15000);
	});
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_FIGHT_EVENTS, async (event, { reportCode, fightID, encounterID }) => {
	return new Promise<reviewFightEventsResponse>((resolve) => {
		log.info('Requesting WCL fight events for report', reportCode, 'fightID', fightID);
		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			resolve({ error: 'Timed out while requesting fight events' });
		}, 15000);

		socket.emit(SOCKET_EVENTS.WCL_REQUEST_FIGHT_EVENTS, { reportCode, fightID, encounterID }, (response?: reviewFightEventsResponse) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);

			if (Array.isArray(response?.fightEvents)) {
				log.info('Received fight events for report', reportCode, 'fightID', fightID);
				resolve({ fightEvents: response.fightEvents });
			} else {
				log.error('Error receiving fight events for report', reportCode, response?.error);
				resolve({ error: response?.error || 'Failed to receive fight events' });
			}
		});
	});
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_FIGHT_COOLDOWNS, async (event, { reportCode, fightID }) => {
	return new Promise<reviewFightCooldownResponse>((resolve) => {
		log.info('Requesting WCL fight cooldowns for report', reportCode, 'fightID', fightID);

		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			resolve({ error: 'Timed out while requesting fight cooldowns' });
		}, 15000);

		socket.emit(
			SOCKET_EVENTS.WCL_REQUEST_FIGHT_COOLDOWNS,
			{ reportCode, fightID },
			(response?: reviewFightCooldownResponse) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);

				if (Array.isArray(response?.fightCooldownEvents)) {
					log.info(
						'Received fight cooldowns for report',
						reportCode,
						'fightID',
						fightID,
						'count',
						response.fightCooldownEvents.length,
					);
					resolve(response);
					return;
				}

				log.error('Error receiving fight cooldowns for report', reportCode, response?.error);
				resolve({ error: response?.error || 'Failed to receive fight cooldowns' });
			},
		);
	});
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_FIGHT_BOSS_CASTS, async (
	_event,
	payload?: { reportCode?: unknown; fightID?: unknown; encounterID?: unknown },
) => {
	const { reportCode, fightID, encounterID } = payload || {};
	if (
		typeof reportCode !== 'string'
		|| reportCode.trim().length === 0
		|| typeof fightID !== 'number'
		|| !Number.isSafeInteger(fightID)
		|| fightID <= 0
		|| (encounterID != null && (
			typeof encounterID !== 'number'
			|| !Number.isSafeInteger(encounterID)
			|| encounterID <= 0
		))
	) {
		return { error: 'Invalid report code, fight ID, or encounter ID' } satisfies reviewFightBossCastResponse;
	}
	const normalizedReportCode = reportCode.trim();

	return new Promise<reviewFightBossCastResponse>((resolve) => {
		log.info('Requesting WCL fight boss casts for report', normalizedReportCode, 'fightID', fightID);
		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			resolve({ error: 'Timed out while requesting fight boss casts' });
		}, 30_000);

		socket.emit(
			SOCKET_EVENTS.WCL_REQUEST_FIGHT_BOSS_CASTS,
			{
				reportCode: normalizedReportCode,
				fightID,
				...(typeof encounterID === 'number' ? { encounterID } : {}),
			},
			(response?: reviewFightBossCastResponse) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (
					response?.bossCastData
					&& Array.isArray(response.bossCastData.abilities)
					&& Array.isArray(response.bossCastData.bossCastEvents)
				) {
					log.info(
						'Received fight boss casts for report',
						normalizedReportCode,
						'fightID',
						fightID,
						'count',
						response.bossCastData.bossCastEvents.length,
					);
					resolve(response);
					return;
				}
				log.error('Error receiving fight boss casts for report', normalizedReportCode, response?.error);
				resolve({ error: response?.error || 'Failed to receive fight boss casts' });
			},
		);
	});
});

ipcMain.on(IPC_EVENTS.WCL_OPEN_FIGHT, async (
	_event,
	payload?: { reportCode?: unknown; fightID?: unknown },
) => {
	const { reportCode, fightID } = payload || {};
	if (
		typeof reportCode !== 'string'
		|| reportCode.length === 0
		|| typeof fightID !== 'number'
		|| !Number.isSafeInteger(fightID)
		|| fightID <= 0
	) {
		log.warn('Refusing to open invalid WCL fight link', { reportCode, fightID });
		return;
	}

	const url = `https://www.warcraftlogs.com/reports/${encodeURIComponent(reportCode)}?fight=${fightID}`;
	log.info('Opening WCL fight link:', url);
	void shell.openExternal(url);
});

ipcMain.on(IPC_EVENTS.WCL_OPEN_DEATH, async (event, { reportCode, fightID, deathID }) => {
	// open in default browser
	// https://www.warcraftlogs.com/reports/xmHw1b8M4aqVtzyv?fight=32&type=deaths&death=1
	const url = `https://www.warcraftlogs.com/reports/${reportCode}?fight=${fightID}&type=deaths&death=${deathID}`;
	log.info('Opening WCL death link:', url);
	void shell.openExternal(url);
});

ipcMain.on(IPC_EVENTS.YOUTUBE_OPEN_LINK, async (event, videoId: unknown, timestampSeconds?: unknown) => {
	if (typeof videoId !== 'string' || !videoId) return;
	const url = new URL('https://www.youtube.com/watch');
	url.searchParams.set('v', videoId);
	if (typeof timestampSeconds === 'number' && Number.isFinite(timestampSeconds) && timestampSeconds > 0) {
		url.searchParams.set('t', `${Math.floor(timestampSeconds)}s`);
	}
	log.info('Opening YouTube link:', url.toString());
	void shell.openExternal(url.toString());
});

socket.on(SOCKET_EVENTS.YOUTUBE_VIDEO_INFO_UPDATED, () => {
	mainWindow?.webContents.send(IPC_EVENTS.YOUTUBE_VIDEO_INFO_UPDATED);
});

ipcMain.handle(IPC_EVENTS.YOUTUBE_VIDEO_INFO_GET, async (event) => {
	return await new Promise((resolve) => {
		socket.emit(SOCKET_EVENTS.YOUTUBE_VIDEO_INFO_GET, null, (response: { youtubeVideoInfo: any; }) => {
			if (response.youtubeVideoInfo) {
				resolve(response.youtubeVideoInfo);
			} else {
				resolve(null);
			}
		});
	});
});

ipcMain.handle(IPC_EVENTS.YOUTUBE_VIDEO_INFO_ADD, async (event, URL) => {
	return new Promise((resolve) => {
		console.log('Requesting YouTube video info for URL:', URL);
		socket.emit(SOCKET_EVENTS.YOUTUBE_VIDEO_INFO_ADD, { URL }, (response: { success: any; error?: string }) => {
			if (response.success) {
				log.info('Youtube video info added for URL:', URL);
			}
			resolve(response);
		});
	});
});


ipcMain.on(IPC_EVENTS.YOUTUBE_VIDEO_REFRESH, async (event, videoId) => {
	refreshYoutubeVideoInfo(videoId);
});

ipcMain.on(IPC_EVENTS.YOUTUBE_VIDEO_DELETE, async (event, videoId) => {
	deleteYoutubeVideoInfo(videoId);
});

function refreshYoutubeVideoInfo(videoId: string) { // todo
	log.info('Refreshing Youtube video info for videoId:', videoId);
	socket.emit(SOCKET_EVENTS.YOUTUBE_VIDEO_REFRESH, { videoId }, (response: { videoInfo: any; error?: string }) => {
		log.info('Youtube video info refresh response for videoId:', videoId, response);
		if (response.videoInfo) {
			log.info('Youtube video info refreshed for videoId:', videoId);
		} else {
			log.error('Error refreshing Youtube video info for videoId:', videoId, response.error);
		}
	});

}

function deleteYoutubeVideoInfo(videoId: string) { // todo
	socket.emit(SOCKET_EVENTS.YOUTUBE_VIDEO_DELETE, { videoId }, (response: { success: any; error?: string }) => {
		if (response.success) {
			log.info('Youtube video info deleted for videoId:', videoId);
		} else {
			log.error('Error deleting Youtube video info for videoId:', videoId, response.error);
		}
	});
}
