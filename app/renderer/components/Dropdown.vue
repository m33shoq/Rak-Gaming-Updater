<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
	label?: string;
	options: Array<{
		value: any;
		label: string;
		color?: string;
	}>;
	maxVisible?: number;
	placeholder?: string;
	onOpen?: () => void;
	onClose?: () => void;
}>();

const model = defineModel()
const toggled = ref(false);
const showScrollbar = ref(false);

watch(toggled, (newVal) => {
	if (newVal && props.onOpen) {
		props.onOpen();
	}
	if (!newVal && props.onClose) {
		props.onClose();
	}
});

const height = computed(() => {
	return props.options.length ? props.options.length * 24 + 4 + 'px' : '0px';
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
	return props.placeholder || 'Select an option';
});

function selectOption(value) {
	model.value = value;
	toggled.value = false;
}

function toggleDropdown() {
	toggled.value = !toggled.value;
}

function hideDropdown() {
	toggled.value = false;
}

function onClickOutside(event) {
	if (!event.target.closest('.dropdown')) {
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
	<!-- class dropdown is required here for global mouse click tracking -->
	<div class="dropdown flex flex-col mt-2 min-w-60 max-w-fit relative">
		<label v-if="label">{{ label }}:</label>
		<button
			:class="[
				`text-white cursor-pointer flex items-center justify-between
				rounded-md px-3 py-1 transition-all ease-in`,
				toggled
					? `rounded-b-none dark:bg-dark1 bg-light1`
					: `dark:bg-dark4 dark:hover:bg-dark4/80 bg-light4 hover:bg-light4/80`
			]"
			@click="toggleDropdown"
		>
		<span class="text-left">
			{{ innerText }}
		</span>
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-6 inline-block transition-all ease-in"
				:class="toggled ? 'rotate-180' : ''"
			>
				<path  stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
			</svg>

		</button>
		<div>
			<div class="absolute top-full left-0 grid grid-cols-1 overflow-hidden rounded-b-md min-w-full z-10
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
				<button v-for="option in options" class="text-white last:rounded-b-md p-0.5 px-2 text-left h-[24px] last:h-[28px] dark:hover:bg-dark3 hover:bg-light3 w-full whitespace-nowrap relative"
					:key="option.value"
					:selected="model === option.value"
					@click="selectOption(option.value)"
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
