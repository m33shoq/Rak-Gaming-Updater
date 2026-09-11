import log from 'electron-log/renderer';
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

import { IPC_EVENTS } from '@/events';
import type { ReviewSyncMarkerCapture } from '@/reviewSyncMarker';
import {
	createReviewSyncAnchor,
	evaluateReviewSyncReanchor,
	getActiveReviewSyncAnchor,
	getReviewLogTimestampForVideoTime,
	getReviewVideoTimeForLogTimestamp,
	type ReviewSyncMarkerAnchor,
	type ReviewSyncReanchorCandidate,
} from '@/reviewSynchronization';
import { decodeReviewSyncMarkerImage } from '@/renderer/reviewSyncMarkerDecoder';
import type { ReviewSeekCoordinator } from '@/renderer/reviewSeekCoordinator';
import type YTPlayer from '@/renderer/yt-player';
import type { ReviewYoutubePlayerState } from '@/renderer/composables/useReviewYoutubePlayer';

const YOUTUBE_DELAY_OFFSET_SECONDS = 5;
const AUTO_READ_INTERVAL_MS = 10_000;
const REANCHOR_THRESHOLD_MS = 250;
const AUTO_FAILURE_LOG_INTERVAL_MS = 5 * 60_000;
const STATE_CHANGE_READ_DELAY_MS = 500;
const SEEK_SETTLE_READ_DELAY_MS = 750;
const MIN_AUTO_READ_GAP_MS = 2_000;
const REANCHOR_CONFIRMATION_TOLERANCE_MS = 250;
const REANCHOR_CONFIRMATION_MAX_AGE_MS = 30_000;
const SEEK_FIRST_READ_DELAY_MS = 150;
const SEEK_OBSERVATION_INTERVAL_MS = 250;
const SEEK_OBSERVATION_MIN_SEPARATION_MS = 175;
const SEEK_OBSERVATION_TOLERANCE_MS = 175;
const SEEK_API_TIME_MAX_DISTANCE_SECONDS = 60;
const SEEK_LANDING_EARLY_TOLERANCE_MS = 250;
const SEEK_LANDING_LATE_TOLERANCE_MS = 350;
const SEEK_VERIFICATION_ORIGIN_TOLERANCE_MS = 1_000;
const SEEK_CORRECTION_TOLERANCE_MS = 250;
const SEEK_CORRECTION_MAX_MS = 60_000;
const SEEK_CORRECTION_MAX_AGE_MS = 30_000;
const SEEK_CORRECTION_MAX_ATTEMPTS = 2;
const SEEK_MAX_OBSERVATION_ATTEMPTS = 16;
const SEEK_MAX_READ_FAILURES = 6;
const SEEK_READ_FAILURE_BACKOFF_MAX_MS = 2_000;

type ReviewSyncCaptureTrigger = 'manual' | 'periodic' | 'player-state';

type SyncMarkerSeekObservation = {
	markerTimestampMs: number;
	videoTimeSeconds: number;
	timelineOriginMs: number;
	observedAt: number;
};

type PendingSyncMarkerSeek = {
	id: number;
	videoId: string;
	targetMarkerTimestampMs: number;
	startedAt: number;
	seekIssuedAt: number;
	requestedVideoTimeSeconds: number;
	phase: 'initial' | 'verification';
	correctionAttempts: number;
	observations: SyncMarkerSeekObservation[];
	playedSinceSeekMs: number;
	playingSince: number | null;
	playbackRateAtStart: number;
	observationAttempts: number;
	readFailures: number;
	seekRequestID: number;
};

type ReviewVideoSynchronizationOptions = {
	player: Ref<YTPlayer | null>;
	playerLoaded: Readonly<Ref<boolean>>;
	playerPlaying: Readonly<Ref<boolean>>;
	playerStateRevision: Readonly<Ref<number>>;
	playerSeekRevision: Readonly<Ref<number>>;
	videoContainer: Readonly<Ref<HTMLElement | null>>;
	getSelectedVideo: () => YouTubeVideo | null | undefined;
	getSelectedVideoID: () => string | null | undefined;
	seekCoordinator: ReviewSeekCoordinator;
	clampSeekTarget: (seconds: number) => number;
	dispatchPlayerSeek: (seconds: number) => void;
	keepControlsVisible: () => void;
	revealControls: () => void;
};

function formatVideoTime(seconds: number): string {
	const safeSeconds = Math.max(0, seconds);
	const hours = Math.floor(safeSeconds / 3600);
	const minutes = Math.floor((safeSeconds % 3600) / 60);
	const wholeSeconds = Math.floor(safeSeconds % 60);
	const deciseconds = Math.floor((safeSeconds % 1) * 10);
	return hours > 0
		? `${hours}:${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${deciseconds}`
		: `${minutes}:${wholeSeconds.toString().padStart(2, '0')}.${deciseconds}`;
}

function formatSignedSeconds(seconds: number): string {
	return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(1)}s`;
}

export function useReviewVideoSynchronization(options: ReviewVideoSynchronizationOptions) {
	const anchor = ref<ReviewSyncMarkerAnchor | null>(null);
	const status = ref('');
	const statusTone = ref<'success' | 'error' | 'info'>('info');
	const isCapturing = ref(false);
	let autoReadInterval: number | null = null;
	let scheduledReadTimeout: number | null = null;
	let lastAutoFailureLogTime = 0;
	let lastCaptureStartedAt = 0;
	let pendingReanchor: ReviewSyncReanchorCandidate | null = null;
	let nextSeekID = 0;
	let pendingSeek: PendingSyncMarkerSeek | null = null;

	function getActiveAnchor(): ReviewSyncMarkerAnchor | null {
		return getActiveReviewSyncAnchor(anchor.value, options.getSelectedVideoID());
	}

	function getVideoTimeForAbsoluteLogTimestamp(timestampMs: number): number {
		return getReviewVideoTimeForLogTimestamp(
			getActiveAnchor(),
			options.getSelectedVideo()?.startTime || 0,
			timestampMs,
			YOUTUBE_DELAY_OFFSET_SECONDS,
		);
	}

	function getAbsoluteLogTimestampForVideoTime(videoTimeSeconds: number): number {
		return getReviewLogTimestampForVideoTime(
			getActiveAnchor(),
			options.getSelectedVideo()?.startTime || 0,
			videoTimeSeconds,
			YOUTUBE_DELAY_OFFSET_SECONDS,
		);
	}

	function clearScheduledRead(): void {
		if (scheduledReadTimeout === null) return;
		window.clearTimeout(scheduledReadTimeout);
		scheduledReadTimeout = null;
	}

	function cancelPendingSeek(reason: string): void {
		const pending = pendingSeek;
		pendingSeek = null;
		if (pending) options.seekCoordinator.finish(pending.seekRequestID, 'unverified', reason);
	}

	function queueSeek(
		targetMarkerTimestampMs: number,
		requestedVideoTimeSeconds: number,
		seekRequestID: number,
		videoId: string,
	): void {
		pendingSeek = null;
		if (
			!videoId
			|| !Number.isFinite(targetMarkerTimestampMs)
			|| !Number.isFinite(requestedVideoTimeSeconds)
		) return;

		const now = Date.now();
		pendingSeek = {
			id: ++nextSeekID,
			videoId,
			targetMarkerTimestampMs,
			startedAt: now,
			seekIssuedAt: now,
			requestedVideoTimeSeconds,
			phase: 'initial',
			correctionAttempts: 0,
			observations: [],
			playedSinceSeekMs: 0,
			playingSince: options.playerPlaying.value
				&& options.player.value?.getVideoId() === videoId ? now : null,
			playbackRateAtStart: options.player.value?.getPlaybackRate() || 1,
			observationAttempts: 0,
			readFailures: 0,
			seekRequestID,
		};
	}

	function getPendingSeek(): PendingSyncMarkerSeek | null {
		const pending = pendingSeek;
		if (!pending) return null;
		const expired = Date.now() - pending.startedAt > SEEK_CORRECTION_MAX_AGE_MS;
		if (
			pending.videoId !== options.getSelectedVideoID()
			|| !options.seekCoordinator.isCurrent(pending.seekRequestID)
			|| expired
		) {
			pendingSeek = null;
			if (expired) {
				statusTone.value = 'error';
				status.value = 'Seek completed, but synchronization timed out';
				options.seekCoordinator.finish(
					pending.seekRequestID,
					'unverified',
					'Sync marker verification timed out',
				);
			}
			return null;
		}
		return pending;
	}

	function markPendingSeekPlaying(): void {
		const pending = getPendingSeek();
		if (
			!pending
			|| pending.playingSince !== null
			|| options.player.value?.getVideoId() !== pending.videoId
		) return;
		pending.playingSince = Date.now();
		pending.playbackRateAtStart = options.player.value?.getPlaybackRate() || 1;
	}

	function markPendingSeekStopped(): void {
		const pending = getPendingSeek();
		if (!pending || pending.playingSince === null) return;
		pending.playedSinceSeekMs += (
			Date.now() - pending.playingSince
		) * pending.playbackRateAtStart;
		pending.playingSince = null;
	}

	function updatePlaybackRate(rate: number): void {
		const pending = getPendingSeek();
		if (!pending || !Number.isFinite(rate) || rate <= 0) return;
		const wasPlaying = pending.playingSince !== null;
		if (wasPlaying) markPendingSeekStopped();
		pending.playbackRateAtStart = rate;
		if (wasPlaying) pending.playingSince = Date.now();
	}

	function getPendingSeekPlaybackMs(
		pending: PendingSyncMarkerSeek,
		observedAt: number,
	): number {
		if (pending.playingSince === null) return pending.playedSinceSeekMs;
		return pending.playedSinceSeekMs + Math.max(
			0,
			observedAt - pending.playingSince,
		) * pending.playbackRateAtStart;
	}

	function scheduleAutomaticRead(delayMilliseconds?: number): void {
		clearScheduledRead();
		const delay = delayMilliseconds ?? (
			getPendingSeek() ? SEEK_FIRST_READ_DELAY_MS : STATE_CHANGE_READ_DELAY_MS
		);
		scheduledReadTimeout = window.setTimeout(() => {
			scheduledReadTimeout = null;
			void capture('player-state');
		}, Math.max(0, delay));
	}

	function shouldApplyAnchor(
		automatic: boolean,
		videoId: string,
		differenceMs: number | null,
		markerTimelineOriginMs: number,
	): boolean {
		const decision = evaluateReviewSyncReanchor({
			automatic,
			videoId,
			differenceMs,
			markerTimelineOriginMs,
			observedAt: Date.now(),
			pendingCandidate: pendingReanchor,
			reanchorThresholdMs: REANCHOR_THRESHOLD_MS,
			confirmationToleranceMs: REANCHOR_CONFIRMATION_TOLERANCE_MS,
			confirmationMaxAgeMs: REANCHOR_CONFIRMATION_MAX_AGE_MS,
		});
		pendingReanchor = decision.pendingCandidate;
		if (decision.confirmPromptly) scheduleAutomaticRead(MIN_AUTO_READ_GAP_MS);
		return decision.apply;
	}

	function isSeekLandingPlausible(
		pending: PendingSyncMarkerSeek,
		videoTimeSeconds: number,
		observedAt: number,
	): boolean {
		const elapsedSeconds = Math.max(0, (observedAt - pending.seekIssuedAt) / 1000);
		const earliestPlausibleTime = pending.requestedVideoTimeSeconds
			- SEEK_API_TIME_MAX_DISTANCE_SECONDS;
		// YouTube can play at up to 2x while we wait for the rendered frame.
		const latestPlausibleTime = pending.requestedVideoTimeSeconds
			+ elapsedSeconds * 2
			+ SEEK_API_TIME_MAX_DISTANCE_SECONDS;
		return videoTimeSeconds >= earliestPlausibleTime
			&& videoTimeSeconds <= latestPlausibleTime;
	}

	function isSeekTargetReached(
		pending: PendingSyncMarkerSeek,
		markerTimestampMs: number,
		observedAt: number,
	): boolean {
		const playbackSinceSeekMs = getPendingSeekPlaybackMs(pending, observedAt);
		const landingErrorMs = markerTimestampMs - pending.targetMarkerTimestampMs;
		return landingErrorMs >= -SEEK_LANDING_EARLY_TOLERANCE_MS
			&& landingErrorMs <= playbackSinceSeekMs + SEEK_LANDING_LATE_TOLERANCE_MS;
	}

	function applyConfirmedOrigin(
		videoId: string,
		videoTimeSeconds: number,
		timelineOriginMs: number,
	): void {
		anchor.value = createReviewSyncAnchor(videoId, videoTimeSeconds, timelineOriginMs);
		pendingReanchor = null;
	}

	function processPendingSeek(
		markerTimestampMs: number,
		videoTimeSeconds: number,
		observedAt: number,
	): boolean {
		const pending = getPendingSeek();
		if (!pending) return false;
		pending.observationAttempts++;
		pending.readFailures = 0;
		if (pending.observationAttempts > SEEK_MAX_OBSERVATION_ATTEMPTS) {
			pendingSeek = null;
			options.seekCoordinator.finish(
				pending.seekRequestID,
				'unverified',
				'Rendered video frame did not stabilize',
			);
			statusTone.value = 'error';
			status.value = 'Seek sync stopped · rendered frame did not stabilize';
			log.warn('Could not obtain coherent RG sync marker frames after YouTube seek', {
				videoId: pending.videoId,
				phase: pending.phase,
				correctionAttempts: pending.correctionAttempts,
			});
			return true;
		}

		if (!isSeekLandingPlausible(pending, videoTimeSeconds, observedAt)) {
			log.debug('Ignored RG sync marker from a frame outside the active seek landing', {
				videoId: pending.videoId,
				phase: pending.phase,
				requestedVideoTimeSeconds: pending.requestedVideoTimeSeconds,
				videoTimeSeconds,
			});
			scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			return true;
		}

		const observation: SyncMarkerSeekObservation = {
			markerTimestampMs,
			videoTimeSeconds,
			timelineOriginMs: markerTimestampMs - videoTimeSeconds * 1000,
			observedAt,
		};
		const expectedTimelineOriginMs = pending.targetMarkerTimestampMs
			- pending.requestedVideoTimeSeconds * 1000;
		if (
			pending.phase === 'verification'
			&& Math.abs(observation.timelineOriginMs - expectedTimelineOriginMs)
				> SEEK_VERIFICATION_ORIGIN_TOLERANCE_MS
		) {
			// The iframe API may expose the corrected time before Chromium replaces
			// the pre-correction frame. Never feed that mixed observation back into
			// another correction.
			log.debug('Ignored stale RG sync marker frame while verifying corrected seek', {
				videoId: pending.videoId,
				originDifferenceMs: observation.timelineOriginMs - expectedTimelineOriginMs,
			});
			scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			return true;
		}
		const previousObservation = pending.observations.at(-1);
		if (!previousObservation) {
			pending.observations.push(observation);
			scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			return true;
		}

		const observationSeparationMs = observation.observedAt - previousObservation.observedAt;
		if (observationSeparationMs < SEEK_OBSERVATION_MIN_SEPARATION_MS) {
			scheduleAutomaticRead(SEEK_OBSERVATION_MIN_SEPARATION_MS - observationSeparationMs);
			return true;
		}

		const markerProgressMs = observation.markerTimestampMs
			- previousObservation.markerTimestampMs;
		const videoProgressMs = (
			observation.videoTimeSeconds - previousObservation.videoTimeSeconds
		) * 1000;
		const progressionDifferenceMs = markerProgressMs - videoProgressMs;
		if (Math.abs(progressionDifferenceMs) > SEEK_OBSERVATION_TOLERANCE_MS) {
			// A seek may update the iframe API before Chromium paints the new video
			// frame. Start the pair again from the newest observation in that case.
			pending.observations = [observation];
			log.debug('Waiting for two coherent RG sync marker frames after seek', {
				videoId: pending.videoId,
				phase: pending.phase,
				progressionDifferenceMs,
			});
			scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			return true;
		}

		const confirmedTimelineOriginMs = (
			previousObservation.timelineOriginMs + observation.timelineOriginMs
		) / 2;
		const mappingErrorMs = confirmedTimelineOriginMs - expectedTimelineOriginMs;
		const targetReached = isSeekTargetReached(
			pending,
			observation.markerTimestampMs,
			observation.observedAt,
		);
		if (Math.abs(mappingErrorMs) > SEEK_CORRECTION_MAX_MS) {
			pendingSeek = null;
			options.seekCoordinator.finish(
				pending.seekRequestID,
				'unverified',
				'RG sync marker implied an implausible mapping change',
			);
			statusTone.value = 'error';
			status.value = `Seek sync stopped · implausible ${formatSignedSeconds(mappingErrorMs / 1000)} mapping change`;
			log.warn('Rejected an implausible RG sync marker mapping after YouTube seek', {
				videoId: pending.videoId,
				phase: pending.phase,
				mappingErrorMs,
			});
			return true;
		}
		applyConfirmedOrigin(
			pending.videoId,
			observation.videoTimeSeconds,
			confirmedTimelineOriginMs,
		);

		if (Math.abs(mappingErrorMs) <= SEEK_CORRECTION_TOLERANCE_MS && targetReached) {
			pendingSeek = null;
			options.seekCoordinator.finish(pending.seekRequestID, 'completed');
			statusTone.value = 'success';
			status.value = `Seek synchronized · ${formatSignedSeconds(mappingErrorMs / 1000)} residual`;
			log.info('Verified YouTube seek against coherent RG sync marker frames', {
				videoId: pending.videoId,
				phase: pending.phase,
				mappingErrorMs,
				landingErrorMs: observation.markerTimestampMs - pending.targetMarkerTimestampMs,
				correctionAttempts: pending.correctionAttempts,
			});
			return true;
		}

		if (
			Math.abs(observation.markerTimestampMs - pending.targetMarkerTimestampMs)
				> SEEK_CORRECTION_MAX_MS
			|| pending.correctionAttempts >= SEEK_CORRECTION_MAX_ATTEMPTS
		) {
			pendingSeek = null;
			options.seekCoordinator.finish(
				pending.seekRequestID,
				'unverified',
				'RG sync marker correction did not converge',
			);
			statusTone.value = 'error';
			status.value = `Seek sync stopped · ${formatSignedSeconds(mappingErrorMs / 1000)} residual`;
			log.warn('Could not safely converge YouTube seek with RG sync marker', {
				videoId: pending.videoId,
				phase: pending.phase,
				mappingErrorMs,
				landingErrorMs: observation.markerTimestampMs - pending.targetMarkerTimestampMs,
				correctionAttempts: pending.correctionAttempts,
			});
			return true;
		}

		const correctedVideoTimeSeconds = options.clampSeekTarget(
			(pending.targetMarkerTimestampMs - confirmedTimelineOriginMs) / 1000,
		);
		const correctionDeltaMs = (
			correctedVideoTimeSeconds - observation.videoTimeSeconds
		) * 1000;
		pending.phase = 'verification';
		pending.correctionAttempts++;
		pending.requestedVideoTimeSeconds = correctedVideoTimeSeconds;
		pending.seekIssuedAt = Date.now();
		pending.observations = [];
		pending.playedSinceSeekMs = 0;
		pending.playingSince = options.playerPlaying.value ? pending.seekIssuedAt : null;
		pending.playbackRateAtStart = options.player.value?.getPlaybackRate() || 1;
		pending.observationAttempts = 0;
		pending.readFailures = 0;
		statusTone.value = 'info';
		status.value = `Correcting seek · ${formatSignedSeconds(correctionDeltaMs / 1000)}`;
		log.info('Correcting YouTube seek from confirmed RG sync marker mapping', {
			videoId: pending.videoId,
			mappingErrorMs,
			landingErrorMs: observation.markerTimestampMs - pending.targetMarkerTimestampMs,
			toVideoTimeSeconds: correctedVideoTimeSeconds,
			attempt: pending.correctionAttempts,
		});
		options.dispatchPlayerSeek(correctedVideoTimeSeconds);
		return true;
	}

	async function capture(trigger: ReviewSyncCaptureTrigger = 'manual'): Promise<void> {
		const automatic = trigger !== 'manual';
		if (isCapturing.value) {
			if (trigger === 'player-state') scheduleAutomaticRead(250);
			return;
		}
		const millisecondsSinceLastCapture = Date.now() - lastCaptureStartedAt;
		if (
			automatic
			&& ((trigger === 'periodic' && !options.playerPlaying.value)
				|| document.visibilityState !== 'visible')
		) return;
		if (automatic && !getPendingSeek() && millisecondsSinceLastCapture < MIN_AUTO_READ_GAP_MS) {
			if (trigger === 'player-state') {
				scheduleAutomaticRead(MIN_AUTO_READ_GAP_MS - millisecondsSinceLastCapture);
			}
			return;
		}
		const selectedVideo = options.getSelectedVideo();
		const container = options.videoContainer.value;
		if (!selectedVideo || !options.player.value || !options.playerLoaded.value || !container) {
			if (!automatic) {
				statusTone.value = 'error';
				status.value = 'Load a YouTube video before reading its sync marker';
			}
			return;
		}
		if (options.player.value.getVideoId() !== selectedVideo.id) {
			if (getPendingSeek()) {
				scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			} else if (!automatic) {
				statusTone.value = 'info';
				status.value = 'Waiting for the selected YouTube video to load';
			}
			return;
		}
		if (['unstarted', 'buffering'].includes(options.player.value.getState())) {
			if (getPendingSeek()) {
				scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
			} else if (!automatic) {
				statusTone.value = 'info';
				status.value = 'Waiting for the YouTube frame to finish loading';
			}
			return;
		}

		clearScheduledRead();
		isCapturing.value = true;
		lastCaptureStartedAt = Date.now();
		const playerStateRevisionAtCaptureStart = options.playerStateRevision.value;
		const playerSeekRevisionAtCaptureStart = options.playerSeekRevision.value;
		const syncMarkerSeekIDAtCaptureStart = getPendingSeek()?.id ?? null;
		if (!automatic) {
			statusTone.value = 'info';
			status.value = 'Reading RG sync marker...';
			options.keepControlsVisible();
		}

		try {
			const bounds = container.getBoundingClientRect();
			const videoTimeBeforeCapture = options.player.value.getCurrentTime();
			const videoTimeBeforeCapturedAt = Date.now();
			const markerCapture = await ipc.invoke(IPC_EVENTS.REVIEW_SYNC_CAPTURE_VIDEO_FRAME, {
				x: bounds.left,
				y: bounds.top,
				width: bounds.width,
				height: bounds.height,
			}) as ReviewSyncMarkerCapture;
			const videoTimeAfterCapture = options.player.value.getCurrentTime();
			const videoTimeAfterCapturedAt = Date.now();
			if (options.playerStateRevision.value !== playerStateRevisionAtCaptureStart) {
				throw new Error('YouTube player state changed while reading the sync marker');
			}
			if (options.playerSeekRevision.value !== playerSeekRevisionAtCaptureStart) {
				throw new Error('Video position changed while reading the sync marker');
			}
			if (options.getSelectedVideoID() !== selectedVideo.id) {
				throw new Error('The selected video changed while reading the marker');
			}
			if (options.player.value.getVideoId() !== selectedVideo.id) {
				throw new Error('YouTube displayed a different video while reading the marker');
			}
			if (!markerCapture?.dataUrl || typeof markerCapture.dataUrl !== 'string') {
				throw new Error('Electron did not return a captured YouTube frame');
			}
			if (
				!Number.isFinite(markerCapture.captureStartedAtMs)
				|| !Number.isFinite(markerCapture.captureFinishedAtMs)
				|| markerCapture.captureFinishedAtMs < markerCapture.captureStartedAtMs
			) {
				throw new Error('Electron returned invalid sync marker capture timing');
			}
			const frameCapturedAt = (
				markerCapture.captureStartedAtMs + markerCapture.captureFinishedAtMs
			) / 2;
			const sampleDurationMs = Math.max(1, videoTimeAfterCapturedAt - videoTimeBeforeCapturedAt);
			const allowedVideoMovementSeconds = sampleDurationMs / 1000
				* (options.player.value.getPlaybackRate() || 1)
				+ 0.5;
			if (
				!Number.isFinite(videoTimeBeforeCapture)
				|| !Number.isFinite(videoTimeAfterCapture)
				|| Math.abs(videoTimeAfterCapture - videoTimeBeforeCapture)
					> allowedVideoMovementSeconds
			) {
				throw new Error('Video moved too far while the marker was being captured');
			}

			const captureProgress = Math.max(0, Math.min(
				1,
				(frameCapturedAt - videoTimeBeforeCapturedAt) / sampleDurationMs,
			));
			const videoTimeSeconds = videoTimeBeforeCapture
				+ (videoTimeAfterCapture - videoTimeBeforeCapture) * captureProgress;
			const anchorAtCaptureStart = getActiveAnchor();
			const approximateTimestampMs = anchorAtCaptureStart
				? anchorAtCaptureStart.timestampMs
					+ (videoTimeSeconds - anchorAtCaptureStart.videoTimeSeconds) * 1000
				: selectedVideo.startTime + videoTimeSeconds * 1000;
			const marker = await decodeReviewSyncMarkerImage(
				markerCapture.dataUrl,
				markerCapture.markerBounds,
				approximateTimestampMs,
			);
			if (options.playerStateRevision.value !== playerStateRevisionAtCaptureStart) {
				throw new Error('YouTube player state changed while decoding the sync marker');
			}
			if (options.playerSeekRevision.value !== playerSeekRevisionAtCaptureStart) {
				throw new Error('Video position changed while decoding the sync marker');
			}
			if (options.getSelectedVideoID() !== selectedVideo.id) {
				throw new Error('The selected video changed while decoding the sync marker');
			}
			if (options.player.value.getVideoId() !== selectedVideo.id) {
				throw new Error('YouTube changed videos while decoding the sync marker');
			}
			if ((getPendingSeek()?.id ?? null) !== syncMarkerSeekIDAtCaptureStart) {
				throw new Error('A newer video seek started while decoding the sync marker');
			}
			const previousAnchor = getActiveAnchor();
			const anchorDifferenceMs = previousAnchor
				? marker.timestampMs - (
					previousAnchor.timestampMs
						+ (videoTimeSeconds - previousAnchor.videoTimeSeconds) * 1000
				)
				: null;
			const handledBySeekSynchronization = processPendingSeek(
				marker.timestampMs,
				videoTimeSeconds,
				frameCapturedAt,
			);
			const shouldApply = !handledBySeekSynchronization && shouldApplyAnchor(
				automatic,
				selectedVideo.id,
				anchorDifferenceMs,
				marker.timestampMs - videoTimeSeconds * 1000,
			);
			if (shouldApply) {
				applyConfirmedOrigin(
					selectedVideo.id,
					videoTimeSeconds,
					marker.timestampMs - videoTimeSeconds * 1000,
				);
			}

			const markerOffsetSeconds = videoTimeSeconds
				- (marker.timestampMs - selectedVideo.startTime) / 1000;
			const correctionSeconds = markerOffsetSeconds - YOUTUBE_DELAY_OFFSET_SECONDS;
			const markerTime = new Date(marker.timestampMs).toISOString().slice(11, 23);
			if (!handledBySeekSynchronization && shouldApply) {
				statusTone.value = 'success';
				const statusPrefix = automatic
					? previousAnchor ? 'Sync adjusted' : 'Sync active'
					: 'Prototype active';
				status.value = `${statusPrefix} · ${markerTime}Z at ${formatVideoTime(videoTimeSeconds)} · offset ${formatSignedSeconds(markerOffsetSeconds)} · correction ${formatSignedSeconds(correctionSeconds)} · ${Math.round(marker.confidence * 100)}% contrast`;
			} else if (!handledBySeekSynchronization && !automatic) {
				statusTone.value = 'success';
				status.value = `Sync stable · measured change ${formatSignedSeconds((anchorDifferenceMs || 0) / 1000)} · ${Math.round(marker.confidence * 100)}% contrast`;
			}
			if (!handledBySeekSynchronization && (shouldApply || !automatic)) {
				log[shouldApply ? 'info' : 'debug'](
					shouldApply
						? 'Applied prototype review sync marker'
						: 'Kept existing prototype review sync marker',
					{
						videoId: selectedVideo.id,
						videoTimeSeconds,
						markerTimestampMs: marker.timestampMs,
						markerOffsetSeconds,
						correctionSeconds,
						anchorDifferenceMs,
						automatic,
						confidence: marker.confidence,
					},
				);
			}
			lastAutoFailureLogTime = 0;
		} catch (error) {
			if (automatic) {
				const now = Date.now();
				if (now - lastAutoFailureLogTime >= AUTO_FAILURE_LOG_INTERVAL_MS) {
					lastAutoFailureLogTime = now;
					log.debug('Automatic review sync marker capture skipped after a failed read', error);
				}
			} else {
				statusTone.value = 'error';
				status.value = error instanceof Error
					? `Sync marker not read: ${error.message}`
					: 'Sync marker could not be read';
				log.warn('Prototype review sync marker capture failed', error);
			}
			const activePendingSeek = getPendingSeek();
			if (activePendingSeek) {
				if (activePendingSeek.id !== syncMarkerSeekIDAtCaptureStart) {
					scheduleAutomaticRead(SEEK_FIRST_READ_DELAY_MS);
				} else {
					activePendingSeek.readFailures++;
					if (activePendingSeek.readFailures >= SEEK_MAX_READ_FAILURES) {
						pendingSeek = null;
						options.seekCoordinator.finish(
							activePendingSeek.seekRequestID,
							'unverified',
							'Sync marker could not be read after seeking',
						);
						statusTone.value = 'error';
						status.value = activePendingSeek.phase === 'verification'
							? 'Seek correction could not be verified'
							: 'Seek completed, but its sync marker could not be verified';
						log.debug('Stopped seek synchronization after repeated marker read failures', {
							videoId: activePendingSeek.videoId,
							readFailures: activePendingSeek.readFailures,
						});
					} else {
						const retryDelayMs = Math.min(
							SEEK_OBSERVATION_INTERVAL_MS
								* 2 ** (activePendingSeek.readFailures - 1),
							SEEK_READ_FAILURE_BACKOFF_MAX_MS,
						);
						scheduleAutomaticRead(retryDelayMs);
					}
				}
			}
		} finally {
			isCapturing.value = false;
			if (!automatic) options.revealControls();
		}
	}

	function onPlayerStateChange(playerState: ReviewYoutubePlayerState): void {
		switch (playerState) {
			case 'unstarted':
				markPendingSeekStopped();
				if (getPendingSeek()) scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
				else clearScheduledRead();
				break;
			case 'cued':
				markPendingSeekStopped();
				scheduleAutomaticRead();
				break;
			case 'playing':
				markPendingSeekPlaying();
				scheduleAutomaticRead();
				break;
			case 'paused':
				markPendingSeekStopped();
				scheduleAutomaticRead();
				break;
			case 'buffering':
				markPendingSeekStopped();
				if (getPendingSeek()) scheduleAutomaticRead(SEEK_OBSERVATION_INTERVAL_MS);
				else clearScheduledRead();
				break;
			case 'ended':
				markPendingSeekStopped();
				scheduleAutomaticRead();
				break;
		}
	}

	function onPlayerSeekDispatched(): void {
		// The iframe does not consistently emit a state transition for paused or
		// short seeks. Start the guarded observation loop promptly for synchronized
		// seeks; ordinary relative seeks only need the slower anchor-maintenance read.
		scheduleAutomaticRead(getPendingSeek() ? SEEK_FIRST_READ_DELAY_MS : SEEK_SETTLE_READ_DELAY_MS);
	}

	function onSelectedVideoChange(videoID: string | null | undefined): void {
		if (anchor.value && anchor.value.videoId !== videoID) {
			anchor.value = null;
			status.value = '';
		}
		pendingReanchor = null;
		cancelPendingSeek('Selected video changed');
	}

	function onPlayerBeforeChange(): void {
		clearScheduledRead();
		options.seekCoordinator.cancel('YouTube player instance changed');
		cancelPendingSeek('YouTube player instance changed');
	}

	function failActiveSeek(message: string, clearScheduled = false): void {
		if (clearScheduled) clearScheduledRead();
		const seekState = options.seekCoordinator.state;
		pendingSeek = null;
		if (seekState) options.seekCoordinator.finish(seekState.requestID, 'failed', message);
	}

	function reportSeekFailure(message: string): void {
		statusTone.value = 'error';
		status.value = message;
	}

	function dismissStatus(): void {
		status.value = '';
	}

	function onVisibilityChange(): void {
		if (document.visibilityState !== 'visible') return;
		if (getPendingSeek()) scheduleAutomaticRead(0);
	}

	onMounted(() => {
		document.addEventListener('visibilitychange', onVisibilityChange);
		autoReadInterval = window.setInterval(() => {
			void capture('periodic');
		}, AUTO_READ_INTERVAL_MS);
	});

	onBeforeUnmount(() => {
		document.removeEventListener('visibilitychange', onVisibilityChange);
		clearScheduledRead();
		cancelPendingSeek('Reviews closed');
		options.seekCoordinator.cancel('Reviews closed');
		if (autoReadInterval !== null) {
			window.clearInterval(autoReadInterval);
			autoReadInterval = null;
		}
	});

	return {
		cancelPendingSeek,
		capture,
		dismissStatus,
		failActiveSeek,
		getAbsoluteLogTimestampForVideoTime,
		getPendingSeek,
		getVideoTimeForAbsoluteLogTimestamp,
		isCapturing,
		onPlayerBeforeChange,
		onPlayerSeekDispatched,
		onPlayerStateChange,
		onSelectedVideoChange,
		queueSeek,
		reportSeekFailure,
		status,
		statusTone,
		updatePlaybackRate,
	};
}
