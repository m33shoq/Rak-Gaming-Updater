<script setup lang="ts">
import log from 'electron-log/renderer'
import { ref, watchEffect, onMounted } from 'vue';

import icon from '@/assets/icon.png';

import ButtonTab from "@/renderer/components/ButtonTab.vue";
import TabLogin from '@/renderer/components/TabLogin.vue';
import TabUpdater from '@/renderer/components/TabUpdater.vue';
import TabPusher from '@/renderer/components/TabPusher.vue';
import TabSettings from '@/renderer/components/TabSettings.vue';
import TabStatus from '@/renderer/components/TabStatus.vue';
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
	<div id="title-container" class="m-0 flex items-center justify-between w-full p-0 drag">
		<div class="flex items-center gap-2">
			<img :src="icon" alt="icon" class="h-[3em] mx-1 vertical-align align-middle" />
			<h1 class="font-bold text-3xl bg-gradient-to-r from-sky-600 via-blue-500 to-blue-600 text-transparent bg-clip-text animate-gradient">RG Updater</h1>
		</div>
		<div id="tab-buttons-container" v-show="loginStore.isConnected">
			<ButtonTab v-for="tab in tabs"
				:key="tab.name"
				:label="$t(tab.label)"
				@click="selectTab(tab.name)"
				v-show="!tab.adminOnly || loginStore.isAdmin"
				:disabled="selectedTab === tab.name"
			/>
		</div>
		<WinButtons />
	</div>
	<TabLogin v-if="selectedTab === 'login'" />
	<TabUpdater v-else-if="selectedTab === 'main'"/>
	<TabPusher v-else-if="selectedTab === 'pusher' && loginStore.isAdmin" />
	<TabSettings v-else-if="selectedTab === 'settings'" />
	<TabStatus v-else-if="selectedTab === 'status' && loginStore.isAdmin" />
	<TabBackups v-else-if="selectedTab === 'backups'" />
	<footer class="bg-dark1 text-neutral-500 text-center p-1 absolute bottom-0 flex justify-between w-full text-sm">
		<p>{{ loginStore.isConnected ? `Logged as: ${loginStore.getUsername} ${loginStore.getRole}` : '' }}</p>
		<p>Rak Gaming Updater {{ appVersion }}-{{ appReleseType }} by m33shoq</p>
	</footer>
</template>

<style>

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

</style>
