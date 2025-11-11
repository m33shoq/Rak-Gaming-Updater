import 'dotenv/config';

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, shell, Notification, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log/main';
import Socket from 'socket.io-client';
import { jwtDecode } from 'jwt-decode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import validator from 'validator';
import { fileURLToPath } from "node:url";
import { GetFileData, CalculateHashForPath } from '@/main/fileDataUtility';
import { zipFile, unzipFile } from '@/main/zipHandler';
import { DownloadWithRetries, InstallFile } from '@/main/fileManagement';
import { getWoWPath, validateWoWPath } from '@/main/wowPathUtility';
import mainWindowWrapper from '@/main/MainWindowWrapper';
import store from '@/main/store';
import { RegisterSVCallback } from '@/main/svWatcher';
import BackupService from '@/main/backupService';


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

import { IPC_EVENTS, SOCKET_EVENTS } from '@/events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

log.transports.file.level = 'info';
log.initialize({ preload: true });

process.on("uncaughtException", (error) => {
  log.error("uncaughtException", error);
  mainWindow?.webContents.send(IPC_EVENTS.APP_UNCAUGHT_EXCEPTION_CALLBACK, error);
});

process.on("unhandledRejection", (error) => {
  log.error("unhandledRejection", error);
  mainWindow?.webContents.send(IPC_EVENTS.APP_UNHANDLED_REJECTION_CALLBACK, error);
});

let isQuiting = false;

const TEMP_DIR = path.join(app.getPath('temp'), app.getName()); // Temporary directory for unzipped/zipped files

const socket = Socket(SERVER_URL, { autoConnect: false });
const backupService = new BackupService(socket);

const isDev = process.env.npm_lifecycle_event === 'app:dev' ? true : false;
if (isDev) {
	// store.delete('authToken'); // Clear auth token on startup for testing
}

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

const preload = path.join(__dirname, 'preload.mjs');
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

	const startMinimized = process.argv.includes('--hidden') && store.get('startMinimized');
	log.info('Creating window', { startMinimized });
	const windowSettings = store.get('windowSettings');
	mainWindow = new BrowserWindow({
		width: windowSettings?.width || 900,
		height: windowSettings?.height || 600,
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
			nodeIntegration: true,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			partition: 'persist:youtube', // keeps cookies / sessions stable
		},
		skipTaskbar: startMinimized,
		show: !startMinimized,
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

		log.debug('AUTH TOKEN:', store.get('authToken'));
		// mainWindow?.webContents.openDevTools({ mode: "detach" });
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

	mainWindow?.on('closed', () => (mainWindow = null));

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

	// @ts-ignore
	mainWindow?.on('minimize', (event: Electron.Event) => {
		mainWindow?.setSkipTaskbar(true);
		event.preventDefault();
		mainWindow?.hide();
	});

	// @ts-ignore
	mainWindow?.on('unmaximize', (event: Electron.Event) => {
		mainWindow?.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, false);

		const windowSettings = store.get('windowSettings');
		windowSettings.maximized = false;
		store.set('windowSettings', windowSettings);
	});

	// @ts-ignore
	mainWindow?.on('maximize', (event: Electron.Event) => {
		mainWindow?.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, true);
		const windowSettings = store.get('windowSettings');
		windowSettings.maximized = true;
		store.set('windowSettings', windowSettings);
	});

	mainWindow?.on('resized', () => {
		if (!mainWindow) return;
		const { width, height } = mainWindow.getBounds();
		store.set('windowSettings', { width, height, maximized: mainWindow.isMaximized() });
	});

	mainWindow?.on('close', async (event: Electron.Event) => {
		if (!isQuiting && !store.get('quitOnClose')) {
			event.preventDefault();
			mainWindow?.hide();
			return;
		}

		if (!shouldAppClose()) {
			event.preventDefault();
		}
	});
}

if (!app.requestSingleInstanceLock()) {
	log.info('Second instance detected, quitting');
	app.quit();
} else {
	app.on('second-instance', (event, argv) => {
		log.info('Second instance started');
		// Someone tried to run a second instance, focus our window instead
		if (mainWindow) {
			if (!mainWindow?.isVisible()) {
				log.info('Second instance, forcing show of first window');
				mainWindow?.show();
			}
			mainWindow?.focus();
		}
	});

	app.whenReady().then(() => {
		log.info('App is ready');
		startProcess();
	});
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
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
app.setAsDefaultProtocolClient('rak-gaming-updater');

// Protocol handler for macOS
app.on('open-url', (event, url) => {
	event.preventDefault();
});

// Ctrl+Shift+I to open devTools, Ctrl+Shift+R to reload
app.on('web-contents-created', (webContentsCreatedEvent, webContents) => {
	webContents.on('before-input-event', (beforeInputEvent, input) => {
		const { code, alt, control, shift, meta } = input;

		// Shortcut: toggle devTools
		if (shift && control && !alt && !meta && code === 'KeyI') {
			mainWindow?.webContents.openDevTools({ mode: 'detach' });
		}

		// Shortcut: window reload
		// if (shift && control && !alt && !meta && code === "KeyR") {
		//   mainWindow.reload();
		// }
	});
});

// Auto-updater events
let updatedRecheckTimer: NodeJS.Timeout | null = null;
let rechekTries = 0;
let wasNotificationShown = false;
autoUpdater.on('update-available', (info) => {
	log.info(`Update available Version: ${info.version} Release Date: ${info.releaseDate}`);
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}

	if (!wasNotificationShown) {
		new Notification({
			title: 'Update available',
			body: `Rak Gaming Updater ${info.version} is avalilable.`,
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
				autoUpdater.downloadUpdate();
			}
		});
	}
});

autoUpdater.on('update-not-available', () => {
	log.info('Application is up to date');
});

autoUpdater.on('error', (err) => {
	log.info('Error in auto-updater. ' + err);
});

autoUpdater.on('download-progress', (progress) => {
	// Convert bytes per second to megabytes per second and format to 2 decimal places
	const speedInMbps = (progress.bytesPerSecond / (1024 * 1024)).toFixed(2);
	// Convert transferred and total bytes to megabytes and format to 2 decimal places
	const transferredInMB = (progress.transferred / (1024 * 1024)).toFixed(2);
	const totalInMB = (progress.total / (1024 * 1024)).toFixed(2);
	// Format the percent to 2 decimal places
	const percentFormatted = progress.percent.toFixed(2);

	log.info(`Download speed: ${speedInMbps} MB/s - Downloaded ${percentFormatted}% (${transferredInMB}/${totalInMB} MB)`);
	mainWindow?.setProgressBar(progress.percent / 100);
});

let updatePending = false
autoUpdater.on('update-downloaded', () => {
	mainWindow?.setProgressBar(-1);

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
	log.info('Checking for login:', token);
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

ipcMain.handle('store-set', async (event, key, value) => store.set(key, value));
ipcMain.handle('store-get', async (event, key) => store.get(key));
ipcMain.on('store-sync-request', (event, key) => {
	store.onDidChange(key, (newValue) => {
		log.debug(`Main: Store value changed for key "${key}":`, newValue);
		mainWindow?.webContents.send('store-sync', key, newValue);
	});
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
	mainWindow?.minimize();
});

ipcMain.on(IPC_EVENTS.WINDOW_CLOSE, (event) => {
	mainWindow?.close();
});

ipcMain.on(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE, (event) => {
	if (!mainWindow) return;

	if (mainWindow.isMaximized()) {
		mainWindow.unmaximize();
	} else {
		mainWindow.maximize();
	}
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
	socket.auth = { token, APP_VERSION: app.getVersion() };
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
		const zipPath = await DownloadWithRetries(fileData);
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
	log.info('Connected to server');
	mainWindow?.webContents.send(IPC_EVENTS.SOCKET_CONNECTED_CALLBACK);

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
		if (rechekTries > 10) {
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
			log.info('Recheck try #', rechekTries);
			log.info(error.statusCode, error.message);
		});
	}, 45 * 1000);
});

socket.on(SOCKET_EVENTS.STATUS_CONNECTED_CLIENTS, (data) => {
	// log.debug('Connected clients:', data);
	mainWindow?.webContents.send(IPC_EVENTS.STATUS_CONNECTED_CLIENTS_CALLBACK, data);
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

socket.on(SOCKET_EVENTS.WCL_REFRESH_TOKEN_UPDATE, (data) => {
	// log.info('Received WCL refresh token:', data);
	store.set('WCL_REFRESH_TOKEN', data);
});

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_REPORTS_LIST, async () => {
	return new Promise<any[]>((resolve) => {
		log.info('Requesting WCL reports list');
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_REPORTS_LIST, null, (response: { reports: any[]; error?: string }) => {
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

ipcMain.handle(IPC_EVENTS.WCL_REQUEST_FIGHT_EVENTS, async (event, { reportCode, fightID }) => {
	return new Promise<any>((resolve) => {
		log.info('Requesting WCL fight events for report', reportCode, 'fightID', fightID);
		socket.emit(SOCKET_EVENTS.WCL_REQUEST_FIGHT_EVENTS, { reportCode, fightID }, (response: { fightEvents: any; error?: string }) => {
			if (response.fightEvents) {
				log.info('Received fight events for report', reportCode, 'fightID', fightID);
				resolve(response.fightEvents);
			} else {
				log.error('Error receiving fight events for report', reportCode, response.error);
				resolve([]);
			}
		});
		setTimeout(() => {
			resolve([]);
		}, 15000);
	});
});

ipcMain.on(IPC_EVENTS.WCL_OPEN_DEATH, async (event, { reportCode, fightID, deathID }) => {
	// open in default browser
	// https://www.warcraftlogs.com/reports/xmHw1b8M4aqVtzyv?fight=32&type=deaths&death=1
	const url = `https://www.warcraftlogs.com/reports/${reportCode}?fight=${fightID}&type=deaths&death=${deathID}`;
	log.info('Opening WCL death link:', url);
	void shell.openExternal(url);
});

ipcMain.on(IPC_EVENTS.YOUTUBE_OPEN_LINK, async (event, videoId) => {
	const url = `https://www.youtube.com/watch?v=${videoId}`;
	log.info('Opening YouTube link:', url);
	void shell.openExternal(url);
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




