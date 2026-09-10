<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
	replayActorIconURLs,
	replaySpellIconURL,
	type ReplayActor,
	type ReplayCast,
	type SampledReplayPosition,
} from '@/replay';

const props = defineProps<{
	actor: ReplayActor;
	position: SampledReplayPosition;
	cast?: ReplayCast | null;
	timestamp: number;
	unit: number;
	showName: boolean;
	selected: boolean;
}>();

const emit = defineEmits<{
	select: [];
}>();

const iconFailed = ref(false);
const iconSourceIndex = ref(0);
const castIconFailed = ref(false);
const radius = computed(() => {
	if (props.actor.kind === 'boss') return props.unit * 17;
	if (props.actor.kind === 'player') return props.unit * 13;
	return props.unit * 11;
});
const iconURLs = computed(() => replayActorIconURLs(props.actor));
const iconURL = computed(() => iconURLs.value[iconSourceIndex.value] || '');
const iconClipID = computed(() => `replay-actor-icon-${props.actor.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
const castIconURL = computed(() => replaySpellIconURL(props.cast?.icon));
const castProgress = computed(() => {
	if (!props.cast) return 0;
	const expectedEnd = props.cast.expectedEnd || props.cast.end;
	if (expectedEnd <= props.cast.start) return 0;
	return Math.max(0, Math.min(1, (props.timestamp - props.cast.start) / (expectedEnd - props.cast.start)));
});
const playerClassColor = computed(() => {
	const colors: Record<string, string> = {
		deathknight: '#C41E3A',
		demonhunter: '#A330C9',
		druid: '#FF7C0A',
		evoker: '#33937F',
		hunter: '#AAD372',
		mage: '#3FC7EB',
		monk: '#00FF98',
		paladin: '#F48CBA',
		priest: '#FFFFFF',
		rogue: '#FFF468',
		shaman: '#0070DD',
		warlock: '#8788EE',
		warrior: '#C69B6D',
	};
	return colors[props.actor.className?.toLowerCase() || ''] || '#64748b';
});
const actorColor = computed(() => {
	if (props.actor.kind === 'boss') return '#ef4444';
	if (props.actor.kind === 'add') return '#d6a84b';
	if (props.actor.kind === 'mechanic') return '#a78bfa';
	return playerClassColor.value;
});

watch(iconURLs, () => {
	iconSourceIndex.value = 0;
	iconFailed.value = false;
});

watch(castIconURL, () => {
	castIconFailed.value = false;
});

function tryNextIcon(): void {
	if (iconSourceIndex.value + 1 < iconURLs.value.length) {
		iconSourceIndex.value++;
		return;
	}
	iconFailed.value = true;
}
</script>

<template>
	<g class="replay-actor" :class="`replay-actor-${actor.kind}`" @click.stop="emit('select')">
		<defs>
			<clipPath :id="iconClipID" clipPathUnits="userSpaceOnUse">
				<circle
					v-if="actor.kind !== 'add'"
					:r="radius - unit * 1.5"
				/>
				<path
					v-else
					:d="`M0 ${-radius + unit * 1.5}L${radius - unit * 1.5} 0 0 ${radius - unit * 1.5} ${-radius + unit * 1.5} 0Z`"
				/>
			</clipPath>
		</defs>

		<g
			v-if="actor.kind === 'player' && position.facingDegrees != null"
			:transform="`rotate(${position.facingDegrees})`"
			opacity="0.78"
		>
			<path
				:transform="`translate(${radius + unit * 9} 0)`"
				:d="`M0 0L${-unit * 8} ${-unit * 5}V${unit * 5}Z`"
				fill="#dbeafe"
			/>
		</g>

		<circle
			v-if="actor.kind !== 'add'"
			:r="radius"
			fill="#05080d"
			:stroke="selected ? '#7dd3fc' : actorColor"
			:stroke-width="unit * (selected ? 3 : 2)"
		/>
		<path
			v-else
			:d="`M0 ${-radius}L${radius} 0 0 ${radius} ${-radius} 0Z`"
			fill="#10151d"
			:stroke="actorColor"
			:stroke-width="unit * 2"
		/>

		<text
			text-anchor="middle"
			:y="unit * 3.5"
			:font-size="unit * 11"
			font-weight="800"
			:fill="actor.kind === 'player' ? '#dbeafe' : actorColor"
		>
			{{ actor.name.slice(0, 1).toUpperCase() }}
		</text>
		<image
			v-if="iconURL && !iconFailed"
			:x="-radius + unit * 1.5"
			:y="-radius + unit * 1.5"
			:width="(radius - unit * 1.5) * 2"
			:height="(radius - unit * 1.5) * 2"
			:href="iconURL"
			:clip-path="`url(#${iconClipID})`"
			preserveAspectRatio="xMidYMid slice"
			class="actor-icon"
			@error="tryNextIcon"
		/>

		<text
			v-if="showName || selected"
			text-anchor="middle"
			:y="-radius - unit * 6"
			:font-size="unit * 14"
			:font-weight="selected ? 800 : 600"
			:fill="actor.kind === 'player' ? playerClassColor : '#f4f4f5'"
			stroke="#05080d"
			:stroke-width="unit * 3"
			paint-order="stroke"
		>
			{{ actor.name }}
		</text>

		<g v-if="cast" :transform="`translate(${-unit * 49} ${radius + unit * 9})`">
			<rect
				:y="-unit * 7"
				:width="unit * 15"
				:height="unit * 15"
				fill="#090d13"
			/>
			<image
				v-if="castIconURL && !castIconFailed"
				:y="-unit * 7"
				:width="unit * 15"
				:height="unit * 15"
				:href="castIconURL"
				preserveAspectRatio="xMidYMid slice"
				class="cast-icon"
				@error="castIconFailed = true"
			/>
			<rect
				:y="-unit * 7"
				:width="unit * 15"
				:height="unit * 15"
				fill="none"
				stroke="#6b7280"
				:stroke-width="unit"
			/>
			<text
				:x="unit * 58"
				:y="-unit * 3"
				text-anchor="middle"
				:font-size="unit * 10"
				fill="#fde68a"
				stroke="#05080d"
				:stroke-width="unit * 2"
				paint-order="stroke"
			>
				{{ cast.name }}
			</text>
			<rect
				:x="unit * 18"
				:width="unit * 80"
				:height="unit * 7"
				fill="#090d13"
			/>
			<rect :x="unit * 18" :width="unit * 80 * castProgress" :height="unit * 7" fill="#d6a84b" />
			<rect
				:x="unit * 18"
				:width="unit * 80"
				:height="unit * 7"
				fill="none"
				stroke="#6b7280"
				:stroke-width="unit"
			/>
		</g>
	</g>
</template>

<style scoped>
.replay-actor {
	cursor: pointer;
}

.replay-actor:hover {
	filter: brightness(1.15) drop-shadow(0 0 2px rgb(125 211 252 / 45%));
}

.actor-icon,
.cast-icon {
	pointer-events: none;
}
</style>
