import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { execFile } from 'child_process';
import { promisify } from 'util';

export type ObsSettings = {
	enabled: boolean;
	port: number;
	password: string;
};

export type ObsStatus = {
	connected: boolean;
	streaming: boolean;
	reconnecting: boolean;
	appRunning: boolean | null;
	websocketEnabled: boolean | null;
	lastError: string | null;
	updatedAt: number;
	serviceName: string | null;
	server: string | null;
};

export type ObsStreamStartedPayload = {
	youtubeUrl: string;
};

type ObsServiceCallbacks = {
	onStatus: (status: ObsStatus) => void;
	onStreamStarted: (payload: ObsStreamStartedPayload) => void;
	log: {
		info: (...args: any[]) => void;
		warn: (...args: any[]) => void;
		error: (...args: any[]) => void;
	};
};

const DEFAULT_SETTINGS: ObsSettings = {
	enabled: false,
	port: 4455,
	password: '',
};

const BASE_RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 30000;
const execFileAsync = promisify(execFile);

export default class ObsWebsocketService {
	private readonly obs = new OBSWebSocket();
	private readonly callbacks: ObsServiceCallbacks;
	private settings: ObsSettings = { ...DEFAULT_SETTINGS };
	private reconnectTimer: NodeJS.Timeout | null = null;
	private reconnectAttempt = 0;
	private isDisposed = false;
	private youtubeUrl: string | null = null;
	private status: ObsStatus = {
		connected: false,
		streaming: false,
		reconnecting: false,
		appRunning: null,
		websocketEnabled: null,
		lastError: null,
		updatedAt: Date.now(),
		serviceName: null,
		server: null,
	};

	constructor(callbacks: ObsServiceCallbacks) {
		this.callbacks = callbacks;
		this.registerObsListeners();
	}

	getSettings(): ObsSettings {
		return { ...this.settings };
	}

	getStatus(): ObsStatus {
		return { ...this.status };
	}

	async updateSettings(next: Partial<ObsSettings>) {
		const previous = this.settings;
		this.settings = {
			...this.settings,
			...next,
		};

		const connectionDetailsChanged =
			previous.port !== this.settings.port
			|| previous.password !== this.settings.password;

		const enabledChanged = previous.enabled !== this.settings.enabled;

		if (!this.settings.enabled) {
			await this.disconnect();
			this.updateStatus({ reconnecting: false, streaming: false, connected: false, appRunning: null, websocketEnabled: null });
			return;
		}

		if (enabledChanged || connectionDetailsChanged || !this.status.connected) {
			await this.reconnectNow();
		}
	}

	async connect() {
		if (this.isDisposed || !this.settings.enabled) return;
		if (this.status.connected) return;

		this.clearReconnectTimer();
		this.updateStatus({ reconnecting: false, lastError: null });
		void this.refreshAppPresence();

		const address = `ws://127.0.0.1:${this.settings.port}`;
		try {
			await this.obs.connect(address, this.settings.password, {
				eventSubscriptions: EventSubscription.General | EventSubscription.Outputs,
			});

			await this.syncStateFromObs();
			this.reconnectAttempt = 0;
		} catch (error: any) {
			this.onConnectionError(error);
		}
	}

	async disconnect() {
		this.clearReconnectTimer();
		this.reconnectAttempt = 0;
		this.youtubeUrl = null;
		this.updateStatus({ reconnecting: false, connected: false, streaming: false, websocketEnabled: false });

		try {
			await this.obs.disconnect();
		} catch {
			// no-op
		}
	}

	async reconnectNow() {
		await this.disconnect();
		await this.connect();
	}

	async dispose() {
		this.isDisposed = true;
		await this.disconnect();
	}

	private registerObsListeners() {
		this.obs.on('ConnectionOpened', () => {
			this.callbacks.log.info('[OBS] Connection opened');
			this.updateStatus({ connected: true, reconnecting: false, lastError: null, appRunning: true, websocketEnabled: true });
		});

		this.obs.on('ConnectionClosed', () => {
			if (this.isDisposed) return;
			this.callbacks.log.warn('[OBS] Connection closed');
			void this.handleOfflineReconnect('Connection closed');
		});

		this.obs.on('ConnectionError', (error: Error) => {
			this.onConnectionError(error);
		});

		this.obs.on('StreamStateChanged', (event: any) => {
			this.callbacks.log.info('[OBS] Stream state changed', { event });
			this.updateStatus({ streaming: Boolean(event?.outputActive), lastError: null });

			if (event?.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
				void this.onStreamLive();
			}
		});
	}

	private async syncStateFromObs() {
		const appRunning = await this.refreshAppPresence();
		if (appRunning) {
			this.updateStatus({ websocketEnabled: true });
		}

		let alreadyStreaming = false;
		try {
			const streamStatus = await this.obs.call('GetStreamStatus') as any;
			this.callbacks.log.info('[OBS] Current stream status', { streamStatus });
			alreadyStreaming = Boolean(streamStatus?.outputActive);
			this.updateStatus({ streaming: alreadyStreaming, connected: true, lastError: null, websocketEnabled: true });
		} catch (error) {
			this.callbacks.log.warn('[OBS] GetStreamStatus failed', error);
		}

		await this.refreshStreamServiceSettings();

		if (alreadyStreaming) {
			void this.onStreamLive();
		}
	}

	private async onStreamLive() {
		await this.refreshStreamServiceSettings();
		if (this.youtubeUrl) {
			this.callbacks.onStreamStarted({ youtubeUrl: this.youtubeUrl });
		} else {
			this.callbacks.log.warn('[OBS] Stream went live but no broadcast_id found in service settings');
		}
	}

	private async refreshStreamServiceSettings() {
		try {
			const serviceState = await this.obs.call('GetStreamServiceSettings') as any;
			this.callbacks.log.info('[OBS] Current stream service settings', { serviceState });
			const streamServiceType = typeof serviceState?.streamServiceType === 'string'
				? serviceState.streamServiceType
				: null;
			const streamServiceSettings = serviceState?.streamServiceSettings || {};
			const streamServer = typeof streamServiceSettings?.server === 'string'
				? streamServiceSettings.server
				: null;
			const broadcastId = typeof streamServiceSettings?.broadcast_id === 'string' && streamServiceSettings.broadcast_id.trim()
				? streamServiceSettings.broadcast_id.trim()
				: null;
			this.youtubeUrl = broadcastId ? `https://youtube.com/live/${broadcastId}?feature=share` : null;
			this.updateStatus({ serviceName: streamServiceType, server: streamServer });
		} catch (error) {
			this.callbacks.log.warn('[OBS] GetStreamServiceSettings failed', error);
		}
	}

	private onConnectionError(error: any) {
		if (this.isDisposed) return;
		const message = error?.message || String(error);
		void this.handleOfflineReconnect(message, this.inferWebsocketEnabledFromError(message));
	}

	private async handleOfflineReconnect(reason: string, websocketEnabled: boolean | null = null) {
		const appRunning = await this.refreshAppPresence();

		if (!appRunning) {
			this.callbacks.log.info('[OBS] OBS is not running; suppressing reconnection error state');
			this.updateStatus({ connected: false, streaming: false, reconnecting: true, lastError: null, websocketEnabled: false });
			this.scheduleReconnect(reason, true);
			return;
		}

		this.callbacks.log.warn('[OBS] Connection error', reason);
		this.updateStatus({ connected: false, streaming: false, lastError: reason, websocketEnabled: websocketEnabled ?? true });
		this.scheduleReconnect(reason);
	}

	private async refreshAppPresence() {
		const appRunning = await this.checkObsRunning();
		this.updateStatus({ appRunning });
		return appRunning;
	}

	private async checkObsRunning(): Promise<boolean> {
		try {
			const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
			if (String(stdout || '').toLowerCase().includes('obs64.exe')) return true;

			const fallback = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq obs.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
			return String(fallback.stdout || '').toLowerCase().includes('obs.exe');
		} catch (error) {
			this.callbacks.log.warn('[OBS] Failed to inspect running processes', error);
			return false;
		}
	}

	private inferWebsocketEnabledFromError(message: string): boolean | null {
		const normalized = message.toLowerCase();

		if (normalized.includes('authentication failed') || normalized.includes('unauthorized')) {
			return true;
		}

		if (normalized.includes('refused') || normalized.includes('timed out') || normalized.includes('econnrefused') || normalized.includes('enotfound')) {
			return false;
		}

		return null;
	}

	private scheduleReconnect(reason: string, silent = false) {
		if (this.isDisposed || !this.settings.enabled) return;
		if (this.reconnectTimer) return;

		const delayMs = Math.min(
			BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
			MAX_RECONNECT_DELAY_MS,
		);
		this.reconnectAttempt += 1;
		this.updateStatus({ reconnecting: true });
		if (!silent) {
			this.callbacks.log.info(`[OBS] Reconnect scheduled in ${delayMs}ms`, reason);
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.connect();
		}, delayMs);
	}

	private clearReconnectTimer() {
		if (!this.reconnectTimer) return;
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	private updateStatus(next: Partial<ObsStatus>) {
		this.status = {
			...this.status,
			...next,
			updatedAt: Date.now(),
		};
		this.callbacks.onStatus(this.getStatus());
	}
}
