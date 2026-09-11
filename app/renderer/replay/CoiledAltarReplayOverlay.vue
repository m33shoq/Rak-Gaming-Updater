<script setup lang="ts">
import { computed } from 'vue';
import type { ReplayExtensionRendererProps } from '@/renderer/replay/replayExtensions';
import type { ReplayActor, ReplayOverlay, SampledReplayPosition } from '@/replay';

const props = defineProps<ReplayExtensionRendererProps>();

const FIXATION_OVERLAY_TYPE = 'coiled-altar-spirit-fixation';
const COLLISION_OVERLAY_TYPE = 'coiled-altar-spirit-collision';

interface ActiveFixation {
	id: string;
	spiritPosition: SampledReplayPosition;
	targetPosition?: SampledReplayPosition;
	targetName: string;
	targetColor: string;
}

interface ActiveCollision {
	id: string;
	position: SampledReplayPosition;
	partnerKey?: string;
	partnerName: string;
	confirmedDamage: boolean;
}

const actorsByKey = computed(() => new Map(
	props.replay.actors.map(actor => [actor.key, actor]),
));

function isActive(overlay: ReplayOverlay): boolean {
	return overlay.start <= props.timestamp
		&& props.timestamp < (overlay.end ?? props.replay.duration);
}

function classColor(actor?: ReplayActor): string {
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
	return colors[actor?.className?.toLowerCase() || ''] || '#c4b5fd';
}

const activeFixations = computed<ActiveFixation[]>(() => (
	props.replay.overlays.flatMap(overlay => {
		if (overlay.type !== FIXATION_OVERLAY_TYPE || !isActive(overlay)) return [];
		const [spiritKey, targetKey] = overlay.actorKeys || [];
		if (!spiritKey || !targetKey) return [];

		const spiritPosition = props.actorPositions.get(spiritKey);
		const sampledTargetPosition = props.actorPositions.get(targetKey);
		if (!spiritPosition) return [];
		const targetPosition = sampledTargetPosition?.mapID === spiritPosition.mapID
			? sampledTargetPosition
			: undefined;

		const target = actorsByKey.value.get(targetKey);
		return [{
			id: overlay.id,
			spiritPosition,
			targetPosition,
			targetName: target?.name || overlay.label || 'Unknown',
			targetColor: classColor(target),
		}];
	})
));

const activeCollisions = computed<ActiveCollision[]>(() => {
	const collisions = new Map<string, ActiveCollision>();
	for (const overlay of props.replay.overlays) {
		if (overlay.type !== COLLISION_OVERLAY_TYPE || !isActive(overlay)) continue;
		const playerKey = overlay.actorKeys?.[0];
		if (!playerKey) continue;
		const position = props.actorPositions.get(playerKey);
		if (!position) continue;

		const existing = collisions.get(playerKey);
		const partnerKey = overlay.actorKeys?.[1] || existing?.partnerKey;
		const confirmedDamage = overlay.data?.confirmedDamage === true;
		collisions.set(playerKey, {
			id: existing?.id || overlay.id,
			position,
			partnerKey,
			partnerName: partnerKey
				? actorsByKey.value.get(partnerKey)?.name || overlay.label || 'Unknown partner'
				: existing?.partnerName || 'Unknown partner',
			confirmedDamage: Boolean(existing?.confirmedDamage || confirmedDamage),
		});
	}
	return [...collisions.values()];
});
</script>

<template>
	<g class="coiled-altar-overlay" pointer-events="none">
		<g v-for="fixation in activeFixations" :key="fixation.id">
			<line
				v-if="fixation.targetPosition"
				:x1="fixation.spiritPosition.x"
				:y1="fixation.spiritPosition.y"
				:x2="fixation.targetPosition.x"
				:y2="fixation.targetPosition.y"
				:stroke="fixation.targetColor"
				:stroke-width="unit * 1.5"
				:stroke-dasharray="`${unit * 5} ${unit * 4}`"
				stroke-opacity="0.8"
			/>
			<circle
				:cx="fixation.spiritPosition.x"
				:cy="fixation.spiritPosition.y"
				:r="unit * 16"
				fill="none"
				:stroke="fixation.targetColor"
				:stroke-width="unit * 1.5"
				stroke-opacity="0.85"
			/>
			<text
				:x="fixation.spiritPosition.x"
				:y="fixation.spiritPosition.y + unit * 25"
				text-anchor="middle"
				:font-size="unit * 11"
				font-weight="700"
				:fill="fixation.targetColor"
				stroke="#05080d"
				:stroke-width="unit * 2.5"
				paint-order="stroke"
			>
				→ {{ fixation.targetName }}
			</text>
		</g>

		<g
			v-for="collision in activeCollisions"
			:key="collision.id"
			:transform="`translate(${collision.position.x} ${collision.position.y})`"
			class="spirit-collision"
		>
			<circle
				:r="unit * 24"
				fill="rgb(239 68 68 / 18%)"
				:stroke="collision.confirmedDamage ? '#fb7185' : '#f59e0b'"
				:stroke-width="unit * 3"
			/>
			<circle
				:r="unit * 31"
				fill="none"
				stroke="#fb7185"
				:stroke-width="unit * 1.5"
				stroke-dasharray="3 3"
				class="collision-pulse"
			/>
			<text
				:y="-unit * 38"
				text-anchor="middle"
				:font-size="unit * 12"
				font-weight="800"
				fill="#fecdd3"
				stroke="#05080d"
				:stroke-width="unit * 3"
				paint-order="stroke"
			>
				! SPIRIT COLLISION · {{ collision.partnerName }}
			</text>
		</g>
	</g>
</template>

<style scoped>
.collision-pulse {
	animation: collision-pulse 900ms ease-out infinite alternate;
	transform-box: fill-box;
	transform-origin: center;
}

@keyframes collision-pulse {
	from {
		opacity: 0.35;
		transform: scale(0.9);
	}

	to {
		opacity: 0.95;
		transform: scale(1.05);
	}
}
</style>
