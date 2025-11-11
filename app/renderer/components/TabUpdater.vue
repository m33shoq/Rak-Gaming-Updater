<script setup lang="ts">
import log from 'electron-log/renderer';

import { ref, watch } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useWoWPath } from '@/renderer/composables/useWoWPath';

const uploadedFilesStore = useUploadedFilesStore();

const { wowPath, selectPath } = useWoWPath();

watch(wowPath, (newPath) => {
	uploadedFilesStore.checkDownLoadStatusForAll();
});

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
					:click="selectPath"
					:label="wowPath"
				/>
			</div>
			<div class="flex justify-between items-center gap-2">
				<Checkbox :label="$t('updater.autoupdate')" v-model="autoUpdate"/>
				<UIButton :title="$t('updater.refresh')" @click="RefreshFiles" :disabled="fileRequestCooldown">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 inline-block">
						<path
							fill-rule="evenodd"
							d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z"
							clip-rule="evenodd"
							stroke="currentColor"
							stroke-width="1"
						/>
					</svg>
				</UIButton>
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
