// IPC Events
export const IPC_EVENTS = {
	APP_GET_LANGUAGE: 'get-language',
	APP_I18N_READY_CALLBACK: 'i18n',
	APP_GET_VERSION: 'get-app-version',
	APP_UNCAUGHT_EXCEPTION_CALLBACK: 'uncaught-exception',
	APP_UNHANDLED_REJECTION_CALLBACK: 'unhandled-rejection',
	APP_OPEN_LOGS_FOLDER: 'open-logs-folder',


	LOGIN_SEND_CREDENTIALS: 'login',
	LOGIN_CHECK: 'check-for-login',

	SOCKET_INITIATE_CONNECT: 'connect',
	SOCKET_CONNECTED_CALLBACK: 'connected',
	SOCKET_CONNECT_ERROR_CALLBACK: 'connect-error',
	SOCKET_DISCONNECTED_CALLBACK: 'disconnect',
	SOCKET_NOT_ENOUGH_PERMISSIONS_CALLBACK: 'not-enough-permissions',

	UPDATER_DOWNLOAD_FILE: 'request-file',
	UPDATER_FETCH_FILES_LIST: 'request-files-data',
	UPDATER_GET_WOW_PATH: 'get-wow-path',
	UPDATER_FILE_ERROR_CALLBACK: 'file-download-error',
	UPDATER_NEW_FILE_CALLBACK: 'new-file',
	UPDATER_FILE_NOT_FOUND_CALLBACK: 'file-not-found',
	UPDATER_FILE_DELETED_CALLBACK: 'file-deleted',
	UPDATER_FILE_CHUNK_RECEIVED_CALLBACK: 'file-chunk-received',
	UPDATER_FILE_DOWNLOADED_CALLBACK: 'file-downloaded',
	UPDATER_SELECT_WOW_PATH: 'select-update-path',
	UPDATER_SHOULD_DOWNLOAD_FILE: 'should-download-file',

	PUSHER_OPEN_FILE_DIALOG: 'open-file-dialog-file',
	PUSHER_OPEN_FOLDER_DIALOG: 'open-file-dialog-folder',
	PUSHER_SELECT_RELATIVE_PATH: 'select-relative-path',
	PUSHER_FILE_DELETE: 'delete-file',


	BACKUPS_SELECT_BACKUP_FOLDER: 'select-backups-path',
	BACKUPS_GET_BACKUPS_SIZE: 'get-size-of-backups-folder',
	BACKUPS_OPEN_BACKUPS_FOLDER: 'open-backups-folder',
	BACKUPS_CREATED_CALLBACK: 'backup-created',
	BACKUPS_INITIATE: 'initiate-backup',
	BACKUPS_STATUS_CALLBACK: 'backup-status',


	STATUS_CONNECTED_CLIENTS_CALLBACK: 'connected-clients',

	WINDOW_CLOSE: 'window-close',
	WINDOW_MINIMIZE: 'window-minimize',
	WINDOW_MAXIMIZE_TOGGLE: 'window-maximize-toggle',
	WINDOW_MAXIMIZE_TOGGLE_CALLBACK: 'maximize-app-changed',




	YOUTUBE_VIDEO_INFO_UPDATED: 'youtube-video-info-updated',
	YOUTUBE_VIDEO_INFO_REQUEST: 'request-youtube-video-info',
	YOUTUBE_VIDEO_INFO_GET: 'youtube-video-info-get',
	YOUTUBE_VIDEO_INFO_ADD: 'youtube-video-info-add',
	YOUTUBE_OPEN_LINK: 'youtube-open-link',
	YOUTUBE_VIDEO_REFRESH: 'youtube-video-refresh',
	YOUTUBE_VIDEO_DELETE: 'youtube-video-delete',

	WCL_REQUEST_AUTH_LINK: 'wcl-request-auth-link',
	WCL_REQUEST_REPORTS_LIST: 'wcl-request-reports',
	WCL_REQUEST_REPORT_DATA: 'wcl-request-report-data',
	WCL_REQUEST_FIGHT_EVENTS: 'wcl-request-fight-events',
	WCL_OPEN_DEATH: 'open-wcl-death',
};



// Socket Events
export const SOCKET_EVENTS = {
	NEW_RELEASE: 'new-release',
	ERROR: 'error',
	NOT_ENOUGH_PERMISSIONS: 'not-enough-permissions',
	SERVER_SHUTDOWN: 'server-shutdown',

	STATUS_CONNECTED_CLIENTS: 'connected-clients',

	SOCKET_CONNECTED: 'connect',
	SOCKET_DISCONNECTED: 'disconnect',

	SV_INFO_UPDATE: 'sv-updater-info',

	UPDATER_NEW_FILE: 'new-file',
	UPDATER_FILE_NOT_FOUND: 'file-not-found',
	UPDATER_FILE_DELETED: 'file-deleted',
	UPDATER_DELETE_FILE: 'delete-file',

	YOUTUBE_VIDEO_INFO_UPDATED: 'youtube-video-info-updated',
	YOUTUBE_VIDEO_INFO_GET: 'youtube-video-info-get',
	YOUTUBE_VIDEO_INFO_ADD: 'youtube-video-info-add',
	YOUTUBE_VIDEO_DELETE: 'youtube-video-delete',
	YOUTUBE_VIDEO_REFRESH: 'youtube-video-refresh',

	WCL_REQUEST_AUTH_LINK: 'wcl-auth-link',
	WCL_REFRESH_TOKEN_UPDATE: 'wcl-refresh-token-update',
	WCL_REQUEST_TOKEN_REFRESH: 'wcl-refresh-token',
	WCL_REQUEST_REPORTS_LIST: 'wcl-reports-list',
	WCL_REQUEST_REPORT_DATA: 'wcl-report-data',
	WCL_REQUEST_FIGHT_EVENTS: 'wcl-fight-events',

};
