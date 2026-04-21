import { ref } from 'vue';
import { IPC_EVENTS } from '@/events';

const youtubeVideoInfo = ref<any>({ byId: {} });
let isYoutubeVideoInfoInitialized = false;

const refreshYoutubeVideoInfo = async () => {
	const videoInfo = await ipc.invoke(IPC_EVENTS.YOUTUBE_VIDEO_INFO_GET);
	youtubeVideoInfo.value = videoInfo;
	return videoInfo;
};

export function useYoutubeVideoInfo() {
	if (!isYoutubeVideoInfoInitialized) {
		isYoutubeVideoInfoInitialized = true;
		ipc.on(IPC_EVENTS.YOUTUBE_VIDEO_INFO_UPDATED, async () => {
			await refreshYoutubeVideoInfo();
		});
		void refreshYoutubeVideoInfo();
	}

	return {
		youtubeVideoInfo,
		refreshYoutubeVideoInfo,
	};
}
