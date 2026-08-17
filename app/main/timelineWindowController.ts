import {
	BrowserWindow,
	ipcMain,
	screen,
	shell,
	type NativeImage,
	type WebContents,
} from 'electron';
import log from 'electron-log/main';
import { IPC_EVENTS } from '@/events';
import store from '@/main/store';
import type {
	ReviewTimelineReattachReason,
	ReviewTimelineWindowAction,
	ReviewTimelineWindowContext,
	ReviewTimelineWindowDataSnapshot,
} from '@/timelineWindow';

type TimelineWindowControllerOptions = {
	getMainWindow: () => BrowserWindow | null;
	preloadPath: string;
	htmlPath: string;
	devUrl?: string;
	icon: NativeImage;
	isAppClosing: () => boolean;
};

type TimelineWindowBounds = Electron.Rectangle;

const TIMELINE_BOUNDS_STORE_KEY = 'timelineWindowBounds';
const DEFAULT_WIDTH_RATIO = 0.78;
const DEFAULT_HEIGHT_RATIO = 0.72;
const DEFAULT_MAX_WIDTH = 1440;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 360;
const BOUNDS_SETTLE_DELAY_MS = 200;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}

export default class TimelineWindowController {
	private timelineWindow: BrowserWindow | null = null;
	private context: ReviewTimelineWindowContext | null = null;
	private pendingContext: ReviewTimelineWindowContext | null = null;
	private timelineRendererReady = false;
	private closeReason: ReviewTimelineReattachReason | null = null;
	private focusMainAfterClose = false;
	private destroyingForQuit = false;
	private boundsSettleTimeout: NodeJS.Timeout | null = null;
	private readonly boundMainWindows = new WeakSet<BrowserWindow>();

	constructor(private readonly options: TimelineWindowControllerOptions) {
		this.registerIpcHandlers();
	}

	bindMainWindowLifecycle(mainWindow: BrowserWindow) {
		if (this.boundMainWindows.has(mainWindow)) return;
		this.boundMainWindows.add(mainWindow);

		mainWindow.on('minimize', () => {
			this.reattach('main-minimized');
		});

		mainWindow.on('hide', () => {
			if (!this.options.isAppClosing()) this.reattach('main-hidden');
		});

		mainWindow.on('close', event => {
			if (!event.defaultPrevented) this.destroyForQuit();
		});

		mainWindow.on('closed', () => {
			// A child window cannot outlive its parent. Destroy it explicitly so its
			// close callback never tries to reattach into a renderer that is closing.
			this.destroyForQuit();
		});
	}

	destroyForQuit() {
		this.destroyingForQuit = true;
		this.context = null;
		this.pendingContext = null;
		this.timelineRendererReady = false;
		this.closeReason = null;
		this.focusMainAfterClose = false;
		if (this.timelineWindow && !this.timelineWindow.isDestroyed()) {
			this.persistBounds(this.timelineWindow);
			this.timelineWindow.destroy();
		}
		this.clearBoundsSettleTimeout();
		this.timelineWindow = null;
	}

	private isMainRenderer(sender: WebContents) {
		const mainWindow = this.options.getMainWindow();
		return Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents);
	}

	private isTimelineRenderer(sender: WebContents) {
		return Boolean(
			this.timelineWindow
			&& !this.timelineWindow.isDestroyed()
			&& sender === this.timelineWindow.webContents,
		);
	}

	private sendContext() {
		if (!this.timelineWindow || this.timelineWindow.isDestroyed() || !this.context) return;
		this.timelineWindow.webContents.send(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_UPDATED, this.context);
	}

	private notifyReattached(reason: ReviewTimelineReattachReason, returnToReviews = false) {
		const mainWindow = this.options.getMainWindow();
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACHED, { reason, returnToReviews });
	}

	private reattach(reason: ReviewTimelineReattachReason, focusMainAfterClose = false) {
		if (!this.timelineWindow || this.timelineWindow.isDestroyed()) {
			this.timelineWindow = null;
			this.context = null;
			this.pendingContext = null;
			this.timelineRendererReady = false;
			if (focusMainAfterClose) this.focusMainWindow();
			return;
		}

		this.closeReason ||= reason;
		this.focusMainAfterClose ||= focusMainAfterClose;
		this.timelineWindow.close();
	}

	private focusMainWindow() {
		const mainWindow = this.options.getMainWindow();
		if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
		mainWindow.focus();
	}

	private getStoredBounds(): TimelineWindowBounds | null {
		const bounds = store.get(TIMELINE_BOUNDS_STORE_KEY);
		if (
			!bounds
			|| !isFiniteNumber(bounds.x)
			|| !isFiniteNumber(bounds.y)
			|| !isFiniteNumber(bounds.width)
			|| !isFiniteNumber(bounds.height)
		) return null;

		return bounds;
	}

	private clampBoundsToWorkArea(bounds: TimelineWindowBounds, workArea: Electron.Rectangle) {
		const minimumWidth = Math.min(MIN_WINDOW_WIDTH, workArea.width);
		const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, workArea.height);
		const width = clamp(Math.round(bounds.width), minimumWidth, workArea.width);
		const height = clamp(Math.round(bounds.height), minimumHeight, workArea.height);
		return {
			x: clamp(Math.round(bounds.x), workArea.x, workArea.x + workArea.width - width),
			y: clamp(Math.round(bounds.y), workArea.y, workArea.y + workArea.height - height),
			width,
			height,
		};
	}

	private getInitialBounds(mainWindow: BrowserWindow) {
		const parentBounds = mainWindow.getBounds();
		const storedBounds = this.getStoredBounds();
		const workArea = screen.getDisplayMatching(storedBounds || parentBounds).workArea;
		if (storedBounds) return this.clampBoundsToWorkArea(storedBounds, workArea);

		const minimumWidth = Math.min(MIN_WINDOW_WIDTH, workArea.width);
		const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, workArea.height);
		const preferredMaximumWidth = Math.min(DEFAULT_MAX_WIDTH, workArea.width);
		const width = clamp(
			Math.round(workArea.width * DEFAULT_WIDTH_RATIO),
			minimumWidth,
			preferredMaximumWidth,
		);
		const height = clamp(
			Math.round(workArea.height * DEFAULT_HEIGHT_RATIO),
			minimumHeight,
			workArea.height,
		);
		return this.clampBoundsToWorkArea({
			x: Math.round(parentBounds.x + (parentBounds.width - width) / 2),
			y: Math.round(parentBounds.y + (parentBounds.height - height) / 2),
			width,
			height,
		}, workArea);
	}

	private clearBoundsSettleTimeout() {
		if (!this.boundsSettleTimeout) return;
		clearTimeout(this.boundsSettleTimeout);
		this.boundsSettleTimeout = null;
	}

	private persistBounds(window: BrowserWindow) {
		if (window.isDestroyed()) return;
		store.set(TIMELINE_BOUNDS_STORE_KEY, window.getNormalBounds());
	}

	private constrainSizeAndPersistBounds(window: BrowserWindow) {
		if (window.isDestroyed()) return;
		const currentBounds = window.getNormalBounds();
		const workArea = screen.getDisplayMatching(currentBounds).workArea;
		const minimumWidth = Math.min(MIN_WINDOW_WIDTH, workArea.width);
		const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, workArea.height);
		const width = clamp(Math.round(currentBounds.width), minimumWidth, workArea.width);
		const height = clamp(Math.round(currentBounds.height), minimumHeight, workArea.height);
		window.setMinimumSize(
			minimumWidth,
			minimumHeight,
		);
		window.setMaximumSize(workArea.width, workArea.height);
		if (currentBounds.width !== width || currentBounds.height !== height) {
			// Preserve the user's drag position. Saved positions are only clamped
			// when the window is opened again, not while crossing a screen edge.
			window.setBounds({ ...currentBounds, width, height });
		}
		store.set(TIMELINE_BOUNDS_STORE_KEY, { ...currentBounds, width, height });
	}

	private scheduleBoundsMaintenance(window: BrowserWindow) {
		this.clearBoundsSettleTimeout();
		this.boundsSettleTimeout = setTimeout(() => {
			this.boundsSettleTimeout = null;
			this.constrainSizeAndPersistBounds(window);
		}, BOUNDS_SETTLE_DELAY_MS);
	}

	private recoverFromRendererFailure(child: BrowserWindow, error: unknown) {
		log.error('Detached timeline renderer failed', error);
		if (this.timelineWindow !== child || child.isDestroyed()) return;
		this.closeReason ||= 'context-unavailable';
		child.close();
	}

	private createWindow() {
		const mainWindow = this.options.getMainWindow();
		if (!mainWindow || mainWindow.isDestroyed() || !this.context) return null;

		if (this.timelineWindow && !this.timelineWindow.isDestroyed()) {
			this.timelineWindow.show();
			this.timelineWindow.focus();
			this.sendContext();
			return this.timelineWindow;
		}

		this.destroyingForQuit = false;
		this.pendingContext = null;
		this.timelineRendererReady = false;
		this.closeReason = null;
		this.focusMainAfterClose = false;
		const initialBounds = this.getInitialBounds(mainWindow);
		const initialWorkArea = screen.getDisplayMatching(initialBounds).workArea;
		const child = new BrowserWindow({
			...initialBounds,
			parent: mainWindow,
			modal: false,
			minWidth: Math.min(MIN_WINDOW_WIDTH, initialWorkArea.width),
			minHeight: Math.min(MIN_WINDOW_HEIGHT, initialWorkArea.height),
			maxWidth: initialWorkArea.width,
			maxHeight: initialWorkArea.height,
			icon: this.options.icon,
			frame: false,
			titleBarStyle: 'hidden',
			backgroundColor: '#0b1019',
			resizable: true,
			minimizable: false,
			maximizable: true,
			fullscreenable: true,
			skipTaskbar: true,
			show: false,
			webPreferences: {
				preload: this.options.preloadPath,
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				webSecurity: true,
				allowRunningInsecureContent: false,
				webviewTag: false,
				partition: 'persist:youtube',
			},
		});

		this.timelineWindow = child;
		child.setMenu(null);
		child.webContents.setWindowOpenHandler(({ url }) => {
			if (url.startsWith('https:')) void shell.openExternal(url);
			return { action: 'deny' };
		});
		child.webContents.on('will-navigate', event => event.preventDefault());
		child.webContents.on('render-process-gone', (_event, details) => {
			this.recoverFromRendererFailure(child, details);
		});
		child.webContents.on(
			'did-fail-load',
			(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
				if (!isMainFrame || errorCode === -3) return;
				this.recoverFromRendererFailure(child, { errorCode, errorDescription, validatedURL });
			},
		);
		child.once('ready-to-show', () => {
			if (child.isDestroyed()) return;
			child.show();
			child.focus();
		});
		child.on('maximize', () => {
			child.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, true);
		});
		child.on('unmaximize', () => {
			child.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_TOGGLE_CALLBACK, false);
		});
		child.on('move', () => this.scheduleBoundsMaintenance(child));
		child.on('resize', () => this.scheduleBoundsMaintenance(child));
		child.on('close', () => this.persistBounds(child));
		child.on('closed', () => {
			this.clearBoundsSettleTimeout();
			if (this.timelineWindow === child) this.timelineWindow = null;
			this.context = null;
			this.pendingContext = null;
			this.timelineRendererReady = false;
			const reason = this.closeReason || 'timeline-closed';
			const shouldFocusMain = this.focusMainAfterClose;
			this.closeReason = null;
			this.focusMainAfterClose = false;
			if (!this.destroyingForQuit && !this.options.isAppClosing()) {
				this.notifyReattached(reason, shouldFocusMain);
				if (shouldFocusMain) this.focusMainWindow();
			}
		});

		const loadPromise = this.options.devUrl
			? child.loadURL(this.options.devUrl)
			: child.loadFile(this.options.htmlPath, { query: { window: 'timeline' } });
		void loadPromise.catch(error => {
			this.recoverFromRendererFailure(child, error);
		});

		return child;
	}

	private registerIpcHandlers() {
		ipcMain.handle(IPC_EVENTS.TIMELINE_WINDOW_OPEN, (event, context: ReviewTimelineWindowContext) => {
			if (!this.isMainRenderer(event.sender)) {
				return { success: false, error: 'Timeline window can only be opened by the main renderer.' };
			}
			if (!context?.reportCode || !context?.fightID || !context?.reportDetails) {
				return { success: false, error: 'Timeline context is incomplete.' };
			}

			this.context = context;
			const child = this.createWindow();
			return child
				? { success: true }
				: { success: false, error: 'Timeline window could not be created.' };
		});

		ipcMain.handle(IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET, event => {
			if (!this.isMainRenderer(event.sender)) return { detached: false };
			return { detached: Boolean(this.timelineWindow && !this.timelineWindow.isDestroyed()) };
		});

		ipcMain.handle(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_GET, event => {
			if (!this.isTimelineRenderer(event.sender)) return null;
			return this.context;
		});

		ipcMain.on(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_SET, (event, context: ReviewTimelineWindowContext) => {
			if (!this.isMainRenderer(event.sender) || !context?.reportCode || !context?.fightID) return;
			if (!this.timelineRendererReady) {
				this.pendingContext = context;
				return;
			}
			this.context = context;
			this.sendContext();
		});

		ipcMain.on(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_READY, event => {
			if (!this.isTimelineRenderer(event.sender)) return;
			this.timelineRendererReady = true;
			if (!this.pendingContext) return;
			this.context = this.pendingContext;
			this.pendingContext = null;
			this.sendContext();
		});

		ipcMain.on(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_SET, (event, cursorPercent: number) => {
			if (!this.isMainRenderer(event.sender) || !Number.isFinite(cursorPercent)) return;
			if (this.context) this.context.cursorPercent = cursorPercent;
			if (this.timelineWindow && !this.timelineWindow.isDestroyed()) {
				this.timelineWindow.webContents.send(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_UPDATED, cursorPercent);
			}
		});

		ipcMain.on(IPC_EVENTS.TIMELINE_WINDOW_DATA_SET, (event, snapshot: ReviewTimelineWindowDataSnapshot) => {
			const mainWindow = this.options.getMainWindow();
			if (
				!this.isTimelineRenderer(event.sender)
				|| !snapshot?.reportCode
				|| snapshot.reportCode !== this.context?.reportCode
				|| !Array.isArray(snapshot.fights)
				|| !mainWindow
				|| mainWindow.isDestroyed()
			) return;
			mainWindow.webContents.send(IPC_EVENTS.TIMELINE_WINDOW_DATA_UPDATED, snapshot);
		});

		ipcMain.on(IPC_EVENTS.TIMELINE_WINDOW_ACTION, (event, action: ReviewTimelineWindowAction) => {
			const mainWindow = this.options.getMainWindow();
			if (!this.isTimelineRenderer(event.sender) || !action?.type || !mainWindow || mainWindow.isDestroyed()) return;
			mainWindow.webContents.send(IPC_EVENTS.TIMELINE_WINDOW_ACTION, action);
		});

		ipcMain.on(
			IPC_EVENTS.TIMELINE_WINDOW_REATTACH,
			(event, input?: { reason?: ReviewTimelineReattachReason }) => {
				const requestedByTimeline = this.isTimelineRenderer(event.sender);
				if (!this.isMainRenderer(event.sender) && !requestedByTimeline) return;
				const reason = input?.reason === 'timeline-closed' ? 'timeline-closed' : 'context-unavailable';
				this.reattach(reason, requestedByTimeline && reason === 'timeline-closed');
			},
		);
	}
}
