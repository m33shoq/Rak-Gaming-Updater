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

import {
	SERVER_URL,
	SERVER_LOGIN_ENDPOINT,
	SERVER_UPLOADS_ENDPOINT,
	SERVER_EXISTING_FILES_ENDPOINT,
	SERVER_DOWNLOAD_ENDPOINT
} from './serverEndpoints';


async function _downloadFile(fileData: FileData) {
	const { fileName, relativePath, timestamp, hash, displayName } = fileData;
	const DOWNLOAD_URL = `${SERVER_DOWNLOAD_ENDPOINT}/${displayName}/${hash}`;

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
				reject(err);
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

					if (size !== fileLength) {
						log.info(`Content-length mismatch: expected ${fileLength}, got ${size}`);
						mainWindowWrapper.webContents?.send('file-download-error', fileData, 'content-length mismatch');
						return reject(new Error(`Invalid response (content-length mismatch): ${DOWNLOAD_URL}`));
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

// return file path for downloaded zip file
export async function DownloadWithRetries(fileData: FileData, retries = 3) {
	try {
		return _downloadFile(fileData);
	} catch (error) {
		if (retries > 0) {
			log.warn(`Retrying download... (${retries} attempts left)`);
			return DownloadWithRetries(fileData, retries - 1);
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
		mainWindowWrapper.webContents?.send('file-downloaded', fileData);
	} catch (error) {
		log.error('Error extracting file:', error);
	}
}

