import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef } from 'vue';
import log from 'electron-log/renderer';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

export const useReviewsStore = defineStore('Reviews', () => {
	const youtubeVideoInfo = getElectronStoreRef<{ byId: Record<string, YouTubeVideo> }>('youtubeVideoInfo', { byId: {} });
	const selectedVideoInfo = ref<YouTubeVideo | null>(null);
	function setSelectedVideoInfo(video: YouTubeVideo | null) {
		selectedVideoInfo.value = video;
	}

	const reports = shallowRef<Array<reportSummary>>([]);
	const selectedReportCode = ref<string | null>(null);
	const reportDetails = ref<reportDetails | null>(null);
	const selectedFightID = ref<number | null>(null);
	const savedFightEvents = ref<{ [key: number]: fightEvent[] }>({}); // fightID -> events

	const getSelectedVideoId = computed(() => selectedVideoInfo.value?.id || null);

	const getReports = computed(() => reports.value);
	function setReports(newReports: Array<reportSummary>) {
		reports.value = newReports;
	}
	const getSelectedReport = computed(() => selectedReportCode.value ? reports.value.find(r => r.code === selectedReportCode.value) || null : null);

	const getReportDetails = computed(() => reportDetails.value);
	function setReportDetails(details: reportDetails | null) {
		reportDetails.value = details;
	}

	const getSelectedFight = computed(() => getReportDetails.value?.fights?.find(f => f.id === selectedFightID.value) || null);

	const getFightEvents = computed(() => {
		const fightID = selectedFightID.value;
		if (fightID && savedFightEvents.value[fightID]) {
			return savedFightEvents.value[fightID];
		}
		return [];
	});

	const getReportTimeOffset = computed(() => {
		const selected = getSelectedReport.value;
		if (!selected) return 0;
		return selected.startTime;
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

	async function requestReports() {
		// log.info('Requesting WCL reports');
		const reports = await api.IR_requestWCLReports();
		// log.info('Received WCL reports');
		setReports(reports);
	}

	async function requestReportData() {
		const selected = getSelectedReport.value;
		if (!selected) return;
		const reportCode = selected.code;

		const reportData = await api.IR_requestWCLReportData(reportCode);
		// sort fights by start time
		reportData.fights?.sort((a: fightDetails, b: fightDetails) => b.startTime - a.startTime);

		setReportDetails(reportData);
	}

	async function requestFightEvents() {
		const selected = getSelectedReport.value;
		const fightID = getSelectedFight.value?.id;
		if (!selected || !fightID || savedFightEvents.value[fightID]) return;

		const reportCode = selected.code;

		const fightEvents = await api.IR_requestWCLFightEvents(reportCode, fightID);

		savedFightEvents.value[fightID] = fightEvents;
	}

	watch(selectedReportCode, (newVal, oldVal) => {
		if (newVal !== oldVal) {
			selectedFightID.value = null; // reset selected fight
			savedFightEvents.value = {}; // clear cached fight events
			selectedVideoInfo.value = null; // clear selected video
			log.info('Selected report changed:', newVal);
			requestReportData();
		}
	});

	watch(selectedFightID, (newVal, oldVal) => {
		if (newVal !== oldVal) {
			requestFightEvents();
		}
	});

	return {
		youtubeVideoInfo,
		selectedVideoInfo,
		reports,
		selectedReportCode,
		reportDetails,
		selectedFightID,
		savedFightEvents,

		getReports,
		setReports,

		getSelectedVideoId,
		setSelectedVideoInfo,
		getSelectedReport,
		getReportDetails,
		setReportDetails,
		getSelectedFight,
		getFightEvents,
		getReportTimeOffset,
		getFightStartTimeOffset,
		getFightStartTime,
		getFightStartRelativeToVideo,
		getFightDuration,

		requestReports,
		requestReportData,
		requestFightEvents,
	};
});

