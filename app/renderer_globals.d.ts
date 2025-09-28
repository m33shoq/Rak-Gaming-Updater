declare type FileData = {
	fileName: string; // Name of the file
	displayName: string; // Display name for the file
	hash: string; // Hash of the file or directory content
	relativePath: string; // Relative path of the file from the root directory
	timestamp: number; // Last modified timestamp in seconds
}

declare type YouTubeVideo = {
  id: string;
  title: string;
  author: string;
  authorID: string;
  startTime: number; // UNIX ms
  duration: number; // time in ms
  checkTime: number; // UNIX ms - time when the video was checked/added to the list
}

declare namespace api {
	function onFileDownloadError(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function getLanguage(): Promise<string>;
	function IPCinvoke(channel: string, ...args: any[]): Promise<any>;;
	function IPCsend(channel: string, ...args: any[]): void;
	function IR_OpenLogsFolder(): void;
	function on_i18n_ready(): Promise<any>;
	function check_for_login(): Promise<any>;
	function socket_connect(): void;
	function socket_on_connect(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_on_connect_error(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_on_disconnect(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_on_new_file(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_on_file_not_found(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_on_file_deleted(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function socket_emit_delete_file(data: FileData): void;
	namespace store {
		const set:(key: string, value: any) => Promise<void>;
		const get:(key: string) => Promise<any>;
		const onSync: (key: string, callback: (key, newValue) => void) => void;
	}
	function IR_onLog(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IR_onFileChunkReceived(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IR_onFileDownloaded(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IR_onConnectedClients(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IR_sendLogin(credentials: { username: string; password: string }): Promise<any>;
	function IR_minimizeApp(): void;
	function IR_closeApp(): void;
	function IR_maximizeAppToggle(): void;
	function IR_onMaximizeAppToggle(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;

	function IR_openFileDialogFile(): void;
	function IR_openFileDialogFolder(): void;
	function IR_selectUpdatePath(): Promise<any>;
	function IR_selectRelativePath(): Promise<any>;
	function IR_selectBackupsPath(): Promise<any>;
	function IR_GetAppVersion(): Promise<any>;
	function IR_GetWoWPath(): Promise<any>;
	function fetchFilesData(): Promise<any>;
	function requestFile(data: FileData): void;
	function shouldDownloadFile(data: FileData): Promise<any>;
	function getSizeOfBackupsFolder(): Promise<any>;
	function IR_openBackupsFolder(): void;
	function IR_onBackupCreated(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IR_InitiateBackup(force: boolean): void;
	function IR_onBackupStatus(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IPC_onUncaughtException(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	function IPC_onUnhandledRejection(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void): void;
	// wcl
	function IR_WCL_GetAuthLink(): Promise<any>;
	function IR_requestWCLReports(): Promise<any>;
	function IR_requestWCLReportData(reportCode: string): Promise<any>;
	function IR_requestWCLFightEvents(reportCode: string, fightID: number): Promise<any>;
	// youtube
	function IR_requestYouTubeVideoInfo(URL: string): Promise<any>;
}

