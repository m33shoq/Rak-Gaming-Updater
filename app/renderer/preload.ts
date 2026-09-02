console.log('loading preload script');
import { IPC_EVENTS } from '@/events';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

type SafeIpcListener = (event: Readonly<Record<string, never>>, ...args: unknown[]) => void;
type Subscription = {
	channel: string;
	listener: Parameters<typeof ipcRenderer.on>[1];
};

const ALLOWED_INVOKE_CHANNELS = new Set<string>([
	IPC_EVENTS.APP_GET_LANGUAGE,
	IPC_EVENTS.APP_GET_VERSION,
	IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_GET,
	IPC_EVENTS.LOGIN_SEND_CREDENTIALS,
	IPC_EVENTS.LOGIN_CHECK,
	IPC_EVENTS.UPDATER_FETCH_FILES_LIST,
	IPC_EVENTS.UPDATER_GET_WOW_PATH,
	IPC_EVENTS.UPDATER_SELECT_WOW_PATH,
	IPC_EVENTS.UPDATER_SHOULD_DOWNLOAD_FILE,
	IPC_EVENTS.PUSHER_SELECT_RELATIVE_PATH,
	IPC_EVENTS.PUSHER_UPLOADS_STATE_GET,
	IPC_EVENTS.BACKUPS_STATUS_GET,
	IPC_EVENTS.BACKUPS_SELECT_BACKUP_FOLDER,
	IPC_EVENTS.BACKUPS_GET_BACKUPS_SIZE,
	IPC_EVENTS.TIMELINE_WINDOW_OPEN,
	IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET,
	IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_GET,
	IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET,
	IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_STATUS_GET,
	IPC_EVENTS.YOUTUBE_VIDEO_INFO_GET,
	IPC_EVENTS.YOUTUBE_VIDEO_INFO_ADD,
	IPC_EVENTS.OBS_SETTINGS_GET,
	IPC_EVENTS.OBS_SETTINGS_SET,
	IPC_EVENTS.OBS_RECONNECT,
	IPC_EVENTS.WCL_AUTH_STATUS_GET,
	IPC_EVENTS.WCL_REQUEST_AUTH_LINK,
	IPC_EVENTS.WCL_REQUEST_REPORTS_LIST,
	IPC_EVENTS.WCL_REQUEST_REPORT_DATA,
	IPC_EVENTS.WCL_REQUEST_FIGHT_EVENTS,
	IPC_EVENTS.WCL_REQUEST_FIGHT_COOLDOWNS,
	IPC_EVENTS.WCL_REQUEST_FIGHT_BOSS_CASTS,
]);

const ALLOWED_SEND_CHANNELS = new Set<string>([
	IPC_EVENTS.APP_OPEN_LOGS_FOLDER,
	IPC_EVENTS.APP_UPDATE_RETRY,
	IPC_EVENTS.SOCKET_INITIATE_CONNECT,
	IPC_EVENTS.UPDATER_DOWNLOAD_FILE,
	IPC_EVENTS.PUSHER_OPEN_FILE_DIALOG,
	IPC_EVENTS.PUSHER_OPEN_FOLDER_DIALOG,
	IPC_EVENTS.PUSHER_FILE_DELETE,
	IPC_EVENTS.BACKUPS_OPEN_BACKUPS_FOLDER,
	IPC_EVENTS.BACKUPS_INITIATE,
	IPC_EVENTS.BACKUPS_ABORT,
	IPC_EVENTS.STATUS_REQUEST_LOGS,
	IPC_EVENTS.WINDOW_CLOSE,
	IPC_EVENTS.WINDOW_MINIMIZE,
	IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE,
	IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_SET,
	IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_READY,
	IPC_EVENTS.TIMELINE_WINDOW_CURSOR_SET,
	IPC_EVENTS.TIMELINE_WINDOW_DATA_SET,
	IPC_EVENTS.TIMELINE_WINDOW_ACTION,
	IPC_EVENTS.TIMELINE_WINDOW_REATTACH,
	IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET,
	IPC_EVENTS.YOUTUBE_OPEN_LINK,
	IPC_EVENTS.YOUTUBE_VIDEO_REFRESH,
	IPC_EVENTS.YOUTUBE_VIDEO_DELETE,
	IPC_EVENTS.WCL_OPEN_FIGHT,
	IPC_EVENTS.WCL_OPEN_DEATH,
]);

const ALLOWED_RECEIVE_CHANNELS = new Set<string>([
	IPC_EVENTS.APP_DEEP_LINK_CALLBACK,
	IPC_EVENTS.APP_UNCAUGHT_EXCEPTION_CALLBACK,
	IPC_EVENTS.APP_UNHANDLED_REJECTION_CALLBACK,
	IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_CALLBACK,
	IPC_EVENTS.SOCKET_CONNECTED_CALLBACK,
	IPC_EVENTS.SOCKET_CONNECT_ERROR_CALLBACK,
	IPC_EVENTS.SOCKET_DISCONNECTED_CALLBACK,
	IPC_EVENTS.SOCKET_NOT_ENOUGH_PERMISSIONS_CALLBACK,
	IPC_EVENTS.UPDATER_FILE_ERROR_CALLBACK,
	IPC_EVENTS.UPDATER_NEW_FILE_CALLBACK,
	IPC_EVENTS.UPDATER_FILE_NOT_FOUND_CALLBACK,
	IPC_EVENTS.UPDATER_FILE_DELETED_CALLBACK,
	IPC_EVENTS.UPDATER_FILE_CHUNK_RECEIVED_CALLBACK,
	IPC_EVENTS.UPDATER_FILE_DOWNLOADED_CALLBACK,
	IPC_EVENTS.PUSHER_UPLOAD_STATE_CALLBACK,
	IPC_EVENTS.BACKUPS_CREATED_CALLBACK,
	IPC_EVENTS.BACKUPS_STATUS_CALLBACK,
	IPC_EVENTS.STATUS_CONNECTED_CLIENTS_CALLBACK,
	IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK,
	IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_UPDATED,
	IPC_EVENTS.TIMELINE_WINDOW_CURSOR_UPDATED,
	IPC_EVENTS.TIMELINE_WINDOW_DATA_UPDATED,
	IPC_EVENTS.TIMELINE_WINDOW_ACTION,
	IPC_EVENTS.TIMELINE_WINDOW_REATTACHED,
	IPC_EVENTS.YOUTUBE_PLAYER_HOTKEY_CALLBACK,
	IPC_EVENTS.YOUTUBE_PLAYER_DOUBLE_CLICK_CALLBACK,
	IPC_EVENTS.YOUTUBE_PLAYER_POINTER_ACTIVITY_CALLBACK,
	IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_CHANGED,
	IPC_EVENTS.YOUTUBE_VIDEO_INFO_UPDATED,
	IPC_EVENTS.OBS_STATUS_UPDATED,
	IPC_EVENTS.WCL_AUTH_STATUS_UPDATED,
]);

const ALLOWED_STORE_KEYS = new Set([
	'autoUpdate',
	'backupsEnabled',
	'backupsPath',
	'darkMode',
	'lastBackupTime',
	'locale',
	'maxBackupsFolderSize',
	'obsEnabled',
	'obsPassword',
	'obsPort',
	'quitOnClose',
	'relativePath',
	'reviewBossCastDisplayMode',
	'reviewBossCastVisibilityOverrides',
	'reviewCooldownComparisonPlayerSelections',
	'reviewCooldownComparisonPreferences',
	'reviewCooldownTimelineExcludedSpells',
	'reviewCooldownTimelineExpandedHeight',
	'reviewCooldownTimelineGroupFilters',
	'reviewCooldownTimelineSpellFilters',
	'startMinimized',
	'startWithWindows',
	'updatePath',
]);

const EMPTY_RENDERER_EVENT = Object.freeze({});
const subscriptions = new Map<string, Subscription>();
let subscriptionCounter = 0;

function requireAllowedChannel(channel: unknown, allowedChannels: ReadonlySet<string>, operation: string): string {
	if (typeof channel !== 'string' || !allowedChannels.has(channel)) {
		throw new Error(`Blocked renderer IPC ${operation} on channel "${String(channel)}"`);
	}
	return channel;
}

function requireAllowedStoreKey(key: unknown): string {
	if (typeof key !== 'string' || !ALLOWED_STORE_KEYS.has(key)) {
		throw new Error(`Blocked renderer store access for key "${String(key)}"`);
	}
	return key;
}

function createSubscriptionID() {
	subscriptionCounter++;
	return `${subscriptionCounter.toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function subscribe(channel: unknown, callback: unknown) {
	const allowedChannel = requireAllowedChannel(channel, ALLOWED_RECEIVE_CHANNELS, 'subscription');
	if (typeof callback !== 'function') throw new TypeError('Renderer IPC listener must be a function');

	const subscriptionID = createSubscriptionID();
	const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
		(callback as SafeIpcListener)(EMPTY_RENDERER_EVENT, ...args);
	};
	subscriptions.set(subscriptionID, { channel: allowedChannel, listener });
	ipcRenderer.on(allowedChannel, listener);
	return subscriptionID;
}

function unsubscribe(subscriptionID: unknown) {
	if (typeof subscriptionID !== 'string') return;
	const subscription = subscriptions.get(subscriptionID);
	if (!subscription) return;
	ipcRenderer.removeListener(subscription.channel, subscription.listener);
	subscriptions.delete(subscriptionID);
}

async function store_get(key: unknown) {
	return await ipcRenderer.invoke('store-get', requireAllowedStoreKey(key));
}

async function store_set(key: unknown, value: unknown) {
	return await ipcRenderer.invoke('store-set', requireAllowedStoreKey(key), value);
}

contextBridge.exposeInMainWorld('ipc', {
	invoke: (channel: unknown, ...args: unknown[]) => ipcRenderer.invoke(
		requireAllowedChannel(channel, ALLOWED_INVOKE_CHANNELS, 'invoke'),
		...args,
	),
	send: (channel: unknown, ...args: unknown[]) => ipcRenderer.send(
		requireAllowedChannel(channel, ALLOWED_SEND_CHANNELS, 'send'),
		...args,
	),
	on: subscribe,
	off: unsubscribe,
});

contextBridge.exposeInMainWorld('store', {
	set: store_set,
	get: store_get,
	onSync: (key: unknown, callback: unknown) => {
		const allowedKey = requireAllowedStoreKey(key);
		if (typeof callback !== 'function') throw new TypeError('Store sync listener must be a function');
		const subscriptionID = createSubscriptionID();
		let active = true;
		const listener = (_event: Electron.IpcRendererEvent, changedSubscriptionID: unknown, changedKey: unknown, value: unknown) => {
			if (changedSubscriptionID === subscriptionID && changedKey === allowedKey) {
				(callback as (nextValue: unknown) => void)(value);
			}
		};
		ipcRenderer.on('store-sync', listener);
		ipcRenderer.send('store-sync-request', allowedKey, subscriptionID);
		return () => {
			if (!active) return;
			active = false;
			ipcRenderer.removeListener('store-sync', listener);
			ipcRenderer.send('store-sync-cancel', subscriptionID);
		};
	},
});


console.log('preload script loaded');
