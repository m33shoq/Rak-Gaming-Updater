<script setup lang="ts">
import log from 'electron-log/renderer';
import { onBeforeUnmount, ref, watch } from 'vue';
import { IPC_EVENTS } from '@/events';
import UIButton from '@/renderer/components/Button.vue';
import Input from '@/renderer/components/Input.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import { useLoginStore } from '@/renderer/store/LoginStore';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';

const emit = defineEmits<{
	openStream: [video: YouTubeVideo];
}>();

const reviewsStore = useReviewsStore();
const loginStore = useLoginStore();
const youtubeLink = ref('');
const status = ref('');
let statusResetTimeout: number | null = null;

watch(status, newStatus => {
	if (statusResetTimeout !== null) window.clearTimeout(statusResetTimeout);
	statusResetTimeout = null;
	if (!newStatus) return;
	statusResetTimeout = window.setTimeout(() => {
		statusResetTimeout = null;
		status.value = '';
	}, 5000);
});

onBeforeUnmount(() => {
	if (statusResetTimeout !== null) window.clearTimeout(statusResetTimeout);
});

async function addVideo(): Promise<void> {
	const url = youtubeLink.value;
	youtubeLink.value = '';
	status.value = 'Requesting...';
	try {
		const response = await ipc.invoke(IPC_EVENTS.YOUTUBE_VIDEO_INFO_ADD, url);
		status.value = response.success
			? 'Video added successfully!'
			: response.error || 'Failed to add video.';
	} catch (error) {
		status.value = error instanceof Error ? error.message : 'Failed to add video.';
		log.error('Failed to add YouTube video', error);
	}
}

function refreshVideo(videoId: string): void {
	ipc.send(IPC_EVENTS.YOUTUBE_VIDEO_REFRESH, videoId);
}

function deleteVideo(videoId: string): void {
	ipc.send(IPC_EVENTS.YOUTUBE_VIDEO_DELETE, videoId);
}
</script>

<template>
	<div class="max-w-full w-full">
		<div class="h-[70px]">
			<div class="flex items-center mt-1">
				<Input
					v-model="youtubeLink"
					class="flex-10 h-8"
					:placeholder="$t('reviews.add_youtube_stream')"
				/>
				<UIButton class="flex-1 mr-1 h-8" label="" @click="addVideo">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
						<path
							fill-rule="evenodd"
							d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z"
							clip-rule="evenodd"
							stroke="currentColor"
							stroke-width="2"
						/>
					</svg>
				</UIButton>
			</div>
			{{ status }}
		</div>

		<ScrollFrame class="max-h-[calc(100%-85px)]">
			<div
				v-for="video in reviewsStore.videoList"
				:key="video.id"
				class="flex min-h-fit items-center"
			>
				<button
					class="min-h-8 m-0.5 rounded-md flex-1 cursor-pointer disabled:cursor-auto"
					:disabled="video.id === reviewsStore.getSelectedVideoId"
					:class="{
						'border-1 border-secondary dark:bg-dark1 bg-light1': video.id === reviewsStore.getSelectedVideoId,
						'dark:bg-dark4 dark:hover:bg-dark3 bg-light4 hover:bg-light3': video.id !== reviewsStore.getSelectedVideoId,
					}"
					@click="reviewsStore.setSelectedVideoInfo(video)"
				>
					<div class="text-bold max-w-fit min-h-fit break-keep text-left px-2">
						{{ video.author }} - {{ new Date(video.startTime).toLocaleString() }}
						<span v-if="video.duration === 0" class="text-red-500"> (LIVE)</span>
					</div>
				</button>
				<button
					class="flex-none hover:text-yellow-200 cursor-pointer"
					title="Open stream on YouTube at the current playback time"
					:aria-label="`Open ${video.author}'s stream on YouTube at the current playback time`"
					@click="emit('openStream', video)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
						<path d="M21.721 12.752a9.711 9.711 0 0 0-.945-5.003 12.754 12.754 0 0 1-4.339 2.708 18.991 18.991 0 0 1-.214 4.772 17.165 17.165 0 0 0 5.498-2.477ZM14.634 15.55a17.324 17.324 0 0 0 .332-4.647c-.952.227-1.945.347-2.966.347-1.021 0-2.014-.12-2.966-.347a17.515 17.515 0 0 0 .332 4.647 17.385 17.385 0 0 0 5.268 0ZM9.772 17.119a18.963 18.963 0 0 0 4.456 0A17.182 17.182 0 0 1 12 21.724a17.18 17.18 0 0 1-2.228-4.605ZM7.777 15.23a18.87 18.87 0 0 1-.214-4.774 12.753 12.753 0 0 1-4.34-2.708 9.711 9.711 0 0 0-.944 5.004 17.165 17.165 0 0 0 5.498 2.477ZM21.356 14.752a9.765 9.765 0 0 1-7.478 6.817 18.64 18.64 0 0 0 1.988-4.718 18.627 18.627 0 0 0 5.49-2.098ZM2.644 14.752c1.682.971 3.53 1.688 5.49 2.099a18.64 18.64 0 0 0 1.988 4.718 9.765 9.765 0 0 1-7.478-6.816ZM13.878 2.43a9.755 9.755 0 0 1 6.116 3.986 11.267 11.267 0 0 1-3.746 2.504 18.63 18.63 0 0 0-2.37-6.49ZM12 2.276a17.152 17.152 0 0 1 2.805 7.121c-.897.23-1.837.353-2.805.353-.968 0-1.908-.122-2.805-.353A17.151 17.151 0 0 1 12 2.276ZM10.122 2.43a18.629 18.629 0 0 0-2.37 6.49 11.266 11.266 0 0 1-3.746-2.504 9.754 9.754 0 0 1 6.116-3.985Z" />
					</svg>
				</button>
				<button
					v-if="loginStore.isAdmin && video.duration === 0"
					class="flex-none hover:text-yellow-200 cursor-pointer"
					@click="refreshVideo(video.id)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
						<path
							fill-rule="evenodd"
							d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z"
							clip-rule="evenodd"
							stroke="currentColor"
							stroke-width="1"
						/>
					</svg>
				</button>
				<button
					v-if="loginStore.isAdmin"
					class="flex-none hover:text-red-600 cursor-pointer"
					@click="deleteVideo(video.id)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
						<path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" />
					</svg>
				</button>
			</div>
		</ScrollFrame>
	</div>
</template>
