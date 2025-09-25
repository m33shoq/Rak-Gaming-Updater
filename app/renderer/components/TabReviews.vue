<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import Input from '@/renderer/components/Input.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { useWCLDataStore } from '@/renderer/store/WCLDataStore';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

// Add global type for YT
declare global {
  interface Window {
	YT: any;
	onYouTubeIframeAPIReady: () => void;
  }
}

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

const wclDataStore = useWCLDataStore();

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

const selectedVideoInfo = ref<YouTubeVideo | null>(null)
const selectedVideoId = computed(() => selectedVideoInfo.value?.id || null);

/*
player.playVideo() → Start playback
player.pauseVideo() → Pause
player.stopVideo() → Stop playback
player.seekTo(seconds, allowSeekAhead) → Jump to timestamp
player.getCurrentTime() → Current playback position (seconds)
player.getDuration() → Video length (seconds)
player.mute() / unMute() → Toggle audio
player.setVolume(volume) → 0–100
player.getPlayerState() → Returns state (e.g., 1 = playing, 2 = paused, -1 = unstarted)
player.setPlaybackRate(rate) → Change speed
player.setSize(width, height) → Resize
*/
const player = ref<YT.Player | null>(null);

function playVideo() {
	if (player.value) {
		player.value.playVideo();
	}
}

function pauseVideo() {
	if (player.value) {
		player.value.pauseVideo();
	}
}

function seekTo(seconds: number) {
  	if (player.value) {
		player.value.seekTo(seconds, true);
  	}
}

watch(selectedVideoInfo, () => {
	if (player.value) {
		if (selectedVideoInfo.value) {
			const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
			const fightStartTime = (reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0) / 1000; // in seconds
			const videoStartTime = selectedVideoInfo.value.startTime / 1000; // in seconds

			const seekTime = fightStartTime - videoStartTime + YOUTUBE_DELAY_OFFSET;

			log.info(`Loading video ${selectedVideoInfo.value.id}, seeking to ${seekTime}s (fight start: ${fightStartTime}s, video start: ${videoStartTime}s)`);

			player.value.loadVideoById(selectedVideoInfo.value?.id || '', seekTime);
			// pauseVideo();
		} else {
			player.value.stopVideo();
		}
	}
});

function loadYouTubeAPI(): Promise<typeof YT> {
	return new Promise((resolve) => {
		if (window.YT && window.YT.Player) {
	  		resolve(window.YT);
		} else {
			const tag = document.createElement("script");
			tag.src = "https://www.youtube.com/iframe_api";
			document.body.appendChild(tag);

	  		window.onYouTubeIframeAPIReady = () => {
				resolve(window.YT);
	  		};
		}
  });
}

let cursorUpdateInterval = null as number | null;
const currentVideoTime = ref(0);

onMounted(async () => {
	wclDataStore.requestReports();
	cursorUpdateInterval = window.setInterval(() => {
        if (player.value) {
			currentVideoTime.value = player.value.getCurrentTime?.() ?? 0;
		}
    }, 200); // update every 200ms

	if (player.value) return;

  	const YT = await loadYouTubeAPI();

	player.value = new YT.Player("player", {
		videoId: selectedVideoId.value,
		events: {
			onReady: () => {
				console.log("YouTube player ready");
			},
			onStateChange: (event) => {
				console.log("State changed:", event.data);
			}
		},
		playerVars: {
			autoplay: 0,
			controls: 1,
			rel: 0,
			showinfo: 0,
			modestbranding: 1
		}
	});
});

onUnmounted(() => {
    if (cursorUpdateInterval) clearInterval(cursorUpdateInterval);
});

async function wclAuth() {
	const res = await api.IR_WCL_GetAuthLink()
	console.log('WCL Auth Link:', res)
}

const reportOptions = computed(() => {
	return wclDataStore.getReports.map(r => ({
		label: `${r.title} - ${new Date(r.startTime).toLocaleString()}`,
		value: r.code,
	}));
});

const fightOptions = computed(() => {
	if (!wclDataStore.getSelectedReport || !wclDataStore.getReportDetails?.fights) return [];

	const timeOffset = wclDataStore.getReportDetails.startTime;

	return wclDataStore.getReportDetails?.fights?.map(f => ({
		label: `#${f.id} ${f.name} ${f.kill ? 'KILL' : (f.bossPercentage).toFixed(1) + '%'} ${formatTime((f.endTime - f.startTime) / 1000)} (${new Date(timeOffset + f.startTime).toLocaleTimeString()})`,
		value: f.id,
	})) || [];
});

// in ms
const fightDuration = computed(() => {
	if (!wclDataStore.getSelectedFight) return 0;
	return (wclDataStore.getSelectedFight.endTime - wclDataStore.getSelectedFight.startTime);
});

const fightDurationDisplay = computed(() => {
	const duration = fightDuration.value / 1000; // in seconds
	return formatTime(duration);
});

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const videoList = computed<YouTubeVideo[]>(() => {
	const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
	const fightStartTime = reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0;
	const fightEndTime = reportTimeOffset + wclDataStore.getSelectedFight?.endTime || 0;

	if (!fightStartTime || !fightEndTime) return [];

	const videosArray: YouTubeVideo[] = Object.values(youtubeVideoInfo.value.byId || {});

	return videosArray.filter((video) => {
		// If duration is 0, treat as "still live" (endTime = startTime + 12 hours)
		const videoEnd = video.duration === 0
			? video.startTime + TWELVE_HOURS_MS
			: video.startTime + video.duration;

		// Check if video overlaps with fight time
		return (video.startTime < fightEndTime) && (videoEnd > fightStartTime);
	});
});

const YOUTUBE_DELAY_OFFSET = -8

// 0 - fight end, in seconds
function seekToFightTimestamp(fightTimestamp) {
	if (!player.value) return;
	if (!fightDuration.value) return;
	if (!selectedVideoInfo.value) return;

	const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
	const fightStartTime = (reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0) / 1000; // in seconds
	const videoStartTime = selectedVideoInfo.value.startTime / 1000; // in seconds

	const seekTime = fightStartTime + fightTimestamp - videoStartTime + YOUTUBE_DELAY_OFFSET;

	log.info(`Seeking to ${seekTime}s in video (fight start: ${fightStartTime}s, video start: ${videoStartTime}s)`);

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
	const fightTimestamp = percent * (fightDuration.value / 1000); // in seconds
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
	const fightSeconds = percent * (fightDuration.value / 1000);

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
    if (!player.value || !fightDuration.value) return 0;

    // Calculate fight start and video start in seconds
    const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
    const fightStartTime = (reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0) / 1000;
    const videoStartTime = selectedVideoInfo.value?.startTime / 1000 || 0;

    // Calculate current fight-relative time
    const fightRelativeTime = currentVideoTime.value + videoStartTime - fightStartTime - YOUTUBE_DELAY_OFFSET;

    // Clamp between 0 and fightDuration (in seconds)
    const fightDurationSec = fightDuration.value / 1000;
    const clamped = Math.max(0, Math.min(fightRelativeTime, fightDurationSec));

	// log.debug(`Current video time: ${currentVideoTime}s, fight relative time: ${fightRelativeTime}s, clamped: ${clamped}s`);

    // Return as percent (0 to 1)
    return clamped / fightDurationSec;
});

const phaseTransitions = computed(() => {
	const selectedReportDetails = wclDataStore.getReportDetails;
	const selectedFight = wclDataStore.getSelectedFight;

	if (!selectedReportDetails?.phases || !selectedFight?.phaseTransitions || !fightDuration.value) return [];
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

	const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
	const fightStartTime = (reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0); // in ms

	return wclDataStore.getSelectedFight.phaseTransitions
		.map(phase => {
			const phaseId = phase.id;
			const phaseStart = reportTimeOffset + phase.startTime; // in ms
			const percent = (phaseStart - fightStartTime) / fightDuration.value;
			return {
				name: phaseIdToText.get(phaseId) || phaseId,
				percent,
			};
		})
		.filter(phase => phase.percent > 0 && phase.percent < 1); // exclude start and end
});

const playerDeaths = computed(() => {
	const reportTimeOffset = wclDataStore.getReportDetails?.startTime || 0;
	const fightStartTime = (reportTimeOffset + wclDataStore.getSelectedFight?.startTime || 0); // in ms

	return wclDataStore.getFightEvents
		.map(event => {
			if (event.type !== 'death') return null;
			const eventTimestamp = reportTimeOffset + event.timestamp; // in ms
			const percent = (eventTimestamp - fightStartTime) / fightDuration.value;
			return {
				name: event.target.name,
				class: event.target.type,
				spell: event.ability?.name ?? 'Unknown',
				percent,
				timestamp: (eventTimestamp - fightStartTime) / 1000, // in seconds
			};
		})
});

// watch(phaseTransitions, (newVal) => {
// 	log.info('Phase transitions updated:', newVal);
// }, { immediate: true });

// watch(playerDeaths, (newVal) => {
// 	log.info('Player deaths updated:', newVal);
// }, { immediate: true });

</script>

<template>
	<TabContent>
		<div v-if="!refreshToken" class="flex flex-col items-center">
			<UIButton @click="wclAuth" label="Authorize WCL client" class="m-5 h-10 min-w-1/3"></UIButton>
		</div>
		<div v-else>
			<div class="flex flex-row gap-4">
				<div class="flex flex-col items-start mb-2">
					<Dropdown :options="reportOptions" class="min-w-[36rem]"
						:placeholder="$t('reviews.select_report')"
						v-model="wclDataStore.selectedReportCode"
						:onOpen="wclDataStore.requestReports"
					></Dropdown>
					<Dropdown :options="fightOptions" class="min-w-[36rem]"
						:placeholder="$t('reviews.select_fight')"
						v-model="wclDataStore.selectedFightID"
						:onOpen="wclDataStore.requestReportData"
					></Dropdown>
					<div
						class="relative flex items-center justify-center mt-2"
						style="width: 578px; height: 328px;"
						>
						<div
							v-if="!selectedVideoInfo"
							class="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-dark3 rounded"
							style="z-index: 1;"
						>
							<span class="text-gray-500 dark:text-gray-400 text-lg">Video will appear here</span>
						</div>
						<iframe
							id="player"
							width="578"
							height="328"
							src="https://www.youtube.com/embed/xxxx?enablejsapi=1"
							frameborder="0"
							allow="autoplay; encrypted-media; fullscreen"
							allowfullscreen
							class="rounded"
							style="z-index: 2;"
						></iframe>
					</div>
				</div>
				<div>
					<div class="h-[70px]">
						<div class="flex items-center gap-1">
							<Input class="max-w-40 h-8"
								:placeholder="$t('reviews.add_youtube_stream')"
								v-model="youtubeLink"
							></Input>
							<UIButton @click="requestVideoInfo" label="Add" class="min-w-20"></UIButton>
						</div>
						{{ youtubeLinkStatus }}
					</div>
					<ScrollFrame height='330' class="w-64">
						<template #default>
							<button v-for="video in videoList"
								:key="video.id" class="w-[96%] h-8 m-0.5 rounded-md"
								:class="{
									'border-1 border-secondary dark:bg-dark1 bg-light1': video.id === selectedVideoId,
									'clickable dark:bg-dark4 dark:hover:bg-dark3 bg-light4 hover:bg-light3 ': video.id !== selectedVideoId,
								}"
								@click="selectedVideoInfo = video"
							>
								<div class="text-bold line-item-element flex flex-col items-start">{{ video.author }} - {{ new Date(video.startTime).toLocaleTimeString() }}</div>
							</button>
						</template>
					</ScrollFrame>
				</div>
			</div>
			<div>
				<!-- Timeline -->
				<button class="w-[800px] h-6 m-0.5 mt-6 rounded-md clickable
					dark:bg-dark4 dark:hover:bg-dark3
					bg-light4 hover:bg-light3 relative"
					@click="onTimelineClick"
					@mousemove="onTimelineMove"
  					@mouseleave="onTimelineLeave"
					tabindex="-1"
  					@mousedown.prevent
				>
					<!-- Time Labels -->
					<p class="absolute left-0 bottom-[-22px]">0</p>
					<p class="absolute right-0 bottom-[-22px]">{{ fightDurationDisplay }}</p>
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
								<p class="absolute top-[-20px] text-red-600 cursor-pointer pointer-events-auto group"
									@mouseover="isDeathTooltipShown = true"
									@mouseout="isDeathTooltipShown = false"
								>
								💀
									<span
										class="absolute left-1/2 -translate-x-1/2 -top-7 z-30 px-2 py-1 rounded bg-black/80 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
									>
										{{ formatTime(death.timestamp) }} <span :class="getClassColor(death.class)">{{ death.name }}</span> died
										<!-- <br to {{ death.spell }} -->
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
					<!-- Tooltip -->
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
/* Remove scrollbar background for dropdowns */
.dropdown .overflow-y-auto::-webkit-scrollbar-track {
  background: transparent !important;
}
.dropdown .overflow-y-auto {
  scrollbar-color: #888 transparent; /* thumb color, track color */
}

.timeline-tooltip {
  transform: translateX(-50%);
  transition: left 0.05s;
}

</style>
