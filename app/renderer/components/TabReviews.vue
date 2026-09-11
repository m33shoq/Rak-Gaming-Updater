<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import type { ReviewTimelineWindowAction, ReviewTimelineWindowContext } from '@/timelineWindow';

import { ref, computed, watch, onMounted, onBeforeUnmount, useTemplateRef, nextTick } from 'vue';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useReviewPlayerHotkeys } from '@/renderer/composables/useReviewPlayerHotkeys';
import { createReviewTimelinePlayback } from '@/renderer/composables/useReviewTimelinePlayback';

import TabContent from '@/renderer/components/TabContent.vue';
import ReviewCooldownTimeline from '@/renderer/components/ReviewCooldownTimeline.vue';
import ReviewPlayerOverlay from '@/renderer/components/ReviewPlayerOverlay.vue';
import ReviewVideoList from '@/renderer/components/ReviewVideoList.vue';
import ReviewWclSelectors from '@/renderer/components/ReviewWclSelectors.vue';

import { useReviewsStore } from '@/renderer/store/ReviewsStore';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';

import YTPlayer from '@/renderer/yt-player';
import { decodeReviewSyncMarkerImage } from '@/renderer/reviewSyncMarkerDecoder';
import type { ReviewSyncMarkerCapture } from '@/reviewSyncMarker';
import {
	ReviewSeekCoordinator,
	type ReviewSeekExecutionContext,
	type ReviewSeekIntent,
	type ReviewSeekSource,
} from '@/renderer/reviewSeekCoordinator';
import { getReviewVideoEndTime } from '@/reviewVideoSelection';

const reviewsStore = useReviewsStore();
let playerLoaded = false;

const player = ref<YTPlayer | null>(null);
const playerIframe = useTemplateRef<HTMLIFrameElement | null>('playerIframe');
const videoContainer = useTemplateRef<HTMLElement | null>('videoContainer');
type ReviewPlayerOverlayHandle = {
	closeHotkeyGuide: () => boolean;
	keepControlsVisible: () => void;
	reset: () => void;
	revealControls: () => void;
};
const playerOverlay = useTemplateRef<ReviewPlayerOverlayHandle | null>('playerOverlay');
const isPlayerFullscreen = ref(false);
const isPlayerPlaying = ref(false);
const syncPrototypeAnchor = ref<{
	videoId: string;
	videoTimeSeconds: number;
	timestampMs: number;
} | null>(null);
const syncPrototypeStatus = ref('');
const syncPrototypeStatusTone = ref<'success' | 'error' | 'info'>('info');
const isSyncPrototypeCapturing = ref(false);

const VIDEO_TIME_UPDATE_HZ = 16;
const SYNC_MARKER_AUTO_READ_INTERVAL_MS = 10_000;
const SYNC_MARKER_REANCHOR_THRESHOLD_MS = 250;
const SYNC_MARKER_AUTO_FAILURE_LOG_INTERVAL_MS = 5 * 60_000;
const SYNC_MARKER_STATE_CHANGE_READ_DELAY_MS = 500;
const SYNC_MARKER_SEEK_SETTLE_READ_DELAY_MS = 750;
const SYNC_MARKER_MIN_AUTO_READ_GAP_MS = 2_000;
const SYNC_MARKER_REANCHOR_CONFIRMATION_TOLERANCE_MS = 250;
const SYNC_MARKER_REANCHOR_CONFIRMATION_MAX_AGE_MS = 30_000;
const SYNC_MARKER_SEEK_FIRST_READ_DELAY_MS = 150;
const SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS = 250;
const SYNC_MARKER_SEEK_OBSERVATION_MIN_SEPARATION_MS = 175;
const SYNC_MARKER_SEEK_OBSERVATION_TOLERANCE_MS = 175;
const SYNC_MARKER_SEEK_API_TIME_MAX_DISTANCE_SECONDS = 60;
const SYNC_MARKER_SEEK_LANDING_EARLY_TOLERANCE_MS = 250;
const SYNC_MARKER_SEEK_LANDING_LATE_TOLERANCE_MS = 350;
const SYNC_MARKER_SEEK_VERIFICATION_ORIGIN_TOLERANCE_MS = 1_000;
const SYNC_MARKER_SEEK_CORRECTION_TOLERANCE_MS = 250;
const SYNC_MARKER_SEEK_CORRECTION_MAX_MS = 60_000;
const SYNC_MARKER_SEEK_CORRECTION_MAX_AGE_MS = 30_000;
const SYNC_MARKER_SEEK_CORRECTION_MAX_ATTEMPTS = 2;
const SYNC_MARKER_SEEK_MAX_OBSERVATION_ATTEMPTS = 16;
const SYNC_MARKER_SEEK_MAX_READ_FAILURES = 6;
const SYNC_MARKER_SEEK_READ_FAILURE_BACKOFF_MAX_MS = 2_000;

let syncMarkerAutoReadInterval: number | null = null;
let syncMarkerScheduledReadTimeout: number | null = null;
let lastSyncMarkerAutoFailureLogTime = 0;
let lastSyncMarkerCaptureStartedAt = 0;
let youtubePlayerStateRevision = 0;
let youtubePlayerSeekRevision = 0;
let pendingSyncMarkerReanchor: {
	videoId: string;
	kind: 'initial' | 'adjustment';
	measurementMs: number;
	observedAt: number;
} | null = null;
type SyncMarkerSeekObservation = {
	markerTimestampMs: number;
	videoTimeSeconds: number;
	timelineOriginMs: number;
	observedAt: number;
};

let nextSyncMarkerSeekID = 0;
let pendingSyncMarkerSeek: {
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
} | null = null;

let internallySelectedFight: { requestID: number; fightID: number } | null = null;
let internallySelectedVideo: { requestID: number; videoID: string } | null = null;

const reviewSeekCoordinator = new ReviewSeekCoordinator(
	executeReviewSeek,
	state => {
		if (state?.phase === 'failed' || state?.phase === 'unavailable') {
			syncPrototypeStatusTone.value = 'error';
			syncPrototypeStatus.value = state.message || 'Video seek is unavailable';
		}
	},
);

let fullscreenToggleInProgress = false;
let playerBoundsResizeObserver: ResizeObserver | null = null;

const {
	clampSeekTarget,
	clearQueuedSeek: clearQueuedHotkeySeek,
	onPlayerDoubleClick,
	onPlayerTimeUpdate: onHotkeySeekTimeUpdate,
	queuedSeekDeltaLabel,
	queuedSeekDeltaSeconds,
	queuedSeekDirectionClass,
	togglePlayPause,
} = useReviewPlayerHotkeys({
	player,
	isPlaying: isPlayerPlaying,
	hasSelectedVideo: () => Boolean(reviewsStore.getSelectedVideoId),
	revealControls: () => revealPlayerControls(),
	closeHotkeyGuide: () => playerOverlay.value?.closeHotkeyGuide() ?? false,
	requestFullscreenToggle: () => requestFullscreenToggle(),
	requestQueuedSeek: seconds => {
		void requestVideoTimeSeek(seconds, 'hotkey', false);
	},
	dispatchFrameSeek: seconds => dispatchPlayerSeek(seconds),
	cancelActiveSeek: reason => reviewSeekCoordinator.cancel(reason),
	cancelSynchronizedSeek: reason => cancelPendingSynchronizedSeek(reason),
});

function publishPlayerPointerBounds() {
	const rect = videoContainer.value?.getBoundingClientRect();
	if (!rect || rect.width <= 0 || rect.height <= 0) {
		ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, null);
		return;
	}

	ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, {
		left: rect.left,
		top: rect.top,
		right: rect.right,
		bottom: rect.bottom,
	});
}

function onPlayerPointerEnter() {
	publishPlayerPointerBounds();
	revealPlayerControls();
}

function revealPlayerControls() {
	playerOverlay.value?.revealControls();
}

function keepPlayerControlsVisible() {
	playerOverlay.value?.keepControlsVisible();
}

function dispatchPlayerSeek(seconds: number) {
	youtubePlayerSeekRevision++;
	player.value?.seek(seconds);
	// The iframe does not consistently emit a state transition for paused or
	// short seeks. Start the guarded observation loop promptly for synchronized
	// seeks; ordinary relative seeks only need the slower anchor-maintenance read.
	scheduleAutomaticSyncMarkerRead(
		getPendingSyncMarkerSeek()
			? SYNC_MARKER_SEEK_FIRST_READ_DELAY_MS
			: SYNC_MARKER_SEEK_SETTLE_READ_DELAY_MS,
	);
}

function dispatchPlayerLoad(videoID: string, autoplay: boolean, seconds: number) {
	youtubePlayerSeekRevision++;
	player.value?.load(videoID, autoplay, seconds);
}

async function toggleFullscreen() {
	const fullscreenTarget = videoContainer.value;
	const enteringFullscreen = !isPlayerFullscreen.value;
	if (
		!fullscreenTarget?.isConnected
		|| fullscreenToggleInProgress
		|| (enteringFullscreen && (!playerLoaded || !reviewsStore.getSelectedVideoId))
	) return;

	fullscreenToggleInProgress = true;
	try {
		isPlayerFullscreen.value = await ipc.invoke(
			IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET,
			!isPlayerFullscreen.value,
		) === true;
	} catch (error) {
		log.warn('Failed to toggle YouTube player fullscreen', error);
	} finally {
		fullscreenToggleInProgress = false;
	}
}

function requestFullscreenToggle() {
	if (fullscreenToggleInProgress) return;
	playerOverlay.value?.closeHotkeyGuide();
	void toggleFullscreen();
}

function onReviewsVisibilityChange() {
	if (document.visibilityState !== 'visible') return;
	if (getPendingSyncMarkerSeek()) scheduleAutomaticSyncMarkerRead(0);
}

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_ACTIVITY_CALLBACK, () => {
	revealPlayerControls();
});

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_CHANGED, (_event, fullscreen: boolean) => {
	isPlayerFullscreen.value = fullscreen === true;
	playerOverlay.value?.closeHotkeyGuide();
	revealPlayerControls();
	void nextTick(publishPlayerPointerBounds);
});

watch(videoContainer, (container) => {
	playerBoundsResizeObserver?.disconnect();
	playerBoundsResizeObserver = null;
	if (!container) {
		publishPlayerPointerBounds();
		return;
	}

	playerBoundsResizeObserver = new ResizeObserver(publishPlayerPointerBounds);
	playerBoundsResizeObserver.observe(container);
	void nextTick(publishPlayerPointerBounds);
});

let lastFightRelativeTime = 0;
function requestSelectedVideoPlayback(source: ReviewSeekSource = 'video-selection') {
	const videoID = reviewsStore.getSelectedVideoId;
	if (!videoID || !player.value || !playerLoaded) return;

	const directSeekSeconds = reviewsStore.consumePendingDirectVideoSeekSeconds();
	if (directSeekSeconds !== null) {
		void requestVideoTimeSeek(directSeekSeconds, 'deep-link', true, videoID);
		return;
	}

	const fightID = reviewsStore.selectedFightID;
	if (fightID) {
		void requestFightSeek(fightID, lastFightRelativeTime, source, videoID);
		return;
	}

	const reportStartTime = reviewsStore.getSelectedReport?.startTime
		?? reviewsStore.getReportDetails?.startTime;
	const reportVideoTime = Number.isFinite(reportStartTime)
		? Math.max(0, getVideoTimeForAbsoluteLogTimestamp(reportStartTime!))
		: 0;
	void requestVideoTimeSeek(reportVideoTime, source, true, videoID);
}

watch(() => reviewsStore.getSelectedVideoId, (newId) => {
	if (syncPrototypeAnchor.value && syncPrototypeAnchor.value.videoId !== newId) {
		syncPrototypeAnchor.value = null;
		syncPrototypeStatus.value = '';
	}
	pendingSyncMarkerReanchor = null;
	cancelPendingSynchronizedSeek('Selected video changed');
	if (!newId) {
		internallySelectedVideo = null;
		reviewSeekCoordinator.cancel('No video selected');
		playerOverlay.value?.reset();
		player.value?.stop();
		return;
	}
	if (
		internallySelectedVideo?.videoID === newId
		&& reviewSeekCoordinator.state?.requestID === internallySelectedVideo.requestID
	) {
		internallySelectedVideo = null;
		return;
	}
	internallySelectedVideo = null;
	requestSelectedVideoPlayback();
});

watch(() => reviewsStore.pendingDirectVideoSeekSeconds, () => {
	if (reviewsStore.pendingDirectVideoSeekSeconds !== null) {
		requestSelectedVideoPlayback('deep-link');
	}
});

watch(() => reviewsStore.selectedFightID, (newVal) => {
	if (
		newVal
		&& internallySelectedFight?.fightID === newVal
		&& reviewSeekCoordinator.state?.requestID === internallySelectedFight.requestID
	) {
		internallySelectedFight = null;
		return;
	}
	internallySelectedFight = null;
	lastFightRelativeTime = 0;
	if (newVal) void requestFightSeek(newVal, 0, 'fight-selection');
	else reviewSeekCoordinator.cancel('No fight selected');
});

watch(() => reviewsStore.selectedReportCode, async (newVal, oldVal) => {
	if (newVal !== oldVal) {
		lastFightRelativeTime = 0;
		internallySelectedFight = null;
		internallySelectedVideo = null;
		reviewSeekCoordinator.cancel('Selected report changed');
		cancelPendingSynchronizedSeek('Selected report changed');
		await nextTick();
		if (reviewsStore.selectedReportCode !== newVal) return;
		if (newVal && reviewsStore.selectedVideoInfo) {
			const reportStart = reviewsStore.getSelectedReport?.startTime
				?? reviewsStore.getReportDetails?.startTime;
			if (Number.isFinite(reportStart)) {
				void requestVideoTimeSeek(
					getVideoTimeForAbsoluteLogTimestamp(reportStart!),
					'report-selection',
					true,
				);
			}
		}
	}
});


const playerReloads = ref(0);

function reloadPlayer() {
  playerReloads.value++;
  log.info("Reloading YouTube player, reload count:", playerReloads.value);
}

const currentVideoTime = ref(0);

watch(playerIframe, (el) => {
	clearQueuedHotkeySeek();
	clearScheduledSyncMarkerRead();
	reviewSeekCoordinator.cancel('YouTube player instance changed');
	cancelPendingSynchronizedSeek('YouTube player instance changed');
	youtubePlayerStateRevision++;
	isPlayerPlaying.value = false;
	keepPlayerControlsVisible();
	if (player.value) {
		log.info("Destroying existing YouTube player instance");
		player.value.destroy();
		player.value = null;
		playerLoaded = false;
	}
	if (el) {
		log.info("Creating new YouTube player instance");
		player.value = new YTPlayer(el, {
			autoplay: true,
			// Keep YouTube's quality, captions, and settings controls available.
			controls: true,
			// Fullscreen is app-owned so YouTube cannot create a competing state.
			fullscreen: false,
			height: '100%',
			host: "https://www.youtube-nocookie.com",
			keyboard: false,
			timeupdateFrequency: 1000 / VIDEO_TIME_UPDATE_HZ,
			width: '100%',
		});

		player.value.on('unplayable', ({ videoId, errorCode, data }) => {
			clearQueuedHotkeySeek();
			const seekState = reviewSeekCoordinator.state;
			pendingSyncMarkerSeek = null;
			if (seekState) reviewSeekCoordinator.finish(
				seekState.requestID,
				'failed',
				'YouTube could not play the selected video',
			);
			log.info("YouTube video unplayable:", videoId, errorCode);
			log.info(player.value._player)
			log.info("playerInfo", player.value?._player?.playerInfo)
			log.info('data', data)
			if (player.value?._player?.getVideoData) {
				log.info("videoData", player.value?._player?.getVideoData())
			}
			log.info('debugText', player.value?._player?.getDebugText())

			// alert(`The requested video ${videoId} is unplayable. Error code: ${errorCode}`);
			if (errorCode === 150) { // noreferrer bug, try reloading the player 153 actually fires with 150 wtf
				setTimeout(() => {
					reloadPlayer();
				}, 1500);
			}
		});

		player.value.on('error', (error) => {
			youtubePlayerStateRevision++;
			clearScheduledSyncMarkerRead();
			clearQueuedHotkeySeek();
			pendingSyncMarkerSeek = null;
			const seekState = reviewSeekCoordinator.state;
			if (seekState) reviewSeekCoordinator.finish(
				seekState.requestID,
				'failed',
				'YouTube player error',
			);
			log.info("YouTube embed error:", error);
			alert(`Error embedding video. Error code: ${error}`);
		});

		player.value.on('timeupdate', (seconds) => {
			currentVideoTime.value = seconds;
			onHotkeySeekTimeUpdate(seconds);
			rememberCurrentFightTime();
		});

		player.value.on('unstarted', () => {
			youtubePlayerStateRevision++;
			markPendingSyncMarkerSeekStopped();
			isPlayerPlaying.value = false;
			if (getPendingSyncMarkerSeek()) {
				scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
			} else {
				clearScheduledSyncMarkerRead();
			}
			keepPlayerControlsVisible();
		});

		player.value.on('cued', () => {
			youtubePlayerStateRevision++;
			markPendingSyncMarkerSeekStopped();
			isPlayerPlaying.value = false;
			keepPlayerControlsVisible();
			scheduleAutomaticSyncMarkerRead();
		});

		player.value.on('ready', () => {
			youtubePlayerStateRevision++;
			log.info('YouTube player ready');
			playerLoaded = true;
			player.value.mute();
			requestSelectedVideoPlayback();
			reviewsStore.flushPendingTimelineWindowActions();
		});

		player.value.on('playing', () => {
			youtubePlayerStateRevision++;
			isPlayerPlaying.value = true;
			markPendingSyncMarkerSeekPlaying();
			revealPlayerControls();
			scheduleAutomaticSyncMarkerRead();
		});

		const keepControlsVisibleWhileStopped = () => {
			isPlayerPlaying.value = false;
			keepPlayerControlsVisible();
		};
		player.value.on('paused', () => {
			youtubePlayerStateRevision++;
			markPendingSyncMarkerSeekStopped();
			keepControlsVisibleWhileStopped();
			scheduleAutomaticSyncMarkerRead();
		});
		player.value.on('buffering', () => {
			youtubePlayerStateRevision++;
			markPendingSyncMarkerSeekStopped();
			keepControlsVisibleWhileStopped();
			if (getPendingSyncMarkerSeek()) {
				scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
			} else {
				clearScheduledSyncMarkerRead();
			}
		});
		player.value.on('ended', () => {
			youtubePlayerStateRevision++;
			markPendingSyncMarkerSeekStopped();
			keepControlsVisibleWhileStopped();
			scheduleAutomaticSyncMarkerRead();
		});
		player.value.on('playbackRateChange', (rate) => {
			updatePendingSyncMarkerSeekPlaybackRate(rate);
		});
	}
});

onMounted(async () => {
	window.addEventListener('resize', publishPlayerPointerBounds);
	document.addEventListener('visibilitychange', onReviewsVisibilityChange);
	syncMarkerAutoReadInterval = window.setInterval(() => {
		void captureReviewSyncMarker('periodic');
	}, SYNC_MARKER_AUTO_READ_INTERVAL_MS);
	try {
		isPlayerFullscreen.value = await ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_STATUS_GET) === true;
	} catch (error) {
		log.warn('Failed to load YouTube player fullscreen state', error);
	}
	try {
		const status = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET) as { detached?: boolean };
		const wasDetached = reviewsStore.timelineWindowDetached;
		reviewsStore.timelineWindowDetached = status?.detached === true;
		if (reviewsStore.timelineWindowDetached) {
			sendTimelineWindowContext();
		} else if (wasDetached) {
			reviewsStore.timelineExpanded = true;
			void reviewsStore.reloadBossCastPreferences();
		}
	} catch (error) {
		log.error('Failed to load detached timeline status', error);
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('resize', publishPlayerPointerBounds);
	document.removeEventListener('visibilitychange', onReviewsVisibilityChange);
	clearScheduledSyncMarkerRead();
	cancelPendingSynchronizedSeek('Reviews closed');
	reviewSeekCoordinator.cancel('Reviews closed');
	if (syncMarkerAutoReadInterval !== null) {
		window.clearInterval(syncMarkerAutoReadInterval);
		syncMarkerAutoReadInterval = null;
	}
	playerBoundsResizeObserver?.disconnect();
	playerBoundsResizeObserver = null;
	ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, null);
	isPlayerFullscreen.value = false;
	void ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET, false).catch((error) => {
		log.warn('Failed to leave YouTube player fullscreen while closing Reviews', error);
	});
	resetCopyReviewLinkStatus();
});

watch(() => reviewsStore.videoList, (newList) => {
	if (!reviewsStore.selectedVideoInfo && newList.length > 0) {
		reviewsStore.setSelectedVideoInfo(newList[0]);
	}
	// log.info('Filtered video list length:', newList.length);
	// for (const video of newList) {
	// 	log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(video.startTime + (video.duration || 0)).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
	// }
});

const YOUTUBE_DELAY_OFFSET = 5;

function getActiveSyncPrototypeAnchor() {
	const anchor = syncPrototypeAnchor.value;
	return anchor?.videoId === reviewsStore.getSelectedVideoId ? anchor : null;
}

function getVideoTimeForAbsoluteLogTimestamp(timestampMs: number): number {
	const anchor = getActiveSyncPrototypeAnchor();
	if (anchor) {
		return anchor.videoTimeSeconds + (timestampMs - anchor.timestampMs) / 1000;
	}

	const videoStartTime = reviewsStore.selectedVideoInfo?.startTime || 0;
	return (timestampMs - videoStartTime) / 1000 + YOUTUBE_DELAY_OFFSET;
}

function getAbsoluteLogTimestampForVideoTime(videoTimeSeconds: number): number {
	const anchor = getActiveSyncPrototypeAnchor();
	if (anchor) {
		return anchor.timestampMs + (videoTimeSeconds - anchor.videoTimeSeconds) * 1000;
	}

	const videoStartTime = reviewsStore.selectedVideoInfo?.startTime || 0;
	return videoStartTime + (videoTimeSeconds - YOUTUBE_DELAY_OFFSET) * 1000;
}

function videoContainsTimestamp(video: YouTubeVideo, timestampMs: number): boolean {
	return video.startTime <= timestampMs
		&& getReviewVideoEndTime(video) >= timestampMs;
}

function getVideoForFightTimestamp(
	timestampMs: number,
	preferredVideoID?: string,
): YouTubeVideo | null {
	const candidates = reviewsStore.videoList;
	const preferred = preferredVideoID
		? candidates.find(video => video.id === preferredVideoID) || null
		: null;
	if (preferredVideoID) {
		return preferred && videoContainsTimestamp(preferred, timestampMs)
			? preferred
			: null;
	}

	const current = reviewsStore.selectedVideoInfo;
	if (current && candidates.some(video => video.id === current.id) && videoContainsTimestamp(current, timestampMs)) {
		return current;
	}

	return candidates.find(video => videoContainsTimestamp(video, timestampMs)) || null;
}

async function executeReviewSeek(
	intent: ReviewSeekIntent,
	context: ReviewSeekExecutionContext,
) {
	const activePlayer = player.value;
	if (!activePlayer || !playerLoaded) {
		return { phase: 'unavailable' as const, message: 'YouTube player is still loading' };
	}

	if (intent.kind === 'video-time') {
		const video = reviewsStore.videoList.find(candidate => candidate.id === intent.videoID)
			|| reviewsStore.selectedVideoInfo;
		if (!video || video.id !== intent.videoID) {
			return { phase: 'unavailable' as const, message: 'The selected stream is no longer available' };
		}
		const videoDurationSeconds = video.duration > 0 ? video.duration / 1000 : Number.POSITIVE_INFINITY;
		if (
			!Number.isFinite(intent.videoTimeSeconds)
			|| intent.videoTimeSeconds < 0
			|| intent.videoTimeSeconds > videoDurationSeconds
		) {
			return { phase: 'unavailable' as const, message: 'That timestamp is outside the selected stream' };
		}
		if (!context.isCurrent()) return { phase: 'unavailable' as const };

		cancelPendingSynchronizedSeek('Video-time seek');
		context.setPhase(activePlayer.getVideoId() === video.id ? 'seeking' : 'loading');
		if (activePlayer.getVideoId() === video.id) {
			dispatchPlayerSeek(intent.videoTimeSeconds);
			if (intent.play) activePlayer.play();
		} else {
			dispatchPlayerLoad(video.id, intent.play, intent.videoTimeSeconds);
		}
		return { phase: 'completed' as const };
	}

	const reportDetails = reviewsStore.getReportDetails;
	const fight = reportDetails?.fights?.find(candidate => candidate.id === intent.fightID);
	const reportStartTime = reviewsStore.getSelectedReport?.startTime ?? reportDetails?.startTime;
	if (!fight || !Number.isFinite(reportStartTime)) {
		return { phase: 'unavailable' as const, message: 'The requested pull is no longer available' };
	}

	const fightDurationSeconds = Math.max(0, (fight.endTime - fight.startTime) / 1000);
	const fightTimestampSeconds = Math.max(
		0,
		Math.min(Number(intent.fightTimestampSeconds) || 0, fightDurationSeconds),
	);
	if (reviewsStore.selectedFightID !== fight.id) {
		internallySelectedFight = { requestID: context.requestID, fightID: fight.id };
		reviewsStore.selectedFightID = fight.id;
		await nextTick();
		if (!context.isCurrent()) return { phase: 'unavailable' as const };
	}

	const targetMarkerTimestampMs = reportStartTime! + fight.startTime + fightTimestampSeconds * 1000;
	const targetVideo = getVideoForFightTimestamp(targetMarkerTimestampMs, intent.preferredVideoID);
	if (!targetVideo) {
		const loadedVideoID = activePlayer.getVideoId();
		const loadedVideo = loadedVideoID
			? reviewsStore.videoList.find(video => video.id === loadedVideoID) || null
			: null;
		if (
			intent.preferredVideoID
			&& loadedVideo
			&& reviewsStore.getSelectedVideoId !== loadedVideo.id
		) {
			internallySelectedVideo = { requestID: context.requestID, videoID: loadedVideo.id };
			reviewsStore.setSelectedVideoInfo(loadedVideo);
			await nextTick();
		}
		return {
			phase: 'unavailable' as const,
			message: 'No stream contains that point in the pull',
		};
	}

	if (reviewsStore.getSelectedVideoId !== targetVideo.id) {
		internallySelectedVideo = { requestID: context.requestID, videoID: targetVideo.id };
		reviewsStore.setSelectedVideoInfo(targetVideo);
		await nextTick();
		if (!context.isCurrent()) return { phase: 'unavailable' as const };
	}

	const videoTimeSeconds = getVideoTimeForAbsoluteLogTimestamp(targetMarkerTimestampMs);
	const videoDurationSeconds = targetVideo.duration > 0
		? targetVideo.duration / 1000
		: Number.POSITIVE_INFINITY;
	if (
		!Number.isFinite(videoTimeSeconds)
		|| videoTimeSeconds < 0
		|| videoTimeSeconds > videoDurationSeconds
	) {
		return {
			phase: 'unavailable' as const,
			message: 'The synchronized timestamp is outside the selected stream',
		};
	}
	if (!context.isCurrent()) return { phase: 'unavailable' as const };

	lastFightRelativeTime = fightTimestampSeconds;
	clearQueuedHotkeySeek();
	cancelPendingSynchronizedSeek('New absolute seek');
	if (intent.synchronize) {
		queueSyncMarkerSeek(
			targetMarkerTimestampMs,
			videoTimeSeconds,
			context.requestID,
			targetVideo.id,
		);
	}

	const loadedVideoID = activePlayer.getVideoId();
	context.setPhase(loadedVideoID === targetVideo.id ? 'seeking' : 'loading');
	log.info('Dispatching coordinated review seek', {
		requestID: context.requestID,
		source: intent.source,
		fightID: fight.id,
		fightTimestampSeconds,
		videoID: targetVideo.id,
		videoTimeSeconds,
		loadRequired: loadedVideoID !== targetVideo.id,
	});
	if (loadedVideoID === targetVideo.id) {
		dispatchPlayerSeek(videoTimeSeconds);
		if (intent.play) activePlayer.play();
	} else {
		dispatchPlayerLoad(targetVideo.id, intent.play, videoTimeSeconds);
	}

	return { phase: intent.synchronize ? 'verifying' as const : 'completed' as const };
}

function requestVideoTimeSeek(
	videoTimeSeconds: number,
	source: ReviewSeekSource,
	play: boolean,
	videoID = reviewsStore.getSelectedVideoId,
) {
	if (!videoID || !player.value || !playerLoaded) return Promise.resolve(null);
	return reviewSeekCoordinator.request({
		kind: 'video-time',
		source,
		videoID,
		videoTimeSeconds,
		play,
		synchronize: false,
	});
}

function requestFightSeek(
	fightID: number,
	fightTimestampSeconds: number,
	source: ReviewSeekSource,
	preferredVideoID?: string,
) {
	if (!player.value || !playerLoaded) return Promise.resolve(null);
	return reviewSeekCoordinator.request({
		kind: 'fight-time',
		source,
		fightID,
		fightTimestampSeconds,
		preferredVideoID,
		play: true,
		synchronize: true,
	});
}

// 0 - fight end, in seconds
function seekToFightTimestamp(fightTimestamp: number, source: ReviewSeekSource = 'timeline') {
	const fightID = reviewsStore.selectedFightID;
	if (!fightID) return;
	void requestFightSeek(fightID, fightTimestamp, source);
}

function seekToPullTimestamp(
	fightID: number,
	timestampSeconds: number,
	source: ReviewSeekSource = 'comparison',
) {
	if (!reviewsStore.getReportDetails?.fights.some(fight => fight.id === fightID)) return;
	void requestFightSeek(fightID, timestampSeconds, source);
}

function rememberCurrentFightTime(): void {
	if (!reviewsStore.selectedFightID || !reviewsStore.getFightDuration) return;
	if (player.value?.getVideoId() !== reviewsStore.getSelectedVideoId) return;
	const pendingSeek = getPendingSyncMarkerSeek();
	if (
		pendingSeek
		&& Date.now() - pendingSeek.seekIssuedAt < 2_000
		&& Math.abs(currentVideoTime.value - pendingSeek.requestedVideoTimeSeconds) > 2
	) return;
	const currentLogTimestamp = getAbsoluteLogTimestampForVideoTime(currentVideoTime.value);
	const fightRelativeTime = (currentLogTimestamp - reviewsStore.getFightStartTime) / 1000;
	lastFightRelativeTime = Math.max(
		0,
		Math.min(fightRelativeTime, reviewsStore.getFightDuration / 1000),
	);
}

const copyReviewLinkStatus = ref('');
const isCopyReviewLinkHovered = ref(false);
let copyReviewLinkResetTimeout = null as number | null;

const copyReviewLinkTooltip = computed(() => {
	if (copyReviewLinkStatus.value) return copyReviewLinkStatus.value;
	if (isCopyReviewLinkHovered.value && reviewsStore.getSelectedVideoId) return 'Copy review link with timestamp';
	return '';
});

function resetCopyReviewLinkStatus() {
	if (copyReviewLinkResetTimeout) {
		clearTimeout(copyReviewLinkResetTimeout);
		copyReviewLinkResetTimeout = null;
	}
	copyReviewLinkStatus.value = '';
}

async function copyReviewLink(event?: MouseEvent) {
	(event?.currentTarget as HTMLButtonElement | null)?.blur();

	const videoId = reviewsStore.getSelectedVideoId;
	if (!videoId) {
		copyReviewLinkStatus.value = 'No video selected';
		return;
	}

	const timestampSeconds = Math.max(0, Math.floor(currentVideoTime.value || 0));
	const reviewUrl = `https://rak-gaming-updater.org/api/updater/open/reviews?videoId=${encodeURIComponent(videoId)}&t=${timestampSeconds}`;

	try {
		await navigator.clipboard.writeText(reviewUrl);
		copyReviewLinkStatus.value = 'Copied';
		log.info('Copied review link', { reviewUrl });
	} catch (error) {
		copyReviewLinkStatus.value = 'Copy failed';
		log.error('Failed to copy review link', error);
	}

	if (copyReviewLinkResetTimeout) {
		clearTimeout(copyReviewLinkResetTimeout);
	}

	copyReviewLinkResetTimeout = window.setTimeout(() => {
		copyReviewLinkStatus.value = '';
		copyReviewLinkResetTimeout = null;
	}, 2000);
}

const currentFightCursor = computed(() => {
    if (!player.value || !reviewsStore.getFightDuration) return 0;

	const currentLogTimestamp = getAbsoluteLogTimestampForVideoTime(currentVideoTime.value);
	const fightRelativeTime = (currentLogTimestamp - reviewsStore.getFightStartTime) / 1000;

    // Clamp between 0 and fightDuration (in seconds)
    const fightDurationSec = reviewsStore.getFightDuration / 1000;
    const clamped = Math.max(0, Math.min(fightRelativeTime, fightDurationSec));

    // Return as percent (0 to 1)
	// log.debug(`Current fight cursor: ${clamped}s / ${fightDurationSec}s = ${(clamped / fightDurationSec * 100).toFixed(2)}%`);
    return clamped / fightDurationSec;
});
const timelinePlayback = createReviewTimelinePlayback(currentFightCursor, isPlayerPlaying);

const phaseTransitions = computed(() => {
	const selectedReportDetails = reviewsStore.getReportDetails;
	const selectedFight = reviewsStore.getSelectedFight;

	if (!selectedReportDetails?.phases || !selectedFight?.phaseTransitions || !reviewsStore.getFightDuration) return [];
	const phaseIdToText = new Map<number, string>();
	let phasesCount = 0;
	let intermissionCount = 0;
	const phases = selectedReportDetails.phases?.find(p => p.encounterID === selectedFight.encounterID)?.phases || [];
	phases.forEach(phase => {
		// Shorten phase names:
		// "Stage Two: Some name" -> p2
		// "Intermission One: Some name" - i1
		let name
		if (phase.isIntermission) {
			intermissionCount += 1;
			name = `I${intermissionCount}`;
		} else {
			phasesCount += 1;
			name = `P${phasesCount}`;
		}

		if (name) {
			phaseIdToText.set(phase.id, name);
		}
	});

	const fightStartTime = reviewsStore.getFightStartTimeOffset; // in ms

	return reviewsStore.getSelectedFight.phaseTransitions
		.map(phase => {
			const phaseId = phase.id;
			const phaseStart = phase.startTime; // in ms
			const percent = (phaseStart - fightStartTime) / reviewsStore.getFightDuration;
			return {
				name: phaseIdToText.get(phaseId) || phaseId,
				percent,
			};
		})
		.filter(phase => phase.percent > 0 && phase.percent < 1); // exclude start and end
});

function openWCLDeath(deathID: number) {
	if (!reviewsStore.selectedReportCode || !reviewsStore.selectedFightID) return;
	openWCLPullDeath(reviewsStore.selectedFightID, deathID);
}

function openWCLFight(fightID?: number) {
	const targetFightID = fightID || reviewsStore.selectedFightID;
	if (!reviewsStore.selectedReportCode || !targetFightID) return;
	ipc.send(IPC_EVENTS.WCL_OPEN_FIGHT, {
		reportCode: reviewsStore.selectedReportCode,
		fightID: targetFightID,
	});
}

function openWCLPullDeath(fightID: number, deathID: number) {
	if (!reviewsStore.selectedReportCode) return;
	ipc.send(IPC_EVENTS.WCL_OPEN_DEATH, {
		reportCode: reviewsStore.selectedReportCode,
		fightID,
		deathID: deathID,
	});
}

function buildTimelineWindowContext(includeAllCachedPulls = false): ReviewTimelineWindowContext | null {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	const reportDetails = reviewsStore.getReportDetails;
	const fight = reviewsStore.getSelectedFight;
	if (!reportCode || !fightID || !reportDetails || !fight) return null;

	const context: ReviewTimelineWindowContext = {
		reportCode,
		fightID,
		reportDetails,
		dataSnapshot: reviewsStore.createTimelineWindowDataSnapshot(
			reportCode,
			includeAllCachedPulls ? undefined : [fightID],
		),
		phases: phaseTransitions.value,
		fightStartTime: reviewsStore.getFightStartTimeOffset,
		fightDuration: reviewsStore.getFightDuration,
		cursorPercent: currentFightCursor.value,
		playing: isPlayerPlaying.value,
		viewMode: reviewsStore.timelineViewMode,
		title: `${fight.name} · Fight #${fight.id}`,
	};

	// Pinia wraps nested report data in Vue proxies. Build a plain snapshot before
	// crossing the isolated renderer boundary.
	return JSON.parse(JSON.stringify(context)) as ReviewTimelineWindowContext;
}

async function detachTimeline() {
	const context = buildTimelineWindowContext(true);
	if (!context) return;
	try {
		const response = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_OPEN, context) as { success?: boolean; error?: string };
		if (!response?.success) throw new Error(response?.error || 'Timeline window could not be opened.');
		const status = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET) as { detached?: boolean };
		reviewsStore.timelineWindowDetached = status?.detached === true;
		reviewsStore.timelineExpanded = true;
	} catch (error) {
		log.error('Failed to detach review timeline', error);
	}
}

function sendTimelineWindowContext() {
	if (!reviewsStore.timelineWindowDetached) return;
	const context = buildTimelineWindowContext();
	if (!context) {
		ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'context-unavailable' });
		return;
	}
	ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_SET, context);
}

function handleTimelineWindowAction(action: ReviewTimelineWindowAction): boolean {
	switch (action.type) {
		case 'seek':
			if (!player.value || !playerLoaded) return false;
			seekToFightTimestamp(action.timestampSeconds, 'detached-timeline');
			return true;
		case 'seek-pull':
			if (!player.value || !playerLoaded) return false;
			seekToPullTimestamp(action.fightID, action.timestampSeconds, 'detached-timeline');
			return true;
		case 'open-fight':
			openWCLFight(action.fightID);
			return true;
		case 'open-death':
			openWCLDeath(action.deathID);
			return true;
		case 'open-pull-death':
			openWCLPullDeath(action.fightID, action.deathID);
			return true;
		case 'toggle-playback':
			if (!player.value || !playerLoaded) return false;
			togglePlayPause();
			return true;
		case 'view-mode':
			reviewsStore.timelineViewMode = action.viewMode;
			return true;
	}
}

let unregisterTimelineWindowActionHandler: (() => void) | null = null;
onMounted(() => {
	unregisterTimelineWindowActionHandler = reviewsStore.registerTimelineWindowActionHandler(handleTimelineWindowAction);
});
onBeforeUnmount(() => {
	unregisterTimelineWindowActionHandler?.();
	unregisterTimelineWindowActionHandler = null;
});

watch(
	[
		() => reviewsStore.selectedReportCode,
		() => reviewsStore.selectedFightID,
		() => reviewsStore.getReportDetails,
		() => reviewsStore.getFightEvents,
		() => reviewsStore.getFightCooldownData,
		() => reviewsStore.getFightBossCastData,
		() => reviewsStore.isFightCooldownsLoading,
		() => reviewsStore.getFightCooldownError,
		phaseTransitions,
		() => reviewsStore.timelineViewMode,
	],
	sendTimelineWindowContext,
);

watch(currentFightCursor, (cursorPercent) => {
	if (reviewsStore.timelineWindowDetached) ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_SET, cursorPercent);
});

watch(isPlayerPlaying, (playing) => {
	if (reviewsStore.timelineWindowDetached) ipc.send(IPC_EVENTS.TIMELINE_WINDOW_PLAYBACK_SET, playing);
});

function openYoutubeLink(videoId: string, timestampSeconds?: number) {
	ipc.send(IPC_EVENTS.YOUTUBE_OPEN_LINK, videoId, timestampSeconds);
}

function getCurrentStreamTimestamp(video: YouTubeVideo): number | undefined {
	if (!player.value || !playerLoaded) return undefined;
	const currentTime = player.value.getCurrentTime();
	if (!Number.isFinite(currentTime) || currentTime < 0) return undefined;

	const selectedVideo = reviewsStore.selectedVideoInfo;
	if (!selectedVideo || selectedVideo.id === video.id) return currentTime;

	const currentPlaybackTime = selectedVideo.startTime + currentTime * 1000;
	return Math.max(0, (currentPlaybackTime - video.startTime) / 1000);
}

function openStreamInBrowser(video: YouTubeVideo) {
	openYoutubeLink(video.id, getCurrentStreamTimestamp(video));
}

function openSelectedYoutubeVideo(event: MouseEvent) {
	if (event.detail > 1) return;
	const selectedVideo = reviewsStore.selectedVideoInfo;
	if (selectedVideo) openStreamInBrowser(selectedVideo);
}

function formatSyncVideoTime(seconds: number): string {
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

type ReviewSyncCaptureTrigger = 'manual' | 'periodic' | 'player-state';

function clearScheduledSyncMarkerRead(): void {
	if (syncMarkerScheduledReadTimeout === null) return;
	window.clearTimeout(syncMarkerScheduledReadTimeout);
	syncMarkerScheduledReadTimeout = null;
}

function cancelPendingSynchronizedSeek(reason: string): void {
	const pending = pendingSyncMarkerSeek;
	pendingSyncMarkerSeek = null;
	if (pending) reviewSeekCoordinator.finish(pending.seekRequestID, 'unverified', reason);
}

function queueSyncMarkerSeek(
	targetMarkerTimestampMs: number,
	requestedVideoTimeSeconds: number,
	seekRequestID: number,
	videoId: string,
): void {
	pendingSyncMarkerSeek = null;
	if (
		!videoId
		|| !Number.isFinite(targetMarkerTimestampMs)
		|| !Number.isFinite(requestedVideoTimeSeconds)
	) return;

	const now = Date.now();
	pendingSyncMarkerSeek = {
		id: ++nextSyncMarkerSeekID,
		videoId,
		targetMarkerTimestampMs: targetMarkerTimestampMs!,
		startedAt: now,
		seekIssuedAt: now,
		requestedVideoTimeSeconds,
		phase: 'initial',
		correctionAttempts: 0,
		observations: [],
		playedSinceSeekMs: 0,
		playingSince: isPlayerPlaying.value && player.value?.getVideoId() === videoId ? now : null,
		playbackRateAtStart: player.value?.getPlaybackRate() || 1,
		observationAttempts: 0,
		readFailures: 0,
		seekRequestID,
	};
}

function getPendingSyncMarkerSeek() {
	const pending = pendingSyncMarkerSeek;
	if (!pending) return null;
	const expired = Date.now() - pending.startedAt > SYNC_MARKER_SEEK_CORRECTION_MAX_AGE_MS;
	if (
		pending.videoId !== reviewsStore.getSelectedVideoId
		|| !reviewSeekCoordinator.isCurrent(pending.seekRequestID)
		|| expired
	) {
		pendingSyncMarkerSeek = null;
		if (expired) {
			syncPrototypeStatusTone.value = 'error';
			syncPrototypeStatus.value = 'Seek completed, but synchronization timed out';
			reviewSeekCoordinator.finish(
				pending.seekRequestID,
				'unverified',
				'Sync marker verification timed out',
			);
		}
		return null;
	}
	return pending;
}

function markPendingSyncMarkerSeekPlaying(): void {
	const pending = getPendingSyncMarkerSeek();
	if (
		!pending
		|| pending.playingSince !== null
		|| player.value?.getVideoId() !== pending.videoId
	) return;
	pending.playingSince = Date.now();
	pending.playbackRateAtStart = player.value?.getPlaybackRate() || 1;
}

function updatePendingSyncMarkerSeekPlaybackRate(rate: number): void {
	const pending = getPendingSyncMarkerSeek();
	if (!pending || !Number.isFinite(rate) || rate <= 0) return;
	const wasPlaying = pending.playingSince !== null;
	if (wasPlaying) markPendingSyncMarkerSeekStopped();
	pending.playbackRateAtStart = rate;
	if (wasPlaying) pending.playingSince = Date.now();
}

function markPendingSyncMarkerSeekStopped(): void {
	const pending = getPendingSyncMarkerSeek();
	if (!pending || pending.playingSince === null) return;
	pending.playedSinceSeekMs += (
		Date.now() - pending.playingSince
	) * pending.playbackRateAtStart;
	pending.playingSince = null;
}

function getPendingSyncMarkerSeekPlaybackMs(
	pending: NonNullable<typeof pendingSyncMarkerSeek>,
	observedAt: number,
): number {
	if (pending.playingSince === null) return pending.playedSinceSeekMs;
	return pending.playedSinceSeekMs + Math.max(
		0,
		observedAt - pending.playingSince,
	) * pending.playbackRateAtStart;
}

function scheduleAutomaticSyncMarkerRead(
	delayMilliseconds?: number,
): void {
	clearScheduledSyncMarkerRead();
	const delay = delayMilliseconds ?? (
		getPendingSyncMarkerSeek()
			? SYNC_MARKER_SEEK_FIRST_READ_DELAY_MS
			: SYNC_MARKER_STATE_CHANGE_READ_DELAY_MS
	);
	syncMarkerScheduledReadTimeout = window.setTimeout(() => {
		syncMarkerScheduledReadTimeout = null;
		void captureReviewSyncMarker('player-state');
	}, Math.max(0, delay));
}

function shouldApplySyncMarkerAnchor(
	automatic: boolean,
	videoId: string,
	differenceMs: number | null,
	markerTimelineOriginMs: number,
): boolean {
	if (!automatic) {
		pendingSyncMarkerReanchor = null;
		return differenceMs === null || Math.abs(differenceMs) >= SYNC_MARKER_REANCHOR_THRESHOLD_MS;
	}

	const now = Date.now();
	const pending = pendingSyncMarkerReanchor;
	const kind = differenceMs === null ? 'initial' : 'adjustment';
	const measurementMs = differenceMs ?? markerTimelineOriginMs;
	if (
		pending?.videoId === videoId
		&& pending.kind === kind
		&& now - pending.observedAt <= SYNC_MARKER_REANCHOR_CONFIRMATION_MAX_AGE_MS
		&& Math.abs(pending.measurementMs - measurementMs)
			<= SYNC_MARKER_REANCHOR_CONFIRMATION_TOLERANCE_MS
	) {
		const averageMeasurementMs = (pending.measurementMs + measurementMs) / 2;
		pendingSyncMarkerReanchor = null;
		return kind === 'initial'
			|| Math.abs(averageMeasurementMs) >= SYNC_MARKER_REANCHOR_THRESHOLD_MS;
	}

	if (kind === 'initial' || Math.abs(measurementMs) >= SYNC_MARKER_REANCHOR_THRESHOLD_MS) {
		pendingSyncMarkerReanchor = { videoId, kind, measurementMs, observedAt: now };
		// Confirm a potentially disruptive adjustment promptly instead of waiting
		// for the next periodic pass.
		scheduleAutomaticSyncMarkerRead(SYNC_MARKER_MIN_AUTO_READ_GAP_MS);
	} else {
		pendingSyncMarkerReanchor = null;
	}
	return false;
}

function isSyncMarkerSeekLandingPlausible(
	pending: NonNullable<typeof pendingSyncMarkerSeek>,
	videoTimeSeconds: number,
	observedAt: number,
): boolean {
	const elapsedSeconds = Math.max(0, (observedAt - pending.seekIssuedAt) / 1000);
	const earliestPlausibleTime = pending.requestedVideoTimeSeconds
		- SYNC_MARKER_SEEK_API_TIME_MAX_DISTANCE_SECONDS;
	// YouTube can play at up to 2x while we wait for the rendered frame.
	const latestPlausibleTime = pending.requestedVideoTimeSeconds
		+ elapsedSeconds * 2
		+ SYNC_MARKER_SEEK_API_TIME_MAX_DISTANCE_SECONDS;
	return videoTimeSeconds >= earliestPlausibleTime
		&& videoTimeSeconds <= latestPlausibleTime;
}

function isSyncMarkerSeekTargetReached(
	pending: NonNullable<typeof pendingSyncMarkerSeek>,
	markerTimestampMs: number,
	observedAt: number,
): boolean {
	const playbackSinceSeekMs = getPendingSyncMarkerSeekPlaybackMs(pending, observedAt);
	const landingErrorMs = markerTimestampMs - pending.targetMarkerTimestampMs;
	return landingErrorMs >= -SYNC_MARKER_SEEK_LANDING_EARLY_TOLERANCE_MS
		&& landingErrorMs <= playbackSinceSeekMs + SYNC_MARKER_SEEK_LANDING_LATE_TOLERANCE_MS;
}

function applyConfirmedSyncMarkerOrigin(
	videoId: string,
	videoTimeSeconds: number,
	timelineOriginMs: number,
): void {
	syncPrototypeAnchor.value = {
		videoId,
		videoTimeSeconds,
		timestampMs: timelineOriginMs + videoTimeSeconds * 1000,
	};
	pendingSyncMarkerReanchor = null;
}

function processPendingSyncMarkerSeek(
	markerTimestampMs: number,
	videoTimeSeconds: number,
	observedAt: number,
): boolean {
	const pending = getPendingSyncMarkerSeek();
	if (!pending) return false;
	pending.observationAttempts++;
	pending.readFailures = 0;
	if (pending.observationAttempts > SYNC_MARKER_SEEK_MAX_OBSERVATION_ATTEMPTS) {
		pendingSyncMarkerSeek = null;
		reviewSeekCoordinator.finish(
			pending.seekRequestID,
			'unverified',
			'Rendered video frame did not stabilize',
		);
		syncPrototypeStatusTone.value = 'error';
		syncPrototypeStatus.value = 'Seek sync stopped · rendered frame did not stabilize';
		log.warn('Could not obtain coherent RG sync marker frames after YouTube seek', {
			videoId: pending.videoId,
			phase: pending.phase,
			correctionAttempts: pending.correctionAttempts,
		});
		return true;
	}

	if (!isSyncMarkerSeekLandingPlausible(pending, videoTimeSeconds, observedAt)) {
		log.debug('Ignored RG sync marker from a frame outside the active seek landing', {
			videoId: pending.videoId,
			phase: pending.phase,
			requestedVideoTimeSeconds: pending.requestedVideoTimeSeconds,
			videoTimeSeconds,
		});
		scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
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
			> SYNC_MARKER_SEEK_VERIFICATION_ORIGIN_TOLERANCE_MS
	) {
		// The iframe API may expose the corrected time before Chromium replaces
		// the pre-correction frame. Never feed that mixed observation back into
		// another correction.
		log.debug('Ignored stale RG sync marker frame while verifying corrected seek', {
			videoId: pending.videoId,
			originDifferenceMs: observation.timelineOriginMs - expectedTimelineOriginMs,
		});
		scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
		return true;
	}
	const previousObservation = pending.observations.at(-1);
	if (!previousObservation) {
		pending.observations.push(observation);
		scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
		return true;
	}

	const observationSeparationMs = observation.observedAt - previousObservation.observedAt;
	if (observationSeparationMs < SYNC_MARKER_SEEK_OBSERVATION_MIN_SEPARATION_MS) {
		scheduleAutomaticSyncMarkerRead(
			SYNC_MARKER_SEEK_OBSERVATION_MIN_SEPARATION_MS - observationSeparationMs,
		);
		return true;
	}

	const markerProgressMs = observation.markerTimestampMs
		- previousObservation.markerTimestampMs;
	const videoProgressMs = (
		observation.videoTimeSeconds - previousObservation.videoTimeSeconds
	) * 1000;
	const progressionDifferenceMs = markerProgressMs - videoProgressMs;
	if (Math.abs(progressionDifferenceMs) > SYNC_MARKER_SEEK_OBSERVATION_TOLERANCE_MS) {
		// A seek may update the iframe API before Chromium paints the new video
		// frame. Start the pair again from the newest observation in that case.
		pending.observations = [observation];
		log.debug('Waiting for two coherent RG sync marker frames after seek', {
			videoId: pending.videoId,
			phase: pending.phase,
			progressionDifferenceMs,
		});
		scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
		return true;
	}

	const confirmedTimelineOriginMs = (
		previousObservation.timelineOriginMs + observation.timelineOriginMs
	) / 2;
	const mappingErrorMs = confirmedTimelineOriginMs - expectedTimelineOriginMs;
	const targetReached = isSyncMarkerSeekTargetReached(
		pending,
		observation.markerTimestampMs,
		observation.observedAt,
	);
	if (Math.abs(mappingErrorMs) > SYNC_MARKER_SEEK_CORRECTION_MAX_MS) {
		pendingSyncMarkerSeek = null;
		reviewSeekCoordinator.finish(
			pending.seekRequestID,
			'unverified',
			'RG sync marker implied an implausible mapping change',
		);
		syncPrototypeStatusTone.value = 'error';
		syncPrototypeStatus.value = `Seek sync stopped · implausible ${formatSignedSeconds(mappingErrorMs / 1000)} mapping change`;
		log.warn('Rejected an implausible RG sync marker mapping after YouTube seek', {
			videoId: pending.videoId,
			phase: pending.phase,
			mappingErrorMs,
		});
		return true;
	}
	applyConfirmedSyncMarkerOrigin(
		pending.videoId,
		observation.videoTimeSeconds,
		confirmedTimelineOriginMs,
	);

	if (
		Math.abs(mappingErrorMs) <= SYNC_MARKER_SEEK_CORRECTION_TOLERANCE_MS
		&& targetReached
	) {
		pendingSyncMarkerSeek = null;
		reviewSeekCoordinator.finish(pending.seekRequestID, 'completed');
		syncPrototypeStatusTone.value = 'success';
		syncPrototypeStatus.value = `Seek synchronized · ${formatSignedSeconds(mappingErrorMs / 1000)} residual`;
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
			> SYNC_MARKER_SEEK_CORRECTION_MAX_MS
		|| pending.correctionAttempts >= SYNC_MARKER_SEEK_CORRECTION_MAX_ATTEMPTS
	) {
		pendingSyncMarkerSeek = null;
		reviewSeekCoordinator.finish(
			pending.seekRequestID,
			'unverified',
			'RG sync marker correction did not converge',
		);
		syncPrototypeStatusTone.value = 'error';
		syncPrototypeStatus.value = `Seek sync stopped · ${formatSignedSeconds(mappingErrorMs / 1000)} residual`;
		log.warn('Could not safely converge YouTube seek with RG sync marker', {
			videoId: pending.videoId,
			phase: pending.phase,
			mappingErrorMs,
			landingErrorMs: observation.markerTimestampMs - pending.targetMarkerTimestampMs,
			correctionAttempts: pending.correctionAttempts,
		});
		return true;
	}

	const correctedVideoTimeSeconds = clampSeekTarget(
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
	pending.playingSince = isPlayerPlaying.value ? pending.seekIssuedAt : null;
	pending.playbackRateAtStart = player.value?.getPlaybackRate() || 1;
	pending.observationAttempts = 0;
	pending.readFailures = 0;
	syncPrototypeStatusTone.value = 'info';
	syncPrototypeStatus.value = `Correcting seek · ${formatSignedSeconds(correctionDeltaMs / 1000)}`;
	log.info('Correcting YouTube seek from confirmed RG sync marker mapping', {
		videoId: pending.videoId,
		mappingErrorMs,
		landingErrorMs: observation.markerTimestampMs - pending.targetMarkerTimestampMs,
		toVideoTimeSeconds: correctedVideoTimeSeconds,
		attempt: pending.correctionAttempts,
	});
	dispatchPlayerSeek(correctedVideoTimeSeconds);
	return true;
}

async function captureReviewSyncMarker(trigger: ReviewSyncCaptureTrigger = 'manual'): Promise<void> {
	const automatic = trigger !== 'manual';
	if (isSyncPrototypeCapturing.value) {
		if (trigger === 'player-state') scheduleAutomaticSyncMarkerRead(250);
		return;
	}
	const millisecondsSinceLastCapture = Date.now() - lastSyncMarkerCaptureStartedAt;
	if (
		automatic
		&& (
			(trigger === 'periodic' && !isPlayerPlaying.value)
			|| document.visibilityState !== 'visible'
		)
	) return;
	if (
		automatic
		&& !getPendingSyncMarkerSeek()
		&& millisecondsSinceLastCapture < SYNC_MARKER_MIN_AUTO_READ_GAP_MS
	) {
		if (trigger === 'player-state') {
			scheduleAutomaticSyncMarkerRead(
				SYNC_MARKER_MIN_AUTO_READ_GAP_MS - millisecondsSinceLastCapture,
			);
		}
		return;
	}
	const selectedVideo = reviewsStore.selectedVideoInfo;
	const container = videoContainer.value;
	if (!selectedVideo || !player.value || !playerLoaded || !container) {
		if (!automatic) {
			syncPrototypeStatusTone.value = 'error';
			syncPrototypeStatus.value = 'Load a YouTube video before reading its sync marker';
		}
		return;
	}
	if (player.value.getVideoId() !== selectedVideo.id) {
		if (getPendingSyncMarkerSeek()) {
			scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
		} else if (!automatic) {
			syncPrototypeStatusTone.value = 'info';
			syncPrototypeStatus.value = 'Waiting for the selected YouTube video to load';
		}
		return;
	}
	if (['unstarted', 'buffering'].includes(player.value.getState())) {
		if (getPendingSyncMarkerSeek()) {
			scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS);
		} else if (!automatic) {
			syncPrototypeStatusTone.value = 'info';
			syncPrototypeStatus.value = 'Waiting for the YouTube frame to finish loading';
		}
		return;
	}

	clearScheduledSyncMarkerRead();
	isSyncPrototypeCapturing.value = true;
	lastSyncMarkerCaptureStartedAt = Date.now();
	const playerStateRevisionAtCaptureStart = youtubePlayerStateRevision;
	const playerSeekRevisionAtCaptureStart = youtubePlayerSeekRevision;
	const syncMarkerSeekIDAtCaptureStart = getPendingSyncMarkerSeek()?.id ?? null;
	if (!automatic) {
		syncPrototypeStatusTone.value = 'info';
		syncPrototypeStatus.value = 'Reading RG sync marker...';
		keepPlayerControlsVisible();
	}

	try {
		const bounds = container.getBoundingClientRect();
		const videoTimeBeforeCapture = player.value.getCurrentTime();
		const videoTimeBeforeCapturedAt = Date.now();
		const capture = await ipc.invoke(IPC_EVENTS.REVIEW_SYNC_CAPTURE_VIDEO_FRAME, {
			x: bounds.left,
			y: bounds.top,
			width: bounds.width,
			height: bounds.height,
		}) as ReviewSyncMarkerCapture;
		const videoTimeAfterCapture = player.value.getCurrentTime();
		const videoTimeAfterCapturedAt = Date.now();
		if (youtubePlayerStateRevision !== playerStateRevisionAtCaptureStart) {
			throw new Error('YouTube player state changed while reading the sync marker');
		}
		if (youtubePlayerSeekRevision !== playerSeekRevisionAtCaptureStart) {
			throw new Error('Video position changed while reading the sync marker');
		}
		if (reviewsStore.getSelectedVideoId !== selectedVideo.id) {
			throw new Error('The selected video changed while reading the marker');
		}
		if (player.value.getVideoId() !== selectedVideo.id) {
			throw new Error('YouTube displayed a different video while reading the marker');
		}
		if (!capture?.dataUrl || typeof capture.dataUrl !== 'string') {
			throw new Error('Electron did not return a captured YouTube frame');
		}
		if (
			!Number.isFinite(capture.captureStartedAtMs)
			|| !Number.isFinite(capture.captureFinishedAtMs)
			|| capture.captureFinishedAtMs < capture.captureStartedAtMs
		) {
			throw new Error('Electron returned invalid sync marker capture timing');
		}
		const frameCapturedAt = (
			capture.captureStartedAtMs + capture.captureFinishedAtMs
		) / 2;
		const sampleDurationMs = Math.max(1, videoTimeAfterCapturedAt - videoTimeBeforeCapturedAt);
		const allowedVideoMovementSeconds = sampleDurationMs / 1000
			* (player.value.getPlaybackRate() || 1)
			+ 0.5;
		if (
			!Number.isFinite(videoTimeBeforeCapture)
			|| !Number.isFinite(videoTimeAfterCapture)
			|| Math.abs(videoTimeAfterCapture - videoTimeBeforeCapture) > allowedVideoMovementSeconds
		) {
			throw new Error('Video moved too far while the marker was being captured');
		}

		const captureProgress = Math.max(0, Math.min(
			1,
			(frameCapturedAt - videoTimeBeforeCapturedAt) / sampleDurationMs,
		));
		const videoTimeSeconds = videoTimeBeforeCapture
			+ (videoTimeAfterCapture - videoTimeBeforeCapture) * captureProgress;
		const anchorAtCaptureStart = getActiveSyncPrototypeAnchor();
		const approximateTimestampMs = anchorAtCaptureStart
			? anchorAtCaptureStart.timestampMs
				+ (videoTimeSeconds - anchorAtCaptureStart.videoTimeSeconds) * 1000
			: selectedVideo.startTime + videoTimeSeconds * 1000;
		const marker = await decodeReviewSyncMarkerImage(
			capture.dataUrl,
			capture.markerBounds,
			approximateTimestampMs,
		);
		if (youtubePlayerStateRevision !== playerStateRevisionAtCaptureStart) {
			throw new Error('YouTube player state changed while decoding the sync marker');
		}
		if (youtubePlayerSeekRevision !== playerSeekRevisionAtCaptureStart) {
			throw new Error('Video position changed while decoding the sync marker');
		}
		if (reviewsStore.getSelectedVideoId !== selectedVideo.id) {
			throw new Error('The selected video changed while decoding the sync marker');
		}
		if (player.value.getVideoId() !== selectedVideo.id) {
			throw new Error('YouTube changed videos while decoding the sync marker');
		}
		if ((getPendingSyncMarkerSeek()?.id ?? null) !== syncMarkerSeekIDAtCaptureStart) {
			throw new Error('A newer video seek started while decoding the sync marker');
		}
		const previousAnchor = getActiveSyncPrototypeAnchor();
		const anchorDifferenceMs = previousAnchor
			? marker.timestampMs - (
				previousAnchor.timestampMs
					+ (videoTimeSeconds - previousAnchor.videoTimeSeconds) * 1000
			)
			: null;
		const handledBySeekSynchronization = processPendingSyncMarkerSeek(
			marker.timestampMs,
			videoTimeSeconds,
			frameCapturedAt,
		);
		const shouldApplyAnchor = !handledBySeekSynchronization && shouldApplySyncMarkerAnchor(
			automatic,
			selectedVideo.id,
			anchorDifferenceMs,
			marker.timestampMs - videoTimeSeconds * 1000,
		);
		if (shouldApplyAnchor) {
			applyConfirmedSyncMarkerOrigin(
				selectedVideo.id,
				videoTimeSeconds,
				marker.timestampMs - videoTimeSeconds * 1000,
			);
		}

		const markerOffsetSeconds = videoTimeSeconds - (marker.timestampMs - selectedVideo.startTime) / 1000;
		const correctionSeconds = markerOffsetSeconds - YOUTUBE_DELAY_OFFSET;
		const markerTime = new Date(marker.timestampMs).toISOString().slice(11, 23);
		if (!handledBySeekSynchronization && shouldApplyAnchor) {
			syncPrototypeStatusTone.value = 'success';
			const status = automatic
				? previousAnchor ? 'Sync adjusted' : 'Sync active'
				: 'Prototype active';
			syncPrototypeStatus.value = `${status} · ${markerTime}Z at ${formatSyncVideoTime(videoTimeSeconds)} · offset ${formatSignedSeconds(markerOffsetSeconds)} · correction ${formatSignedSeconds(correctionSeconds)} · ${Math.round(marker.confidence * 100)}% contrast`;
		} else if (!handledBySeekSynchronization && !automatic) {
			syncPrototypeStatusTone.value = 'success';
			syncPrototypeStatus.value = `Sync stable · measured change ${formatSignedSeconds((anchorDifferenceMs || 0) / 1000)} · ${Math.round(marker.confidence * 100)}% contrast`;
		}
		if (!handledBySeekSynchronization && (shouldApplyAnchor || !automatic)) {
			log[shouldApplyAnchor ? 'info' : 'debug'](
				shouldApplyAnchor ? 'Applied prototype review sync marker' : 'Kept existing prototype review sync marker',
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
		lastSyncMarkerAutoFailureLogTime = 0;
	} catch (error) {
		if (automatic) {
			const now = Date.now();
			if (now - lastSyncMarkerAutoFailureLogTime >= SYNC_MARKER_AUTO_FAILURE_LOG_INTERVAL_MS) {
				lastSyncMarkerAutoFailureLogTime = now;
				log.debug('Automatic review sync marker capture skipped after a failed read', error);
			}
		} else {
			syncPrototypeStatusTone.value = 'error';
			syncPrototypeStatus.value = error instanceof Error
				? `Sync marker not read: ${error.message}`
				: 'Sync marker could not be read';
			log.warn('Prototype review sync marker capture failed', error);
		}
		const pendingSeek = getPendingSyncMarkerSeek();
		if (pendingSeek) {
			if (pendingSeek.id !== syncMarkerSeekIDAtCaptureStart) {
				scheduleAutomaticSyncMarkerRead(SYNC_MARKER_SEEK_FIRST_READ_DELAY_MS);
			} else {
				pendingSeek.readFailures++;
				if (pendingSeek.readFailures >= SYNC_MARKER_SEEK_MAX_READ_FAILURES) {
					pendingSyncMarkerSeek = null;
					reviewSeekCoordinator.finish(
						pendingSeek.seekRequestID,
						'unverified',
						'Sync marker could not be read after seeking',
					);
					syncPrototypeStatusTone.value = 'error';
					syncPrototypeStatus.value = pendingSeek.phase === 'verification'
						? 'Seek correction could not be verified'
						: 'Seek completed, but its sync marker could not be verified';
					log.debug('Stopped seek synchronization after repeated marker read failures', {
						videoId: pendingSeek.videoId,
						readFailures: pendingSeek.readFailures,
					});
				} else {
					const retryDelayMs = Math.min(
						SYNC_MARKER_SEEK_OBSERVATION_INTERVAL_MS
							* 2 ** (pendingSeek.readFailures - 1),
						SYNC_MARKER_SEEK_READ_FAILURE_BACKOFF_MAX_MS,
					);
					scheduleAutomaticSyncMarkerRead(retryDelayMs);
				}
			}
		}
	} finally {
		isSyncPrototypeCapturing.value = false;
		if (!automatic) revealPlayerControls();
	}
}

function dismissReviewSyncStatus(): void {
	syncPrototypeStatus.value = '';
}

</script>

<template>
	<TabContent>
		<div class="w-full h-full min-h-0 flex flex-col">
			<div class="flex flex-row gap-0 h-9/10 flex-14">
				<div class="flex flex-1 flex-col max-w-[calc(100vw-350px)]">
					<ReviewWclSelectors />
					<div
						ref="videoContainer"
						class="youtube-player-container relative bg-gray-200 aspect-video max-w-[min(100%,80vw)] h-[calc(100%-85px)] rounded-md mt-2"
						:class="{ 'youtube-player-container--fullscreen': isPlayerFullscreen }"
						@pointerenter="onPlayerPointerEnter"
						@pointermove="revealPlayerControls"
						@dblclick="onPlayerDoubleClick"
					>
						<div :key="playerReloads" v-show="reviewsStore.selectedVideoInfo" class="youtube-player-frame w-full h-full relative">
							<div
								allow="autoplay; encrypted-media; fullscreen"
								referrerpolicy="strict-origin-when-cross-origin"
								ref="playerIframe"
								class="rounded-md w-full h-full z-50"
							></div>
						</div>
						<ReviewPlayerOverlay
							ref="playerOverlay"
							:selected-video="Boolean(reviewsStore.selectedVideoInfo)"
							:playing="isPlayerPlaying"
							:fullscreen="isPlayerFullscreen"
							:queued-seek-delta-seconds="queuedSeekDeltaSeconds"
							:queued-seek-delta-label="queuedSeekDeltaLabel"
							:queued-seek-direction-class="queuedSeekDirectionClass"
							:sync-status="syncPrototypeStatus"
							:sync-status-tone="syncPrototypeStatusTone"
							:sync-capturing="isSyncPrototypeCapturing"
							@read-sync-marker="captureReviewSyncMarker('manual')"
							@open-video="openSelectedYoutubeVideo"
							@toggle-fullscreen="requestFullscreenToggle"
							@dismiss-sync-status="dismissReviewSyncStatus"
						/>
					</div>
				</div>
				<ReviewVideoList @open-stream="openStreamInBrowser" />
			</div>
			<div class="flex-1 min-h-26 flex w-full flex-col items-center">
				<div class="relative mt-12 w-96/100">
					<button
						type="button"
						class="absolute -left-4 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center cursor-pointer text-neutral-500 transition-[color,transform,opacity] duration-150 hover:text-sky-500 focus:outline-none focus:text-sky-500 active:scale-95 dark:text-neutral-300 dark:hover:text-sky-400 dark:focus:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
						style="width: 30px; height: 30px;"
						@click="copyReviewLink"
						@mouseenter="isCopyReviewLinkHovered = true"
						@mouseleave="isCopyReviewLinkHovered = false"
						@focus="isCopyReviewLinkHovered = true"
						@blur="isCopyReviewLinkHovered = false"
						:disabled="!reviewsStore.getSelectedVideoId"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
							<path d="M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 0 1 3.75 3.75v1.875C13.5 8.161 14.34 9 15.375 9h1.875A3.75 3.75 0 0 1 21 12.75v3.375C21 17.16 20.16 18 19.125 18h-9.75A1.875 1.875 0 0 1 7.5 16.125V3.375Z" />
							<path d="M15 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 17.25 7.5h-1.875A.375.375 0 0 1 15 7.125V5.25ZM4.875 6H6v10.125A3.375 3.375 0 0 0 9.375 19.5H16.5v1.125c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V7.875C3 6.839 3.84 6 4.875 6Z" />
						</svg>
					</button>
					<span
						v-if="copyReviewLinkTooltip"
						class="absolute -left-2 -top-7 z-30 rounded bg-black/80 px-2 py-1 text-xs text-white whitespace-nowrap"
					>
						{{ copyReviewLinkTooltip }}
					</span>
					<ReviewCooldownTimeline
						v-if="reviewsStore.selectedFightID && reviewsStore.getFightDuration > 0"
						v-model:expanded="reviewsStore.timelineExpanded"
						v-model:view-mode="reviewsStore.timelineViewMode"
						:compact-only="reviewsStore.timelineWindowDetached"
						:events="reviewsStore.getFightCooldownEvents"
						:fight-events="reviewsStore.getFightEvents"
						:groups="reviewsStore.getFightCooldownGroups"
						:phases="phaseTransitions"
						:fight-start-time="reviewsStore.getFightStartTimeOffset"
						:fight-duration="reviewsStore.getFightDuration"
						:playback="timelinePlayback"
						:loading="reviewsStore.isFightCooldownsLoading || reviewsStore.isFightEventsLoading"
						:error="reviewsStore.getFightCooldownError || reviewsStore.getFightEventsError"
						@seek="seekToFightTimestamp"
						@open-fight="openWCLFight"
						@open-death="openWCLDeath"
						@seek-pull="seekToPullTimestamp"
						@open-pull-death="openWCLPullDeath"
						@toggle-playback="togglePlayPause"
						@detach="detachTimeline"
					/>
				</div>
			</div>
		</div>
	</TabContent>
</template>

<style>
.youtube-player-container iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
	border-radius: 0.375rem;
}

.youtube-player-seek-queue {
	position: absolute;
	top: 50%;
	z-index: 60;
	transform: translate(-50%, -50%);
	color: rgb(241 245 249);
	pointer-events: none;
	text-align: center;
	text-shadow: 0 2px 5px rgb(0 0 0 / 95%), 0 0 16px rgb(0 0 0 / 75%);
}

.youtube-player-seek-queue--backward {
	left: 22%;
}

.youtube-player-seek-queue--forward {
	left: 78%;
}

.youtube-player-seek-queue--neutral {
	left: 50%;
}

.youtube-player-seek-queue strong {
	font-size: clamp(2.1rem, 5vw, 4rem);
	font-weight: 750;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.04em;
	line-height: 0.9;
}

.youtube-player-seek-queue-enter-active,
.youtube-player-seek-queue-leave-active {
	transition: left 80ms ease-out, opacity 80ms linear, transform 80ms linear;
}

.youtube-player-seek-queue-enter-from,
.youtube-player-seek-queue-leave-to {
	opacity: 0;
	transform: translate(-50%, -50%) scale(0.92);
}

.youtube-player-control-dock {
	position: absolute;
	right: 0.65rem;
	bottom: 3.35rem;
	z-index: 2;
	display: flex;
	align-items: center;
	border: 1px solid rgb(148 163 184 / 45%);
	border-radius: 0.2rem;
	background: rgb(8 13 22 / 88%);
	color: rgb(241 245 249);
	box-shadow: 0 2px 8px rgb(0 0 0 / 55%);
	opacity: 0.86;
	overflow: hidden;
	transition: border-color 80ms linear, opacity 220ms ease-out;
}

.youtube-player-control-dock--hidden {
	opacity: 0;
	pointer-events: none;
}

.youtube-player-control-dock:hover,
.youtube-player-control-dock:focus-within {
	border-color: rgb(165 180 252 / 72%);
	opacity: 1;
}

.youtube-player-control-button {
	display: flex;
	width: 2.2rem;
	height: 2.1rem;
	align-items: center;
	justify-content: center;
	border-left: 1px solid rgb(100 116 139 / 42%);
	background: transparent;
	color: inherit;
	cursor: pointer;
	transition: background-color 80ms linear, color 80ms linear;
}

.youtube-player-control-button:first-child {
	border-left: 0;
}

.youtube-player-control-button:hover,
.youtube-player-control-button:focus-visible {
	background: rgb(30 41 59 / 96%);
	color: white;
}

.youtube-player-control-button:disabled {
	cursor: wait;
	opacity: 0.45;
}

.youtube-player-control-button:focus-visible {
	outline: 2px solid rgb(129 140 248 / 85%);
	outline-offset: -2px;
}

.youtube-player-control-button svg {
	width: 1.25rem;
	height: 1.25rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: square;
	stroke-linejoin: miter;
}

.youtube-player-control-button svg rect {
	fill: none;
}

.youtube-player-control-button svg path {
	stroke-linecap: round;
	stroke-linejoin: round;
}

.youtube-player-sync-prototype {
	position: absolute;
	top: 0.65rem;
	right: 0.65rem;
	z-index: 3;
	display: flex;
	max-width: min(48rem, calc(100% - 1.3rem));
	align-items: center;
	gap: 0.55rem;
	padding: 0.38rem 0.5rem;
	border: 1px solid rgb(71 85 105 / 80%);
	border-radius: 0.15rem;
	background: rgb(8 13 22 / 94%);
	box-shadow: 0 2px 8px rgb(0 0 0 / 65%);
	color: rgb(203 213 225);
	font-size: 0.72rem;
	font-variant-numeric: tabular-nums;
	line-height: 1.2;
}

.youtube-player-sync-prototype--success {
	border-color: rgb(45 212 191 / 70%);
	color: rgb(153 246 228);
}

.youtube-player-sync-prototype--error {
	border-color: rgb(248 113 113 / 75%);
	color: rgb(254 202 202);
}

.youtube-player-sync-prototype button {
	padding-left: 0.5rem;
	border-left: 1px solid rgb(100 116 139 / 55%);
	color: rgb(226 232 240);
	font-weight: 700;
	text-transform: uppercase;
}

.youtube-player-sync-prototype button:hover,
.youtube-player-sync-prototype button:focus-visible {
	color: white;
}

.youtube-player-hotkey-guide {
	position: absolute;
	right: 0.65rem;
	bottom: 5.9rem;
	z-index: 3;
	width: min(38rem, calc(100% - 1.3rem));
	max-height: calc(100% - 4rem);
	overflow: auto;
	border: 1px solid rgb(100 116 139 / 58%);
	border-radius: 0.25rem;
	background: rgb(7 12 20 / 96%);
	color: rgb(226 232 240);
	box-shadow: 0 12px 32px rgb(0 0 0 / 62%);
	backdrop-filter: blur(5px);
}

.youtube-player-hotkey-guide__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 0.8rem 0.6rem;
	border-bottom: 1px solid rgb(71 85 105 / 50%);
}

.youtube-player-hotkey-guide__title {
	font-size: 0.9rem;
	font-weight: 700;
	letter-spacing: 0.02em;
}

.youtube-player-hotkey-guide__hint {
	margin-top: 0.1rem;
	font-size: 0.7rem;
	color: rgb(148 163 184);
}

.youtube-player-hotkey-guide__header button {
	font-size: 1.25rem;
	line-height: 1;
	color: rgb(148 163 184);
	cursor: pointer;
}

.youtube-player-hotkey-guide__header button:hover,
.youtube-player-hotkey-guide__header button:focus-visible {
	color: white;
}

.youtube-player-hotkey-guide__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.4rem 0.8rem;
	padding: 0.7rem 0.8rem 0.8rem;
}

.youtube-player-hotkey-guide__item {
	display: flex;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	font-size: 0.75rem;
	color: rgb(203 213 225);
}

.youtube-player-hotkey-guide__item kbd {
	flex: none;
	min-width: 3rem;
	padding: 0.18rem 0.35rem;
	border: 1px solid rgb(100 116 139 / 60%);
	border-bottom-color: rgb(148 163 184 / 75%);
	border-radius: 0.18rem;
	background: rgb(30 41 59 / 82%);
	color: rgb(241 245 249);
	font-family: inherit;
	font-size: 0.68rem;
	font-weight: 650;
	line-height: 1.2;
	text-align: center;
	white-space: nowrap;
}

.youtube-player-container--fullscreen {
	position: fixed !important;
	inset: 0 !important;
	z-index: 2147483647;
	width: 100vw !important;
	height: 100vh !important;
	max-width: none !important;
	margin: 0 !important;
	border-radius: 0 !important;
	background: rgb(229 231 235);
}

.youtube-player-container--fullscreen > .youtube-player-frame,
.youtube-player-container--fullscreen iframe {
	width: 100% !important;
	height: 100% !important;
	border-radius: 0 !important;
}
</style>
