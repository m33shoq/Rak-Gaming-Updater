<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ReplayExtensionRendererProps } from '@/renderer/replay/replayExtensions';
import { projectReplayMapPosition } from '@/replayMaps';
import { replaySpellIconURL, type ReplayPosition } from '@/replay';
import {
	activeVashnikOverlays,
	frothRemainingSeconds,
	vashnikNumber,
	vashnikReferencePoints,
	vashnikWaveFronts,
	VASHNIK_FROTH_TYPE,
	VASHNIK_TOTEM_TYPE,
} from '@/renderer/replay/vashnikReplay';

const props = defineProps<ReplayExtensionRendererProps>();
const iconFailed = ref(false);
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function visible(layer: string): boolean {
	return !props.hiddenLayers?.has(layer);
}

function project(point: ReplayPosition): ReplayPosition | undefined {
	const definition = props.mapDefinition;
	if (definition && definition.uiMapID !== 2608) return undefined;
	if (!definition && props.mapID !== 2608 && props.mapID !== 3004) return undefined;
	if (point.mapID !== 2608 && point.mapID !== 3004) return undefined;
	return definition ? projectReplayMapPosition(definition, point) : point;
}

const reference = computed(() => vashnikReferencePoints(props.replay).flatMap(point => {
	const projected = project(point);
	return projected ? [projected] : [];
}));
const referencePath = computed(() => reference.value.map(point => `${point.x},${point.y}`).join(' '));

const totems = computed(() => activeVashnikOverlays(props.replay, VASHNIK_TOTEM_TYPE, props.timestamp)
	.flatMap(overlay => {
		const point = overlay.position && project({ ...overlay.position, timestamp: overlay.start });
		if (!point) return [];
		const inferred = overlay.data?.inferred !== false;
		const priorOnly = overlay.data?.inference === 'prior-only';
		const survival = overlay.data?.inference === 'survival';
		const source = overlay.data?.source;
		return [{
			id: overlay.id, point, inferred, priorOnly, survival,
			color: source === 'fire' ? '#fb923c' : source === 'shadow' ? '#c4a1ff' : '#cbd5e1',
			source: source === 'fire' ? 'Fire' : source === 'shadow' ? 'Shadow' : 'Unknown source',
			candidates: vashnikNumber(overlay.data?.candidateCount, 0),
			observedAt: typeof overlay.data?.positionObservedAt === 'number' ? (overlay.data.positionObservedAt / 1000).toFixed(1) : undefined,
			deathConfirmed: overlay.data?.deathConfirmed === true,
			evidenceThrough: (vashnikNumber(overlay.data?.positionEvidenceThrough, overlay.start) / 1000).toFixed(1),
			latePhase: typeof overlay.data?.completedMalignanceAt === 'number',
			waveAssigned: overlay.data?.waveAssignment === 'inferred',
		}];
	}));

const froth = computed(() => activeVashnikOverlays(props.replay, VASHNIK_FROTH_TYPE, props.timestamp)
	.flatMap(overlay => {
		const key = overlay.actorKeys?.[0];
		const point = key && props.actorPositions.get(key);
		if (!point) return [];
		const remaining = frothRemainingSeconds(overlay, props.timestamp, props.replay.duration);
		const total = Math.max(1, vashnikNumber(overlay.data?.duration, 6000) / 1000);
		return [{
			id: overlay.id, point, remaining, progress: Math.min(1, remaining / total),
			icon: replaySpellIconURL(typeof overlay.data?.icon === 'string' ? overlay.data.icon : undefined),
		}];
	}));

const fronts = computed(() => vashnikWaveFronts(props.replay, props.timestamp).flatMap(front => {
	const point = project(front.position);
	return point ? [{ ...front, point }] : [];
}));

function arrowHead(dx: number, dy: number): string {
	const distance = Math.max(8, props.unit * 36);
	const length = props.unit * 6;
	const halfWidth = props.unit * 3.5;
	return [
		[dx * distance, dy * distance],
		[dx * (distance - length) - dy * halfWidth, dy * (distance - length) + dx * halfWidth],
		[dx * (distance - length) + dy * halfWidth, dy * (distance - length) - dx * halfWidth],
	].map(point => point.join(',')).join(' ');
}
</script>

<template>
	<g class="vashnik-overlay" pointer-events="none">
		<g v-if="visible('vashnik-line') && reference.length === 5" class="vashnik-reference-line">
			<title>Experimental reference line · five positions 10 yd apart · compare player alignment with this trial placement</title>
			<polyline :points="referencePath" fill="none" stroke="#7dd3fc" :stroke-width="unit * 2"
				:stroke-dasharray="`${unit * 7} ${unit * 4}`" stroke-opacity="0.8" />
			<g v-for="(point, index) in reference" :key="index" :transform="`translate(${point.x} ${point.y})`">
				<circle :r="unit * 8" fill="rgb(14 116 144 / 28%)" stroke="#7dd3fc" :stroke-width="unit * 1.5" />
				<text text-anchor="middle" :y="unit * 3" :font-size="unit * 9" font-weight="800" fill="#e0f2fe">{{ index + 1 }}</text>
			</g>
			<text :x="reference[0].x - unit * 16" :y="reference[0].y + unit * 4" :font-size="unit * 11" text-anchor="end"
				fill="#7dd3fc" font-weight="700" stroke="#05080d" :stroke-width="unit * 3" paint-order="stroke">
				Experimental · 10 yd
			</text>
		</g>

		<g v-if="visible('vashnik-totems')" class="vashnik-totems">
			<g v-for="totem in totems" :key="totem.id" :transform="`translate(${totem.point.x} ${totem.point.y})`"
				class="vashnik-totem" :data-totem-id="totem.id" :data-inferred="totem.inferred" :opacity="totem.priorOnly ? 0.5 : 1"
				pointer-events="visiblePainted">
				<title>{{ totem.source }} Malignant Totem · {{ totem.inferred ? totem.priorOnly ? 'Approximate: spawn prior only; no matching wave timing' : totem.survival ? `Inferred from surviving waves through ${totem.evidenceThrough}s; displayed point is one sampled possibility` : `Inferred from wave timing; ${totem.candidates} candidate locations; displayed point is one sampled possibility` : `Logged NPC coordinate at ${totem.observedAt}s; applied retrospectively to this stationary totem` }} · {{ totem.deathConfirmed ? totem.latePhase ? 'Removal time logged; later wave attribution unresolved after Malignance' : totem.waveAssigned ? 'Removal time logged; wave assignment inferred' : 'Removal time logged; no compatible wave attribution' : 'No logged death; retained through known lifetime' }}</title>
				<path :d="`M0 ${-unit * 10}L${unit * 9} 0 0 ${unit * 10} ${-unit * 9} 0Z`"
					fill="#10151d" :stroke="totem.color" :stroke-width="unit * 1.6"
					:stroke-dasharray="totem.inferred ? `${unit * 3} ${unit * 2}` : undefined" />
				<path v-if="!totem.priorOnly" :d="`M0 ${-unit * 5}V${unit * 5}M${-unit * 3} ${-unit * 3}H${unit * 3}M${-unit * 3} ${unit * 2}H${unit * 3}`"
					:stroke="totem.color" :stroke-width="unit * 1.4" />
				<text v-else text-anchor="middle" :y="unit * 4" :font-size="unit * 11" :fill="totem.color">?</text>
			</g>
		</g>

		<g v-if="visible('vashnik-froth')" class="vashnik-froth-waves">
			<g v-for="front in fronts" :key="front.id" class="vashnik-wave-front">
				<rect :x="front.point.x - (front.movingAlongX ? 2 : front.halfWidth)"
					:y="front.point.y - (front.movingAlongX ? front.halfWidth : 2)"
					:width="front.movingAlongX ? 4 : front.halfWidth * 2"
					:height="front.movingAlongX ? front.halfWidth * 2 : 4"
					:rx="unit * 3" fill="rgb(110 231 183 / 24%)" stroke="#6ee7b7" :stroke-width="unit * 1.2" />
			</g>
			<g v-for="aura in froth" :key="aura.id" :transform="`translate(${aura.point.x} ${aura.point.y})`"
				class="vashnik-froth-carrier" :opacity="aura.point.age > 1500 ? 0.5 : 1">
				<title>Plague Froth · {{ aura.remaining.toFixed(1) }}s · Waves follow the four map axes</title>
				<g v-for="([dx, dy], index) in directions" :key="index" class="vashnik-wave-direction">
					<line :x1="dx * unit * 19" :y1="dy * unit * 19"
						:x2="dx * Math.max(8, unit * 36)" :y2="dy * Math.max(8, unit * 36)"
						stroke="#6ee7b7" :stroke-width="unit * 1.4" stroke-opacity="0.8" />
					<polygon :points="arrowHead(dx, dy)" fill="#6ee7b7" />
				</g>
				<circle :r="unit * 17" fill="none" stroke="rgb(110 231 183 / 25%)" :stroke-width="unit * 3" />
				<circle :r="unit * 17" fill="none" :stroke="aura.remaining <= 2 ? '#fde68a' : '#6ee7b7'"
					:stroke-width="unit * 3" :stroke-dasharray="`${2 * Math.PI * unit * 17 * aura.progress} ${2 * Math.PI * unit * 17}`"
					transform="rotate(-90)" />
				<g :transform="`translate(${unit * 17} ${unit * 14})`">
					<rect :width="unit * 49" :height="unit * 19" :rx="unit * 3" fill="#071510" stroke="#6ee7b7" :stroke-width="unit" />
					<image v-if="aura.icon && !iconFailed" :href="aura.icon" :x="unit * 2" :y="unit * 2"
						:width="unit * 15" :height="unit * 15" @error="iconFailed = true" />
					<text v-else :x="unit * 10" :y="unit * 14" text-anchor="middle" :font-size="unit * 12" fill="#6ee7b7">F</text>
					<text :x="unit * 33" :y="unit * 14" text-anchor="middle" :font-size="unit * 12"
						font-weight="800" :fill="aura.remaining <= 2 ? '#fde68a' : '#d1fae5'">{{ aura.remaining.toFixed(1) }}</text>
				</g>
			</g>
		</g>
	</g>
</template>
