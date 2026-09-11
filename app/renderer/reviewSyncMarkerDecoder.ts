import {
	decodeReviewSyncMarkerPayload,
	REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS,
	REVIEW_SYNC_MARKER_LAYOUT,
	type ReviewSyncMarkerRectangle,
	type ReviewSyncMarkerPayload,
} from '@/reviewSyncMarker';

const MIN_SYMBOL_LEVEL_GAP = 24;
const STRIP_SEARCH_RADIUS_SOURCE_PIXELS = 3;

export type DecodedReviewSyncMarker = ReviewSyncMarkerPayload & {
	confidence: number;
};

function loadCapturedImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Could not load the captured YouTube frame'));
		image.src = dataUrl;
	});
}

function averageLuminance(
	pixels: Uint8ClampedArray,
	imageWidth: number,
	imageHeight: number,
	left: number,
	top: number,
	right: number,
	bottom: number,
): number {
	const safeLeft = Math.max(0, Math.floor(left));
	const safeTop = Math.max(0, Math.floor(top));
	const safeRight = Math.min(imageWidth, Math.max(safeLeft + 1, Math.ceil(right)));
	const safeBottom = Math.min(imageHeight, Math.max(safeTop + 1, Math.ceil(bottom)));
	if (safeLeft >= imageWidth || safeTop >= imageHeight) return 0;
	let total = 0;
	let samples = 0;

	for (let y = safeTop; y < safeBottom; y++) {
		for (let x = safeLeft; x < safeRight; x++) {
			const pixelOffset = (y * imageWidth + x) * 4;
			total += pixels[pixelOffset] * 0.2126
				+ pixels[pixelOffset + 1] * 0.7152
				+ pixels[pixelOffset + 2] * 0.0722;
			samples++;
		}
	}

	return samples > 0 ? total / samples : 0;
}

function decodeReviewSyncMarkerPixels(
	imageData: ImageData,
	markerBounds: ReviewSyncMarkerRectangle,
	expectedTimestampMs: number,
	imageLeft: number,
	imageSampleWidth: number,
): DecodedReviewSyncMarker {
	const markerSourceHeight = REVIEW_SYNC_MARKER_LAYOUT.cellHeight
		* REVIEW_SYNC_MARKER_LAYOUT.symbolCount;
	const scaleY = markerBounds.height / markerSourceHeight;
	const insetY = REVIEW_SYNC_MARKER_LAYOUT.cellHeight * 0.2;
	const luminances: number[] = [];

	for (let index = 0; index < REVIEW_SYNC_MARKER_LAYOUT.symbolCount; index++) {
		const sourceTop = index * REVIEW_SYNC_MARKER_LAYOUT.cellHeight;
		luminances.push(averageLuminance(
			imageData.data,
			imageData.width,
			imageData.height,
			imageLeft,
			markerBounds.y + (sourceTop + insetY) * scaleY,
			imageLeft + imageSampleWidth,
			markerBounds.y + (sourceTop + REVIEW_SYNC_MARKER_LAYOUT.cellHeight - insetY) * scaleY,
		));
	}

	const symbolLevels = new Array<number>(4);
	for (let index = 0; index < REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS.length; index++) {
		symbolLevels[REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS[index]] = luminances[index];
	}
	for (let symbol = 1; symbol < symbolLevels.length; symbol++) {
		if (symbolLevels[symbol] - symbolLevels[symbol - 1] < MIN_SYMBOL_LEVEL_GAP) {
			throw new Error('RG sync marker luminance levels were not distinguishable');
		}
	}

	const symbols = new Uint8Array(REVIEW_SYNC_MARKER_LAYOUT.symbolCount);
	let totalDistance = 0;
	for (let index = 0; index < luminances.length; index++) {
		let closestSymbol = 0;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (let symbol = 0; symbol < symbolLevels.length; symbol++) {
			const distance = Math.abs(luminances[index] - symbolLevels[symbol]);
			if (distance < closestDistance) {
				closestSymbol = symbol;
				closestDistance = distance;
			}
		}
		symbols[index] = closestSymbol;
		totalDistance += closestDistance;
	}

	const levelRange = symbolLevels[3] - symbolLevels[0];
	const averageDistance = totalDistance / luminances.length;
	return {
		...decodeReviewSyncMarkerPayload(symbols, expectedTimestampMs),
		confidence: Math.max(0, Math.min(1, (levelRange - averageDistance * 2) / 255)),
	};
}

export async function decodeReviewSyncMarkerImage(
	dataUrl: string,
	markerBounds: ReviewSyncMarkerRectangle,
	expectedTimestampMs: number,
): Promise<DecodedReviewSyncMarker> {
	const image = await loadCapturedImage(dataUrl);
	if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
		throw new Error('Captured YouTube frame was empty');
	}

	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Could not inspect the captured YouTube frame');
	context.drawImage(image, 0, 0);
	if (
		!markerBounds
		|| typeof markerBounds !== 'object'
		|| ![markerBounds.x, markerBounds.y, markerBounds.width, markerBounds.height]
			.every(value => Number.isFinite(value))
		|| markerBounds.width <= 0
		|| markerBounds.height <= 0
		|| markerBounds.x >= canvas.width
		|| markerBounds.y >= canvas.height
		|| markerBounds.x + markerBounds.width <= 0
		|| markerBounds.y + markerBounds.height <= 0
	) {
		throw new Error('Captured RG sync marker bounds were invalid');
	}

	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	const decodeFailures = new Map<string, number>();
	let bestStripResult: DecodedReviewSyncMarker | null = null;
	const scaleX = markerBounds.width / REVIEW_SYNC_MARKER_LAYOUT.cellWidth;
	const expectedImageCenter = Math.round(markerBounds.x + markerBounds.width / 2);
	const imageSampleWidth = Math.max(1, Math.floor(REVIEW_SYNC_MARKER_LAYOUT.cellWidth * scaleX * 0.6));
	const expectedImageLeft = Math.round(expectedImageCenter - imageSampleWidth / 2);
	const imageSearchRadius = Math.max(
		2,
		Math.ceil(STRIP_SEARCH_RADIUS_SOURCE_PIXELS * scaleX),
	);
	for (let columnOffset = -imageSearchRadius; columnOffset <= imageSearchRadius; columnOffset++) {
		try {
			const result = decodeReviewSyncMarkerPixels(
				imageData,
				markerBounds,
				expectedTimestampMs,
				expectedImageLeft + columnOffset,
				imageSampleWidth,
			);
			if (!bestStripResult || result.confidence > bestStripResult.confidence) {
				bestStripResult = result;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unknown decoding error';
			decodeFailures.set(message, (decodeFailures.get(message) || 0) + 1);
		}
	}
	if (bestStripResult) return bestStripResult;

	const primaryFailure = [...decodeFailures.entries()]
		.sort((left, right) => right[1] - left[1])[0]?.[0];
	throw new Error(primaryFailure
		? `RG sync strip was not detected: ${primaryFailure}`
		: 'RG sync strip could not be decoded');
}
