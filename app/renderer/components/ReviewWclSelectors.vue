<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IPC_EVENTS } from '@/events';
import UIButton from '@/renderer/components/Button.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';

const WCL_DIFFICULTY_NAMES: Readonly<Record<number, string>> = {
	1: 'LFR',
	2: 'Flex',
	3: 'Normal',
	4: 'Heroic',
	5: 'Mythic',
	10: 'Mythic+',
};

const reviewsStore = useReviewsStore();
const { t } = useI18n();
const isAuthorized = ref(false);
let initialReportsRequested = false;
let authorizationStatusRevision = 0;

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDifficulty(difficulty: number | null | undefined): string {
	if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) return '';
	const difficultyName = WCL_DIFFICULTY_NAMES[difficulty];
	return difficultyName ? difficultyName.charAt(0) : `[${difficulty}]`;
}

function applyAuthorizationStatus(authorized: unknown): void {
	isAuthorized.value = authorized === true;
	if (!isAuthorized.value) {
		initialReportsRequested = false;
		return;
	}
	if (initialReportsRequested) return;
	initialReportsRequested = true;
	void reviewsStore.requestReports();
}

useIpcOn(IPC_EVENTS.WCL_AUTH_STATUS_UPDATED, (_event, authorized: boolean) => {
	authorizationStatusRevision++;
	applyAuthorizationStatus(authorized);
});

onMounted(async () => {
	const requestedAtRevision = authorizationStatusRevision;
	try {
		const authorized = await ipc.invoke(IPC_EVENTS.WCL_AUTH_STATUS_GET);
		if (authorizationStatusRevision === requestedAtRevision) {
			applyAuthorizationStatus(authorized);
		}
	} catch (error) {
		log.error('Failed to load WCL authorization status', error);
	}
});

async function authorize(): Promise<void> {
	try {
		await ipc.invoke(IPC_EVENTS.WCL_REQUEST_AUTH_LINK);
	} catch (error) {
		log.error('Failed to open WCL authorization', error);
	}
}

const reportOptions = computed(() => {
	const options: Array<{
		label: string;
		value: string | null | undefined;
		disabled?: boolean;
		overrideAction?: () => void;
	}> = [{ label: '--', value: null }];

	options.push(...reviewsStore.getReports.map(report => ({
		label: `${report.title} - ${new Date(report.startTime).toLocaleString()}`,
		value: report.code,
	})));

	const lastReport = reviewsStore.getReports.at(-1);
	if (lastReport?.endTime && reviewsStore.hasOlderReports) {
		options.push({
			label: reviewsStore.olderReportsLoading
				? t('reviews.loading_older_reports')
				: t('reviews.load_older_reports'),
			value: undefined,
			disabled: reviewsStore.olderReportsLoading,
			overrideAction: () => {
				void reviewsStore.requestReports(lastReport.endTime);
			},
		});
	}

	return options;
});

const reportDropdownLoading = computed(() => (
	reviewsStore.isReportListLoading || reviewsStore.olderReportsLoading
));
const reportDropdownLoadingLabel = computed(() => (
	reviewsStore.getReports.length === 0 ? t('reviews.loading_reports') : undefined
));
const reportDropdownError = computed(() => (
	reviewsStore.reportListError || reviewsStore.olderReportsError
		? t('reviews.reports_load_failed')
		: null
));
const reportDropdownEmpty = computed(() => (
	reviewsStore.reportListStatus === 'ready' && reviewsStore.getReports.length === 0
));

function retryReportLoad(): Promise<boolean> {
	if (reviewsStore.olderReportsError) {
		const lastReport = reviewsStore.getReports.at(-1);
		if (lastReport?.endTime) return reviewsStore.requestReports(lastReport.endTime, true);
	}
	return reviewsStore.requestReports(undefined, true);
}

const fightOptions = computed(() => {
	const options: Array<{
		label: string;
		value: number | null;
		color?: string;
	}> = [{ label: '--', value: null }];
	const fights = reviewsStore.getReportDetails?.fights;
	if (!fights) return options;

	const pullCounts = new Map<number, number>();
	const countsByEncounterAndDifficulty = new Map<string, number>();
	const chronologicalFights = [...fights].sort((left, right) => left.startTime - right.startTime);
	for (const fight of chronologicalFights) {
		const scope = `${fight.encounterID}:${fight.difficulty ?? 'unknown'}`;
		const count = (countsByEncounterAndDifficulty.get(scope) || 0) + 1;
		countsByEncounterAndDifficulty.set(scope, count);
		pullCounts.set(fight.id, count);
	}

	for (const fight of chronologicalFights.reverse()) {
		const difficulty = formatDifficulty(fight.difficulty);
		const difficultyLabel = difficulty ? ` ${difficulty}` : '';
		const result = fight.kill ? 'KILL' : `${fight.bossPercentage.toFixed(1)}%`;
		const duration = formatDuration((fight.endTime - fight.startTime) / 1000);
		const localStartTime = new Date(
			reviewsStore.getReportTimeOffset + fight.startTime,
		).toLocaleTimeString();
		options.push({
			label: `#${pullCounts.get(fight.id) || 0}${difficultyLabel} ${fight.name} ${result} ${duration} (${localStartTime})`,
			value: fight.id,
			color: fight.kill ? 'green' : undefined,
		});
	}

	return options;
});

const fightDropdownLoadingLabel = computed(() => (
	!reviewsStore.getReportDetails ? t('reviews.loading_fights') : undefined
));
const fightDropdownError = computed(() => (
	reviewsStore.selectedReportDetailsError ? t('reviews.fights_load_failed') : null
));
const fightDropdownEmpty = computed(() => (
	reviewsStore.selectedReportDetailsStatus === 'ready'
	&& reviewsStore.getReportDetails?.fights?.length === 0
));
</script>

<template>
	<div class="contents">
		<template v-if="isAuthorized">
			<Dropdown
				v-model="reviewsStore.selectedReportCode"
				:options="reportOptions"
				class="min-w-[34rem]"
				:placeholder="$t('reviews.select_report')"
				:loading="reportDropdownLoading"
				:loading-label="reportDropdownLoadingLabel"
				:empty="reportDropdownEmpty"
				:empty-label="$t('reviews.no_reports')"
				:error="reportDropdownError"
				:on-open="reviewsStore.requestReports"
				:on-retry="retryReportLoad"
			/>
			<Dropdown
				v-model="reviewsStore.selectedFightID"
				:options="fightOptions"
				class="min-w-[34rem]"
				:placeholder="$t('reviews.select_fight')"
				:disabled="!reviewsStore.selectedReportCode"
				:loading="reviewsStore.isSelectedReportDetailsLoading"
				:loading-label="fightDropdownLoadingLabel"
				:empty="fightDropdownEmpty"
				:empty-label="$t('reviews.no_fights')"
				:error="fightDropdownError"
				:on-open="reviewsStore.requestReportData"
				:on-retry="() => reviewsStore.requestReportData(true)"
			/>
		</template>
		<div
			v-else
			class="flex min-w-[34rem] h-[72px] items-center justify-center"
		>
			<UIButton
				class="h-14 min-w-[24rem] px-6 text-lg"
				label="Authorize WCL client"
				@click="authorize"
			/>
		</div>
	</div>
</template>
