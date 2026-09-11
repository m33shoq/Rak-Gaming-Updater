export type ReviewSyncMarkerAnchor = {
	videoId: string;
	videoTimeSeconds: number;
	timestampMs: number;
};

export type ReviewSyncReanchorCandidate = {
	videoId: string;
	kind: 'initial' | 'adjustment';
	measurementMs: number;
	observedAt: number;
};

type ReviewSyncReanchorOptions = {
	automatic: boolean;
	videoId: string;
	differenceMs: number | null;
	markerTimelineOriginMs: number;
	observedAt: number;
	pendingCandidate: ReviewSyncReanchorCandidate | null;
	reanchorThresholdMs: number;
	confirmationToleranceMs: number;
	confirmationMaxAgeMs: number;
};

export type ReviewSyncReanchorDecision = {
	apply: boolean;
	pendingCandidate: ReviewSyncReanchorCandidate | null;
	confirmPromptly: boolean;
};

export function getActiveReviewSyncAnchor(
	anchor: ReviewSyncMarkerAnchor | null,
	selectedVideoId: string | null | undefined,
): ReviewSyncMarkerAnchor | null {
	return anchor?.videoId === selectedVideoId ? anchor : null;
}

export function getReviewVideoTimeForLogTimestamp(
	anchor: ReviewSyncMarkerAnchor | null,
	videoStartTimeMs: number,
	timestampMs: number,
	defaultDelaySeconds: number,
): number {
	if (anchor) {
		return anchor.videoTimeSeconds + (timestampMs - anchor.timestampMs) / 1000;
	}
	return (timestampMs - videoStartTimeMs) / 1000 + defaultDelaySeconds;
}

export function getReviewLogTimestampForVideoTime(
	anchor: ReviewSyncMarkerAnchor | null,
	videoStartTimeMs: number,
	videoTimeSeconds: number,
	defaultDelaySeconds: number,
): number {
	if (anchor) {
		return anchor.timestampMs + (videoTimeSeconds - anchor.videoTimeSeconds) * 1000;
	}
	return videoStartTimeMs + (videoTimeSeconds - defaultDelaySeconds) * 1000;
}

export function createReviewSyncAnchor(
	videoId: string,
	videoTimeSeconds: number,
	timelineOriginMs: number,
): ReviewSyncMarkerAnchor {
	return {
		videoId,
		videoTimeSeconds,
		timestampMs: timelineOriginMs + videoTimeSeconds * 1000,
	};
}

export function evaluateReviewSyncReanchor(
	options: ReviewSyncReanchorOptions,
): ReviewSyncReanchorDecision {
	if (!options.automatic) {
		return {
			apply: options.differenceMs === null
				|| Math.abs(options.differenceMs) >= options.reanchorThresholdMs,
			pendingCandidate: null,
			confirmPromptly: false,
		};
	}

	const kind = options.differenceMs === null ? 'initial' : 'adjustment';
	const measurementMs = options.differenceMs ?? options.markerTimelineOriginMs;
	const pending = options.pendingCandidate;
	if (
		pending?.videoId === options.videoId
		&& pending.kind === kind
		&& options.observedAt - pending.observedAt <= options.confirmationMaxAgeMs
		&& Math.abs(pending.measurementMs - measurementMs) <= options.confirmationToleranceMs
	) {
		const averageMeasurementMs = (pending.measurementMs + measurementMs) / 2;
		return {
			apply: kind === 'initial'
				|| Math.abs(averageMeasurementMs) >= options.reanchorThresholdMs,
			pendingCandidate: null,
			confirmPromptly: false,
		};
	}

	if (kind === 'initial' || Math.abs(measurementMs) >= options.reanchorThresholdMs) {
		return {
			apply: false,
			pendingCandidate: {
				videoId: options.videoId,
				kind,
				measurementMs,
				observedAt: options.observedAt,
			},
			confirmPromptly: true,
		};
	}

	return {
		apply: false,
		pendingCandidate: null,
		confirmPromptly: false,
	};
}
