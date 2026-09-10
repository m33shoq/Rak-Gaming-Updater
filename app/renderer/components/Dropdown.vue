<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
	label?: string;
	options: Array<{
		value: any;
		label: string;
		color?: string;
		overrideAction?: () => void;
		disabled?: boolean;
	}>;
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

const height = computed(() => {
	const rowCount = props.options.length + statusRowCount.value;
	return rowCount ? rowCount * 24 + 4 + 'px' : '0px';
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

function selectOption(option) {
	if (option.disabled) return;
	if (option.overrideAction) {
		option.overrideAction();
		return;
	}
	model.value = option.value;
	toggled.value = false;
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
	<div ref="dropdownRoot" class="dropdown flex flex-col mt-2 min-w-60 max-w-fit relative" :class="toggled ? 'z-[140]' : 'z-0'">
		<label v-if="label">{{ label }}:</label>
		<button
			:disabled="disabled"
			:class="[
				`text-white cursor-pointer flex items-center justify-between
				rounded-md px-3 py-1 transition-all ease-in`,
				disabled ? `cursor-not-allowed opacity-55` : ``,
				toggled
					? `rounded-b-none dark:bg-dark1 bg-light1`
					: `dark:bg-dark4 dark:hover:bg-dark4/80 bg-light4 hover:bg-light4/80`
			]"
			@click="toggleDropdown"
		>
		<span class="text-left">
			{{ innerText }}
		</span>
			<span class="flex items-center gap-1.5 shrink-0">
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
			<div class="absolute top-full left-0 grid grid-cols-1 overflow-hidden rounded-b-md min-w-full z-[150]
				dark:bg-dark4
				bg-light4  transition-all"
				:class="[
					showScrollbar ? 'overflow-y-auto' : 'overflow-y-hidden',
				]"
				:style="{
					height: toggled ? height : '0px',
					maxHeight: maxHeight
				}"
				@transitionend="onTransitionEnd"
			>
				<button
					v-if="error"
					class="h-[24px] px-2 text-left text-red-300 text-xs whitespace-nowrap"
					:class="onRetry ? 'cursor-pointer hover:bg-red-950/40' : 'cursor-default'"
					:disabled="!onRetry"
					@click="retry"
				>
					{{ error }}
				</button>
				<div
					v-else-if="loading && loadingLabel"
					class="h-[24px] px-2 flex items-center gap-2 text-xs opacity-75 whitespace-nowrap"
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
				>
					{{ emptyLabel }}
				</div>
				<button v-for="option in options" class="text-white last:rounded-b-md p-0.5 px-2 text-left h-[24px] last:h-[28px] dark:hover:bg-dark3 hover:bg-light3 w-full whitespace-nowrap relative disabled:opacity-50 disabled:cursor-wait"
					:key="option.value"
					:selected="model === option.value"
					:disabled="option.disabled"
					@click="selectOption(option)"
				>
					<div class="w-[3px] h-full absolute left-0 top-0 delay-150"
					:class="{
						'bg-secondary border-0 border-black': model === option.value,
						'bg-transparent border-0 border-black': model !== option.value
					}">
					</div>

					<span
					  :class="option.color ? colorMap[option.color] : ''"
					>
						{{ option.label }}
					</span>
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>

</style>
