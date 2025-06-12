<script setup lang="ts">
import { ref, computed } from 'vue';
import log from 'electron-log/renderer';
import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { useLoginStore } from '@/renderer/store/LoginStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import UIButton from '@/renderer/components/Button.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';

const loginStore = useLoginStore();
const uploadedFilesStore = useUploadedFilesStore();

const selectedPath = ref('');
api.IR_GetWoWPath().then((path) => {
	log.info('Initial WoW path:', path);
	selectedPath.value = path || '';
});
const selectedPathDisplay = computed(() => {
	return selectedPath.value ? `WoW Path: ${selectedPath.value}` : 'WoW Path: Not Set';
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
	<div class="tab-content">
		<div id="select-path-container">
			<UIButton label="Select wow path" @click="selectUpdatePath" style="margin: 5px; margin-left: 0px;">
			</UIButton>
			<p id="selected-path" v-text="selectedPathDisplay"></p>
		</div>
		<div id="upater-frame-header">
			<Checkbox label="Update Automatically" v-model="autoUpdate" />
			<UIButton label="Refresh" @click="RefreshFiles" :class="{
				normal: true,
				disabled: fileRequestCooldown,
}" />
		</div>
		<ScrollFrame height="375">
			<template #default>
				<div v-for="fileData in uploadedFilesStore.getFiles"
					:key="fileData.displayName + fileData.hash + fileData.relativePath + fileData.timestamp" :fileData
					class="line-item">
					<span class="line-item-element"
						style="display: flex; flex-direction: column; align-items: flex-start;">
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
						:label="uploadedFilesStore.getDownloadStatusText(fileData)"
						@click="uploadedFilesStore.downloadFile(fileData)"
						:class="{
							normal: true,
							disabled: uploadedFilesStore.getShouldDownload(fileData) == false,
						}"
					/>
				</div>
			</template>
		</ScrollFrame>
	</div>
</template>

<style scoped>
#select-path-container {
	display: flex;
	flex-direction: row;
	align-items: center;
	margin-bottom: 10px;
	margin-top: 10px;
}

#upater-frame-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

</style>
