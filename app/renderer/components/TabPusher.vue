<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

import TabContent from '@/renderer/components/TabContent.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import UIButton from '@/renderer/components/Button.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

const uploadedFilesStore = useUploadedFilesStore();

const relativePath = getElectronStoreRef('relativePath', '');

async function selectRelativePath() {

	const path = await ipc.invoke(IPC_EVENTS.PUSHER_SELECT_RELATIVE_PATH);
	if (path) {
		store.set('relativePath', path);
	} else {
		store.set('relativePath', null);
	}
}

function onAddFile() {
	ipc.send(IPC_EVENTS.PUSHER_OPEN_FILE_DIALOG);
}

function onAddFolder() {
	ipc.send(IPC_EVENTS.PUSHER_OPEN_FOLDER_DIALOG);
}

function deleteFile(fileData: FileData) {
	log.info('Deleting file:', fileData);

	ipc.send(IPC_EVENTS.PUSHER_FILE_DELETE, { ...fileData });
}

</script>

<template>
	<TabContent>
		<div class="max-h-26">
			<div id="relative-path-container" class="flex flex-row items-center my-2.5">
				<PathSelector
					:title="$t('pusher.relativepath')"
					:placeholder="$t('pusher.relativepath.notset')"
					:click="selectRelativePath"
					:label="relativePath"
				/>
			</div>
			<div class="flex flex-row-reverse gap-2 h-11 items-center">
				<UIButton
				:label="$t('pusher.addfolder')"
				@click="onAddFolder"
				/>
				<UIButton
				:label="$t('pusher.addfile')"
				@click="onAddFile"
				/>
			</div>
		</div>
		<template v-if="!uploadedFilesStore.getFiles.length">
			<div class="flex items-center justify-center h-50 dark:text-gray-300 text-gray-500">
				<span class="text-5xl font-bold text-center">
					{{ $t('pusher.nouploadedfiles') }}
				</span>
			</div>
		</template>
		<template v-else>
			<ScrollFrame height='375'>
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
							:label="$t('pusher.deletefile')"
							@click="deleteFile(fileData)"
						/>
					</div>
				</template>
			</ScrollFrame>
		</template>
	</TabContent>
</template>

<style scoped>

</style>
