<script setup lang="ts">
import log from 'electron-log/renderer';

import { computed, watch, useTemplateRef, nextTick } from 'vue';
import { useReviewPlayerFrame } from '@/renderer/composables/useReviewPlayerFrame';
import { useReviewPlayerHotkeys } from '@/renderer/composables/useReviewPlayerHotkeys';
import { createReviewTimelinePlayback } from '@/renderer/composables/useReviewTimelinePlayback';
import { useReviewTimelineWindowBridge } from '@/renderer/composables/useReviewTimelineWindowBridge';
import { useReviewVideoActions } from '@/renderer/composables/useReviewVideoActions';
import { useReviewVideoSynchronization } from '@/renderer/composables/useReviewVideoSynchronization';
import {
	useReviewYoutubePlayer,
	type ReviewYoutubePlayerState,
} from '@/renderer/composables/useReviewYoutubePlayer';

import TabContent from '@/renderer/components/TabContent.vue';
import ReviewCooldownTimeline from '@/renderer/components/ReviewCooldownTimeline.vue';
import ReviewPlayerOverlay from '@/renderer/components/ReviewPlayerOverlay.vue';
import ReviewVideoList from '@/renderer/components/ReviewVideoList.vue';
import ReviewWclSelectors from '@/renderer/components/ReviewWclSelectors.vue';

import { useReviewsStore } from '@/renderer/store/ReviewsStore';

import {
	ReviewSeekCoordinator,
	type ReviewSeekExecutionContext,
	type ReviewSeekIntent,
	type ReviewSeekSource,
} from '@/renderer/reviewSeekCoordinator';
import { getReviewVideoEndTime } from '@/reviewVideoSelection';
import { buildReviewPhaseMarkers } from '@/reviewPhaseTransitions';

const reviewsStore = useReviewsStore();

const playerIframe = useTemplateRef<HTMLIFrameElement | null>('playerIframe');
const videoContainer = useTemplateRef<HTMLElement | null>('videoContainer');
type ReviewPlayerOverlayHandle = {
	closeHotkeyGuide: () => boolean;
	keepControlsVisible: () => void;
	reset: () => void;
	revealControls: () => void;
};
const playerOverlay = useTemplateRef<ReviewPlayerOverlayHandle | null>('playerOverlay');
const {
	currentTime: currentVideoTime,
	dispatchLoad: dispatchYoutubePlayerLoad,
	dispatchSeek: dispatchYoutubePlayerSeek,
	isLoaded: playerLoaded,
	isPlaying: isPlayerPlaying,
	player,
	reloadRevision: playerReloads,
	seekRevision: youtubePlayerSeekRevision,
	stateRevision: youtubePlayerStateRevision,
} = useReviewYoutubePlayer({
	iframe: playerIframe,
	onBeforePlayerChange: () => handleYoutubePlayerBeforeChange(),
	onPlaybackUnavailable: message => handleYoutubePlayerUnavailable(message),
	onPlaybackError: message => handleYoutubePlayerError(message),
	onTimeUpdate: seconds => handleYoutubePlayerTimeUpdate(seconds),
	onReady: () => handleYoutubePlayerReady(),
	onStateChange: state => handleYoutubePlayerStateChange(state),
	onPlaybackRateChange: rate => updatePendingSyncMarkerSeekPlaybackRate(rate),
	revealControls: () => revealPlayerControls(),
	keepControlsVisible: () => keepPlayerControlsVisible(),
});
let internallySelectedFight: { requestID: number; fightID: number } | null = null;
let internallySelectedVideo: { requestID: number; videoID: string } | null = null;

const reviewSeekCoordinator = new ReviewSeekCoordinator(
	executeReviewSeek,
	state => {
		if (state?.phase === 'failed' || state?.phase === 'unavailable') {
			reportSynchronizationSeekFailure(state.message || 'Video seek is unavailable');
		}
	},
);

const {
	cancelPendingSeek: cancelPendingSynchronizedSeek,
	capture: captureReviewSyncMarker,
	dismissStatus: dismissReviewSyncStatus,
	failActiveSeek: failSynchronizationSeek,
	getAbsoluteLogTimestampForVideoTime,
	getPendingSeek: getPendingSyncMarkerSeek,
	getVideoTimeForAbsoluteLogTimestamp,
	isCapturing: isSyncPrototypeCapturing,
	onPlayerBeforeChange: resetSynchronizationForPlayerChange,
	onPlayerSeekDispatched: scheduleSynchronizationAfterSeek,
	onPlayerStateChange: updateSynchronizationPlayerState,
	onSelectedVideoChange: resetSynchronizationForSelectedVideo,
	queueSeek: queueSyncMarkerSeek,
	reportSeekFailure: reportSynchronizationSeekFailure,
	status: syncPrototypeStatus,
	statusTone: syncPrototypeStatusTone,
	updatePlaybackRate: updatePendingSyncMarkerSeekPlaybackRate,
} = useReviewVideoSynchronization({
	player,
	playerLoaded,
	playerPlaying: isPlayerPlaying,
	playerStateRevision: youtubePlayerStateRevision,
	playerSeekRevision: youtubePlayerSeekRevision,
	videoContainer,
	getSelectedVideo: () => reviewsStore.selectedVideoInfo,
	getSelectedVideoID: () => reviewsStore.getSelectedVideoId,
	seekCoordinator: reviewSeekCoordinator,
	clampSeekTarget: seconds => {
		const duration = player.value?.getDuration() || 0;
		return Math.max(0, Math.min(
			seconds,
			duration > 0 ? duration : Number.POSITIVE_INFINITY,
		));
	},
	dispatchPlayerSeek: seconds => dispatchPlayerSeek(seconds),
	keepControlsVisible: () => keepPlayerControlsVisible(),
	revealControls: () => revealPlayerControls(),
});

const {
	isFullscreen: isPlayerFullscreen,
	onPointerEnter: onPlayerPointerEnter,
	requestFullscreenToggle,
} = useReviewPlayerFrame({
	container: videoContainer,
	playerLoaded,
	hasSelectedVideo: () => Boolean(reviewsStore.getSelectedVideoId),
	closeHotkeyGuide: () => {
		playerOverlay.value?.closeHotkeyGuide();
	},
	revealControls: () => revealPlayerControls(),
});

const {
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

function revealPlayerControls() {
	playerOverlay.value?.revealControls();
}

function keepPlayerControlsVisible() {
	playerOverlay.value?.keepControlsVisible();
}

function dispatchPlayerSeek(seconds: number) {
	dispatchYoutubePlayerSeek(seconds);
	scheduleSynchronizationAfterSeek();
}

function dispatchPlayerLoad(videoID: string, autoplay: boolean, seconds: number) {
	dispatchYoutubePlayerLoad(videoID, autoplay, seconds);
}

let lastFightRelativeTime = 0;
function requestSelectedVideoPlayback(source: ReviewSeekSource = 'video-selection') {
	const videoID = reviewsStore.getSelectedVideoId;
	if (!videoID || !player.value || !playerLoaded.value) return;

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
	resetSynchronizationForSelectedVideo(newId);
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


function handleYoutubePlayerBeforeChange(): void {
	clearQueuedHotkeySeek();
	resetSynchronizationForPlayerChange();
}

function handleYoutubePlayerUnavailable(message: string): void {
	clearQueuedHotkeySeek();
	failSynchronizationSeek(message);
}

function handleYoutubePlayerError(message: string): void {
	clearQueuedHotkeySeek();
	failSynchronizationSeek(message, true);
}

function handleYoutubePlayerTimeUpdate(seconds: number): void {
	onHotkeySeekTimeUpdate(seconds);
	rememberCurrentFightTime();
}

function handleYoutubePlayerReady(): void {
	requestSelectedVideoPlayback();
	reviewsStore.flushPendingTimelineWindowActions();
}

function handleYoutubePlayerStateChange(state: ReviewYoutubePlayerState): void {
	updateSynchronizationPlayerState(state);
}

watch(() => reviewsStore.videoList, (newList) => {
	if (!reviewsStore.selectedVideoInfo && newList.length > 0) {
		reviewsStore.setSelectedVideoInfo(newList[0]);
	}
	// log.info('Filtered video list length:', newList.length);
	// for (const video of newList) {
	// 	log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(video.startTime + (video.duration || 0)).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
	// }
});

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
	if (!activePlayer || !playerLoaded.value) {
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
	if (!videoID || !player.value || !playerLoaded.value) return Promise.resolve(null);
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
	if (!player.value || !playerLoaded.value) return Promise.resolve(null);
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

const phaseTransitions = computed(() => buildReviewPhaseMarkers(
	reviewsStore.getReportDetails?.phases,
	reviewsStore.getSelectedFight,
	reviewsStore.getFightDuration,
));

const {
	detachTimeline,
	openWCLDeath,
	openWCLFight,
	openWCLPullDeath,
} = useReviewTimelineWindowBridge({
	cursorPercent: currentFightCursor,
	isPlaying: isPlayerPlaying,
	phases: phaseTransitions,
	isPlayerReady: () => Boolean(player.value && playerLoaded.value),
	seekFight: (timestampSeconds, source) => seekToFightTimestamp(timestampSeconds, source),
	seekPull: (fightID, timestampSeconds, source) => {
		seekToPullTimestamp(fightID, timestampSeconds, source);
	},
	togglePlayback: () => togglePlayPause(),
});

const {
	copyReviewLink,
	copyReviewLinkTooltip,
	isCopyReviewLinkHovered,
	openSelectedYoutubeVideo,
	openStreamInBrowser,
} = useReviewVideoActions({
	player,
	playerLoaded,
	currentVideoTime,
	getSelectedVideo: () => reviewsStore.selectedVideoInfo,
	getSelectedVideoID: () => reviewsStore.getSelectedVideoId,
});

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
