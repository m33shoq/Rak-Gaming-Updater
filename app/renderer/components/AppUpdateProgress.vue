<script setup lang="ts">
import { computed } from 'vue';
import type { AppUpdateDownloadState } from '@/events';

const props = defineProps<{
	state: AppUpdateDownloadState;
}>();

const percent = computed(() => Math.min(100, Math.max(0, props.state.percent || 0)));
const hasMeasuredProgress = computed(() => props.state.total > 0 || percent.value > 0);
const progressWidth = computed(() => `${percent.value}%`);

function formatMegabytes(bytes: number) {
	const megabytes = Math.max(0, bytes || 0) / (1024 * 1024);
	return megabytes.toFixed(megabytes >= 10 ? 1 : 2);
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
					<template v-else-if="state.status === 'downloaded'">{{ $t('appupdate.downloaded') }}</template>
					<template v-else>{{ $t('appupdate.failed') }}</template>
				</p>
				<p v-if="state.version" class="mt-0.5 text-xs font-medium text-slate-400">
					{{ $t('appupdate.version', { version: state.version }) }}
				</p>
			</div>
			<span class="shrink-0 font-mono text-sm font-bold tabular-nums" :class="state.status === 'error' ? 'text-red-400' : 'text-sky-300'">
				{{ percent.toFixed(1) }}%
			</span>
		</div>

		<div
			class="relative h-2 overflow-hidden border border-slate-600/80 bg-slate-800"
			role="progressbar"
			:aria-valuenow="percent"
			aria-valuemin="0"
			aria-valuemax="100"
		>
			<div
				v-if="state.status === 'downloading' && !hasMeasuredProgress"
				class="app-update-progress-indeterminate absolute inset-y-0 w-1/3 bg-sky-500"
			/>
			<div
				v-else
				class="h-full transition-[width] duration-150 ease-out"
				:class="{
					'bg-gradient-to-r from-sky-600 to-blue-400': state.status === 'downloading',
					'bg-emerald-500': state.status === 'downloaded',
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
			<p v-else class="min-w-0 break-words font-main text-red-400">
				{{ state.error || $t('appupdate.unknown_error') }}
			</p>
		</div>
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
