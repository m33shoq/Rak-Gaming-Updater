console.log('Renderer process started');
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue';

const app = createApp(App)

app.use(createPinia());
app.mount('#app')

/*

let i18n: Record<string, string> = {};
let L = new Proxy(i18n, {
	get: (target, prop: string) => (prop in target ? target[prop] : prop),
});

api.on_i18n_ready().then((i18nReady) => {
	Object.assign(i18n, i18nReady); // Update the proxy target with the actual i18n object
	const translateDOM = () => {
		const elements = document.querySelectorAll('*');
		elements.forEach((element) => {
			if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE && element.textContent) {
				const text = element.textContent.trim();
				if (text) {
					const translatedText = L[text];
					if (translatedText !== text) {
						element.textContent = translatedText;
					}
				}
			}
		});
	};
	// Call the function to translate the DOM elements
	translateDOM();
});

const logsList = document.getElementById('logs-list') as HTMLUListElement;

let isConnected = false;
let userData: { username: string; role: string } | null = null;
const widgetContainerMap = new Map();
const filesListMap = new Map();
const widgetContainer = document.getElementById('updater-frame') as HTMLDivElement;

const REFRESH_BTN = document.getElementById('refresh-btn') as HTMLButtonElement;
const UPDATER_FRAME = document.getElementById('updater-frame') as HTMLDivElement;
const FILES_LIST = document.getElementById('files-list') as HTMLDivElement;
const SELECT_PATH_BTN = document.getElementById('select-path-btn') as HTMLButtonElement;
const SELECTED_PATH = document.getElementById('selected-path') as HTMLSpanElement;
const RELATIVE_PATH = document.getElementById('relative-path') as HTMLSpanElement;
const AUTO_UPDATE_CHECKBOX = document.getElementById('auto-update-checkbox') as HTMLInputElement;
const START_WITH_WINDOWS_CHECKBOX = document.getElementById('start-with-windows-checkbox') as HTMLInputElement;
const START_MINIMIZED_CHECKBOX = document.getElementById('start-minimized-checkbox') as HTMLInputElement;
const QUIT_ON_CLOSE = document.getElementById('quit-on-close') as HTMLInputElement;
const MAX_BACKUPS_FOLDER_SIZE_SELECT = document.getElementById('max-backups-folder-size-select') as HTMLSelectElement;
const BACKUPS_ENABLE = document.getElementById('backups-enable') as HTMLInputElement;
const BACKUPS_PATH = document.getElementById('backups-path') as HTMLSpanElement;
const BACKUPS_FOLDER_SIZE = document.getElementById('backups-folder-size') as HTMLSpanElement;
const BACKUPS_LAST_BACKUP_TIME = document.getElementById('backups-last-backup-time') as HTMLSpanElement;
const BACKUPS_STATUS = document.getElementById('backups-status') as HTMLSpanElement;
const SET_BACKUP_PATH_BTN = document.getElementById('set-backups-path-btn') as HTMLButtonElement;
const OPEN_BACKUPS_PATH_BTN = document.getElementById('open-backups-path-btn') as HTMLButtonElement;
const BACKUP_NOW_BTN = document.getElementById('backup-now-btn') as HTMLButtonElement;

const ADD_FILES_BTN = document.getElementById('add-files-btn') as HTMLButtonElement;
const ADD_FOLDER_BTN = document.getElementById('add-folder-btn') as HTMLButtonElement;
const SET_RELATIVE_PATH_BTN = document.getElementById('set-relative-path-btn') as HTMLButtonElement;

const CLIENTS_LIST = document.getElementById('clients-list') as HTMLDivElement;

let filesData: { files: FileData[] } = { files: [] };

async function onNewFile(fileData: FileData) {
	addFileToWidget(fileData);
	if (isAdmin()) {
		addFileToAdminWidget(fileData);
	}
	if ((await api.store.get('autoupdate')) == true) {
		const [shouldDownload, reason] = await api.shouldDownloadFile(fileData);
		console.log('ShouldDownloadFile:', shouldDownload, reason);
		if (shouldDownload && reason === L['Update']) {
			// this is very sketchy to check for localized string
			console.log('Auto updating file:', fileData.fileName);
			api.requestFile(fileData);
		} else {
			console.log('File is up to date:', fileData.fileName);
		}
	}
}

async function initializeSocket() {
	userData = await api.check_for_login();
	if (userData) {
		api.socket_connect();
	} else {
		showLogin();
	}

	api.socket_on_connect(() => {
		isConnected = true;
		console.log('Socket connected');
		log(`Connected at ${new Date().toLocaleString()}`);
		widgetContainerMap.clear();
		filesListMap.clear();
		document.getElementById('updater-frame')!.innerHTML = '';
		document.getElementById('files-list')!.innerHTML = '';

		showMain();
		requestFilesData();
	});

	api.socket_on_disconnect((event, description) => {
		isConnected = false;
		console.log(`Socket Disconnected`, description);
		log(`Disconnected at ${new Date().toLocaleString()}`);
		document.getElementById('disconnect-reason')!.innerText = `${L['Disconnected']}: ${description}`;
		document.getElementById('login-error')!.innerText = ``;
		showLogin();
	});

	api.socket_on_connect_error((event, description) => {
		console.log('Connect failed:', description);
		document.getElementById('login-error')!.innerText = description;
	});

	api.socket_on_new_file(async (event, data) => {
		console.log('New file available:', data, data.fileName);
		log(`New file available: ${data.fileName} at ${new Date().toLocaleString()}`);
		onNewFile(data);
	});

	api.socket_on_file_not_found((event, data) => {
		console.log('File not found:', data);
		log(`File not found: ${data.fileName} at ${new Date().toLocaleString()}`);
	});

	api.socket_on_file_deleted((event, data) => {
		log(`File deleted from the server: ${data.fileName} at ${new Date().toLocaleString()}`);

		removeFileFromWidget(data);
		if (isAdmin()) {
			removeFileFromAdminWidget(data);
		}
	});

	api.IR_onFileChunkReceived((event, fileData, percent) => {
		const { fileName, relativePath, timestamp, hash, displayName } = fileData;
		console.log('File chunk received:', fileName, percent);
		const uniqueId = generateUniqueId(fileData);
		const lineItem = widgetContainerMap.get(uniqueId);

		if (lineItem) {
			const updateBtn = lineItem.querySelector('.update-btn');
			updateBtn.Disable(`${L['Downloading...']} ${percent}%`);
			updateBtn.UpdateDownloadTimer();
		}
	});

	api.IR_onFileDownloaded((event, data) => {
		console.log('File downloaded:', data.fileName);
		console.log('File downloaded:', data);
		log(`File downloaded: ${data.fileName} at ${new Date().toLocaleString()}`);
		const uniqueId = generateUniqueId(data);
		const lineItem = widgetContainerMap.get(uniqueId);
		if (lineItem) {
			const updateBtn = lineItem.querySelector('.update-btn');
			updateBtn.Disable(L['Up to date']); // maybe should use .Update here but it's not necessary
		}
	});
}

document.getElementById('login-btn')!.addEventListener('click', async () => {
	const username = (document.getElementById('username') as HTMLInputElement).value;
	const password = (document.getElementById('password') as HTMLInputElement).value;

	let { success, error } = await api.IR_sendLogin({ username, password });
	console.log('Login result:', success, error);

	if (success) {
		// we recieved token so we can try to connect to the socket
		console.log('Login successful');
		userData = await api.check_for_login();
		console.log(userData);
		api.socket_connect();
	} else {
		console.log('Login failed:', error);
		document.getElementById('login-error')!.innerText = error;
	}
});

document.getElementById('minimize-btn')!.addEventListener('click', () => {
	api.IR_minimizeApp();
});

document.getElementById('close-btn')!.addEventListener('click', () => {
	api.IR_closeApp();
});

api.IR_GetAppVersion().then((version) => {
	document.getElementById('version')!.innerText = `Version ${version}`;
});

function log(...args: string[]) {
	const logItem = document.createElement('li');
	logItem.innerText = args.join(' ');
	if (logsList.firstChild) {
		logsList.insertBefore(logItem, logsList.firstChild);
	} else {
		logsList.appendChild(logItem);
	}
}

api.IR_onLog((event, data) => {
	log(data);
});

function isAdmin() {
	return userData && userData.role === 'admin';
}

const tab_buttons: { [tabName: string]: HTMLButtonElement } = {};
const admin_tabs: { [tabName: string]: true } = {
	admin: true,
	status: true,
};

function showLogin() {
	console.log('Displaying login screen');
	document.querySelectorAll<HTMLElement>('.tab-content').forEach((tab) => (tab.style.display = 'none'));
	const loginContainer = document.getElementById('login-container') as HTMLElement;
	loginContainer.style.display = 'block';

	// hide tab buttons while on login screen
	document.querySelectorAll<HTMLElement>('.tab-button').forEach((button) => {
		console.log('Hiding button:', button.dataset.tabName);
		button.style.display = 'none';
	});
}

function showMain() {
	if (!isConnected) return showLogin();
	tab_buttons['main'].click();
}

function showAdmin() {
	if (!isConnected) return showLogin();
	if (isAdmin()) {
		tab_buttons['admin'].click();
	} else {
		showMain();
	}
}

function showSettings() {
	if (!isConnected) return showLogin();
	tab_buttons['settings'].click();
}

function showStatus() {
	if (!isConnected) return showLogin();
	tab_buttons['status'].click();
}

function showBackups() {
	if (!isConnected) return showLogin();
	tab_buttons['backups'].click();
}

document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
	const tabName = button.dataset.tabName as string;
	console.log('Tab name:', tabName);
	tab_buttons[tabName] = button;
	button.addEventListener('click', () => {
		// update all tabs visibility based on user role
		document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
			const tabName = button.dataset.tabName as string;
			if (admin_tabs[tabName] && !isAdmin()) {
				button.style.display = 'none';
			} else {
				button.style.display = 'block';
			}
		});

		if (tabName === 'admin' && !isAdmin()) {
			return;
		}

		if (tabName === 'backups') {
			updateBackupsTexts();
		}

		document.querySelectorAll<HTMLElement>('.tab-content').forEach((tab) => (tab.style.display = 'none'));
		(document.getElementById(`${tabName}-container`) as HTMLElement).style.display = 'block';

		document.querySelectorAll('.tab-button').forEach((btn) => btn.classList.remove('active'));
		button.classList.add('active');
		console.log('Switching to tab:', tabName);
	});
});

function generateUniqueId({ fileName, relativePath, timestamp, hash }: FileData) {
	return `${fileName}^${relativePath}^${timestamp}^${hash}`;
}

function ButtonEnable(this: ListUpdateButton, text: string) {
	this.disabled = false;
	this.classList.remove('disabled-btn');
	this.textContent = text;
}

function ButtonDisable(this: ListUpdateButton, text: string) {
	console.log('Disabling button:', text);
	this.disabled = true;
	this.classList.add('disabled-btn');
	this.textContent = text;
}

function ButtonOnClick(this: ListUpdateButton) {
	const data = this.fileData;
	this.Disable(L['Fetching...']);
	this.UpdateDownloadTimer();
	api.requestFile(data);
}

async function ButtonUpdate(this: ListUpdateButton) {
	const data = this.fileData;
	this.Disable(L['Checking...']);
	const [shouldDownload, reason] = await api.shouldDownloadFile(data);
	if (!shouldDownload) {
		this.Disable(reason);
	} else {
		this.Enable(reason);
		this.addEventListener('click', ButtonOnClick);
	}
}

function ButtonUpdateDownloadTimer(this: ListUpdateButton) {
	if (this.downloadTimer) clearTimeout(this.downloadTimer);
	this.downloadTimer = setTimeout(() => {
		this.Update();
	}, 5000);
}

async function addFileToWidget(fileData: FileData) {
	const uniqueId = generateUniqueId(fileData);
	if (widgetContainerMap.has(uniqueId)) {
		console.log('File already exists in widget:', fileData.fileName);
		return;
	}

	const lineItem = document.createElement('div');
	widgetContainerMap.set(uniqueId, lineItem);
	lineItem.className = 'line-item';

	let time = new Date(fileData.timestamp * 1000).toLocaleString();

	// Create the inner HTML structure to include file name, relative path, and timestamp
	lineItem.innerHTML = `
    <div class="file-info-container" id=${uniqueId}>
      <div class="file-name-path">
        <span>${fileData.displayName || fileData.fileName}\n
        ${fileData.relativePath}</span>
      </div>
      <div class="uploaded-time-container">
        <span>${time}</span>
      </div>
      <button class="update-btn">Update</button>
    </div>
  `;

	// Find the button within the newly created structure
	const updateBtn = lineItem.querySelector('.update-btn') as ListUpdateButton;
	updateBtn.fileData = fileData;
	updateBtn.Disable = ButtonDisable;
	updateBtn.Enable = ButtonEnable;
	updateBtn.Update = ButtonUpdate;
	updateBtn.UpdateDownloadTimer = ButtonUpdateDownloadTimer;

	updateBtn.Disable(L['Up to date']);
	updateBtn.Update();

	widgetContainer.appendChild(lineItem);
}
function removeFileFromWidget(fileData: FileData) {
	const uniqueId = generateUniqueId(fileData);
	const lineItem = widgetContainerMap.get(uniqueId);
	if (lineItem) {
		lineItem.parentNode.removeChild(lineItem);
		lineItem.remove();
		widgetContainerMap.delete(uniqueId);
	}
}

function UpdateFileWidget() {
	widgetContainer.querySelectorAll('.line-item').forEach((lineItem) => {
		const updateBtn = lineItem.querySelector('.update-btn') as ListUpdateButton;
		updateBtn.Update();
	});
}

REFRESH_BTN.addEventListener('click', async function () {
	this.classList.add('disabled-btn');
	this.disabled = true;

	setTimeout(() => {
		this.classList.remove('disabled-btn');
		this.disabled = false;
	}, 4000);

	console.log('Requesting files data');
	widgetContainerMap.clear();
	filesListMap.clear();
	UPDATER_FRAME.innerHTML = '';
	FILES_LIST.innerHTML = '';
	filesData = await api.fetchFilesData();

	console.log('Files data:', filesData);
	filesData.files.forEach(onNewFile);
});

async function requestFilesData() {
	REFRESH_BTN.click();
}

SELECT_PATH_BTN.addEventListener('click', async () => {
	console.log('Select WoW path button clicked');
	const selectedPath = await api.IR_selectUpdatePath();
	if (selectedPath) {
		await api.store.set('updatePath', selectedPath);
	} else {
		await api.store.set('updatePath', null);
	}
	const updatePath = await api.IR_GetWoWPath();
	SELECTED_PATH.innerText = `${L['Wow Path']}: ${updatePath || 'None'}`;
	UpdateFileWidget();
});

(async () => {
	const updatePath = await api.IR_GetWoWPath();
	const relativePath = await api.store.get('relativePath');
	const autoupdate = await api.store.get('autoupdate');
	const startWithWindows = await api.store.get('startWithWindows');
	const startMinimized = await api.store.get('startMinimized');
	const quitOnClose = await api.store.get('quitOnClose');
	console.log('autoupdate:', autoupdate);
	SELECTED_PATH.innerText = `${L['Wow Path']}: ${updatePath || 'None'}`;
	RELATIVE_PATH.innerText = `${L['Relative Path']}: ${relativePath || 'None'}`;
	AUTO_UPDATE_CHECKBOX.checked = autoupdate == true;
	START_WITH_WINDOWS_CHECKBOX.checked = startWithWindows == true;
	START_MINIMIZED_CHECKBOX.checked = startMinimized == true;
	QUIT_ON_CLOSE.checked = quitOnClose == true;

	const maxBackupsFolderSize = await api.store.get('maxBackupsFolderSize');
	MAX_BACKUPS_FOLDER_SIZE_SELECT.value = maxBackupsFolderSize || 0;

	const backupsEnable = await api.store.get('backupsEnabled');
	BACKUPS_ENABLE.checked = backupsEnable == true;

	const backupsPath = await api.store.get('backupsPath');
	BACKUPS_PATH.innerText = `${L['Backups Path']}: ${backupsPath || 'None'}`;
	updateBackupsTexts();
})();

function updateBackupsTexts() {
	// set 'In progress' text
	BACKUPS_FOLDER_SIZE.innerText = `${L['Backups Size']}: ${L['In progress']}`;
	BACKUPS_LAST_BACKUP_TIME.innerText = `${L['Last backup made']}: ${L['In progress']}`;

	api.getSizeOfBackupsFolder().then(async (backupsSize) => {
		if (backupsSize.size) {
			const maxBackupsFolderSize = await api.store.get('maxBackupsFolderSize');
			const backupsSizePercent = (backupsSize.size / maxBackupsFolderSize) * 100;
			BACKUPS_FOLDER_SIZE.innerText = `${L['Backups Size']}: ${backupsSize.size}MB (${backupsSizePercent.toFixed(2)}%)`;
			BACKUPS_FOLDER_SIZE.classList.remove('red-text');
		} else if (backupsSize.aborted) {
			// aborted due to function was called before the previous one finished
			BACKUPS_FOLDER_SIZE.innerText = `${L['Backups Size']}: ${L['In progress']}`;
			BACKUPS_FOLDER_SIZE.classList.remove('red-text');
		} else {
			// red colored no folder found
			BACKUPS_FOLDER_SIZE.innerText = `${L['Backups Size']}: ${L[backupsSize.error || 'No backups folder found']}`;
			BACKUPS_FOLDER_SIZE.classList.add('red-text');
		}

		const lastBackupTime = await api.store.get('lastBackupTime');
		if (lastBackupTime) {
			const lastBackupDate = new Date(lastBackupTime).toLocaleString();
			BACKUPS_LAST_BACKUP_TIME.innerText = `${L['Last backup made']}: ${lastBackupDate}`;
		} else {
			BACKUPS_LAST_BACKUP_TIME.innerText = `${L['Last backup made']}: ${L['No backups made yet']}`;
		}
	});
}
api.IR_onBackupCreated((event, data) => {
	updateBackupsTexts();
});

AUTO_UPDATE_CHECKBOX.addEventListener('change', () => {
	api.store.set('autoupdate', AUTO_UPDATE_CHECKBOX.checked);
});

START_WITH_WINDOWS_CHECKBOX.addEventListener('change', () => {
	api.IR_setStartWithWindows(START_WITH_WINDOWS_CHECKBOX.checked);
});

START_MINIMIZED_CHECKBOX.addEventListener('change', () => {
	api.store.set('startMinimized', START_MINIMIZED_CHECKBOX.checked);
});

QUIT_ON_CLOSE.addEventListener('change', () => {
	api.store.set('quitOnClose', QUIT_ON_CLOSE.checked);
});

function addFileToAdminWidget(fileData: FileData) {
	const uniqueId = generateUniqueId(fileData);
	if (filesListMap.has(uniqueId)) {
		console.log('File already exists in admin widget:', fileData.fileName);
		return;
	}

	const div = document.createElement('div');
	filesListMap.set(uniqueId, div);

	let time = new Date(fileData.timestamp * 1000).toLocaleString();
	div.innerHTML = `
		<div class="file-info-container">
			<div class="file-name-path">
				<span>${fileData.displayName || fileData.fileName}\n
				${fileData.relativePath}</span>
			</div>
			<div class="uploaded-time-container">
				<span>${time}</span>
			</div>
			<button class="delete-btn">Delete</button>
		</div>
	`;
	div.classList.add('line-item');
	FILES_LIST.appendChild(div);

	const deleteBtn = div.querySelector('.delete-btn') as HTMLButtonElement;

	deleteBtn.addEventListener('click', () => {
		console.log(`Deleting file: ${fileData.fileName}`);
		api.socket_emit_delete_file(fileData);
	});
}
function removeFileFromAdminWidget(fileData: FileData) {
	const uniqueId = generateUniqueId(fileData);
	const lineItem = filesListMap.get(uniqueId);
	if (lineItem) {
		lineItem.parentNode.removeChild(lineItem);
		lineItem.remove();
		filesListMap.delete(uniqueId);
	}
}

ADD_FILES_BTN.addEventListener('click', () => {
	api.IR_openFileDialogFile();
});

ADD_FOLDER_BTN.addEventListener('click', () => {
	api.IR_openFileDialogFolder();
});

SET_RELATIVE_PATH_BTN.addEventListener('click', async () => {
	console.log('Select WoW path button clicked');
	const path = await api.IR_selectRelativePath();
	if (path) {
		RELATIVE_PATH.innerText = `${L['Relative Path']}: ${path}`;
		api.store.set('relativePath', path);
	} else {
		RELATIVE_PATH.innerText = `${L['Relative Path']}: ${L['Invalid Path Supplied']}`;
		api.store.set('relativePath', null);
	}
});

MAX_BACKUPS_FOLDER_SIZE_SELECT.addEventListener('change', async (event) => {
	const selectElement = event.target as HTMLSelectElement;
	const value = parseInt(selectElement.value, 10);
	await api.store.set('maxBackupsFolderSize', value);
	updateBackupsTexts();
	api.IR_InitiateBackup(false);
});

BACKUPS_ENABLE.addEventListener('change', async () => {
	await api.store.set('backupsEnabled', BACKUPS_ENABLE.checked);
	api.IR_InitiateBackup(false);
});

SET_BACKUP_PATH_BTN.addEventListener('click', async () => {
	const path = await api.IR_selectBackupsPath();
	if (path.success) {
		BACKUPS_PATH.innerText = `${L['Backups Path']}: ${path.path}`;
		await api.store.set('backupsPath', path.path);
		updateBackupsTexts();
		api.IR_InitiateBackup(false);
	} else {
		BACKUPS_PATH.innerText = `${L['Backups Path']}: ${L[path.message || 'Invalid Path Supplied']}`;
		await api.store.set('backupsPath', null);
		updateBackupsTexts();
	}
});

OPEN_BACKUPS_PATH_BTN.addEventListener('click', async () => {
	api.IR_openBackupsFolder();
});

api.IR_onBackupStatus((event, data) => {
	BACKUPS_STATUS.innerText = data;
});

BACKUP_NOW_BTN.addEventListener('click', () => {
	api.IR_InitiateBackup(true);
});

initializeSocket();

api.IR_onConnectedClients((event, clients) => {
	if (!isAdmin) return;

	CLIENTS_LIST.innerHTML = '';
	clients.forEach((client: { username: string; role: string }) => {
		const clientItem = document.createElement('li');
		clientItem.innerText = `${client.username}(${client.role})`;
		if (CLIENTS_LIST.firstChild) {
			CLIENTS_LIST.insertBefore(clientItem, CLIENTS_LIST.firstChild);
		} else {
			CLIENTS_LIST.appendChild(clientItem);
		}
	});
});

showLogin();

*/
console.log('Renderer process initialized');
