<script setup lang="ts">
import log from 'electron-log/renderer'
import { ref, watchEffect, onMounted } from 'vue';

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
import { useUploadedFilesStore } from '@/store/UploadedFilesStore';
import { useConnectedClientsStore } from '@/store/ConnectedClientsStore';

const loginStore = useLoginStore();
const uploadedFilesStore = useUploadedFilesStore();
const connectedClientsStore = useConnectedClientsStore();

const appVersion = ref('x.x.x');
api.IR_GetAppVersion().then((version) => {
	log.info('App version:', version);
	appVersion.value = version;
});

const selectedTab = ref('login');
const tabs = [
	{ name: 'main', label: 'Updater' },
	{ name: 'pusher', label: 'Pusher', adminOnly: true },
	{ name: 'settings', label: 'Settings' },
	{ name: 'status', label: 'Status', adminOnly: true },
	{ name: 'backups', label: 'Backups' }
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

// connection logic
api.socket_on_connect(async () => {
	log.info('Connected to server');
	loginStore.setConnected(true);
	const authInfo = await api.check_for_login();
	loginStore.setAuthInfo(authInfo);

	loginStore.setConnectionError('');
	loginStore.setDisconnectReason('');
});

api.socket_on_disconnect((event, reason) => {
	log.error('Disconnected from server:', reason);
	loginStore.setConnected(false);
	loginStore.setDisconnectReason(reason.description);
});

api.socket_on_connect_error((event, description) => {
	log.error('Connect failed:', description);
	loginStore.setConnectionError(description);
});


// uploaded files logic
api.socket_on_connect(async () => {
	uploadedFilesStore.fetchFiles();
});

api.IR_onFileChunkReceived((event, fileData: FileData, percent: number) => {
	log.info('File chunk received:', 'Progress:', percent);
	uploadedFilesStore.updateLastPacketInfo(fileData, percent, Date.now());
});

api.IR_onFileDownloaded((event, fileData: FileData) => {
	log.info('File downloaded:', fileData.displayName);
	uploadedFilesStore.checkDownloadStatus(fileData);
	uploadedFilesStore.setIsFullyDownloaded(fileData, true);
});

api.socket_on_file_not_found((event, fileData: FileData) => {
	log.info('File not found:', fileData);
});

api.socket_on_new_file(async (event, fileData: FileData) => {
	log.info('New file received:', fileData);
	uploadedFilesStore.addFile(fileData);
});

api.socket_on_file_deleted((event, fileData: FileData) => {
	log.info('File deleted:', fileData);
	uploadedFilesStore.deleteFile(fileData);
});

// connected clients for status tab
api.IR_onConnectedClients((event, clients) => {
	connectedClientsStore.setClients(clients);
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
			<UIButton v-for="tab in tabs" :key="tab.name" :label="tab.label" @click="selectTab(tab.name)"
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
		<p class="tab-title-label" v-text="loginStore.isConnected ? `Logged as: ${loginStore.getUsername} ${loginStore.getRole}` : ''"></p>
		<p class="tab-title-label">Rak Gaming Updater {{ appVersion }} by m33shoq</p>
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
