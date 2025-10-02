import dotenv from 'dotenv';
dotenv.config();

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, shell, Notification, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log/main';
import Socket from 'socket.io-client';
import AbortController from 'abort-controller';
import { jwtDecode } from 'jwt-decode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import validator from 'validator';
import { fileURLToPath } from "node:url";

import { GetFileData, CalculateHashForPath } from '@/main/fileDataUtility';
import { zipFile, unzipFile } from '@/main/zipHandler';
import { DownloadFile, InstallFile } from '@/main/fileManagement';
import { getWoWPath, validateWoWPath } from '@/main/wowPathUtility';
import mainWindowWrapper from '@/main/MainWindowWrapper';
import store from '@/main/store';

// store.set('youtubeVideoInfo', { byId: {} }); // reset
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
	BACKUP_INTERVAL_ONE_WEK
} from '@/constants'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

log.transports.file.level = 'info';
log.initialize({ preload: true });

process.on("uncaughtException", (error) => {
  log.error("uncaughtException", error);
  mainWindow?.webContents.send('uncaughtException', error);
});

process.on("unhandledRejection", (error) => {
  log.error("unhandledRejection", error);
  mainWindow?.webContents.send('unhandledRejection', error);
});

let isQuiting = false;

const TEMP_DIR = path.join(app.getPath('temp'), app.getName()); // Temporary directory for unzipped/zipped files

const socket = Socket(SERVER_URL, { autoConnect: false });

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
const html = path.join(__dirname,  'index.html');

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
	InitiateBackup(false);
}

let forceClose = false;
function shouldAppClose(): boolean {
	if (backupRunning() && !forceClose) {
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

	if (windowSettings?.maximized) {
		mainWindow?.maximize();
	}

	mainWindowWrapper.init(mainWindow);
	//123

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
		mainWindow?.webContents.send('maximize-app-changed', false);

		const windowSettings = store.get('windowSettings');
		windowSettings.maximized = false;
		store.set('windowSettings', windowSettings);
	});

	// @ts-ignore
	mainWindow?.on('maximize', (event: Electron.Event) => {
		mainWindow?.webContents.send('maximize-app-changed', true);
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
			message: process.platform === 'win32' ? info.releaseNotes : info.releaseName,
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
	if (updatePending && !backupRunning()) {
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

ipcMain.handle('get-wow-path', async () => {
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

ipcMain.handle('check-for-login', async () => {
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

ipcMain.handle('get-app-version', () => {
	return {
		version: app.getVersion(),
		releaseType: app.isPackaged ? 'release' : 'development',
	};
});

ipcMain.handle('get-language', async () => {
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

ipcMain.on('minimize-app', (event) => {
	mainWindow?.minimize();
});

ipcMain.on('close-app', (event) => {
	mainWindow?.close();
});

ipcMain.on('maximize-app-toggle', (event) => {
	if (!mainWindow) return;

	if (mainWindow.isMaximized()) {
		mainWindow.unmaximize();
	} else {
		mainWindow.maximize();
	}
});

ipcMain.handle('select-update-path', async () => {
	const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
		properties: ['openDirectory'],
	});
	log.info('Selected path(select-update-path):', result.filePaths);
	if (result.filePaths.length > 0) {
		return validateWoWPath(result.filePaths[0]);
	}
});
ipcMain.handle('select-relative-path', async () => {
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

ipcMain.handle('select-backups-path', async () => {
	const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
		properties: ['openDirectory'],
	});
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
});

/**
 * Check if a given path is within another path
 * @param {string} basePath - The base path to check against
 * @param {string} targetPath - The target path to check
 * @returns {boolean} - True if targetPath is within basePath, false otherwise
 */
function isPathWithin(basePath: string, targetPath: string): boolean {
	const resolvedBasePath = path.resolve(basePath);
	const resolvedTargetPath = path.resolve(targetPath);
	return resolvedTargetPath.startsWith(resolvedBasePath);
}

let currentAbortController: AbortController | null = null;
async function getFolderSize(folderPath: string, signal: AbortSignal): Promise<string> {
	let totalSize = 0;

	async function calculateSize(directory: string): Promise<void> {
		const files = await fsp.readdir(directory, { withFileTypes: true });

		for (const file of files) {
			if (signal.aborted) {
				throw new Error('Operation aborted');
			}

			const filePath = path.join(directory, file.name);
			try {
				const stats = await fsp.stat(filePath);

				if (stats.isDirectory()) {
					await calculateSize(filePath); // Recursively calculate size for subdirectories
				} else if (file.name.startsWith('WTF-')) {
					totalSize += stats.size; // Accumulate file size for files starting with WTF-
				}
			} catch (error: any) {
				if (error.code === 'EPERM' || error.code === 'EACCES') {
					console.warn(`Skipping inaccessible file: ${filePath}`);
				} else {
					throw error; // Re-throw other errors
				}
			}
		}
	}

	await calculateSize(folderPath);
	const totalSizeInMB = totalSize / (1024 * 1024); // Convert bytes to megabytes
	log.info(`Total size for ${folderPath}:`, totalSizeInMB.toFixed(2), 'MB');
	return totalSizeInMB.toFixed(2); // Return size in MB with 2 decimal places
}

ipcMain.handle('get-size-of-backups-folder', async () => {
	if (currentAbortController) {
		currentAbortController.abort(); // Cancel the previous run
	}

	currentAbortController = new AbortController();
	const { signal } = currentAbortController;

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
		currentAbortController = null; // Reset the controller after the operation
	}
});

ipcMain.on('open-backups-folder', async (event) => {
	const folderPath = store.get('backupsPath');
	log.info('Opening backups folder:', folderPath);
	if (folderPath) {
		shell.openPath(folderPath);
	}
});

ipcMain.on('open-logs-folder', async () => {
	log.info('Opening logs folder');
	const logsPath = app.getPath('logs')
	if (logsPath) {
		shell.openPath(logsPath);
	}

});

ipcMain.handle('login', async (event, { username, password }) => {
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
		mainWindow?.webContents.send('connect-error', err);
		return { success: false, error: `error logging in: ${err.code}` };
	}
});

ipcMain.handle('should-download-file', (event, serverFile) => {
	return shouldDownloadFile(serverFile);
});

ipcMain.handle('request-files-data', async (event) => {
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

ipcMain.on('connect', async () => {
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
ipcMain.on('request-file', async (event, fileData) => {
	try {
		const zipPath = await DownloadFile(fileData);
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

socket.on('connect', () => {
	log.info('Connected to server');
	mainWindow?.webContents.send('connect');
	InitiateBackup(false);

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
		socket.emit('sv-updater-info', updaterInfo)
	}

	const WCL_REFRESH_TOKEN = store.get('WCL_REFRESH_TOKEN');
	if (WCL_REFRESH_TOKEN) {
		socket.emit('wcl-refresh-token', { WCL_REFRESH_TOKEN }, (response: { success: boolean; error?: string }) => {
			if (response.success) {
				log.info('WCL refresh token sent successfully');
			} else {
				log.info('Error sending WCL refresh token:', response.error);
			}
		});
	}

	const youtubeVideoInfo = store.get('youtubeVideoInfo');
	if (youtubeVideoInfo) {
		socket.emit('youtube-video-info-on-connect', { youtubeVideoInfo }, response => {
			if (response.youtubeVideoInfo) {
				updateYoutubeVideoInfo(response.youtubeVideoInfo);
				log.info('Youtube video info updated from server on connect');
			} else {
				log.info('Unexpected response for youtube-video-info-on-connect:', response);
			}
		});
	}
});

socket.on('connect_error', async (error: Error) => {
	// change xhr poll error with server is not avaliable
	if (error.message.includes('xhr poll error')) {
		error = new Error('Server is unavailable.');
	}

	mainWindow?.webContents.send('connect-error', error);
	log.error('Connection error:', error.message);
});

socket.on('disconnect', (reason, details) => {
	log.info('Disconnected from server', reason, details);
	mainWindow?.webContents.send('disconnect', details || reason);
});

socket.on('new-file', (fileData) => {
	log.info('New file:', fileData);
	mainWindow?.webContents.send('new-file', fileData);
});

socket.on('file-not-found', (fileData) => {
	mainWindow?.webContents.send('file-not-found', fileData);
});

socket.on('file-deleted', (fileData) => {
	log.info('File deleted:', fileData);
	mainWindow?.webContents.send('file-deleted', fileData);
});

ipcMain.on('delete-file', (event, fileData) => {
	log.info('Deleting file:', fileData);
	socket.emit('delete-file', fileData);
});

socket.on('new-release', (data) => {
	log.info('New release:', data);
	rechekTries = 0;
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}
	updatedRecheckTimer = setInterval(() => {
		rechekTries++;
		if (rechekTries > 6) {
			if (updatedRecheckTimer) {
				clearInterval(updatedRecheckTimer);
			}
			log.info('Recheck timer cleared');
			return;
		}
		autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
			log.info('Update check results:', UpdateCheckResults);
		});
	}, 45 * 1000);
});

socket.on('connected-clients', (data) => {
	log.debug('Connected clients:', data);
	mainWindow?.webContents.send('connected-clients', data);
});

socket.on('error', (error) => {
	console.error('Socket error:', error);
});

ipcMain.on('open-file-dialog-folder', async () => {
	log.info('Opening file dialog: open-file-dialog');
	const { canceled, filePaths } = await dialog.showOpenDialog({
		properties: ['openDirectory'],
	});
	if (!canceled && filePaths.length > 0) {
		onFilePathSelected(filePaths[0]);
	}
});

ipcMain.on('open-file-dialog-file', async () => {
	log.info('Opening file dialog: open-file-dialog');
	const { canceled, filePaths } = await dialog.showOpenDialog({
		properties: ['openFile'],
	});
	if (!canceled && filePaths.length > 0) {
		onFilePathSelected(filePaths[0]);
	}
});

socket.on('not-enough-permissions', (data) => {
	log.info('Not enough permissions:', data);
});

socket.on('server-shutdown', (data) => {
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

async function DeleteOverSizeBackupFiles() {
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
		UpdateBackupStatus(BACKUP_STATUS_DELETED, filePath);
		if (totalSize - deletedSize < maxSise) {
			break;
		}
	}
	log.info('Deleted size:', deletedSize);
	mainWindow?.webContents.send('backup-created');
}

async function BackupWTFFolder() {
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

let isBackupRunning = false;

function backupRunning() {
	return isBackupRunning;
}

function UpdateBackupStatus(status: string, desc?: string) {
	mainWindow?.webContents.send('backup-status', { status, desc });
}

let backupProgressTimer: NodeJS.Timeout | null = null;
function ScheduleBackupStatus(status: string) {
	if (backupProgressTimer) {
		clearInterval(backupProgressTimer);
	}
	let c = 1;
	backupProgressTimer = setInterval(() => {
		UpdateBackupStatus(status, '.'.repeat(c));
		c++;
		if (c > 3) c = 1;
	}, 500);
}

async function InitiateBackup(force: boolean) {
	if (!socket.connected) {
		log.info('Socket is not connected, skipping backup');
		return;
	}

	if (isBackupRunning) {
		log.info('Backup is already running, skipping');
		return;
	}

	const backupsEnabled = store.get('backupsEnabled');
	if (!backupsEnabled && !force) {
		log.info('Backups are disabled, skipping');
		UpdateBackupStatus(BACKUP_STATUS_DISABLED);
		return;
	}
	log.info('Initiating backup');

	const lastBackup = store.get('lastBackupTime');
	// 1 week
	const now = Date.now();
	if (force || !lastBackup || now - lastBackup > BACKUP_INTERVAL_ONE_WEK) {
		isBackupRunning = true;
		try {
			ScheduleBackupStatus(BACKUP_STATUS_DELETING_OLD);
			await DeleteOverSizeBackupFiles();
			ScheduleBackupStatus(BACKUP_STATUS_CREATING);
			await BackupWTFFolder();
			store.set('lastBackupTime', now);
			ScheduleBackupStatus(BACKUP_STATUS_DELETING_OLD);
			await DeleteOverSizeBackupFiles();
			UpdateBackupStatus(BACKUP_STATUS_COMPLETED);
		} catch (error: any) {
			log.error('Error during backup:', error);
			UpdateBackupStatus(BACKUP_STATUS_FAILED, error?.message || 'Unknown error');
		} finally {
			isBackupRunning = false;
			CheckPendingAppUpdate();
			if (backupProgressTimer) {
				clearInterval(backupProgressTimer);
			}
		}
	}
}

ipcMain.on('initiate-backup', (event, data) => {
	InitiateBackup(data);
});

// every 10 min
setInterval(async () => {
	InitiateBackup(false);
}, 1000 * 60 * 10);

import { RegisterSVCallback } from '@/main/svWatcher';

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
		socket.emit('wcl-auth-link', null, (response: { authLink: string; error?: string }) => {
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

ipcMain.handle('wcl-request-auth-link', async () => {
	try {
		const link = await requestWCLAuthLink();
		// follow link in default browser
		void shell.openExternal(link);
		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
});

socket.on('wcl-refresh-token-update', (data) => {
	// log.info('Received WCL refresh token:', data);
	store.set('WCL_REFRESH_TOKEN', data);
});

ipcMain.handle('wcl-request-reports', async () => {
	return new Promise<any[]>((resolve) => {
		log.info('Requesting WCL reports list');
		socket.emit('wcl-reports-list', null, (response: { reports: any[]; error?: string }) => {
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

ipcMain.handle('wcl-request-report-data', async (event, { reportCode }) => {
	// Handle the request for WCL fight details
	return new Promise<any[]>((resolve) => {
		log.info('Requesting WCL fight details for report', reportCode);
		socket.emit('wcl-report-data', { reportCode }, (response: { reportData: any; error?: string }) => {
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

ipcMain.handle('wcl-request-fight-events', async (event, { reportCode, fightID }) => {
	return new Promise<any>((resolve) => {
		log.info('Requesting WCL fight events for report', reportCode, 'fightID', fightID);
		socket.emit('wcl-fight-events', { reportCode, fightID }, (response: { fightEvents: any; error?: string }) => {
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

socket.on('youtube-video-info-added', (data) => {
	addYoutubeVideoInfo(data.videoInfo);
});

socket.on('youtube-video-info-updated', (data) => {
	updateYoutubeVideoInfo(data.youtubeVideoInfo);
});

function updateYoutubeVideoInfo(youtubeVideoInfoReceived) {
	if (typeof youtubeVideoInfoReceived?.byId !== 'object') return;

	const youtubeVideoInfo = store.get('youtubeVideoInfo')
	let anyNew = false;

	for (const videoId in youtubeVideoInfoReceived.byId) {
		if (youtubeVideoInfoReceived.byId.hasOwnProperty(videoId) &&
		(
			!youtubeVideoInfo.byId[videoId] ||
			youtubeVideoInfo.byId[videoId].checkTime < youtubeVideoInfoReceived.byId[videoId].checkTime)
		) {
			youtubeVideoInfo.byId[videoId] = youtubeVideoInfoReceived.byId[videoId];
			anyNew = true;
		}
	}

	if (anyNew) {
		store.set('youtubeVideoInfo', youtubeVideoInfo);
	}
};

function addYoutubeVideoInfo(videoInfo) {
	if (!videoInfo?.id) return;

	const youtubeVideoInfo = store.get('youtubeVideoInfo')
	if (!youtubeVideoInfo.byId[videoInfo.id] || youtubeVideoInfo.byId[videoInfo.id].checkTime < videoInfo.checkTime) {
		youtubeVideoInfo.byId[videoInfo.id] = videoInfo;
		store.set('youtubeVideoInfo', youtubeVideoInfo);
	}
}

ipcMain.handle('request-youtube-video-info', async (event, URL) => {
	return new Promise((resolve) => {
		console.log('Requesting YouTube video info for URL:', URL);
		socket.emit('youtube-video-info-add', { URL }, (response: { videoInfo: any; error?: string }) => {
			if (response.videoInfo) {
				addYoutubeVideoInfo(response.videoInfo);
				log.info('Youtube video info added for URL:', URL);
			}
			resolve(response);
		});
	});
});

ipcMain.handle('open-wcl-death', async (event, { reportCode, fightID, deathID }) => {
	// open in default browser
	// https://www.warcraftlogs.com/reports/xmHw1b8M4aqVtzyv?fight=32&type=deaths&death=1
	const url = `https://www.warcraftlogs.com/reports/${reportCode}?fight=${fightID}&type=deaths&death=${deathID}`;
	log.info('Opening WCL death link:', url);
	void shell.openExternal(url);
});
