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

const selectedTab = ref('login');
const tabs = [
	{ name: 'main', label: 'tabname.updater' },
	{ name: 'pusher', label: 'tabname.pusher', adminOnly: true },
	{ name: 'settings', label: 'tabname.settings' },
	{ name: 'status', label: 'tabname.status', adminOnly: true },
	{ name: 'backups', label: 'tabname.backups' },
	{ name: 'reviews', label: 'tabname.reviews' }
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
	<div class="m-0 p-0 text-base  font-main h-full w-full
	dark:bg-dark1 dark:text-gray-50
	bg-light1 text-black" :class="{'dark': darkMode}">
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
		<transition name="fade">
			<ErrorNotification v-if="errorMessage" :label="errorMessage" />
		</transition>
		<TabLogin v-if="selectedTab === 'login'" />
		<TabUpdater v-else-if="selectedTab === 'main'"/>
		<TabPusher v-else-if="selectedTab === 'pusher' && loginStore.isAdmin" />
		<TabSettings v-else-if="selectedTab === 'settings'" />
		<TabStatus v-else-if="selectedTab === 'status' && loginStore.isAdmin" />
		<TabBackups v-else-if="selectedTab === 'backups'" />
		<TabReviews v-else-if="selectedTab === 'reviews'" />
		<footer class="text-center p-1 absolute bottom-0 flex justify-between w-full text-sm
		dark:bg-dark1 text-neutral-500 font-medium
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
