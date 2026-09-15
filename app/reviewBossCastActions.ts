export interface ReviewBossCastActionFight {
	id: number;
	encounterID: number;
	startTime: number;
	endTime: number;
}

export interface ReviewBossCastActionAbility {
	spellID: number;
	name: string;
}

export interface ReviewBossCastActionContext {
	reportCode: string;
	fight: ReviewBossCastActionFight;
	ability: ReviewBossCastActionAbility;
	/** Whether the marker represents a begincast rather than a terminal outcome. */
	occurrenceKind: 'start' | 'outcome';
	/** Seconds from fight start when this cast began, or null when WCL could not pair it. */
	occurrenceStartTimestampSeconds: number | null;
	/** Seconds from the start of the fight at the occurrence represented by the timeline marker. */
	occurrenceTimestampSeconds: number;
}

export interface ReviewBossCastActionMetadata {
	id: string;
	label: string;
	hint: string;
}

export interface ReviewBossCastAction extends ReviewBossCastActionMetadata {
	url: string;
}

interface ReviewBossCastActionDefinition extends ReviewBossCastActionMetadata {
	encounterID: number;
	spellIDs: readonly number[];
	spellNames?: readonly string[];
	buildUrl: (context: ReviewBossCastActionContext) => string;
}

const REPORT_CODE_PATTERN = /^[a-zA-Z0-9]{16}$/;
const WCL_LINK_WINDOW_MS = 30_000;
const ETERNAL_NIGHTFALL_WINDOW_BEFORE_CAST_MS = 1_000;
// Successful shields have no terminal cast event. Current logs put the last
// absorbed hit at most 15.059s after begincast, so retain a small safety tail.
const ETERNAL_NIGHTFALL_WINDOW_AFTER_CAST_MS = 16_250;
const ETERNAL_NIGHTFALL_OUTCOME_PADDING_MS = 1_000;
const DREADMARCH_CAST_DURATION_MS = 2_000;
const DREADMARCH_WINDOW_BEFORE_OUTCOME_MS = 1_000;
// Initial possession shields can persist for almost 13s, and may still be
// active when a pull ends about 16s after the cast outcome.
const DREADMARCH_WINDOW_AFTER_OUTCOME_MS = 16_250;
const COILED_ALTAR_HEX_LORD_MALACRASS_NPC_ID = 259854;
const COILED_ALTAR_ZULJAN_NPC_ID = 257911;
const DREADMARCH_POSSESSION_DEBUFF_SPELL_ID = 1297445;
const COILED_ALTAR_INTERMISSION_WCL_PHASE = 3;
const ETERNAL_NIGHTFALL_SHIELD_DAMAGE_PIN = `2$Off$#244F4B$expression$absorbedDamage > 0 AND target.id = ${COILED_ALTAR_HEX_LORD_MALACRASS_NPC_ID}`;
const DREADMARCH_MC_DAMAGE_PIN = `2$Off$#244F4B$expression$absorbedDamage > 0 AND target.type = "Player" AND IN RANGE FROM type = "applydebuff" AND ability.id = ${DREADMARCH_POSSESSION_DEBUFF_SPELL_ID} TO type = "removedebuff" AND ability.id = ${DREADMARCH_POSSESSION_DEBUFF_SPELL_ID} GROUP BY target ON target END`;
const SOULBINDING_INTERMISSION_DAMAGE_PIN = `2$Off$#244F4B$expression$target.id = ${COILED_ALTAR_ZULJAN_NPC_ID}`;

function normalizeSpellName(name: string) {
	return name.trim().toLocaleLowerCase('en-US');
}

function isValidFight(fight: ReviewBossCastActionFight) {
	return Number.isSafeInteger(fight.id)
		&& fight.id > 0
		&& Number.isSafeInteger(fight.encounterID)
		&& fight.encounterID > 0
		&& Number.isSafeInteger(fight.startTime)
		&& fight.startTime >= 0
		&& Number.isSafeInteger(fight.endTime)
		&& fight.endTime > fight.startTime;
}

interface WclActionWindow {
	startTime: number;
	endTime: number;
}

function getOccurrenceTimestamp(context: ReviewBossCastActionContext) {
	return Math.round(context.fight.startTime + context.occurrenceTimestampSeconds * 1000);
}

function getCastStartTimestamp(
	context: ReviewBossCastActionContext,
	fallbackCastDurationMs: number,
) {
	if (context.occurrenceStartTimestampSeconds != null) {
		return Math.round(
			context.fight.startTime + context.occurrenceStartTimestampSeconds * 1000,
		);
	}
	const occurrenceTimestamp = getOccurrenceTimestamp(context);
	return context.occurrenceKind === 'start'
		? occurrenceTimestamp
		: Math.max(context.fight.startTime, occurrenceTimestamp - fallbackCastDurationMs);
}

function getCenteredActionWindow(context: ReviewBossCastActionContext): WclActionWindow {
	const occurrenceTimestampMs = getOccurrenceTimestamp(context);
	return {
		startTime: Math.max(context.fight.startTime, occurrenceTimestampMs - WCL_LINK_WINDOW_MS),
		endTime: Math.min(context.fight.endTime, occurrenceTimestampMs + WCL_LINK_WINDOW_MS),
	};
}

function getEternalNightfallActionWindow(context: ReviewBossCastActionContext): WclActionWindow {
	const castStartTime = getCastStartTimestamp(context, 15_000);
	const occurrenceTimestamp = getOccurrenceTimestamp(context);
	return {
		startTime: Math.max(
			context.fight.startTime,
			castStartTime - ETERNAL_NIGHTFALL_WINDOW_BEFORE_CAST_MS,
		),
		endTime: Math.min(
			context.fight.endTime,
			Math.max(
				castStartTime + ETERNAL_NIGHTFALL_WINDOW_AFTER_CAST_MS,
				occurrenceTimestamp + ETERNAL_NIGHTFALL_OUTCOME_PADDING_MS,
			),
		),
	};
}

function getDreadmarchActionWindow(context: ReviewBossCastActionContext): WclActionWindow {
	const occurrenceTimestamp = getOccurrenceTimestamp(context);
	const estimatedOutcomeTimestamp = context.occurrenceKind === 'start'
		? occurrenceTimestamp + DREADMARCH_CAST_DURATION_MS
		: occurrenceTimestamp;
	const outcomeTimestamp = Math.min(context.fight.endTime, estimatedOutcomeTimestamp);
	return {
		startTime: Math.max(
			context.fight.startTime,
			outcomeTimestamp - DREADMARCH_WINDOW_BEFORE_OUTCOME_MS,
		),
		endTime: Math.min(
			context.fight.endTime,
			outcomeTimestamp + DREADMARCH_WINDOW_AFTER_OUTCOME_MS,
		),
	};
}

function buildPinnedDamageDoneUrl(
	context: ReviewBossCastActionContext,
	pin: string,
	timeWindow: WclActionWindow = getCenteredActionWindow(context),
) {
	const url = new URL(`https://www.warcraftlogs.com/reports/${context.reportCode}`);
	url.searchParams.set('fight', String(context.fight.id));
	url.searchParams.set('type', 'damage-done');
	url.searchParams.set('pins', pin);
	url.searchParams.set('start', String(timeWindow.startTime));
	url.searchParams.set('end', String(timeWindow.endTime));
	return url.toString();
}

function buildPhasePinnedDamageDoneUrl(
	context: ReviewBossCastActionContext,
	pin: string,
	phase: number,
) {
	const url = new URL(`https://www.warcraftlogs.com/reports/${context.reportCode}`);
	url.searchParams.set('fight', String(context.fight.id));
	url.searchParams.set('type', 'damage-done');
	url.searchParams.set('phase', String(phase));
	url.searchParams.set('pins', pin);
	return url.toString();
}

/**
 * Encounter-specific actions belong here so the timeline only needs to handle
 * a generic secondary action. Spell-name fallbacks are scoped to an encounter
 * and intentionally exact, allowing WCL spell-ID variants without broad
 * substring matching.
 */
const REVIEW_BOSS_CAST_ACTIONS: readonly ReviewBossCastActionDefinition[] = [
	{
		id: 'coiled-altar-eternal-nightfall-shield-damage',
		encounterID: 3429,
		spellIDs: [1286918],
		spellNames: ['eternal nightfall'],
		label: 'Open Eternal Nightfall shield damage in WCL',
		hint: 'Right-click to open shield damage in WCL',
		buildUrl: context => buildPinnedDamageDoneUrl(
			context,
			ETERNAL_NIGHTFALL_SHIELD_DAMAGE_PIN,
			getEternalNightfallActionWindow(context),
		),
	},
	{
		id: 'coiled-altar-dreadmarch-mc-damage',
		encounterID: 3429,
		spellIDs: [1285643],
		spellNames: ['dreadmarch'],
		label: 'Open Dreadmarch mind-controlled player damage in WCL',
		hint: 'Right-click to open MC player damage in WCL',
		buildUrl: context => buildPinnedDamageDoneUrl(
			context,
			DREADMARCH_MC_DAMAGE_PIN,
			getDreadmarchActionWindow(context),
		),
	},
	{
		id: 'coiled-altar-soulbinding-intermission-damage',
		encounterID: 3429,
		spellIDs: [1304032],
		spellNames: ['soulbinding'],
		label: 'Open Soulbinding intermission damage in WCL',
		hint: 'Right-click to open intermission damage in WCL',
		buildUrl: context => buildPhasePinnedDamageDoneUrl(
			context,
			SOULBINDING_INTERMISSION_DAMAGE_PIN,
			COILED_ALTAR_INTERMISSION_WCL_PHASE,
		),
	},
];

function findActionDefinition(
	fight: ReviewBossCastActionFight,
	ability: ReviewBossCastActionAbility,
) {
	if (!isValidFight(fight) || !Number.isSafeInteger(ability.spellID) || ability.spellID <= 0) return null;
	const normalizedName = normalizeSpellName(ability.name);
	return REVIEW_BOSS_CAST_ACTIONS.find(definition => (
		definition.encounterID === fight.encounterID
		&& (
			definition.spellIDs.includes(ability.spellID)
			|| Boolean(normalizedName && definition.spellNames?.includes(normalizedName))
		)
	)) ?? null;
}

export function getReviewBossCastActionMetadata(
	fight: ReviewBossCastActionFight,
	ability: ReviewBossCastActionAbility,
): ReviewBossCastActionMetadata | null {
	const definition = findActionDefinition(fight, ability);
	return definition
		? { id: definition.id, label: definition.label, hint: definition.hint }
		: null;
}

export function getReviewBossCastAction(
	context: ReviewBossCastActionContext,
): ReviewBossCastAction | null {
	const definition = findActionDefinition(context.fight, context.ability);
	if (
		!definition
		|| !REPORT_CODE_PATTERN.test(context.reportCode)
		|| (context.occurrenceKind !== 'start' && context.occurrenceKind !== 'outcome')
		|| (
			context.occurrenceStartTimestampSeconds != null
			&& (
				!Number.isFinite(context.occurrenceStartTimestampSeconds)
				|| context.occurrenceStartTimestampSeconds < 0
				|| context.occurrenceStartTimestampSeconds > context.occurrenceTimestampSeconds
			)
		)
		|| !Number.isFinite(context.occurrenceTimestampSeconds)
		|| context.occurrenceTimestampSeconds < 0
		|| context.occurrenceTimestampSeconds > (context.fight.endTime - context.fight.startTime) / 1000
	) return null;

	return {
		id: definition.id,
		label: definition.label,
		hint: definition.hint,
		url: definition.buildUrl(context),
	};
}
