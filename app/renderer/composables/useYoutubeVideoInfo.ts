import { ref, onMounted } from 'vue';
import { useIpcRendererOn } from '@vueuse/electron'
import { IPC_EVENTS } from '@/events';

export function useYoutubeVideoInfo() {
	const youtubeVideoInfo = ref<any>({byId: {}});

	useIpcRendererOn(ipc, IPC_EVENTS.YOUTUBE_VIDEO_INFO_UPDATED, async (event) => {
		const videoInfo = await ipc.invoke(IPC_EVENTS.YOUTUBE_VIDEO_INFO_GET);

		youtubeVideoInfo.value = videoInfo;
	});

	onMounted(async () => {
		const videoInfo = await ipc.invoke(IPC_EVENTS.YOUTUBE_VIDEO_INFO_GET);

		youtubeVideoInfo.value = videoInfo;
	});

	return {
		youtubeVideoInfo,
	};
}
