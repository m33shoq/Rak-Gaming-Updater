<script setup lang="ts">
import log from 'electron-log/renderer'
import { ref, watchEffect, onMounted } from 'vue';

import icon from '@/assets/icon.png';

import UIButton from "@/renderer/components/Button.vue";
import TabLogin from '@/renderer/components/TabLogin.vue';
import TabUpdater from '@/renderer/components/TabUpdater.vue';
import TabPusher from '@/renderer/components/TabPusher.vue';
import TabSettings from '@/renderer/components/TabSettings.vue';
import TabStatus from '@/renderer/components/StatusTab.vue';
import TabBackups from '@/renderer/components/TabBackups.vue';
import WinButtons from '@/renderer/components/WinButtons.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';
import { useBackupStatusStore } from '@/renderer/store/BackupStatusStore';

// initialize all stores
const loginStore = useLoginStore();
const uploadedFilesStore = useUploadedFilesStore();
const connectedClientsStore = useConnectedClientsStore();
const backupStatusStore = useBackupStatusStore();

const appVersion = ref('x.x.x');
const appReleseType = ref('unknown');
api.IR_GetAppVersion().then((versionInfo) => {
	log.info('App version:', versionInfo);
	appVersion.value = versionInfo.version;
	appReleseType.value = versionInfo.releaseType;
});

const selectedTab = ref('login');
const tabs = [
	{ name: 'main', label: 'tabname.updater' },
	{ name: 'pusher', label: 'tabname.pusher', adminOnly: true },
	{ name: 'settings', label: 'tabname.settings' },
	{ name: 'status', label: 'tabname.status', adminOnly: true },
	{ name: 'backups', label: 'tabname.backups' }
];

function selectTab(tabName: string) {
	selectedTab.value = tabName;
	log.debug(`Selected tab: ${tabName}`);
}

watchEffect(() => {
	if (selectedTab.value === 'login' && loginStore.isConnected) {
		selectedTab.value = 'main'
	} else if (!loginStore.isConnected) {
		selectedTab.value = 'login';
		log.debug('User is not connected, switching to login tab');
	}
});



onMounted(async () => {
	const authInfo = await api.check_for_login();
	if (authInfo) {
		api.socket_connect();
	}
})


</script>
<template>
	<div id="title-container">
		<div class="header-container">
			<img :src="icon" alt="Tray Icon" id="headericon" />
			<h1>RG Updater</h1>
		</div>
		<div id="tab-buttons-container" v-show="loginStore.isConnected">
			<UIButton v-for="tab in tabs" :key="tab.name" :label="$t(tab.label)" @click="selectTab(tab.name)"
				v-show="!tab.adminOnly || loginStore.isAdmin" :class="{
					'tab': true,
					selected: selectedTab === tab.name,
					disabled: selectedTab === tab.name
				}"></UIButton>
		</div>
		<WinButtons />
	</div>
	<TabLogin v-if="selectedTab === 'login'" />
	<TabUpdater v-else-if="selectedTab === 'main'" />
	<TabPusher v-else-if="selectedTab === 'pusher' && loginStore.isAdmin" />
	<TabSettings v-else-if="selectedTab === 'settings'" />
	<TabStatus v-else-if="selectedTab === 'status' && loginStore.isAdmin" />
	<TabBackups v-else-if="selectedTab === 'backups'" />
	<footer>
		<p class="tab-title-label">{{ loginStore.isConnected ? `Logged as: ${loginStore.getUsername} ${loginStore.getRole}` : '' }}</p>
		<p class="tab-title-label">Rak Gaming Updater {{ appVersion }}-{{ appReleseType }} by m33shoq</p>
	</footer>
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
footer {
	background-color: #181818;
	color: #E0E0E0;
	text-align: center;
	padding: 4px;
	position: absolute;
	bottom: 0;
	width: 100%;
	display: flex;
	justify-content: space-between;
}

.tab-title-label {
	font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
	font-size: 0.9em;
	color: #888;
}
</style>
