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
	<input v-text=label
		:class
		:placeholder
		:type
		@change="change"
		v-model="model">
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

input:focus {
	outline: none;
	border-color: #007ACC;
	box-shadow: 0 0 2px rgba(0, 122, 204, 0.5);
}

input::placeholder {
	user-select: none;
}
</style>
