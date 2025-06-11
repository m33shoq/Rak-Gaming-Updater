<script setup lang="ts">
defineProps<{
	label?: string;
	class?: object;
	change?: () => void;
	placeholder?: string;
	type?: string;
}>();

const model = defineModel()


</script>

<template>
	<input
		v-text=label
		:class
		:placeholder
		:type
		@change="change"
		v-model="model"
	>
	</input>
</template>

<style scoped>
input {
	width: 100%;
	padding: 10px;
	margin-top: 10px;
	border-radius: 5px;
	border: 1px solid #333333; /* Subtle border */
	background-color: #333333; /* Darker element background */
	color: #FFFFFF;
}

input::placeholder {
    user-select: none;
}

</style>
