import log from 'electron-log/renderer';
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue';

import type { ReviewReportListItem } from '@/reviewReports';
import { reconcileReviewVideoSelection, reviewVideoOverlapsWindow } from '@/reviewVideoSelection';

type YoutubeVideoInfo = {
	byId?: Record<string, YouTubeVideo>;
};

type ReviewVideoSelectionOptions = {
	youtubeVideoInfo: Ref<YoutubeVideoInfo>;
	refreshYoutubeVideoInfo: () => Promise<unknown>;
	selectedReportCode: Ref<string | null>;
	selectedReport: ComputedRef<ReviewReportListItem | null>;
	reportDetails: Ref<reportDetails | null>;
	selectedFightID: Ref<number | null>;
	selectedFight: ComputedRef<fightDetails | null>;
};

export function useReviewVideoSelection(options: ReviewVideoSelectionOptions) {
	const selectedVideoInfo = ref<YouTubeVideo | null>(null);
	const pendingDirectVideoSeekSeconds = ref<number | null>(null);

	const getSelectedVideoId = computed(() => selectedVideoInfo.value?.id || null);

	function setSelectedVideoInfo(video: YouTubeVideo | null): void {
		selectedVideoInfo.value = video;
	}

	function consumePendingDirectVideoSeekSeconds(): number | null {
		const value = pendingDirectVideoSeekSeconds.value;
		pendingDirectVideoSeekSeconds.value = null;
		return value;
	}

	function getSelectedFightAbsoluteWindow(): { start: number; end: number } | null {
		const reportStart = options.selectedReport.value?.startTime ?? options.reportDetails.value?.startTime;
		const fight = options.selectedFight.value;
		if (!Number.isFinite(reportStart) || !fight) return null;
		return {
			start: reportStart! + fight.startTime,
			end: reportStart! + fight.endTime,
		};
	}

	const reportVideoList = computed<YouTubeVideo[]>(() => {
		const selectedReport = options.selectedReport.value;
		const reportStart = selectedReport?.startTime ?? options.reportDetails.value?.startTime;
		const reportEnd = selectedReport?.endTime ?? options.reportDetails.value?.endTime;
		const now = Date.now();
		const videos = Object.values(options.youtubeVideoInfo.value.byId || {});

		return videos.filter(video => (
			!options.selectedReportCode.value
			|| !Number.isFinite(reportStart)
			|| !Number.isFinite(reportEnd)
			|| reviewVideoOverlapsWindow(video, reportStart!, reportEnd!, now)
		)).sort((left, right) => (right.startTime || 0) - (left.startTime || 0));
	});

	const videoList = computed<YouTubeVideo[]>(() => {
		const fightWindow = getSelectedFightAbsoluteWindow();
		if (!fightWindow) return reportVideoList.value;

		const now = Date.now();
		return reportVideoList.value.filter(video => (
			reviewVideoOverlapsWindow(video, fightWindow.start, fightWindow.end, now)
		));
	});

	function ensureSelectedVideoIsAvailable(reportCode: string | null): void {
		const nextSelection = reconcileReviewVideoSelection(
			selectedVideoInfo.value,
			videoList.value,
			Boolean(reportCode),
		);
		if (nextSelection !== selectedVideoInfo.value) setSelectedVideoInfo(nextSelection);
	}

	watch(videoList, () => {
		ensureSelectedVideoIsAvailable(options.selectedReportCode.value);
	}, { flush: 'sync' });

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

		await options.refreshYoutubeVideoInfo();

		const targetVideo = options.youtubeVideoInfo.value.byId?.[normalizedVideoId] ?? null;
		if (!targetVideo) {
			return { success: false, error: `Video ${normalizedVideoId} was not found.` };
		}

		if (options.selectedReportCode.value && !videoMatchesCurrentSelection(targetVideo)) {
			log.info('Deep linked video is not relevant to currently selected report/fight, clearing selection');
			options.selectedFightID.value = null;

			if (options.selectedReportCode.value !== null) {
				options.selectedReportCode.value = null;
				options.reportDetails.value = null;
				await nextTick();
			}
		}

		setSelectedVideoInfo(targetVideo);
		pendingDirectVideoSeekSeconds.value = timestampSeconds;
		log.info('Opened video from deep link', { videoId: normalizedVideoId, timestampSeconds });

		return { success: true };
	}

	return {
		consumePendingDirectVideoSeekSeconds,
		ensureSelectedVideoIsAvailable,
		getSelectedVideoId,
		openVideoFromDeepLink,
		pendingDirectVideoSeekSeconds,
		selectedVideoInfo,
		setSelectedVideoInfo,
		videoList,
	};
}
