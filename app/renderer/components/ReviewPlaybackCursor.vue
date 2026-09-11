<script setup lang="ts">
import { computed } from 'vue';

import {
	type ReviewTimelineCursorMapping,
	useReviewTimelinePlayback,
} from '@/renderer/composables/useReviewTimelinePlayback';

const props = withDefaults(defineProps<{
	mapping?: ReviewTimelineCursorMapping | null;
	minimumPercent?: number;
	maximumPercent?: number;
	showAtBounds?: boolean;
	caret?: boolean;
}>(), {
	mapping: null,
	minimumPercent: 0,
	maximumPercent: 1,
	showAtBounds: false,
	caret: false,
});

const playback = useReviewTimelinePlayback();
const position = computed(() => {
	const cursorPercent = Number.isFinite(playback.cursorPercent.value)
		? playback.cursorPercent.value
		: 0;
	if (!props.mapping) return cursorPercent;

	const {
		fightDurationSeconds,
		timelineOriginSeconds,
		timelineStartSeconds,
		timelineDurationSeconds,
	} = props.mapping;
	if (!Number.isFinite(timelineDurationSeconds) || timelineDurationSeconds <= 0) return null;

	const cursorSeconds = cursorPercent * fightDurationSeconds;
	return (cursorSeconds - timelineOriginSeconds - timelineStartSeconds) / timelineDurationSeconds;
});
const visible = computed(() => {
	const percent = position.value;
	if (percent == null || !Number.isFinite(percent)) return false;
	return props.showAtBounds
		? percent >= props.minimumPercent && percent <= props.maximumPercent
		: percent > props.minimumPercent && percent < props.maximumPercent;
});
const left = computed(() => `${(position.value ?? 0) * 100}%`);
</script>

<template>
	<div v-if="visible" :style="{ left }">
		<span v-if="caret" class="absolute -left-1 top-0 size-0 border-x-4 border-t-4 border-x-transparent border-t-amber-400"></span>
	</div>
</template>
