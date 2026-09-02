import { defineStore } from 'pinia';
import log from 'electron-log/renderer';
import { ref, computed } from 'vue';
import { IPC_EVENTS } from '@/events';
import type { FileUploadState } from '@/events';

import {
	DOWNLOAD_REASON_DOWNLOADING,
	DOWNLOAD_REASON_UNZIPPING,
	DOWNLOAD_REASON_CHECKING,
	DOWNLOAD_REASON_ERROR,
} from '@/constants';

interface FileDataInfo extends FileData {
	lastPacketTimestamp?: number
	shouldDownload?: boolean;
	downloadReason?: string;
	percentDownloaded?: number;
	isFullyDownloaded?: boolean;
	downloadError?: string;
}

// const dummyFileData = {
// 	fileName: 'xxxxxxxxxxxx',
// 	displayName: 'xxxxxxxxxxxx',
// 	hash: 'xxxxxxxxxxxx',
// 	relativePath: 'xxxxxxxxxxxx',
// 	timestamp: 1346789,
// 	lastPacketTimestamp: 0,
// 	shouldDownload: false,
// 	downloadReason: 'Checking...',
// 	percentDownloaded: 0,
// 	isFullyDownloaded: false,
// } as FileDataInfo;

// const dummyFileDataArray = [dummyFileData, dummyFileData, dummyFileData, dummyFileData, dummyFileData, dummyFileData, dummyFileData, dummyFileData]

function isFilesSame(file1: FileData, file2: FileData): boolean {
	return file1.fileName === file2.fileName && file1.displayName === file2.displayName && file1.hash === file2.hash && file1.timestamp === file2.timestamp && file1.relativePath === file2.relativePath;
}

function isWithin10Seconds(timestamp?: number): boolean {
	if (!timestamp) return false; // If timestamp is undefined or null, return false
	const now = Date.now();
	return now - timestamp < 10000;
}

function isDownloading(file: FileDataInfo): boolean {
	return isWithin10Seconds(file.lastPacketTimestamp) && file.percentDownloaded !== undefined && file.percentDownloaded < 100;
}

function isUnzipping(file: FileDataInfo): boolean {
	return isWithin10Seconds(file.lastPacketTimestamp) && file.percentDownloaded === 100 && !file.isFullyDownloaded;
}

function wasRecentlyDownloaded(file: FileDataInfo): boolean {
	return isWithin10Seconds(file.lastPacketTimestamp) && file.percentDownloaded !== undefined;
}

export const useUploadedFilesStore = defineStore('UploadedFiles', () => {
	const files = ref<FileDataInfo[]>([]);
	const uploads = ref<FileUploadState[]>([]);
	const completedUploadTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const mergedUploadIds = new Set<string>();

	const getFiles = computed(() => files.value);
	const getUploads = computed(() => uploads.value);
	const getLastPacketTimestamp = computed(() => (file: FileData) => {
		const fileData = files.value.find((f) => isFilesSame(f, file));
		return fileData ? fileData.lastPacketTimestamp : undefined;
	});
	const getShouldDownload = computed(() => (file: FileData) => {
		const fileData = files.value.find((f) => isFilesSame(f, file));
		if (!fileData) return false;
		if (isUnzipping(fileData)) return false;
		if (wasRecentlyDownloaded(fileData)) return false;
		return fileData.shouldDownload || false;
	});
	const getDownloadStatusText = computed(() => (file: FileDataInfo) => {
		if (file.downloadError) return DOWNLOAD_REASON_ERROR;
		if (isUnzipping(file)) return DOWNLOAD_REASON_UNZIPPING;
		if (isDownloading(file)) return DOWNLOAD_REASON_DOWNLOADING;
		return file.downloadReason || DOWNLOAD_REASON_CHECKING;
	});


	const setFiles = async (newFiles: FileData[]) => {
		const uniqueFiles = newFiles.filter((file, index) => (
			newFiles.findIndex(candidate => isFilesSame(candidate, file)) === index
		));
		files.value = uniqueFiles.map(file => ({
			...file,
			lastPacketTimestamp: 0,
			shouldDownload: false,
			downloadReason: DOWNLOAD_REASON_CHECKING,
			percentDownloaded: 0,
			isFullyDownloaded: false
		}));
		for (const file of files.value) {
			await checkDownloadStatus(file).catch((err) => {
				log.error('Error checking download status for file:', file, err);
			});
		}
	};
	const addFile = (file: FileData) => {
		if (files.value.some(existingFile => isFilesSame(existingFile, file))) {
			log.info('Ignoring duplicate uploaded file:', file.displayName);
			return;
		}
		const fileData: FileDataInfo = {
			...file,
			lastPacketTimestamp: 0,
			shouldDownload: false,
			downloadReason: DOWNLOAD_REASON_CHECKING,
			percentDownloaded: 0,
			isFullyDownloaded: false
		};
		files.value.push(fileData);
		checkDownloadStatus(fileData).catch((err) => {
			log.error('Error checking download status for file:', fileData, err);
		});
	};
	const deleteFile = (file: FileData) => {
		files.value = files.value.filter((f) => !isFilesSame(f, file));
	};
	const updateLastPacketInfo = (file: FileData, percent: number, timestamp: number) => {
		const foundFile = files.value.find(f => isFilesSame(f, file));
		if (foundFile) {
			foundFile.lastPacketTimestamp = timestamp;
			foundFile.percentDownloaded = percent;
		}
	};
	const checkDownloadStatus = async (file: FileData) => {
		log.info('Checking download status for file:', file.displayName);
		const foundFile = files.value.find(f => isFilesSame(f, file));
		if (!foundFile) return;

		foundFile.shouldDownload = false;
		foundFile.downloadReason = DOWNLOAD_REASON_CHECKING;

		const unreactiveFile = { ...file };
		const [shouldDownload, downloadReason] = await ipc.invoke(IPC_EVENTS.UPDATER_SHOULD_DOWNLOAD_FILE, unreactiveFile);

		foundFile.shouldDownload = shouldDownload;
		foundFile.downloadReason = downloadReason;

		if (shouldDownload && (await store.get('autoUpdate'))) {
			downloadFile(file).catch((err) => {
				log.error('Error downloading file:', file.displayName, err);
			});
		}
	};
	const checkDownLoadStatusForAll = async () => {
		log.info('Checking download status for all files...');
		for (const file of files.value) {
			await checkDownloadStatus(file).catch((err) => {
				log.error('Error checking download status for file:', file, err);
			});
		}
		log.info('Download status check completed.');
	};
	const setIsFullyDownloaded = (file: FileData, isFullyDownloaded: boolean) => {
		const foundFile = files.value.find(f => isFilesSame(f, file));
		if (foundFile) {
			foundFile.isFullyDownloaded = isFullyDownloaded;
			if (isFullyDownloaded) {
				foundFile.percentDownloaded = 100;
			}
		} else {
			log.warn('File not found in store:', file);
		}
	};
	const fetchFiles = async () => {
		log.info('Fetching files data from API...');
		const filesData = await ipc.invoke(IPC_EVENTS.UPDATER_FETCH_FILES_LIST);
		log.info('Files data fetched:', filesData);
		if (filesData && filesData.files) {
			await setFiles(filesData.files);
		} else {
			await setFiles([]);
		}
	};
	const downloadFile = async (file: FileData) => {
		log.info('Downloading file:', file);
		const unreactiveFile = { ...file };
		ipc.send(IPC_EVENTS.UPDATER_DOWNLOAD_FILE, unreactiveFile);
	};
	const updateUploadState = (upload: FileUploadState) => {
		if (mergedUploadIds.has(upload.id)) return;
		if (upload.fileData && files.value.some(file => isFilesSame(file, upload.fileData as FileData))) {
			mergedUploadIds.add(upload.id);
			setTimeout(() => mergedUploadIds.delete(upload.id), 30_000);
			dismissUpload(upload.id);
			return;
		}
		const existingIndex = uploads.value.findIndex(item => item.id === upload.id);
		if (existingIndex === -1) {
			uploads.value.push(upload);
		} else {
			uploads.value[existingIndex] = upload;
		}

		const existingTimer = completedUploadTimers.get(upload.id);
		if (existingTimer) {
			clearTimeout(existingTimer);
			completedUploadTimers.delete(upload.id);
		}
		if (upload.status === 'completed') {
			completedUploadTimers.set(upload.id, setTimeout(() => {
				dismissUpload(upload.id);
			}, 5000));
		}
	};
	const mergePublishedFile = (file: FileData) => {
		const matchingUpload = uploads.value.find(upload => upload.fileData && isFilesSame(upload.fileData, file));
		if (matchingUpload) {
			mergedUploadIds.add(matchingUpload.id);
			setTimeout(() => mergedUploadIds.delete(matchingUpload.id), 30_000);
			dismissUpload(matchingUpload.id);
		}
		addFile(file);
	};
	const dismissUpload = (uploadId: string) => {
		const timer = completedUploadTimers.get(uploadId);
		if (timer) clearTimeout(timer);
		completedUploadTimers.delete(uploadId);
		uploads.value = uploads.value.filter(upload => upload.id !== uploadId);
	};

	ipc.on(IPC_EVENTS.SOCKET_CONNECTED_CALLBACK, async () => {
		fetchFiles();
	});

	ipc.on(IPC_EVENTS.UPDATER_FILE_CHUNK_RECEIVED_CALLBACK, (event, fileData: FileData, percent: number) => {
		updateLastPacketInfo(fileData, percent, Date.now());
	});

	ipc.on(IPC_EVENTS.UPDATER_FILE_ERROR_CALLBACK, (event, fileData: FileData, errorCode: number) => {
		const foundFile = files.value.find(f => isFilesSame(f, fileData));
		if (foundFile) {
			foundFile.downloadError = `${errorCode}`;
			foundFile.shouldDownload = false;
			foundFile.downloadReason = DOWNLOAD_REASON_ERROR;
		}
	});

	ipc.on(IPC_EVENTS.UPDATER_FILE_DOWNLOADED_CALLBACK, (event, fileData: FileData) => {
		log.info('File downloaded:', fileData.displayName);
		checkDownloadStatus(fileData);
		setIsFullyDownloaded(fileData, true);
	});

	ipc.on(IPC_EVENTS.UPDATER_FILE_NOT_FOUND_CALLBACK, (event, fileData: FileData) => {
		log.info('File not found:', fileData);
	});

	ipc.on(IPC_EVENTS.UPDATER_NEW_FILE_CALLBACK, async (event, fileData: FileData) => {
		log.info('New file received:', fileData);
		mergePublishedFile(fileData);
	});

	ipc.on(IPC_EVENTS.UPDATER_FILE_DELETED_CALLBACK, (event, fileData: FileData) => {
		log.info('File deleted:', fileData);
		deleteFile(fileData);
	});

	ipc.on(IPC_EVENTS.PUSHER_UPLOAD_STATE_CALLBACK, (event, upload: FileUploadState) => {
		updateUploadState(upload);
	});
	void ipc.invoke(IPC_EVENTS.PUSHER_UPLOADS_STATE_GET).then((currentUploads: FileUploadState[]) => {
		for (const upload of currentUploads) {
			if (!uploads.value.some(currentUpload => currentUpload.id === upload.id)) {
				updateUploadState(upload);
			}
		}
	}).catch((error) => {
		log.warn('Failed to restore file upload progress', error);
	});

	return {
		files,

		getFiles,
		getUploads,
		getLastPacketTimestamp,
		getShouldDownload,
		getDownloadStatusText,

		setFiles,
		addFile,
		deleteFile,
		updateLastPacketInfo,
		checkDownloadStatus,
		checkDownLoadStatusForAll,
		setIsFullyDownloaded,
		fetchFiles,
		downloadFile,
		updateUploadState,
		dismissUpload,
	};
})
