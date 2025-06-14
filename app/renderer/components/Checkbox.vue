<script setup lang="ts">
const { size = 6 } = defineProps<{
	label: string;
	change?: () => void;
	size?: 4 | 5 | 6 | 7;
}>();

const model = defineModel();

</script>

<template>
	<div class="checkbox-container flex items-center mt-4">
		<div class="relative"
			:class="`size-${size}`"
		>
			<input
				type="checkbox"
				class="peer absolute inset-0 cursor-pointer appearance-none
					rounded-md transition-all ease-in
					dark:border-dark4 border-light4
					dark:bg-dark3 bg-light3
					checked:bg-primary checked:border-primary
					hover:bg-indigo-400 checked:hover:bg-indigo-500"
				@change="change"
				v-model="model"
				:class="`size-${size}`"
			/>
			<svg
				v-show="model"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="3"
				stroke="currentColor"
				class="absolute inset-0 m-auto pointer-events-none text-white"
				:class="`size-${size}`"

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

/* .checkbox-container input[type="checkbox"]:checked::after {
	content: '';
	position: absolute;
	left: 7px;
	top: 4px;
	width: 5px;
	height: 10px;
	border: solid white;
	border-width: 0 3px 3px 0;
	transform: rotate(45deg);
} */

</style>
