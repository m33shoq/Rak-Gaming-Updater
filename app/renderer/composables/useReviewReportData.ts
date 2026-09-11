import log from 'electron-log/renderer';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';

import { IPC_EVENTS } from '@/events';
import type { ReviewTimelineWindowContext, ReviewTimelineWindowDataSnapshot } from '@/timelineWindow';
import type { WclRequestResult } from '@/wclRequests';

const REPORT_LIST_CACHE_TTL_MS = 15 * 1000;
const REPORT_DETAILS_CACHE_TTL_MS = 15 * 1000;

type LoadStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';

type ReviewReportDataOptions = {
	mergeTimelineData: (snapshot: ReviewTimelineWindowDataSnapshot) => void;
	onReportChanged: (reportCode: string | null) => void;
	onFightChanged: (fightID: number | null) => void;
};

export function useReviewReportData(options: ReviewReportDataOptions) {
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

	const getReports = computed(() => reports.value);
	const getSelectedReport = computed(() => (
		selectedReportCode.value
			? reports.value.find(report => report.code === selectedReportCode.value) || null
			: null
	));
	const isReportListLoading = computed(() => (
		reportListStatus.value === 'loading' || reportListStatus.value === 'refreshing'
	));
	const getReportDetails = computed(() => reportDetails.value);
	const getSelectedFight = computed(() => (
		getReportDetails.value?.fights?.find(fight => fight.id === selectedFightID.value) || null
	));
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

	function setReports(newReports: Array<reportSummary>): void {
		reports.value = newReports;
	}

	function setReportDetails(details: reportDetails | null): void {
		reportDetails.value = details;
	}

	function cacheReportDetails(reportCode: string, details: reportDetails): reportDetails {
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

	async function hydrateTimelineWindowContext(context: ReviewTimelineWindowContext): Promise<void> {
		const generation = ++timelineContextHydrationGeneration;
		reportSelectionGeneration++;
		timelineContextHydrating = true;
		selectedReportCode.value = context.reportCode;
		reportDetails.value = cacheReportDetails(context.reportCode, context.reportDetails);
		selectedFightID.value = context.fightID;
		if (context.dataSnapshot?.reportCode === context.reportCode) {
			options.mergeTimelineData(context.dataSnapshot);
		}
		await nextTick();
		if (generation === timelineContextHydrationGeneration) timelineContextHydrating = false;
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

	function refreshAfterWclReady(): void {
		if (reportListRequested) void refreshReportListAfterWclReady();
		if (selectedReportCode.value) void refreshSelectedReportAfterWclReady();
	}


	watch(selectedReportCode, (newValue, oldValue) => {
		if (timelineContextHydrating) return;
		if (newValue !== oldValue) {
			reportSelectionGeneration++;
			selectedFightID.value = null;
			reportDetails.value = newValue ? reportDetailsByCode.value[newValue] || null : null;
			options.onReportChanged(newValue);
			log.info('Selected report changed:', newValue);
			if (newValue) void requestReportData();
		}
	}, { flush: 'sync' });

	watch(selectedFightID, (newValue, oldValue) => {
		if (timelineContextHydrating) return;
		if (newValue !== oldValue) options.onFightChanged(newValue);
	});

	return {
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
		refreshAfterWclReady,
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
	};
}
