<script setup lang="ts">
import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from '@/renderer/components/Button.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { computed, ref } from 'vue';
import log from 'electron-log/renderer';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const uploadedFilesStore = useUploadedFilesStore();

const relativePath = getElectronStoreRef('relativePath', '');
const relativePathDisplay = computed(() => {
	return `${t('pusher.relativepath')}: ${relativePath.value || t('pusher.relativepath.notset')}`;
});

async function selectRelativePath() {
	const path = await api.IR_selectRelativePath();
	if (path) {
		relativePath.value = path;
		api.store.set('relativePath', path);
	} else {
		relativePath.value = ``;
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
		<div id="relative-path-container" class="flex flex-row items-center my-2.5">
			<UIButton :label="$t('pusher.setrelativepath')" @click="selectRelativePath" class="m-1 ml-0"/>
			<p v-text="relativePathDisplay"></p>
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
		<ScrollFrame height='375'>
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
