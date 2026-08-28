import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import extract from 'extract-zip';
import log from 'electron-log/main';
import crc32 from 'crc/crc32';
import * as yauzl from 'yauzl';
import type { Readable } from 'stream';

const ZIP_ENTRY_INACTIVITY_TIMEOUT_MS = 30_000;

export type ZipProgress = {
	processedBytes: number;
	totalBytes: number;
};

export type ZipValidationProgress = {
	processedBytes: number;
	entries: number;
};

function getAbortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error('Backup aborted');
	error.name = 'AbortError';
	return error;
}

export async function zipFile(
	sourcePath: string,
	destinationPath: string,
	onProgress?: (progress: ZipProgress) => void,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(getAbortError(signal));
			return;
		}
		const isFolder = fs.lstatSync(sourcePath)?.isDirectory();

		log.info(`Zipping ${isFolder ? 'folder' : 'file'}: ${sourcePath} to ${destinationPath}`);

		const output = fs.createWriteStream(destinationPath);
		const archive = new ZipArchive({
			zlib: { level: 9 }, // Sets the compression level
		});
		let settled = false;
		let failureError: Error | null = null;

		const fail = (error: Error) => {
			if (settled || failureError) return;
			failureError = error;
			signal?.removeEventListener('abort', abort);
			try {
				archive.abort();
			} catch (abortError) {
				log.warn('Could not abort failed ZIP creation:', abortError);
			}
			output.destroy();
		};
		const abort = () => fail(getAbortError(signal as AbortSignal));
		signal?.addEventListener('abort', abort, { once: true });

		output.once('error', fail);
		output.once('close', () => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', abort);
			if (failureError) {
				reject(failureError);
				return;
			}
			log.info(`Zipped ${archive.pointer()} total bytes`);
			resolve();
		});

		// A warning generally means a source file disappeared or could not be read.
		// Treat that as an incomplete backup instead of silently producing a partial archive.
		archive.once('warning', fail);
		archive.once('error', fail);
		archive.on('progress', (progress) => {
			if (!onProgress) return;
			try {
				onProgress({
					processedBytes: progress.fs.processedBytes,
					totalBytes: progress.fs.totalBytes,
				});
			} catch (error) {
				log.warn('Zip progress callback failed:', error);
			}
		});

		archive.pipe(output);
		if (isFolder) {
			archive.directory(sourcePath, path.basename(sourcePath)); // Include folder name in zip
		} else {
			archive.file(sourcePath, { name: path.basename(sourcePath) }); // Include file with its name
		}
		void archive.finalize().catch(fail);
	});
}

/**
 * Reads every entry to prove the central directory, compressed streams, sizes,
 * and CRC-32 values are intact before a staged archive is published.
 */
export async function validateZipFile(
	archivePath: string,
	onProgress?: (progress: ZipValidationProgress) => void,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(getAbortError(signal));
			return;
		}

		let openCompleted = false;
		const abortWhileOpening = () => {
			if (openCompleted) return;
			openCompleted = true;
			reject(getAbortError(signal as AbortSignal));
		};
		signal?.addEventListener('abort', abortWhileOpening, { once: true });
		yauzl.open(archivePath, {
			autoClose: true,
			lazyEntries: true,
			strictFileNames: true,
			validateEntrySizes: true,
		}, (openError, zipFile) => {
			if (openCompleted) {
				zipFile?.close();
				return;
			}
			openCompleted = true;
			signal?.removeEventListener('abort', abortWhileOpening);
			if (openError || !zipFile) {
				reject(new Error(`Backup archive could not be opened: ${openError?.message || 'Unknown ZIP error'}`));
				return;
			}

			let settled = false;
			let processedBytes = 0;
			let entries = 0;
			let activeStreamTimeout: NodeJS.Timeout | null = null;
			let activeStream: Readable | null = null;
			let abortValidation: (() => void) | null = null;

			const clearActiveStreamTimeout = () => {
				if (!activeStreamTimeout) return;
				clearTimeout(activeStreamTimeout);
				activeStreamTimeout = null;
			};

			const fail = (error: Error) => {
				if (settled) return;
				settled = true;
				clearActiveStreamTimeout();
				if (abortValidation) signal?.removeEventListener('abort', abortValidation);
				activeStream?.destroy();
				activeStream = null;
				reject(error);
				try {
					zipFile.close();
				} catch (closeError) {
					log.warn('Could not close invalid ZIP archive:', closeError);
				}
			};
			abortValidation = () => fail(getAbortError(signal as AbortSignal));
			signal?.addEventListener('abort', abortValidation, { once: true });
			if (signal?.aborted) {
				abortValidation();
				return;
			}

			zipFile.once('error', fail);
			zipFile.once('end', () => {
				if (settled) return;
				if (entries !== zipFile.entryCount) {
					fail(new Error(`Backup archive entry count mismatch: expected ${zipFile.entryCount}, read ${entries}`));
					return;
				}
				settled = true;
				clearActiveStreamTimeout();
				if (abortValidation) signal?.removeEventListener('abort', abortValidation);
				resolve();
			});
			zipFile.on('entry', (entry: yauzl.Entry) => {
				if (settled) return;
				entries += 1;
				if (entry.isEncrypted()) {
					fail(new Error(`Backup archive contains an encrypted entry: ${entry.fileName}`));
					return;
				}

				if (entry.fileName.endsWith('/')) {
					if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || entry.crc32 !== 0) {
						fail(new Error(`Invalid directory entry in backup archive: ${entry.fileName}`));
						return;
					}
					try {
						onProgress?.({ processedBytes, entries });
					} catch (error) {
						log.warn('ZIP validation progress callback failed:', error);
					}
					zipFile.readEntry();
					return;
				}

				zipFile.openReadStream(entry, (streamError, stream) => {
					if (settled) {
						stream?.destroy();
						return;
					}
					if (streamError || !stream) {
						fail(new Error(`Could not read backup entry ${entry.fileName}: ${streamError?.message || 'Unknown ZIP error'}`));
						return;
					}
					activeStream = stream;

					let entryCrc: number | undefined;
					let streamEnded = false;
					let streamTimeout: NodeJS.Timeout | null = null;
					const clearStreamTimeout = () => {
						if (!streamTimeout) return;
						clearTimeout(streamTimeout);
						if (activeStreamTimeout === streamTimeout) activeStreamTimeout = null;
						streamTimeout = null;
					};
					const resetStreamTimeout = () => {
						clearStreamTimeout();
						streamTimeout = setTimeout(() => {
							fail(new Error(`Timed out while validating backup entry: ${entry.fileName}`));
						}, ZIP_ENTRY_INACTIVITY_TIMEOUT_MS);
						activeStreamTimeout = streamTimeout;
					};
					resetStreamTimeout();
					stream.on('data', (chunk: Buffer) => {
						resetStreamTimeout();
						entryCrc = crc32(chunk, entryCrc);
						processedBytes += chunk.length;
						try {
							onProgress?.({ processedBytes, entries });
						} catch (error) {
							log.warn('ZIP validation progress callback failed:', error);
						}
					});
					stream.once('error', (error) => {
						clearStreamTimeout();
						fail(new Error(`Could not decompress backup entry ${entry.fileName}: ${error.message}`));
					});
					stream.once('close', () => {
						clearStreamTimeout();
						if (activeStream === stream) activeStream = null;
						if (!streamEnded && !settled) {
							fail(new Error(`Backup entry closed before it was fully read: ${entry.fileName}`));
						}
					});
					stream.once('end', () => {
						streamEnded = true;
						clearStreamTimeout();
						if (activeStream === stream) activeStream = null;
						if (settled) return;
						if (((entryCrc ?? 0) >>> 0) !== (entry.crc32 >>> 0)) {
							fail(new Error(`CRC mismatch in backup entry: ${entry.fileName}`));
							return;
						}
						zipFile.readEntry();
					});
				});
			});

			zipFile.readEntry();
		});
	});
}

export async function unzipFile(targetPath: string, destinationPath: string) {
	return new Promise((resolve, reject) => {
		extract(targetPath, { dir: destinationPath })
			.then(() => {
				log.info(`Unzipped to ${destinationPath}`);
				resolve(undefined);
			})
			.catch((err) => {
				log.error(`Error unzipping file: ${err}`);
				reject(err);
			});
	});
}
