console.log('preload.js loaded');
const { contextBridge, ipcRenderer } = require('electron');

async function store_get(key) {
	if (key === 'authToken') return null;
	return await ipcRenderer.invoke('store-get', key);
}

async function store_set(key, value) {
	return await ipcRenderer.invoke('store-set', key, value);
}

contextBridge.exposeInMainWorld('api', {
	/*
	returns: {username: string, role: string} | null
	*/
	on_i18n_ready: (callback) => ipcRenderer.invoke('i18n', callback),
	check_for_login: () => ipcRenderer.invoke('check-for-login'),
	// socket
	socket_connect: () => ipcRenderer.send('connect'),
	socket_on_connect: (callback) => ipcRenderer.on('connect', callback),
	socket_on_connect_error: (callback) => ipcRenderer.on('connect-error', callback),
	socket_on_disconnect: (callback) => ipcRenderer.on('disconnect', callback),
	socket_on_new_file: (callback) => ipcRenderer.on('new-file', callback),
	socket_on_file_not_found: (callback) => ipcRenderer.on('file-not-found', callback),
	socket_on_file_deleted: (callback) => ipcRenderer.on('file-deleted', callback),
	socket_emit_delete_file: (data) => ipcRenderer.send('delete-file', data),
	store: {
		set: store_set,
		get: store_get,
	},
	// ipcRenderer callbacks
	IR_onLog: (callback) => ipcRenderer.on('log', callback),
	IR_onFileChunkReceived: (callback) => ipcRenderer.on('file-chunk-received', callback),
	IR_onFileDownloaded: (callback) => ipcRenderer.on('file-downloaded', callback),
	IR_onConnectedClients: (callback) => ipcRenderer.on('connected-clients', callback),
	// ipcRenderer sends
	/*
	returns: success, error
	*/
	IR_sendLogin: (credentials) => ipcRenderer.invoke('login', credentials),
	IR_minimizeApp: () => ipcRenderer.send('minimize-app'),
	IR_closeApp: () => ipcRenderer.send('close-app'),
	IR_setStartWithWindows: (value) => ipcRenderer.send('set-start-with-windows', value),
	//
	IR_openFileDialogFile: () => ipcRenderer.send('open-file-dialog-file'),
	IR_openFileDialogFolder: () => ipcRenderer.send('open-file-dialog-folder'),
	IR_selectUpdatePath: () => ipcRenderer.invoke('select-update-path'),
	IR_selectRelativePath: () => ipcRenderer.invoke('select-relative-path'),
	IR_selectBackupsPath: () => ipcRenderer.invoke('select-backups-path'),
	IR_GetAppVersion: () => ipcRenderer.invoke('get-app-version'),
	IR_GetWoWPath: () => ipcRenderer.invoke('get-wow-path'),
	//
	fetchFilesData: () => ipcRenderer.invoke('request-files-data'),
	// fetchActiveUsers: () => {
	// 	return ipcRenderer.invoke('request-active-users')
	// },
	requestFile: (data) => ipcRenderer.send('request-file', data),
	shouldDownloadFile: (data) => ipcRenderer.invoke('should-download-file', data),
	getSizeOfBackupsFolder: () => ipcRenderer.invoke('get-size-of-backups-folder'),
	IR_openBackupsFolder: () => ipcRenderer.send('open-backups-folder'),
	IR_onBackupCreated: (callback) => ipcRenderer.on('backup-created', callback),
	IR_InitiateBackup: (force) => ipcRenderer.send('initiate-backup', force),
	IR_onBackupStatus: (callback) => ipcRenderer.on('backup-status', callback),
});
