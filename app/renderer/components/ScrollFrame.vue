<script setup lang="ts">
defineProps<{
	height: string;
}>();


</script>

<template>
	<div class="scroll-frame dark:bg-dark2 bg-light2" :style="{ height: `${height}px` }"
	>
		<slot/>
	</div>
</template>

<style>
.scroll-frame {
	color: #FFFFFF;
	margin-top: 15px;
	overflow-y: auto;
	border-radius: 6px;
}

.scroll-frame::-webkit-scrollbar {
	width: 10px;
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-track {
	background: #2E2E2E;
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-thumb {
	background: #555;
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-thumb:hover {
	background: #777;
}

.line-item {
	display: grid;
	grid-template-columns: 1fr auto auto;
	align-items: center;
	/* background-color: #2E2E2E; */
	margin: 5px;
	border-radius: 6px;
	/* border: 1px solid #444; */
	height: 66px;
}

.line-item.mini {
	height: 30px;
}

.line-item-element {
	margin: 0 8px;
}

.scroll-list-item-main-text {
	font-weight: bold;
}
/* .scroll-list-item-secondary-text { */
	/* font-size: 0.9em; */
	/* color: #888; */
/* } */
</style>
