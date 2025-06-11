<script setup lang="ts">
import { ref } from 'vue';


function onCloseClick() {
	api.IR_closeApp();
}

function onMinimizeClick() {
	api.IR_minimizeApp();
}

</script>

<template>
	<div id="button-container">
		<button id="minimize-btn" @click="onMinimizeClick">―</button>
		<button id="close-btn" @click="onCloseClick">✖</button>
	</div>
</template>

<style scoped>
#button-container {
	display: flex;
	align-items: flex-start; /* Align buttons to the top */
	padding: 0; /* Remove padding to ensure buttons are at the very top */
	height: auto; /* Adjust height to fit the buttons */
}

#button-container button {
	color: #FFFFFF;
	border: none;
	-webkit-app-region: no-drag;
	background-color: transparent;
	width: 30px;
	height: 30px;
	display: flex; /* Use flexbox */
	justify-content: center; /* Center horizontally */
	align-items: center; /* Center vertically */
	font-size: 12px;
	border-radius: 0;
	padding: 0; /* Adjust padding as needed */
}

#button-container button:hover {
	background-color: #333333;
}

#close-btn:hover {
	background-color: red !important;
}


</style>
