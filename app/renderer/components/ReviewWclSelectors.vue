<script setup lang="ts">
import log from 'electron-log/renderer';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IPC_EVENTS } from '@/events';
import UIButton from '@/renderer/components/Button.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import {
	buildPullNumberByFightID,
	findNewReviewFightIDs,
	getReviewFightPercentage,
	getReviewFightProgress,
} from '@/reviewFights';
import { getReviewEncounterArt } from '@/reviewEncounterArt';
import { parseWarcraftLogsReportUrl } from '@/wclReportUrl';
import type { WclRequestResult } from '@/wclRequests';

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
const authorizing = ref(false);
const authorizationError = ref('');
const customReportDialogOpen = ref(false);
const customReportDialog = ref<HTMLFormElement | null>(null);
const customReportInput = ref<HTMLInputElement | null>(null);
const customReportUrl = ref('');
const customReportError = ref('');
const customReportLoading = ref(false);
const newlyFetchedFightIDs = ref<ReadonlySet<number>>(new Set());
const newlyFetchedFightReportCode = ref<string | null>(null);
let initialReportsRequested = false;
let authorizationStatusRevision = 0;
let fightDropdownOpenRevision = 0;
let customReportReturnFocus: HTMLElement | null = null;

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

function formatDifficultyName(difficulty: number | null | undefined): string {
	if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) return '';
	return WCL_DIFFICULTY_NAMES[difficulty] || `[${difficulty}]`;
}

function formatFightStartTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit',
	});
}

function formatReportDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function formatReportDateTime(timestamp: number): string {
	return `${new Date(timestamp).toLocaleDateString()} ${formatFightStartTime(timestamp)}`;
}

function applyAuthorizationStatus(authorized: unknown): void {
	isAuthorized.value = authorized === true;
	if (!isAuthorized.value) {
		initialReportsRequested = false;
		return;
	}
	authorizationError.value = '';
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
	if (authorizing.value) return;
	authorizing.value = true;
	authorizationError.value = '';
	try {
		const response = await ipc.invoke(
			IPC_EVENTS.WCL_REQUEST_AUTH_LINK,
		) as WclRequestResult<true>;
		if (!response || response.success !== true) {
			throw new Error(
				response && 'error' in response
					? response.error
					: t('reviews.authorization_unknown_error'),
			);
		}
	} catch (error) {
		log.error('Failed to open WCL authorization', error);
		authorizationError.value = t('reviews.authorization_failed', {
			error: error instanceof Error ? error.message : t('reviews.authorization_unknown_error'),
		});
	} finally {
		authorizing.value = false;
	}
}

async function openCustomReportDialog(): Promise<void> {
	const activeElement = document.activeElement instanceof HTMLElement
		? document.activeElement
		: null;
	customReportReturnFocus = activeElement?.closest('.dropdown')?.querySelector('button')
		|| activeElement;
	customReportUrl.value = '';
	customReportError.value = '';
	customReportLoading.value = false;
	customReportDialogOpen.value = true;
	await nextTick();
	customReportInput.value?.focus();
}

function closeCustomReportDialog(): void {
	if (customReportLoading.value) return;
	customReportDialogOpen.value = false;
	const returnFocus = customReportReturnFocus;
	customReportReturnFocus = null;
	void nextTick(() => {
		if (returnFocus?.isConnected && !returnFocus.hasAttribute('disabled')) returnFocus.focus();
	});
}

function onCustomReportDialogKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		event.preventDefault();
		closeCustomReportDialog();
		return;
	}
	if (event.key !== 'Tab') return;

	const dialog = customReportDialog.value;
	if (!dialog) return;
	const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
		'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
	)).filter(element => !element.hasAttribute('hidden'));
	if (focusable.length === 0) {
		event.preventDefault();
		dialog.focus();
		return;
	}

	const first = focusable[0];
	const last = focusable.at(-1)!;
	const activeElement = document.activeElement;
	if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
		event.preventDefault();
		first.focus();
	}
}

async function selectCustomReport(): Promise<void> {
	if (customReportLoading.value) return;
	const location = parseWarcraftLogsReportUrl(customReportUrl.value);
	if (!location) {
		customReportError.value = t('reviews.custom_report_invalid_url');
		return;
	}

	customReportError.value = '';
	customReportLoading.value = true;
	const loaded = await reviewsStore.requestReportDataForCode(location.reportCode);
	customReportLoading.value = false;
	if (!loaded) {
		customReportError.value = t('reviews.custom_report_load_failed');
		return;
	}
	reviewsStore.pinReportForSession(location.reportCode);
	reviewsStore.selectedReportCode = location.reportCode;

	if (
		location.fightID
		&& reviewsStore.getReportDetails?.fights.some(fight => fight.id === location.fightID)
	) reviewsStore.selectedFightID = location.fightID;
	closeCustomReportDialog();
}

const reportOptions = computed(() => {
	const options: Array<{
		label: string;
		menuLabel?: string;
		meta?: string;
		section?: string;
		value: string | null | undefined;
		disabled?: boolean;
		overrideAction?: () => void;
		closeOnAction?: boolean;
	}> = [{ label: '--', value: null }];
	options.push({
		label: t('reviews.select_custom_report'),
		value: 'custom-report-url',
		closeOnAction: true,
		overrideAction: () => {
			void openCustomReportDialog();
		},
	});

	const selectedReportCode = reviewsStore.selectedReportCode;
	if (
		selectedReportCode
		&& !reviewsStore.getSelectableReports.some(report => report.code === selectedReportCode)
	) {
		const details = reviewsStore.getReportDetails?.code === selectedReportCode
			? reviewsStore.getReportDetails
			: null;
		options.push({
			label: details
				? `${details.title} · ${formatReportDateTime(details.startTime)}`
				: `${t('reviews.custom_report')} · ${selectedReportCode}`,
			menuLabel: details?.title,
			meta: details ? formatFightStartTime(details.startTime) : undefined,
			section: details ? formatReportDate(details.startTime) : undefined,
			value: selectedReportCode,
		});
	}

	options.push(...reviewsStore.getSelectableReports.map(report => ({
		label: `${report.title} · ${formatReportDateTime(report.startTime)}`,
		menuLabel: report.title,
		meta: formatFightStartTime(report.startTime),
		section: reviewsStore.isReportPinnedForSession(report.code)
			? t('reviews.pinned_reports')
			: formatReportDate(report.startTime),
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
	reviewsStore.reportListStatus === 'ready' && reviewsStore.getSelectableReports.length === 0
));

function retryReportLoad(): Promise<boolean> {
	if (reviewsStore.olderReportsError) {
		const lastReport = reviewsStore.getReports.at(-1);
		if (lastReport?.endTime) return reviewsStore.requestReports(lastReport.endTime, true);
	}
	return reviewsStore.requestReports(undefined, true);
}

function clearNewFightLabels(): void {
	newlyFetchedFightIDs.value = new Set();
	newlyFetchedFightReportCode.value = null;
}

async function refreshFightsOnDropdownOpen(): Promise<boolean> {
	const openRevision = ++fightDropdownOpenRevision;
	const reportCode = reviewsStore.selectedReportCode;
	const previousDetails = reviewsStore.getReportDetails;
	const previousFights = reportCode && previousDetails?.code === reportCode
		? previousDetails.fights
		: null;
	clearNewFightLabels();
	if (!reportCode) return false;

	const loaded = await reviewsStore.requestReportData();
	if (
		!loaded
		|| openRevision !== fightDropdownOpenRevision
		|| reviewsStore.selectedReportCode !== reportCode
	) return loaded;

	const currentDetails = reviewsStore.getReportDetails;
	if (currentDetails?.code !== reportCode) return loaded;
	newlyFetchedFightIDs.value = new Set(
		findNewReviewFightIDs(previousFights, currentDetails.fights),
	);
	newlyFetchedFightReportCode.value = reportCode;
	return loaded;
}

function closeFightDropdown(): void {
	fightDropdownOpenRevision++;
	clearNewFightLabels();
}

const fightOptions = computed(() => {
	const options: Array<{
		label: string;
		menuLabel?: string;
		meta?: string;
		secondaryMeta?: string;
		meterValue?: number | null;
		meterColor?: string;
		section?: string;
		sectionImage?: string;
		fullWidth?: boolean;
		value: number | null;
		badge?: string;
		badgeBackgroundColor?: string;
		badgeColor?: string;
		badgeDarkColor?: string;
		statusLabel?: string;
	}> = [{ label: '--', value: null, fullWidth: true }];
	const fights = reviewsStore.getReportDetails?.fights;
	if (!fights) return options;

	const newestFirstFights = [...fights].sort((left, right) => (
		right.startTime - left.startTime
		|| right.id - left.id
	));
	const pullNumberByFightID = buildPullNumberByFightID(fights);

	for (const fight of newestFirstFights) {
		const difficulty = formatDifficulty(fight.difficulty);
		const difficultyName = formatDifficultyName(fight.difficulty);
		const difficultyLabel = difficulty ? ` ${difficulty}` : '';
		const progress = getReviewFightProgress(fight, reviewsStore.getReportDetails?.phases);
		const fightPercentage = getReviewFightPercentage(fight);
		const duration = formatDuration((fight.endTime - fight.startTime) / 1000);
		const localStartTime = formatFightStartTime(
			reviewsStore.getReportTimeOffset + fight.startTime,
		);
		const pullNumber = pullNumberByFightID.get(fight.id) || 0;
		options.push({
			label: `#${pullNumber}${difficultyLabel} ${fight.name} ${duration} (${localStartTime})`,
			menuLabel: `#${pullNumber}`,
			meta: duration,
			secondaryMeta: localStartTime,
			meterValue: fightPercentage,
			meterColor: progress.color,
			section: difficultyName ? `${fight.name} · ${difficultyName}` : fight.name,
			sectionImage: getReviewEncounterArt(fight.encounterID),
			value: fight.id,
			badge: progress.label,
			badgeBackgroundColor: fight.kill ? progress.color : `${progress.color}24`,
			badgeColor: fight.kill ? '#052e16' : `color-mix(in srgb, ${progress.color} 46%, #0f172a)`,
			badgeDarkColor: fight.kill ? '#052e16' : progress.color,
			statusLabel: newlyFetchedFightReportCode.value === reviewsStore.selectedReportCode
				&& newlyFetchedFightIDs.value.has(fight.id)
				? t('reviews.new_pull')
				: undefined,
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
				:columns="2"
				:max-visible="13"
				class="min-w-[34rem]"
				:placeholder="$t('reviews.select_fight')"
				:disabled="!reviewsStore.selectedReportCode"
				:loading="reviewsStore.isSelectedReportDetailsLoading"
				:loading-label="fightDropdownLoadingLabel"
				:empty="fightDropdownEmpty"
				:empty-label="$t('reviews.no_fights')"
				:error="fightDropdownError"
				:on-open="refreshFightsOnDropdownOpen"
				:on-close="closeFightDropdown"
				:on-retry="() => reviewsStore.requestReportData(true)"
			/>
		</template>
		<div
			v-else
			class="flex min-h-[72px] min-w-[34rem] flex-col items-center justify-center gap-1.5"
		>
			<UIButton
				class="h-14 min-w-[24rem] px-6 text-lg"
				:label="authorizing ? $t('reviews.authorizing_wcl') : $t('reviews.authorize_wcl')"
				:disabled="authorizing"
				@click="authorize"
			/>
			<p v-if="authorizationError" role="alert" class="max-w-[34rem] text-center text-xs text-red-700 dark:text-red-400">
				{{ authorizationError }}
			</p>
		</div>

		<Teleport to="body">
			<div
				v-if="customReportDialogOpen"
				class="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/65 p-6"
				role="presentation"
				@mousedown.self="closeCustomReportDialog"
			>
				<form
					ref="customReportDialog"
					class="w-full max-w-xl rounded-lg border border-slate-300 bg-light2 p-4 text-slate-900 shadow-2xl dark:border-neutral-500/45 dark:bg-dark2 dark:text-white"
					role="dialog"
					aria-modal="true"
					:aria-busy="customReportLoading"
					:aria-label="$t('reviews.select_custom_report')"
					tabindex="-1"
					novalidate
					@submit.prevent="selectCustomReport"
					@keydown="onCustomReportDialogKeydown"
				>
					<label for="custom-wcl-report-url" class="mb-2 block text-sm font-semibold">
						{{ $t('reviews.custom_report_url') }}
					</label>
					<input
						id="custom-wcl-report-url"
						ref="customReportInput"
						v-model.trim="customReportUrl"
						type="url"
						class="h-9 w-full rounded-md border border-slate-300 bg-light4 px-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-500 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-neutral-500/45 dark:bg-dark4 dark:text-white dark:placeholder:text-neutral-400"
						placeholder="https://www.warcraftlogs.com/reports/…"
						:readonly="customReportLoading"
						autocomplete="off"
						spellcheck="false"
					/>
					<p v-if="customReportError" role="alert" class="mt-2 text-xs text-red-700 dark:text-red-400">
						{{ customReportError }}
					</p>
					<div class="mt-4 flex justify-end gap-2">
						<button
							type="button"
							class="h-8 rounded-md border border-neutral-500/45 bg-light4 px-4 text-sm font-semibold hover:bg-light3 disabled:cursor-wait disabled:opacity-50 dark:bg-dark4 dark:hover:bg-dark3"
							:disabled="customReportLoading"
							@click="closeCustomReportDialog"
						>
							{{ $t('reviews.cancel') }}
						</button>
						<UIButton
							type="submit"
							class="h-8 px-4 text-sm"
							:label="customReportLoading
								? $t('reviews.opening_custom_report')
								: $t('reviews.open_custom_report')"
							:disabled="customReportLoading"
						/>
					</div>
				</form>
			</div>
		</Teleport>
	</div>
</template>
