import { defineStore } from 'pinia';
import log from 'electron-log/renderer';

interface FileDataInfo extends FileData {
	lastPacketTimestamp?: number
	shouldDownload?: boolean;
	downloadReason?: string;
	percentDownloaded?: number;
	isFullyDownloaded?: boolean;
}


function isFilesSame(file1: FileData, file2: FileData): boolean {
	return file1.fileName === file2.fileName &&
		file1.displayName === file2.displayName &&
		file1.hash === file2.hash &&
		file1.timestamp === file2.timestamp &&
		file1.relativePath === file2.relativePath;
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
	return isWithin10Seconds(file.lastPacketTimestamp) && file.percentDownloaded === 100 && !file.isFullyDownloaded
}

function wasRecentlyDownloaded(file: FileDataInfo): boolean {
	return isWithin10Seconds(file.lastPacketTimestamp) && file.percentDownloaded !== undefined;
}


export const useUploadedFilesStore = defineStore('UploadedFiles', {
	state: () => ({
		files: [] as FileDataInfo[]
	}),

	getters: {
		getFiles: (state) => state.files,
		getLastPacketTimestamp: (state) => (file: FileData) => {
			const fileData = state.files.find(f => isFilesSame(f, file));
			return fileData ? fileData.lastPacketTimestamp : undefined;
		},
		getShouldDownload: (state) => (file: FileData) => {
			const fileData = state.files.find(f => isFilesSame(f, file));
			return fileData ?
				(
					isUnzipping(fileData) ? false : wasRecentlyDownloaded(fileData) ? false : fileData.shouldDownload || false
				) :	false;
		},
		getDownloadStatusText: (state) => (file: FileDataInfo) => {
			return isUnzipping(file) ? 'Unzipping...' : isDownloading(file) ? `Downloading... ${file.percentDownloaded}%` : file.downloadReason || "Checking...";
		}
	},

	actions: {
		setFiles: async function (files: FileData[]) {
			this.files = files;
			for (const file of this.files) {
				await this.checkDownloadStatus(file).catch(err => {
					console.error("Error checking download status for file:", file, err);
				});
			}
		},
		addFile: function (file: FileData) {
			this.files.push(file);
			this.checkDownloadStatus(file).catch(err => {
				console.error("Error checking download status for file:", file, err);
			});
		},
		deleteFile: function (file: FileData) {
			this.files = this.files.filter(f => !isFilesSame(f, file));
		},
		updateLastPacketInfo: function (file: FileData, percent: number, timestamp: number) {
			const fileIndex = this.files.findIndex(f => isFilesSame(f, file));
			if (fileIndex !== -1) {
				this.files[fileIndex].lastPacketTimestamp = timestamp;
				this.files[fileIndex].percentDownloaded = percent;
			}
		},
		checkDownloadStatus: async function (file: FileData) {
			log.info("Checking download status for file:", file.displayName);
			const fileIndex = this.files.findIndex(f => isFilesSame(f, file));
			if (fileIndex === -1) return;
			this.files[fileIndex].shouldDownload = false
			this.files[fileIndex].downloadReason = "Checking...";

			const unreactiveFile = {...file}
			const shouldDownload = await api.shouldDownloadFile(unreactiveFile);
			this.files[fileIndex].shouldDownload = shouldDownload[0];
			this.files[fileIndex].downloadReason = shouldDownload[1];
		},
		checkDownLoadStatusForAll: async function () {
			log.info("Checking download status for all files...");
			for (const file of this.files) {
				await this.checkDownloadStatus(file).catch(err => {
					log.error("Error checking download status for file:", file, err);
				});
			}
			log.info("Download status check completed.");
		},
		setIsFullyDownloaded: function (file: FileData, isFullyDownloaded: boolean) {
			const fileIndex = this.files.findIndex(f => isFilesSame(f, file));
			if (fileIndex !== -1) {
				this.files[fileIndex].isFullyDownloaded = isFullyDownloaded;
			} else {
				log.warn("File not found in store:", file);
			}
		}
	},
});
