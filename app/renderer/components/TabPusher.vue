<script setup lang="ts">
import log from 'electron-log/renderer';
import { IPC_EVENTS } from '@/events';

import TabContent from '@/renderer/components/TabContent.vue';
import ScrollFrame from '@/renderer/components/ScrollFrame.vue';
import UIButton from '@/renderer/components/Button.vue';
import PathSelector from '@/renderer/components/PathSelector.vue';

import { useUploadedFilesStore } from '@/renderer/store/UploadedFilesStore';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import type { FileUploadState } from '@/events';

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

function formatBytes(bytes: number) {
	const safeBytes = Math.max(0, bytes || 0);
	if (safeBytes >= 1024 ** 3) return `${(safeBytes / 1024 ** 3).toFixed(2)} GB`;
	if (safeBytes >= 1024 ** 2) return `${(safeBytes / 1024 ** 2).toFixed(1)} MB`;
	if (safeBytes >= 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
	return `${safeBytes} B`;
}

function isIndeterminate(upload: FileUploadState) {
	return upload.percent === null;
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
		<template v-if="!uploadedFilesStore.getUploads.length && !uploadedFilesStore.getFiles.length">
			<div class="flex items-center justify-center h-50 dark:text-gray-300 text-gray-500">
				<span class="text-5xl font-bold text-center">
					{{ $t('pusher.nouploadedfiles') }}
				</span>
			</div>
		</template>
		<template v-else>
			<ScrollFrame class="max-h-[375px]" aria-live="polite">
				<template #default>
					<div
						v-for="upload in uploadedFilesStore.getUploads"
						:key="upload.id"
						class="line-item dark:bg-dark4 bg-light4"
						role="status"
					>
						<div class="line-item-element flex min-w-0 flex-col items-start gap-1">
							<span class="scroll-list-item-main-text max-w-full truncate" :title="upload.displayName">
								{{ upload.displayName }}
							</span>
							<div
								class="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-700"
								role="progressbar"
								:aria-valuenow="upload.percent ?? undefined"
								aria-valuemin="0"
								aria-valuemax="100"
							>
								<div
									v-if="isIndeterminate(upload)"
									class="upload-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-sky-400"
								/>
								<div
									v-else
									class="h-full rounded-full transition-[width] duration-150"
									:class="{
										'bg-sky-500': upload.status !== 'completed' && upload.status !== 'error',
										'bg-emerald-500': upload.status === 'completed',
										'bg-red-500': upload.status === 'error',
									}"
									:style="{ width: `${upload.percent}%` }"
								/>
							</div>
							<span class="max-w-full truncate text-xs font-normal dark:text-zinc-400 text-zinc-300" :title="upload.relativePath">
								{{ upload.relativePath }}
							</span>
						</div>
						<div class="line-item-element flex w-52 flex-col items-end text-sm">
							<span :class="{
								'text-emerald-400': upload.status === 'completed',
								'text-red-400': upload.status === 'error',
								'text-sky-300': upload.status !== 'completed' && upload.status !== 'error',
							}">
								{{ $t(`pusher.upload.${upload.status}`) }}
								<template v-if="upload.percent !== null"> · {{ upload.percent.toFixed(1) }}%</template>
							</span>
							<span v-if="upload.error" class="max-w-full truncate text-xs font-normal text-red-400" :title="upload.error">
								{{ upload.error }}
							</span>
							<span v-else-if="upload.total > 0" class="font-mono text-xs font-normal text-zinc-400 tabular-nums">
								<template v-if="upload.percent === null">{{ formatBytes(upload.total) }}</template>
								<template v-else>{{ formatBytes(upload.transferred) }} / {{ formatBytes(upload.total) }}</template>
							</span>
						</div>
						<UIButton
							v-if="upload.status === 'completed' || upload.status === 'error'"
							class="line-item-element h-7/10 w-10"
							:aria-label="$t('pusher.upload.dismiss')"
							@click="uploadedFilesStore.dismissUpload(upload.id)"
						>
							×
						</UIButton>
						<span v-else class="line-item-element w-10" aria-hidden="true" />
					</div>
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
@keyframes upload-progress-slide {
	from { transform: translateX(-100%); }
	to { transform: translateX(400%); }
}

.upload-progress-indeterminate {
	animation: upload-progress-slide 1.1s ease-in-out infinite;
}
</style>
