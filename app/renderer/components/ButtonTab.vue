<script setup lang="ts">

interface ButtonProps {
	label: string;
	click?: () => void;
}

defineProps<ButtonProps>()

</script>

<template>
	<button class="min-w-24 bg-white rounded-md m-0.5 p-1.5 text-black font-semibold cursor-pointer no-drag disabled:bg-primary disabled:cursor-not-allowed disabled:pointer-events-none hover:bg-amber-200 disabled:text-white transition-all ease-in"
		@click="click">
		{{ label }}
	</button>
</template>

<style scoped>

</style>
