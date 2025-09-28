console.log('loading preload script');
import { contextBridge, ipcRenderer } from 'electron';

async function store_get(key: any) {
	if (key === 'authToken') return null;
	return await ipcRenderer.invoke('store-get', key);
}

async function store_set(key: any, value: any) {
	return await ipcRenderer.invoke('store-set', key, value);
}


contextBridge.exposeInMainWorld('api', {
	onFileDownloadError: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('file-download-error', callback),
	getLanguage: () => ipcRenderer.invoke('get-language'),
	IPCinvoke: ipcRenderer.invoke,
	IPCsend: ipcRenderer.send,
	// log: log,
	/*
	returns: {username: string, role: string} | null
	*/
	on_i18n_ready: () => ipcRenderer.invoke('i18n'),
	check_for_login: () => ipcRenderer.invoke('check-for-login'),
	// socket
	socket_connect: () => ipcRenderer.send('connect'),
	socket_on_connect: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('connect', callback),
	socket_on_connect_error: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('connect-error', callback),
	socket_on_disconnect: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('disconnect', callback),
	socket_on_new_file: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('new-file', callback),
	socket_on_file_not_found: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('file-not-found', callback),
	socket_on_file_deleted: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('file-deleted', callback),
	socket_emit_delete_file: (data: FileData) => ipcRenderer.send('delete-file', data),
	store: {
		set: store_set,
		get: store_get,
		onSync: (key: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
			ipcRenderer.send('store-sync-request', key); // subscribe to changes for the key
			ipcRenderer.on('store-sync', (_, changedKey, val) => changedKey === key && callback(val))
		},
	},
	// ipcRenderer callbacks
	IR_onLog: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('log', callback),
	IR_onFileChunkReceived: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('file-chunk-received', callback),
	IR_onFileDownloaded: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('file-downloaded', callback),
	IR_onConnectedClients: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('connected-clients', callback),
	// ipcRenderer sends
	/*
	returns: success, error
	*/
	IR_sendLogin: (credentials: { username: string; password: string }) => ipcRenderer.invoke('login', credentials),
	IR_minimizeApp: () => ipcRenderer.send('minimize-app'),
	IR_closeApp: () => ipcRenderer.send('close-app'),
	IR_maximizeAppToggle: () => ipcRenderer.send('maximize-app-toggle'),
	IR_onMaximizeAppToggle: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('maximize-app-changed', callback),
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
	requestFile: (data: FileData) => ipcRenderer.send('request-file', data),
	shouldDownloadFile: (data: FileData) => ipcRenderer.invoke('should-download-file', data),
	getSizeOfBackupsFolder: () => ipcRenderer.invoke('get-size-of-backups-folder'),
	IR_OpenLogsFolder: () => ipcRenderer.send('open-logs-folder'),
	IR_openBackupsFolder: () => ipcRenderer.send('open-backups-folder'),
	IR_onBackupCreated: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('backup-created', callback),
	IR_InitiateBackup: (force: boolean) => ipcRenderer.send('initiate-backup', force),
	IR_onBackupStatus: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('backup-status', callback),
	IPC_onUncaughtException: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('uncaughtException', callback),
	IPC_onUnhandledRejection: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('unhandledRejection', callback),
	// wcl
	IR_WCL_GetAuthLink: () => ipcRenderer.invoke('wcl-request-auth-link'),
	IR_requestWCLReports: () => ipcRenderer.invoke('wcl-request-reports'),
	IR_requestWCLReportData: (reportCode: string) => ipcRenderer.invoke('wcl-request-report-data', { reportCode }),
	IR_requestWCLFightEvents: (reportCode: string, fightID: string) => ipcRenderer.invoke('wcl-request-fight-events', { reportCode, fightID }),
	IR_requestYouTubeVideoInfo: (URL: string) => ipcRenderer.invoke('request-youtube-video-info', URL),
	IR_OpenWCLDeath: (reportCode: string, fightID: number, deathID: number) => ipcRenderer.invoke('open-wcl-death', { reportCode, fightID, deathID }),
});

console.log('preload script loaded');
