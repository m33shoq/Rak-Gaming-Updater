<script setup lang="ts">
const { size = 22 } = defineProps<{
	label: string;
	size?: number;
}>();

const model = defineModel();

</script>

<template>
	<div class="checkbox-container flex items-center mt-4">
		<div class="relative"
			:style="`height: ${size}px; width: ${size}px;`"
		>
			<input
				type="checkbox"
				class="peer absolute inset-0 cursor-pointer appearance-none
					rounded-md border border-slate-300 bg-white shadow-sm transition-all ease-in
					dark:border-dark4 dark:bg-dark3 dark:shadow-none
					checked:bg-primary checked:border-primary
					hover:border-sky-400 hover:bg-sky-50 checked:hover:bg-blue-700
					dark:hover:border-transparent dark:hover:bg-indigo-400 dark:checked:hover:bg-indigo-500
					focus:outline-none focus:ring-2 focus:ring-sky-500/25"
				v-model="model"
			/>
			<svg
				v-show="model"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="3"
				stroke="currentColor"
				class="absolute inset-0 m-auto pointer-events-none text-white"
			>
        		<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
     		 </svg>
    	</div>
		<label class="ml-2.5">
			{{ label }}
		</label>
	</div>
</template>

<style scoped>

</style>
