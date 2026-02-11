import { app, net } from 'electron';
import fs from 'fs';
import path from 'path';
import fsp from 'fs/promises';
import log from 'electron-log/main';
import store from './store';
import mainWindowWrapper from './MainWindowWrapper';
import { getWoWPath, validateWoWPath } from './wowPathUtility';
import { zipFile, unzipFile } from './zipHandler';
import { nanoid } from 'nanoid';
import { SOCKET_EVENTS, IPC_EVENTS } from '../events';

import {
	SERVER_URL,
	SERVER_LOGIN_ENDPOINT,
	SERVER_UPLOADS_ENDPOINT,
	SERVER_EXISTING_FILES_ENDPOINT,
	SERVER_DOWNLOAD_ENDPOINT
} from './serverEndpoints';
import type { Socket } from 'socket.io-client';

export async function InstallFile(fileData: FileData, zipPath: string) {
	const { fileName, relativePath } = fileData;
	const updatePath = await getWoWPath();
	if (!updatePath) {
		log.error('WoW path is not set or invalid. Cannot install file:', fileData);
		throw new Error('WoW path is not set or invalid.');
	}
	const expectedOutputFolder = path.join(updatePath, relativePath, fileName); // wow + relative + folder/file
	const targetPath = path.join(updatePath, relativePath); // wow + relative

	// Ensure the target path exists
	if (!fs.existsSync(targetPath)) {
		await fsp.mkdir(targetPath, { recursive: true });
	}

	// Remove the previous extracted folder if it exists
	if (fs.existsSync(expectedOutputFolder)) {
		await fsp.rm(expectedOutputFolder, { recursive: true });
	}

	log.info('Zip file saved for extraction:', zipPath);

	try {
		console.log('Extracting file:', zipPath, 'to', targetPath);
		await unzipFile(zipPath, targetPath);
		log.info('File extracted successfully:', targetPath);
		mainWindowWrapper.webContents?.send(IPC_EVENTS.UPDATER_FILE_DOWNLOADED_CALLBACK, fileData);
	} catch (error) {
		log.error('Error extracting file:', error);
	}
}

export class FileManagementService {
	constructor(private socket: Socket) {
		this.socket = socket;
	}

	// return file path for downloaded zip file
	private async downloadFile_HTTPS(fileData: FileData, specificUrl?: string) {
		const { fileName, relativePath, timestamp, hash, displayName } = fileData;
		const DOWNLOAD_URL = specificUrl ?? `${SERVER_DOWNLOAD_ENDPOINT}/${displayName}/${hash}`;

		const updatePath = await getWoWPath();
		if (!updatePath) {
			log.error('WoW path is not set or invalid. Cannot install file:', fileData);
			throw new Error('WoW path is not set or invalid.');
		}

		const outputPath = path.join(updatePath, fileData.relativePath, `RG-UPDATER-${nanoid()}-${displayName}-${hash}.zip`);
		// recursively create directories if they don't exist
		await fsp.mkdir(path.dirname(outputPath), { recursive: true });

		const writer = fs.createWriteStream(outputPath);

		try {
			await new Promise(async (resolve, reject) => {
				let size = 0;
				let percentMod = -1;

				const req = net.request({
					url: DOWNLOAD_URL,
					redirect: 'manual',
					method: 'GET',
					headers: {
						Authorization: `Bearer ${store.get('authToken')}`,
					},
				});

				req.on('redirect', (status, method, redirectUrl) => {
					log.info(`[download] caught redirect`, status, redirectUrl);
					req.followRedirect();
				});

				req.on('error', (err) => {
					log.error('Download request error:', err);
					return reject(err);
				});

				req.on('abort', () => {
					log.error('Download request aborted for:', updatePath);
					return reject(new Error('Download request aborted'));
				});

				req.on('close', () => {
					log.info('Download request closed for:', updatePath);
				});

				req.on('finish', () => {
					log.info('Download request finished for:', updatePath);
				});

				req.on('response', (response) => {
					const contentLength = response.headers['content-length'] as string | undefined;
					const fileLength = parseInt(contentLength ?? '0', 10);

					response.on('error', (err: Error) => {
						log.error('Error during response:', err);
						mainWindowWrapper.webContents?.send('file-download-error', fileData, err.message);
						return reject(err);
					});

					response.on('data', (data) => {
						writer.write(data)

						size += data.length;
						const percent = fileLength <= 0 ? 0 : Math.floor((size / fileLength) * 100);
						mainWindowWrapper.webContents?.send('file-chunk-received', fileData, percent);
						if (percent % 5 === 0 && percentMod !== percent) {
							percentMod = percent;
							log.info(`Write ${fileData.displayName}: [${percent}] ${size}`);
						}
					});

					response.on('end', async () => {
						log.info(`Download finished: ${fileData.displayName}`);

						writer.end();

						// Wait for writer to finish
						await new Promise((resolve, reject) => {
							if (writer.writableEnded) {
								log.info('Writer already ended.');
								return resolve(undefined);
							}
							const timeout = setTimeout(() => {
								log.error('Writer finish timeout reached.');
								reject(new Error('Writer finish timeout'));
							}, 10000); // Increase timeout to 10 seconds

							writer.once('finish', () => {
								log.info('Writer finished successfully.');
								clearTimeout(timeout);
								resolve(undefined);
							});

							writer.once('error', (err) => {
								log.error('Writer error:', err);
								clearTimeout(timeout);
								reject(err);
							});
						});

						if (response.statusCode < 200 || response.statusCode >= 300) {
							mainWindowWrapper.webContents?.send('file-download-error', fileData, response.statusCode);
							return reject(new Error(`Invalid response (${response.statusCode}): ${DOWNLOAD_URL}`));
						}

						if (fileLength && size !== fileLength) {
							log.info(`Content-length mismatch: expected ${fileLength}, got ${size}`);
							mainWindowWrapper.webContents?.send('file-download-error', fileData, 'content-length mismatch');
							return reject(new Error(`Invalid response (content-length mismatch): ${DOWNLOAD_URL}, expected ${fileLength}, got ${size}`));
						}

						return resolve(undefined);
					});
				});
				req.end();
			});
		} catch (error) {
			// if failed to download, delete the incomplete file
			writer.end();
			if (fs.existsSync(outputPath)) {
				await fsp.unlink(outputPath);
			}
			throw error;
		} finally {
			log.info('Closing writer stream.');
			writer.end();
		}

		return outputPath;
	}
	private async downloadFile_Socket(fileData: FileData) {
		const { hash, displayName } = fileData;
		const updatePath = await getWoWPath();
		if (!updatePath) {
			log.error('WoW path is not set or invalid. Cannot install file:', fileData);
			throw new Error('WoW path is not set or invalid.');
		}

		if (!this.socket.connected) {
			throw new Error('Socket is not connected.');
		}

		const outputPath = path.join(updatePath, fileData.relativePath, `RG-UPDATER-${nanoid()}-${displayName}-${hash}.zip`);
		await fsp.mkdir(path.dirname(outputPath), { recursive: true });

		const writer = fs.createWriteStream(outputPath);
		const requestId = nanoid();

		const waitForWriterFinish = async () => {
			await new Promise((resolve, reject) => {
				if (writer.writableEnded) {
					log.info('Writer already ended.');
					return resolve(undefined);
				}
				const timeout = setTimeout(() => {
					log.error('Writer finish timeout reached.');
					reject(new Error('Writer finish timeout'));
				}, 10000);

				writer.once('finish', () => {
					log.info('Writer finished successfully.');
					clearTimeout(timeout);
					resolve(undefined);
				});

				writer.once('error', (err) => {
					log.error('Writer error:', err);
					clearTimeout(timeout);
					reject(err);
				});
			});
		};

		try {
			await new Promise<void>((resolve, reject) => {
				let size = 0;
				let totalSize: number | null = null;
				let percentMod = -1;
				let completed = false;
				let inactivityTimer: NodeJS.Timeout | null = null;

				const resetInactivityTimer = () => {
					if (inactivityTimer) {
						clearTimeout(inactivityTimer);
					}
					inactivityTimer = setTimeout(() => {
						const error = new Error('Download socket timeout');
						log.error(error.message);
						onError({ requestId, error: error.message });
					}, 30000);
				};

				const cleanup = async (err?: Error) => {
					if (completed) return;
					completed = true;
					if (inactivityTimer) {
						clearTimeout(inactivityTimer);
					}
					this.socket.off(SOCKET_EVENTS.UPDATER_DOWNLOAD_CHUNK, onChunk);
					this.socket.off(SOCKET_EVENTS.UPDATER_DOWNLOAD_COMPLETE, onComplete);
					this.socket.off(SOCKET_EVENTS.UPDATER_DOWNLOAD_ERROR, onError);
					writer.end();
					if (err) {
						if (fs.existsSync(outputPath)) {
							await fsp.unlink(outputPath);
						}
						reject(err);
						return;
					}
					resolve();
				};

				const normalizeChunk = (chunk: unknown): Buffer | null => {
					if (!chunk) return null;
					if (Buffer.isBuffer(chunk)) return chunk;
					if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk));
					if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
					if (typeof chunk === 'string') return Buffer.from(chunk, 'base64');
					return null;
				};

				const onChunk = (payload: { requestId: string; chunk?: unknown; data?: unknown; totalSize?: number; done?: boolean; isLast?: boolean }) => {
					if (!payload || payload.requestId !== requestId || completed) return;
					resetInactivityTimer();
					log.info(`Received chunk for ${fileData.displayName}:`, {
						chunkSize: payload.chunk ? (Buffer.isBuffer(payload.chunk) ? payload.chunk.length : String(payload.chunk).length) : 0,
						dataSize: payload.data ? (Buffer.isBuffer(payload.data) ? payload.data.length : String(payload.data).length) : 0,
						totalSize: payload.totalSize,
						done: payload.done,
						isLast: payload.isLast,
					});

					if (typeof payload.totalSize === 'number' && payload.totalSize > 0) {
						totalSize = payload.totalSize;
					}

					const buffer = normalizeChunk(payload.chunk ?? payload.data);
					if (!buffer) {
						log.warn('Received empty chunk payload');
						return;
					}

					writer.write(buffer);
					size += buffer.length;
					const percent = totalSize && totalSize > 0 ? Math.floor((size / totalSize) * 100) : 0;
					mainWindowWrapper.webContents?.send('file-chunk-received', fileData, percent);
					if (percent % 5 === 0 && percentMod !== percent) {
						percentMod = percent;
						log.info(`Write ${fileData.displayName}: [${percent}] ${size}`);
					}

					if (payload.done || payload.isLast) {
						onComplete({ requestId, totalSize: totalSize ?? undefined });
					}
				};

				const onComplete = async (payload: { requestId: string; totalSize?: number }) => {
					if (!payload || payload.requestId !== requestId || completed) return;
					resetInactivityTimer();
					if (typeof payload.totalSize === 'number' && payload.totalSize > 0) {
						totalSize = payload.totalSize;
					}

					try {
						writer.end();
						await waitForWriterFinish();
						if (totalSize !== null && size !== totalSize) {
							mainWindowWrapper.webContents?.send('file-download-error', fileData, 'content-length mismatch');
							return cleanup(new Error(`Invalid response (content-length mismatch): ${displayName}`));
						}
						await cleanup();
					} catch (error) {
						return cleanup(error instanceof Error ? error : new Error(String(error)));
					}
				};

				const onError = (payload: { requestId: string; error?: string }) => {
					if (!payload || payload.requestId !== requestId || completed) return;
					const error = new Error(payload.error || 'Socket download error');
					mainWindowWrapper.webContents?.send('file-download-error', fileData, error.message);
					void cleanup(error);
				};

				this.socket.on(SOCKET_EVENTS.UPDATER_DOWNLOAD_CHUNK, onChunk);
				this.socket.on(SOCKET_EVENTS.UPDATER_DOWNLOAD_COMPLETE, onComplete);
				this.socket.on(SOCKET_EVENTS.UPDATER_DOWNLOAD_ERROR, onError);

				resetInactivityTimer();
				this.socket.emit(SOCKET_EVENTS.UPDATER_DOWNLOAD_REQUEST, {
					fileData,
					requestId,
				});
			});
		} catch (error) {
			writer.end();
			if (fs.existsSync(outputPath)) {
				await fsp.unlink(outputPath);
			}
			throw error;
		} finally {
			log.info('Closing writer stream.');
			writer.end();
		}

		return outputPath;
	}
	private async downloadFile_GC(fileData: FileData) {
		return new Promise<string>((resolve, reject) => {
			this.socket.emit('request-download-url', fileData, async (response: { signedURL?: string; error?: string }) => {
				if (response.signedURL) {
					try {
						log.info('Received signed URL for download:', response.signedURL);
						const outputPath = await this.downloadFile_HTTPS(fileData, response.signedURL);
						log.info('File downloaded successfully via GC URL:', outputPath);
						resolve(outputPath);
					} catch (error) {
						log.error('Error downloading file via GC URL:', error);
						mainWindowWrapper.webContents?.send('file-download-error', fileData, error instanceof Error ? error.message : String(error));
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				} else {
					const errorMsg = response.error || 'Failed to get signed URL';
					log.error(errorMsg);
					mainWindowWrapper.webContents?.send('file-download-error', fileData, errorMsg);
					reject(new Error(errorMsg));
				}
			});
		});
	}
	async DownloadWithRetries(fileData: FileData, retries = 3) {
		try {
			return this.downloadFile_GC(fileData);
		} catch (error) {
			if (retries > 0) {
				log.warn(`Retrying download... (${retries} attempts left)`);
				return this.DownloadWithRetries(fileData, retries - 1);
			}
			if (error instanceof Error) {
				log.error(`Error downloading file: ${error.message}`);
				throw error;
			} else {
				log.error('Error downloading file:', error);
				throw new Error(String(error));
			}
		}
	}
}
