<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
	label: string;
	change?: () => void;
	options: Array<{
		value: string | number;
		label: string;
	}>;
}>();

const model = defineModel()

const toggled = ref(false);

const height = computed(() => {
	return props.options.length ? props.options.length * 24 + 4 + 'px' : '0px';
});

const innerText = computed(() => {
 	if (model.value) {
		return props.options.find(option => option.value === model.value)?.label || 'Select an option';
	}
	return 'Select an option';
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

</script>

<template>
	<!-- class dropdown is required here for global mouse click tracking -->
	<div class="dropdown flex flex-col mt-2 min-w-60 max-w-fit relative">
		<label>{{ label }}:</label>
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
			<div class="absolute top-full left-0 grid grid-cols-1  overflow-hidden rounded-b-md min-w-full z-10
				dark:bg-dark4
				bg-light4  transition-all"
				:style="{ height: toggled ? height : '0px' }"

			>
				<button v-for="option in options" class="text-white last:rounded-b-md p-0.5 px-4 text-left h-[24px] last:h-[28px] dark:hover:bg-dark3 hover:bg-light3 w-full whitespace-nowrap"

					:key="option.value"
					@click="selectOption(option.value)"
				>
					{{ option.label }}
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>

</style>
