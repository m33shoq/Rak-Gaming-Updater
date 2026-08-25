import {
	aggregateTimelineOccurrences,
} from '@/renderer/utils/bossCastAggregation';

export type EncounterAlertMarkerLike = {
	event: fightEvent;
	key: string;
	percent: number;
	timestampSeconds: number;
};

export type AggregatedEncounterAlertMarker<TMarker extends EncounterAlertMarkerLike> = TMarker & {
	occurrences: TMarker[];
};

function getEncounterAlertKey(marker: EncounterAlertMarkerLike) {
	return marker.event.encounterAlert?.id
		|| `spell:${marker.event.encounterAlert?.spellID || marker.event.ability?.guid || 'unknown'}`;
}

/**
 * Uses the same rolling 3-second gap and 6-second maximum span as boss casts.
 * Aggregation is scoped to one encounter-alert definition so unrelated warnings
 * that happen together retain their own markers.
 */
export function aggregateEncounterAlertMarkers<TMarker extends EncounterAlertMarkerLike>(
	markers: readonly TMarker[],
): AggregatedEncounterAlertMarker<TMarker>[] {
	return aggregateTimelineOccurrences(
		markers,
		getEncounterAlertKey,
		marker => marker.timestampSeconds,
	).map(group => ({ ...group.item, occurrences: group.occurrences }));
}
