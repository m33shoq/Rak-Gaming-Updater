import log from 'electron-log/renderer';
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

import { IPC_EVENTS } from '@/events';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { isExcludedPlayerHotkeyTarget } from '@/renderer/reviewPlayerHotkeys';
import { hasReviewSeekReachedTarget } from '@/renderer/reviewSeekCoordinator';
import type YTPlayer from '@/renderer/yt-player';
import type { ReviewPlayerHotkeyInput } from '@/timelineWindow';

const DEFAULT_SEEK_SECONDS = 5;
const SHIFT_SEEK_SECONDS = 3;
const ALT_SEEK_SECONDS = 1;
const CTRL_SEEK_SECONDS = 60;
const TEN_SECOND_SEEK_SECONDS = 10;
const FRAME_SEEK_SECONDS = 1 / 30;
const SEEK_DEBOUNCE_MS = 80;
const SEEK_RETRY_MS = 1200;
const SEEK_MAX_PENDING_MS = 30_000;
const SEEK_TARGET_EPSILON_SECONDS = 0.001;
const SEEK_INDICATOR_MIN_VISIBLE_MS = 500;
const SEEK_HOLD_INITIAL_INTERVAL_MS = 350;
const SEEK_HOLD_FASTEST_INTERVAL_MS = 60;
const SEEK_HOLD_ACCELERATION_MS = 3500;

type PlayerMouseDownPayload = {
	clickCount: number;
};

type ReviewPlayerHotkeyOptions = {
	player: Ref<YTPlayer | null>;
	isPlaying: Ref<boolean>;
	hasSelectedVideo: () => boolean;
	revealControls: () => void;
	closeHotkeyGuide: () => boolean;
	requestFullscreenToggle: () => void;
	requestQueuedSeek: (seconds: number) => void;
	dispatchFrameSeek: (seconds: number) => void;
	cancelActiveSeek: (reason: string) => void;
	cancelSynchronizedSeek: (reason: string) => void;
};

function formatSeekDelta(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function useReviewPlayerHotkeys(options: ReviewPlayerHotkeyOptions) {
	const queuedSeekDeltaSeconds = ref<number | null>(null);
	let seekDispatchTimeout: number | null = null;
	let seekRetryTimeout: number | null = null;
	let seekIndicatorHideTimeout: number | null = null;
	let seekIndicatorUpdatedAt = 0;
	let seekIndicatorCommittedDeltaSeconds = 0;
	let seekHoldState: {
		signature: string;
		startedAt: number;
		lastAcceptedAt: number;
	} | null = null;
	let seekState: {
		originSeconds: number;
		targetSeconds: number;
		dispatchedFromSeconds: number | null;
		dispatchedTargetSeconds: number | null;
		dispatchedAt: number | null;
		playbackRateAtDispatch: number;
		wasPlayingAtDispatch: boolean;
		lastInputAt: number;
	} | null = null;

	const queuedSeekDeltaLabel = computed(() => {
		const delta = queuedSeekDeltaSeconds.value;
		if (delta === null) return '';
		const absoluteDelta = Math.abs(delta);
		const precision = absoluteDelta > 0 && absoluteDelta < 0.1
			? 2
			: Number.isInteger(absoluteDelta) ? 0 : 1;
		const sign = delta > SEEK_TARGET_EPSILON_SECONDS
			? '+'
			: delta < -SEEK_TARGET_EPSILON_SECONDS ? '-' : '';
		if (absoluteDelta >= 60) return `${sign}${formatSeekDelta(Math.round(absoluteDelta))}`;
		return `${sign}${absoluteDelta.toFixed(precision)}s`;
	});

	const queuedSeekDirectionClass = computed(() => {
		const delta = queuedSeekDeltaSeconds.value;
		if (delta !== null && delta < -SEEK_TARGET_EPSILON_SECONDS) {
			return 'youtube-player-seek-queue--backward';
		}
		if (delta !== null && delta > SEEK_TARGET_EPSILON_SECONDS) {
			return 'youtube-player-seek-queue--forward';
		}
		return 'youtube-player-seek-queue--neutral';
	});

	function clearSeekTimeouts(): void {
		if (seekDispatchTimeout !== null) {
			window.clearTimeout(seekDispatchTimeout);
			seekDispatchTimeout = null;
		}
		if (seekRetryTimeout !== null) {
			window.clearTimeout(seekRetryTimeout);
			seekRetryTimeout = null;
		}
	}

	function hideQueuedSeekIndicator(): void {
		if (seekIndicatorHideTimeout !== null) {
			window.clearTimeout(seekIndicatorHideTimeout);
			seekIndicatorHideTimeout = null;
		}
		queuedSeekDeltaSeconds.value = null;
		seekIndicatorCommittedDeltaSeconds = 0;
	}

	function showQueuedSeekIndicator(deltaSeconds: number): void {
		if (seekIndicatorHideTimeout !== null) {
			window.clearTimeout(seekIndicatorHideTimeout);
			seekIndicatorHideTimeout = null;
		}
		seekIndicatorUpdatedAt = performance.now();
		queuedSeekDeltaSeconds.value = deltaSeconds;
	}

	function finishQueuedSeek(): void {
		const completedState = seekState;
		if (completedState) {
			seekIndicatorCommittedDeltaSeconds += completedState.targetSeconds
				- completedState.originSeconds;
		}
		clearSeekTimeouts();
		seekState = null;
		const remainingVisibleMs = SEEK_INDICATOR_MIN_VISIBLE_MS
			- (performance.now() - seekIndicatorUpdatedAt);
		if (remainingVisibleMs <= 0) {
			hideQueuedSeekIndicator();
			return;
		}
		seekIndicatorHideTimeout = window.setTimeout(() => {
			seekIndicatorHideTimeout = null;
			hideQueuedSeekIndicator();
		}, remainingVisibleMs);
	}

	function clearQueuedSeek(): void {
		clearSeekTimeouts();
		seekState = null;
		seekHoldState = null;
		hideQueuedSeekIndicator();
	}

	function togglePlayPause(): void {
		const activePlayer = options.player.value;
		if (!activePlayer) return;

		const state = activePlayer.getState();
		if (state === 'playing' || state === 'buffering') {
			activePlayer.pause();
			return;
		}

		activePlayer.play();
	}

	function toggleMute(): void {
		const activePlayer = options.player.value;
		if (!activePlayer) return;

		if (activePlayer.isMuted()) {
			activePlayer.unMute();
			return;
		}

		activePlayer.mute();
	}

	function getArrowSeekDelta(
		input: Pick<ReviewPlayerHotkeyInput, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
	): number {
		if (input.ctrlKey || input.metaKey) return CTRL_SEEK_SECONDS;
		if (input.shiftKey) return SHIFT_SEEK_SECONDS;
		if (input.altKey) return ALT_SEEK_SECONDS;
		return DEFAULT_SEEK_SECONDS;
	}

	function clampSeekTarget(seconds: number): number {
		const duration = options.player.value?.getDuration() || 0;
		return Math.max(0, Math.min(seconds, duration > 0 ? duration : Number.POSITIVE_INFINITY));
	}

	function isDispatchedSeekComplete(currentTime: number): boolean {
		const state = seekState;
		if (
			!state
			|| state.dispatchedFromSeconds === null
			|| state.dispatchedTargetSeconds === null
		) return false;

		const fromSeconds = state.dispatchedFromSeconds;
		const targetSeconds = state.dispatchedTargetSeconds;
		if (!hasReviewSeekReachedTarget(fromSeconds, targetSeconds, currentTime)) return false;
		if (targetSeconds > fromSeconds) {
			if (!state.wasPlayingAtDispatch || state.dispatchedAt === null) return true;

			// Crossing a forward target is not proof that YouTube accepted the seek: for
			// a one-second hotkey the video can naturally reach it before the retry. A
			// successful seek must put playback measurably ahead of that natural path.
			const elapsedSeconds = Math.max(0, performance.now() - state.dispatchedAt) / 1000;
			const naturallyReachableTime = fromSeconds
				+ elapsedSeconds * state.playbackRateAtDispatch
				+ 0.2;
			return currentTime > naturallyReachableTime;
		}
		return true;
	}

	function dispatchQueuedSeek(): void {
		const state = seekState;
		if (!state || !options.player.value || !options.hasSelectedVideo()) {
			clearQueuedSeek();
			return;
		}

		clearSeekTimeouts();
		state.targetSeconds = clampSeekTarget(state.targetSeconds);
		state.dispatchedFromSeconds = options.player.value.getCurrentTime();
		state.dispatchedTargetSeconds = state.targetSeconds;
		state.dispatchedAt = performance.now();
		state.playbackRateAtDispatch = options.player.value.getPlaybackRate();
		state.wasPlayingAtDispatch = options.isPlaying.value;
		options.requestQueuedSeek(state.targetSeconds);

		seekRetryTimeout = window.setTimeout(() => {
			seekRetryTimeout = null;
			const pendingState = seekState;
			if (!pendingState) return;
			const currentTime = options.player.value?.getCurrentTime();
			if (typeof currentTime === 'number' && isDispatchedSeekComplete(currentTime)) {
				onPlayerTimeUpdate(currentTime);
				return;
			}
			if (Date.now() - pendingState.lastInputAt >= SEEK_MAX_PENDING_MS) {
				log.warn('YouTube hotkey seek was not confirmed before timeout', {
					targetSeconds: pendingState.targetSeconds,
				});
				clearQueuedSeek();
				return;
			}
			dispatchQueuedSeek();
		}, SEEK_RETRY_MS);
	}

	function scheduleQueuedSeek(): void {
		if (seekDispatchTimeout !== null) window.clearTimeout(seekDispatchTimeout);
		seekDispatchTimeout = window.setTimeout(() => {
			seekDispatchTimeout = null;
			dispatchQueuedSeek();
		}, SEEK_DEBOUNCE_MS);
	}

	function onPlayerTimeUpdate(currentTime: number): void {
		const state = seekState;
		if (!state || !isDispatchedSeekComplete(currentTime)) return;

		const dispatchedTarget = state.dispatchedTargetSeconds;
		if (
			dispatchedTarget !== null
			&& Math.abs(state.targetSeconds - dispatchedTarget) > SEEK_TARGET_EPSILON_SECONDS
		) {
			state.dispatchedFromSeconds = null;
			state.dispatchedTargetSeconds = null;
			state.dispatchedAt = null;
			dispatchQueuedSeek();
			return;
		}

		finishQueuedSeek();
	}

	function seekByDelta(delta: number): boolean {
		const activePlayer = options.player.value;
		if (!activePlayer) return false;
		options.cancelActiveSeek('Relative hotkey seek');
		options.cancelSynchronizedSeek('Relative hotkey seek superseded synchronized seek');

		if (!seekState) {
			const currentTime = activePlayer.getCurrentTime();
			seekState = {
				originSeconds: currentTime,
				targetSeconds: currentTime,
				dispatchedFromSeconds: null,
				dispatchedTargetSeconds: null,
				dispatchedAt: null,
				playbackRateAtDispatch: activePlayer.getPlaybackRate(),
				wasPlayingAtDispatch: options.isPlaying.value,
				lastInputAt: Date.now(),
			};
		}

		seekState.targetSeconds = clampSeekTarget(seekState.targetSeconds + delta);
		seekState.lastInputAt = Date.now();
		showQueuedSeekIndicator(
			seekIndicatorCommittedDeltaSeconds + seekState.targetSeconds - seekState.originSeconds,
		);

		if (seekState.dispatchedTargetSeconds === null) scheduleQueuedSeek();
		return true;
	}

	function seekByCurrentPlayerTime(delta: number): boolean {
		const activePlayer = options.player.value;
		if (!activePlayer) return false;
		const currentTime = activePlayer.getCurrentTime();
		// Frame stepping intentionally bypasses the queued seek coordinator. Its tiny,
		// immediate steps are the useful behavior and must not wait for marker checks.
		options.cancelActiveSeek('Frame step');
		options.cancelSynchronizedSeek('Frame step');
		options.dispatchFrameSeek(clampSeekTarget(currentTime + delta));
		return true;
	}

	function getQueuedSeekHotkeySignature(input: ReviewPlayerHotkeyInput | KeyboardEvent): string {
		return [
			input.code,
			input.altKey ? 'alt' : '',
			input.ctrlKey ? 'ctrl' : '',
			input.metaKey ? 'meta' : '',
			input.shiftKey ? 'shift' : '',
		].join(':');
	}

	function shouldApplyQueuedSeekHotkey(input: ReviewPlayerHotkeyInput | KeyboardEvent): boolean {
		const now = performance.now();
		const signature = getQueuedSeekHotkeySignature(input);
		if (!input.repeat || seekHoldState?.signature !== signature) {
			seekHoldState = {
				signature,
				startedAt: now,
				lastAcceptedAt: now,
			};
			return true;
		}

		const heldForMs = now - seekHoldState.startedAt;
		const accelerationProgress = Math.min(1, heldForMs / SEEK_HOLD_ACCELERATION_MS);
		const repeatIntervalMs = SEEK_HOLD_INITIAL_INTERVAL_MS
			- (SEEK_HOLD_INITIAL_INTERVAL_MS - SEEK_HOLD_FASTEST_INTERVAL_MS)
			* accelerationProgress;
		if (now - seekHoldState.lastAcceptedAt < repeatIntervalMs) return false;
		seekHoldState.lastAcceptedAt = now;
		return true;
	}

	function getPlayerIframeElement(): HTMLIFrameElement | null {
		const iframe = options.player.value?._player?.getIframe?.();
		return iframe instanceof HTMLIFrameElement ? iframe : null;
	}

	function isPlayerHotkeyContext(): boolean {
		return document.activeElement === getPlayerIframeElement();
	}

	function onPlayerDoubleClick(): void {
		options.requestFullscreenToggle();
	}

	function onPlayerMouseDown(input: PlayerMouseDownPayload): void {
		if (!isPlayerHotkeyContext()) return;
		if (input.clickCount === 2) {
			// YouTube handles the first click as play/pause before the app recognizes the
			// double-click. Reverse that action so fullscreen does not change playback.
			togglePlayPause();
			onPlayerDoubleClick();
		}
	}

	function handlePlayerHotkey(input: ReviewPlayerHotkeyInput | KeyboardEvent): boolean {
		if (!options.player.value || !options.hasSelectedVideo()) return false;
		options.revealControls();

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
			if (!input.repeat) options.requestFullscreenToggle();
			return true;
		}

		return false;
	}

	function onPlayerKeyDown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (event.code === 'Escape' && options.closeHotkeyGuide()) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (isExcludedPlayerHotkeyTarget(event.target)) return;
		handlePlayerHotkey(event);
	}

	useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_HOTKEY_CALLBACK, (_event, input: ReviewPlayerHotkeyInput) => {
		if (!isPlayerHotkeyContext()) return;
		handlePlayerHotkey(input);
	});

	useIpcOn(
		IPC_EVENTS.YOUTUBE_PLAYER_DOUBLE_CLICK_CALLBACK,
		(_event, input: PlayerMouseDownPayload) => onPlayerMouseDown(input),
	);

	onMounted(() => window.addEventListener('keydown', onPlayerKeyDown));
	onBeforeUnmount(() => {
		window.removeEventListener('keydown', onPlayerKeyDown);
		clearQueuedSeek();
	});

	return {
		clampSeekTarget,
		clearQueuedSeek,
		handlePlayerHotkey,
		onPlayerDoubleClick,
		onPlayerTimeUpdate,
		queuedSeekDeltaLabel,
		queuedSeekDeltaSeconds,
		queuedSeekDirectionClass,
		togglePlayPause,
	};
}
