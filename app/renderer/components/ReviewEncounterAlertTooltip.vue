<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import ReviewCooldownTarget from '@/renderer/components/ReviewCooldownTarget.vue';
import ReviewRaidMarker from '@/renderer/components/ReviewRaidMarker.vue';
import { useTimelineOccurrenceTooltipLayout } from '@/renderer/utils/bossCastTooltipLayout';

const props = defineProps<{
	event: fightEvent;
	timestampLabel: string;
	occurrences?: Array<{
		event: fightEvent;
		timestampLabel: string;
	}>;
	x: number;
	y: number;
	contextLabel?: string;
	placement?: 'above' | 'below';
}>();

const numberFormatter = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 1,
	notation: 'compact',
});

const displayedOccurrences = computed(() => (
	props.occurrences?.length
		? props.occurrences
		: [{ event: props.event, timestampLabel: props.timestampLabel }]
));
const isAggregated = computed(() => displayedOccurrences.value.length > 1);
const occurrenceSpanSeconds = computed(() => {
	const first = displayedOccurrences.value[0]?.event.timestamp;
	const last = displayedOccurrences.value.at(-1)?.event.timestamp;
	return first == null || last == null ? 0 : Math.max(0, (last - first) / 1000);
});
const layoutContentKey = computed(() => [
	props.event.encounterAlert?.id,
	props.event.encounterAlert?.description,
	props.contextLabel,
	...displayedOccurrences.value.map(occurrence => [
		occurrence.event.timestamp,
		occurrence.timestampLabel,
		occurrence.event.source?.name,
		occurrence.event.sourceInstance,
		occurrence.event.target?.name,
		occurrence.event.targetInstance,
		occurrence.event.amount,
		occurrence.event.overheal,
	].join(':')),
].join('|'));

const {
	element: tooltipElement,
	tooltipStyle,
	occurrenceListStyle,
	occurrenceStyle: getOccurrenceStyle,
	prepare: prepareTooltip,
} = useTimelineOccurrenceTooltipLayout(() => ({
	occurrences: displayedOccurrences.value,
	placement: props.placement || 'above',
	x: props.x,
	y: props.y,
}));

onMounted(() => void prepareTooltip());
watch(layoutContentKey, () => void prepareTooltip(), { flush: 'post' });

function getEffectiveHealing(event: fightEvent) {
	return typeof event.amount === 'number' ? Math.max(0, event.amount) : null;
}

function formatEffectiveHealing(event: fightEvent) {
	return numberFormatter.format(getEffectiveHealing(event) || 0);
}

function getSpellIconURL(icon?: string) {
	if (!icon) return '';
	return /^https?:\/\//i.test(icon)
		? icon
		: `https://wow.zamimg.com/images/wow/icons/large/${icon.toLowerCase()}`;
}
</script>

<template>
	<div
		ref="tooltipElement"
		class="pointer-events-none fixed z-[999] w-max rounded-md border border-amber-400/65 bg-black/92 px-3 py-2 text-xs text-white shadow-xl"
		:class="isAggregated ? 'max-w-[calc(100vw-1rem)]' : 'max-w-[min(32rem,calc(100vw-1rem))]'"
		:style="tooltipStyle"
	>
		<div class="flex items-center gap-2">
			<span class="flex size-8 shrink-0 items-center justify-center border border-amber-200/80 bg-amber-500 text-xl font-black leading-none text-black shadow-[0_0_8px_rgba(245,158,11,0.35)]" aria-hidden="true">!</span>
			<img
				v-if="event.ability?.abilityIcon"
				:src="getSpellIconURL(event.ability.abilityIcon)"
				alt=""
				class="size-8 shrink-0 rounded-none border border-amber-500/50 bg-black"
			/>
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<span class="font-semibold text-amber-200">{{ event.encounterAlert?.label || event.ability?.name || 'Encounter alert' }}</span>
					<span v-if="isAggregated" class="border border-amber-400/45 bg-amber-500/15 px-1 text-[10px] font-semibold tabular-nums text-amber-200">&times;{{ displayedOccurrences.length }}</span>
				</div>
				<div class="tabular-nums text-neutral-300">
					<template v-if="isAggregated">{{ displayedOccurrences.length }} occurrences over {{ occurrenceSpanSeconds.toFixed(1) }}s</template>
					<template v-else>{{ timestampLabel }}</template>
				</div>
			</div>
		</div>
		<div v-if="event.encounterAlert?.description" class="mt-1.5 max-w-80 text-[11px] leading-snug text-neutral-200">
			{{ event.encounterAlert.description }}
		</div>
		<div :class="isAggregated ? 'mt-1.5 grid gap-x-3' : ''" :style="isAggregated ? occurrenceListStyle : undefined">
			<div
				v-for="(occurrence, occurrenceIndex) in displayedOccurrences"
				:key="`${occurrence.event.timestamp}:${occurrenceIndex}`"
				:class="isAggregated ? 'min-w-0 border-t border-neutral-700/70 py-1.5' : ''"
				:style="isAggregated ? getOccurrenceStyle(occurrenceIndex, displayedOccurrences.length) : undefined"
			>
				<div v-if="isAggregated" class="font-semibold tabular-nums text-amber-200">
					#{{ occurrenceIndex + 1 }} {{ occurrence.timestampLabel }}
				</div>
				<div v-if="occurrence.event.source" class="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-neutral-300">
					<span>Source:</span>
					<ReviewRaidMarker :marker="occurrence.event.sourceMarker" />
					<span>{{ occurrence.event.source.name || 'Unknown source' }}</span>
					<span v-if="occurrence.event.sourceInstance != null && occurrence.event.sourceInstance > 0" class="text-neutral-400">&middot; Spawn #{{ occurrence.event.sourceInstance }}</span>
				</div>
				<ReviewCooldownTarget
					v-if="occurrence.event.target"
					:target="occurrence.event.target"
					:target-marker="occurrence.event.targetMarker"
					:target-instance="occurrence.event.targetInstance"
				/>
				<div v-if="getEffectiveHealing(occurrence.event) != null" class="mt-1 text-[11px] font-medium text-emerald-300">
					Healing: {{ formatEffectiveHealing(occurrence.event) }}
					<span v-if="occurrence.event.overheal" class="font-normal text-neutral-400">&middot; {{ numberFormatter.format(occurrence.event.overheal) }} overheal</span>
				</div>
			</div>
		</div>
		<div class="mt-1 text-[10px] text-neutral-400">
			<span v-if="contextLabel">{{ contextLabel }} &middot; </span>Spell #{{ event.encounterAlert?.spellID || event.ability?.guid }} &middot; Click to seek<span v-if="isAggregated"> to first occurrence</span>
		</div>
	</div>
</template>
