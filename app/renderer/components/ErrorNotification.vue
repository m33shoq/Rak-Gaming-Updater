<script setup lang="ts">

interface ErrorInfoProps {
	label: string;
}

defineProps<ErrorInfoProps>()

</script>

<template>
	<div class="bg-red-600 hover:bg-red-700
	rounded-md m-0.5 p-1.5 text-white font-semibold transition-all ease-in absolute top-20 right-30 z-10 max-w-xs min-w-min min-h-fit wrap-anywhere"
		>
		{{ label }}
	</div>
</template>

<style scoped>

</style>
