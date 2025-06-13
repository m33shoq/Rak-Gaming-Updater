<script setup lang="ts">
import { ref, computed } from 'vue';
import log from 'electron-log/renderer';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { useLoginStore } from '@/renderer/store/LoginStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const loginStore = useLoginStore();
const uploadedFilesStore = useUploadedFilesStore();

const selectedPath = ref('');
api.IR_GetWoWPath().then((path) => {
	log.info('Initial WoW path:', path);
	selectedPath.value = path || '';
});
const selectedPathDisplay = computed(() => {
	return `${t('updater.wowpath')}: ${selectedPath.value || t('updater.wowpath.notset')}`;
});

async function selectUpdatePath() {
	const res = await api.IR_selectUpdatePath();
	if (res) {
		log.info('Selected WoW path:', res);
		await api.store.set('updatePath', res);
	} else {
		log.info('No WoW path selected, resetting to null');
		await api.store.set('updatePath', null);
	}
	selectedPath.value = await api.IR_GetWoWPath() || 'None';

	uploadedFilesStore.checkDownLoadStatusForAll();
}

const autoUpdate = getElectronStoreRef('autoUpdate', false)

const fileRequestCooldown = ref(false);

async function RefreshFiles() {
	if (!loginStore.isConnected) {
		log.warn('Not connected to server, cannot refresh files');
		return;
	}

	fileRequestCooldown.value = true;
	setTimeout(() => {
		fileRequestCooldown.value = false;
	}, 5000); // Cooldown for 5 second

	log.info('Refreshing files...');
	await uploadedFilesStore.fetchFiles()
}

</script>

<template>
	<TabContent>
		<div class="flex flex-row items-center my-2.5">
			<UIButton :label="$t('updater.setwowpath')" @click="selectUpdatePath" class="m-1 ml-0"/>
			<p v-text="selectedPathDisplay"></p>
		</div>
		<div class="flex justify-between items-center gap-2">
			<Checkbox :label="$t('updater.autoupdate')" v-model="autoUpdate"/>
			<UIButton :label="$t('updater.refresh')" @click="RefreshFiles" :disabled="fileRequestCooldown"/>
		</div>
		<ScrollFrame height="375">
			<template #default>
				<div v-for="fileData in uploadedFilesStore.getFiles"
					:key="fileData.displayName + fileData.hash + fileData.relativePath + fileData.timestamp" :fileData
					class="line-item">
					<span class="line-item-element flex flex-col items-start">
						<span class="scroll-list-item-main-text">
							{{ fileData.displayName }}

						</span>
						<span class="scroll-list-item-secondary-text">
							{{ fileData.relativePath }}
						</span>
					</span>
					<span class="line-item-element">
						{{ fileData.timestamp ? new Date(fileData.timestamp * 1000).toLocaleString() : 'Unknown' }}
					</span>
					<UIButton class="line-item-element w-54 justify-center-safe h-7/10"
						:label="$t(uploadedFilesStore.getDownloadStatusText(fileData), { percent: fileData.percentDownloaded || 0 })"
						@click="uploadedFilesStore.downloadFile(fileData)"
						:disabled="!uploadedFilesStore.getShouldDownload(fileData)"
					/>
				</div>
			</template>
		</ScrollFrame>
	</TabContent>
</template>

<style scoped>

</style>
