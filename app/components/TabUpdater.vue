<script setup lang="ts">
import { ref, computed, watchEffect, watch } from 'vue';
import log from 'electron-log/renderer';
import { useUploadedFilesStore } from '@/store/UploadedFilesStore';
import { useLoginStore } from '@/store/LoginStore';
import { storeToRefs } from 'pinia';

import UIButton from '@/components/Button.vue';
import Checkbox from '@/components/Checkbox.vue';
import ScrollFrame from '@/components/ScrollFrame.vue';

const loginStore = useLoginStore();
const { isSocketConnected } = storeToRefs(loginStore);
const uploadedFilesStore = useUploadedFilesStore();

const selectedPath = ref('None');
api.IR_GetWoWPath().then((path) => {
	log.info('Initial WoW path:', path);
	selectedPath.value = path || 'None';
});


const autoUpdate = ref(false);
api.store.get('autoUpdate').then((value) => {
	autoUpdate.value = value || false;
	watchEffect(() => {
		log.info('Auto update state changed:', autoUpdate.value);
		api.store.set('autoUpdate', autoUpdate.value);
	});
});

watch(isSocketConnected, (newVal, oldVal) => {
  log.info('isSocketConnected changed from', oldVal, 'to', newVal);
  RefreshFiles()
});

api.IR_onFileChunkReceived((event, fileData: FileData, percent: number) => {
	log.info('File chunk received:', 'Progress:', percent);
	uploadedFilesStore.updateLastPacketInfo(fileData, percent, Date.now());

	// vue is slow on redrawing, so we update the button text directly
	const btn = document.querySelector('#button' + fileData.displayName + fileData.hash);
	// if (btn) {
	// 	log.info('Updating button text for file:', fileData.displayName);
	// 	btn.textContent = `Downloading... ${percent}%`;
	// 	btn.classList.add('disabled');
	// }
})

api.IR_onFileDownloaded((event, fileData: FileData) => {
	log.info('File downloaded:', fileData.displayName);
	uploadedFilesStore.checkDownloadStatus(fileData)
	uploadedFilesStore.setIsFullyDownloaded(fileData, true);
});

api.socket_on_file_not_found((event, fileData: FileData) => {
	log.info('File not found:', fileData);
});

api.socket_on_new_file(async (event, fileData: FileData) => {
	log.info('New file received:', fileData);
	uploadedFilesStore.addFile(fileData);
});

api.socket_on_file_deleted((event, fileData: FileData) => {
	log.info('File deleted:', fileData);
	uploadedFilesStore.deleteFile(fileData);
});


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
	const filesData = await api.fetchFilesData();
	log.info('Files data received:', filesData);
	if (filesData.files) {
		uploadedFilesStore.setFiles(filesData.files);
	}
}

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

async function downloadFile(fileData: FileData) {
	log.info('Downloading file:', fileData);
	api.requestFile({...fileData})
}

</script>

<template>
	<div class="tab-content">
			<div id="select-path-container">
				<UIButton label="Select wow path" @click="selectUpdatePath" style="margin: 5px; margin-left: 0px;"></UIButton>
				<p id="selected-path" v-text="'WoW Path: ' + selectedPath"></p>
			</div>
			<div id="upater-frame-header">
				<Checkbox label="Update Automatically" v-model="autoUpdate"/>
				<UIButton
					label="Refresh"
					@click="RefreshFiles"
					:class="{
						normal: true,
						disabled: fileRequestCooldown,
					}"
				/>
			</div>
			<ScrollFrame height="350">
				<div>
					<div v-for="fileData in uploadedFilesStore.getFiles"
						:key="fileData.displayName+fileData.hash+fileData.relativePath+fileData.timestamp"
						:fileData
						class="line-item"
					>
						<span class="line-item-element" style="display: flex; flex-direction: column; align-items: flex-start;">
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
						<UIButton class="line-item-element scroll-child" .id="'button'+fileData.displayName+fileData.hash"
							:label="uploadedFilesStore.getDownloadStatusText(fileData)"
							@click="downloadFile(fileData)"
							:class="{
								normal: true,
								disabled: uploadedFilesStore.getShouldDownload(fileData) == false,
							}"
						/>
					</div>
				</div>
			</ScrollFrame>
		</div>
</template>

<style scoped>
#upater-frame-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

#select-path-container {
	display: flex;
	flex-direction: row;
	align-items: center;
	margin-bottom: 10px;
	margin-top: 10px;
}

.line-item {
	display: grid;
	grid-template-columns: 1fr auto auto;
	align-items: center;
	background-color: #2E2E2E;
	margin: 4px;
	border-radius: 6px; /* Rounded corners for the line item */
	border: 1px solid #444; /* Optional: adds border to line items */
}
.line-item-element {
	margin: 8px;
	align-items: center;
	display: flex;
}
.scroll-child {
  height: 1fr;
}
</style>
