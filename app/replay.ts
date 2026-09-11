export const REVIEW_REPLAY_VERSION = 12 as const;

export interface ReplayPosition {
	timestamp: number;
	x: number;
	y: number;
	mapID: number;
	facingDegrees?: number;
}

export type ReplayActorKind = 'player' | 'boss' | 'add' | 'mechanic';

export interface ReplayActor {
	key: string;
	reportID: number;
	instance?: number;
	gameID?: number;
	name: string;
	kind: ReplayActorKind;
	className?: string;
	specialization?: string;
	icon?: string;
	/** Milliseconds to retain the last observed position; null keeps it until the actor becomes inactive. */
	positionRetentionMs?: number | null;
	active: Array<{ start: number; end: number }>;
	positions: ReplayPosition[];
}

export interface ReplayCast {
	key: string;
	actorKey: string;
	spellID: number;
	name: string;
	icon?: string;
	start: number;
	end: number;
	expectedEnd?: number;
	outcome: 'completed' | 'interrupted' | 'unknown';
}

export type ReplayOverlayDataValue =
	| string
	| number
	| boolean
	| null
	| ReplayOverlayDataValue[]
	| { [key: string]: ReplayOverlayDataValue };

export interface ReplayOverlay {
	id: string;
	type: string;
	start: number;
	end?: number;
	actorKeys?: string[];
	position?: { x: number; y: number; mapID: number };
	label?: string;
	color?: string;
	data?: Record<string, ReplayOverlayDataValue>;
}

export interface FightReplayData {
	version: typeof REVIEW_REPLAY_VERSION;
	encounterID: number;
	duration: number;
	uiMapIDs: number[];
	actors: ReplayActor[];
	casts: ReplayCast[];
	overlays: ReplayOverlay[];
}

export interface SampledReplayPosition extends ReplayPosition {
	age: number;
	interpolated: boolean;
}

export function isReplayActorActive(actor: ReplayActor, timestamp: number): boolean {
	return actor.active.some(window => window.start <= timestamp && timestamp < window.end);
}

/** Players remain visible between an observed death and their next active interval. */
export function isReplayPlayerDead(
	actor: ReplayActor,
	timestamp: number,
	fightDuration: number,
): boolean {
	if (actor.kind !== 'player' || isReplayActorActive(actor, timestamp)) return false;

	let latestWindow: ReplayActor['active'][number] | undefined;
	for (let index = actor.active.length - 1; index >= 0; index--) {
		if (actor.active[index].start > timestamp) continue;
		latestWindow = actor.active[index];
		break;
	}
	return Boolean(
		latestWindow
		&& latestWindow.end < fightDuration
		&& timestamp >= latestWindow.end,
	);
}

/** Interpolate only dense observations. Long gaps stay visibly stale instead of inventing movement. */
export function sampleReplayPosition(
	positions: readonly ReplayPosition[],
	timestamp: number,
	maxAge: number,
	allowInterpolation = true,
): SampledReplayPosition | null {
	let low = 0;
	let high = positions.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (positions[middle].timestamp <= timestamp) low = middle + 1;
		else high = middle;
	}

	const before = positions[low - 1];
	const after = positions[low];
	if (!before) return null;

	const age = timestamp - before.timestamp;
	if (age > maxAge) return null;

	if (
		allowInterpolation
		&& after
		&& before.mapID === after.mapID
		&& after.timestamp - before.timestamp <= 1500
	) {
		const progress = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
		return {
			...before,
			x: before.x + (after.x - before.x) * progress,
			y: before.y + (after.y - before.y) * progress,
			age,
			interpolated: progress > 0,
		};
	}

	return { ...before, age, interpolated: false };
}

export function activeReplayCast(casts: readonly ReplayCast[], actorKey: string, timestamp: number): ReplayCast | null {
	return casts.find(cast => (
		cast.actorKey === actorKey
		&& cast.start <= timestamp
		&& timestamp < cast.end
	)) || null;
}

const RPGLOGS_ICON_ROOT = 'https://assets.rpglogs.com/img/warcraft/icons';
const WOW_ICON_ROOT = 'https://wow.zamimg.com/images/wow/icons/large';
const GENERIC_REPLAY_ACTOR_ICONS = new Set(['boss', 'environment', 'npc', 'unknown']);

/** Resolve both WCL actor-icon slugs and WoW ability-icon filenames. */
export function replayActorIconURLs(actor: ReplayActor): string[] {
	if (actor.kind === 'player' && actor.className && actor.specialization) {
		const icon = `${actor.className}-${actor.specialization.replace(/\s+/g, '')}`;
		return [`${RPGLOGS_ICON_ROOT}/${encodeURIComponent(icon)}.jpg`];
	}

	const icon = actor.icon?.trim();
	if (!icon) return [];
	if (/^https?:\/\//i.test(icon)) return [icon];
	if (GENERIC_REPLAY_ACTOR_ICONS.has(icon.toLowerCase())) return [];

	const iconWithoutExtension = icon.replace(/\.(?:jpe?g|png|webp)$/i, '');
	const rpgLogsURL = `${RPGLOGS_ICON_ROOT}/${encodeURIComponent(iconWithoutExtension)}.jpg`;
	// WCL prefixes custom NPC portrait filenames, but Wowhead stores the same
	// texture without `custom-icon-` (for example inv_ragnaros_heart.jpg).
	const wowIconStem = iconWithoutExtension.replace(/^custom-icon-/i, '');
	const wowIconFilename = `${wowIconStem}.jpg`;
	const wowIconURL = `${WOW_ICON_ROOT}/${encodeURIComponent(wowIconFilename.toLowerCase())}`;

	// NPC icons chosen by WCL are commonly WoW ability-icon filenames. Keep the
	// RPGLogs form as a fallback for older reports that expose an actor slug.
	return actor.kind === 'player'
		? [rpgLogsURL]
		: [wowIconURL, rpgLogsURL];
}

export function replayActorIconURL(actor: ReplayActor): string {
	return replayActorIconURLs(actor)[0] || '';
}

export function replaySpellIconURL(icon?: string): string {
	const value = icon?.trim();
	if (!value) return '';
	if (/^https?:\/\//i.test(value)) return value;
	const filename = /\.(?:jpe?g|png|webp)$/i.test(value) ? value : `${value}.jpg`;
	return `${WOW_ICON_ROOT}/${encodeURIComponent(filename.toLowerCase())}`;
}
