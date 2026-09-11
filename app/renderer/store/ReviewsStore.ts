import { defineStore } from 'pinia';
import { computed } from 'vue';
import { IPC_EVENTS } from '@/events';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useReviewBossCastPreferences } from '@/renderer/composables/useReviewBossCastPreferences';
import { useReviewFightData } from '@/renderer/composables/useReviewFightData';
import { useReviewReportData } from '@/renderer/composables/useReviewReportData';
import { useReviewTimelineWindowState } from '@/renderer/composables/useReviewTimelineWindowState';
import { useReviewVideoSelection } from '@/renderer/composables/useReviewVideoSelection';

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
	let ensureSelectedVideoIsAvailable: (reportCode: string | null) => void = () => undefined;
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
		onReportChanged: reportCode => ensureSelectedVideoIsAvailable(reportCode),
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
	const {
		consumePendingDirectVideoSeekSeconds,
		ensureSelectedVideoIsAvailable: ensureSelectedVideoIsAvailableFromSelection,
		getSelectedVideoId,
		openVideoFromDeepLink,
		pendingDirectVideoSeekSeconds,
		selectedVideoInfo,
		setSelectedVideoInfo,
		videoList,
	} = useReviewVideoSelection({
		youtubeVideoInfo,
		refreshYoutubeVideoInfo,
		selectedReportCode,
		selectedReport: getSelectedReport,
		reportDetails,
		selectedFightID,
		selectedFight: getSelectedFight,
	});
	ensureSelectedVideoIsAvailable = ensureSelectedVideoIsAvailableFromSelection;
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

	useIpcOn(IPC_EVENTS.SOCKET_WCL_READY_CALLBACK, () => {
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
