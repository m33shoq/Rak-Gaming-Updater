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

export type TimelineOccurrenceGroup<TItem> = {
	item: TItem;
	occurrences: TItem[];
};

/**
 * Shared burst aggregation policy for timeline events: a rolling three-second
 * gap, capped at six seconds from the first occurrence in a group.
 */
export function aggregateTimelineOccurrences<TItem, TKey>(
	items: readonly TItem[],
	getKey: (item: TItem) => TKey,
	getTimestampSeconds: (item: TItem) => number,
	aggregationWindowSeconds = COLLAPSED_BOSS_CAST_AGGREGATION_WINDOW_SECONDS,
	maxAggregateSpanSeconds = COLLAPSED_BOSS_CAST_MAX_AGGREGATE_SPAN_SECONDS,
): TimelineOccurrenceGroup<TItem>[] {
	const groups: TimelineOccurrenceGroup<TItem>[] = [];
	const latestGroupByKey = new Map<TKey, TimelineOccurrenceGroup<TItem>>();

	[...items]
		.sort((left, right) => getTimestampSeconds(left) - getTimestampSeconds(right))
		.forEach((item) => {
			const key = getKey(item);
			const existingGroup = latestGroupByKey.get(key);
			const previousOccurrence = existingGroup?.occurrences.at(-1);
			if (
				existingGroup
				&& previousOccurrence
				&& getTimestampSeconds(item) - getTimestampSeconds(previousOccurrence) <= aggregationWindowSeconds
				&& getTimestampSeconds(item) - getTimestampSeconds(existingGroup.item) <= maxAggregateSpanSeconds
			) {
				existingGroup.occurrences.push(item);
				return;
			}

			const group = { item, occurrences: [item] };
			groups.push(group);
			latestGroupByKey.set(key, group);
		});

	return groups;
}

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
	const markers = lanes.flatMap(lane => lane.markers.map(marker => ({ lane, marker })));
	const groups = aggregateTimelineOccurrences(
		markers,
		item => item.lane.ability.spellID,
		item => item.marker.timestampSeconds,
		aggregationWindowSeconds,
		maxAggregateSpanSeconds,
	).map(group => ({
		...group.item,
		occurrences: group.occurrences.map(item => item.marker),
	}));

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
