<script setup lang="ts">
defineProps<{

}>();


</script>

<template>
	<div class="scroll-frame dark:bg-dark2 bg-light2"
	>
		<slot/>
	</div>
</template>

<style>
.scroll-frame {
	color: rgb(15 23 42);
	margin-top: 15px;
	overflow-y: auto;
	border-radius: 6px;
}

.scroll-frame::-webkit-scrollbar {
	width: 10px;
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-track {
	background: rgb(226 232 240);
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-thumb {
	background: rgb(148 163 184);
	border-radius: 5px;
}

.scroll-frame::-webkit-scrollbar-thumb:hover {
	background: rgb(100 116 139);
}

.dark .scroll-frame {
	color: #fff;
}

.dark .scroll-frame::-webkit-scrollbar-track {
	background: #2e2e2e;
}

.dark .scroll-frame::-webkit-scrollbar-thumb {
	background: #555;
}

.dark .scroll-frame::-webkit-scrollbar-thumb:hover {
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
	border: 1px solid rgb(226 232 240);
	box-shadow: 0 1px 2px rgb(15 23 42 / 6%);
}

.dark .line-item {
	border-color: transparent;
	box-shadow: none;
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
