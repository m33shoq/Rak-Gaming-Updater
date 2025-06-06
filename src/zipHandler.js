const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extract = require('extract-zip');
const log = require('electron-log/main');


async function zipFile(sourcePath, destinationPath) {
	return new Promise((resolve, reject) => {
		const isFolder = fs.lstatSync(sourcePath)?.isDirectory();

		const output = fs.createWriteStream(destinationPath);
		const archive = archiver('zip', {
			zlib: { level: 9 } // Sets the compression level
		});

		output.on('close', () => {
			log.info(`Zipped ${archive.pointer()} total bytes`);
			resolve();
		});

		archive.on('error', (err) => {
			reject(err);
		});

		archive.pipe(output);
		if (isFolder) {
			archive.directory(sourcePath, path.basename(sourcePath)); // Include folder name in zip
		} else {
			archive.file(sourcePath, { name: path.basename(sourcePath) }); // Include file with its name
		}
		archive.finalize();
	});
}

async function unzipFile(targetPath, destinationPath) {
	return new Promise((resolve, reject) => {
		extract(targetPath, { dir: destinationPath })
			.then(() => {
				log.info(`Unzipped to ${destinationPath}`);
				resolve();
			})
			.catch((err) => {
				log.error(`Error unzipping file: ${err}`);
				reject(err);
			});
	});
}

module.exports = { zipFile, unzipFile };
