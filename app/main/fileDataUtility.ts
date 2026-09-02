import { app } from 'electron';
import fsp from 'fs/promises';
import path from 'path';
import crc32 from 'crc/crc32';
import { zipFile, unzipFile } from './zipHandler';
import log from 'electron-log/main';
import { randomUUID } from 'node:crypto';

const TEMP_DIR = path.join(app.getPath('temp'), app.getName()); // Temporary directory for unzipped/zipped files

export type FileDataResult = {
	fileData: FileData;
	totalBytes: number;
};

export async function GetFileData(filePath: string, relativePath: string): Promise<FileDataResult> {
	let fileName = path.basename(filePath);
	const displayName = fileName;
	const stats = await fsp.stat(filePath);
	const timestamp = stats.mtimeMs / 1000; // Convert to seconds

	let hash;
	let totalBytes = stats.isFile() ? stats.size : 0;
	if (stats.isFile()) {
		const fileExtension = path.extname(filePath).toLowerCase();
		if (fileExtension === '.zip') {
			// we need hash of unzipped content
			const tempRoot = path.resolve(TEMP_DIR, 'file-data');
			const tempFilePath = path.resolve(tempRoot, randomUUID());
			if (path.dirname(tempFilePath) !== tempRoot) {
				throw new Error('Could not create a safe temporary directory for ZIP inspection.');
			}
			await fsp.mkdir(tempFilePath, { recursive: true });
			try {
				await unzipFile(filePath, tempFilePath); // Unzip the file to a temporary location

				// we need the hash of the first folder/file in the unzipped content
				const unzippedFiles = await fsp.readdir(tempFilePath);
				if (unzippedFiles.length === 0) {
					throw new Error(`Unzipped file ${filePath} is empty.`);
				}
				fileName = unzippedFiles[0];
				const hashFilePath = path.join(tempFilePath, fileName);

				hash = (await getHashAndSizeForPath(hashFilePath)).hash; // Calculate hash of the unzipped content
			} finally {
				await fsp.rm(tempFilePath, { recursive: true, force: true }); // Clean up the temporary directory
			}
		} else {
			// calculate hash of file
			const pathData = await getHashAndSizeForPath(filePath);
			hash = pathData.hash;
			totalBytes = pathData.totalBytes;
		}
	} else {
		// calculate hash of folder
		const pathData = await getHashAndSizeForPath(filePath);
		hash = pathData.hash;
		totalBytes = pathData.totalBytes;
	}

	return {
		fileData: { fileName, displayName, hash, relativePath, timestamp },
		totalBytes,
	};
}

type PathHashAndSize = {
	hash: string;
	totalBytes: number;
};

async function getHashAndSizeForPath(filePath: string): Promise<PathHashAndSize> {
	const stats = await fsp.stat(filePath);
	if (stats.isDirectory()) {
		// Get all entries in the directory
		const entries = await fsp.readdir(filePath);
		const sortedEntries = entries.sort();
		let combinedHash = '';
		let totalBytes = 0;
		for (let entry of sortedEntries) {
			const fullPath = path.join(filePath, entry);
			const entryData = await getHashAndSizeForPath(fullPath); // Process each entry sequentially
			combinedHash += entryData.hash; // Concatenate hashes
			totalBytes += entryData.totalBytes;
		}
		return { hash: crc32(combinedHash).toString(16), totalBytes };
	} else {
		// It's a file, generate hash as before
		const fileBuffer = await fsp.readFile(filePath);
		return { hash: crc32(fileBuffer).toString(16), totalBytes: fileBuffer.byteLength };
	}
}


export async function CalculateHashForPath(filePath: string): Promise<string> {
	const { hash } = await getHashAndSizeForPath(filePath);
	log.info(`HASH CALCULATION: ${filePath} -> ${hash}`)

	return hash;
}
