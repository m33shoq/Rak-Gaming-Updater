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
import TabReviews from '@/renderer/components/TabReviews.vue';
import WinButtons from '@/renderer/components/WinButtons.vue';
import ErrorNotification from '@/renderer/components/ErrorNotification.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';
import { useBackupStatusStore } from '@/renderer/store/BackupStatusStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

// initialize all stores
const loginStore = useLoginStore();
const uploadedFilesStore = useUploadedFilesStore();
const connectedClientsStore = useConnectedClientsStore();
const backupStatusStore = useBackupStatusStore();
const darkMode = getElectronStoreRef('darkMode', true);

const appVersion = ref('x.x.x');
const appReleseType = ref('unknown');
api.IR_GetAppVersion().then((versionInfo) => {
	log.info('App version:', versionInfo);
	appVersion.value = versionInfo.version;
	appReleseType.value = versionInfo.releaseType;
});

const selectedTab = ref('main');

const tabs = [
	{ name: 'main', svg: 'home', component: TabUpdater },
	{ name: 'pusher', svg: 'pusher', adminOnly: true, component: TabPusher },
	{ name: 'settings', svg: 'settings', component: TabSettings },
	{ name: 'status', svg: 'status', adminOnly: true, component: TabStatus },
	{ name: 'backups', label: 'tabname.backups', svg: 'backups', component: TabBackups },
	{ name: 'reviews', label: 'tabname.reviews', svg: 'reviews', component: TabReviews }
];

function selectTab(tabName: string) {
	selectedTab.value = tabName;
	log.debug(`Selected tab: ${tabName}`);
}

const errorMessage = ref<string | null>(null);

let errorResetTimer: NodeJS.Timeout | null = null;
function showError(msg: string) {
	if (errorResetTimer) {
		clearTimeout(errorResetTimer);
	}
	errorMessage.value = msg;
	errorResetTimer = setTimeout(() => {
		errorMessage.value = null;
	}, 3000); // Show for 3 seconds
}

api.IPC_onUncaughtException((event, error) => {
	showError(`Uncaught Exception: ${error.message}`);
});

api.IPC_onUnhandledRejection((event, error) => {
	showError(`Unhandled Rejection: ${error.message}`);
});


onMounted(async () => {
	const authInfo = await api.check_for_login();
	if (authInfo) {
		api.socket_connect();
	}
})

</script>

<template>
	<div class="m-0 p-0 text-base font-main flex flex-col h-screen
	dark:bg-dark1 dark:text-gray-50
	bg-light1 text-black" :class="{'dark': darkMode}">
		<div class="m-0 flex items-center justify-between w-full p-0 drag">
			<div class="flex items-center gap-2">
				<img :src="icon" alt="icon" class="h-10 mx-1 vertical-align align-middle" />
				<h1 class="font-bold text-3xl bg-gradient-to-r from-sky-600 via-blue-500 to-blue-600 text-transparent bg-clip-text animate-gradient">RG Updater</h1>
			</div>
			<div v-show="loginStore.isConnected">
				<ButtonTab v-for="tab in tabs"
					:key="tab.name"
					:label="tab.label && $t(tab.label)"
					@click="selectTab(tab.name)"
					v-show="!tab.adminOnly || loginStore.isAdmin"
					:disabled="selectedTab === tab.name"
					:svg="tab.svg"
				/>
			</div>
			<WinButtons class="w-22" />
		</div>
		<div class="flex-grow overflow-hidden">
			<transition name="fade">
				<ErrorNotification v-if="errorMessage" :label="errorMessage" />
			</transition>
			<TabLogin v-if="!loginStore.isConnected" />
			<component v-else :is="tabs.find(tab => tab.name === selectedTab)?.component" />
		</div>
		<footer class="text-center p-1 bottom-0 flex justify-between w-full text-sm text-neutral-500 font-medium
		dark:bg-dark1
		bg-light1">
			<p>{{ loginStore.isConnected ? `Logged as: ${loginStore.getUsername} ${loginStore.getRole || ''}` : '' }}</p>
			<p>Rak Gaming Updater {{ appVersion }}-{{ appReleseType }} by m33shoq</p>
		</footer>
	</div>
</template>

<style>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.8s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.fade-enter-to, .fade-leave-from {
  opacity: 1;
}
</style>
