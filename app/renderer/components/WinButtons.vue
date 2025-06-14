<script setup lang="ts">

function onCloseClick() {
	api.IR_closeApp();
}

function onMinimizeClick() {
	api.IR_minimizeApp();
}

</script>

<template>
	<div id="button-container" class="flex items-start p-0 h-11">
		<button id="minimize-btn" @click="onMinimizeClick">―</button>
		<button id="close-btn" @click="onCloseClick">✖</button>
	</div>
</template>

<style scoped>

#button-container button {
	color: #FFFFFF;
	border: none;
	-webkit-app-region: no-drag;
	background-color: transparent;
	width: 30px;
	height: 30px;
	display: flex;
	justify-content: center;
	align-items: center;
	font-size: 12px;
	border-radius: 0;
	padding: 0;
}

#button-container button:hover {
	background-color: #333333;
}

#close-btn:hover {
	background-color: red !important;
}


</style>
