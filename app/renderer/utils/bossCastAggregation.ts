export const COLLAPSED_BOSS_CAST_AGGREGATION_WINDOW_SECONDS = 3;
export const COLLAPSED_BOSS_CAST_MAX_AGGREGATE_SPAN_SECONDS = 6;

const COLLAPSED_BOSS_CAST_VISUAL_COLLISION_PERCENT = 0.012;

type BossCastMarkerLike = {
	key: string;
	percent: number;
	timestampSeconds: number;
};

type BossCastLaneLike = {
	ability: { spellID: number };
	markers: BossCastMarkerLike[];
};

type BossCastAbilityLike = {
	spellID: number;
	name: string;
};

type BossCastEventLike = {
	timestamp: number;
	bossCast: { spellID: number };
};

export function sortBossCastAbilitiesByFirstOccurrence<TAbility extends BossCastAbilityLike>(
	abilities: readonly TAbility[],
	events: readonly BossCastEventLike[],
): TAbility[] {
	const firstTimestampBySpellID = new Map<number, number>();
	events.forEach((event) => {
		const currentTimestamp = firstTimestampBySpellID.get(event.bossCast.spellID);
		if (currentTimestamp == null || event.timestamp < currentTimestamp) {
			firstTimestampBySpellID.set(event.bossCast.spellID, event.timestamp);
		}
	});

	return [...abilities].sort((left, right) => {
		const leftTimestamp = firstTimestampBySpellID.get(left.spellID) ?? Number.POSITIVE_INFINITY;
		const rightTimestamp = firstTimestampBySpellID.get(right.spellID) ?? Number.POSITIVE_INFINITY;
		if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
		return left.name.localeCompare(right.name) || left.spellID - right.spellID;
	});
}

export type CollapsedBossCastMarker<
	TLane extends BossCastLaneLike,
> = {
	lane: TLane;
	marker: TLane['markers'][number];
	occurrences: Array<TLane['markers'][number]>;
	offsetPixels: number;
};

/**
 * Combines short bursts of the same spell using a rolling gap, while the
 * maximum span prevents a frequently cast spell from forming an indefinitely
 * growing chain. Visual offsets are then added for the remaining markers that
 * would otherwise occupy the same space.
 */
export function buildCollapsedBossCastMarkers<
	TLane extends BossCastLaneLike,
>(
	lanes: readonly TLane[],
	aggregationWindowSeconds = COLLAPSED_BOSS_CAST_AGGREGATION_WINDOW_SECONDS,
	maxAggregateSpanSeconds = COLLAPSED_BOSS_CAST_MAX_AGGREGATE_SPAN_SECONDS,
): CollapsedBossCastMarker<TLane>[] {
	const orderedMarkers = lanes
		.flatMap(lane => lane.markers.map(marker => ({ lane, marker })))
		.sort((left, right) => left.marker.timestampSeconds - right.marker.timestampSeconds);
	const groups: Array<Omit<CollapsedBossCastMarker<TLane>, 'offsetPixels'>> = [];
	const latestGroupBySpellID = new Map<number, Omit<CollapsedBossCastMarker<TLane>, 'offsetPixels'>>();

	orderedMarkers.forEach((item) => {
		const spellID = item.lane.ability.spellID;
		const existingGroup = latestGroupBySpellID.get(spellID);
		const previousOccurrence = existingGroup?.occurrences.at(-1);
		if (
			existingGroup
			&& previousOccurrence
			&& item.marker.timestampSeconds - previousOccurrence.timestampSeconds <= aggregationWindowSeconds
			&& item.marker.timestampSeconds - existingGroup.marker.timestampSeconds <= maxAggregateSpanSeconds
		) {
			existingGroup.occurrences.push(item.marker);
			return;
		}

		const group = {
			...item,
			occurrences: [item.marker],
		};
		groups.push(group);
		latestGroupBySpellID.set(spellID, group);
	});

	let collisionIndex = 0;
	let collisionStartPercent = Number.NEGATIVE_INFINITY;
	return groups.map((group) => {
		if (group.marker.percent - collisionStartPercent < COLLAPSED_BOSS_CAST_VISUAL_COLLISION_PERCENT) {
			collisionIndex++;
		} else {
			collisionIndex = 0;
			collisionStartPercent = group.marker.percent;
		}
		const direction = collisionIndex % 2 === 0 ? -1 : 1;
		const distance = Math.ceil(collisionIndex / 2) * 8;
		return { ...group, offsetPixels: direction * distance };
	});
}
