const fs = require('fs');
const path = require('path');
const fsp = require('fs').promises;
const { net } = require('electron');
const log = require('electron-log/main');
const store = require('./store.js');
const MainWindowWrapper = require('./MainWindowWrapper.js');
const { getWoWPath, validateWoWPath } = require('./wowPathUtility.js');
const { zipFile, unzipFile } = require('./zipHandler.js');

const { SERVER_URL, SERVER_LOGIN_ENDPOINT, SERVER_UPLOADS_ENDPOINT, SERVER_EXISTING_FILES_ENDPOINT, SERVER_DOWNLOAD_ENDPOINT } = require('./serverEndpoints.js');
const TEMP_DIR = path.join(__dirname, 'temp'); // Temporary directory for unzipped/zipped files


// return file path for downloaded zip file
async function DownloadFile(fileData, retries = 3) {
	try {
		const { fileName, relativePath, timestamp, hash, displayName } = fileData;
		const DOWNLOAD_URL = `${SERVER_DOWNLOAD_ENDPOINT}/${displayName}/${hash}`;

		const outputPath = path.join(TEMP_DIR, `${displayName}-${hash}.zip`);
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
						Authorization: `Bearer ${await store.get('authToken')}`,
					},
				});

				req.on('redirect', (status, method, redirectUrl) => {
					log.info(`[download] caught redirect`, status, redirectUrl);
					req.followRedirect();
				});

				req.on('response', (response) => {
					const fileLength = parseInt(response.headers['content-length'] ?? '0', 10);

					response.on('data', (data) => {
						writer.write(data, () => {
							size += data.length;
							const percent = fileLength <= 0 ? 0 : Math.floor((size / fileLength) * 100);
							MainWindowWrapper.webContents.send('file-chunk-received', fileData, percent);
							if (percent % 5 === 0 && percentMod !== percent) {
								percentMod = percent;
								log.debug(`Write: [${percent}] ${size}`);
							}
						});
					});

					response.on('end', () => {
						if (response.statusCode < 200 || response.statusCode >= 300) {
							return reject(new Error(`Invalid response (${response.statusCode}): ${DOWNLOAD_URL}`));
						}

						return resolve(undefined);
					});
					response.on('error', (err) => {
						return reject(err);
					});
				});
				req.end();
			});
		} finally {
			writer.end();
		}
		return outputPath;
	} catch (error) {
		if (retries > 0) {
			log.warn(`Retrying download... (${retries} attempts left)`);
			return DownloadFile(fileData, retries - 1);
		}
		log.error(`Error downloading file: ${error.message}`);
		throw error;
	}
}

async function InstallFile(fileData, zipPath) {
	const { fileName, relativePath } = fileData;
	const updatePath = await getWoWPath();
	const expectedOutputFolder = path.join(updatePath, relativePath, fileName); // wow + relative + foler/file
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
		MainWindowWrapper.webContents.send('file-downloaded', fileData);
	} catch (error) {
		log.error('Error extracting file:', error);
		console.error('Error extracting file:', error);
	}
}

module.exports = { DownloadFile, InstallFile };
