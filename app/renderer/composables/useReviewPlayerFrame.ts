import log from 'electron-log/renderer';
import {
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
	type Ref,
} from 'vue';

import { IPC_EVENTS } from '@/events';
import { useIpcOn } from '@/renderer/composables/useIpcOn';

type ReviewPlayerFrameOptions = {
	container: Readonly<Ref<HTMLElement | null>>;
	playerLoaded: Readonly<Ref<boolean>>;
	hasSelectedVideo: () => boolean;
	closeHotkeyGuide: () => void;
	revealControls: () => void;
};

export function useReviewPlayerFrame(options: ReviewPlayerFrameOptions) {
	const isFullscreen = ref(false);
	let fullscreenToggleInProgress = false;
	let boundsResizeObserver: ResizeObserver | null = null;

	function publishPointerBounds(): void {
		const rect = options.container.value?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, null);
			return;
		}

		ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
		});
	}

	function onPointerEnter(): void {
		publishPointerBounds();
		options.revealControls();
	}

	async function toggleFullscreen(): Promise<void> {
		const fullscreenTarget = options.container.value;
		const enteringFullscreen = !isFullscreen.value;
		if (
			!fullscreenTarget?.isConnected
			|| fullscreenToggleInProgress
			|| (enteringFullscreen && (!options.playerLoaded.value || !options.hasSelectedVideo()))
		) return;

		fullscreenToggleInProgress = true;
		try {
			isFullscreen.value = await ipc.invoke(
				IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET,
				!isFullscreen.value,
			) === true;
		} catch (error) {
			log.warn('Failed to toggle YouTube player fullscreen', error);
		} finally {
			fullscreenToggleInProgress = false;
		}
	}

	function requestFullscreenToggle(): void {
		if (fullscreenToggleInProgress) return;
		options.closeHotkeyGuide();
		void toggleFullscreen();
	}

	useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_ACTIVITY_CALLBACK, () => {
		options.revealControls();
	});

	useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_CHANGED, (_event, fullscreen: boolean) => {
		isFullscreen.value = fullscreen === true;
		options.closeHotkeyGuide();
		options.revealControls();
		void nextTick(publishPointerBounds);
	});

	watch(options.container, container => {
		boundsResizeObserver?.disconnect();
		boundsResizeObserver = null;
		if (!container) {
			publishPointerBounds();
			return;
		}

		boundsResizeObserver = new ResizeObserver(publishPointerBounds);
		boundsResizeObserver.observe(container);
		void nextTick(publishPointerBounds);
	});

	onMounted(async () => {
		window.addEventListener('resize', publishPointerBounds);
		try {
			isFullscreen.value = await ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_STATUS_GET) === true;
		} catch (error) {
			log.warn('Failed to load YouTube player fullscreen state', error);
		}
	});

	onBeforeUnmount(() => {
		window.removeEventListener('resize', publishPointerBounds);
		boundsResizeObserver?.disconnect();
		boundsResizeObserver = null;
		ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, null);
		isFullscreen.value = false;
		void ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET, false).catch((error) => {
			log.warn('Failed to leave YouTube player fullscreen while closing Reviews', error);
		});
	});

	return {
		isFullscreen,
		onPointerEnter,
		requestFullscreenToggle,
	};
}
