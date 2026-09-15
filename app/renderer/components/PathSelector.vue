<script setup lang="ts">
defineProps<{
	click: () => void;
	placeholder: string;
	label: string;
	title: string;
	disabled?: boolean;
}>();


</script>

<template>
	<div class="flex flex-col mt-0 min-w-70 max-w-120 relative">
		<label>{{ title }}:</label>
		<div class="flex flex-row">
			<button class="
				w-full
				rounded-md
				min-h-8
				text-left
				p-1
				font-normal
				text-sm
				border-2
				border-transparent
				text-slate-700 dark:text-gray-300
				whitespace-nowrap
				dark:bg-dark4 dark:hover:bg-dark4/80
				bg-light4 shadow-sm hover:bg-light3
				hover:border-2 hover:border-primary
				box-border
				transition-all
				ease-in
				disabled:cursor-not-allowed
				disabled:opacity-50
				disabled:hover:border-transparent
				focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20
				overflow-hidden"
				@click="click"
				:disabled="disabled"
			>
				{{ label || placeholder }}
			</button>
			<slot/>
		</div>
	</div>
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
