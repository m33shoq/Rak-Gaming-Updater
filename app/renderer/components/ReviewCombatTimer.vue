<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { useReviewTimelinePlayback } from '@/renderer/composables/useReviewTimelinePlayback';

const props = defineProps<{
	maxSeconds: number;
}>();

const playback = useReviewTimelinePlayback();

const label = ref('0:00.0');
let anchorSeconds = 0;
let anchorTime = 0;
let updateTimeout: number | null = null;

function clampSeconds(seconds: number): number {
	const maximum = Math.max(0, Number.isFinite(props.maxSeconds) ? props.maxSeconds : 0);
	return Math.min(maximum, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
}

function formatTime(seconds: number): string {
	const roundedTenths = Math.round(clampSeconds(seconds) * 10);
	const minutes = Math.floor(roundedTenths / 600);
	const remainingTenths = roundedTenths % 600;
	return `${minutes}:${(remainingTenths / 10).toFixed(1).padStart(4, '0')}`;
}

function stopUpdates() {
	if (updateTimeout === null) return;
	window.clearTimeout(updateTimeout);
	updateTimeout = null;
}

function updateTimer(now: number) {
	updateTimeout = null;
	const elapsedSeconds = playback.playing.value ? (now - anchorTime) / 1000 : 0;
	const displayedSeconds = clampSeconds(anchorSeconds + elapsedSeconds);
	const nextLabel = formatTime(displayedSeconds);
	if (label.value !== nextLabel) label.value = nextLabel;

	if (playback.playing.value && displayedSeconds < props.maxSeconds) {
		// The label only exposes tenths, so schedule its next possible visual change
		// instead of running a requestAnimationFrame loop 60 times per second.
		const roundedTenths = Math.round(displayedSeconds * 10);
		const nextBoundarySeconds = (roundedTenths + 0.5) / 10;
		const delayMilliseconds = Math.max(16, Math.ceil((nextBoundarySeconds - displayedSeconds) * 1000));
		updateTimeout = window.setTimeout(() => updateTimer(performance.now()), delayMilliseconds);
	}
}

function synchronizeTimer(seconds: number) {
	stopUpdates();
	anchorSeconds = clampSeconds(seconds);
	anchorTime = performance.now();
	updateTimer(anchorTime);
}

watch(
	() => [playback.cursorPercent.value, props.maxSeconds, playback.playing.value] as const,
	([cursorPercent, maxSeconds]) => synchronizeTimer(cursorPercent * maxSeconds),
	{ immediate: true },
);

onBeforeUnmount(stopUpdates);
</script>

<template>
	<span>{{ label }}</span>
</template>
