<script setup lang="ts">
defineProps<{
	height: string;
}>();


</script>

<template>
	<div class="scroll-frame" :style="{ height: `${height}px` }">

		<slot class="line-item" />
	</div>
</template>

<style>
.scroll-frame {
	background-color: #1E1E1E;
	color: #FFFFFF;
	/* padding: 0px; */
	margin-top: 15px;
	overflow-y: auto;
	border-radius: 6px;
	border: 1px solid #3a3a3a;
	display: grid;
	grid-template-rows: 2fr;
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
	grid-template-columns: 1fr;
	align-items: center;
	background-color: #2E2E2E;
	margin: 4px;
	border-radius: 6px; /* Rounded corners for the line item */
	border: 1px solid #444; /* Optional: adds border to line items */
}

.line-item-element {
	margin: 8px;
	height: 8cqb;
	align-items: center;
	display: flex;
}

.scroll-list-item-main-text {
	font-weight: bold;
}
.scroll-list-item-secondary-text {
	font-size: 0.9em;
	color: #888;
}

</style>
