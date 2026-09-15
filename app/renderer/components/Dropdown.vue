<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

interface DropdownOption {
	value: any;
	label: string;
	menuLabel?: string;
	meta?: string;
	secondaryMeta?: string;
	meterValue?: number | null;
	meterColor?: string;
	section?: string;
	sectionImage?: string;
	fullWidth?: boolean;
	color?: string;
	accentColor?: string;
	badge?: string;
	badgeBackgroundColor?: string;
	badgeColor?: string;
	badgeDarkColor?: string;
	statusLabel?: string;
	overrideAction?: () => void;
	closeOnAction?: boolean;
	disabled?: boolean;
}

const props = defineProps<{
	label?: string;
	options: DropdownOption[];
	columns?: number;
	maxVisible?: number;
	placeholder?: string;
	disabled?: boolean;
	loading?: boolean;
	loadingLabel?: string;
	empty?: boolean;
	emptyLabel?: string;
	error?: string | null;
	onOpen?: () => unknown;
	onClose?: () => unknown;
	onRetry?: () => unknown;
}>();

const model = defineModel()
const toggled = ref(false);
const showScrollbar = ref(false);
const dropdownRoot = ref<HTMLElement | null>(null);

watch(toggled, (newVal) => {
	if (newVal && props.onOpen) {
		void Promise.resolve(props.onOpen()).catch(error => {
			log.error('Dropdown open handler failed', error);
		});
	}
	if (!newVal && props.onClose) {
		void Promise.resolve(props.onClose()).catch(error => {
			log.error('Dropdown close handler failed', error);
		});
	}
});

watch(() => props.disabled, (disabled) => {
	if (disabled) hideDropdown();
});

const statusRowCount = computed(() => (
	props.error || (props.loading && props.loadingLabel) || (props.empty && props.emptyLabel) ? 1 : 0
));

const gridColumns = computed(() => Math.max(1, Math.floor(props.columns || 1)));
const gridMode = computed(() => gridColumns.value > 1);

const height = computed(() => {
	if (!gridMode.value) {
		const sectionHeight = props.options.reduce((total, option, index) => (
			shouldShowSection(option, index) ? total + getSectionHeight(option) : total
		), 0);
		const optionHeight = (props.options.length + statusRowCount.value) * 24;
		return optionHeight || sectionHeight ? `${optionHeight + sectionHeight + 4}px` : '0px';
	}

	let contentHeight = statusRowCount.value * 24 + 4;
	let pendingGridOptions = 0;
	const flushGridOptions = () => {
		contentHeight += Math.ceil(pendingGridOptions / gridColumns.value) * 64;
		pendingGridOptions = 0;
	};
	props.options.forEach((option, index) => {
		if (shouldShowSection(option, index)) {
			flushGridOptions();
			contentHeight += getSectionHeight(option);
		}
		if (option.fullWidth) {
			flushGridOptions();
			contentHeight += 24;
		} else {
			pendingGridOptions++;
		}
	});
	flushGridOptions();
	return contentHeight > 4 ? `${contentHeight}px` : '0px';
});

// Compute maxHeight for scrollable menu
const maxHeight = computed(() => {
    const max = props.maxVisible ?? 10; // default to 10 if not provided
    return (max * 24 + 4) + 'px';
});

const innerText = computed(() => {
 	if (model.value) {
		return props.options.find(option => option.value === model.value)?.label || props.placeholder || 'Select an option';
	}
	if (props.loading && props.loadingLabel) return props.loadingLabel;
	return props.placeholder || 'Select an option';
});

const selectedOption = computed(() => (
	props.options.find(option => option.value === model.value)
));

function selectOption(option) {
	if (option.disabled) return;
	if (option.overrideAction) {
		option.overrideAction();
		if (option.closeOnAction) toggled.value = false;
		return;
	}
	model.value = option.value;
	toggled.value = false;
}

function shouldShowSection(option: DropdownOption, index: number): boolean {
	return Boolean(option.section && option.section !== props.options[index - 1]?.section);
}

function getSectionHeight(option: DropdownOption): number {
	return option.sectionImage ? 42 : 22;
}

function getMeterWidth(value: number | null | undefined): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '0%';
	return `${Math.max(0, Math.min(100, value))}%`;
}

function toggleDropdown() {
	if (props.disabled) return;
	toggled.value = !toggled.value;
}

function retry() {
	if (!props.onRetry) return;
	void Promise.resolve(props.onRetry()).catch(error => {
		log.error('Dropdown retry handler failed', error);
	});
}

function hideDropdown() {
	toggled.value = false;
}

function onClickOutside(event: MouseEvent) {
	if (!(event.target instanceof Node) || !dropdownRoot.value?.contains(event.target)) {
		hideDropdown();
	}
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside);
});

// Watch toggled to hide scrollbar when closing
watch(toggled, (val) => {
	showScrollbar.value = false;
});

function onTransitionEnd() {
    if (toggled.value) {
        showScrollbar.value = true;
    }
}

const colorMap = {
  'red': 'text-red-500',
  'blue': 'text-blue-400',
  'green': 'text-green-300',
  // ...add all you need
};

</script>

<template>
	<div ref="dropdownRoot" class="dropdown relative mt-2 flex min-w-60 max-w-fit flex-col" :class="toggled ? 'z-[140]' : 'z-0'">
		<label v-if="label" class="mb-0.5 text-sm text-slate-700 dark:text-slate-200">{{ label }}:</label>
		<button
			:disabled="disabled"
			aria-haspopup="listbox"
			:aria-expanded="toggled"
			:class="[
				`flex cursor-pointer items-center justify-between rounded-md border border-slate-300
				bg-light4 px-3 py-1 text-slate-900 shadow-sm transition-all ease-in
				focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20
				dark:border-transparent dark:bg-dark4 dark:text-white dark:shadow-none`,
				disabled ? `cursor-not-allowed opacity-55` : ``,
				toggled
					? `rounded-b-none border-sky-400 bg-white dark:border-transparent dark:bg-dark1`
					: `hover:border-slate-400 hover:bg-light3 dark:hover:bg-dark4/80`
			]"
			@click="toggleDropdown"
		>
		<span class="min-w-0 flex-1 truncate text-left">
			{{ innerText }}
		</span>
			<span class="flex items-center gap-1.5 shrink-0">
				<span
					v-if="selectedOption?.badge"
					class="dropdown-badge text-xs font-bold tabular-nums"
					:class="selectedOption.badgeBackgroundColor ? 'px-1.5 py-0.5 leading-none' : ''"
					:style="{
						'--dropdown-badge-color': selectedOption.badgeColor || selectedOption.accentColor,
						'--dropdown-badge-dark-color': selectedOption.badgeDarkColor || selectedOption.badgeColor || selectedOption.accentColor,
						backgroundColor: selectedOption.badgeBackgroundColor,
					}"
				>
					{{ selectedOption.badge }}
				</span>
				<svg v-if="loading" class="size-4 animate-spin opacity-80" viewBox="0 0 24 24" fill="none">
					<circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" />
					<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 0 0-9-9v3a6 6 0 0 1 6 6h3Z" />
				</svg>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-6 inline-block transition-all ease-in"
					:class="toggled ? 'rotate-180' : ''"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
				</svg>
			</span>

		</button>
		<div>
			<div class="absolute left-0 top-full z-[150] grid min-w-full overflow-hidden rounded-b-md bg-light4 text-slate-900 transition-all dark:bg-dark4 dark:text-white"
				role="listbox"
				:aria-hidden="!toggled"
				:class="[
					showScrollbar ? 'overflow-y-auto' : 'overflow-y-hidden',
					toggled ? 'shadow-xl ring-1 ring-slate-300 dark:ring-slate-700' : 'shadow-none ring-0',
				]"
				:style="{
					height: toggled ? height : '0px',
					maxHeight: maxHeight,
					gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
					scrollbarGutter: 'stable',
				}"
				@transitionend="onTransitionEnd"
			>
				<button
					v-if="error"
					class="h-[24px] whitespace-nowrap px-2 text-left text-xs text-red-700 dark:text-red-300"
					:class="onRetry ? 'cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/40' : 'cursor-default'"
					style="grid-column: 1 / -1"
					:disabled="!onRetry"
					:tabindex="toggled ? 0 : -1"
					@click="retry"
				>
					{{ error }}
				</button>
				<div
					v-else-if="loading && loadingLabel"
					class="h-[24px] px-2 flex items-center gap-2 text-xs opacity-75 whitespace-nowrap"
					style="grid-column: 1 / -1"
				>
					<svg class="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" />
						<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 0 0-9-9v3a6 6 0 0 1 6 6h3Z" />
					</svg>
					{{ loadingLabel }}
				</div>
				<div
					v-else-if="empty && emptyLabel"
					class="h-[24px] px-2 flex items-center text-xs opacity-60 whitespace-nowrap"
					style="grid-column: 1 / -1"
				>
					{{ emptyLabel }}
				</div>
				<template v-for="(option, optionIndex) in options" :key="`${String(option.value)}:${optionIndex}`">
					<div
						v-if="shouldShowSection(option, optionIndex)"
						class="sticky top-0 z-[1] flex items-center border-y border-slate-300/80 bg-slate-100 font-bold uppercase text-slate-600 dark:border-neutral-500/25 dark:bg-dark4 dark:text-neutral-300"
						:class="option.sectionImage
							? 'h-[42px] gap-2 px-1.5 text-[11px] tracking-[0.06em]'
							: 'h-[22px] px-2 text-[10px] tracking-[0.08em]'"
						style="grid-column: 1 / -1"
					>
						<img
							v-if="option.sectionImage"
							:src="option.sectionImage"
							alt=""
							class="h-8 w-16 shrink-0 rounded-sm border border-neutral-500/30 bg-black/30 object-contain"
							draggable="false"
						>
						<span class="min-w-0 truncate">{{ option.section }}</span>
					</div>
					<button
						class="relative whitespace-nowrap text-left text-slate-800 disabled:cursor-wait disabled:opacity-50 dark:text-white"
						:class="[
							gridMode && !option.fullWidth
								? 'dropdown-grid-option m-0.5 h-[60px] w-[calc(100%_-_0.25rem)] cursor-pointer rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1.5 hover:border-slate-300 hover:bg-light3 dark:border-neutral-500/30 dark:bg-black/15 dark:hover:bg-dark3'
								: 'h-[24px] w-full px-2 hover:bg-light3 dark:hover:bg-dark3',
							gridMode && !option.fullWidth && model === option.value
								? 'dropdown-grid-option-selected'
								: '',
						]"
						:style="{
							gridColumn: option.fullWidth ? '1 / -1' : undefined,
							'--dropdown-grid-accent': option.accentColor || '#94a3b8',
						}"
						role="option"
						:aria-selected="model === option.value"
						:disabled="option.disabled"
						:tabindex="toggled ? 0 : -1"
						@click="selectOption(option)"
					>
						<div
							class="absolute left-0 top-0 h-full w-[3px] delay-150"
							:class="gridMode && !option.fullWidth
								? 'hidden'
								: {
									'bg-secondary border-0 border-black': model === option.value,
									'bg-transparent border-0 border-black': model !== option.value,
								}"
						/>

						<span
							v-if="gridMode && !option.fullWidth"
							class="grid h-full min-w-0 grid-cols-[auto_1fr_auto] grid-rows-2 items-center gap-x-3"
						>
							<span class="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-sm font-bold">
								<span
									class="min-w-0 truncate"
									:class="option.color ? colorMap[option.color] : ''"
								>
									{{ option.menuLabel || option.label }}
								</span>
								<span
									v-if="option.statusLabel"
									class="shrink-0 rounded-sm border border-sky-500/35 bg-sky-100 px-1 py-px text-[9px] font-extrabold leading-none tracking-[0.06em] text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
								>
									{{ option.statusLabel }}
								</span>
							</span>
							<span
								v-if="option.badge"
								class="dropdown-badge col-start-3 row-start-1 justify-self-end px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums"
								:style="{
									'--dropdown-badge-color': option.badgeColor || option.accentColor,
									'--dropdown-badge-dark-color': option.badgeDarkColor || option.badgeColor || option.accentColor,
									backgroundColor: option.badgeBackgroundColor,
								}"
							>
								{{ option.badge }}
							</span>
							<span class="col-start-2 row-start-1 justify-self-center text-sm font-semibold tabular-nums text-slate-800 dark:text-white">
								{{ option.meta }}
							</span>
							<span class="col-start-1 row-start-2 text-[11px] font-normal tabular-nums text-slate-500 dark:text-neutral-400">
								{{ option.secondaryMeta }}
							</span>
							<span
								v-if="option.meterValue != null"
								class="col-start-2 col-end-4 row-start-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-950/35"
								aria-hidden="true"
							>
								<span
									class="block h-full rounded-full"
									:style="{
										width: getMeterWidth(option.meterValue),
										backgroundColor: option.meterColor,
									}"
								/>
							</span>
						</span>
						<span v-else class="flex min-w-0 items-center justify-between gap-3">
							<span class="flex min-w-0 items-baseline gap-3">
								<span class="flex min-w-0 items-center gap-1.5">
									<span
										class="min-w-0 truncate"
										:class="option.color ? colorMap[option.color] : ''"
									>
										{{ option.menuLabel || option.label }}
									</span>
									<span
										v-if="option.statusLabel"
										class="shrink-0 rounded-sm border border-sky-500/35 bg-sky-100 px-1 py-px text-[9px] font-extrabold leading-none tracking-[0.06em] text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
									>
										{{ option.statusLabel }}
									</span>
								</span>
								<span
									v-if="option.meta"
									class="shrink-0 text-xs font-normal tabular-nums text-slate-500 dark:text-neutral-400"
								>
									{{ option.meta }}
								</span>
								<span
									v-if="option.secondaryMeta"
									class="shrink-0 text-xs font-normal tabular-nums text-slate-500 dark:text-neutral-400"
								>
									{{ option.secondaryMeta }}
								</span>
							</span>
							<span
								v-if="option.badge"
								class="dropdown-badge shrink-0 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums"
								:style="{
									'--dropdown-badge-color': option.badgeColor || option.accentColor,
									'--dropdown-badge-dark-color': option.badgeDarkColor || option.badgeColor || option.accentColor,
									backgroundColor: option.badgeBackgroundColor,
								}"
							>
								{{ option.badge }}
							</span>
						</span>
						<span
							v-if="option.accentColor"
							class="absolute h-[2px] opacity-90"
							:class="gridMode && !option.fullWidth
								? 'inset-x-2 bottom-1 rounded-full'
								: 'inset-x-1 bottom-0'"
							:style="{ backgroundColor: option.accentColor }"
						/>
					</button>
				</template>
			</div>
		</div>
	</div>
</template>

<style scoped>
.dropdown-grid-option-selected {
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-secondary) 65%, transparent);
}

.dropdown-grid-option:focus-visible {
	z-index: 3;
	outline: 1px solid var(--dropdown-grid-accent);
	outline-offset: -1px;
}

.dropdown-badge {
	color: var(--dropdown-badge-color, currentColor);
}

.dark .dropdown-badge {
	color: var(--dropdown-badge-dark-color, var(--dropdown-badge-color, currentColor));
}
</style>
