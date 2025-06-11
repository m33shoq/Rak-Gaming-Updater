<script setup lang="ts">
import log from 'electron-log/renderer'
import { ref, computed, watchEffect } from 'vue';

import icon from '@/assets/icon.png';

import UIButton from "@/components/Button.vue";
import TabLogin from '@/components/TabLogin.vue';
import TabUpdater from '@/components/TabUpdater.vue';
import TabPusher from '@/components/TabPusher.vue';
import TabSettings from '@/components/TabSettings.vue';
import TabStatus from '@/components/StatusTab.vue';
import TabBackups from '@/components/TabBackups.vue';
import WinButtons from '@/components/WinButtons.vue';

import { useLoginStore } from '@/store/LoginStore';

const selectedTab = ref('login');
const tabs = [
	{ name: 'main', label: 'Updater' },
	{ name: 'pusher', label: 'Pusher' },
	{ name: 'settings', label: 'Settings' },
	{ name: 'status', label: 'Status' },
	{ name: 'backups', label: 'Backups' }
];


function selectTab(tabName: string) {
	selectedTab.value = tabName;
	log.debug(`Selected tab: ${tabName}`);
}


const loginStore = useLoginStore();

watchEffect(() => {
	if (selectedTab.value === 'login' && loginStore.isConnected) {
		selectedTab.value = 'main'
	} else if (!loginStore.isConnected) {
		selectedTab.value = 'login';
		log.debug('User is not connected, switching to login tab');
	}
});

</script>
<template>
	<div id="title-container">
		<div class="header-container">
			<img :src="icon" alt="Tray Icon" id="headericon" />
			<h1>RG Updater</h1>
		</div>
		<div id="tab-buttons-container" v-show="loginStore.isConnected">
			<UIButton v-for="tab in tabs" :key="tab.name" :label="tab.label" @click="selectTab(tab.name)" :class="{
				'tab': true,
				selected: selectedTab === tab.name,
				disabled: selectedTab === tab.name
			}"></UIButton>
		</div>
		<WinButtons />
	</div>
	<TabLogin v-show="selectedTab === 'login'" />
	<TabUpdater v-show="selectedTab === 'main'" />
	<TabPusher v-show="selectedTab === 'pusher'" />
	<TabSettings v-show="selectedTab === 'settings'" />
	<TabStatus v-show="selectedTab === 'status'" />
	<TabBackups v-show="selectedTab === 'backups'" />
</template>

<style>
* {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
	cursor: default;
}

body {
	font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
	font-weight: 400;
	background-color: #181818;
	color: #E0E0E0;
	padding: 0;
	margin: 0;
	overflow: hidden;
	user-select: none;
}

#title-container {
	margin: 0;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	width: 100%;
	padding: 0;
	-webkit-app-region: drag;
	user-select: none;
}

#title-container img {
	height: 3em;
	vertical-align: middle;
	margin-right: 5px;
	margin-left: 5px;
}

.header-container {
	display: flex;
	align-items: center;
	gap: 5px;
}

#headericon {
	vertical-align: middle;
}

.tab-button {
	background-color: #f0f0f0;
	border: 1px solid #ccc;
	border-radius: 3px;
	padding: 5px 15px;
	margin: 2px;
	cursor: pointer;
	-webkit-app-region: no-drag;
	transition: background-color 0.3s, border-color 0.3s, transform 0.3s;
}

.tab-button.selected {
	background-color: #007bff;
	color: white;
	border-color: #0056b3;
}

#tab-buttons-container {
	margin-top: 6px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.tab-content {
	background-color: #242424;
	padding: 30px;
	padding-top: 10px;
	width: 100vw;
	height: 100vh;
	margin: 0;
	box-sizing: border-box;
}

.tab-title-label {
	user-select: none;
}
</style>
