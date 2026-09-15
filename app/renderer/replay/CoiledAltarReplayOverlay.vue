<script setup lang="ts">
import { computed } from 'vue';
import type { ReplayExtensionRendererProps } from '@/renderer/replay/replayExtensions';
import {
	COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS,
	COILED_ALTAR_FIXATION_OVERLAY_TYPE,
	COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS,
	COILED_ALTAR_SPIRIT_COLLISION_RADIUS_YARDS,
	isFacingReplayPoint,
} from '@/renderer/replay/coiledAltarMovement';
import type { ReplayActor, ReplayOverlay, SampledReplayPosition } from '@/replay';

const props = defineProps<ReplayExtensionRendererProps>();

const COLLISION_OVERLAY_TYPE = 'coiled-altar-spirit-collision';

interface ActiveFixation {
	id: string;
	spiritKey: string;
	targetKey: string;
	spiritPosition: SampledReplayPosition;
	targetPosition?: SampledReplayPosition;
	targetName: string;
	targetColor: string;
	movementLocked: boolean;
	pausedByGaze: boolean;
}

interface ActiveCollision {
	id: string;
	position: SampledReplayPosition;
	partnerKey?: string;
	partnerName: string;
	confirmedDamage: boolean;
}

interface PredictedSpiritCollision {
	id: string;
	x: number;
	y: number;
	leftTargetName: string;
	rightTargetName: string;
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
		if (overlay.type !== COILED_ALTAR_FIXATION_OVERLAY_TYPE || !isActive(overlay)) return [];
		const [spiritKey, targetKey] = overlay.actorKeys || [];
		if (!spiritKey || !targetKey) return [];

		const spiritPosition = props.actorPositions.get(spiritKey);
		const sampledTargetPosition = props.actorPositions.get(targetKey);
		if (!spiritPosition) return [];
		const targetPosition = sampledTargetPosition?.mapID === spiritPosition.mapID
			? sampledTargetPosition
			: undefined;

		const spirit = actorsByKey.value.get(spiritKey);
		const target = actorsByKey.value.get(targetKey);
		if (!spirit) return [];
		const movementLocked = props.timestamp
			< overlay.start + COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;
		const targetFacingIsFresh = targetPosition?.facingDegrees != null
			&& (targetPosition.facingAge ?? Number.POSITIVE_INFINITY)
				<= COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS;
		return [{
			id: overlay.id,
			spiritKey,
			targetKey,
			spiritPosition,
			targetPosition,
			targetName: target?.name || overlay.label || 'Unknown',
			targetColor: classColor(target),
			movementLocked,
			pausedByGaze: !movementLocked && targetPosition && targetFacingIsFresh
				? isFacingReplayPoint(targetPosition, spiritPosition)
				: false,
		}];
	})
));

const predictedSpiritCollisions = computed<PredictedSpiritCollision[]>(() => {
	const result: PredictedSpiritCollision[] = [];
	for (let leftIndex = 0; leftIndex < activeFixations.value.length; leftIndex++) {
		const left = activeFixations.value[leftIndex];
		for (let rightIndex = leftIndex + 1; rightIndex < activeFixations.value.length; rightIndex++) {
			const right = activeFixations.value[rightIndex];
			// Defensive guard for stale/legacy payloads: one spirit cannot collide
			// with an older fixation overlay belonging to that same spirit.
			if (left.spiritKey === right.spiritKey) continue;
			if (left.spiritPosition.mapID !== right.spiritPosition.mapID) continue;
			const distance = Math.hypot(
				left.spiritPosition.x - right.spiritPosition.x,
				left.spiritPosition.y - right.spiritPosition.y,
			);
			if (distance > COILED_ALTAR_SPIRIT_COLLISION_RADIUS_YARDS) continue;
			result.push({
				id: [left.spiritKey, right.spiritKey].sort().join(':'),
				x: (left.spiritPosition.x + right.spiritPosition.x) / 2,
				y: (left.spiritPosition.y + right.spiritPosition.y) / 2,
				leftTargetName: left.targetName,
				rightTargetName: right.targetName,
			});
		}
	}
	return result;
});

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
				:stroke="fixation.movementLocked
					? '#94a3b8'
					: fixation.pausedByGaze ? '#6ee7b7' : fixation.targetColor"
				:stroke-width="unit * 1.5"
				:stroke-dasharray="`${unit * 5} ${unit * 4}`"
				stroke-opacity="0.8"
			/>
			<circle
				:cx="fixation.spiritPosition.x"
				:cy="fixation.spiritPosition.y"
				:r="unit * 16"
				fill="none"
				:stroke="fixation.movementLocked
					? '#94a3b8'
					: fixation.pausedByGaze ? '#6ee7b7' : fixation.targetColor"
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
			<text
				v-if="fixation.movementLocked"
				:x="fixation.spiritPosition.x"
				:y="fixation.spiritPosition.y + unit * 38"
				text-anchor="middle"
				:font-size="unit * 9"
				font-weight="800"
				fill="#cbd5e1"
				stroke="#05080d"
				:stroke-width="unit * 2.5"
				paint-order="stroke"
			>
				FIXATION LOCK
			</text>
			<text
				v-else-if="fixation.pausedByGaze"
				:x="fixation.spiritPosition.x"
				:y="fixation.spiritPosition.y + unit * 38"
				text-anchor="middle"
				:font-size="unit * 9"
				font-weight="800"
				fill="#6ee7b7"
				stroke="#05080d"
				:stroke-width="unit * 2.5"
				paint-order="stroke"
			>
				HELD BY GAZE
			</text>
		</g>

		<g
			v-for="collision in predictedSpiritCollisions"
			:key="`predicted:${collision.id}`"
			:transform="`translate(${collision.x} ${collision.y})`"
			class="predicted-spirit-collision"
		>
			<circle
				:r="COILED_ALTAR_SPIRIT_COLLISION_RADIUS_YARDS"
				fill="rgb(245 158 11 / 12%)"
				stroke="#fbbf24"
				:stroke-width="unit * 2"
				:stroke-dasharray="`${unit * 4} ${unit * 3}`"
			/>
			<text
				:y="-(COILED_ALTAR_SPIRIT_COLLISION_RADIUS_YARDS + unit * 8)"
				text-anchor="middle"
				:font-size="unit * 10"
				font-weight="800"
				fill="#fde68a"
				stroke="#05080d"
				:stroke-width="unit * 3"
				paint-order="stroke"
			>
				PREDICTED OVERLAP · {{ collision.leftTargetName }} + {{ collision.rightTargetName }}
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
