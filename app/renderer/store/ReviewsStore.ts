import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import { reviewVideoOverlapsWindow } from '@/reviewVideoSelection';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';
import { useReviewBossCastPreferences } from '@/renderer/composables/useReviewBossCastPreferences';
import { useReviewFightData } from '@/renderer/composables/useReviewFightData';
import { useReviewReportData } from '@/renderer/composables/useReviewReportData';
import { useReviewTimelineWindowState } from '@/renderer/composables/useReviewTimelineWindowState';

export const useReviewsStore = defineStore('Reviews', () => {
	const { youtubeVideoInfo, refreshYoutubeVideoInfo } = useYoutubeVideoInfo();
	const {
		displayMode: bossCastDisplayMode,
		ensurePreferencesLoaded: ensureBossCastPreferencesLoaded,
		isAbilityEnabled: isBossCastAbilityEnabled,
		preferencesLoaded: bossCastPreferencesLoaded,
		reloadPreferences: reloadBossCastPreferences,
		resetAbilityPreferences: resetBossCastAbilityPreferences,
		setAbilityEnabled: setBossCastAbilityEnabled,
		setDisplayMode: setBossCastDisplayMode,
		visibilityOverrides: bossCastVisibilityOverrides,
	} = useReviewBossCastPreferences();
	const {
		detached: timelineWindowDetached,
		expanded: timelineExpanded,
		flushPendingActions: flushPendingTimelineWindowActions,
		hasPendingActions: hasPendingTimelineWindowActions,
		registerActionHandler: registerTimelineWindowActionHandler,
		returnToReviewsRevision: timelineWindowReturnToReviewsRevision,
		viewMode: timelineViewMode,
	} = useReviewTimelineWindowState({
		onReattached: () => {
			void reloadBossCastPreferences();
		},
	});
	const selectedVideoInfo = ref<YouTubeVideo | null>(null);

	function setSelectedVideoInfo(video: YouTubeVideo | null) {
		selectedVideoInfo.value = video;
	}

	const pendingDirectVideoSeekSeconds = ref<number | null>(null);
	function consumePendingDirectVideoSeekSeconds() {
		const value = pendingDirectVideoSeekSeconds.value;
		pendingDirectVideoSeekSeconds.value = null;
		return value;
	}

	const getSelectedVideoId = computed(() => selectedVideoInfo.value?.id || null);
	const {
		getReportDetails,
		getReports,
		getSelectedFight,
		getSelectedReport,
		hasOlderReports,
		hydrateTimelineWindowContext,
		isReportListLoading,
		isSelectedReportDetailsLoading,
		olderReportsError,
		olderReportsLoading,
		refreshAfterWclReady: refreshReportDataAfterWclReady,
		reportDetails,
		reportListError,
		reportListStatus,
		reports,
		requestReportData,
		requestReports,
		selectedFightID,
		selectedReportCode,
		selectedReportDetailsError,
		selectedReportDetailsStatus,
		setReportDetails,
		setReports,
	} = useReviewReportData({
		mergeTimelineData: snapshot => mergeTimelineWindowDataSnapshot(snapshot),
		onReportChanged: reportCode => {
			if (reportCode && !videoList.value.some(video => video.id === selectedVideoInfo.value?.id)) {
				setSelectedVideoInfo(videoList.value[0] || null);
			}
		},
		onFightChanged: () => {
			void requestFightEvents();
			void requestFightCooldowns();
		},
	});
	const {
		createTimelineWindowDataSnapshot,
		ensureFightBossCasts,
		ensureFightCooldowns,
		ensureFightEvents,
		fightBossCastCacheEpoch,
		fightCooldownCacheEpoch,
		getFightBossCastData,
		getFightBossCastDataFor,
		getFightBossCastError,
		getFightBossCastErrorFor,
		getFightCooldownData,
		getFightCooldownDataFor,
		getFightCooldownError,
		getFightCooldownErrorFor,
		getFightCooldownEvents,
		getFightCooldownGroups,
		getFightEvents,
		getFightEventsError,
		getFightEventsErrorFor,
		getFightEventsFor,
		invalidate: invalidateFightData,
		isFightBossCastsLoading,
		isFightBossCastsLoadingFor,
		isFightCooldownsLoading,
		isFightCooldownsLoadingFor,
		isFightEventsLoading,
		isFightEventsLoadingFor,
		mergeTimelineWindowDataSnapshot,
		requestFightBossCasts,
		requestFightCooldowns,
		requestFightEvents,
		savedFightBossCasts,
		savedFightCooldowns,
		savedFightEvents,
		timelineWindowDataRevision,
		timelineWindowUpdatedFight,
	} = useReviewFightData({
		selectedReportCode,
		selectedFightID,
		selectedFight: getSelectedFight,
	});
	const getReportTimeOffset = computed(() => {
		return getSelectedReport.value?.startTime ?? getReportDetails.value?.startTime ?? 0;
	});

	const getFightStartTimeOffset = computed(() => {
		const selected = getSelectedFight.value;
		if (!selected) return 0;
		return selected.startTime;
	});

	const getFightStartTime = computed(() => {
		const offset = getReportTimeOffset.value;
		const fightOffset = getFightStartTimeOffset.value;
		return offset + fightOffset;
	});

	const getFightStartRelativeToVideo = computed(() => {
		const videoStart = selectedVideoInfo.value?.startTime || 0;
		const fightStart = getFightStartTime.value || 0;
		return fightStart - videoStart;
	});

	const getFightDuration = computed(() => {
		const selected = getSelectedFight.value;
		if (!selected) return 0;
		return selected.endTime - selected.startTime;
	});

	function getSelectedFightAbsoluteWindow(): { start: number; end: number } | null {
		const reportStart = getSelectedReport.value?.startTime ?? getReportDetails.value?.startTime;
		const fight = getSelectedFight.value;
		if (!Number.isFinite(reportStart) || !fight) return null;
		return {
			start: reportStart! + fight.startTime,
			end: reportStart! + fight.endTime,
		};
	}

	const reportVideoList = computed<YouTubeVideo[]>(() => {
		const selectedReport = getSelectedReport.value;
		const reportStart = selectedReport?.startTime ?? getReportDetails.value?.startTime;
		const reportEnd = selectedReport?.endTime ?? getReportDetails.value?.endTime;
		const now = Date.now();

		const videosArray: YouTubeVideo[] = Object.values(youtubeVideoInfo.value.byId || {});

		return videosArray.filter(video => {
			return !selectedReportCode.value
				|| !Number.isFinite(reportStart)
				|| !Number.isFinite(reportEnd)
				|| reviewVideoOverlapsWindow(video, reportStart!, reportEnd!, now);
		}).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
	});

	const videoList = computed<YouTubeVideo[]>(() => {
		const fightWindow = getSelectedFightAbsoluteWindow();
		if (!fightWindow) return reportVideoList.value;

		const now = Date.now();
		return reportVideoList.value.filter(video => (
			reviewVideoOverlapsWindow(video, fightWindow.start, fightWindow.end, now)
		));
	});

	function videoMatchesCurrentSelection(video: YouTubeVideo): boolean {
		const fightWindow = getSelectedFightAbsoluteWindow();
		if (fightWindow) {
			return reviewVideoOverlapsWindow(video, fightWindow.start, fightWindow.end);
		}
		return videoList.value.some(candidate => candidate.id === video.id);
	}

	async function openVideoFromDeepLink(videoId: string, timestampSeconds: number) {
		const normalizedVideoId = videoId.trim();
		if (!normalizedVideoId) {
			return { success: false, error: 'Deep link is missing a video ID.' };
		}

		await refreshYoutubeVideoInfo(); // ensure we have the latest video info before trying to find the video

		const targetVideo = youtubeVideoInfo.value?.byId?.[normalizedVideoId] ?? null;
		if (!targetVideo) {
			return { success: false, error: `Video ${normalizedVideoId} was not found.` };
		}

		// if video was active during currently selected report/fight just select it and set the timestamp
		// otherwise clear selected report/fight to avoid confusion and then select the video and set the timestamp

		if (selectedReportCode.value && !videoMatchesCurrentSelection(targetVideo)) {
			log.info('Deep linked video is not relevant to currently selected report/fight, clearing selection');
			selectedFightID.value = null;

			if (selectedReportCode.value !== null) {
				selectedReportCode.value = null;
				reportDetails.value = null;
				await nextTick();
			}
		}

		setSelectedVideoInfo(targetVideo);
		pendingDirectVideoSeekSeconds.value = timestampSeconds;
		log.info('Opened video from deep link', { videoId: normalizedVideoId, timestampSeconds });

		return { success: true };
	}

	ipc.on(IPC_EVENTS.SOCKET_WCL_READY_CALLBACK, () => {
		// A reconnect can mean the server was deployed with a new cooldown catalog,
		// encounter-alert registry, or boss-cast enrichment. Wait until this socket's
		// WCL credentials are restored before invalidating and refreshing; otherwise
		// the first request can fail and leave the old visible fallback in place.
		invalidateFightData();
		refreshReportDataAfterWclReady();

		const reportCode = selectedReportCode.value;
		const fightID = selectedFightID.value;
		if (!reportCode || !fightID) return;

		void ensureFightEvents(reportCode, fightID, true, getSelectedFight.value?.encounterID);
		void ensureFightCooldowns(reportCode, fightID, true);
		void ensureFightBossCasts(reportCode, fightID, true, getSelectedFight.value?.encounterID);
	});

	return {
		youtubeVideoInfo,
		selectedVideoInfo,
		pendingDirectVideoSeekSeconds,
		timelineWindowDetached,
		timelineExpanded,
		timelineViewMode,
		timelineWindowReturnToReviewsRevision,
		timelineWindowDataRevision,
		timelineWindowUpdatedFight,
		hasPendingTimelineWindowActions,
		reports,
		reportListStatus,
		reportListError,
		isReportListLoading,
		olderReportsLoading,
		olderReportsError,
		hasOlderReports,
		selectedReportCode,
		reportDetails,
		selectedReportDetailsStatus,
		selectedReportDetailsError,
		isSelectedReportDetailsLoading,
		selectedFightID,
		savedFightEvents,
		savedFightCooldowns,
		savedFightBossCasts,
		fightCooldownCacheEpoch,
		fightBossCastCacheEpoch,
		bossCastVisibilityOverrides,
		bossCastDisplayMode,
		bossCastPreferencesLoaded,
		videoList,

		getReports,
		setReports,

		getSelectedVideoId,
		setSelectedVideoInfo,
		consumePendingDirectVideoSeekSeconds,
		getSelectedReport,
		getReportDetails,
		setReportDetails,
		getSelectedFight,
		getFightEvents,
		getFightEventsFor,
		isFightEventsLoading,
		isFightEventsLoadingFor,
		getFightEventsError,
		getFightEventsErrorFor,
		getFightCooldownData,
		getFightCooldownDataFor,
		getFightCooldownEvents,
		getFightCooldownGroups,
		isFightCooldownsLoading,
		isFightCooldownsLoadingFor,
		getFightCooldownError,
		getFightCooldownErrorFor,
		getFightBossCastData,
		getFightBossCastDataFor,
		isFightBossCastsLoading,
		isFightBossCastsLoadingFor,
		getFightBossCastError,
		getFightBossCastErrorFor,
		getReportTimeOffset,
		getFightStartTimeOffset,
		getFightStartTime,
		getFightStartRelativeToVideo,
		getFightDuration,
		hydrateTimelineWindowContext,
		createTimelineWindowDataSnapshot,
		registerTimelineWindowActionHandler,
		flushPendingTimelineWindowActions,

		requestReports,
		requestReportData,
		requestFightEvents,
		requestFightCooldowns,
		requestFightBossCasts,
		ensureFightEvents,
		ensureFightCooldowns,
		ensureFightBossCasts,
		ensureBossCastPreferencesLoaded,
		reloadBossCastPreferences,
		setBossCastDisplayMode,
		isBossCastAbilityEnabled,
		setBossCastAbilityEnabled,
		resetBossCastAbilityPreferences,
		openVideoFromDeepLink,
	};
});
