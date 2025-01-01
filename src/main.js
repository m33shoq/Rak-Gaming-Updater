const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, shell, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log/main');

const i18n = require('./translations/i18n');
const locale = i18n.getLocale();
const translations = i18n.getCatalog(locale);
const serializedL = JSON.parse(JSON.stringify(translations));
ipcMain.handle('i18n', () => serializedL);

const L = new Proxy(serializedL, {
	get: (target, prop) => {
		if (prop in target) {
			return target[prop];
		}
		return prop;
	},
});

require('dotenv').config();
const URL = process.env.ELECTRON_USE_DEV_URL === '1' ? 'http://localhost:3001' : `https://rak-gaming-annoucer-bot-93b48b086bae.herokuapp.com`;
log.info('URL:', URL);
const socket = require('socket.io-client')(URL, { autoConnect: false });
const AdmZip = require('adm-zip');
const { jwtDecode } = require('jwt-decode');
const fs = require('fs');
const path = require('path');
const validator = require('validator');
const crc32 = require('crc').crc32;
const { setExternalVBSLocation, promisified } = require('regedit');

let fetch;
let store;

(async () => {
	const fetchModule = await import('node-fetch');
	fetch = fetchModule.default;

	const storeModule = await import('electron-store');
	const Store = storeModule.default;
	store = new Store({
		defaults: {
			authToken: null,
			updatePath: null,
			relativePath: null,
			autoupdate: false,
			startWithWindows: true,
			startMinimized: true,
			quitOnClose: false,
			maxBackupsFolderSize: 524,
			backupsEnabled: false,
			backupsFolderPath: null,
		},
	});
	// store.delete('authToken'); // for testing
	function updateStartWithWindows() {
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
	updateStartWithWindows();

	ipcMain.on('set-start-with-windows', (event, value) => {
		store.set('startWithWindows', value);
		updateStartWithWindows();
	});

	startProcess();
})();

log.initialize({ preload: true });
log.info('App starting...');

__dirname = path.dirname(__filename);
log.info('File:', __filename, 'Dir:', __dirname);

let = currentLocale = i18n.getLocale();
console.log('Current locale:', currentLocale);
const preload = path.join(__dirname, 'preload.js');
const taskBarIconPath = path.join(__dirname, (currentLocale === 'ko' && 'taskbaricon-mate.png') || 'taskbaricon.png');
const notificationIconPath = path.join(__dirname, (currentLocale === 'ko' && 'icon-mate.png') || 'icon.png');
console.log('Taskbar icon:', taskBarIconPath, 'Notification icon:', notificationIconPath);
const html = path.join(__dirname, 'index.html');

const taskBarIcon = nativeImage.createFromPath(taskBarIconPath);
const notificationIcon = nativeImage.createFromPath(notificationIconPath);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }]);

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
log.transports.file.level = 'info';
autoUpdater.logger = log;

let queuedDialogs = [];

function queueDialog(mainWindow, dialogOptions, onSuccess) {
	if (mainWindow?.isVisible()) {
		dialog.showMessageBox(mainWindow, dialogOptions).then(onSuccess);
	} else {
		queuedDialogs.push({ dialogOptions, onSuccess });
	}
}

let mainWindow;
let tray;

function renderer_log(message) {
	mainWindow?.webContents?.send('log', message);
}

let lastReceivedData = {
	newFile: {},
	downloadedFile: {},
}; // Last received data
let lastDataTimestamp = {
	newFile: 0,
	downloadedFile: 0,
}; // Timestamp of the last received data
const DATA_RECEIVE_THRESHOLD = 2000; // 2 seconds threshold

function startProcess() {
	if (!store || !app.isReady() || mainWindow) return;
	createWindow();
	autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
		log.info('Update check results:', UpdateCheckResults);
	});
}

function createWindow() {
	const startMinimized = process.argv.includes('--hidden') && store.get('startMinimized');
	log.info('Creating window', { startMinimized });
	mainWindow = new BrowserWindow({
		width: 850,
		height: 600,
		icon: taskBarIcon,
		maximizable: false,
		minimizable: true,
		resizable: false,
		fullscreenable: false,
		frame: false,
		backgroundColor: '#00000000',
		titleBarStyle: 'hidden',
		webPreferences: {
			preload: preload,
			nodeIntegration: false,
			contextIsolation: true,
			enableRemoteModule: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			sandbox: true,
		},
		skipTaskbar: startMinimized,
		show: !startMinimized,
	});

	mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https:')) {
			void shell.openExternal(url);
		}
		return { action: 'deny' };
	});

	mainWindow?.once('ready-to-show', () => {
		renderer_log(`Ready to show. Start args: ${process.argv.join(' ')}`);
		log.info(`Ready to show. Start args: ${process.argv.join(' ')}`);

		// mainWindow?.webContents.openDevTools({ mode: "detach" });
	});

	mainWindow?.setMenu(null);

	log.info(`Loading File: ${html}`);
	mainWindow?.loadFile(html);

	mainWindow?.on('closed', () => (mainWindow = null));

	tray = new Tray(taskBarIcon);
	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show', click: () => mainWindow?.show() },
		{
			label: 'Quit',
			click: () => {
				app.isQuiting = true;
				app.quit();
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
		if (mainWindow?.webContents.getURL() !== winURL) {
			event.preventDefault();
		}
	});

	mainWindow?.on('show', () => {
		mainWindow?.setSkipTaskbar(false);

		if (queuedDialogs.length > 0) {
			queuedDialogs.forEach(({ dialogOptions, onSuccess }) => {
				if (onSuccess) {
					dialog.showMessageBox(mainWindow, dialogOptions).then(onSuccess);
				}
			});
			queuedDialogs = [];
		}
	});

	mainWindow?.on('minimize', (event) => {
		mainWindow?.setSkipTaskbar(true);
		event.preventDefault();
		mainWindow?.hide();
	});

	mainWindow?.on('close', (event) => {
		if (!app.isQuiting && !store.get('quitOnClose')) {
			event.preventDefault();
			mainWindow?.hide();
		}
		return false;
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
let updatedRecheckTimer;
let rechekTries = 0;
let wasNotificationShown = false;
autoUpdater.on('update-available', (info) => {
	renderer_log(`Update available Version: ${info.version} Release Date: ${info.releaseDate}`);
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}

	if (!wasNotificationShown) {
		new Notification({
			title: 'Update available',
			body: `Rak Gaming Updater ${info.version} is avalilable.`,
			icon: notificationIcon,
		}).show();

		const dialogOpts = {
			buttons: ['Update', 'Later'],
			title: 'Rak Gaming Updater',
			message: process.platform === 'win32' ? info.releaseNotes : info.releaseName,
			detail: `A new version ${info.version} is available. Do you want to update now?`,
			noLink: true,
			modal: true,
			parent: mainWindow,
		};

		queueDialog(mainWindow, dialogOpts, ({ response }) => {
			if (response === 0) {
				autoUpdater.downloadUpdate();
			}
		});
	}
});

autoUpdater.on('update-not-available', () => {
	renderer_log('Application is up to date');
});

autoUpdater.on('error', (err) => {
	renderer_log('Error in auto-updater. ' + err);
});

autoUpdater.on('download-progress', (progress) => {
	// Convert bytes per second to megabytes per second and format to 2 decimal places
	const speedInMbps = (progress.bytesPerSecond / (1024 * 1024)).toFixed(2);
	// Convert transferred and total bytes to megabytes and format to 2 decimal places
	const transferredInMB = (progress.transferred / (1024 * 1024)).toFixed(2);
	const totalInMB = (progress.total / (1024 * 1024)).toFixed(2);
	// Format the percent to 2 decimal places
	const percentFormatted = progress.percent.toFixed(2);

	renderer_log(`Download speed: ${speedInMbps} MB/s - Downloaded ${percentFormatted}% (${transferredInMB}/${totalInMB} MB)`);
	mainWindow?.setProgressBar(progress.percent / 100);
});

autoUpdater.on('update-downloaded', () => {
	log.info('Update downloaded; will install in 5 seconds');
	renderer_log('Update downloaded; will install in 5 seconds');

	mainWindow?.setProgressBar(-1);

	setTimeout(() => {
		// Shenanigans to make sure the app closes properly
		app.isQuiting = true;
		if (mainWindow) {
			mainWindow?.close();
		}
		autoUpdater.quitAndInstall(true, true);
		setTimeout(() => {
			app.quit();
		}, 1000);
	}, 5000);
});

function isEqual(data1, data2) {
	return JSON.stringify(data1) === JSON.stringify(data2);
}

function sanitizeInput(input) {
	let res = validator.escape(input);
	res = res.trim();
	return res;
}

const vbsPath = path.join(app.getAppPath(), '..', 'vbs');
setExternalVBSLocation(vbsPath); // to allow packaged app to access registry
log.info('VBS Path:', vbsPath);
async function wowDefaultPath() {
	if (process.platform === 'win32') {
		// log.info('Checking default WoW path on Windows');
		const key = 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft';

		try {
			const results = await promisified.list([key]);
			const value = results[key].values.InstallPath.value;
			// log.info('Registry WoW Path:', value, typeof value);
			if (typeof value === 'string') {
				let path = validateWoWPath(value);
				// log.info('Validated WoW Path:', path);
				return path;
			} else {
				// log.error('WoW path is not a string:', value);
				// Optionally, prompt the user for input or provide a default path
				return null;
			}
		} catch (e) {
			log.error('Error accessing registry for WoW path:', JSON.stringify(e));
			// Show an error dialog to the user or log the error
			// Optionally, prompt the user to manually select the WoW installation path
			return null;
		}
	}
	return null;
}

function validateWoWPath(inputPath) {
	log.info('Validating WoW Path:', inputPath);
	// Normalize the input path to handle different path formats
	const normalizedPath = path.normalize(inputPath);
	// Split the path to analyze its components
	const pathComponents = normalizedPath.split(path.sep);

	// Find the index of the "World of Warcraft" folder in the path
	const wowIndex = pathComponents.map((component) => component.toLowerCase()).indexOf('world of warcraft'.toLowerCase());

	// If "World of Warcraft" is not in the path, the path is invalid
	if (wowIndex === -1) {
		log.info('Invalid WoW Path:', inputPath);
		return null;
	}

	// Construct the path up to and including "World of Warcraft"
	const wowPath = pathComponents.slice(0, wowIndex + 1).join(path.sep);

	// Check if the "_retail_" folder exists within the "World of Warcraft" directory
	const retailPath = path.join(wowPath, '_retail_');
	if (fs.existsSync(retailPath)) {
		// Return the path to "World of Warcraft" if "_retail_" exists within it
		log.info('Valid WoW Path:', wowPath);
		return wowPath;
	}

	// Return null if the "_retail_" folder does not exist within the "World of Warcraft" directory
	log.info('Invalid WoW Path(no _retail_):', inputPath);
	return null;
}

async function getWoWPath() {
	let path = store.get('updatePath');
	if (!path) {
		path = await wowDefaultPath();
	}
	return path;
}

ipcMain.handle('get-wow-path', async () => {
	return await getWoWPath();
});

async function onFilePathSelected(folderPath) {
	log.info('Selected path:', folderPath, '|relative path:', store.get('relativePath'));
	if (!store.get('relativePath')) {
		log.info('Relative path not set, skipping');
		renderer_log('Relative path not set, skipping');
		return;
	}
	if (folderPath) {
		const hash = await generateHashForPath(folderPath);
		const stats = fs.statSync(folderPath);
		let displayName = path.basename(folderPath);
		console.log('Display name:', displayName);
		let emptyData = { hash, timestamp: stats.mtime.getTime() / 1000, fileName: displayName, displayName: displayName };

		if (stats.isDirectory()) {
			// Existing directory logic
			compressAndSend(folderPath, true, emptyData);
		} else if (stats.isFile()) {
			const fileExtension = path.extname(folderPath);
			log.info('File extension:', fileExtension);
			renderer_log('File extension:', fileExtension);

			if (fileExtension === '.zip') {
				// Before sending the .zip we must unzip it to check the hash and name of the package
				const { fileName, hash, timestamp } = await processZipBeforeSending(folderPath);
				log.info('Processed zip:', fileName, hash, timestamp);
				emptyData = { fileName, hash, timestamp, displayName };

				// Send the .zip file directly
				sendFile(folderPath, emptyData);
			} else {
				// Compress and send the file
				compressAndSend(folderPath, false, emptyData);
			}
		}
	} else {
		log.info('No path selected');
		renderer_log('No path selected');
	}
}

ipcMain.handle('check-for-login', async () => {
	const token = store.get('authToken');
	log.info('Checking for login:', token);
	if (token) {
		try {
			const decoded = jwtDecode(token);
			return { username: decoded.username, role: decoded.role };
		} catch (error) {
			console.error('Error decoding token:', error);
			return null;
		}
	}
	return null;
});

ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
ipcMain.handle('store-get', (event, key) => store.get(key));

ipcMain.handle('get-app-version', () => {
	return app.getVersion();
});

ipcMain.on('minimize-app', (event) => {
	mainWindow?.minimize();
});

ipcMain.on('close-app', (event) => {
	mainWindow?.close();
});

ipcMain.handle('select-update-path', async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ['openDirectory'],
	});
	log.info('Selected path(select-update-path):', result.filePaths);
	if (result.filePaths.length > 0) {
		updatePath = validateWoWPath(result.filePaths[0]);
		return updatePath;
	}
});
ipcMain.handle('select-relative-path', async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
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
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ['openDirectory'],
	});
	if (result.filePaths.length > 0) {
		log.info('Backups path:', result.filePaths[0]);
		return result.filePaths[0];
	}
});

async function getFolderSize(folderPath) {
	let totalSize = 0;

	async function calculateSize(directory) {
		const files = await fs.promises.readdir(directory, { withFileTypes: true });

		for (const file of files) {
			const filePath = path.join(directory, file.name);
			const stats = await fs.promises.stat(filePath);

			if (stats.isDirectory()) {
				await calculateSize(filePath); // Recursively calculate size for subdirectories
			} else {
				totalSize += stats.size; // Accumulate file size
			}
		}
	}

	await calculateSize(folderPath);
	const totalSizeInMB = totalSize / (1024 * 1024); // Convert bytes to megabytes
	return totalSizeInMB.toFixed(2); // Return size in MB with 2 decimal places
}

ipcMain.handle('get-size-of-backups-folder', async () => {
	const folderPath = store.get('backupsPath');
	if (!folderPath) {
		console.log('No path set');
		return 'no path set';
	}
	const size = await getFolderSize(folderPath);
	return size;
});

ipcMain.on('open-backups-folder', (event) => {
	const folderPath = store.get('backupsPath');
	console.log('Opening backups folder:', folderPath);
	if (folderPath) {
		shell.openPath(folderPath);
	}
});

ipcMain.handle('login', async (event, { username, password }) => {
	try {
		const loginUrl = `${URL}/login`;
		const sanitizedUsername = sanitizeInput(username); // Implement sanitizeInput to sanitize user inputs
		const sanitizedPassword = sanitizeInput(password);

		const response = await fetch(loginUrl, {
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
	} catch (err) {
		log.info('Login error:', err);
		console.error('Login error:', err);
		return { success: false, error: `error logging in: ${err.code}` };
	}
});

ipcMain.handle('should-download-file', (event, serverFile) => {
	return shouldDownloadFile(serverFile);
});

ipcMain.handle('request-files-data', async (event) => {
	return await fetch(`${URL}/files`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${store.get('authToken')}`,
		},
	})
		.then((response) => response.json())
		.catch((error) => console.error('Error fetching files data:', error));
});

// ipcMain.handle('request-active-users', async (event) => {
// 	const token = store.get('authToken'); // Replace this with your actual token

// 	try {
// 		const response = await fetch(URL+'/active-users', {
// 			method: 'GET',
// 			headers: {
// 				'Authorization': `Bearer ${token}`
// 			}
// 		});

// 		if (!response.ok) {
// 			throw new Error(`HTTP error! status: ${response.status}`);
// 		}

// 		return await response.json();
// 	} catch (error) {
// 		console.error('Error fetching active users:', error);
// 		// Handle the error appropriately in your application
// 	}
// });

ipcMain.on('connect', () => {
	log.info('Connecting to server');
	const token = store.get('authToken');
	socket.auth = { token };
	socket.connect();
});

ipcMain.on('request-file', (event, data) => {
	socket.emit('request-file', data);
});

socket.on('connect', () => {
	log.info('Connected to server');
	mainWindow?.webContents.send('connect');
});

// in case of something cursed happens we try to reconnect every 1 sec for 15 times
const totalReconnectAttempts = 15;
let manualReconnectAttempt = 0;
let reconnectScheduled = false;
socket.on('connect_error', (error) => {
	log.info('Connection error', error);
	mainWindow?.webContents.send('connect-error', error);
	const token = store.get('authToken');

	if (!socket.active && !reconnectScheduled && token && manualReconnectAttempt < totalReconnectAttempts) {
		reconnectScheduled = true;
		socket.auth = { token };
		setTimeout(() => {
			reconnectScheduled = false;
			manualReconnectAttempt++;
			socket.connect();
		}),
			5000;
	}
});

socket.on('disconnect', (reason, details) => {
	log.info('Disconnected from server', reason, details);
	mainWindow?.webContents.send('disconnect', (details && details.description) || reason);
});

socket.on('new-file', (data) => {
	const now = Date.now();
	if (now - lastDataTimestamp.newFile < DATA_RECEIVE_THRESHOLD && isEqual(data, lastReceivedData.newFile)) {
		log.info('Duplicate data received, ignoring.');
		return;
	}
	lastDataTimestamp.newFile = now;
	lastReceivedData.newFile = data;
	log.info('New file:', data);
	mainWindow?.webContents.send('new-file', data);
});

socket.on('file-not-found', (data) => {
	mainWindow?.webContents.send('file-not-found', data);
});

socket.on('file-deleted', (data) => {
	log.info('File deleted:', data);
	mainWindow?.webContents.send('file-deleted', data);
});

ipcMain.on('delete-file', (event, data) => {
	log.info('Deleting file:', data);
	socket.emit('delete-file', data);
});

socket.on('new-release', (data) => {
	log.info('New release:', data);
	renderer_log('New release available');
	rechekTries = 0;
	if (updatedRecheckTimer) {
		clearInterval(updatedRecheckTimer);
		log.info('Recheck timer cleared');
	}
	updatedRecheckTimer = setInterval(() => {
		rechekTries++;
		if (rechekTries > 6) {
			clearInterval(updatedRecheckTimer);
			log.info('Recheck timer cleared');
			return;
		}
		autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
			log.info('Update check results:', UpdateCheckResults);
		});
	}, 45 * 1000);
});

socket.on('connected-clients', (data) => {
	log.info('Connected clients:', data);
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
	renderer_log('Not enough permissions:', data);
});

const fileChunks = {};
socket.on('file-content-chunk', async (data) => {
	if (!(await getWoWPath())) return;
	const { chunk, chunkNumber, totalChunks, fileName, relativePath, timestamp, hash, displayName } = data;

	// Initialize the file's chunk array if it doesn't exist
	if (!fileChunks[hash]) {
		fileChunks[hash] = new Array(totalChunks).fill(null);
	}

	// check if chank was already sent
	if (fileChunks[hash][chunkNumber] !== null) {
		log.info(`Chunk ${chunkNumber} already received, skipping...`);
		return;
	}
	fileChunks[hash][chunkNumber] = chunk;

	// Calculate the percentage of chunks received
	const chunksReceived = fileChunks[hash].filter((chunk) => chunk !== null).length;
	const progressPercent = Math.round((chunksReceived / totalChunks) * 100);
	mainWindow?.webContents.send('file-chunk-received', { progressPercent, fileName, relativePath, timestamp, hash, displayName });

	// Check if all chunks have been received
	const allChunksReceived = fileChunks[hash].every((chunk) => chunk !== null);

	socket.emit('ack', { chunkNumber, fileName, hash });
	// log.info(`ACK sent for chunk ${chunkNumber} of file ${fileName}`)

	if (!allChunksReceived) return;

	const now = Date.now();
	if (now - lastDataTimestamp.downloadedFile < DATA_RECEIVE_THRESHOLD && isEqual({ fileName, relativePath, timestamp, hash, displayName }, lastReceivedData.downloadedFile)) {
		log.info('Duplicate data received, ignoring.');
		return;
	}

	lastDataTimestamp.downloadedFile = now;
	lastReceivedData.downloadedFile = data;

	// Combine all chunks
	const fileBuffer = Buffer.concat(fileChunks[hash]);

	const updatePath = await getWoWPath();
	const temp_zip_file_path = path.join(updatePath, relativePath, fileName + '.zip'); // wow + relative + .zip
	const exptected_output_folder = path.join(updatePath, relativePath, fileName); // wow + relative + foler/file
	const target_path = path.join(updatePath, relativePath); // wow + relative

	// ensure the target path exists
	if (!fs.existsSync(target_path)) {
		fs.promises.mkdir(target_path, { recursive: true });
	}
	// ensure expected output folder is empty
	if (fs.existsSync(exptected_output_folder)) {
		await fs.promises.rm(exptected_output_folder, { recursive: true });
	}

	log.info('Decompressing file:', temp_zip_file_path);
	const zip = new AdmZip(fileBuffer);

	zip.extractAllToAsync(target_path, true, false, (error) => {
		if (error) {
			log.error('Error extracting file:', error);
			console.error('Error extracting file:', error);
			return;
		}
		mainWindow?.webContents.send('file-downloaded', { fileName, relativePath, timestamp, hash, displayName });
		setTimeout(() => {
			delete fileChunks[hash];
		}, 2000); // Delay deletion of chunks in case server will duplicate some chunks
	});
});

async function generateHashForPath(entryPath) {
	const stats = await fs.promises.stat(entryPath);
	if (stats.isDirectory()) {
		// Get all entries in the directory
		const entries = await fs.promises.readdir(entryPath);
		const sortedEntries = entries.sort();
		let combinedHash = '';
		for (let entry of sortedEntries) {
			const fullPath = path.join(entryPath, entry);
			const entryHash = await generateHashForPath(fullPath); // Process each entry sequentially
			combinedHash += entryHash; // Concatenate hashes
		}
		return crc32(combinedHash).toString(16);
	} else {
		// It's a file, generate hash as before
		const fileBuffer = await fs.promises.readFile(entryPath);
		return crc32(fileBuffer).toString(16);
	}
}

async function shouldDownloadFile(serverFile) {
	if (!(await getWoWPath())) {
		return [false, L['No WoW Path set']];
	}

	const localFilePath = path.join(await getWoWPath(), serverFile.relativePath, serverFile.fileName.replace(/\.zip$/, ''));
	log.info(`Checking file: ${localFilePath}`);
	// Check if the file exists
	if (!fs.existsSync(localFilePath)) {
		log.info(`File does not exist: ${localFilePath}, should download`);
		return [true, L['Install']]; // If the file doesn't exist, return true to download it
	}
	const stats = fs.lstatSync(localFilePath);
	if (stats.isSymbolicLink()) {
		log.info(`File is a symbolic link: ${localFilePath}, should download`);
		return [false, L['Is symbolic link']];
	}

	const localFileHash = await generateHashForPath(localFilePath);
	log.info(`Local File Hash: ${localFileHash}, Server File Hash: ${serverFile.hash}`);
	const shouldDownload = localFileHash !== serverFile.hash;
	if (shouldDownload) {
		return [shouldDownload, L['Update']];
	} else {
		return [shouldDownload, L['Up to date']];
	}
}

async function send_data_in_chunks(socket, data) {
	log.info('Sending data in chunks:', data.fileName, data.relativePath, data.timestamp, data.hash);
	const CHUNK_SIZE = 256 * 1024; // 256KB
	const fileBuffer = data.file;
	const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

	const fileName = data.fileName;
	const relativePath = data.relativePath;
	const timestamp = data.timestamp;
	const hash = data.hash;
	const displayName = data.displayName;

	const sendChunkAndWaitForAck = (chunk, chunkNumber) => {
		return new Promise((resolve, reject) => {
			const ackListener = (ackData) => {
				if (ackData.chunkNumber === chunkNumber && ackData.hash === hash && ackData.fileName === fileName) {
					socket.off('ack', ackListener); // Remove listener after receiving ACK
					resolve();
				}
			};
			socket.on('ack', ackListener);

			socket.emit('upload-file-chunk', {
				chunk: chunk,
				chunkNumber: chunkNumber,
				totalChunks: totalChunks,
				fileName: fileName,
				relativePath: relativePath,
				timestamp: timestamp,
				hash: hash,
				displayName: displayName,
			});

			// Timeout for ACK
			setTimeout(() => {
				socket.off('ack', ackListener); // Ensure to remove listener to prevent memory leak
				reject(`Timeout waiting for ACK for chunk ${chunkNumber}`);
			}, 5000); // 5 seconds timeout for ACK
		});
	};

	for (let i = 0; i < totalChunks; i++) {
		let start = i * CHUNK_SIZE;
		let end = start + CHUNK_SIZE;
		let chunk = fileBuffer.slice(start, end);

		try {
			await sendChunkAndWaitForAck(chunk, i);
			log.info(`Chunk ${i} sent and acknowledged`);
		} catch (error) {
			console.error(error);
			i--; // Retry sending the current chunk
		}
	}
}

// filePath is the location of current zip file
// decompress zip to check hash and proper name for the package
// extract it to /tmp and check the hash and name of the first file/foler in directory
// delete /tmp after the processing
// return { name, hash, timestamp }
async function processZipBeforeSending(filePath) {
	try {
		log.info('Processing zip before sending:', filePath);
		renderer_log('Processing zip before sending:', filePath);
		const userData = app.getPath('userData');
		const tmpExtractPath = path.join(userData, '/tmp');
		const tmpCopyPath = path.join(userData, '/tmp', path.basename(filePath));

		log.info('Extracting file:', tmpCopyPath);
		log.info('Extracting to:', tmpExtractPath);

		if (!fs.existsSync(tmpExtractPath)) {
			await fs.promises.mkdir(tmpExtractPath, { recursive: true });
		}
		await fs.promises.copyFile(filePath, tmpCopyPath);

		const zip = new AdmZip(tmpCopyPath);
		zip.extractAllTo(tmpExtractPath, true);

		// Delete the copied zip file
		await fs.promises.rm(tmpCopyPath, { recursive: true });

		const extractedFiles = await fs.promises.readdir(tmpExtractPath);

		log.info('Extracted files:', extractedFiles);
		const targetFile = path.join(tmpExtractPath, extractedFiles[0]);

		const fileName = path.basename(targetFile);
		const hash = await generateHashForPath(targetFile);
		const stats = fs.statSync(targetFile);
		const timestamp = stats.mtime.getTime() / 1000;
		await fs.promises.rm(tmpExtractPath, { recursive: true });

		return { fileName, hash, timestamp };
	} catch (error) {
		log.error('Error processing zip before sending:', error);
		renderer_log('Error processing zip before sending:', error);
	}
}

async function compressAndSend(folderPath, isFolder, { fileName, hash, timestamp, displayName }) {
	const outputPath = `${folderPath}.zip`;
	const zip = new AdmZip();

	if (isFolder) {
		zip.addLocalFolder(folderPath, fileName);
	} else {
		zip.addLocalFile(folderPath);
	}

	// Save the zip file
	await zip.writeZipPromise(outputPath);

	log.info('File compressed and saved:', outputPath);

	// Send the file
	await sendFile(outputPath, { fileName, hash, timestamp, displayName });

	// Clean up the zip file after sending
	fs.unlink(outputPath, (err) => {
		if (err) {
			console.error('Error deleting zip file:', err);
		}
	});
}

async function sendFile(filePath, { fileName, hash, timestamp, displayName }) {
	fileName = fileName.replace(/\.zip$/, '');
	log.info('Sending file:', filePath, { fileName, hash, timestamp });
	const fileBuffer = await fs.promises.readFile(filePath);
	const stats = fs.statSync(filePath);
	timestamp = timestamp || stats.mtime.getTime() / 1000;
	send_data_in_chunks(socket, { file: fileBuffer, fileName, relativePath: store.get('relativePath'), timestamp, hash, displayName });
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
	// delete old backups untill there is only 1 backup left or the folder size is less than maxSise setting
	const maxSiseMB = store.get('maxBackupsFolderSize'); // in MB
	if (!maxSiseMB) {
		log.info('Max backup size not set');
		return;
	}
	const maxSise = maxSiseMB * 1024 * 1024; // convert to bytes
	const backups = await fs.promises.readdir(backupsPath);
	if (backups.length <= 1) {
		log.info('Only one backup found, skipping delete');
		return;
	}
	let totalSize = 0;
	let files = [];
	for (let file of backups) {
		const filePath = path.join(backupsPath, file);
		const stats = fs.statSync(filePath);
		totalSize += stats.size;
		files.push({ file, size: stats.size });
	}
	log.info('Total size of backups:', totalSize);
	if (totalSize < maxSise) {
		log.info('Total size is less than max size, skipping delete');
		return;
	}
	files.sort((a, b) => a.mtime - b.mtime);
	log.info('Files:', files);
	let deletedSize = 0;
	for (let file of files) {
		const filePath = path.join(backupsPath, file.file);
		await fs.promises.rm(filePath, { recursive: true });
		deletedSize += file.size;
		log.info('Deleted:', filePath);
		if (totalSize - deletedSize < maxSise) {
			break;
		}
	}
	log.info('Deleted size:', deletedSize);
}

async function BackupWTFFolder() {
	const wowPath = await getWoWPath();
	const wtfPath = path.join(wowPath, '_retail_', 'WTF');
	const backupsPath = store.get('backupsPath');

	if (!fs.existsSync(wtfPath)) {
		log.error('WTF folder not found:', wtfPath);
		return;
	}

	if (!fs.existsSync(backupsPath)) {
		log.error('Backups folder not found:', backupsPath);
		return;
	}
	//.split('T')[0];
	const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
	const backupName = `WTF-${timestamp}.zip`;
	const backupFilePath = path.join(backupsPath, backupName);

	const zip = new AdmZip();
	zip.addLocalFolderPromise(wtfPath, 'WTF').then(() => {
		zip.writeZipPromise(backupFilePath).then(() => {
			log.info('Backup created:', backupFilePath);
			renderer_log('Backup created:' + backupFilePath);
			ipcMain.emit('backup-created');
		});
	});
}

function InitiateBackup() {
	const backupsEnabled = store.get('backupsEnabled');
	if (!backupsEnabled) {
		log.info('Backups are disabled, skipping');
		return;
	}

	const lastBackup = store.get('lastBackupTime');
	// 1 week
	const backupInterval = 1000 * 60 * 60 * 24 * 7;
	const now = Date.now();
	if (!lastBackup || now - lastBackup > backupInterval) {
		DeleteOverSizeBackupFiles().then(() => {
			BackupWTFFolder().then(() => {
				store.set('lastBackupTime', now);
				DeleteOverSizeBackupFiles();
			});
		});
	}
}

// every 1 hour
setInterval(async () => {
	InitiateBackup();
}, 1000 * 60 * 60);

// 30 sec after start
setTimeout(() => {
	InitiateBackup();
}, 1000 * 30);
