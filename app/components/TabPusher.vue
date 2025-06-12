<script setup lang="ts">
import UIButton from '@/components/Button.vue';
import ScrollFrame from './ScrollFrame.vue';
import { useUploadedFilesStore } from '@/store/UploadedFilesStore';
import { computed, ref } from 'vue';
import log from 'electron-log/renderer';
import { getElectronStoreRef } from '@/store/ElectronRefStore';

const uploadedFilesStore = useUploadedFilesStore();

const relativePath = getElectronStoreRef('relativePath', '');
const relativePathDisplay = computed(() => {
	return relativePath.value ? `Relative Path: ${relativePath.value}` : 'Relative Path: Not Set';
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
	<div class="tab-content">
		<div id="relative-path-container">
			<UIButton label="Select relative path" @click="selectRelativePath" style="margin: 5px; margin-left: 0px;">
			</UIButton>
			<p v-text="relativePathDisplay"></p>
		</div>
		<div id="files-header-buttons">
			<UIButton label="Add Folder" class="normal small" @click="onAddFolder" />
			<UIButton label="Add File" class="normal small" @click="onAddFile" />
		</div>
		<!-- </div> -->
		<ScrollFrame height='375' id="files-frame">
			<template #default>
				<div v-for="fileData in uploadedFilesStore.getFiles"
					:key="fileData.displayName + fileData.hash + fileData.relativePath + fileData.timestamp" :fileData
					class="line-item">
					<span class="line-item-element"
						style="display: flex; flex-direction: column; align-items: flex-start;"
					>
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
					<UIButton class="line-item-element"
						:label="'Delete'"
						@click="deleteFile(fileData)"
						:class="{
							normal: true,
						}"
					/>
				</div>
			</template>
		</ScrollFrame>
	</div>
</template>

<style scoped>
#relative-path-container {
	display: flex;
	flex-direction: row;
	align-items: center;
	margin-bottom: 10px;
	margin-top: 10px;
}

#files-header-buttons {
	margin: 10px;
	display: flex;
	flex-direction: row-reverse
}
</style>
