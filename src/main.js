require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, shell, Notification, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log/main');
const { AbortController } = require('abort-controller');
const { jwtDecode } = require('jwt-decode');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const validator = require('validator');

const { GetFileData, CalculateHashForPath } = require('./fileDataUtility.js');
const { zipFile, unzipFile } = require('./zipHandler.js');
const { DownloadFile, InstallFile } = require('./fileManagement.js');
const { getWoWPath, validateWoWPath } = require('./wowPathUtility.js');
const MainWindowWrapper = require('./MainWindowWrapper.js');
log.info('MainWindowWrapper', MainWindowWrapper);
const store = require('./store.js');
let storeInitialized = false;

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

const { SERVER_URL, SERVER_LOGIN_ENDPOINT, SERVER_UPLOADS_ENDPOINT, SERVER_EXISTING_FILES_ENDPOINT, SERVER_DOWNLOAD_ENDPOINT } = require('./serverEndpoints.js');

const TEMP_DIR = path.join(__dirname, 'temp'); // Temporary directory for unzipped/zipped files
if (!fs.existsSync(TEMP_DIR)) {
	fs.mkdirSync(TEMP_DIR, { recursive: true });
}

log.info('SERVER_URL:', SERVER_URL);
const socket = require('socket.io-client')(SERVER_URL, { autoConnect: false });

(async () => {
	// await store.delete('authToken'); // Clear auth token on startup for testing
	async function updateStartWithWindows() {
		if (await store.get('startWithWindows')) {
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
	await updateStartWithWindows();

	ipcMain.on('set-start-with-windows', async (event, value) => {
		await store.set('startWithWindows', value);
		await updateStartWithWindows();
	});

	storeInitialized = true;
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

function startProcess() {
	if (!storeInitialized || !app.isReady() || mainWindow) return;
	createWindow();
	autoUpdater.checkForUpdates().then((UpdateCheckResults) => {
		log.info('Update check results:', UpdateCheckResults);
	});
	InitiateBackup();
}

async function createWindow() {
	const startMinimized = process.argv.includes('--hidden') && (await store.get('startMinimized'));
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

	MainWindowWrapper.init(mainWindow);

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

	mainWindow?.on('close', async (event) => {
		if (!app.isQuiting && !(await store.get('quitOnClose'))) {
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

function sanitizeInput(input) {
	let res = validator.escape(input);
	res = res.trim();
	return res;
}

ipcMain.handle('get-wow-path', async () => {
	return await getWoWPath();
});

async function onFilePathSelected(folderPath) {
	const relativePath = await store.get('relativePath');
	log.info('Selected path:', folderPath, 'relative path:', relativePath);
	if (!relativePath) {
		log.info('Relative path not set, skipping');
		renderer_log('Relative path not set, skipping');
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
		renderer_log('No path selected');
	}
}

ipcMain.handle('check-for-login', async () => {
	const token = await store.get('authToken');
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

ipcMain.handle('store-set', async (event, key, value) => await store.set(key, value));
ipcMain.handle('store-get', async (event, key) => await store.get(key));

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
	const selectedPath = result.filePaths[0];
	// check if selected path is not somewhere within the WoW folder
	if (selectedPath) {
		if (isPathWithin(await getWoWPath(), selectedPath)) {
			log.info('Selected path is within WoW folder, skipping');
			renderer_log('Selected path is within WoW folder, skipping');
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
function isPathWithin(basePath, targetPath) {
	const resolvedBasePath = path.resolve(basePath);
	const resolvedTargetPath = path.resolve(targetPath);
	return resolvedTargetPath.startsWith(resolvedBasePath);
}

let currentAbortController = null;
async function getFolderSize(folderPath, signal) {
	let totalSize = 0;

	async function calculateSize(directory) {
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
			} catch (error) {
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
	console.log('Total size:', totalSizeInMB.toFixed(2), 'MB');
	return totalSizeInMB.toFixed(2); // Return size in MB with 2 decimal places
}

ipcMain.handle('get-size-of-backups-folder', async () => {
	if (currentAbortController) {
		currentAbortController.abort(); // Cancel the previous run
	}

	currentAbortController = new AbortController();
	const { signal } = currentAbortController;

	const folderPath = await store.get('backupsPath');
	if (!folderPath) {
		console.log('No path set');
		return { error: 'No path set' };
	}

	try {
		const size = await getFolderSize(folderPath, signal);
		return { size };
	} catch (error) {
		if (error.message === 'Operation aborted') {
			return { aborted: true };
		}
		throw error;
	} finally {
		currentAbortController = null; // Reset the controller after the operation
	}
});

ipcMain.on('open-backups-folder', async (event) => {
	const folderPath = await store.get('backupsPath');
	console.log('Opening backups folder:', folderPath);
	if (folderPath) {
		shell.openPath(folderPath);
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
			await store.set('authToken', data.token);
			log.info('Login successful');
			return { success: true, error: null };
		} else {
			log.info('Login failed invalid credentials');
			return { success: false, error: 'invalid credentials' };
		}
	} catch (err) {
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
				Authorization: `Bearer ${await store.get('authToken')}`,
			},
		})
		.then((response) => response.json())
		.catch((error) => console.error('Error fetching files data:', error));
});

ipcMain.on('connect', async () => {
	log.info('Connecting to server');
	const token = await store.get('authToken');
	socket.auth = { token };
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
		console.log('Error requesting file:', error);
	}
});

socket.on('connect', () => {
	log.info('Connected to server');
	mainWindow?.webContents.send('connect');
});

// in case of something cursed happens we try to reconnect every 1 sec for 15 times
const totalReconnectAttempts = 15;
let manualReconnectAttempt = 0;
let reconnectScheduled = false;
socket.on('connect_error', async (error) => {
	// change xhr poll error with server is not avaliable
	if (error.message.includes('xhr poll error')) {
		error = new Error('Server is unavailable.');
	}

	mainWindow?.webContents.send('connect-error', error);
	log.error('Connection error:', error);
	const token = await store.get('authToken');

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

	const localFileHash = await CalculateHashForPath(localFilePath);
	log.info(`Local File Hash: ${localFileHash}, Server File Hash: ${serverFile.hash}`);
	const shouldDownload = localFileHash !== serverFile.hash;
	if (shouldDownload) {
		return [shouldDownload, L['Update']];
	} else {
		return [shouldDownload, L['Up to date']];
	}
}

async function compressAndSend(folderPath, fileData) {
	const baseName = path.basename(folderPath);
	const outputPath = path.join(TEMP_DIR, baseName + '.zip');
	await fsp.mkdir(path.dirname(outputPath), { recursive: true });

	try {
		await zipFile(folderPath, outputPath);
		log.info('File compressed and saved:', outputPath);
		// Send the file
		await sendFile(outputPath, fileData);
	} catch (error) {
		log.error('Error compressing and sending file:', error);
		renderer_log('Error compressing and sending file:', error);
		return;
	} finally {
		// Clean up the zip file after sending
		await fsp.rm(outputPath, { recursive: true });
	}
}

async function sendFile(filePath, fileData) {
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
			Authorization: `Bearer ${await store.get('authToken')}`,
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
	const backupsPath = await store.get('backupsPath');
	// delete old backups untill there is only 1 backup left or the folder size is less than maxSise setting
	const maxSiseMB = await store.get('maxBackupsFolderSize'); // in MB
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
			files.push({ file, size: stats.size });
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
		UpdateBackupStatus('Backup deleted: ' + filePath);
		if (totalSize - deletedSize < maxSise) {
			break;
		}
	}
	log.info('Deleted size:', deletedSize);
	mainWindow?.webContents.send('backup-created');
}

async function BackupWTFFolder() {
	const wowPath = await getWoWPath();
	const wtfPath = path.join(wowPath, '_retail_', 'WTF');
	const backupsPath = await store.get('backupsPath');

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
const ONE_WEEK = 1000 * 60 * 60 * 24 * 7;
// const ONE_MINUTE = 1000 * 60;

function UpdateBackupStatus(status) {
	mainWindow?.webContents.send('backup-status', status);
}

let backupProgressTimer = null;
function ScheduleBackupStatus(status) {
	if (backupProgressTimer) {
		clearInterval(backupProgressTimer);
	}
	let c = 1;
	backupProgressTimer = setInterval(() => {
		UpdateBackupStatus(status + '.'.repeat(c));
		c++;
		if (c > 3) c = 1;
	}, 500);
}

async function InitiateBackup(force) {
	if (!socket.connected) {
		log.info('Socket is not connected, skipping backup');
		return;
	}

	if (isBackupRunning) {
		log.info('Backup is already running, skipping');
		return;
	}

	const backupsEnabled = await store.get('backupsEnabled');
	if (!backupsEnabled && !force) {
		log.info('Backups are disabled, skipping');
		UpdateBackupStatus('Backups are disabled');
		return;
	}
	log.info('Initiating backup');

	const lastBackup = await store.get('lastBackupTime');
	// 1 week
	const backupInterval = ONE_WEEK;
	const now = Date.now();
	if (force || !lastBackup || now - lastBackup > backupInterval) {
		isBackupRunning = true;
		try {
			ScheduleBackupStatus('Deleting old backups');
			await DeleteOverSizeBackupFiles();
			ScheduleBackupStatus('Creating backup');
			await BackupWTFFolder();
			await store.set('lastBackupTime', now);
			ScheduleBackupStatus('Deleting old backups');
			await DeleteOverSizeBackupFiles();
			UpdateBackupStatus('Backup completed!');
		} catch (error) {
			log.error('Error during backup:', error);
			UpdateBackupStatus('Backup failed ' + error);
		} finally {
			isBackupRunning = false;
			clearInterval(backupProgressTimer);
		}
	} else {
		const nextBackup = lastBackup + backupInterval;
		const date = new Date(nextBackup);
		UpdateBackupStatus('Next backup will be done: ' + date.toLocaleString());
		console.log('Next backup in:', date.toLocaleString());
	}
}

ipcMain.on('initiate-backup', (event, data) => {
	InitiateBackup(data);
});

// every 10 min
setInterval(async () => {
	InitiateBackup();
}, 1000 * 60 * 10);
