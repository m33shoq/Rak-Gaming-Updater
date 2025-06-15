<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

const uploadedFilesStore = useUploadedFilesStore();

const selectedPath = ref('');
api.IR_GetWoWPath().then((path) => {
	log.info('Initial WoW path:', path);
	selectedPath.value = path || '';
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
	selectedPath.value = await api.IR_GetWoWPath();

	uploadedFilesStore.checkDownLoadStatusForAll();
}

const autoUpdate = getElectronStoreRef('autoUpdate', false)

const fileRequestCooldown = ref(false);

async function RefreshFiles() {
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
		<div class="max-h-26">
			<div class="flex flex-row items-center my-2.5">
				<PathSelector
					:title="$t('updater.wowpath')"
					:placeholder="$t('updater.wowpath.notset')"
					:click="selectUpdatePath"
					:label="selectedPath"
				/>
			</div>
			<div class="flex justify-between items-center gap-2">
				<Checkbox :label="$t('updater.autoupdate')" v-model="autoUpdate"/>
				<UIButton :label="$t('updater.refresh')" @click="RefreshFiles" :disabled="fileRequestCooldown"/>
			</div>
		</div>
		<template v-if="!uploadedFilesStore.getFiles.length">
			<div class="flex items-center justify-center h-50 dark:text-gray-300 text-gray-500">
				<span class="text-5xl font-bold text-center">
					{{ $t('updater.nouploadedfiles') }}
				</span>
			</div>
		</template>
		<template v-else>
			<ScrollFrame height="375">
				<template #default>
					<div v-for="fileData in uploadedFilesStore.getFiles"
					:key="fileData.displayName + fileData.hash + fileData.relativePath + fileData.timestamp" :fileData
					class="line-item dark:bg-dark4 bg-light4">
					<div class="line-item-element flex flex-col items-start">
						<span class="scroll-list-item-main-text">
							{{ fileData.displayName }}
						</span>
						<span class="scroll-list-item-secondary-text text-sm dark:text-zinc-400 text-zinc-300 font-normal">
							{{ fileData.relativePath }}
						</span>
					</div>
					<span class="line-item-element">
						{{ fileData.timestamp ? new Date(fileData.timestamp * 1000).toLocaleString() : 'Unknown' }}
					</span>
					<UIButton class="line-item-element w-54 justify-center-safe h-7/10"
						:label="$t(uploadedFilesStore.getDownloadStatusText(fileData),
							{
								percent: fileData.percentDownloaded || 0,
								error: fileData.downloadError
							})"
						@click="uploadedFilesStore.downloadFile(fileData)"
						:disabled="!uploadedFilesStore.getShouldDownload(fileData)"
						/>
					</div>
				</template>
			</ScrollFrame>
		</template>
	</TabContent>
</template>

<style scoped>

</style>
