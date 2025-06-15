<script setup lang="ts">

interface ButtonProps {
	label: string;
	click?: () => void;
}

const props = defineProps<ButtonProps>()

</script>

<template>
	<button class="inline-flex
		items-center
		gap-2
		cursor-pointer
		rounded-md
		bg-primary
		px-3
		py-1.5
		text-base/4
		min-h-8
		font-semibold
		text-white
		disabled:bg-primary-faded-light
		dark:disabled:bg-primary-faded-dark
		disabled:text-gray-300
		disabled:pointer-events-none
		hover:bg-indigo-400
		text-center
		justify-center
		transition-all
		ease-in"
		@click="click"
	>
		{{ label }}
	</button>
</template>

<style scoped>

</style>



