<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { IPC_EVENTS } from '@/events';
import type { ReviewTimelineViewMode, ReviewTimelineWindowAction, ReviewTimelineWindowContext } from '@/timelineWindow';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import ReviewCooldownTimeline from '@/renderer/components/ReviewCooldownTimeline.vue';
import WinButtons from '@/renderer/components/WinButtons.vue';

const reviewsStore = useReviewsStore();
const darkMode = getElectronStoreRef('darkMode', true);
const context = shallowRef<ReviewTimelineWindowContext | null>(null);
const cursorPercent = ref(0);
const emptyCooldownData: reviewFightCooldownData = {
	catalogVersion: 0,
	cooldownGroups: [],
	fightCooldownEvents: [],
};
const timelineCooldownData = computed(() => reviewsStore.getFightCooldownData || emptyCooldownData);
const timelineFightEvents = computed(() => reviewsStore.getFightEvents);
const timelineLoading = computed(() => reviewsStore.isFightCooldownsLoading);
const timelineError = computed(() => reviewsStore.getFightCooldownError);

async function applyContext(nextContext: ReviewTimelineWindowContext | null) {
	if (!nextContext) return;
	context.value = nextContext;
	cursorPercent.value = nextContext.cursorPercent;
	await reviewsStore.hydrateTimelineWindowContext(nextContext);
	// Requests cannot be transferred between renderer processes. Revalidate the
	// selected pull locally; timestamped snapshots make this a cache hit when the
	// main renderer already supplied fresh data.
	void Promise.allSettled([
		reviewsStore.ensureFightEvents(nextContext.reportCode, nextContext.fightID),
		reviewsStore.ensureFightCooldowns(nextContext.reportCode, nextContext.fightID),
	]);
}

function sendAction(action: ReviewTimelineWindowAction) {
	ipc.send(IPC_EVENTS.TIMELINE_WINDOW_ACTION, action);
}

function updateViewMode(viewMode: ReviewTimelineViewMode) {
	if (context.value) context.value = { ...context.value, viewMode };
	sendAction({ type: 'view-mode', viewMode });
}

function publishTimelineData(fightID?: number) {
	const reportCode = context.value?.reportCode;
	if (!reportCode) return;
	const snapshot = reviewsStore.createTimelineWindowDataSnapshot(
		reportCode,
		fightID ? [fightID] : undefined,
	);
	// Cached event objects are reactive in Pinia. Send an isolated plain snapshot.
	ipc.send(IPC_EVENTS.TIMELINE_WINDOW_DATA_SET, JSON.parse(JSON.stringify(snapshot)));
}

function publishAllTimelineData() {
	publishTimelineData();
}

function reattachTimeline() {
	publishAllTimelineData();
	ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'timeline-closed' });
}

watch(() => reviewsStore.timelineWindowDataRevision, () => {
	const updatedFight = reviewsStore.timelineWindowUpdatedFight;
	if (updatedFight?.reportCode === context.value?.reportCode) publishTimelineData(updatedFight.fightID);
}, { flush: 'sync' });

useIpcOn(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_UPDATED, (_event, nextContext: ReviewTimelineWindowContext) => {
	void applyContext(nextContext);
});

useIpcOn(IPC_EVENTS.TIMELINE_WINDOW_CURSOR_UPDATED, (_event, nextCursorPercent: number) => {
	if (Number.isFinite(nextCursorPercent)) cursorPercent.value = nextCursorPercent;
});

onMounted(async () => {
	window.addEventListener('beforeunload', publishAllTimelineData);
	try {
		const initialContext = await ipc.invoke(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_GET) as ReviewTimelineWindowContext | null;
		if (!initialContext) {
			ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'context-unavailable' });
			return;
		}
		await applyContext(initialContext);
		ipc.send(IPC_EVENTS.TIMELINE_WINDOW_CONTEXT_READY);
	} catch (error) {
		log.error('Failed to initialize detached review timeline', error);
		ipc.send(IPC_EVENTS.TIMELINE_WINDOW_REATTACH, { reason: 'context-unavailable' });
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('beforeunload', publishAllTimelineData);
});
</script>

<template>
	<div
		class="flex h-screen min-h-0 flex-col overflow-hidden bg-light1 font-main text-black dark:bg-dark1 dark:text-gray-50"
		:class="{ dark: darkMode }"
	>
		<header data-app-title-bar class="drag relative flex h-9 shrink-0 items-center border-b border-sky-500/20 bg-light4 pl-3 pr-24 shadow-md dark:bg-dark4">
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold tracking-tight">{{ context?.title || 'Fight timeline' }}</div>
				<div class="truncate text-[9px] uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Detached from Reviews</div>
			</div>
			<button
				type="button"
				class="no-drag ml-auto mr-1 h-6 border border-neutral-500/30 bg-neutral-500/[0.06] px-2 text-[10px] font-medium text-neutral-600 hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:text-neutral-300 dark:hover:text-sky-300"
				title="Return timeline to the Reviews tab"
				@click="reattachTimeline"
			>
				Return to Reviews
			</button>
			<WinButtons hide-minimize class="w-22" />
		</header>

		<main class="min-h-0 flex-1 overflow-hidden">
			<ReviewCooldownTimeline
				v-if="context"
				detached
				:expanded="true"
				:view-mode="context.viewMode"
				:events="timelineCooldownData.fightCooldownEvents"
				:fight-events="timelineFightEvents"
				:groups="timelineCooldownData.cooldownGroups"
				:phases="context.phases"
				:fight-start-time="context.fightStartTime"
				:fight-duration="context.fightDuration"
				:cursor-percent="cursorPercent"
				:loading="timelineLoading"
				:error="timelineError"
				@update:view-mode="updateViewMode"
				@seek="timestampSeconds => sendAction({ type: 'seek', timestampSeconds })"
				@open-fight="fightID => sendAction({ type: 'open-fight', fightID })"
				@open-death="deathID => sendAction({ type: 'open-death', deathID })"
				@seek-pull="(fightID, timestampSeconds) => sendAction({ type: 'seek-pull', fightID, timestampSeconds })"
				@open-pull-death="(fightID, deathID) => sendAction({ type: 'open-pull-death', fightID, deathID })"
			/>
			<div v-else class="flex h-full items-center justify-center text-sm text-neutral-500">Loading timeline...</div>
		</main>
	</div>
</template>
