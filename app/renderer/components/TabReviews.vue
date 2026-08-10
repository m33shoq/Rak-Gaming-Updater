<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

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

const DEFAULT_SEEK_SECONDS = 5;
const SHIFT_SEEK_SECONDS = 3;
const ALT_SEEK_SECONDS = 1;
const CTRL_SEEK_SECONDS = 60;
const TEN_SECOND_SEEK_SECONDS = 10;
const FRAME_SEEK_SECONDS = 1 / 30;

type PlayerHotkeyPayload = {
	key: string;
	code: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
};

type PlayerMouseDownPayload = {
	clickCount: number;
};

const PLAYER_DOUBLE_CLICK_THRESHOLD_MS = 300;
const PLAYER_FULLSCREEN_TOGGLE_COOLDOWN_MS = 400;
let lastPlayerMouseDownAt = 0;
let lastFullscreenToggleAt = 0;

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

function seekTo(seconds: number) {
  	if (player.value) {
		player.value.seek(seconds);
  	}
}

function togglePlayPause() {
	if (!player.value) return;

	if (player.value.getState() === 'playing') {
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
	if (!fullscreenTarget) return;

	if (document.fullscreenElement === fullscreenTarget) {
		await document.exitFullscreen();
		return;
	}

	await fullscreenTarget.requestFullscreen();
}

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;

	return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function getArrowSeekDelta(input: Pick<PlayerHotkeyPayload, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
	if (input.ctrlKey || input.metaKey) return CTRL_SEEK_SECONDS;
	if (input.shiftKey) return SHIFT_SEEK_SECONDS;
	if (input.altKey) return ALT_SEEK_SECONDS;
	return DEFAULT_SEEK_SECONDS;
}

function seekByDelta(delta: number, source: string) {
	if (!player.value) return false;

	const currentTime = player.value.getCurrentTime();
	const duration = player.value.getDuration();
	const maxTime = duration > 0 ? duration : Number.POSITIVE_INFINITY;
	const nextTime = Math.max(0, Math.min(currentTime + delta, maxTime));

	// log.debug(`${source}: ${currentTime}s -> ${nextTime}s (delta: ${delta}s)`);
	seekTo(nextTime);
	return true;
}

function getPlayerIframeElement() {
	const iframe = player.value?._player?.getIframe?.();
	return iframe instanceof HTMLIFrameElement ? iframe : null;
}

function isPlayerHotkeyContext() {
	return document.activeElement === getPlayerIframeElement();
}

function onPlayerDoubleClick() {
	const now = Date.now();
	if (now - lastFullscreenToggleAt < PLAYER_FULLSCREEN_TOGGLE_COOLDOWN_MS) return;
	lastFullscreenToggleAt = now;
	lastPlayerMouseDownAt = 0;
	void toggleFullscreen();
}

function onPlayerMouseDown(input: PlayerMouseDownPayload) {
	if (!isPlayerHotkeyContext()) return;

	const now = Date.now();
	const isRapidSecondClick = lastPlayerMouseDownAt > 0
		&& now - lastPlayerMouseDownAt <= PLAYER_DOUBLE_CLICK_THRESHOLD_MS;

	lastPlayerMouseDownAt = now;

	if (input.clickCount >= 2 || isRapidSecondClick) {
		onPlayerDoubleClick();
	}
}

function handlePlayerHotkey(input: PlayerHotkeyPayload | KeyboardEvent) {
	if (!player.value || !reviewsStore.getSelectedVideoId) return false;

	if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
		const delta = getArrowSeekDelta(input);
		const direction = input.key === 'ArrowRight' ? 1 : -1;

		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		return seekByDelta(direction * delta, `Custom seek via ${input.key}`);
	}

	if (input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return false;

	if (input.code === 'KeyJ' || input.code === 'KeyL') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}

		const direction = input.code === 'KeyL' ? 1 : -1;
		return seekByDelta(direction * TEN_SECOND_SEEK_SECONDS, `Fixed seek via ${input.code}`);
	}

	if (input.code === 'Comma' || input.code === 'Period') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}

		const direction = input.code === 'Period' ? 1 : -1;
		return seekByDelta(direction * FRAME_SEEK_SECONDS, `Frame seek via ${input.code}`);
	}

	if (input.code === 'Space' || input.code === 'KeyK') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		togglePlayPause();
		return true;
	}

	if (input.code === 'KeyM') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		toggleMute();
		return true;
	}

	if (input.code === 'KeyF') {
		if ('preventDefault' in input) {
			input.preventDefault();
			input.stopPropagation();
		}
		void toggleFullscreen();
		return true;
	}

	return false;
}

function onPlayerKeyDown(event: KeyboardEvent) {
	if (event.defaultPrevented) return;
	if (isEditableTarget(event.target)) return;
	handlePlayerHotkey(event);
}

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_HOTKEY_CALLBACK, (event, input: PlayerHotkeyPayload) => {
	if (!isPlayerHotkeyContext()) return;
	handlePlayerHotkey(input);
});

useIpcOn(IPC_EVENTS.YOUTUBE_PLAYER_DOUBLE_CLICK_CALLBACK, (event, input: PlayerMouseDownPayload) => {
	onPlayerMouseDown(input);
});

let lastFightRelativeTime = 0;
function onVideoIdChanged() {
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
			host: "https://www.youtube-nocookie.com",
			keyboard: false,
			timeupdateFrequency: 200, // ms
		});

		player.value.on('unplayable', ({ videoId, errorCode, data }) => {
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
			log.info("YouTube embed error:", error);
			alert(`Error embedding video. Error code: ${error}`);
		});

		player.value.on('timeupdate', (seconds) => {
			currentVideoTime.value = seconds;
		});

		player.value.on('cued', () => {
			playVideo();
		});

		player.value.on('ready', () => {
			log.info('YouTube player ready');
			playerLoaded = true;
			player.value.mute();
			onVideoIdChanged();
		});
	}
});

onMounted(async () => {
	window.addEventListener('keydown', onPlayerKeyDown);
	const requestedAtRevision = wclAuthorizationStatusRevision;
	try {
		const authorized = await ipc.invoke(IPC_EVENTS.WCL_AUTH_STATUS_GET);
		if (wclAuthorizationStatusRevision === requestedAtRevision) {
			applyWclAuthorizationStatus(authorized);
		}
	} catch (error) {
		log.error('Failed to load WCL authorization status', error);
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onPlayerKeyDown);
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
	const encounterToCount = new Map<number, number>();
	for (let i = fights.length - 1; i >= 0; i--) {
		const f = fights[i];
		const encounterID = f.encounterID;
		const currentCount = encounterToCount.get(encounterID) || 0;
		encounterToCount.set(encounterID, currentCount + 1);

		idToCount.set(f.id, currentCount + 1);
	}

	list.push(...fights.map(f => {
		const count = idToCount.get(f.id) || 0;

		return {
			label: `#${count} ${f.name} ${f.kill ? 'KILL' : (f.bossPercentage).toFixed(1) + '%'} ${formatTime((f.endTime - f.startTime) / 1000)} (${new Date(timeOffset + f.startTime).toLocaleTimeString()})`,
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

function openYoutubeLink(videoId: string) {
	ipc.send(IPC_EVENTS.YOUTUBE_OPEN_LINK, videoId);
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
						class="bg-gray-200 aspect-video max-w-[min(100%,80vw)] h-[calc(100%-85px)] rounded-md mt-2"
						@dblclick="onPlayerDoubleClick"
					>
						<div :key="playerReloads" v-show="reviewsStore.selectedVideoInfo" class="w-full h-full relative">
							<div
								allow="autoplay; encrypted-media; fullscreen"
								referrerpolicy="strict-origin-when-cross-origin"
								ref="playerIframe"
								class="rounded-md w-full h-full z-50"
							></div>
						</div>
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
								@click="openYoutubeLink(video.id)"
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
						v-if="reviewsStore.selectedFightID && reviewsStore.getFightDuration > 0"
						:events="reviewsStore.getFightCooldownEvents"
						:fight-events="reviewsStore.getFightEvents"
						:groups="reviewsStore.getFightCooldownGroups"
						:phases="phaseTransitions"
						:fight-start-time="reviewsStore.getFightStartTimeOffset"
						:fight-duration="reviewsStore.getFightDuration"
						:cursor-percent="currentFightCursor"
						:loading="reviewsStore.isFightCooldownsLoading"
						:error="reviewsStore.getFightCooldownError"
						@seek="seekToFightTimestamp"
						@open-fight="openWCLFight"
						@open-death="openWCLDeath"
						@seek-pull="seekToPullTimestamp"
						@open-pull-death="openWCLPullDeath"
					/>
				</div>
			</div>
		</div>
	</TabContent>
</template>
