import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef, nextTick } from 'vue';
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export const useReviewsStore = defineStore('Reviews', () => {
	const { youtubeVideoInfo, refreshYoutubeVideoInfo } = useYoutubeVideoInfo();
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
		const reports = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_REPORTS_LIST);
		// log.info('Received WCL reports');
		setReports(reports);
	}

	async function requestReportData() {
		const selected = getSelectedReport.value;
		if (!selected) return;
		const reportCode = selected.code;

		const reportData = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_REPORT_DATA, { reportCode });
		// sort fights by start time
		reportData.fights?.sort((a: fightDetails, b: fightDetails) => b.startTime - a.startTime);

		setReportDetails(reportData);
	}

	async function requestFightEvents() {
		const selected = getSelectedReport.value;
		const fightID = getSelectedFight.value?.id;
		if (!selected || !fightID || savedFightEvents.value[fightID]) return;

		const reportCode = selected.code;

		const fightEvents = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_FIGHT_EVENTS, { reportCode, fightID });

		savedFightEvents.value[fightID] = fightEvents;
	}

	const videoList = computed<YouTubeVideo[]>(() => {
		const reportTimeOffset = getReportTimeOffset.value || Date.now();
		log.info('Calculating video list with report time offset:', reportTimeOffset);
		const fightStartTime = reportTimeOffset + (getSelectedFight.value?.startTime || 0);
		const fightEndTime = reportTimeOffset + (getSelectedFight.value?.endTime || 0);

		const videosArray: YouTubeVideo[] = Object.values(youtubeVideoInfo.value.byId || {});

		// if no specific fight selected just check streams that were active when report started
		return videosArray.filter((video) => {
			// If duration is 0, treat as "still live" (endTime = now + 12 hours)
			const videoEnd = video.duration === 0
				? Date.now() + TWELVE_HOURS_MS
				: video.startTime + video.duration;

			// log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(videoEnd).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
			// log.info(video.startTim	e,
			// 	videoEnd,
			// 	fightEndTime,
			// 	fightStartTime,
			// 	(video.startTime <= fightEndTime) && (videoEnd >= fightStartTime),
			// 	video.startTime <= fightEndTime,
			// 	videoEnd >= fightStartTime
			// );
			// Check if video overlaps with fight time
			return !selectedReportCode.value || ((video.startTime <= fightEndTime) && (videoEnd >= fightStartTime));
		}).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
	});

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

		if (selectedReportCode.value && !videoList.value.some(v => v.id === normalizedVideoId)) {
			log.info('Deep linked video is not relevant to currently selected report/fight, clearing selection');
			setSelectedVideoInfo(null);
			selectedFightID.value = null;
			savedFightEvents.value = {};

			if (selectedReportCode.value !== null) {
				selectedReportCode.value = null;
				reportDetails.value = null;
				await nextTick();
			}
		}

		pendingDirectVideoSeekSeconds.value = timestampSeconds;
		setSelectedVideoInfo(targetVideo);
		log.info('Opened video from deep link', { videoId: normalizedVideoId, timestampSeconds });

		return { success: true };
	}

	watch(selectedReportCode, (newVal, oldVal) => {
		if (newVal !== oldVal) {
			selectedFightID.value = null; // reset selected fight
			savedFightEvents.value = {}; // clear cached fight events
			setSelectedVideoInfo(null); // clear selected video
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
		pendingDirectVideoSeekSeconds,
		reports,
		selectedReportCode,
		reportDetails,
		selectedFightID,
		savedFightEvents,
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
		getReportTimeOffset,
		getFightStartTimeOffset,
		getFightStartTime,
		getFightStartRelativeToVideo,
		getFightDuration,

		requestReports,
		requestReportData,
		requestFightEvents,
		openVideoFromDeepLink,
	};
});

