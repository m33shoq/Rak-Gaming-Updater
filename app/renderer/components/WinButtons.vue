<script setup lang="ts">

import { ref } from 'vue';

const isMaximized = ref(false);

function onCloseClick() {
	api.IR_closeApp();
}

function onMinimizeClick() {
	api.IR_minimizeApp();
}

function onMaximizeClick() {
	api.IR_maximizeAppToggle();
}

api.IR_onMaximizeAppToggle((event, maximized: boolean) => {
	isMaximized.value = maximized;
});

</script>

<template>
	<div>
		<div id="button-container" class="absolute top-0 right-0 flex flex-row">
			<button id="minimize-btn" @click="onMinimizeClick">
				<img src="@/assets/chrome-minimize.svg" alt="-" class="w-4 h-4"/>
			</button>
			<button id="maximize-btn" @click="onMaximizeClick" v-show="!isMaximized">
				<img src="@/assets/chrome-maximize.svg" alt="[]" class="w-4 h-4"/>
			</button>
			<button id="minimize-btn" @click="onMaximizeClick" v-show="isMaximized">
				<img src="@/assets/chrome-restore.svg" alt="[]" class="w-4 h-4"/>
			</button>
			<button id="close-btn" @click="onCloseClick">
				<img src="@/assets/chrome-close.svg" alt="X" class="w-4 h-4"/>
			</button>
		</div>
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
