import log from 'electron-log/renderer';
import { computed, nextTick, watch, type Ref } from 'vue';

import { getReviewVideoEndTime } from '@/reviewVideoSelection';
import { useReviewVideoSynchronization } from '@/renderer/composables/useReviewVideoSynchronization';
import {
	ReviewSeekCoordinator,
	type ReviewSeekExecutionContext,
	type ReviewSeekIntent,
	type ReviewSeekSource,
} from '@/renderer/reviewSeekCoordinator';
import type { useReviewsStore } from '@/renderer/store/ReviewsStore';
import type YTPlayer from '@/renderer/yt-player';

type ReviewPlaybackCoordinatorOptions = {
	reviewsStore: ReturnType<typeof useReviewsStore>;
	player: Ref<YTPlayer | null>;
	playerLoaded: Readonly<Ref<boolean>>;
	playerPlaying: Readonly<Ref<boolean>>;
	currentVideoTime: Readonly<Ref<number>>;
	playerStateRevision: Readonly<Ref<number>>;
	playerSeekRevision: Readonly<Ref<number>>;
	videoContainer: Readonly<Ref<HTMLElement | null>>;
	dispatchYoutubePlayerSeek: (seconds: number) => void;
	dispatchYoutubePlayerLoad: (videoID: string, autoplay: boolean, seconds: number) => void;
	clearQueuedSeek: () => void;
	resetPlayerOverlay: () => void;
	keepControlsVisible: () => void;
	revealControls: () => void;
};

export function useReviewPlaybackCoordinator(options: ReviewPlaybackCoordinatorOptions) {
	const { reviewsStore } = options;
	let internallySelectedFight: { requestID: number; fightID: number } | null = null;
	let internallySelectedVideo: { requestID: number; videoID: string } | null = null;
	let lastFightRelativeTime = 0;

	const seekCoordinator = new ReviewSeekCoordinator(
		executeReviewSeek,
		state => {
			if (state?.phase === 'failed' || state?.phase === 'unavailable') {
				synchronization.reportSeekFailure(state.message || 'Video seek is unavailable');
			}
		},
	);

	const synchronization = useReviewVideoSynchronization({
		player: options.player,
		playerLoaded: options.playerLoaded,
		playerPlaying: options.playerPlaying,
		playerStateRevision: options.playerStateRevision,
		playerSeekRevision: options.playerSeekRevision,
		videoContainer: options.videoContainer,
		getSelectedVideo: () => reviewsStore.selectedVideoInfo,
		getSelectedVideoID: () => reviewsStore.getSelectedVideoId,
		seekCoordinator,
		clampSeekTarget: seconds => {
			const duration = options.player.value?.getDuration() || 0;
			return Math.max(0, Math.min(
				seconds,
				duration > 0 ? duration : Number.POSITIVE_INFINITY,
			));
		},
		dispatchPlayerSeek: seconds => dispatchPlayerSeek(seconds),
		keepControlsVisible: options.keepControlsVisible,
		revealControls: options.revealControls,
	});

	function dispatchPlayerSeek(seconds: number): void {
		options.dispatchYoutubePlayerSeek(seconds);
		synchronization.onPlayerSeekDispatched();
	}

	function dispatchPlayerLoad(videoID: string, autoplay: boolean, seconds: number): void {
		options.dispatchYoutubePlayerLoad(videoID, autoplay, seconds);
	}

	function requestSelectedVideoPlayback(source: ReviewSeekSource = 'video-selection'): void {
		const videoID = reviewsStore.getSelectedVideoId;
		if (!videoID || !options.player.value || !options.playerLoaded.value) return;

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
			? Math.max(0, synchronization.getVideoTimeForAbsoluteLogTimestamp(reportStartTime!))
			: 0;
		void requestVideoTimeSeek(reportVideoTime, source, true, videoID);
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
		if (
			current
			&& candidates.some(video => video.id === current.id)
			&& videoContainsTimestamp(current, timestampMs)
		) return current;

		return candidates.find(video => videoContainsTimestamp(video, timestampMs)) || null;
	}

	async function executeReviewSeek(
		intent: ReviewSeekIntent,
		context: ReviewSeekExecutionContext,
	) {
		const activePlayer = options.player.value;
		if (!activePlayer || !options.playerLoaded.value) {
			return { phase: 'unavailable' as const, message: 'YouTube player is still loading' };
		}

		if (intent.kind === 'video-time') {
			const video = reviewsStore.videoList.find(candidate => candidate.id === intent.videoID)
				|| reviewsStore.selectedVideoInfo;
			if (!video || video.id !== intent.videoID) {
				return { phase: 'unavailable' as const, message: 'The selected stream is no longer available' };
			}
			const videoDurationSeconds = video.duration > 0
				? video.duration / 1000
				: Number.POSITIVE_INFINITY;
			if (
				!Number.isFinite(intent.videoTimeSeconds)
				|| intent.videoTimeSeconds < 0
				|| intent.videoTimeSeconds > videoDurationSeconds
			) {
				return { phase: 'unavailable' as const, message: 'That timestamp is outside the selected stream' };
			}
			if (!context.isCurrent()) return { phase: 'unavailable' as const };

			synchronization.cancelPendingSeek('Video-time seek');
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

		const videoTimeSeconds = synchronization.getVideoTimeForAbsoluteLogTimestamp(targetMarkerTimestampMs);
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
		options.clearQueuedSeek();
		synchronization.cancelPendingSeek('New absolute seek');
		if (intent.synchronize) {
			synchronization.queueSeek(
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
		if (!videoID || !options.player.value || !options.playerLoaded.value) return Promise.resolve(null);
		return seekCoordinator.request({
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
		if (!options.player.value || !options.playerLoaded.value) return Promise.resolve(null);
		return seekCoordinator.request({
			kind: 'fight-time',
			source,
			fightID,
			fightTimestampSeconds,
			preferredVideoID,
			play: true,
			synchronize: true,
		});
	}

	function seekToFightTimestamp(
		fightTimestamp: number,
		source: ReviewSeekSource = 'timeline',
	): void {
		const fightID = reviewsStore.selectedFightID;
		if (!fightID) return;
		void requestFightSeek(fightID, fightTimestamp, source);
	}

	function seekToPullTimestamp(
		fightID: number,
		timestampSeconds: number,
		source: ReviewSeekSource = 'comparison',
	): void {
		if (!reviewsStore.getReportDetails?.fights.some(fight => fight.id === fightID)) return;
		void requestFightSeek(fightID, timestampSeconds, source);
	}

	function rememberCurrentFightTime(): void {
		if (!reviewsStore.selectedFightID || !reviewsStore.getFightDuration) return;
		if (options.player.value?.getVideoId() !== reviewsStore.getSelectedVideoId) return;
		const pendingSeek = synchronization.getPendingSeek();
		if (
			pendingSeek
			&& Date.now() - pendingSeek.seekIssuedAt < 2_000
			&& Math.abs(options.currentVideoTime.value - pendingSeek.requestedVideoTimeSeconds) > 2
		) return;
		const currentLogTimestamp = synchronization.getAbsoluteLogTimestampForVideoTime(
			options.currentVideoTime.value,
		);
		const fightRelativeTime = (currentLogTimestamp - reviewsStore.getFightStartTime) / 1000;
		lastFightRelativeTime = Math.max(
			0,
			Math.min(fightRelativeTime, reviewsStore.getFightDuration / 1000),
		);
	}

	const currentFightCursor = computed(() => {
		if (!options.player.value || !reviewsStore.getFightDuration) return 0;
		const currentLogTimestamp = synchronization.getAbsoluteLogTimestampForVideoTime(
			options.currentVideoTime.value,
		);
		const fightRelativeTime = (currentLogTimestamp - reviewsStore.getFightStartTime) / 1000;
		const fightDurationSeconds = reviewsStore.getFightDuration / 1000;
		const clamped = Math.max(0, Math.min(fightRelativeTime, fightDurationSeconds));
		return clamped / fightDurationSeconds;
	});

	watch(() => reviewsStore.getSelectedVideoId, newId => {
		synchronization.onSelectedVideoChange(newId);
		if (!newId) {
			internallySelectedVideo = null;
			seekCoordinator.cancel('No video selected');
			options.resetPlayerOverlay();
			options.player.value?.stop();
			return;
		}
		if (
			internallySelectedVideo?.videoID === newId
			&& seekCoordinator.state?.requestID === internallySelectedVideo.requestID
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

	watch(() => reviewsStore.selectedFightID, newValue => {
		if (
			newValue
			&& internallySelectedFight?.fightID === newValue
			&& seekCoordinator.state?.requestID === internallySelectedFight.requestID
		) {
			internallySelectedFight = null;
			return;
		}
		internallySelectedFight = null;
		lastFightRelativeTime = 0;
		if (newValue) void requestFightSeek(newValue, 0, 'fight-selection');
		else seekCoordinator.cancel('No fight selected');
	});

	watch(() => reviewsStore.selectedReportCode, async (newValue, oldValue) => {
		if (newValue === oldValue) return;
		lastFightRelativeTime = 0;
		internallySelectedFight = null;
		internallySelectedVideo = null;
		seekCoordinator.cancel('Selected report changed');
		synchronization.cancelPendingSeek('Selected report changed');
		await nextTick();
		if (reviewsStore.selectedReportCode !== newValue) return;
		if (newValue && reviewsStore.selectedVideoInfo) {
			const reportStart = reviewsStore.getSelectedReport?.startTime
				?? reviewsStore.getReportDetails?.startTime;
			if (Number.isFinite(reportStart)) {
				void requestVideoTimeSeek(
					synchronization.getVideoTimeForAbsoluteLogTimestamp(reportStart!),
					'report-selection',
					true,
				);
			}
		}
	});

	watch(() => reviewsStore.videoList, newList => {
		if (!reviewsStore.selectedVideoInfo && newList.length > 0) {
			reviewsStore.setSelectedVideoInfo(newList[0]);
		}
	});

	return {
		cancelActiveSeek: (reason: string) => seekCoordinator.cancel(reason),
		cancelPendingSynchronizedSeek: synchronization.cancelPendingSeek,
		captureReviewSyncMarker: synchronization.capture,
		currentFightCursor,
		dismissReviewSyncStatus: synchronization.dismissStatus,
		dispatchPlayerSeek,
		failSynchronizationSeek: synchronization.failActiveSeek,
		isSyncPrototypeCapturing: synchronization.isCapturing,
		rememberCurrentFightTime,
		requestSelectedVideoPlayback,
		requestVideoTimeSeek,
		resetSynchronizationForPlayerChange: synchronization.onPlayerBeforeChange,
		seekToFightTimestamp,
		seekToPullTimestamp,
		syncPrototypeStatus: synchronization.status,
		syncPrototypeStatusTone: synchronization.statusTone,
		updatePendingSyncMarkerSeekPlaybackRate: synchronization.updatePlaybackRate,
		updateSynchronizationPlayerState: synchronization.onPlayerStateChange,
	};
}
