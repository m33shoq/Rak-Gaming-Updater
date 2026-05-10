import { screen, type BrowserWindow } from 'electron';

export type StoredWindowSettings = {
	width?: number;
	height?: number;
	maximized?: boolean;
	x?: number;
	y?: number;
};

type PersistedWindowSettings = {
	width: number;
	height: number;
	maximized: boolean;
	x: number;
	y: number;
};

const DEFAULT_WINDOW_WIDTH = 900;
const DEFAULT_WINDOW_HEIGHT = 600;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;
const MIN_VISIBLE_EDGE = 80;
const TITLE_BAR_VISIBLE_HEIGHT = 40;
const TITLE_BAR_VISIBLE_WIDTH = 220;

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function intersectionArea(a: Electron.Rectangle, b: Electron.Rectangle): number {
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	const width = Math.max(0, right - left);
	const height = Math.max(0, bottom - top);
	return width * height;
}

function hasEnoughVisibleArea(bounds: Electron.Rectangle): boolean {
	const displays = screen.getAllDisplays();
	return displays.some((display) => {
		const visibleArea = intersectionArea(bounds, display.workArea);
		return visibleArea >= MIN_VISIBLE_EDGE * MIN_VISIBLE_EDGE;
	});
}

function clampBoundsToKeepTitleBarVisible(bounds: Electron.Rectangle): Electron.Rectangle {
	const display = screen.getDisplayMatching(bounds);
	const workArea = display.workArea;

	const minVisibleWidth = Math.min(TITLE_BAR_VISIBLE_WIDTH, bounds.width);
	const xMin = workArea.x - (bounds.width - minVisibleWidth);
	const xMax = workArea.x + workArea.width - minVisibleWidth;
	const yMin = workArea.y;
	const yMax = workArea.y + workArea.height - TITLE_BAR_VISIBLE_HEIGHT;

	const clampedX = Math.min(Math.max(bounds.x, xMin), xMax);
	const clampedY = Math.min(Math.max(bounds.y, yMin), yMax);

	return {
		...bounds,
		x: clampedX,
		y: clampedY,
	};
}

export function getSafeInitialWindowBounds(settings: StoredWindowSettings): Electron.Rectangle {
	const width = Math.max(MIN_WINDOW_WIDTH, toFiniteNumber(settings.width) || DEFAULT_WINDOW_WIDTH);
	const height = Math.max(MIN_WINDOW_HEIGHT, toFiniteNumber(settings.height) || DEFAULT_WINDOW_HEIGHT);

	const savedX = toFiniteNumber(settings.x);
	const savedY = toFiniteNumber(settings.y);

	if (savedX !== undefined && savedY !== undefined) {
		const candidate = { x: savedX, y: savedY, width, height };
		if (hasEnoughVisibleArea(candidate)) {
			return clampBoundsToKeepTitleBarVisible(candidate);
		}
	}

	const primaryWorkArea = screen.getPrimaryDisplay().workArea;
	const safeWidth = Math.min(width, primaryWorkArea.width);
	const safeHeight = Math.min(height, primaryWorkArea.height);

	return clampBoundsToKeepTitleBarVisible({
		x: primaryWorkArea.x + Math.floor((primaryWorkArea.width - safeWidth) / 2),
		y: primaryWorkArea.y + Math.floor((primaryWorkArea.height - safeHeight) / 2),
		width: safeWidth,
		height: safeHeight,
	});
}

export function getWindowSettingsFromWindow(win: BrowserWindow): PersistedWindowSettings {
	const normalBounds = win.getNormalBounds();
	return {
		width: normalBounds.width,
		height: normalBounds.height,
		x: normalBounds.x,
		y: normalBounds.y,
		maximized: win.isMaximized(),
	};
}
