import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC_EVENTS } from '@/events';
import type ObsWebsocketService from '@/main/obsWebsocketService';
import {
	measureWindowsClockCalibration,
	type WindowsClockCalibration,
} from '@/main/windowsClockCalibration';
import {
	getDisplayedReviewSyncMarkerBounds,
	REVIEW_SYNC_MARKER_LAYOUT,
	type ReviewSyncMarkerCapture,
	type ReviewSyncMarkerRectangle,
} from '@/reviewSyncMarker';

const REVIEW_SYNC_OBS_INPUT_NAME = 'RG Review Sync Marker';
const MARKER_CAPTURE_MARGIN_SOURCE_PIXELS = 8;
const MIN_MARKER_CAPTURE_MARGIN_PIXELS = 2;
const CAPTURE_IMAGE_SCALE_FACTOR = 1;
const CLOCK_CALIBRATION_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CLOCK_CALIBRATION_CACHE_TTL_MS = 2 * 60 * 1000;

type ReviewSyncLogger = {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
};

export type ReviewSyncPrototypeController = {
	setStreaming: (streaming: boolean) => void;
	dispose: () => void;
};

function getClockCalibrationCss(offsetMs: number): string {
	const safeOffsetMs = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
	return `:root { --rg-clock-offset-ms: ${safeOffsetMs}; }`;
}

function getObsOverlayPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, 'obs', 'rg-sync-overlay.html')
		: path.join(app.getAppPath(), 'app', 'obs', 'rg-sync-overlay.html');
}

function getSafeVideoBounds(
	value: unknown,
	contentWidth: number,
	contentHeight: number,
): ReviewSyncMarkerRectangle {
	if (!value || typeof value !== 'object') throw new TypeError('Video capture bounds are required');
	const candidate = value as Partial<ReviewSyncMarkerRectangle>;
	if (![candidate.x, candidate.y, candidate.width, candidate.height]
		.every(item => typeof item === 'number' && Number.isFinite(item))) {
		throw new TypeError('Video capture bounds must contain finite numbers');
	}

	const videoBounds = candidate as ReviewSyncMarkerRectangle;
	if (videoBounds.width < 200 || videoBounds.height < 112) {
		throw new RangeError('Video capture area is too small');
	}
	if (
		videoBounds.x >= contentWidth
		|| videoBounds.y >= contentHeight
		|| videoBounds.x + videoBounds.width <= 0
		|| videoBounds.y + videoBounds.height <= 0
	) {
		throw new RangeError('Video capture area is outside the Reviews window');
	}

	// Preserve fractional DOM coordinates for marker projection. capturePage
	// itself still receives a separately rounded Electron.Rectangle below.
	return videoBounds;
}

function getMarkerCaptureBounds(
	videoBounds: ReviewSyncMarkerRectangle,
	contentWidth: number,
	contentHeight: number,
): {
	captureBounds: Electron.Rectangle;
	displayedMarkerBounds: ReviewSyncMarkerRectangle;
} {
	const displayedMarkerBounds = getDisplayedReviewSyncMarkerBounds(videoBounds);
	const markerSourceWidth = REVIEW_SYNC_MARKER_LAYOUT.cellWidth;
	const markerSourceHeight = REVIEW_SYNC_MARKER_LAYOUT.cellHeight
		* REVIEW_SYNC_MARKER_LAYOUT.symbolCount;
	const marginX = Math.max(
		MIN_MARKER_CAPTURE_MARGIN_PIXELS,
		MARKER_CAPTURE_MARGIN_SOURCE_PIXELS * displayedMarkerBounds.width / markerSourceWidth,
	);
	const marginY = Math.max(
		MIN_MARKER_CAPTURE_MARGIN_PIXELS,
		MARKER_CAPTURE_MARGIN_SOURCE_PIXELS
			* displayedMarkerBounds.height / markerSourceHeight,
	);
	const x = Math.max(0, Math.floor(displayedMarkerBounds.x - marginX));
	const y = Math.max(0, Math.floor(displayedMarkerBounds.y - marginY));
	const right = Math.min(
		contentWidth,
		Math.ceil(displayedMarkerBounds.x + displayedMarkerBounds.width + marginX),
	);
	const bottom = Math.min(
		contentHeight,
		Math.ceil(displayedMarkerBounds.y + displayedMarkerBounds.height + marginY),
	);
	const captureBounds = { x, y, width: right - x, height: bottom - y };
	if (captureBounds.width < 1 || captureBounds.height < 1) {
		throw new RangeError('RG sync marker is outside the Reviews window');
	}

	return { captureBounds, displayedMarkerBounds };
}

export function registerReviewSyncPrototypeIpc(
	obsService: ObsWebsocketService,
	log: ReviewSyncLogger,
): ReviewSyncPrototypeController {
	let streaming = false;
	let refreshTimer: NodeJS.Timeout | null = null;
	let lastCalibration: WindowsClockCalibration | null = null;
	let calibrationPromise: Promise<WindowsClockCalibration> | null = null;

	async function getClockCalibration(force = false): Promise<WindowsClockCalibration> {
		if (
			!force
			&& lastCalibration
			&& lastCalibration.applied
			&& Date.now() - lastCalibration.measuredAtMs < CLOCK_CALIBRATION_CACHE_TTL_MS
		) return lastCalibration;
		if (calibrationPromise) return calibrationPromise;

		calibrationPromise = measureWindowsClockCalibration();
		try {
			lastCalibration = await calibrationPromise;
			if (lastCalibration.applied) {
				log.info('[Review sync] Calibrated OBS marker clock', {
					offsetMs: lastCalibration.offsetMs,
					sampleCount: lastCalibration.sampleCount,
					uncertaintyMs: lastCalibration.uncertaintyMs,
				});
			} else {
				log.warn('[Review sync] Clock calibration failed; OBS marker will use Date.now()', {
					reason: lastCalibration.failureReason,
				});
			}
			return lastCalibration;
		} finally {
			calibrationPromise = null;
		}
	}

	async function refreshInstalledOverlayClock(): Promise<void> {
		try {
			// Do not launch w32tm for OBS users who have not installed the marker.
			if (!await obsService.hasBrowserSource(REVIEW_SYNC_OBS_INPUT_NAME)) return;
			const calibration = await getClockCalibration(true);
			const updated = await obsService.updateBrowserSourceCustomCss(
				REVIEW_SYNC_OBS_INPUT_NAME,
				getClockCalibrationCss(calibration.offsetMs),
			);
			if (updated) {
				log.info('[Review sync] Updated installed OBS marker clock correction', {
					offsetMs: calibration.offsetMs,
					calibrated: calibration.applied,
				});
			}
		} catch (error) {
			log.warn('[Review sync] Failed to update installed OBS marker clock correction', error);
		}
	}

	function stopRefreshTimer(): void {
		if (!refreshTimer) return;
		clearInterval(refreshTimer);
		refreshTimer = null;
	}

	function setStreaming(nextStreaming: boolean): void {
		if (streaming === nextStreaming) return;
		streaming = nextStreaming;
		stopRefreshTimer();
		if (!streaming) return;

		void refreshInstalledOverlayClock();
		refreshTimer = setInterval(() => {
			void refreshInstalledOverlayClock();
		}, CLOCK_CALIBRATION_REFRESH_INTERVAL_MS);
	}

	ipcMain.handle(IPC_EVENTS.REVIEW_SYNC_CAPTURE_VIDEO_FRAME, async (event, bounds: unknown) => {
		const contentBounds = BrowserWindow.fromWebContents(event.sender)?.getContentBounds();
		if (!contentBounds) throw new Error('Could not resolve the Reviews window');

		const videoBounds = getSafeVideoBounds(bounds, contentBounds.width, contentBounds.height);
		const { captureBounds, displayedMarkerBounds } = getMarkerCaptureBounds(
			videoBounds,
			contentBounds.width,
			contentBounds.height,
		);
		const captureStartedAtMs = Date.now();
		const image = await event.sender.capturePage(captureBounds, { stayHidden: true });
		const captureFinishedAtMs = Date.now();
		if (image.isEmpty()) throw new Error('Electron returned an empty video capture');
		// Ask both APIs for the same NativeImage representation so markerBounds
		// remain correct on displays that use fractional DPI scaling.
		const size = image.getSize(CAPTURE_IMAGE_SCALE_FACTOR);
		const scaleX = size.width / captureBounds.width;
		const scaleY = size.height / captureBounds.height;
		const result: ReviewSyncMarkerCapture = {
			dataUrl: image.toDataURL({ scaleFactor: CAPTURE_IMAGE_SCALE_FACTOR }),
			size,
			captureStartedAtMs,
			captureFinishedAtMs,
			markerBounds: {
				x: (displayedMarkerBounds.x - captureBounds.x) * scaleX,
				y: (displayedMarkerBounds.y - captureBounds.y) * scaleY,
				width: displayedMarkerBounds.width * scaleX,
				height: displayedMarkerBounds.height * scaleY,
			},
		};
		return result;
	});

	ipcMain.handle(IPC_EVENTS.REVIEW_SYNC_OVERLAY_REVEAL, () => {
		const overlayPath = getObsOverlayPath();
		shell.showItemInFolder(overlayPath);
		return { overlayPath };
	});

	ipcMain.handle(IPC_EVENTS.REVIEW_SYNC_OVERLAY_INSTALL, async () => {
		const overlayPath = getObsOverlayPath();
		const clockCalibration = await getClockCalibration();
		const installResult = await obsService.installBrowserSourceInCurrentProgramScene({
			inputName: REVIEW_SYNC_OBS_INPUT_NAME,
			localFile: overlayPath,
			sourceWidth: REVIEW_SYNC_MARKER_LAYOUT.sourceWidth,
			sourceHeight: REVIEW_SYNC_MARKER_LAYOUT.sourceHeight,
			customCss: getClockCalibrationCss(clockCalibration.offsetMs),
		});
		return { ...installResult, clockCalibration };
	});

	return {
		setStreaming,
		dispose: stopRefreshTimer,
	};
}
