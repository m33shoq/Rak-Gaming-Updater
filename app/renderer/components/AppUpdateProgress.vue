<script setup lang="ts">
import { computed } from 'vue';
import { IPC_EVENTS, type AppUpdateDownloadState } from '@/events';

const props = defineProps<{
	state: AppUpdateDownloadState;
}>();

const updatePercent = computed(() => Math.min(100, Math.max(0, props.state.percent || 0)));
const displayedPercent = computed(() => {
	if (props.state.status !== 'waiting-for-backup') return updatePercent.value;
	return props.state.backupProgress?.percent ?? null;
});
const hasMeasuredProgress = computed(() => props.state.total > 0 || updatePercent.value > 0);
const progressIsIndeterminate = computed(() => (
	(props.state.status === 'downloading' && !hasMeasuredProgress.value)
	|| (props.state.status === 'waiting-for-backup' && displayedPercent.value === null)
));
const progressWidth = computed(() => `${displayedPercent.value ?? 0}%`);
const backupProgressText = computed(() => {
	const progress = props.state.backupProgress;
	if (!progress) return '';

	const processedMB = formatMegabytes(progress.processedBytes);
	if (progress.phase === 'scanning') return `${processedMB} MB`;
	if ((progress.phase !== 'creating' && progress.phase !== 'validating') || progress.totalBytes <= 0) return '';
	return `${processedMB} / ${formatMegabytes(progress.totalBytes)} MB`;
});
const backupProgressStatusKey = computed(() => {
	switch (props.state.backupProgress?.phase) {
		case 'scanning': return 'backups.status.scanning';
		case 'checking-space': return 'backups.status.checkingspace';
		case 'creating': return 'backups.status.creating';
		case 'validating': return 'backups.status.validating';
		case 'waiting-for-stable-source': return 'backups.status.waitingforstablesource';
		case 'cancelling': return 'backups.status.cancelling';
		case 'cleaning': return 'backups.status.deletingold';
		default: return '';
	}
});
const lowDiskSpaceWarning = computed(() => {
	const warning = props.state.backupProgress?.diskSpaceWarning;
	if (!warning) return null;
	return {
		available: formatBytes(warning.availableBytes),
		recommended: formatBytes(warning.recommendedBytes),
	};
});

function formatMegabytes(bytes: number) {
	const megabytes = Math.max(0, bytes || 0) / (1024 * 1024);
	return megabytes.toFixed(megabytes >= 10 ? 1 : 2);
}

function formatBytes(bytes: number) {
	const nonNegativeBytes = Math.max(0, bytes || 0);
	const gigabytes = nonNegativeBytes / (1024 ** 3);
	if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
	return `${(nonNegativeBytes / (1024 ** 2)).toFixed(1)} MB`;
}

function abortBackup() {
	if (props.state.backupProgress?.cancellable !== true) return;
	ipc.send(IPC_EVENTS.BACKUPS_ABORT);
}

function retryUpdate() {
	if (props.state.status !== 'error' || props.state.canRetry !== true) return;
	ipc.send(IPC_EVENTS.APP_UPDATE_RETRY);
}
</script>

<template>
	<aside
		class="fixed left-1/2 top-12 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 border border-sky-500/40 bg-slate-950/95 px-4 py-3 text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-sm no-drag"
		role="status"
		aria-live="polite"
	>
		<div class="mb-2 flex items-start justify-between gap-4">
			<div class="min-w-0">
				<p class="text-sm font-semibold tracking-wide">
					<template v-if="state.status === 'downloading'">{{ $t('appupdate.downloading') }}</template>
					<template v-else-if="state.status === 'downloaded' || state.status === 'waiting-for-backup'">{{ $t('appupdate.downloaded') }}</template>
					<template v-else>{{ $t('appupdate.failed') }}</template>
				</p>
				<p v-if="state.version" class="mt-0.5 text-xs font-medium text-slate-400">
					{{ $t('appupdate.version', { version: state.version }) }}
				</p>
			</div>
			<span class="shrink-0 font-mono text-sm font-bold tabular-nums" :class="{
				'text-red-400': state.status === 'error',
				'text-amber-300': state.status === 'waiting-for-backup',
				'text-sky-300': state.status !== 'error' && state.status !== 'waiting-for-backup',
			}">
				{{ displayedPercent === null ? '—' : `${displayedPercent.toFixed(1)}%` }}
			</span>
		</div>

		<div
			class="relative h-2 overflow-hidden border border-slate-600/80 bg-slate-800"
			role="progressbar"
			:aria-valuenow="displayedPercent ?? undefined"
			aria-valuemin="0"
			aria-valuemax="100"
		>
			<div
				v-if="progressIsIndeterminate"
				class="app-update-progress-indeterminate absolute inset-y-0 w-1/3"
				:class="state.status === 'waiting-for-backup' ? 'bg-amber-400' : 'bg-sky-500'"
			/>
			<div
				v-else
				class="h-full transition-[width] duration-150 ease-out"
				:class="{
					'bg-gradient-to-r from-sky-600 to-blue-400': state.status === 'downloading',
					'bg-emerald-500': state.status === 'downloaded',
					'bg-amber-400': state.status === 'waiting-for-backup',
					'bg-red-500': state.status === 'error',
				}"
				:style="{ width: progressWidth }"
			/>
		</div>

		<div class="mt-2 flex min-w-0 items-center justify-between gap-4 font-mono text-xs font-medium text-slate-400 tabular-nums">
			<template v-if="state.status === 'downloading'">
				<span v-if="state.total > 0">
					{{ formatMegabytes(state.transferred) }} / {{ formatMegabytes(state.total) }} MB
				</span>
				<span v-else>{{ $t('appupdate.preparing') }}</span>
				<span v-if="state.bytesPerSecond > 0" class="shrink-0">
					{{ formatMegabytes(state.bytesPerSecond) }} MB/s
				</span>
			</template>
			<p v-else-if="state.status === 'downloaded'" class="font-main text-emerald-400">
				{{ $t('appupdate.installing') }}
			</p>
			<template v-else-if="state.status === 'waiting-for-backup'">
				<p class="font-main text-amber-300">
					{{ $t('appupdate.waiting_for_backup') }}
				</p>
				<span v-if="backupProgressStatusKey" class="min-w-0 text-right text-amber-200">
					{{ $t(backupProgressStatusKey) }}<template v-if="backupProgressText"> · {{ backupProgressText }}</template>
				</span>
			</template>
			<p v-else class="min-w-0 break-words font-main text-red-400">
				{{ state.error || $t('appupdate.unknown_error') }}
			</p>
		</div>
		<p v-if="state.status === 'waiting-for-backup' && lowDiskSpaceWarning" class="mt-2 text-xs font-medium text-amber-300">
			{{ $t('backups.warning.lowdiskspace', lowDiskSpaceWarning) }}
		</p>
		<button
			v-if="state.status === 'waiting-for-backup' && state.backupProgress?.cancellable"
			class="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-500"
			@click="abortBackup"
		>
			{{ $t('backups.abort') }}
		</button>
		<button
			v-if="state.status === 'error' && state.canRetry"
			class="mt-3 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
			@click="retryUpdate"
		>
			{{ $t('appupdate.retry') }}
		</button>
	</aside>
</template>

<style scoped>
@keyframes app-update-progress-slide {
	from { transform: translateX(-100%); }
	to { transform: translateX(400%); }
}

.app-update-progress-indeterminate {
	animation: app-update-progress-slide 1.1s ease-in-out infinite;
}
</style>
