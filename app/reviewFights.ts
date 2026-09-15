export function buildPullNumberByFightID(
	fights: readonly fightDetails[],
): Map<number, number> {
	const pullNumberByFightID = new Map<number, number>();
	const countsByEncounterAndDifficulty = new Map<string, number>();
	const chronologicalFights = [...fights].sort((left, right) => (
		left.startTime - right.startTime
		|| left.id - right.id
	));

	for (const fight of chronologicalFights) {
		const scope = `${fight.encounterID}:${fight.difficulty ?? 'unknown'}`;
		const pullNumber = (countsByEncounterAndDifficulty.get(scope) || 0) + 1;
		countsByEncounterAndDifficulty.set(scope, pullNumber);
		pullNumberByFightID.set(fight.id, pullNumber);
	}

	return pullNumberByFightID;
}

export function findNewReviewFightIDs(
	previousFights: readonly Pick<fightDetails, 'id'>[] | null | undefined,
	currentFights: readonly Pick<fightDetails, 'id'>[],
): number[] {
	if (!previousFights) return [];

	const previousFightIDs = new Set(previousFights.map(fight => fight.id));
	const newFightIDs = new Set<number>();
	for (const fight of currentFights) {
		if (!previousFightIDs.has(fight.id)) newFightIDs.add(fight.id);
	}
	return Array.from(newFightIDs);
}

export interface ReviewFightProgress {
	label: string;
	color: string;
}

const REVIEW_FIGHT_HEALTH_COLOR_STOPS = [
	{ percentage: 0, color: '#a3e635' },
	{ percentage: 25, color: '#d9f45a' },
	{ percentage: 50, color: '#fbbf24' },
	{ percentage: 75, color: '#fb923c' },
	{ percentage: 100, color: '#fb7185' },
] as const;

const REVIEW_FIGHT_KILL_COLOR = '#22c55e';
const REVIEW_FIGHT_UNKNOWN_COLOR = '#94a3b8';

function formatFightPercentage(value: number | null): string {
	if (value == null) return '?%';
	return `${value.toFixed(1).replace(/\.0$/, '')}%`;
}

function parseHexColor(color: string): [number, number, number] {
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	];
}

function interpolateHexColor(left: string, right: string, progress: number): string {
	const leftChannels = parseHexColor(left);
	const rightChannels = parseHexColor(right);
	return `#${leftChannels.map((channel, index) => (
		Math.round(channel + (rightChannels[index] - channel) * progress)
			.toString(16)
			.padStart(2, '0')
	)).join('')}`;
}

/** WCL's encounter-aware percentage is preferred over active-boss health. */
export function getReviewFightPercentage(fight: fightDetails): number | null {
	const values = [fight.fightPercentage, fight.bossPercentage];
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return Math.max(0, Math.min(100, value));
		}
	}
	return null;
}

export function getReviewFightWipeColor(percentage: number | null): string {
	if (percentage == null) return REVIEW_FIGHT_UNKNOWN_COLOR;
	for (let index = 1; index < REVIEW_FIGHT_HEALTH_COLOR_STOPS.length; index++) {
		const lower = REVIEW_FIGHT_HEALTH_COLOR_STOPS[index - 1];
		const upper = REVIEW_FIGHT_HEALTH_COLOR_STOPS[index];
		if (percentage > upper.percentage) continue;
		return interpolateHexColor(
			lower.color,
			upper.color,
			(percentage - lower.percentage) / (upper.percentage - lower.percentage),
		);
	}
	return REVIEW_FIGHT_HEALTH_COLOR_STOPS.at(-1)!.color;
}

/**
 * Build the compact, WCL-style progress marker used by the pull selector.
 *
 * The last transition is intentional: on encounters which cycle P1 -> P2 ->
 * P1, WCL identifies a wipe by the phase active at the end, rather than the
 * deepest phase which appeared at any earlier point in the pull.
 */
export function getReviewFightProgress(
	fight: fightDetails,
	phaseDefinitions: reportDetails['phases'] | null | undefined,
): ReviewFightProgress {
	if (fight.kill) {
		return { label: 'KILL', color: REVIEW_FIGHT_KILL_COLOR };
	}

	const fightPercentage = getReviewFightPercentage(fight);
	const percentageLabel = formatFightPercentage(fightPercentage);
	const wipeColor = getReviewFightWipeColor(fightPercentage);
	const encounterPhases = phaseDefinitions?.find(
		entry => entry.encounterID === fight.encounterID,
	)?.phases || [];
	if (encounterPhases.length === 0) {
		return { label: percentageLabel, color: wipeColor };
	}

	const latestTransition = [...(fight.phaseTransitions || [])]
		.filter(transition => Number.isFinite(transition.startTime))
		.sort((left, right) => left.startTime - right.startTime)
		.at(-1);
	const activePhase = latestTransition
		? encounterPhases.find(phase => phase.id === latestTransition.id)
		: encounterPhases[0];
	if (!activePhase) {
		return { label: percentageLabel, color: wipeColor };
	}

	let phaseNumber = 0;
	let intermissionNumber = 0;
	for (const phase of encounterPhases) {
		const number = phase.isIntermission ? ++intermissionNumber : ++phaseNumber;
		if (phase.id !== activePhase.id) continue;
		const phaseLabel = `${phase.isIntermission ? 'I' : 'P'}${number}`;
		return {
			label: `${percentageLabel} ${phaseLabel}`,
			color: wipeColor,
		};
	}

	return { label: percentageLabel, color: wipeColor };
}
