import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLOCK_SAMPLE_COUNT = 5;
const CLOCK_SAMPLE_PERIOD_SECONDS = 1;
const CLOCK_SAMPLE_TIMEOUT_MS = 12_000;
const MIN_VALID_SAMPLE_COUNT = 3;
const MAX_SAMPLE_DISTANCE_FROM_MEDIAN_MS = 250;
const MAX_ACCEPTED_SAMPLE_SPREAD_MS = 250;
const MAX_ACCEPTED_CLOCK_OFFSET_MS = 5 * 60 * 1000;

export type WindowsClockCalibration = {
	applied: boolean;
	offsetMs: number;
	sampleCount: number;
	uncertaintyMs: number | null;
	measuredAtMs: number;
	failureReason: string | null;
};

function median(values: number[]): number {
	if (values.length === 0) throw new RangeError('Cannot calculate the median of no values');
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

/**
 * Parse the signed seconds printed at the end of each `w32tm /stripchart
 * /dataonly` sample. The surrounding status text is localized by Windows, so
 * deliberately do not depend on English labels or the timestamp at line start.
 */
export function parseW32tmClockOffsetSamples(output: string): number[] {
	const samples: number[] = [];
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/([+-])\s*(\d+(?:[.,]\d+)?)s\s*$/i);
		if (!match) continue;
		const seconds = Number(`${match[1]}${match[2].replace(',', '.')}`);
		if (Number.isFinite(seconds)) samples.push(seconds * 1000);
	}
	return samples;
}

function fallbackCalibration(reason: string): WindowsClockCalibration {
	return {
		applied: false,
		offsetMs: 0,
		sampleCount: 0,
		uncertaintyMs: null,
		measuredAtMs: Date.now(),
		failureReason: reason,
	};
}

export async function measureWindowsClockCalibration(): Promise<WindowsClockCalibration> {
	if (process.platform !== 'win32') {
		return fallbackCalibration('Windows Time calibration is unavailable on this platform');
	}

	try {
		const { stdout } = await execFileAsync('w32tm.exe', [
			'/stripchart',
			'/computer:time.windows.com',
			`/samples:${CLOCK_SAMPLE_COUNT}`,
			`/period:${CLOCK_SAMPLE_PERIOD_SECONDS}`,
			'/dataonly',
		], {
			encoding: 'utf8',
			timeout: CLOCK_SAMPLE_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 64 * 1024,
		});
		const samples = parseW32tmClockOffsetSamples(stdout);
		if (samples.length < MIN_VALID_SAMPLE_COUNT) {
			return fallbackCalibration(`Windows Time returned only ${samples.length} readable samples`);
		}

		const initialMedian = median(samples);
		const inliers = samples.filter(sample => (
			Math.abs(sample - initialMedian) <= MAX_SAMPLE_DISTANCE_FROM_MEDIAN_MS
		));
		if (inliers.length < MIN_VALID_SAMPLE_COUNT) {
			return fallbackCalibration('Windows Time samples did not agree');
		}

		const offsetMs = median(inliers);
		// W32tm reports the correction from the local clock to the reference
		// clock (reference - local), so it can be added directly to Date.now().
		const sampleSpreadMs = Math.max(...inliers) - Math.min(...inliers);
		if (sampleSpreadMs > MAX_ACCEPTED_SAMPLE_SPREAD_MS) {
			return fallbackCalibration(`Windows Time sample spread was ${sampleSpreadMs.toFixed(1)}ms`);
		}
		if (Math.abs(offsetMs) > MAX_ACCEPTED_CLOCK_OFFSET_MS) {
			return fallbackCalibration(`Windows Time offset was implausibly large (${offsetMs.toFixed(1)}ms)`);
		}

		return {
			applied: true,
			offsetMs: Math.round(offsetMs),
			sampleCount: inliers.length,
			uncertaintyMs: sampleSpreadMs / 2,
			measuredAtMs: Date.now(),
			failureReason: null,
		};
	} catch (error) {
		return fallbackCalibration(error instanceof Error ? error.message : String(error));
	}
}
