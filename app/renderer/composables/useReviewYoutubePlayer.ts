import log from 'electron-log/renderer';
import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

import { hasReviewSeekReachedTarget } from '@/renderer/reviewSeekCoordinator';
import YTPlayer from '@/renderer/yt-player';

export type ReviewYoutubePlayerState =
	| 'unstarted'
	| 'cued'
	| 'playing'
	| 'paused'
	| 'buffering'
	| 'ended';

type ReviewYoutubePlayerOptions = {
	iframe: Readonly<Ref<HTMLIFrameElement | null>>;
	onBeforePlayerChange: () => void;
	onPlaybackUnavailable: (message: string) => void;
	onPlaybackError: (message: string) => void;
	onTimeUpdate: (seconds: number) => void;
	onReady: () => void;
	onStateChange: (state: ReviewYoutubePlayerState) => void;
	onPlaybackRateChange: (rate: number) => void;
	revealControls: () => void;
	keepControlsVisible: () => void;
};

const VIDEO_TIME_UPDATE_HZ = 16;
const SEEK_STALE_TIME_UPDATE_GUARD_MS = 10_000;

type PendingPlayerTimeSeek = {
	fromSeconds: number;
	targetSeconds: number;
	issuedAt: number;
};

export function useReviewYoutubePlayer(options: ReviewYoutubePlayerOptions) {
	const player = ref<YTPlayer | null>(null);
	const isLoaded = ref(false);
	const isPlaying = ref(false);
	const currentTime = ref(0);
	const reloadRevision = ref(0);
	const stateRevision = ref(0);
	const seekRevision = ref(0);
	let reloadTimeout: number | null = null;
	let pendingPlayerTimeSeek: PendingPlayerTimeSeek | null = null;

	function reload(): void {
		reloadRevision.value++;
		log.info('Reloading YouTube player, reload count:', reloadRevision.value);
	}

	function scheduleReload(): void {
		if (reloadTimeout !== null) window.clearTimeout(reloadTimeout);
		reloadTimeout = window.setTimeout(() => {
			reloadTimeout = null;
			reload();
		}, 1500);
	}

	function dispatchSeek(seconds: number): void {
		seekRevision.value++;
		const targetSeconds = Math.max(0, seconds);
		pendingPlayerTimeSeek = {
			fromSeconds: player.value?.getCurrentTime() ?? currentTime.value,
			targetSeconds,
			issuedAt: performance.now(),
		};
		// The iframe may report its old time while entering buffering and then stop
		// emitting updates when a seek remains paused. Move the application clock
		// immediately; the next coherent iframe observation confirms it.
		currentTime.value = targetSeconds;
		player.value?.seek(targetSeconds);
	}

	function dispatchLoad(videoID: string, autoplay: boolean, seconds: number): void {
		seekRevision.value++;
		const targetSeconds = Math.max(0, seconds);
		pendingPlayerTimeSeek = {
			fromSeconds: player.value?.getCurrentTime() ?? currentTime.value,
			targetSeconds,
			issuedAt: performance.now(),
		};
		currentTime.value = targetSeconds;
		player.value?.load(videoID, autoplay, targetSeconds);
	}

	function acceptPlayerTimeUpdate(seconds: number): boolean {
		const pending = pendingPlayerTimeSeek;
		if (!pending) return true;
		if (
			performance.now() - pending.issuedAt < SEEK_STALE_TIME_UPDATE_GUARD_MS
			&& !hasReviewSeekReachedTarget(
				pending.fromSeconds,
				pending.targetSeconds,
				seconds,
			)
		) return false;
		pendingPlayerTimeSeek = null;
		return true;
	}

	function emitStoppedState(state: Exclude<ReviewYoutubePlayerState, 'playing'>): void {
		stateRevision.value++;
		options.onStateChange(state);
		isPlaying.value = false;
		options.keepControlsVisible();
	}

	watch(options.iframe, (element) => {
		options.onBeforePlayerChange();
		pendingPlayerTimeSeek = null;
		stateRevision.value++;
		isPlaying.value = false;
		options.keepControlsVisible();

		if (player.value) {
			log.info('Destroying existing YouTube player instance');
			player.value.destroy();
			player.value = null;
			isLoaded.value = false;
		}
		if (!element) return;

		log.info('Creating new YouTube player instance');
		const nextPlayer = new YTPlayer(element, {
			autoplay: true,
			// Keep YouTube's quality, captions, and settings controls available.
			controls: true,
			// Fullscreen is app-owned so YouTube cannot create a competing state.
			fullscreen: false,
			height: '100%',
			host: 'https://www.youtube-nocookie.com',
			keyboard: false,
			timeupdateFrequency: 1000 / VIDEO_TIME_UPDATE_HZ,
			width: '100%',
		});
		player.value = nextPlayer;

		nextPlayer.on('unplayable', ({ videoId, errorCode, data }) => {
			pendingPlayerTimeSeek = null;
			options.onPlaybackUnavailable('YouTube could not play the selected video');
			log.info('YouTube video unplayable:', videoId, errorCode);
			log.info(nextPlayer._player);
			log.info('playerInfo', nextPlayer._player?.playerInfo);
			log.info('data', data);
			if (nextPlayer._player?.getVideoData) {
				log.info('videoData', nextPlayer._player.getVideoData());
			}
			log.info('debugText', nextPlayer._player?.getDebugText());

			// Error 150 is also emitted for the referrer failure historically handled
			// by recreating this iframe.
			if (errorCode === 150) scheduleReload();
		});

		nextPlayer.on('error', (error) => {
			pendingPlayerTimeSeek = null;
			stateRevision.value++;
			options.onPlaybackError('YouTube player error');
			log.info('YouTube embed error:', error);
			alert(`Error embedding video. Error code: ${error}`);
		});

		nextPlayer.on('timeupdate', (seconds) => {
			if (!acceptPlayerTimeUpdate(seconds)) return;
			currentTime.value = seconds;
			options.onTimeUpdate(seconds);
		});

		nextPlayer.on('unstarted', () => emitStoppedState('unstarted'));
		nextPlayer.on('cued', () => emitStoppedState('cued'));

		nextPlayer.on('ready', () => {
			stateRevision.value++;
			log.info('YouTube player ready');
			isLoaded.value = true;
			nextPlayer.mute();
			options.onReady();
		});

		nextPlayer.on('playing', () => {
			stateRevision.value++;
			isPlaying.value = true;
			options.onStateChange('playing');
			options.revealControls();
		});

		nextPlayer.on('paused', () => emitStoppedState('paused'));
		nextPlayer.on('buffering', () => emitStoppedState('buffering'));
		nextPlayer.on('ended', () => emitStoppedState('ended'));
		nextPlayer.on('playbackRateChange', options.onPlaybackRateChange);
	});

	onBeforeUnmount(() => {
		if (reloadTimeout !== null) {
			window.clearTimeout(reloadTimeout);
			reloadTimeout = null;
		}
		player.value?.destroy();
		pendingPlayerTimeSeek = null;
		player.value = null;
		isLoaded.value = false;
		isPlaying.value = false;
	});

	return {
		currentTime,
		dispatchLoad,
		dispatchSeek,
		isLoaded,
		isPlaying,
		player,
		reloadRevision,
		seekRevision,
		stateRevision,
	};
}
