export function buildReviewPhaseMarkers(
	phaseDefinitions: reportDetails['phases'] | null | undefined,
	fight: fightDetails | null | undefined,
	fightDurationMs: number,
): reviewPhaseMarker[] {
	if (!phaseDefinitions || !fight?.phaseTransitions || !fightDurationMs) return [];

	const phaseIdToLabel = new Map<number, string>();
	let phaseCount = 0;
	let intermissionCount = 0;
	const encounterPhases = phaseDefinitions.find(
		entry => entry.encounterID === fight.encounterID,
	)?.phases || [];

	for (const phase of encounterPhases) {
		const label = phase.isIntermission
			? `I${++intermissionCount}`
			: `P${++phaseCount}`;
		phaseIdToLabel.set(phase.id, label);
	}

	return fight.phaseTransitions
		.map(transition => ({
			name: phaseIdToLabel.get(transition.id) || transition.id,
			percent: (transition.startTime - fight.startTime) / fightDurationMs,
		}))
		.filter(marker => marker.percent > 0 && marker.percent < 1);
}
