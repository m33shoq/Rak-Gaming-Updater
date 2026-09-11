<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { useReviewPlaybackCoordinator } from '@/renderer/composables/useReviewPlaybackCoordinator';
import { useReviewPlayerFrame } from '@/renderer/composables/useReviewPlayerFrame';
import { useReviewPlayerHotkeys } from '@/renderer/composables/useReviewPlayerHotkeys';
import { createReviewTimelinePlayback } from '@/renderer/composables/useReviewTimelinePlayback';
import { useReviewTimelineWindowBridge } from '@/renderer/composables/useReviewTimelineWindowBridge';
import { useReviewVideoActions } from '@/renderer/composables/useReviewVideoActions';
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
let clearQueuedHotkeySeek = () => undefined;
const {
	cancelActiveSeek,
	cancelPendingSynchronizedSeek,
	captureReviewSyncMarker,
	currentFightCursor,
	dismissReviewSyncStatus,
	dispatchPlayerSeek,
	failSynchronizationSeek,
	isSyncPrototypeCapturing,
	rememberCurrentFightTime,
	requestSelectedVideoPlayback,
	requestVideoTimeSeek,
	resetSynchronizationForPlayerChange,
	seekToFightTimestamp,
	seekToPullTimestamp,
	syncPrototypeStatus,
	syncPrototypeStatusTone,
	updatePendingSyncMarkerSeekPlaybackRate,
	updateSynchronizationPlayerState,
} = useReviewPlaybackCoordinator({
	reviewsStore,
	player,
	playerLoaded,
	playerPlaying: isPlayerPlaying,
	currentVideoTime,
	playerStateRevision: youtubePlayerStateRevision,
	playerSeekRevision: youtubePlayerSeekRevision,
	videoContainer,
	dispatchYoutubePlayerSeek,
	dispatchYoutubePlayerLoad,
	clearQueuedSeek: () => clearQueuedHotkeySeek(),
	resetPlayerOverlay: () => playerOverlay.value?.reset(),
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
	clearQueuedSeek: clearQueuedHotkeySeekHandler,
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
	cancelActiveSeek,
	cancelSynchronizedSeek: reason => cancelPendingSynchronizedSeek(reason),
});
clearQueuedHotkeySeek = clearQueuedHotkeySeekHandler;

function revealPlayerControls() {
	playerOverlay.value?.revealControls();
}

function keepPlayerControlsVisible() {
	playerOverlay.value?.keepControlsVisible();
}

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
