import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import extract from 'extract-zip';
import log from 'electron-log/main';

export async function zipFile(sourcePath: string, destinationPath: string) {
	return new Promise((resolve, reject) => {
		const isFolder = fs.lstatSync(sourcePath)?.isDirectory();

		log.info(`Zipping ${isFolder ? 'folder' : 'file'}: ${sourcePath} to ${destinationPath}`);

		const output = fs.createWriteStream(destinationPath);
		const archive = archiver('zip', {
			zlib: { level: 9 }, // Sets the compression level
		});

		output.on('close', () => {
			log.info(`Zipped ${archive.pointer()} total bytes`);
			resolve(undefined);
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

