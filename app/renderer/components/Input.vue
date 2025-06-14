<script setup lang="ts">
defineProps<{
	class?: object;
	change?: () => void;
	placeholder?: string;
	type?: string;
}>();

const model = defineModel()

</script>

<template>
	<input class="placeholder:text-gray-500 placeholder:text-sm placeholder: placeholder:select-none focus:outline-hidden focus:shadow-sm shadow-primary"
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
	border: 2px solid #333333;
	background-color: #333333;
	color: #FFFFFF;
	cursor: text;
	white-space: nowrap;
}

</style>
