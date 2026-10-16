import type { FightReplayData, ReplayOverlay, ReplayOverlayDataValue, ReplayPosition } from '@/replay';

export const VASHNIK_TOTEM_ID = 269430;
export const VASHNIK_LINE_TYPE = 'vashnik-recommended-line';
export const VASHNIK_FROTH_TYPE = 'vashnik-plague-froth';
export const VASHNIK_WAVE_TYPE = 'vashnik-plague-wave';
export const VASHNIK_TOTEM_TYPE = 'vashnik-malignant-totem';

export function vashnikPoint(value: ReplayOverlayDataValue | undefined): ReplayPosition | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	if (typeof value.x !== 'number' || typeof value.y !== 'number' || typeof value.mapID !== 'number'
		|| !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.mapID)) return undefined;
	return { timestamp: 0, x: value.x, y: value.y, mapID: value.mapID };
}

export function vashnikNumber(value: ReplayOverlayDataValue | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function activeVashnikOverlays(replay: FightReplayData, type: string, timestamp: number): ReplayOverlay[] {
	return replay.overlays.filter(overlay => overlay.type === type && overlay.start <= timestamp
		&& timestamp < (overlay.end ?? replay.duration));
}

export function vashnikReferencePoints(replay: FightReplayData): ReplayPosition[] {
	const overlay = replay.overlays.find(candidate => candidate.type === VASHNIK_LINE_TYPE);
	const values = overlay?.data?.points;
	return Array.isArray(values) ? values.flatMap(value => {
		const point = vashnikPoint(value);
		return point ? [point] : [];
	}) : [];
}

export function vashnikBoundsPoints(replay: FightReplayData): ReplayPosition[] {
	return [...vashnikReferencePoints(replay), ...replay.overlays.flatMap(overlay => (
		overlay.type === VASHNIK_TOTEM_TYPE && overlay.position
			? [{ ...overlay.position, timestamp: overlay.start }] : []
	))];
}

export interface VashnikWaveFront {
	id: string;
	position: ReplayPosition;
	/** True when the front moves along x; its broad edge therefore spans y. */
	movingAlongX: boolean;
	halfWidth: number;
}

/** Wave fronts are a pure function of the cursor, so pausing and seeking are reversible. */
export function vashnikWaveFronts(replay: FightReplayData, timestamp: number): VashnikWaveFront[] {
	return activeVashnikOverlays(replay, VASHNIK_WAVE_TYPE, timestamp).flatMap(overlay => {
		if (!overlay.position) return [];
		const speed = Math.max(0, vashnikNumber(overlay.data?.speed, 12));
		const offset = Math.max(0, vashnikNumber(overlay.data?.offset, 5));
		const halfWidth = Math.max(.1, vashnikNumber(overlay.data?.halfWidth, 3));
		const distance = offset + speed * (timestamp - overlay.start) / 1000;
		return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy], index) => ({
			id: `${overlay.id}:${index}`,
			position: {
				...overlay.position!, timestamp,
				x: overlay.position!.x + dx * distance,
				y: overlay.position!.y + dy * distance,
			},
			movingAlongX: dx !== 0,
			halfWidth,
		}));
	});
}

export function frothRemainingSeconds(overlay: ReplayOverlay, timestamp: number, fightDuration: number): number {
	const expiresAt = vashnikNumber(overlay.data?.expiresAt, overlay.end ?? fightDuration);
	return Math.max(0, (expiresAt - timestamp) / 1000);
}
