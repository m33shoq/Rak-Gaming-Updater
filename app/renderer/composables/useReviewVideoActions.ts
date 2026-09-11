import log from 'electron-log/renderer';
import { computed, onBeforeUnmount, ref, type Ref } from 'vue';

import { IPC_EVENTS } from '@/events';
import type YTPlayer from '@/renderer/yt-player';

type ReviewVideoActionsOptions = {
	player: Ref<YTPlayer | null>;
	playerLoaded: Readonly<Ref<boolean>>;
	currentVideoTime: Readonly<Ref<number>>;
	getSelectedVideo: () => YouTubeVideo | null | undefined;
	getSelectedVideoID: () => string | null | undefined;
};

export function useReviewVideoActions(options: ReviewVideoActionsOptions) {
	const copyReviewLinkStatus = ref('');
	const isCopyReviewLinkHovered = ref(false);
	let copyReviewLinkResetTimeout: number | null = null;

	const copyReviewLinkTooltip = computed(() => {
		if (copyReviewLinkStatus.value) return copyReviewLinkStatus.value;
		if (isCopyReviewLinkHovered.value && options.getSelectedVideoID()) {
			return 'Copy review link with timestamp';
		}
		return '';
	});

	function resetCopyReviewLinkStatus(): void {
		if (copyReviewLinkResetTimeout !== null) {
			window.clearTimeout(copyReviewLinkResetTimeout);
			copyReviewLinkResetTimeout = null;
		}
		copyReviewLinkStatus.value = '';
	}

	async function copyReviewLink(event?: MouseEvent): Promise<void> {
		(event?.currentTarget as HTMLButtonElement | null)?.blur();

		const videoId = options.getSelectedVideoID();
		if (!videoId) {
			copyReviewLinkStatus.value = 'No video selected';
			return;
		}

		const timestampSeconds = Math.max(0, Math.floor(options.currentVideoTime.value || 0));
		const reviewUrl = `https://rak-gaming-updater.org/api/updater/open/reviews?videoId=${encodeURIComponent(videoId)}&t=${timestampSeconds}`;

		try {
			await navigator.clipboard.writeText(reviewUrl);
			copyReviewLinkStatus.value = 'Copied';
			log.info('Copied review link', { reviewUrl });
		} catch (error) {
			copyReviewLinkStatus.value = 'Copy failed';
			log.error('Failed to copy review link', error);
		}

		if (copyReviewLinkResetTimeout !== null) {
			window.clearTimeout(copyReviewLinkResetTimeout);
		}
		copyReviewLinkResetTimeout = window.setTimeout(() => {
			copyReviewLinkStatus.value = '';
			copyReviewLinkResetTimeout = null;
		}, 2000);
	}

	function openYoutubeLink(videoId: string, timestampSeconds?: number): void {
		ipc.send(IPC_EVENTS.YOUTUBE_OPEN_LINK, videoId, timestampSeconds);
	}

	function getCurrentStreamTimestamp(video: YouTubeVideo): number | undefined {
		if (!options.player.value || !options.playerLoaded.value) return undefined;
		const currentTime = options.player.value.getCurrentTime();
		if (!Number.isFinite(currentTime) || currentTime < 0) return undefined;

		const selectedVideo = options.getSelectedVideo();
		if (!selectedVideo || selectedVideo.id === video.id) return currentTime;

		const currentPlaybackTime = selectedVideo.startTime + currentTime * 1000;
		return Math.max(0, (currentPlaybackTime - video.startTime) / 1000);
	}

	function openStreamInBrowser(video: YouTubeVideo): void {
		openYoutubeLink(video.id, getCurrentStreamTimestamp(video));
	}

	function openSelectedYoutubeVideo(event: MouseEvent): void {
		if (event.detail > 1) return;
		const selectedVideo = options.getSelectedVideo();
		if (selectedVideo) openStreamInBrowser(selectedVideo);
	}

	onBeforeUnmount(resetCopyReviewLinkStatus);

	return {
		copyReviewLink,
		copyReviewLinkTooltip,
		isCopyReviewLinkHovered,
		openSelectedYoutubeVideo,
		openStreamInBrowser,
	};
}
