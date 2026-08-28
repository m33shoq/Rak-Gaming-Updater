<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';
import type { ReviewTimelineWindowAction, ReviewTimelineWindowContext } from '@/timelineWindow';

import { ref, computed, watch, onMounted, onBeforeUnmount, useTemplateRef, nextTick } from 'vue';
import { useIpcOn } from '@/renderer/composables/useIpcOn';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import Input from '@/renderer/components/Input.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import ReviewCooldownTimeline from '@/renderer/components/ReviewCooldownTimeline.vue';

import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import { useLoginStore } from '@/renderer/store/LoginStore';

import { useYoutubeVideoInfo } from '@/renderer/composables/useYoutubeVideoInfo';

import YTPlayer from '@/renderer/yt-player';

// format seconds to mm:ss
function formatTime(t) {
	const hours = Math.floor(t / 3600);
	const minutes = Math.floor((t % 3600) / 60);
	const seconds = Math.floor(t % 60);
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const WCL_DIFFICULTY_NAMES: Readonly<Record<number, string>> = {
	1: 'LFR',
	2: 'Flex',
	3: 'Normal',
	4: 'Heroic',
	5: 'Mythic',
	10: 'Mythic+',
};

function formatWclDifficultyLabel(difficulty: number | null | undefined) {
	if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) return '';
	const difficultyName = WCL_DIFFICULTY_NAMES[difficulty];
	return difficultyName ? difficultyName.charAt(0) : `[${difficulty}]`;
}

const reviewsStore = useReviewsStore();
const loginStore = useLoginStore();

const isWclAuthorized = ref(false);
let initialReportsRequested = false;
let wclAuthorizationStatusRevision = 0;

function applyWclAuthorizationStatus(authorized: unknown) {
	isWclAuthorized.value = authorized === true;
	if (!isWclAuthorized.value) {
		initialReportsRequested = false;
		return;
	}
	if (initialReportsRequested) return;
	initialReportsRequested = true;
	void reviewsStore.requestReports();
}

useIpcOn(IPC_EVENTS.WCL_AUTH_STATUS_UPDATED, (_event, authorized: boolean) => {
	wclAuthorizationStatusRevision++;
	applyWclAuthorizationStatus(authorized);
});

const youtubeLink = ref('')
const youtubeLinkStatus = ref('')
let playerLoaded = false;

let youtubeLinkStatusResetTimeout = null as number | null;
watch(youtubeLinkStatus, (newVal) => {
	if (youtubeLinkStatusResetTimeout) clearTimeout(youtubeLinkStatusResetTimeout);
	if (newVal) {
		youtubeLinkStatusResetTimeout = window.setTimeout(() => {
			youtubeLinkStatus.value = '';
		}, 5000);
	}
});

async function requestVideoInfo() {
	const url = youtubeLink.value
	youtubeLink.value = ''

	youtubeLinkStatus.value = 'Requesting...'
	const response = await ipc.invoke(IPC_EVENTS.YOUTUBE_VIDEO_INFO_ADD, url);
	if (response.success) {
		youtubeLinkStatus.value = 'Video added successfully!'
	} else {
		youtubeLinkStatus.value = response.error || 'Failed to add video.'
	}
}

const player = ref<YTPlayer | null>(null);
const playerIframe = useTemplateRef<HTMLIFrameElement | null>('playerIframe');
const videoContainer = useTemplateRef<HTMLElement | null>('videoContainer');
const hotkeyGuide = useTemplateRef<HTMLElement | null>('hotkeyGuide');
const hotkeyGuideButton = useTemplateRef<HTMLButtonElement | null>('hotkeyGuideButton');
const isPlayerFullscreen = ref(false);
const isHotkeyGuideOpen = ref(false);
const arePlayerControlsVisible = ref(true);
const isPlayerPlaying = ref(false);
const isPlayerControlDockHovered = ref(false);
const isPlayerControlDockFocused = ref(false);
const queuedSeekDeltaSeconds = ref<number | null>(null);

const DEFAULT_SEEK_SECONDS = 5;
const SHIFT_SEEK_SECONDS = 3;
const ALT_SEEK_SECONDS = 1;
const CTRL_SEEK_SECONDS = 60;
const TEN_SECOND_SEEK_SECONDS = 10;
const FRAME_SEEK_SECONDS = 1 / 30;
const PLAYER_CONTROLS_IDLE_MS = 2200;
const HOTKEY_SEEK_DEBOUNCE_MS = 80;
const HOTKEY_SEEK_RETRY_MS = 1200;
const HOTKEY_SEEK_MAX_PENDING_MS = 30_000;
const HOTKEY_SEEK_TARGET_EPSILON_SECONDS = 0.001;
const HOTKEY_SEEK_INDICATOR_MIN_VISIBLE_MS = 500;
const HOTKEY_SEEK_HOLD_INITIAL_INTERVAL_MS = 350;
const HOTKEY_SEEK_HOLD_FASTEST_INTERVAL_MS = 60;
const HOTKEY_SEEK_HOLD_ACCELERATION_MS = 3500;

const PLAYER_SHORTCUTS = [
	{ keys: 'Space / K', action: 'Play or pause' },
	{ keys: 'M', action: 'Mute or unmute' },
	{ keys: 'F', action: 'Enter or exit fullscreen' },
	{ keys: '← / →', action: 'Seek 5 seconds' },
	{ keys: 'Alt + ← / →', action: 'Seek 1 second' },
	{ keys: 'Shift + ← / →', action: 'Seek 3 seconds' },
	{ keys: 'Ctrl/Cmd + ← / →', action: 'Seek 60 seconds' },
	{ keys: 'J / L', action: 'Seek 10 seconds' },
	{ keys: ', / .', action: 'Previous or next frame' },
	{ keys: 'Double-click', action: 'Enter or exit fullscreen' },
];

type PlayerHotkeyPayload = {
	key: string;
	code: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	repeat: boolean;
	shiftKey: boolean;
};

type PlayerMouseDownPayload = {
	clickCount: number;
};

let fullscreenToggleInProgress = false;
let playerControlsHideTimeout: number | null = null;
let playerBoundsResizeObserver: ResizeObserver | null = null;
let hotkeySeekDispatchTimeout: number | null = null;
let hotkeySeekRetryTimeout: number | null = null;
let hotkeySeekIndicatorHideTimeout: number | null = null;
let hotkeySeekIndicatorUpdatedAt = 0;
let hotkeySeekIndicatorCommittedDeltaSeconds = 0;
let hotkeySeekHoldState: {
	signature: string;
	startedAt: number;
	lastAcceptedAt: number;
} | null = null;
let hotkeySeekState: {
	originSeconds: number;
	targetSeconds: number;
	dispatchedFromSeconds: number | null;
	dispatchedTargetSeconds: number | null;
	lastInputAt: number;
} | null = null;

const queuedSeekDeltaLabel = computed(() => {
	const delta = queuedSeekDeltaSeconds.value;
	if (delta === null) return '';
	const absoluteDelta = Math.abs(delta);
	const precision = absoluteDelta > 0 && absoluteDelta < 0.1
		? 2
		: Number.isInteger(absoluteDelta) ? 0 : 1;
	const sign = delta > HOTKEY_SEEK_TARGET_EPSILON_SECONDS
		? '+'
		: delta < -HOTKEY_SEEK_TARGET_EPSILON_SECONDS ? '-' : '';
	if (absoluteDelta >= 60) return `${sign}${formatTime(Math.round(absoluteDelta))}`;
	return `${sign}${absoluteDelta.toFixed(precision)}s`;
});
const queuedSeekDirectionClass = computed(() => {
	const delta = queuedSeekDeltaSeconds.value;
	if (delta !== null && delta < -HOTKEY_SEEK_TARGET_EPSILON_SECONDS) {
		return 'youtube-player-seek-queue--backward';
	}
	if (delta !== null && delta > HOTKEY_SEEK_TARGET_EPSILON_SECONDS) {
		return 'youtube-player-seek-queue--forward';
	}
	return 'youtube-player-seek-queue--neutral';
});

function publishPlayerPointerBounds() {
	const rect = videoContainer.value?.getBoundingClientRect();
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

function onPlayerPointerEnter() {
	publishPlayerPointerBounds();
	revealPlayerControls();
}

function clearPlayerControlsHideTimeout() {
	if (playerControlsHideTimeout === null) return;
	window.clearTimeout(playerControlsHideTimeout);
	playerControlsHideTimeout = null;
}

function revealPlayerControls() {
	clearPlayerControlsHideTimeout();
	arePlayerControlsVisible.value = true;
	if (
		!isPlayerPlaying.value
		|| isHotkeyGuideOpen.value
		|| isPlayerControlDockHovered.value
		|| isPlayerControlDockFocused.value
	) return;

	playerControlsHideTimeout = window.setTimeout(() => {
		playerControlsHideTimeout = null;
		if (
			!isHotkeyGuideOpen.value
			&& !isPlayerControlDockHovered.value
			&& !isPlayerControlDockFocused.value
		) arePlayerControlsVisible.value = false;
	}, PLAYER_CONTROLS_IDLE_MS);
}

function keepPlayerControlsVisible() {
	clearPlayerControlsHideTimeout();
	arePlayerControlsVisible.value = true;
}

function onPlayerControlDockPointerEnter() {
	isPlayerControlDockHovered.value = true;
	keepPlayerControlsVisible();
}

function onPlayerControlDockPointerLeave() {
	isPlayerControlDockHovered.value = false;
	revealPlayerControls();
}

function onPlayerControlDockFocusIn() {
	isPlayerControlDockFocused.value = true;
	keepPlayerControlsVisible();
}

function onPlayerControlDockFocusOut(event: FocusEvent) {
	const nextTarget = event.relatedTarget;
	if (nextTarget instanceof Node && (event.currentTarget as HTMLElement).contains(nextTarget)) return;

	isPlayerControlDockFocused.value = false;
	revealPlayerControls();
}

function playVideo() {
	if (player.value) {
		player.value.play();
	}
}

function pauseVideo() {
	if (player.value) {
		player.value.pause();
	}
}

function performSeek(seconds: number) {
	player.value?.seek(seconds);
}

function clearHotkeySeekTimeouts() {
	if (hotkeySeekDispatchTimeout !== null) {
		window.clearTimeout(hotkeySeekDispatchTimeout);
		hotkeySeekDispatchTimeout = null;
	}
	if (hotkeySeekRetryTimeout !== null) {
		window.clearTimeout(hotkeySeekRetryTimeout);
		hotkeySeekRetryTimeout = null;
	}
}

function hideQueuedSeekIndicator() {
	if (hotkeySeekIndicatorHideTimeout !== null) {
		window.clearTimeout(hotkeySeekIndicatorHideTimeout);
		hotkeySeekIndicatorHideTimeout = null;
	}
	queuedSeekDeltaSeconds.value = null;
	hotkeySeekIndicatorCommittedDeltaSeconds = 0;
}

function showQueuedSeekIndicator(deltaSeconds: number) {
	if (hotkeySeekIndicatorHideTimeout !== null) {
		window.clearTimeout(hotkeySeekIndicatorHideTimeout);
		hotkeySeekIndicatorHideTimeout = null;
	}
	hotkeySeekIndicatorUpdatedAt = performance.now();
	queuedSeekDeltaSeconds.value = deltaSeconds;
}

function finishQueuedHotkeySeek() {
	const completedState = hotkeySeekState;
	if (completedState) {
		hotkeySeekIndicatorCommittedDeltaSeconds += completedState.targetSeconds - completedState.originSeconds;
	}
	clearHotkeySeekTimeouts();
	hotkeySeekState = null;
	const remainingVisibleMs = HOTKEY_SEEK_INDICATOR_MIN_VISIBLE_MS
		- (performance.now() - hotkeySeekIndicatorUpdatedAt);
	if (remainingVisibleMs <= 0) {
		hideQueuedSeekIndicator();
		return;
	}
	hotkeySeekIndicatorHideTimeout = window.setTimeout(() => {
		hotkeySeekIndicatorHideTimeout = null;
		hideQueuedSeekIndicator();
	}, remainingVisibleMs);
}

function clearQueuedHotkeySeek() {
	clearHotkeySeekTimeouts();
	hotkeySeekState = null;
	hotkeySeekHoldState = null;
	hideQueuedSeekIndicator();
}

function seekTo(seconds: number) {
	clearQueuedHotkeySeek();
	performSeek(seconds);
}

function togglePlayPause() {
	if (!player.value) return;

	const state = player.value.getState();
	if (state === 'playing' || state === 'buffering') {
		pauseVideo();
		return;
	}

	playVideo();
}

function toggleMute() {
	if (!player.value) return;

	if (player.value.isMuted()) {
		player.value.unMute();
		return;
	}

	player.value.mute();
}

async function toggleFullscreen() {
	const fullscreenTarget = videoContainer.value;
	const enteringFullscreen = !isPlayerFullscreen.value;
	if (
		!fullscreenTarget?.isConnected
		|| fullscreenToggleInProgress
		|| (enteringFullscreen && (!playerLoaded || !reviewsStore.getSelectedVideoId))
	) return;

	fullscreenToggleInProgress = true;
	try {
		isPlayerFullscreen.value = await ipc.invoke(
			IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET,
			!isPlayerFullscreen.value,
		) === true;
	} catch (error) {
		log.warn('Failed to toggle YouTube player fullscreen', error);
	} finally {
		fullscreenToggleInProgress = false;
	}
}

function isPlayerHotkeyExcludedTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;

	return Boolean(target.closest([
		'input',
		'textarea',
		'select',
		'button',
		'a[href]',
		'summary',
		'[contenteditable="true"]',
		'[role="button"]',
		'[role="menuitem"]',
		'[role="option"]',
		'[role="slider"]',
	].join(', ')));
}

function getArrowSeekDelta(input: Pick<PlayerHotkeyPayload, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
	if (input.ctrlKey || input.metaKey) return CTRL_SEEK_SECONDS;
	if (input.shiftKey) return SHIFT_SEEK_SECONDS;
	if (input.altKey) return ALT_SEEK_SECONDS;
	return DEFAULT_SEEK_SECONDS;
}

function clampSeekTarget(seconds: number) {
	const duration = player.value?.getDuration() || 0;
	return Math.max(0, Math.min(seconds, duration > 0 ? duration : Number.POSITIVE_INFINITY));
}

function getSeekConfirmationTolerance(fromSeconds: number, targetSeconds: number) {
	return Math.min(0.35, Math.max(0.012, Math.abs(targetSeconds - fromSeconds) * 0.15));
}

function isDispatchedHotkeySeekComplete(currentTime: number) {
	const state = hotkeySeekState;
	if (
		!state
		|| state.dispatchedFromSeconds === null
		|| state.dispatchedTargetSeconds === null
	) return false;

	const fromSeconds = state.dispatchedFromSeconds;
	const targetSeconds = state.dispatchedTargetSeconds;
	const tolerance = getSeekConfirmationTolerance(fromSeconds, targetSeconds);
	if (targetSeconds > fromSeconds) return currentTime >= targetSeconds - tolerance;
	if (targetSeconds < fromSeconds) return currentTime <= targetSeconds + tolerance;
	return Math.abs(currentTime - targetSeconds) <= tolerance;
}

function dispatchQueuedHotkeySeek() {
	const state = hotkeySeekState;
	if (!state || !player.value || !reviewsStore.getSelectedVideoId) {
		clearQueuedHotkeySeek();
		return;
	}

	clearHotkeySeekTimeouts();
	state.targetSeconds = clampSeekTarget(state.targetSeconds);
	state.dispatchedFromSeconds = player.value.getCurrentTime();
	state.dispatchedTargetSeconds = state.targetSeconds;
	performSeek(state.targetSeconds);

	hotkeySeekRetryTimeout = window.setTimeout(() => {
		hotkeySeekRetryTimeout = null;
		const pendingState = hotkeySeekState;
		if (!pendingState) return;
		const currentTime = player.value?.getCurrentTime();
		if (typeof currentTime === 'number' && isDispatchedHotkeySeekComplete(currentTime)) {
			onHotkeySeekTimeUpdate(currentTime);
			return;
		}
		if (Date.now() - pendingState.lastInputAt >= HOTKEY_SEEK_MAX_PENDING_MS) {
			log.warn('YouTube hotkey seek was not confirmed before timeout', {
				targetSeconds: pendingState.targetSeconds,
			});
			clearQueuedHotkeySeek();
			return;
		}
		dispatchQueuedHotkeySeek();
	}, HOTKEY_SEEK_RETRY_MS);
}

function scheduleQueuedHotkeySeek() {
	if (hotkeySeekDispatchTimeout !== null) window.clearTimeout(hotkeySeekDispatchTimeout);
	hotkeySeekDispatchTimeout = window.setTimeout(() => {
		hotkeySeekDispatchTimeout = null;
		dispatchQueuedHotkeySeek();
	}, HOTKEY_SEEK_DEBOUNCE_MS);
}

function onHotkeySeekTimeUpdate(currentTime: number) {
	const state = hotkeySeekState;
	if (!state || !isDispatchedHotkeySeekComplete(currentTime)) return;

	const dispatchedTarget = state.dispatchedTargetSeconds;
	if (
		dispatchedTarget !== null
		&& Math.abs(state.targetSeconds - dispatchedTarget) > HOTKEY_SEEK_TARGET_EPSILON_SECONDS
	) {
		state.dispatchedFromSeconds = null;
		state.dispatchedTargetSeconds = null;
		dispatchQueuedHotkeySeek();
		return;
	}

	finishQueuedHotkeySeek();
}

function seekByDelta(delta: number) {
	if (!player.value) return false;

	if (!hotkeySeekState) {
		const currentTime = player.value.getCurrentTime();
		hotkeySeekState = {
			originSeconds: currentTime,
			targetSeconds: currentTime,
			dispatchedFromSeconds: null,
			dispatchedTargetSeconds: null,
			lastInputAt: Date.now(),
		};
	}

	const state = hotkeySeekState;
	state.targetSeconds = clampSeekTarget(state.targetSeconds + delta);
	state.lastInputAt = Date.now();
	showQueuedSeekIndicator(
		hotkeySeekIndicatorCommittedDeltaSeconds + state.targetSeconds - state.originSeconds,
	);

	if (state.dispatchedTargetSeconds === null) scheduleQueuedHotkeySeek();
	return true;
}

function seekByCurrentPlayerTime(delta: number) {
	if (!player.value) return false;
	const currentTime = player.value.getCurrentTime();
	seekTo(clampSeekTarget(currentTime + delta));
	return true;
}

function getQueuedSeekHotkeySignature(input: PlayerHotkeyPayload | KeyboardEvent) {
	return [
		input.code,
		input.altKey ? 'alt' : '',
		input.ctrlKey ? 'ctrl' : '',
		input.metaKey ? 'meta' : '',
		input.shiftKey ? 'shift' : '',
	].join(':');
}

function shouldApplyQueuedSeekHotkey(input: PlayerHotkeyPayload | KeyboardEvent) {
	const now = performance.now();
	const signature = getQueuedSeekHotkeySignature(input);
	if (!input.repeat || hotkeySeekHoldState?.signature !== signature) {
		hotkeySeekHoldState = {
			signature,
			startedAt: now,
			lastAcceptedAt: now,
		};
		return true;
	}

	const heldForMs = now - hotkeySeekHoldState.startedAt;
	const accelerationProgress = Math.min(1, heldForMs / HOTKEY_SEEK_HOLD_ACCELERATION_MS);
	const repeatIntervalMs = HOTKEY_SEEK_HOLD_INITIAL_INTERVAL_MS
		- (HOTKEY_SEEK_HOLD_INITIAL_INTERVAL_MS - HOTKEY_SEEK_HOLD_FASTEST_INTERVAL_MS)
		* accelerationProgress;
	if (now - hotkeySeekHoldState.lastAcceptedAt < repeatIntervalMs) return false;
	hotkeySeekHoldState.lastAcceptedAt = now;
	return true;
}

function getPlayerIframeElement() {
	const iframe = player.value?._player?.getIframe?.();
	return iframe instanceof HTMLIFrameElement ? iframe : null;
}

function isPlayerHotkeyContext() {
	return document.activeElement === getPlayerIframeElement();
}

function requestFullscreenToggle() {
	if (fullscreenToggleInProgress) return;
	isHotkeyGuideOpen.value = false;
	void toggleFullscreen();
}

function toggleHotkeyGuide(event: MouseEvent) {
	if (event.detail > 1) return;
	isHotkeyGuideOpen.value = !isHotkeyGuideOpen.value;
}

function closeHotkeyGuide() {
	isHotkeyGuideOpen.value = false;
}

function closeHotkeyGuideOnOutsidePointer(event: PointerEvent) {
	if (!isHotkeyGuideOpen.value || !(event.target instanceof Node)) return;
	if (hotkeyGuide.value?.contains(event.target) || hotkeyGuideButton.value?.contains(event.target)) return;
	isHotkeyGuideOpen.value = false;
}

function onFullscreenButtonClick(event: MouseEvent) {
	// A double-click emits two click events; only the first should toggle the window.
	if (event.detail > 1) return;
	requestFullscreenToggle();
}

function onPlayerDoubleClick() {
	requestFullscreenToggle();
}

function onPlayerMouseDown(input: PlayerMouseDownPayload) {
	if (!isPlayerHotkeyContext()) return;
	if (input.clickCount === 2) {
		// YouTube handles the first click as play/pause before the app recognizes the
		// double-click. Reverse that action so fullscreen does not change playback.
		togglePlayPause();
		onPlayerDoubleClick();
	}
}

function handlePlayerHotkey(input: PlayerHotkeyPayload | KeyboardEvent) {
	if (!player.value || !reviewsStore.getSelectedVideoId) return false;
	revealPlayerControls();

	if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
		const delta = getArrowSeekDelta(input);
		const direction = input.key === 'ArrowRight' ? 1 : -1;

		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		return shouldApplyQueuedSeekHotkey(input)
			? seekByDelta(direction * delta)
			: true;
	}

	if (input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return false;

	if (input.code === 'KeyJ' || input.code === 'KeyL') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}

		const direction = input.code === 'KeyL' ? 1 : -1;
		return shouldApplyQueuedSeekHotkey(input)
			? seekByDelta(direction * TEN_SECOND_SEEK_SECONDS)
			: true;
	}

	if (input.code === 'Comma' || input.code === 'Period') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}

		const direction = input.code === 'Period' ? 1 : -1;
		return seekByCurrentPlayerTime(direction * FRAME_SEEK_SECONDS);
	}

	if (input.code === 'Space' || input.code === 'KeyK') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		if (!input.repeat) togglePlayPause();
		return true;
	}

	if (input.code === 'KeyM') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		if (!input.repeat) toggleMute();
		return true;
	}

	if (input.code === 'KeyF') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		if (!input.repeat) requestFullscreenToggle();
		return true;
	}

	return false;
}

function onPlayerKeyDown(event: KeyboardEvent) {
	if (event.defaultPrevented) return;
	if (event.code === 'Escape' && isHotkeyGuideOpen.value) {
		event.preventDefault();
		event.stopPropagation();
		isHotkeyGuideOpen.value = false;
		return;
	}
	if (isPlayerHotkeyExcludedTarget(event.target)) return;
	handlePlayerHotkey(event);
}

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_HOTKEY_CALLBACK, (event, input: PlayerHotkeyPayload) => {
	if (!isPlayerHotkeyContext()) return;
	handlePlayerHotkey(input);
});

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_DOUBLE_CLICK_CALLBACK, (event, input: PlayerMouseDownPayload) => {
	onPlayerMouseDown(input);
});

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_ACTIVITY_CALLBACK, () => {
	revealPlayerControls();
});

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_CHANGED, (_event, fullscreen: boolean) => {
	isPlayerFullscreen.value = fullscreen === true;
	isHotkeyGuideOpen.value = false;
	revealPlayerControls();
	void nextTick(publishPlayerPointerBounds);
});

watch(isHotkeyGuideOpen, (isOpen) => {
	if (isOpen) {
		keepPlayerControlsVisible();
	} else {
		revealPlayerControls();
	}
});

watch(videoContainer, (container) => {
	playerBoundsResizeObserver?.disconnect();
	playerBoundsResizeObserver = null;
	if (!container) {
		publishPlayerPointerBounds();
		return;
	}

	playerBoundsResizeObserver = new ResizeObserver(publishPlayerPointerBounds);
	playerBoundsResizeObserver.observe(container);
	void nextTick(publishPlayerPointerBounds);
});

let lastFightRelativeTime = 0;
function onVideoIdChanged() {
	clearQueuedHotkeySeek();
	if (player.value) {
		const videoId = reviewsStore.getSelectedVideoId;
		if (videoId) {
			if (!playerLoaded) return;

			const directSeekSeconds = reviewsStore.consumePendingDirectVideoSeekSeconds();
			if (directSeekSeconds !== null) {
				log.info(`Loading video ${videoId} from direct request, seeking to ${directSeekSeconds}s`);
				player.value.load(videoId, true, directSeekSeconds);
			} else if (!reviewsStore.selectedReportCode) {
				log.info(`Loading video ${videoId} without report context, seeking to 0s`);
				player.value.load(videoId, true, 0);
			} else {
				const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds
				const seekTime = relativeFightStart + YOUTUBE_DELAY_OFFSET + lastFightRelativeTime;

				log.info(`Loading video ${videoId}, seeking to ${seekTime}s (relativeFightStart: ${relativeFightStart}s, lastFightRelativeTime: ${lastFightRelativeTime}s)`);

				player.value.load(videoId, true, seekTime);
			}
		} else {
			player.value.stop();
		}
	}
}

watch(() => reviewsStore.getSelectedVideoId, (newId) => {
	if (!newId) {
		isPlayerControlDockHovered.value = false;
		isPlayerControlDockFocused.value = false;
		isHotkeyGuideOpen.value = false;
		keepPlayerControlsVisible();
	}
	onVideoIdChanged();
});

watch(() => reviewsStore.pendingDirectVideoSeekSeconds, (newId) => {
	if (reviewsStore.pendingDirectVideoSeekSeconds !== null) {
		onVideoIdChanged();
	}
});

let pendingComparisonSeek: { fightID: number; timestampSeconds: number } | null = null;
watch(() => reviewsStore.selectedFightID, (newVal) => {
	const comparisonTimestamp = pendingComparisonSeek?.fightID === newVal
		? pendingComparisonSeek.timestampSeconds
		: 0;
	lastFightRelativeTime = comparisonTimestamp;
	if (newVal && reviewsStore.selectedVideoInfo) {
		const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

		const seekTime = relativeFightStart + YOUTUBE_DELAY_OFFSET + comparisonTimestamp;

		log.info(`New fight selected, seeking to ${seekTime}s (relativeFightStart: ${relativeFightStart}s)`);

		seekTo(seekTime);
	}
});

watch(() => reviewsStore.selectedReportCode, (newVal, oldVal) => {
	if (newVal !== oldVal) {
		lastFightRelativeTime = 0;

		if (newVal && reviewsStore.selectedVideoInfo && reviewsStore.videoList.some(v => v.id === reviewsStore.selectedVideoInfo?.id)) {
			const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

			const seekTime = relativeFightStart + YOUTUBE_DELAY_OFFSET;

			log.info(`New report selected, seeking to ${seekTime}s (relativeFightStart: ${relativeFightStart}s)`);

			seekTo(seekTime);
		}
	}
});


const playerReloads = ref(0);

function reloadPlayer() {
  playerReloads.value++;
  log.info("Reloading YouTube player, reload count:", playerReloads.value);
}

const currentVideoTime = ref(0);

watch(playerIframe, (el) => {
	clearQueuedHotkeySeek();
	isPlayerPlaying.value = false;
	keepPlayerControlsVisible();
	if (player.value) {
		log.info("Destroying existing YouTube player instance");
		player.value.destroy();
		player.value = null;
		playerLoaded = false;
	}
	if (el) {
		log.info("Creating new YouTube player instance");
		player.value = new YTPlayer(el, {
			autoplay: true,
			// Keep YouTube's quality, captions, and settings controls available.
			controls: true,
			// Fullscreen is app-owned so YouTube cannot create a competing state.
			fullscreen: false,
			height: '100%',
			host: "https://www.youtube-nocookie.com",
			keyboard: false,
			timeupdateFrequency: 200, // ms
			width: '100%',
		});

		player.value.on('unplayable', ({ videoId, errorCode, data }) => {
			clearQueuedHotkeySeek();
			log.info("YouTube video unplayable:", videoId, errorCode);
			log.info(player.value._player)
			log.info("playerInfo", player.value?._player?.playerInfo)
			log.info('data', data)
			if (player.value?._player?.getVideoData) {
				log.info("videoData", player.value?._player?.getVideoData())
			}
			log.info('debugText', player.value?._player?.getDebugText())

			// alert(`The requested video ${videoId} is unplayable. Error code: ${errorCode}`);
			if (errorCode === 150) { // noreferrer bug, try reloading the player 153 actually fires with 150 wtf
				setTimeout(() => {
					reloadPlayer();
				}, 1500);
			}
		});

		player.value.on('error', (error) => {
			clearQueuedHotkeySeek();
			log.info("YouTube embed error:", error);
			alert(`Error embedding video. Error code: ${error}`);
		});

		player.value.on('timeupdate', (seconds) => {
			currentVideoTime.value = seconds;
			onHotkeySeekTimeUpdate(seconds);
		});

		player.value.on('cued', () => {
			playVideo();
		});

		player.value.on('ready', () => {
			log.info('YouTube player ready');
			playerLoaded = true;
			player.value.mute();
			onVideoIdChanged();
			reviewsStore.flushPendingTimelineWindowActions();
		});

		player.value.on('playing', () => {
			isPlayerPlaying.value = true;
			revealPlayerControls();
		});

		const keepControlsVisibleWhileStopped = () => {
			isPlayerPlaying.value = false;
			keepPlayerControlsVisible();
		};
		player.value.on('paused', keepControlsVisibleWhileStopped);
		player.value.on('buffering', keepControlsVisibleWhileStopped);
		player.value.on('ended', keepControlsVisibleWhileStopped);
	}
});

onMounted(async () => {
	window.addEventListener('keydown', onPlayerKeyDown);
	window.addEventListener('blur', closeHotkeyGuide);
	window.addEventListener('resize', publishPlayerPointerBounds);
	document.addEventListener('pointerdown', closeHotkeyGuideOnOutsidePointer);
	try {
		isPlayerFullscreen.value = await ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_STATUS_GET) === true;
	} catch (error) {
		log.warn('Failed to load YouTube player fullscreen state', error);
	}
	const requestedAtRevision = wclAuthorizationStatusRevision;
	try {
		const authorized = await ipc.invoke(IPC_EVENTS.WCL_AUTH_STATUS_GET);
		if (wclAuthorizationStatusRevision === requestedAtRevision) {
			applyWclAuthorizationStatus(authorized);
		}
	} catch (error) {
		log.error('Failed to load WCL authorization status', error);
	}
	try {
		const status = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET) as { detached?: boolean };
		const wasDetached = reviewsStore.timelineWindowDetached;
		reviewsStore.timelineWindowDetached = status?.detached === true;
		if (reviewsStore.timelineWindowDetached) {
			sendTimelineWindowContext();
		} else if (wasDetached) {
			reviewsStore.timelineExpanded = true;
			void reviewsStore.reloadBossCastPreferences();
		}
	} catch (error) {
		log.error('Failed to load detached timeline status', error);
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onPlayerKeyDown);
	window.removeEventListener('blur', closeHotkeyGuide);
	window.removeEventListener('resize', publishPlayerPointerBounds);
	document.removeEventListener('pointerdown', closeHotkeyGuideOnOutsidePointer);
	playerBoundsResizeObserver?.disconnect();
	playerBoundsResizeObserver = null;
	ipc.send(IPC_EVENTS.YOUTUBE_PLAYER_POINTER_BOUNDS_SET, null);
	clearPlayerControlsHideTimeout();
	clearQueuedHotkeySeek();
	isPlayerFullscreen.value = false;
	void ipc.invoke(IPC_EVENTS.YOUTUBE_PLAYER_FULLSCREEN_SET, false).catch((error) => {
		log.warn('Failed to leave YouTube player fullscreen while closing Reviews', error);
	});
	resetCopyReviewLinkStatus();
});

async function wclAuth() {
	const res = await ipc.invoke(IPC_EVENTS.WCL_REQUEST_AUTH_LINK);
	console.log('WCL Auth Link:', res)
}

const reportOptions = computed(() => {
	const list = []

	list.push({
		label: '--',
		value: null,
	});

	list.push(...reviewsStore.getReports.map(r => ({
		label: `${r.title} - ${new Date(r.startTime).toLocaleString()}`,
		value: r.code,
	})));

	const lastReport = reviewsStore.getReports[reviewsStore.getReports.length - 1];
	const lastReportEndTime = lastReport ? lastReport.endTime : undefined;

	if (lastReportEndTime) {
		list.push({
			label: 'Load older reports...',
			overrideAction: () => {
				reviewsStore.requestReports(lastReportEndTime);
			},
		});
	}

	return list;
});

const fightOptions = computed(() => {
	const list = [
		{
			label: '--',
			value: null,
		},
	]

	if (!reviewsStore.getSelectedReport || !reviewsStore.getReportDetails?.fights) return list;

	const timeOffset = reviewsStore.getReportTimeOffset;
	const fights = reviewsStore.getReportDetails.fights;

	const idToCount = new Map<number, number>();
	const encounterDifficultyToCount = new Map<string, number>();
	const chronologicalFights = [...fights].sort((left, right) => left.startTime - right.startTime);
	for (const f of chronologicalFights) {
		const pullScope = `${f.encounterID}:${f.difficulty ?? 'unknown'}`;
		const currentCount = encounterDifficultyToCount.get(pullScope) || 0;
		encounterDifficultyToCount.set(pullScope, currentCount + 1);

		idToCount.set(f.id, currentCount + 1);
	}

	list.push(...[...chronologicalFights].reverse().map(f => {
		const count = idToCount.get(f.id) || 0;
		const formattedDifficulty = formatWclDifficultyLabel(f.difficulty);
		const difficultyLabel = formattedDifficulty ? ` ${formattedDifficulty}` : '';

		return {
			label: `#${count}${difficultyLabel} ${f.name} ${f.kill ? 'KILL' : (f.bossPercentage).toFixed(1) + '%'} ${formatTime((f.endTime - f.startTime) / 1000)} (${new Date(timeOffset + f.startTime).toLocaleTimeString()})`,
			value: f.id,
			color: f.kill ? 'green' : undefined,
		}
	}) || []);

	return list;
});

watch(reviewsStore.videoList, (newList) => {
	if (!reviewsStore.selectedVideoInfo && newList.length > 0) {
		reviewsStore.setSelectedVideoInfo(newList[0]);
	}
	// log.info('Filtered video list length:', newList.length);
	// for (const video of newList) {
	// 	log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(video.startTime + (video.duration || 0)).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
	// }
});

const YOUTUBE_DELAY_OFFSET = 5;

// 0 - fight end, in seconds
function seekToFightTimestamp(fightTimestamp) {
	if (!player.value) return;
	const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

	const seekTime = relativeFightStart + fightTimestamp + YOUTUBE_DELAY_OFFSET;

	log.info(`Seeking to ${seekTime}s in video (relativeFightStart: ${relativeFightStart}s, fightTimestamp: ${fightTimestamp}s)`);

	seekTo(seekTime);
	playVideo();
}

async function seekToPullTimestamp(fightID: number, timestampSeconds: number) {
	if (!reviewsStore.getReportDetails?.fights.some(fight => fight.id === fightID)) return;
	pendingComparisonSeek = { fightID, timestampSeconds };

	if (reviewsStore.selectedFightID !== fightID) {
		reviewsStore.selectedFightID = fightID;
		await nextTick();
	} else {
		lastFightRelativeTime = timestampSeconds;
	}

	if (!reviewsStore.videoList.some(video => video.id === reviewsStore.getSelectedVideoId)) {
		reviewsStore.setSelectedVideoInfo(reviewsStore.videoList[0] || null);
		await nextTick();
	}

	seekToFightTimestamp(timestampSeconds);
	pendingComparisonSeek = null;
}

const copyReviewLinkStatus = ref('');
const isCopyReviewLinkHovered = ref(false);
let copyReviewLinkResetTimeout = null as number | null;

const copyReviewLinkTooltip = computed(() => {
	if (copyReviewLinkStatus.value) return copyReviewLinkStatus.value;
	if (isCopyReviewLinkHovered.value && reviewsStore.getSelectedVideoId) return 'Copy review link with timestamp';
	return '';
});

function resetCopyReviewLinkStatus() {
	if (copyReviewLinkResetTimeout) {
		clearTimeout(copyReviewLinkResetTimeout);
		copyReviewLinkResetTimeout = null;
	}
	copyReviewLinkStatus.value = '';
}

async function copyReviewLink(event?: MouseEvent) {
	(event?.currentTarget as HTMLButtonElement | null)?.blur();

	const videoId = reviewsStore.getSelectedVideoId;
	if (!videoId) {
		copyReviewLinkStatus.value = 'No video selected';
		return;
	}

	const timestampSeconds = Math.max(0, Math.floor(currentVideoTime.value || 0));
	const reviewUrl = `https://rak-gaming-updater.org/api/updater/open/reviews?videoId=${encodeURIComponent(videoId)}&t=${timestampSeconds}`;

	try {
		await navigator.clipboard.writeText(reviewUrl);
		copyReviewLinkStatus.value = 'Copied';
		log.info('Copied review link', { reviewUrl });
	} catch (error) {
		copyReviewLinkStatus.value = 'Copy failed';
		log.error('Failed to copy review link', error);
	}

	if (copyReviewLinkResetTimeout) {
		clearTimeout(copyReviewLinkResetTimeout);
	}

	copyReviewLinkResetTimeout = window.setTimeout(() => {
		copyReviewLinkStatus.value = '';
		copyReviewLinkResetTimeout = null;
	}, 2000);
}

const currentFightCursor = computed(() => {
    if (!player.value || !reviewsStore.getFightDuration) return 0;

    // Calculate fight start and video start in seconds
    const fightStartRelativeToVideo = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

    // Calculate current fight-relative time
    const fightRelativeTime = currentVideoTime.value - fightStartRelativeToVideo - YOUTUBE_DELAY_OFFSET;

    // Clamp between 0 and fightDuration (in seconds)
    const fightDurationSec = reviewsStore.getFightDuration / 1000;
    const clamped = Math.max(0, Math.min(fightRelativeTime, fightDurationSec));
	lastFightRelativeTime = clamped;

    // Return as percent (0 to 1)
	// log.debug(`Current fight cursor: ${clamped}s / ${fightDurationSec}s = ${(clamped / fightDurationSec * 100).toFixed(2)}%`);
    return clamped / fightDurationSec;
});

const phaseTransitions = computed(() => {
	const selectedReportDetails = reviewsStore.getReportDetails;
	const selectedFight = reviewsStore.getSelectedFight;

	if (!selectedReportDetails?.phases || !selectedFight?.phaseTransitions || !reviewsStore.getFightDuration) return [];
	const phaseIdToText = new Map<number, string>();
	let phasesCount = 0;
	let intermissionCount = 0;
	const phases = selectedReportDetails.phases?.find(p => p.encounterID === selectedFight.encounterID)?.phases || [];
	phases.forEach(phase => {
		// Shorten phase names:
		// "Stage Two: Some name" -> p2
		// "Intermission One: Some name" - i1
		let name
		if (phase.isIntermission) {
			intermissionCount += 1;
			name = `I${intermissionCount}`;
		} else {
			phasesCount += 1;
			name = `P${phasesCount}`;
		}

		if (name) {
			phaseIdToText.set(phase.id, name);
		}
	});

	const fightStartTime = reviewsStore.getFightStartTimeOffset; // in ms

	return reviewsStore.getSelectedFight.phaseTransitions
		.map(phase => {
			const phaseId = phase.id;
			const phaseStart = phase.startTime; // in ms
			const percent = (phaseStart - fightStartTime) / reviewsStore.getFightDuration;
			return {
				name: phaseIdToText.get(phaseId) || phaseId,
				percent,
			};
		})
		.filter(phase => phase.percent > 0 && phase.percent < 1); // exclude start and end
});

function openWCLDeath(deathID: number) {
	if (!reviewsStore.selectedReportCode || !reviewsStore.selectedFightID) return;
	openWCLPullDeath(reviewsStore.selectedFightID, deathID);
}

function openWCLFight(fightID?: number) {
	const targetFightID = fightID || reviewsStore.selectedFightID;
	if (!reviewsStore.selectedReportCode || !targetFightID) return;
	ipc.send(IPC_EVENTS.WCL_OPEN_FIGHT, {
		reportCode: reviewsStore.selectedReportCode,
		fightID: targetFightID,
	});
}

function openWCLPullDeath(fightID: number, deathID: number) {
	if (!reviewsStore.selectedReportCode) return;
	ipc.send(IPC_EVENTS.WCL_OPEN_DEATH, {
		reportCode: reviewsStore.selectedReportCode,
		fightID,
		deathID: deathID,
	});
}

function buildTimelineWindowContext(includeAllCachedPulls = false): ReviewTimelineWindowContext | null {
	const reportCode = reviewsStore.selectedReportCode;
	const fightID = reviewsStore.selectedFightID;
	const reportDetails = reviewsStore.getReportDetails;
	const fight = reviewsStore.getSelectedFight;
	if (!reportCode || !fightID || !reportDetails || !fight) return null;

	const context: ReviewTimelineWindowContext = {
		reportCode,
		fightID,
		reportDetails,
		dataSnapshot: reviewsStore.createTimelineWindowDataSnapshot(
			reportCode,
			includeAllCachedPulls ? undefined : [fightID],
		),
		phases: phaseTransitions.value,
		fightStartTime: reviewsStore.getFightStartTimeOffset,
		fightDuration: reviewsStore.getFightDuration,
		cursorPercent: currentFightCursor.value,
		viewMode: reviewsStore.timelineViewMode,
		title: `${fight.name} · Fight #${fight.id}`,
	};

	// Pinia wraps nested report data in Vue proxies. Build a plain snapshot before
	// crossing the isolated renderer boundary.
	return JSON.parse(JSON.stringify(context)) as ReviewTimelineWindowContext;
}

async function detachTimeline() {
	const context = buildTimelineWindowContext(true);
	if (!context) return;
	try {
		const response = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_OPEN, context) as { success?: boolean; error?: string };
		if (!response?.success) throw new Error(response?.error || 'Timeline window could not be opened.');
		const status = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_STATUS_GET) as { detached?: boolean };
		reviewsStore.timelineWindowDetached = status?.detached === true;
		reviewsStore.timelineExpanded = true;
	} catch (error) {
		log.error('Failed to detach review timeline', error);
	}
}

function sendTimelineWindowContext() {
	if (!reviewsStore.timelineWindowDetached) return;
	const context = buildTimelineWindowContext();
	if (!context) {
		ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'context-unavailable' });
		return;
	}
	ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_SET, context);
}

function handleTimelineWindowAction(action: ReviewTimelineWindowAction): boolean {
	switch (action.type) {
		case 'seek':
			if (!player.value || !playerLoaded) return false;
			seekToFightTimestamp(action.timestampSeconds);
			return true;
		case 'seek-pull':
			if (!player.value || !playerLoaded) return false;
			void seekToPullTimestamp(action.fightID, action.timestampSeconds);
			return true;
		case 'open-fight':
			openWCLFight(action.fightID);
			return true;
		case 'open-death':
			openWCLDeath(action.deathID);
			return true;
		case 'open-pull-death':
			openWCLPullDeath(action.fightID, action.deathID);
			return true;
		case 'view-mode':
			reviewsStore.timelineViewMode = action.viewMode;
			return true;
	}
}

let unregisterTimelineWindowActionHandler: (() => void) | null = null;
onMounted(() => {
	unregisterTimelineWindowActionHandler = reviewsStore.registerTimelineWindowActionHandler(handleTimelineWindowAction);
});
onBeforeUnmount(() => {
	unregisterTimelineWindowActionHandler?.();
	unregisterTimelineWindowActionHandler = null;
});

watch(
	[
		() => reviewsStore.selectedReportCode,
		() => reviewsStore.selectedFightID,
		() => reviewsStore.getReportDetails,
		() => reviewsStore.getFightEvents,
		() => reviewsStore.getFightCooldownData,
		() => reviewsStore.getFightBossCastData,
		() => reviewsStore.isFightCooldownsLoading,
		() => reviewsStore.getFightCooldownError,
		phaseTransitions,
		() => reviewsStore.timelineViewMode,
	],
	sendTimelineWindowContext,
);

watch(currentFightCursor, (cursorPercent) => {
	if (reviewsStore.timelineWindowDetached) ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_SET, cursorPercent);
});

function openYoutubeLink(videoId: string, timestampSeconds?: number) {
	ipc.send(IPC_EVENTS.YOUTUBE_OPEN_LINK, videoId, timestampSeconds);
}

function getCurrentStreamTimestamp(video: YouTubeVideo): number | undefined {
	if (!player.value || !playerLoaded) return undefined;
	const currentTime = player.value.getCurrentTime();
	if (!Number.isFinite(currentTime) || currentTime < 0) return undefined;

	const selectedVideo = reviewsStore.selectedVideoInfo;
	if (!selectedVideo || selectedVideo.id === video.id) return currentTime;

	const currentPlaybackTime = selectedVideo.startTime + currentTime * 1000;
	return Math.max(0, (currentPlaybackTime - video.startTime) / 1000);
}

function openStreamInBrowser(video: YouTubeVideo) {
	openYoutubeLink(video.id, getCurrentStreamTimestamp(video));
}

function openSelectedYoutubeVideo(event: MouseEvent) {
	if (event.detail > 1) return;
	const selectedVideo = reviewsStore.selectedVideoInfo;
	if (selectedVideo) openStreamInBrowser(selectedVideo);
}

function refreshYoutubeVideo(videoId: string) {
	ipc.send(IPC_EVENTS.YOUTUBE_VIDEO_REFRESH, videoId);
}

function deleteYoutubeVideo(videoId: string) {
	ipc.send(IPC_EVENTS.YOUTUBE_VIDEO_DELETE, videoId);
}

</script>

<template>
	<TabContent>
		<div class="w-full h-full min-h-0 flex flex-col">
			<div class="flex flex-row gap-0 h-9/10 flex-14">
				<div class="flex flex-1 flex-col max-w-[calc(100vw-350px)]">
					<template v-if="isWclAuthorized">
						<Dropdown :options="reportOptions" class="min-w-[34rem]"
							:placeholder="$t('reviews.select_report')"
							v-model="reviewsStore.selectedReportCode"
							:onOpen="reviewsStore.requestReports"
						></Dropdown>
						<Dropdown :options="fightOptions" class="min-w-[34rem]"
							:placeholder="$t('reviews.select_fight')"
							v-model="reviewsStore.selectedFightID"
							:onOpen="reviewsStore.requestReportData"
						></Dropdown>
					</template>
					<div
						v-else
						class="flex min-w-[34rem] h-[72px] items-center justify-center"
					>
						<UIButton
							@click="wclAuth"
							label="Authorize WCL client"
							class="h-14 min-w-[24rem] px-6 text-lg"
						></UIButton>
					</div>
					<div
						ref="videoContainer"
						class="youtube-player-container relative bg-gray-200 aspect-video max-w-[min(100%,80vw)] h-[calc(100%-85px)] rounded-md mt-2"
						:class="{
							'youtube-player-container--fullscreen': isPlayerFullscreen,
							'youtube-player-controls--hidden': !arePlayerControlsVisible,
						}"
						@pointerenter="onPlayerPointerEnter"
						@pointermove="revealPlayerControls"
						@dblclick="onPlayerDoubleClick"
					>
						<div :key="playerReloads" v-show="reviewsStore.selectedVideoInfo" class="youtube-player-frame w-full h-full relative">
							<div
								allow="autoplay; encrypted-media; fullscreen"
								referrerpolicy="strict-origin-when-cross-origin"
								ref="playerIframe"
								class="rounded-md w-full h-full z-50"
							></div>
						</div>
						<Transition name="youtube-player-seek-queue">
							<div
								v-if="queuedSeekDeltaSeconds !== null"
								class="youtube-player-seek-queue"
								:class="queuedSeekDirectionClass"
								role="status"
								aria-live="polite"
								aria-atomic="true"
							>
								<strong>{{ queuedSeekDeltaLabel }}</strong>
							</div>
						</Transition>
						<div
							v-if="reviewsStore.selectedVideoInfo"
							class="youtube-player-control-dock"
							@pointerenter="onPlayerControlDockPointerEnter"
							@pointerleave="onPlayerControlDockPointerLeave"
							@focusin="onPlayerControlDockFocusIn"
							@focusout="onPlayerControlDockFocusOut"
							@dblclick.stop
						>
							<button
								type="button"
								class="youtube-player-control-button"
								title="Open video on YouTube"
								aria-label="Open current video on YouTube"
								@click.stop="openSelectedYoutubeVideo"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
								</svg>
							</button>
							<button
								ref="hotkeyGuideButton"
								type="button"
								class="youtube-player-control-button"
								title="Video keyboard shortcuts"
								aria-label="Show video keyboard shortcuts"
								aria-controls="youtube-player-hotkey-guide"
								:aria-expanded="isHotkeyGuideOpen"
								@click.stop="toggleHotkeyGuide"
								@dblclick.stop
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<rect x="2.5" y="5" width="19" height="14" rx="1" />
									<path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h3M6 15h12" />
								</svg>
							</button>
							<button
								type="button"
								class="youtube-player-control-button"
								:title="isPlayerFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'"
								:aria-label="isPlayerFullscreen ? 'Exit video fullscreen' : 'Enter video fullscreen'"
								@click.stop="onFullscreenButtonClick"
								@dblclick.stop
							>
								<svg v-if="isPlayerFullscreen" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
								</svg>
								<svg v-else viewBox="0 0 24 24" aria-hidden="true">
									<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
								</svg>
							</button>
						</div>
						<section
							v-if="isHotkeyGuideOpen"
							id="youtube-player-hotkey-guide"
							ref="hotkeyGuide"
							class="youtube-player-hotkey-guide"
							aria-label="Video keyboard shortcuts"
							@dblclick.stop
						>
							<div class="youtube-player-hotkey-guide__header">
								<div>
									<div class="youtube-player-hotkey-guide__title">Video shortcuts</div>
									<div class="youtube-player-hotkey-guide__hint">Available while reviewing a video</div>
								</div>
								<button type="button" aria-label="Close video shortcuts" @click="isHotkeyGuideOpen = false">×</button>
							</div>
							<div class="youtube-player-hotkey-guide__grid">
								<div v-for="shortcut in PLAYER_SHORTCUTS" :key="shortcut.keys" class="youtube-player-hotkey-guide__item">
									<kbd>{{ shortcut.keys }}</kbd>
									<span>{{ shortcut.action }}</span>
								</div>
							</div>
						</section>
					</div>
				</div>
				<div class="max-w-full w-full">
					<div class="h-[70px] ">
						<div class="flex items-center mt-1">
							<Input class="flex-10 h-8"
								:placeholder="$t('reviews.add_youtube_stream')"
								v-model="youtubeLink"
							></Input>
							<UIButton @click="requestVideoInfo" label="" class="flex-1 mr-1 h-8">
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
						<!-- {{ reviewsStore.getSelectedVideoId }} -->

						{{ youtubeLinkStatus }}
					</div>

					<ScrollFrame class="max-h-[calc(100%-85px)]">
						<div v-for="video in reviewsStore.videoList" :key="video.id" class="flex min-h-fit items-center">
							<button
								class="min-h-8 m-0.5 rounded-md flex-1 cursor-pointer disabled:cursor-auto"
								:disabled="video.id === reviewsStore.getSelectedVideoId"
								:class="{
									'border-1 border-secondary dark:bg-dark1 bg-light1': video.id === reviewsStore.getSelectedVideoId,
									'dark:bg-dark4 dark:hover:bg-dark3 bg-light4 hover:bg-light3 ': video.id !== reviewsStore.getSelectedVideoId,
								}"
								@click="reviewsStore.setSelectedVideoInfo(video)"
							>
								<div class="text-bold max-w-fit min-h-fit break-keep text-left px-2">{{ video.author }} - {{ new Date(video.startTime).toLocaleString()  }}<span v-if="video.duration===0" class="text-red-500"> (LIVE)</span></div>
							</button>
							<!-- follow link -->
							<button
								class="flex-none hover:text-yellow-200 cursor-pointer"
								title="Open stream on YouTube at the current playback time"
								:aria-label="`Open ${video.author}'s stream on YouTube at the current playback time`"
								@click="openStreamInBrowser(video)"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
									<path d="M21.721 12.752a9.711 9.711 0 0 0-.945-5.003 12.754 12.754 0 0 1-4.339 2.708 18.991 18.991 0 0 1-.214 4.772 17.165 17.165 0 0 0 5.498-2.477ZM14.634 15.55a17.324 17.324 0 0 0 .332-4.647c-.952.227-1.945.347-2.966.347-1.021 0-2.014-.12-2.966-.347a17.515 17.515 0 0 0 .332 4.647 17.385 17.385 0 0 0 5.268 0ZM9.772 17.119a18.963 18.963 0 0 0 4.456 0A17.182 17.182 0 0 1 12 21.724a17.18 17.18 0 0 1-2.228-4.605ZM7.777 15.23a18.87 18.87 0 0 1-.214-4.774 12.753 12.753 0 0 1-4.34-2.708 9.711 9.711 0 0 0-.944 5.004 17.165 17.165 0 0 0 5.498 2.477ZM21.356 14.752a9.765 9.765 0 0 1-7.478 6.817 18.64 18.64 0 0 0 1.988-4.718 18.627 18.627 0 0 0 5.49-2.098ZM2.644 14.752c1.682.971 3.53 1.688 5.49 2.099a18.64 18.64 0 0 0 1.988 4.718 9.765 9.765 0 0 1-7.478-6.816ZM13.878 2.43a9.755 9.755 0 0 1 6.116 3.986 11.267 11.267 0 0 1-3.746 2.504 18.63 18.63 0 0 0-2.37-6.49ZM12 2.276a17.152 17.152 0 0 1 2.805 7.121c-.897.23-1.837.353-2.805.353-.968 0-1.908-.122-2.805-.353A17.151 17.151 0 0 1 12 2.276ZM10.122 2.43a18.629 18.629 0 0 0-2.37 6.49 11.266 11.266 0 0 1-3.746-2.504 9.754 9.754 0 0 1 6.116-3.985Z" />
								</svg>
							</button>
							<!-- refresh admin only -->
							<button
								v-if="loginStore.isAdmin && video.duration === 0"
								class="flex-none hover:text-yellow-200 cursor-pointer"
								@click="refreshYoutubeVideo(video.id)"
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
							<!-- delete admin only -->
							<button
								v-if="loginStore.isAdmin"
								class="flex-none hover:text-red-600 cursor-pointer"
								@click="deleteYoutubeVideo(video.id)"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
									<path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" />
								</svg>

							</button>

						</div>
					</ScrollFrame>
				</div>
			</div>
			<div class="flex-1 min-h-26 flex w-full flex-col items-center">
				<div class="relative mt-12 w-96/100">
					<button
						type="button"
						class="absolute -left-4 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center cursor-pointer text-neutral-500 transition-[color,transform,opacity] duration-150 hover:text-sky-500 focus:outline-none focus:text-sky-500 active:scale-95 dark:text-neutral-300 dark:hover:text-sky-400 dark:focus:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
						style="width: 30px; height: 30px;"
						@click="copyReviewLink"
						@mouseenter="isCopyReviewLinkHovered = true"
						@mouseleave="isCopyReviewLinkHovered = false"
						@focus="isCopyReviewLinkHovered = true"
						@blur="isCopyReviewLinkHovered = false"
						:disabled="!reviewsStore.getSelectedVideoId"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
							<path d="M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 0 1 3.75 3.75v1.875C13.5 8.161 14.34 9 15.375 9h1.875A3.75 3.75 0 0 1 21 12.75v3.375C21 17.16 20.16 18 19.125 18h-9.75A1.875 1.875 0 0 1 7.5 16.125V3.375Z" />
							<path d="M15 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 17.25 7.5h-1.875A.375.375 0 0 1 15 7.125V5.25ZM4.875 6H6v10.125A3.375 3.375 0 0 0 9.375 19.5H16.5v1.125c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V7.875C3 6.839 3.84 6 4.875 6Z" />
						</svg>
					</button>
					<span
						v-if="copyReviewLinkTooltip"
						class="absolute -left-2 -top-7 z-30 rounded bg-black/80 px-2 py-1 text-xs text-white whitespace-nowrap"
					>
						{{ copyReviewLinkTooltip }}
					</span>
					<ReviewCooldownTimeline
						v-if="!reviewsStore.timelineWindowDetached && reviewsStore.selectedFightID && reviewsStore.getFightDuration > 0"
						v-model:expanded="reviewsStore.timelineExpanded"
						v-model:view-mode="reviewsStore.timelineViewMode"
						:events="reviewsStore.getFightCooldownEvents"
						:fight-events="reviewsStore.getFightEvents"
						:groups="reviewsStore.getFightCooldownGroups"
						:phases="phaseTransitions"
						:fight-start-time="reviewsStore.getFightStartTimeOffset"
						:fight-duration="reviewsStore.getFightDuration"
						:cursor-percent="currentFightCursor"
						:loading="reviewsStore.isFightCooldownsLoading || reviewsStore.isFightEventsLoading"
						:error="reviewsStore.getFightCooldownError || reviewsStore.getFightEventsError"
						@seek="seekToFightTimestamp"
						@open-fight="openWCLFight"
						@open-death="openWCLDeath"
						@seek-pull="seekToPullTimestamp"
						@open-pull-death="openWCLPullDeath"
						@detach="detachTimeline"
					/>
				</div>
			</div>
		</div>
	</TabContent>
</template>

<style>
.youtube-player-container iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
	border-radius: 0.375rem;
}

.youtube-player-seek-queue {
	position: absolute;
	top: 50%;
	z-index: 60;
	transform: translate(-50%, -50%);
	color: rgb(241 245 249);
	pointer-events: none;
	text-align: center;
	text-shadow: 0 2px 5px rgb(0 0 0 / 95%), 0 0 16px rgb(0 0 0 / 75%);
}

.youtube-player-seek-queue--backward {
	left: 22%;
}

.youtube-player-seek-queue--forward {
	left: 78%;
}

.youtube-player-seek-queue--neutral {
	left: 50%;
}

.youtube-player-seek-queue strong {
	font-size: clamp(2.1rem, 5vw, 4rem);
	font-weight: 750;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.04em;
	line-height: 0.9;
}

.youtube-player-seek-queue-enter-active,
.youtube-player-seek-queue-leave-active {
	transition: left 80ms ease-out, opacity 80ms linear, transform 80ms linear;
}

.youtube-player-seek-queue-enter-from,
.youtube-player-seek-queue-leave-to {
	opacity: 0;
	transform: translate(-50%, -50%) scale(0.92);
}

.youtube-player-control-dock {
	position: absolute;
	right: 0.65rem;
	bottom: 3.35rem;
	z-index: 2;
	display: flex;
	align-items: center;
	border: 1px solid rgb(148 163 184 / 45%);
	border-radius: 0.2rem;
	background: rgb(8 13 22 / 88%);
	color: rgb(241 245 249);
	box-shadow: 0 2px 8px rgb(0 0 0 / 55%);
	opacity: 0.86;
	overflow: hidden;
	transition: border-color 80ms linear, opacity 220ms ease-out;
}

.youtube-player-controls--hidden .youtube-player-control-dock {
	opacity: 0;
	pointer-events: none;
}

.youtube-player-control-dock:hover,
.youtube-player-control-dock:focus-within {
	border-color: rgb(165 180 252 / 72%);
	opacity: 1;
}

.youtube-player-control-button {
	display: flex;
	width: 2.2rem;
	height: 2.1rem;
	align-items: center;
	justify-content: center;
	border-left: 1px solid rgb(100 116 139 / 42%);
	background: transparent;
	color: inherit;
	cursor: pointer;
	transition: background-color 80ms linear, color 80ms linear;
}

.youtube-player-control-button:first-child {
	border-left: 0;
}

.youtube-player-control-button:hover,
.youtube-player-control-button:focus-visible {
	background: rgb(30 41 59 / 96%);
	color: white;
}

.youtube-player-control-button:focus-visible {
	outline: 2px solid rgb(129 140 248 / 85%);
	outline-offset: -2px;
}

.youtube-player-control-button svg {
	width: 1.25rem;
	height: 1.25rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: square;
	stroke-linejoin: miter;
}

.youtube-player-control-button svg rect {
	fill: none;
}

.youtube-player-control-button svg path {
	stroke-linecap: round;
	stroke-linejoin: round;
}

.youtube-player-hotkey-guide {
	position: absolute;
	right: 0.65rem;
	bottom: 5.9rem;
	z-index: 3;
	width: min(38rem, calc(100% - 1.3rem));
	max-height: calc(100% - 4rem);
	overflow: auto;
	border: 1px solid rgb(100 116 139 / 58%);
	border-radius: 0.25rem;
	background: rgb(7 12 20 / 96%);
	color: rgb(226 232 240);
	box-shadow: 0 12px 32px rgb(0 0 0 / 62%);
	backdrop-filter: blur(5px);
}

.youtube-player-hotkey-guide__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 0.8rem 0.6rem;
	border-bottom: 1px solid rgb(71 85 105 / 50%);
}

.youtube-player-hotkey-guide__title {
	font-size: 0.9rem;
	font-weight: 700;
	letter-spacing: 0.02em;
}

.youtube-player-hotkey-guide__hint {
	margin-top: 0.1rem;
	font-size: 0.7rem;
	color: rgb(148 163 184);
}

.youtube-player-hotkey-guide__header button {
	font-size: 1.25rem;
	line-height: 1;
	color: rgb(148 163 184);
	cursor: pointer;
}

.youtube-player-hotkey-guide__header button:hover,
.youtube-player-hotkey-guide__header button:focus-visible {
	color: white;
}

.youtube-player-hotkey-guide__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.4rem 0.8rem;
	padding: 0.7rem 0.8rem 0.8rem;
}

.youtube-player-hotkey-guide__item {
	display: flex;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	font-size: 0.75rem;
	color: rgb(203 213 225);
}

.youtube-player-hotkey-guide__item kbd {
	flex: none;
	min-width: 3rem;
	padding: 0.18rem 0.35rem;
	border: 1px solid rgb(100 116 139 / 60%);
	border-bottom-color: rgb(148 163 184 / 75%);
	border-radius: 0.18rem;
	background: rgb(30 41 59 / 82%);
	color: rgb(241 245 249);
	font-family: inherit;
	font-size: 0.68rem;
	font-weight: 650;
	line-height: 1.2;
	text-align: center;
	white-space: nowrap;
}

.youtube-player-container--fullscreen {
	position: fixed !important;
	inset: 0 !important;
	z-index: 2147483647;
	width: 100vw !important;
	height: 100vh !important;
	max-width: none !important;
	margin: 0 !important;
	border-radius: 0 !important;
	background: rgb(229 231 235);
}

.youtube-player-container--fullscreen > .youtube-player-frame,
.youtube-player-container--fullscreen iframe {
	width: 100% !important;
	height: 100% !important;
	border-radius: 0 !important;
}
</style>
