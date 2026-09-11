export const REVIEW_SYNC_MARKER_LAYOUT = Object.freeze({
	sourceWidth: 1920,
	sourceHeight: 1080,
	codeLeft: 0,
	codeTop: 4,
	// Symbols are stacked vertically. A six-pixel-wide strip still leaves two
	// rendered columns at 360p, while each symbol retains more vertical samples.
	cellWidth: 6,
	cellHeight: 8,
	symbolCount: 16,
});

export const REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS = Object.freeze([0, 3, 1, 2]);

const FORMAT_TAG = 0xa4;
const FORMAT_VERSION = 4;
const MODULO_TIMESTAMP_BITS = 16;
const MODULO_TIMESTAMP_TICKS = 1 << MODULO_TIMESTAMP_BITS;
const DATA_SYMBOL_COUNT = 12;
const MAX_EXPECTED_TIMESTAMP_DISTANCE_MS = 50 * 60 * 1000;

export type ReviewSyncMarkerPayload = {
	version: number;
	timestampMs: number;
};

export type ReviewSyncMarkerRectangle = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ReviewSyncMarkerCapture = {
	dataUrl: string;
	markerBounds: ReviewSyncMarkerRectangle;
	size: { width: number; height: number };
	/** Wall-clock interval occupied by capturePage itself (image encoding excluded). */
	captureStartedAtMs: number;
	captureFinishedAtMs: number;
};

/** Map the source-canvas marker coordinates into a displayed 16:9 video. */
export function getDisplayedReviewSyncMarkerBounds(
	container: ReviewSyncMarkerRectangle,
): ReviewSyncMarkerRectangle {
	const targetAspectRatio = REVIEW_SYNC_MARKER_LAYOUT.sourceWidth / REVIEW_SYNC_MARKER_LAYOUT.sourceHeight;
	const containerAspectRatio = container.width / container.height;
	const videoWidth = containerAspectRatio > targetAspectRatio
		? container.height * targetAspectRatio
		: container.width;
	const videoHeight = containerAspectRatio > targetAspectRatio
		? container.height
		: container.width / targetAspectRatio;
	const videoLeft = container.x + (container.width - videoWidth) / 2;
	const videoTop = container.y + (container.height - videoHeight) / 2;
	const scaleX = videoWidth / REVIEW_SYNC_MARKER_LAYOUT.sourceWidth;
	const scaleY = videoHeight / REVIEW_SYNC_MARKER_LAYOUT.sourceHeight;

	return {
		x: videoLeft + REVIEW_SYNC_MARKER_LAYOUT.codeLeft * scaleX,
		y: videoTop + REVIEW_SYNC_MARKER_LAYOUT.codeTop * scaleY,
		width: REVIEW_SYNC_MARKER_LAYOUT.cellWidth * scaleX,
		height: REVIEW_SYNC_MARKER_LAYOUT.cellHeight * REVIEW_SYNC_MARKER_LAYOUT.symbolCount * scaleY,
	};
}

export function calculateReviewSyncMarkerCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc & 0x80) !== 0
				? ((crc << 1) ^ 0x07) & 0xff
				: (crc << 1) & 0xff;
		}
	}
	return crc;
}

export function encodeReviewSyncMarkerPayload(timestampMs: number): Uint8Array {
	if (!Number.isFinite(timestampMs)) throw new TypeError('Sync marker timestamp must be finite');

	const timestampTicks = Math.floor(timestampMs / 100);
	const moduloTimestampTicks = ((timestampTicks % MODULO_TIMESTAMP_TICKS) + MODULO_TIMESTAMP_TICKS)
		% MODULO_TIMESTAMP_TICKS;
	const checksumInput = new Uint8Array([
		FORMAT_TAG,
		(moduloTimestampTicks >>> 16) & 0x03,
		(moduloTimestampTicks >>> 8) & 0xff,
		moduloTimestampTicks & 0xff,
	]);
	const checksum = calculateReviewSyncMarkerCrc(checksumInput);
	let encodedPayload = moduloTimestampTicks * 256 + checksum;
	const symbols = new Uint8Array(REVIEW_SYNC_MARKER_LAYOUT.symbolCount);
	symbols.set(REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS);
	for (let index = DATA_SYMBOL_COUNT - 1; index >= 0; index--) {
		symbols[REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS.length + index] = encodedPayload & 0x03;
		encodedPayload = Math.floor(encodedPayload / 4);
	}
	return symbols;
}

export function decodeReviewSyncMarkerPayload(
	symbols: Uint8Array,
	expectedTimestampMs: number,
): ReviewSyncMarkerPayload {
	if (symbols.length !== REVIEW_SYNC_MARKER_LAYOUT.symbolCount) {
		throw new Error(`Unexpected sync marker symbol count ${symbols.length}`);
	}
	if (!Number.isFinite(expectedTimestampMs)) {
		throw new TypeError('An approximate video timestamp is required to decode the RG sync marker');
	}
	for (let index = 0; index < REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS.length; index++) {
		if (symbols[index] !== REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS[index]) {
			throw new Error('RG sync marker calibration pattern did not match');
		}
	}

	let encodedPayload = 0;
	for (let index = REVIEW_SYNC_MARKER_CALIBRATION_SYMBOLS.length; index < symbols.length; index++) {
		if (symbols[index] > 3) throw new Error('RG sync marker contains an invalid symbol');
		encodedPayload = encodedPayload * 4 + symbols[index];
	}
	const moduloTimestampTicks = Math.floor(encodedPayload / 256);
	const checksum = encodedPayload & 0xff;
	const expectedChecksum = calculateReviewSyncMarkerCrc(new Uint8Array([
		FORMAT_TAG,
		(moduloTimestampTicks >>> 16) & 0x03,
		(moduloTimestampTicks >>> 8) & 0xff,
		moduloTimestampTicks & 0xff,
	]));
	if (checksum !== expectedChecksum) {
		throw new Error('RG sync marker checksum did not match');
	}

	const expectedTimestampTicks = Math.round(expectedTimestampMs / 100);
	const expectedCycleStart = Math.floor(expectedTimestampTicks / MODULO_TIMESTAMP_TICKS)
		* MODULO_TIMESTAMP_TICKS;
	const timestampTickCandidates = [-MODULO_TIMESTAMP_TICKS, 0, MODULO_TIMESTAMP_TICKS]
		.map(cycleOffset => expectedCycleStart + cycleOffset + moduloTimestampTicks);
	const timestampTicks = timestampTickCandidates.reduce((closest, candidate) => (
		Math.abs(candidate - expectedTimestampTicks) < Math.abs(closest - expectedTimestampTicks)
			? candidate
			: closest
	));
	const timestampMs = timestampTicks * 100;
	if (Math.abs(timestampMs - expectedTimestampMs) > MAX_EXPECTED_TIMESTAMP_DISTANCE_MS) {
		throw new Error('RG sync marker time is too far from the selected video time');
	}

	return { version: FORMAT_VERSION, timestampMs };
}
