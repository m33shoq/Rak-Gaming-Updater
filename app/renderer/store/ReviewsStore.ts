import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef, nextTick } from 'vue';
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import type {
	ReviewTimelineWindowContext,
} from '@/timelineWindow';
import { reviewVideoOverlapsWindow } from '@/reviewVideoSelection';
import type { WclRequestResult } from '@/wclRequests';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';
import { useReviewBossCastPreferences } from '@/renderer/composables/useReviewBossCastPreferences';
import { useReviewFightData } from '@/renderer/composables/useReviewFightData';
import { useReviewTimelineWindowState } from '@/renderer/composables/useReviewTimelineWindowState';

const REPORT_LIST_CACHE_TTL_MS = 15 * 1000;
const REPORT_DETAILS_CACHE_TTL_MS = 15 * 1000;
type LoadStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';

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

	const reports = shallowRef<Array<reportSummary>>([]);
	const reportListStatus = ref<LoadStatus>('idle');
	const reportListError = ref<string | null>(null);
	const olderReportsLoading = ref(false);
	const olderReportsError = ref<string | null>(null);
	const hasOlderReports = ref(true);
	const selectedReportCode = ref<string | null>(null);
	const reportDetails = ref<reportDetails | null>(null);
	const reportDetailsByCode = ref<Record<string, reportDetails>>({});
	const reportDetailsCachedAt = ref<Record<string, number>>({});
	const reportDetailsStatusByCode = ref<Record<string, LoadStatus>>({});
	const reportDetailsErrorByCode = ref<Record<string, string | null>>({});
	const selectedFightID = ref<number | null>(null);
	const reportDataPromises = new Map<string, Promise<reportDetails | null>>();
	const reportListPromises = new Map<string, Promise<boolean>>();
	let reportSelectionGeneration = 0;
	let timelineContextHydrationGeneration = 0;
	let timelineContextHydrating = false;
	let reportListRequested = false;
	let reportListLoadedAt = 0;

	const getSelectedVideoId = computed(() => selectedVideoInfo.value?.id || null);

	const getReports = computed(() => reports.value);
	function setReports(newReports: Array<reportSummary>) {
		reports.value = newReports;
	}
	const getSelectedReport = computed(() => selectedReportCode.value ? reports.value.find(r => r.code === selectedReportCode.value) || null : null);
	const isReportListLoading = computed(() => (
		reportListStatus.value === 'loading' || reportListStatus.value === 'refreshing'
	));

	const getReportDetails = computed(() => reportDetails.value);
	function setReportDetails(details: reportDetails | null) {
		reportDetails.value = details;
	}

	function cacheReportDetails(reportCode: string, details: reportDetails) {
		const normalizedDetails: reportDetails = {
			...details,
			code: reportCode,
			fights: [...details.fights].sort((left, right) => right.startTime - left.startTime),
		};
		reportDetailsByCode.value[reportCode] = normalizedDetails;
		reportDetailsCachedAt.value[reportCode] = Date.now();
		reportDetailsStatusByCode.value[reportCode] = 'ready';
		reportDetailsErrorByCode.value[reportCode] = null;
		return normalizedDetails;
	}

	const getSelectedFight = computed(() => getReportDetails.value?.fights?.find(f => f.id === selectedFightID.value) || null);
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
	const selectedReportDetailsStatus = computed<LoadStatus>(() => {
		const reportCode = selectedReportCode.value;
		return reportCode ? reportDetailsStatusByCode.value[reportCode] || 'idle' : 'idle';
	});
	const selectedReportDetailsError = computed(() => {
		const reportCode = selectedReportCode.value;
		return reportCode ? reportDetailsErrorByCode.value[reportCode] || null : null;
	});
	const isSelectedReportDetailsLoading = computed(() => (
		selectedReportDetailsStatus.value === 'loading'
		|| selectedReportDetailsStatus.value === 'refreshing'
	));

	async function hydrateTimelineWindowContext(context: ReviewTimelineWindowContext) {
		const generation = ++timelineContextHydrationGeneration;
		reportSelectionGeneration++;
		timelineContextHydrating = true;
		selectedReportCode.value = context.reportCode;
		reportDetails.value = cacheReportDetails(context.reportCode, context.reportDetails);
		selectedFightID.value = context.fightID;
		if (context.dataSnapshot?.reportCode === context.reportCode) {
			mergeTimelineWindowDataSnapshot(context.dataSnapshot);
		}
		await nextTick();
		if (generation === timelineContextHydrationGeneration) timelineContextHydrating = false;
	}

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

	async function requestReports(endTime?: number, force = false): Promise<boolean> {
		reportListRequested = true;
		const isOlderPage = Number.isFinite(endTime);
		const requestKey = isOlderPage ? `older:${endTime}` : 'latest';
		if (
			!isOlderPage
			&& !force
			&& reportListStatus.value === 'ready'
			&& Date.now() - reportListLoadedAt < REPORT_LIST_CACHE_TTL_MS
		) return true;

		const pending = reportListPromises.get(requestKey);
		if (pending) return pending;

		if (isOlderPage) {
			olderReportsLoading.value = true;
			olderReportsError.value = null;
		} else {
			reportListStatus.value = reports.value.length > 0 ? 'refreshing' : 'loading';
			reportListError.value = null;
		}

		const request = (async () => {
			try {
				const response = await ipc.invoke(
					IPC_EVENTS.WCL_REQUEST_REPORTS_LIST,
					{ endTime },
				) as WclRequestResult<reportSummary[]>;
				if (!response || response.success !== true) {
					throw new Error(
						response && 'error' in response
							? response.error
							: 'Failed to request WCL reports',
					);
				}
				if (!Array.isArray(response.data)) {
					throw new Error('WCL reports request returned invalid data');
				}

				const mergedReports = [...reports.value];
				let addedReportCount = 0;
				for (const report of response.data) {
					if (!report || typeof report.code !== 'string') continue;
					const existingIndex = mergedReports.findIndex(item => item.code === report.code);
					if (existingIndex >= 0) mergedReports[existingIndex] = report;
					else {
						mergedReports.push(report);
						addedReportCount++;
					}
				}
				mergedReports.sort((left, right) => right.startTime - left.startTime);
				setReports(mergedReports);
				if (!isOlderPage) {
					reportListLoadedAt = Date.now();
					reportListStatus.value = 'ready';
				} else if (response.data.length === 0 || addedReportCount === 0) hasOlderReports.value = false;
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to request WCL reports';
				if (isOlderPage) olderReportsError.value = message;
				else {
					reportListStatus.value = 'error';
					reportListError.value = message;
				}
				log.error('Failed to request WCL reports', { endTime, error });
				return false;
			} finally {
				if (reportListPromises.get(requestKey) === request) {
					reportListPromises.delete(requestKey);
					if (isOlderPage) olderReportsLoading.value = false;
				}
			}
		})();
		reportListPromises.set(requestKey, request);
		return request;
	}

	async function requestReportData(force = false): Promise<boolean> {
		const reportCode = selectedReportCode.value;
		if (!reportCode) return false;
		const selectionGeneration = reportSelectionGeneration;
		const cached = reportDetailsByCode.value[reportCode] || null;
		if (
			cached
			&& !force
			&& Date.now() - (reportDetailsCachedAt.value[reportCode] || 0) < REPORT_DETAILS_CACHE_TTL_MS
		) {
			reportDetailsStatusByCode.value[reportCode] = 'ready';
			reportDetailsErrorByCode.value[reportCode] = null;
			if (selectedReportCode.value === reportCode) setReportDetails(cached);
			return true;
		}

		let request = reportDataPromises.get(reportCode);
		if (!request) {
			reportDetailsStatusByCode.value[reportCode] = cached ? 'refreshing' : 'loading';
			reportDetailsErrorByCode.value[reportCode] = null;
			request = (async () => {
				try {
					const response = await ipc.invoke(
						IPC_EVENTS.WCL_REQUEST_REPORT_DATA,
						{ reportCode },
					) as WclRequestResult<reportDetails>;
					if (!response || response.success !== true) {
						throw new Error(
							response && 'error' in response
								? response.error
								: 'Failed to request WCL report details',
						);
					}
					const data = response.data;
					if (!data || typeof data !== 'object' || !Array.isArray(data.fights)) {
						throw new Error('WCL report details returned no fight list');
					}
					if (typeof data.code === 'string' && data.code !== reportCode) {
						throw new Error('WCL report details returned a different report');
					}
					return cacheReportDetails(reportCode, data);
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Failed to request WCL report details';
					reportDetailsStatusByCode.value[reportCode] = 'error';
					reportDetailsErrorByCode.value[reportCode] = message;
					log.error('Failed to request WCL report details', { reportCode, error });
					return null;
				} finally {
					if (reportDataPromises.get(reportCode) === request) {
						reportDataPromises.delete(reportCode);
					}
				}
			})();
			reportDataPromises.set(reportCode, request);
		}

		const loadedDetails = await request;
		if (!loadedDetails) return false;
		if (
			selectionGeneration === reportSelectionGeneration
			&& selectedReportCode.value === reportCode
		) setReportDetails(loadedDetails);
		return true;
	}

	async function refreshReportListAfterWclReady() {
		const pendingRequest = reportListPromises.get('latest');
		if (pendingRequest && await pendingRequest) return;
		await requestReports(undefined, true);
	}

	async function refreshSelectedReportAfterWclReady() {
		const reportCode = selectedReportCode.value;
		if (!reportCode) return;
		const pendingRequest = reportDataPromises.get(reportCode);
		if (pendingRequest && await pendingRequest) return;
		if (selectedReportCode.value === reportCode) await requestReportData(true);
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

	watch(selectedReportCode, (newVal, oldVal) => {
		if (timelineContextHydrating) return;
		if (newVal !== oldVal) {
			reportSelectionGeneration++;
			selectedFightID.value = null; // reset selected fight
			reportDetails.value = newVal ? reportDetailsByCode.value[newVal] || null : null;
			if (newVal && !videoList.value.some(v => v.id === selectedVideoInfo.value?.id)) {
				setSelectedVideoInfo(videoList.value[0] || null); // auto-select first video if current selection is not relevant to new report
			}
			log.info('Selected report changed:', newVal);
			if (newVal) void requestReportData();
		}
	}, { flush: 'sync' });

	watch(selectedFightID, (newVal, oldVal) => {
		if (timelineContextHydrating) return;
		if (newVal !== oldVal) {
			void requestFightEvents();
			void requestFightCooldowns();
		}
	});

	ipc.on(IPC_EVENTS.SOCKET_WCL_READY_CALLBACK, () => {
		// A reconnect can mean the server was deployed with a new cooldown catalog,
		// encounter-alert registry, or boss-cast enrichment. Wait until this socket's
		// WCL credentials are restored before invalidating and refreshing; otherwise
		// the first request can fail and leave the old visible fallback in place.
		invalidateFightData();
		if (reportListRequested) void refreshReportListAfterWclReady();
		if (selectedReportCode.value) void refreshSelectedReportAfterWclReady();

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
