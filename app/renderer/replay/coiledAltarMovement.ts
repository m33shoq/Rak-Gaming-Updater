import type {
	FightReplayData,
	ReplayActor,
	ReplayFacing,
	ReplayPosition,
	SampledReplayPosition,
} from '@/replay';

export const COILED_ALTAR_FIXATION_OVERLAY_TYPE = 'coiled-altar-spirit-fixation';

/**
 * Initial experimental mechanic constants. Keep these together so recorded
 * collision timestamps can be used to tune the model without changing its
 * integration or rendering contracts.
 */
export const COILED_ALTAR_SPIRIT_SPEED_YARDS_PER_SECOND = 4;
export const COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS = 2200;
export const COILED_ALTAR_GAZE_HALF_ANGLE_DEGREES = 30;
export const COILED_ALTAR_SPIRIT_COLLISION_RADIUS_YARDS = 3.2;
export const COILED_ALTAR_PREDICTION_STEP_MS = 25;
export const COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS = 2500;
export const COILED_ALTAR_PLAYER_INTERPOLATION_MAX_GAP_MS = 1500;

interface SpiritPredictionInput {
	start: number;
	end: number;
	spiritPositions: readonly ReplayPosition[];
	targetPositions: readonly ReplayPosition[];
	targetFacings: readonly ReplayFacing[];
	initialPosition?: ReplayPosition;
}

interface CachedSpiritPrediction {
	start: number;
	end: number;
	positions: ReplayPosition[];
}

const predictionCache = new WeakMap<FightReplayData, ReadonlyMap<string, CachedSpiritPrediction[]>>();

export function isFacingReplayPoint(
	observer: Pick<ReplayPosition, 'x' | 'y'> & { facingDegrees?: number },
	point: Pick<ReplayPosition, 'x' | 'y'>,
	halfAngleDegrees = COILED_ALTAR_GAZE_HALF_ANGLE_DEGREES,
): boolean {
	if (observer.facingDegrees == null) return false;
	const dx = point.x - observer.x;
	const dy = point.y - observer.y;
	if (dx === 0 && dy === 0) return true;
	const direction = Math.atan2(dy, dx) * 180 / Math.PI;
	const angularDistance = Math.abs(((observer.facingDegrees - direction + 540) % 360) - 180);
	return angularDistance <= halfAngleDegrees;
}

function observationIndexAfter<T extends { timestamp: number }>(positions: readonly T[], timestamp: number): number {
	let low = 0;
	let high = positions.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (positions[middle].timestamp <= timestamp) low = middle + 1;
		else high = middle;
	}
	return low;
}

function sampleTargetPosition(
	positions: readonly ReplayPosition[],
	facings: readonly ReplayFacing[],
	timestamp: number,
): (ReplayPosition & { facingDegrees?: number }) | null {
	const afterIndex = observationIndexAfter(positions, timestamp);
	const before = positions[afterIndex - 1];
	const after = positions[afterIndex];
	let position: ReplayPosition;
	if (!before) {
		if (!after || after.timestamp - timestamp > COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS) return null;
		// Backfill nearby coordinates so the spirit has a useful target. Facing
		// remains independently causal and is never taken from a future sample.
		position = { ...after, timestamp };
	} else {
		if (timestamp - before.timestamp > COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS) return null;
		if (
			after
			&& before.mapID === after.mapID
			&& after.timestamp - before.timestamp <= COILED_ALTAR_PLAYER_INTERPOLATION_MAX_GAP_MS
		) {
			const progress = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
			position = {
				...before,
				timestamp,
				x: before.x + (after.x - before.x) * progress,
				y: before.y + (after.y - before.y) * progress,
			};
		} else {
			position = { ...before, timestamp };
		}
	}

	const facingIndex = observationIndexAfter(facings, timestamp);
	const facing = facings[facingIndex - 1];
	if (facing && timestamp - facing.timestamp <= COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS) {
		return { ...position, facingDegrees: facing.facingDegrees };
	}
	return position;
}

function closestInitialPosition(
	positions: readonly ReplayPosition[],
	timestamp: number,
): ReplayPosition | null {
	const afterIndex = observationIndexAfter(positions, timestamp);
	const before = positions[afterIndex - 1];
	const after = positions[afterIndex];
	if (before && timestamp - before.timestamp <= COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS) {
		return { ...before, timestamp };
	}
	if (after && after.timestamp - timestamp <= COILED_ALTAR_PLAYER_SAMPLE_MAX_AGE_MS) {
		return { ...after, timestamp };
	}
	return null;
}

function moveToward(
	position: ReplayPosition,
	target: ReplayPosition,
	distance: number,
	timestamp: number,
): ReplayPosition {
	const dx = target.x - position.x;
	const dy = target.y - position.y;
	const remaining = Math.hypot(dx, dy);
	if (remaining === 0 || distance >= remaining) {
		return { ...position, x: target.x, y: target.y, timestamp };
	}
	const scale = distance / remaining;
	return {
		...position,
		x: position.x + dx * scale,
		y: position.y + dy * scale,
		timestamp,
	};
}

export function buildCoiledAltarSpiritPrediction({
	start,
	end,
	spiritPositions,
	targetPositions,
	targetFacings,
	initialPosition,
}: SpiritPredictionInput): ReplayPosition[] {
	const initial = initialPosition
		? { ...initialPosition, timestamp: start }
		: closestInitialPosition(spiritPositions, start);
	if (!initial || end <= start) return [];
	const movementStart = start + COILED_ALTAR_FIXATION_MOVEMENT_LOCK_MS;

	const result: ReplayPosition[] = [{ ...initial, timestamp: start }];
	let current = result[0];
	let timestamp = start;

	while (timestamp < end) {
		const nextTimestamp = Math.min(
			end,
			timestamp + COILED_ALTAR_PREDICTION_STEP_MS,
			timestamp < movementStart ? movementStart : Number.POSITIVE_INFINITY,
		);
		const target = sampleTargetPosition(
			targetPositions,
			targetFacings,
			(timestamp + nextTimestamp) / 2,
		);
		let next = { ...current, timestamp: nextTimestamp };
		if (
			timestamp >= movementStart
			&& target
			&& target.facingDegrees != null
			&& target.mapID === current.mapID
			&& !isFacingReplayPoint(target, current)
		) {
			next = moveToward(
				current,
				target,
				COILED_ALTAR_SPIRIT_SPEED_YARDS_PER_SECOND * (nextTimestamp - timestamp) / 1000,
				nextTimestamp,
			);
		}

		if (next.x !== current.x || next.y !== current.y || next.mapID !== current.mapID) {
			result.push(next);
		}
		current = next;
		timestamp = nextTimestamp;
	}

	return result;
}

function samplePrediction(
	positions: readonly ReplayPosition[],
	timestamp: number,
): SampledReplayPosition | null {
	const index = observationIndexAfter(positions, timestamp);
	const position = positions[index - 1];
	if (!position) return null;
	return {
		...position,
		age: timestamp - position.timestamp,
		interpolated: true,
	};
}

function buildPredictionIndex(replay: FightReplayData): ReadonlyMap<string, CachedSpiritPrediction[]> {
	const actors = new Map(replay.actors.map(actor => [actor.key, actor]));
	const result = new Map<string, CachedSpiritPrediction[]>();
	const fixationsBySpirit = new Map<string, Array<{ targetKey: string; start: number; end: number }>>();
	for (const overlay of replay.overlays) {
		if (overlay.type !== COILED_ALTAR_FIXATION_OVERLAY_TYPE) continue;
		const [spiritKey, targetKey] = overlay.actorKeys || [];
		const end = overlay.end ?? replay.duration;
		if (!spiritKey || !targetKey || end <= overlay.start) continue;
		const fixations = fixationsBySpirit.get(spiritKey) || [];
		fixations.push({ targetKey, start: overlay.start, end });
		fixationsBySpirit.set(spiritKey, fixations);
	}

	for (const [spiritKey, fixations] of fixationsBySpirit) {
		const spirit = actors.get(spiritKey);
		if (!spirit) continue;
		fixations.sort((left, right) => left.start - right.start || left.end - right.end);
		const predictions: CachedSpiritPrediction[] = [];
		// Establish the one trusted WCL coordinate at the spirit's initial spawn.
		// Subsequent observations can be displaced by fixation/visibility behavior
		// and must never become new prediction anchors.
		let carriedPosition = closestInitialPosition(spirit.positions, fixations[0].start) || undefined;
		if (!carriedPosition) continue;

		for (let index = 0; index < fixations.length; index++) {
			const fixation = fixations[index];
			const target = actors.get(fixation.targetKey);
			if (!target) continue;
			// A refixate supersedes an older ownership window even if WCL reports
			// the corresponding remove event late or not at all.
			const end = Math.min(fixation.end, fixations[index + 1]?.start ?? replay.duration);
			if (end <= fixation.start) continue;
			const positions = buildCoiledAltarSpiritPrediction({
				start: fixation.start,
				end,
				spiritPositions: spirit.positions,
				targetPositions: target.positions,
				targetFacings: target.facings || [],
				initialPosition: carriedPosition,
			});
			if (positions.length === 0) continue;
			predictions.push({ start: fixation.start, end, positions });
			// Every later fixation continues from the model's last predicted
			// coordinate; the new fixation only changes target and lock timing.
			carriedPosition = { ...positions.at(-1)!, timestamp: end };
		}

		if (predictions.length > 0) {
			result.set(spiritKey, predictions);
		}
	}
	return result;
}

function predictionsFor(replay: FightReplayData): ReadonlyMap<string, CachedSpiritPrediction[]> {
	let predictions = predictionCache.get(replay);
	if (!predictions) {
		predictions = buildPredictionIndex(replay);
		predictionCache.set(replay, predictions);
	}
	return predictions;
}

export function sampleCoiledAltarSpiritPosition(
	replay: FightReplayData,
	actor: ReplayActor,
	timestamp: number,
): SampledReplayPosition | undefined {
	const prediction = predictionsFor(replay).get(actor.key)?.find(candidate => (
		candidate.start <= timestamp && timestamp < candidate.end
	));
	return prediction ? samplePrediction(prediction.positions, timestamp) || undefined : undefined;
}
