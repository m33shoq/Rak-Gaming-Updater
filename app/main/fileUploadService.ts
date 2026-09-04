import { dialog, ipcMain, net, type BrowserWindow } from 'electron';
import log from 'electron-log/main';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { IPC_EVENTS, type FileUploadState } from '@/events';
import { isSameFile } from '@/fileDataIdentity';
import { GetFileData } from '@/main/fileDataUtility';
import { SERVER_EXISTING_FILES_ENDPOINT, SERVER_UPLOADS_ENDPOINT } from '@/main/serverEndpoints';
import { zipFile } from '@/main/zipHandler';

const FILE_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const FILE_UPLOAD_CONFIRMATION_TIMEOUT_MS = 2 * 60_000;
const FILE_UPLOAD_CONFIRMATION_INTERVAL_MS = 2_000;
const FILE_UPLOAD_PROGRESS_INTERVAL_MS = 150;
const AMBIGUOUS_UPLOAD_RESPONSE_STATUS_CODES = new Set([502, 503, 504]);
const UPLOAD_PUBLICATION_FAILED_CODE = 'UPLOAD_PUBLICATION_FAILED';
const FILE_UPLOAD_METADATA_HEADER_NAME = 'x-rg-file-upload-metadata';

type FileUploadServiceOptions = {
	getAuthToken: () => unknown;
	getMainWindow: () => BrowserWindow | null;
	getRelativePath: () => string | null | undefined;
	tempDirectory: string;
};

type UploadStateUpdate = Partial<Omit<FileUploadState, 'id' | 'displayName' | 'relativePath'>>;

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getUploadResponseErrorCode(responseBody: string): string | null {
	try {
		const data = JSON.parse(responseBody) as { code?: unknown };
		return typeof data.code === 'string' ? data.code : null;
	} catch {
		return null;
	}
}

function deduplicateFileData(files: FileData[]): FileData[] {
	return files.filter((file, index) => files.findIndex(candidate => isSameFile(candidate, file)) === index);
}

/** Owns file selection, preparation, compression, upload, and progress publication. */
export default class FileUploadService {
	private readonly fileUploadStates = new Map<string, FileUploadState>();
	private readonly activeFileUploads = new Map<string, FileData>();
	private knownUploadedFiles: FileData[] = [];
	private readonly tempDirectory: string;
	private readonly uploadTempRoot: string;
	private readonly fileDataTempRoot: string;

	constructor(private readonly options: FileUploadServiceOptions) {
		this.tempDirectory = path.resolve(options.tempDirectory);
		this.uploadTempRoot = path.resolve(this.tempDirectory, 'uploads');
		this.fileDataTempRoot = path.resolve(this.tempDirectory, 'file-data');

		ipcMain.handle(IPC_EVENTS.PUSHER_UPLOADS_STATE_GET, () => Array.from(this.fileUploadStates.values()));
		ipcMain.handle(IPC_EVENTS.UPDATER_FETCH_FILES_LIST, async () => {
			try {
				return await this.fetchUploadedFilesData();
			} catch (error) {
				log.error('Error fetching files data:', error);
				return undefined;
			}
		});
		ipcMain.on(IPC_EVENTS.PUSHER_OPEN_FOLDER_DIALOG, () => void this.selectAndUploadPath('openDirectory'));
		ipcMain.on(IPC_EVENTS.PUSHER_OPEN_FILE_DIALOG, () => void this.selectAndUploadPath('openFile'));
	}

	async cleanupAbandonedWorkspaces(): Promise<void> {
		for (const tempRoot of [this.uploadTempRoot, this.fileDataTempRoot]) {
			if (path.dirname(tempRoot) !== this.tempDirectory) {
				log.error('Refusing to clean unsafe upload temporary path:', tempRoot);
				continue;
			}
			try {
				await fsp.rm(tempRoot, { recursive: true, force: true });
			} catch (error) {
				log.warn('Could not clean abandoned upload temporary files:', tempRoot, error);
			}
		}
	}

	handlePublishedFile(fileData: FileData): void {
		this.publishUploadedFile(fileData);
	}

	handleDeletedFile(fileData: FileData): void {
		this.knownUploadedFiles = this.knownUploadedFiles.filter(file => !isSameFile(file, fileData));
	}

	private async selectAndUploadPath(property: 'openDirectory' | 'openFile'): Promise<void> {
		log.info('Opening file dialog:', property);
		const { canceled, filePaths } = await dialog.showOpenDialog({ properties: [property] });
		if (!canceled && filePaths.length > 0) {
			await this.uploadPath(filePaths[0]);
		}
	}

	private async uploadPath(sourcePath: string): Promise<void> {
		const relativePath = this.options.getRelativePath();
		log.info('Selected path:', sourcePath, 'relative path:', relativePath);
		if (!relativePath) {
			log.info('Relative path not set, skipping');
			return;
		}

		if (!sourcePath) {
			log.info('No path selected');
			return;
		}

		const uploadId = randomUUID();
		this.publishFileUploadState({
			id: uploadId,
			displayName: path.basename(sourcePath),
			relativePath,
			status: 'preparing',
			percent: null,
			transferred: 0,
			total: 0,
		});

		try {
			const { fileData, totalBytes: sourceSize } = await GetFileData(sourcePath, relativePath);
			await this.fetchUploadedFilesData();
			const duplicateIsUploaded = this.knownUploadedFiles.some(file => isSameFile(file, fileData));
			const duplicateIsUploading = Array.from(this.activeFileUploads.values()).some(file => isSameFile(file, fileData));
			if (duplicateIsUploaded || duplicateIsUploading) {
				throw new Error('This exact file and relative-path configuration is already uploaded or uploading.');
			}

			this.activeFileUploads.set(uploadId, fileData);
			this.updateFileUploadState(uploadId, { fileData });
			const stats = await fsp.stat(sourcePath);

			if (stats.isDirectory()) {
				await this.compressAndSend(sourcePath, fileData, uploadId, sourceSize);
			} else if (stats.isFile()) {
				const fileExtension = path.extname(sourcePath);
				log.info('File extension:', fileExtension);

				if (fileExtension.toLowerCase() === '.zip') {
					await this.sendFile(sourcePath, fileData, uploadId);
				} else {
					await this.compressAndSend(sourcePath, fileData, uploadId, sourceSize);
				}
			}

			this.updateFileUploadState(uploadId, {
				status: 'completed',
				percent: 100,
				transferred: this.fileUploadStates.get(uploadId)?.total ?? 0,
			});
			setTimeout(() => this.fileUploadStates.delete(uploadId), 30_000);
		} catch (error) {
			log.error('Could not prepare or upload file:', sourcePath, error);
			this.updateFileUploadState(uploadId, {
				status: 'error',
				percent: this.fileUploadStates.get(uploadId)?.percent ?? 0,
				error: getErrorMessage(error),
			});
			setTimeout(() => this.fileUploadStates.delete(uploadId), 5 * 60_000);
		} finally {
			this.activeFileUploads.delete(uploadId);
		}
	}

	private publishFileUploadState(state: FileUploadState): void {
		this.fileUploadStates.set(state.id, state);
		const window = this.options.getMainWindow();
		if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
		try {
			window.webContents.send(IPC_EVENTS.PUSHER_UPLOAD_STATE_CALLBACK, state);
		} catch (error) {
			log.warn('Could not publish file upload progress to the renderer:', error);
		}
	}

	private updateFileUploadState(id: string, update: UploadStateUpdate): void {
		const currentState = this.fileUploadStates.get(id);
		if (!currentState) return;
		this.publishFileUploadState({ ...currentState, ...update });
	}

	private rememberUploadedFile(fileData: FileData): void {
		if (!this.knownUploadedFiles.some(file => isSameFile(file, fileData))) {
			this.knownUploadedFiles.push(fileData);
		}
	}

	private publishUploadedFile(fileData: FileData): void {
		this.rememberUploadedFile(fileData);
		const window = this.options.getMainWindow();
		if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
		try {
			window.webContents.send(IPC_EVENTS.UPDATER_NEW_FILE_CALLBACK, fileData);
		} catch (error) {
			log.warn('Could not publish a newly uploaded file to the renderer:', error);
		}
	}

	private async fetchUploadedFilesData(): Promise<{ files: FileData[] }> {
		const response = await net.fetch(SERVER_EXISTING_FILES_ENDPOINT, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${this.options.getAuthToken()}`,
			},
		});
		if (!response.ok) {
			throw new Error(`Could not check uploaded files: HTTP ${response.status}`);
		}
		const data = await response.json() as { files?: FileData[] };
		this.knownUploadedFiles = deduplicateFileData(Array.isArray(data.files) ? data.files : []);
		return { files: this.knownUploadedFiles };
	}

	private async waitForUploadedFileConfirmation(fileData: FileData): Promise<FileData | null> {
		const deadline = Date.now() + FILE_UPLOAD_CONFIRMATION_TIMEOUT_MS;
		let lastFetchError: unknown;

		do {
			const knownFile = this.knownUploadedFiles.find(file => isSameFile(file, fileData));
			if (knownFile) return knownFile;

			try {
				await this.fetchUploadedFilesData();
				const fetchedFile = this.knownUploadedFiles.find(file => isSameFile(file, fileData));
				if (fetchedFile) return fetchedFile;
			} catch (error) {
				lastFetchError = error;
			}

			const remainingTime = deadline - Date.now();
			if (remainingTime <= 0) break;
			await new Promise(resolve => setTimeout(resolve, Math.min(FILE_UPLOAD_CONFIRMATION_INTERVAL_MS, remainingTime)));
		} while (Date.now() < deadline);

		if (lastFetchError) {
			log.warn('Could not query the server while confirming an upload after its connection closed:', lastFetchError);
		}
		return null;
	}

	private async compressAndSend(sourcePath: string, fileData: FileData, uploadId: string, sourceSize: number): Promise<void> {
		log.info('Compressing and sending file:', sourcePath, 'with data:', fileData);
		const baseName = path.basename(sourcePath);
		const uploadTempDirectory = path.resolve(this.uploadTempRoot, uploadId);
		if (path.dirname(uploadTempDirectory) !== this.uploadTempRoot) {
			throw new Error('Could not create a safe temporary directory for the upload.');
		}
		const outputPath = path.join(uploadTempDirectory, baseName + '.zip');

		log.info('Creating output directory if it does not exist:', uploadTempDirectory);
		await fsp.mkdir(uploadTempDirectory, { recursive: true });

		try {
			log.info('Compressing:', sourcePath, 'to:', outputPath);
			this.updateFileUploadState(uploadId, {
				status: 'compressing',
				percent: null,
				transferred: 0,
				total: 0,
			});
			let lastProgressNotificationAt = 0;
			await zipFile(sourcePath, outputPath, ({ processedBytes }) => {
				const now = Date.now();
				const transferred = Math.min(processedBytes, sourceSize);
				const percent = sourceSize > 0 ? Math.min(100, transferred / sourceSize * 100) : null;
				if (percent !== 100 && now - lastProgressNotificationAt < FILE_UPLOAD_PROGRESS_INTERVAL_MS) return;
				lastProgressNotificationAt = now;
				this.updateFileUploadState(uploadId, {
					status: 'compressing',
					percent,
					transferred,
					total: sourceSize,
				});
			});
			log.info('File compressed and saved:', outputPath);
			await this.sendFile(outputPath, fileData, uploadId);
		} catch (error: unknown) {
			log.error('Error compressing and sending file:', error);
			throw error;
		} finally {
			await fsp.rm(uploadTempDirectory, { recursive: true, force: true });
		}
	}

	private async sendFile(filePath: string, fileData: FileData, uploadId: string): Promise<void> {
		log.info('Sending file:', filePath, fileData);
		const payload = await fsp.readFile(filePath);
		const totalBytes = payload.byteLength;
		this.updateFileUploadState(uploadId, {
			status: 'uploading',
			percent: null,
			transferred: 0,
			total: totalBytes,
			error: undefined,
		});

		log.info('SERVER_UPLOADS_ENDPOINT:', SERVER_UPLOADS_ENDPOINT);

		const request = net.request({
			url: SERVER_UPLOADS_ENDPOINT,
			method: 'POST',
			headers: {
				'content-type': 'application/octet-stream',
				[FILE_UPLOAD_METADATA_HEADER_NAME]: encodeURIComponent(JSON.stringify(fileData)),
				'authorization': `Bearer ${this.options.getAuthToken()}`,
			},
		});

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let confirmationStarted = false;
			let requestBodySubmitted = false;
			let lastTransferred = -1;
			let progressTimer: ReturnType<typeof setInterval> | null = null;
			let uploadTimeout: ReturnType<typeof setTimeout> | null = null;
			const stopProgressTimer = () => {
				if (!progressTimer) return;
				clearInterval(progressTimer);
				progressTimer = null;
			};
			const stopTimers = () => {
				stopProgressTimer();
				if (uploadTimeout) clearTimeout(uploadTimeout);
				uploadTimeout = null;
			};
			const getCurrentTransferred = () => {
				let transferred = lastTransferred;
				try {
					const progress = request.getUploadProgress();
					if (progress.started) transferred = Math.max(transferred, progress.current);
				} catch {
					// The request can close before its final progress can be sampled.
				}
				return Math.max(0, Math.min(totalBytes, transferred));
			};
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				stopTimers();
				if (error) reject(error);
				else resolve();
			};
			const finishAfterServerConfirmation = (connectionError: Error) => {
				if (settled || confirmationStarted) return;
				confirmationStarted = true;
				stopProgressTimer();
				const transferred = getCurrentTransferred();
				const requestBodyWasSent = transferred >= totalBytes;
				this.updateFileUploadState(uploadId, {
					status: requestBodyWasSent ? 'processing' : 'uploading',
					percent: totalBytes > 0 ? transferred / totalBytes * 100 : null,
					transferred,
					total: totalBytes,
				});

				void this.waitForUploadedFileConfirmation(fileData)
					.then((confirmedFile) => {
						if (settled) return;
						if (!confirmedFile) {
							finish(connectionError);
							return;
						}
						log.info('Upload confirmed by the server after its HTTP connection closed:', filePath);
						this.publishUploadedFile(confirmedFile);
						finish();
					})
					.catch(() => finish(connectionError));
			};
			progressTimer = setInterval(() => {
				try {
					const progress = request.getUploadProgress();
					if (!progress.started || progress.current === lastTransferred) return;
					lastTransferred = progress.current;
					const transferred = Math.min(totalBytes, progress.current);
					this.updateFileUploadState(uploadId, {
						status: transferred >= totalBytes ? 'processing' : 'uploading',
						percent: totalBytes > 0 ? transferred / totalBytes * 100 : null,
						transferred,
						total: totalBytes,
					});
				} catch {
					// The request can close between interval ticks.
				}
			}, FILE_UPLOAD_PROGRESS_INTERVAL_MS);
			uploadTimeout = setTimeout(() => {
				finish(new Error('Upload timed out after 10 minutes.'));
				request.abort();
			}, FILE_UPLOAD_TIMEOUT_MS);

			request.once('error', (error) => {
				if (requestBodySubmitted) {
					finishAfterServerConfirmation(error);
					return;
				}
				finish(error);
			});
			request.once('abort', () => finish(new Error('Upload was aborted.')));
			// Electron can emit request `close` while Chromium is still uploading and before a delayed response arrives.
			// Explicit request/response errors and the timeout determine failure instead.
			request.once('response', (response) => {
				stopProgressTimer();
				this.updateFileUploadState(uploadId, {
					status: 'processing',
					percent: 100,
					transferred: totalBytes,
					total: totalBytes,
				});

				const responseChunks: Buffer[] = [];
				response.on('data', (data: Buffer) => responseChunks.push(data));
				response.once('error', finishAfterServerConfirmation);
				response.once('aborted', () => finishAfterServerConfirmation(new Error('Upload response was aborted.')));
				response.once('end', () => {
					if (settled) return;
					const responseBody = Buffer.concat(responseChunks).toString();
					log.info('Upload response status:', response.statusCode);
					log.info('Upload response data:', responseBody);
					if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
						const responseError = new Error(responseBody || `Upload failed with HTTP ${response.statusCode || 'unknown status'}`);
						const isDefinitivePublicationFailure = getUploadResponseErrorCode(responseBody) === UPLOAD_PUBLICATION_FAILED_CODE;
						if (!isDefinitivePublicationFailure && response.statusCode && AMBIGUOUS_UPLOAD_RESPONSE_STATUS_CODES.has(response.statusCode)) {
							finishAfterServerConfirmation(responseError);
							return;
						}
						finish(responseError);
						return;
					}
					this.publishUploadedFile(fileData);
					finish();
				});
			});

			try {
				request.end(payload);
				requestBodySubmitted = true;
			} catch (error) {
				const requestError = error instanceof Error ? error : new Error(String(error));
				if (requestBodySubmitted) {
					finishAfterServerConfirmation(requestError);
				} else {
					finish(requestError);
				}
			}
		});
		log.info('File sent successfully:', filePath);
	}
}
