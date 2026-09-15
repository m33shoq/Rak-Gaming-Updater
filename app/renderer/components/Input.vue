<script setup lang="ts">
defineProps<{
	placeholder: string;
}>();

const model = defineModel()

</script>

<template>
	<input class="
	dark:border-transparent dark:bg-dark4 dark:text-white dark:hover:bg-dark4/80
	border border-slate-300 bg-light4 text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-50
	p-2
	m-1
	cursor-text
	whitespace-nowrap
	rounded-md
	placeholder:text-slate-500 dark:placeholder:text-gray-300
	placeholder:text-sm
	placeholder:select-none
	focus:border-sky-500 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20
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
