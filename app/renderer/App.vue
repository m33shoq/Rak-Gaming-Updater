<script setup lang="ts">
import log from 'electron-log/renderer'
import { IPC_EVENTS, type AppUpdateDownloadState } from '@/events';
import { ref, watch } from 'vue';

import icon from '@/assets/icon.png';

import ButtonTab from "@/renderer/components/ButtonTab.vue";
import TabLogin from '@/renderer/components/TabLogin.vue';
import TabUpdater from '@/renderer/components/TabUpdater.vue';
import TabPusher from '@/renderer/components/TabPusher.vue';
import TabSettings from '@/renderer/components/TabSettings.vue';
import TabStatus from '@/renderer/components/TabStatus.vue';
import TabBackups from '@/renderer/components/TabBackups.vue';
import TabReviews from '@/renderer/components/TabReviews.vue';
import TabObsIntegration from '@/renderer/components/TabObsIntegration.vue';
import WinButtons from '@/renderer/components/WinButtons.vue';
import ErrorNotification from '@/renderer/components/ErrorNotification.vue';
import AppUpdateProgress from '@/renderer/components/AppUpdateProgress.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';
import { useReviewsStore } from '@/renderer/store/ReviewsStore';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { useConnectedClientsStore } from '@/renderer/store/ConnectedClientsStore';
import { useBackupStatusStore } from '@/renderer/store/BackupStatusStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useIpcOn } from '@/renderer/composables/useIpcOn';
import { useAppVersion } from '@/renderer/composables/useAppVersion';

// initialize all stores
const loginStore = useLoginStore();
const reviewsStore = useReviewsStore();
const uploadedFilesStore = useUploadedFilesStore();
const connectedClientsStore = useConnectedClientsStore();
const backupStatusStore = useBackupStatusStore();
const darkMode = getElectronStoreRef('darkMode', true);

const { appVersionInfo } = useAppVersion();

const selectedTab = ref('main');
const appUpdateDownloadState = ref<AppUpdateDownloadState | null>(null);

let receivedAppUpdateStateCallback = false;
useIpcOn(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_CALLBACK, (event, state: AppUpdateDownloadState) => {
	receivedAppUpdateStateCallback = true;
	appUpdateDownloadState.value = state;
});

void ipc.invoke(IPC_EVENTS.APP_UPDATE_DOWNLOAD_STATE_GET)
	.then((state: AppUpdateDownloadState | null) => {
		if (!receivedAppUpdateStateCallback) {
			appUpdateDownloadState.value = state;
		}
	})
	.catch((error) => {
		log.warn('Failed to get app update download state', error);
	});

const tabs = [
	{ name: 'main', svg: 'home', component: TabUpdater },
	{ name: 'pusher', svg: 'pusher', adminOnly: true, component: TabPusher },
	{ name: 'settings', svg: 'settings', component: TabSettings },
	{ name: 'status', svg: 'status', adminOnly: true, component: TabStatus },
	{ name: 'backups', label: 'tabname.backups', svg: 'backups', component: TabBackups },
	{ name: 'reviews', label: 'tabname.reviews', svg: 'reviews', component: TabReviews },
	{ name: 'obs-integration', label: 'tabname.obs_integration', svg: 'obs', component: TabObsIntegration }
];

function selectTab(tabName: string) {
	selectedTab.value = tabName;
	log.debug(`Selected tab: ${tabName}`);
}

watch(
	[() => reviewsStore.hasPendingTimelineWindowActions, () => loginStore.isConnected],
	([hasPendingActions, isConnected]) => {
		if (hasPendingActions && isConnected && selectedTab.value !== 'reviews') selectTab('reviews');
	},
);

watch(() => reviewsStore.timelineWindowReturnToReviewsRevision, () => {
	if (loginStore.isConnected && selectedTab.value !== 'reviews') selectTab('reviews');
});

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

type AppDeepLinkPayload = {
	tab: 'reviews';
	action: 'open-video';
	videoId: string;
	timestampSeconds: number;
	rawUrl: string;
};

async function handleDeepLink(payload: AppDeepLinkPayload) {
	if (payload.tab !== 'reviews' || payload.action !== 'open-video') {
		showError('Unsupported deep link.');
		return;
	}

	let timeout = 15000; // 15 seconds
	while (!loginStore.isConnected && timeout > 0) {
		// Wait for login to complete, but timeout after 15 seconds to avoid infinite loop
		await new Promise(resolve => setTimeout(resolve, 500));
		timeout -= 500;
	}

	if (!loginStore.isConnected) {
		showError('Log in to open review links.');
		return;
	}

	selectTab('reviews');
	const result = await reviewsStore.openVideoFromDeepLink(payload.videoId, payload.timestampSeconds);
	if (!result.success) {
		log.info('Failed to open review link from deep link', { payload, error: result.error });
		showError(result.error || 'Failed to open review link.');
	}
	log.info('Handled deep link', payload);
}

useIpcOn(IPC_EVENTS.APP_UNCAUGHT_EXCEPTION_CALLBACK, (event, error) => {
	showError(`Uncaught Exception: ${error.message}`);
});

useIpcOn(IPC_EVENTS.APP_UNHANDLED_REJECTION_CALLBACK, (event, error) => {
	showError(`Unhandled Rejection: ${error.message}`);
});

useIpcOn(IPC_EVENTS.SOCKET_NOT_ENOUGH_PERMISSIONS_CALLBACK, (event, error) => {
	showError(`Error: Not enough permissions to perform this action.`);
});

useIpcOn(IPC_EVENTS.APP_DEEP_LINK_CALLBACK, (event, payload: AppDeepLinkPayload) => {
	void handleDeepLink(payload);
});

</script>

<template>
	<div class="m-0 p-0 text-base font-main flex flex-col h-screen
	dark:bg-dark1 dark:text-gray-50
	bg-light1 text-black" :class="{'dark': darkMode}">
		<div data-app-title-bar class="m-0 flex items-center justify-between w-full p-0 drag">
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
		<AppUpdateProgress v-if="appUpdateDownloadState" :state="appUpdateDownloadState" />
		<div class="flex-grow overflow-hidden">
			<transition name="fade">
				<ErrorNotification v-if="errorMessage" :label="errorMessage" />
			</transition>
			<TabLogin v-if="!loginStore.isConnected" />
			<template v-else v-for="tab in tabs">
				<component :is="tab.component" v-if="selectedTab === tab.name" />
			</template>
		</div>
		<footer class="text-center p-1 bottom-0 flex justify-between w-full text-sm text-neutral-500 font-medium
		dark:bg-dark1
		bg-light1">
			<p>{{ loginStore.isConnected ? `Logged as: ${loginStore.getUsername} ${loginStore.getRole || ''}` : '' }}</p>
			<p>Rak Gaming Updater {{ appVersionInfo.version }}-{{ appVersionInfo.releaseType }} by m33shoq</p>
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
