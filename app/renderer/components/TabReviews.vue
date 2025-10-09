<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import Input from '@/renderer/components/Input.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

import YTPlayer from '@/renderer/yt-player';

function getClassColor(className: string) {
	switch (className?.toLowerCase()) {
		case 'deathknight': return 'text-[#C41E3A]';      // Red
		case 'demonhunter': return 'text-[#A330C9]';      // Dark Magenta
		case 'druid':        return 'text-[#FF7C0A]';      // Orange
		case 'evoker':       return 'text-[#33937F]';      // Dark Emerald
		case 'hunter':       return 'text-[#AAD372]';      // Pistachio
		case 'mage':         return 'text-[#3FC7EB]';      // Light Blue
		case 'monk':         return 'text-[#00FF98]';      // Spring Green
		case 'paladin':      return 'text-[#F48CBA]';      // Pink
		case 'priest':       return 'text-[#FFFFFF]';      // White
		case 'rogue':        return 'text-[#FFF468]';      // Yellow
		case 'shaman':       return 'text-[#0070DD]';      // Blue
		case 'warlock':      return 'text-[#8788EE]';      // Purple
		case 'warrior':      return 'text-[#C69B6D]';      // Tan
		default:             return 'text-white';
	}
}

// format seconds to mm:ss
function formatTime(t) {
	const minutes = Math.floor(t / 60);
	const seconds = Math.floor(t % 60);
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const reviewsStore = useReviewsStore();

const refreshToken = getElectronStoreRef<string | null>('WCL_REFRESH_TOKEN', null);

const youtubeLink = ref('')
const youtubeLinkStatus = ref('')

let youtubeLinkStatusResetTimeout = null as number | null;
watch(youtubeLinkStatus, (newVal) => {
	if (youtubeLinkStatusResetTimeout) clearTimeout(youtubeLinkStatusResetTimeout);
	if (newVal) {
		youtubeLinkStatusResetTimeout = window.setTimeout(() => {
			youtubeLinkStatus.value = '';
		}, 5000);
	}
});

const youtubeVideoInfo = getElectronStoreRef<any>('youtubeVideoInfo', { byId: {} });

async function requestVideoInfo() {
	const url = youtubeLink.value
	youtubeLink.value = ''

	youtubeLinkStatus.value = 'Requesting...'
	const response = await api.IR_requestYouTubeVideoInfo(url)
	if (response.videoInfo) {
		youtubeLinkStatus.value = 'Video added successfully!'
	} else {
		youtubeLinkStatus.value = response.error || 'Failed to add video.'
	}
}

const player = ref<YTPlayer | null>(null);
const playerIframe = useTemplateRef<HTMLIFrameElement | null>('playerIframe');

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

let lastFightRelativeTime = 0;
function onVideoIdChanged() {
	if (player.value) {
		const videoId = reviewsStore.getSelectedVideoId;
		if (videoId) {
			const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

			const seekTime = relativeFightStart + YOUTUBE_DELAY_OFFSET + lastFightRelativeTime;

			log.info(`Loading video ${videoId}, seeking to ${seekTime}s (relativeFightStart: ${relativeFightStart}s, lastFightRelativeTime: ${lastFightRelativeTime}s)`);

			player.value.load(videoId, true, seekTime);
		} else {
			player.value.stop();
		}
	}
}

watch(() => reviewsStore.getSelectedVideoId, (newId) => {
	onVideoIdChanged();
});

watch(() => reviewsStore.selectedFightID, (newVal) => {
	lastFightRelativeTime = 0;
	if (reviewsStore.selectedVideoInfo) {
		const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

		const seekTime = relativeFightStart + YOUTUBE_DELAY_OFFSET;

		log.info(`New fight selected, seeking to ${seekTime}s (relativeFightStart: ${relativeFightStart}s)`);

		seekTo(seekTime);
	}
});

watch(() => reviewsStore.selectedReportCode, (newVal, oldVal) => {
	if (newVal !== oldVal) {
		lastFightRelativeTime = 0;
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
		player.value.destroy();
		player.value = null;
	}
	if (el) {
		player.value = new YTPlayer(el, {
			autoplay: true,
			host: "https://www.youtube-nocookie.com",
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
		player.value.mute();
		onVideoIdChanged();
	}
});

onMounted(async () => {
	reviewsStore.requestReports();
});

async function wclAuth() {
	const res = await api.IR_WCL_GetAuthLink()
	console.log('WCL Auth Link:', res)
}

const reportOptions = computed(() => {
	const list = [
		{
			label: '--',
			value: null,
		}
	];
	list.push(...reviewsStore.getReports.map(r => ({
		label: `${r.title} - ${new Date(r.startTime).toLocaleString()}`,
		value: r.code,
	})));

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

const fightDurationDisplay = computed(() => {
	const duration = reviewsStore.getFightDuration / 1000; // in seconds
	return formatTime(duration);
});

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const videoList = computed<YouTubeVideo[]>(() => {
	const reportTimeOffset = reviewsStore.getReportTimeOffset || Date.now();
	log.info('Calculating video list with report time offset:', reportTimeOffset);
	const fightStartTime = reportTimeOffset + (reviewsStore.getSelectedFight?.startTime || 0);
	const fightEndTime = reportTimeOffset + (reviewsStore.getSelectedFight?.endTime || 0);

	const videosArray: YouTubeVideo[] = Object.values(youtubeVideoInfo.value.byId || {});

	// if no specific fight selected just check streams that were active when report started
	if (reportTimeOffset) {
		return videosArray.filter((video) => {
			// If duration is 0, treat as "still live" (endTime = startTime + 12 hours)
			const videoEnd = video.duration === 0
				? video.startTime + TWELVE_HOURS_MS
				: video.startTime + video.duration;

			// log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(videoEnd).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
			// log.info(video.startTime,
			// 	videoEnd,
			// 	fightEndTime,
			// 	fightStartTime,
			// 	(video.startTime <= fightEndTime) && (videoEnd >= fightStartTime),
			// 	video.startTime <= fightEndTime,
			// 	videoEnd >= fightStartTime
			// );
			// Check if video overlaps with fight time
			return (video.startTime <= fightEndTime) && (videoEnd >= fightStartTime);
		});
	}

	return [];
});

watch(videoList, (newList) => {
	if (!reviewsStore.selectedVideoInfo && newList.length > 0) {
		reviewsStore.setSelectedVideoInfo(newList[0]);
	}
	log.info('Filtered video list length:', newList.length);
	for (const video of newList) {
		log.info(`Video ${video.id} ${video.title} (${video.author}) from ${new Date(video.startTime).toLocaleString()} to ${new Date(video.startTime + (video.duration || 0)).toLocaleString()} checkTime: ${new Date(video.checkTime).toLocaleString()}}	`);
	}
});

const YOUTUBE_DELAY_OFFSET = -10;

// 0 - fight end, in seconds
function seekToFightTimestamp(fightTimestamp) {
	if (!player.value) return;
	const relativeFightStart = reviewsStore.getFightStartRelativeToVideo / 1000; // in seconds

	const seekTime = relativeFightStart + fightTimestamp + YOUTUBE_DELAY_OFFSET;

	log.info(`Seeking to ${seekTime}s in video (relativeFightStart: ${relativeFightStart}s, fightTimestamp: ${fightTimestamp}s)`);

	seekTo(seekTime);
	playVideo();
}

function onTimelineClick(event: MouseEvent) {
	const button = event.currentTarget as HTMLElement;
	const rect = button.getBoundingClientRect();
	const x = event.clientX - rect.left; // X position within the button
	const width = rect.width;

	// Calculate the time based on click position
	const percent = x / width;
	const fightTimestamp = percent * (reviewsStore.getFightDuration / 1000); // in seconds
	log.info(`Timeline clicked at ${x}px (width: ${width}px), fight timestamp is ${fightTimestamp}s`);

	seekToFightTimestamp(fightTimestamp);
}

const timelineTooltip = ref<{ visible: boolean; x: number; label: string }>({
	visible: false,
	x: 0,
	label: '',
});
const isDeathTooltipShown = ref(false);

function onTimelineMove(event: MouseEvent) {
	const button = event.currentTarget as HTMLElement;
	const rect = button.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const width = rect.width;

	const percent = x / width;
	const fightSeconds = percent * (reviewsStore.getFightDuration / 1000);

	timelineTooltip.value = {
		visible: true,
		x,
		label: formatTime(fightSeconds),
	};
}

function onTimelineLeave() {
  	timelineTooltip.value.visible = false;
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

const playerDeaths = computed(() => {
	const fightStartTime = reviewsStore.getFightStartTimeOffset; // in ms

	let deathID = 0;
	return reviewsStore.getFightEvents
		.map(event => {
			if (event.type !== 'death') return null;
			deathID++;
			const eventTimestamp = event.timestamp; // in ms
			const percent = (eventTimestamp - fightStartTime) / reviewsStore.getFightDuration;
			return {
				name: event.target.name,
				class: event.target.type,
				spell: event.killingAbility?.name ?? '???',
				icon: event.killingAbility?.abilityIcon ?? '',
				percent,
				timestamp: (eventTimestamp - fightStartTime) / 1000, // in seconds
				id: deathID,
			};
		})
		.filter(death => death.percent > 0 && death.percent < 1);
});

// watch(phaseTransitions, (newVal) => {
// 	log.info('Phase transitions updated:', newVal);
// }, { immediate: true });

// watch(playerDeaths, (newVal) => {
// 	log.info('Player deaths updated:', newVal);
// }, { immediate: true });

function openWCLDeath(deathID: number) {
	if (!reviewsStore.selectedReportCode || !reviewsStore.selectedFightID) return;
	api.IR_OpenWCLDeath(reviewsStore.selectedReportCode, reviewsStore.selectedFightID, deathID);
}

</script>

<template>
	<TabContent>
		<div v-if="!refreshToken" class="flex flex-col items-center">
			<UIButton @click="wclAuth" label="Authorize WCL client" class="m-5 h-10 min-w-1/3"></UIButton>
		</div>
		<div v-else class="w-full h-full flex flex-col">
			<div class="flex flex-row gap-0 h-9/10 flex-14 overflow-hidden">
				<div class="flex flex-1 flex-col max-w-[calc(100vw-350px)]">
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
					<div class="bg-gray-200 aspect-video max-w-[min(100%,80vw)] h-[calc(100%-85px)] rounded-md mt-2">

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
				<div class="w-full">
					<div class="h-[70px]">
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
					<ScrollFrame class="max-h-[calc(100%-85px)] flex flex-col">
						<template #default>
							<button v-for="video in videoList"
								:key="video.id" class=" h-8 m-0.5 rounded-md"
								:class="{
									'border-1 border-secondary dark:bg-dark1 bg-light1': video.id === reviewsStore.getSelectedVideoId,
									'dark:bg-dark4 dark:hover:bg-dark3 bg-light4 hover:bg-light3 ': video.id !== reviewsStore.getSelectedVideoId,
								}"
								@click="reviewsStore.selectedVideoInfo = video"
							>
								<div class="text-bold line-item-element flex flex-col items-start">{{ video.author }} - {{ new Date(video.startTime).toLocaleTimeString() }}</div>
							</button>
						</template>
					</ScrollFrame>
				</div>
			</div>
			<div class="flex-1 min-h-18 flex justify-center w-full">
				<!-- Timeline -->
				<button class="w-96/100 h-6 m-0.5 mt-6 rounded-md
					dark:bg-dark4 dark:hover:bg-dark3
					bg-light4 hover:bg-light3 relative"
					@click="onTimelineClick"
					@mousemove="onTimelineMove"
  					@mouseleave="onTimelineLeave"
					tabindex="-1"
  					@mousedown.prevent
				>
					<!-- Time Labels -->
					<p class="absolute left-0 bottom-[-26px] bg-black/50 rounded-md p-0.5 px-1 pointer-events-none text-sm text-white">{{ formatTime(0) }}</p>
					<p class="absolute right-0 bottom-[-26px] bg-black/50 rounded-md p-0.5 px-1 pointer-events-none text-sm text-white">{{ fightDurationDisplay }}</p>
					<!-- Phases -->
					<template v-for="phase in phaseTransitions" :key="phase.name + phase.percent">
						<div
							class="absolute top-0 bottom-0 w-[2px] bg-blue-400 z-5 pointer-events-none"
							:style="{ left: `calc(${(phase.percent * 100).toFixed(2)}%)` }"
						>
						<p class="absolute top-[-20px]">{{ phase.name }}</p>
						</div>
					</template>
					<!-- Deaths -->
					<template v-for="death in playerDeaths" :key="death.name + death.percent">
						<div
							class="absolute top-0 bottom-0 w-[2px] bg-red-600 z-5 pointer-events-none"
							:style="{ left: `calc(${(death.percent * 100).toFixed(2)}%)` }"
							>
							<div class="relative flex justify-center">
								<p class="absolute top-[-20px] text-red-600 cursor-pointer pointer-events-auto group clickable"
									@mouseover="isDeathTooltipShown = true"
									@mouseout="isDeathTooltipShown = false"
									@click="$event.stopPropagation(); seekToFightTimestamp(death.timestamp-10)"
									@contextmenu="openWCLDeath(death.id)"
								>
								💀
									<span
										class="absolute left-1/2 -translate-x-1/2 -top-18 z-30 px-2 pr-8 py-1 rounded bg-black/80 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
									>
										{{ formatTime(death.timestamp) }} <span :class="getClassColor(death.class)">{{ death.name }}</span><br /> died to
										<img v-if ="death.icon"
											:src="`https://wow.zamimg.com/images/wow/icons/large/${death.icon?.toLowerCase()}`"
											alt="Spell Icon"
											class="inline-block w-6 h-6 align-middle rounded"
										/>
										{{ death.spell }}
									</span>
								</p>
							</div>
						</div>
					</template>
					<!-- Cursor -->
					<div
						v-if="currentFightCursor > 0 && currentFightCursor < 1"
						class="absolute top-0 bottom-0 w-[2px] bg-amber-400 z-10 pointer-events-none"
						:style="{ left: `calc(${(currentFightCursor * 100).toFixed(2)}%)` }"
					></div>
					<!-- Tooltip + Mover Cursor -->
					<div v-if="timelineTooltip.visible"
						class="absolute top-0 bottom-0 w-0.5 bg-white/50 z-20 pointer-events-none"
						:style="{ left: timelineTooltip.x + 'px' }"
					></div>
					<span
						v-if="timelineTooltip.visible && !isDeathTooltipShown"
						:style="{ left: timelineTooltip.x + 'px' }"
						class="pointer-events-none absolute -top-7 z-20 px-2 py-1 rounded bg-black/80 text-xs text-white whitespace-nowrap"
					>
						{{ timelineTooltip.label }}
					</span>
				</button>
			</div>
		</div>

	</TabContent>
</template>

<style scoped>

</style>
