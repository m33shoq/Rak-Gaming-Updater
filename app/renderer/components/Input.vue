<script setup lang="ts">
defineProps<{
	placeholder: string;
}>();

const model = defineModel()

</script>

<template>
	<input class="
	dark:bg-dark4 dark:hover:bg-dark4/80
	bg-light4 hover:bg-light4/80
	p-2
	m-1
	cursor-text
	whitespace-nowrap
	text-white
	rounded-md
	placeholder:text-gray-300
	placeholder:text-sm
	placeholder:select-none
	focus:outline-hidden
	transition-all
	ease-in
"
		:placeholder
		v-model="model"
	>

	</input>
</template>

<style scoped>
/* input {
	width: 100%;
	padding: 10px;
	margin-top: 10px;
	border-radius: 5px;
	border: 2px solid #333333;
	background-color: #333333;
	color: #FFFFFF;
	cursor: text;
	white-space: nowrap;
} */

</style>
