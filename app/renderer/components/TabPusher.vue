<script setup lang="ts">
import log from 'electron-log/renderer';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';


const uploadedFilesStore = useUploadedFilesStore();

const relativePath = getElectronStoreRef('relativePath', '');

async function selectRelativePath() {
	const path = await api.IR_selectRelativePath();
	if (path) {
		api.store.set('relativePath', path);
	} else {
		api.store.set('relativePath', null);
	}
}

function onAddFile() {
	api.IR_openFileDialogFile()
}

function onAddFolder() {
	api.IR_openFileDialogFolder()
}

function deleteFile(fileData: FileData) {
	log.info('Deleting file:', fileData);
	api.socket_emit_delete_file({ ...fileData });
}

</script>

<template>
	<TabContent>
		<div class="min-h-26">
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
		<ScrollFrame height='375'>
			<template #default>
				<div v-for="fileData in uploadedFilesStore.getFiles"
					:key="fileData.displayName + fileData.hash + fileData.relativePath + fileData.timestamp" :fileData
					class="line-item dark:bg-dark4 bg-light4">
					<span class="line-item-element flex flex-col items-start">
						<span class="scroll-list-item-main-text">
							{{ fileData.displayName }}

						</span>
						<span class="scroll-list-item-secondary-text text-sm dark:text-zinc-400 text-zinc-300 font-normal">
							{{ fileData.relativePath }}
						</span>
					</span>
					<span class="line-item-element">
						{{ fileData.timestamp ? new Date(fileData.timestamp * 1000).toLocaleString() : 'Unknown' }}
					</span>
					<UIButton class="line-item-element w-54 justify-center-safe h-7/10"
						:label="$t('pusher.deletefile')"
						@click="deleteFile(fileData)"
						:class="{
							normal: true,
						}"
					/>
				</div>
			</template>
		</ScrollFrame>
	</TabContent>
</template>

<style scoped>

</style>
