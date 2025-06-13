import { app } from 'electron';
import fsp from 'fs/promises';
import path from 'path';
import crc32 from 'crc/crc32';
import { zipFile, unzipFile } from './zipHandler';
import log from 'electron-log/main';

const TEMP_DIR = path.join(app.getPath('temp'), app.getName()); // Temporary directory for unzipped/zipped files

export async function GetFileData(filePath: string, relativePath: string): Promise<FileData> {
	let fileName = path.basename(filePath);
	const displayName = fileName;
	const stats = await fsp.stat(filePath);
	const timestamp = stats.mtimeMs / 1000; // Convert to seconds

	let hash;
	if (stats.isFile()) {
		const fileExtension = path.extname(filePath).toLowerCase();
		if (fileExtension === '.zip') {
			// we need hash of unzipped content
			const tempFilePath = path.join(TEMP_DIR, fileName);
			await fsp.mkdir(path.dirname(tempFilePath), { recursive: true });
			try {
				await unzipFile(filePath, tempFilePath); // Unzip the file to a temporary location

				// we need the hash of the first folder/file in the unzipped content
				const unzippedFiles = await fsp.readdir(tempFilePath);
				if (unzippedFiles.length === 0) {
					throw new Error(`Unzipped file ${filePath} is empty.`);
				}
				fileName = unzippedFiles[0];
				const hashFilePath = path.join(tempFilePath, fileName);

				hash = await CalculateHashForPath(hashFilePath); // Calculate hash of the unzipped content
			} finally {
				await fsp.rm(tempFilePath, { recursive: true }); // Clean up the temporary directory
			}
		} else {
			// calculate hash of file
			hash = await CalculateHashForPath(filePath);
		}
	} else {
		// calculate hash of folder
		hash = await CalculateHashForPath(filePath);
	}

	// const hash = await CalculateHashForPath(filePath);
	return { fileName, displayName, hash, relativePath, timestamp };
}

async function getHashForPath(filePath: string): Promise<string> {
	const stats = await fsp.stat(filePath);
	if (stats.isDirectory()) {
		// Get all entries in the directory
		const entries = await fsp.readdir(filePath);
		const sortedEntries = entries.sort();
		let combinedHash = '';
		for (let entry of sortedEntries) {
			const fullPath = path.join(filePath, entry);
			const entryHash = await getHashForPath(fullPath); // Process each entry sequentially
			combinedHash += entryHash; // Concatenate hashes
		}
		return crc32(combinedHash).toString(16);
	} else {
		// It's a file, generate hash as before
		const fileBuffer = await fsp.readFile(filePath);
		return crc32(fileBuffer).toString(16);
	}
}


export async function CalculateHashForPath(filePath: string): Promise<string> {
	const hash = await getHashForPath(filePath);
	log.info(`HASH CALCULATION: ${filePath} -> ${hash}`)

	return hash;
}
