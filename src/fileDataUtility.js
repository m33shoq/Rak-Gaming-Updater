const fsp = require('fs').promises;
const path = require('path');
const crc32 = require('crc').crc32;
const { zipFile, unzipFile } = require('./zipHandler.js');

const TEMP_DIR = path.join(__dirname, 'temp'); // Temporary directory for unzipped files


async function GetFileData(filePath, relativePath) {
	const fileName = path.basename(filePath);
	const displayName = fileName;
	const stats = await fsp.stat(filePath);
	const timestamp = stats.mtimeMs / 1000; // Convert to seconds

	let hash;
	if (stats.isFile()) {
		const fileExtension = path.extname(filePath).toLowerCase();
		if (fileExtension === '.zip') { // we need hash of unzipped content
			const tempFilePath = path.join(TEMP_DIR, fileName);
			await fsp.mkdir(path.dirname(tempFilePath), { recursive: true });
			try {
				await unzipFile(filePath, tempFilePath); // Unzip the file to a temporary location
				hash = await CalculateHashForPath(tempFilePath); // Calculate hash of the unzipped content
			} finally {
				await fsp.rm(tempFilePath, { recursive: true}); // Clean up the temporary directory
			}
		} else { // calculate hash of file
			hash = await CalculateHashForPath(filePath);
		}
	} else { // calculate hash of folder
		hash = await CalculateHashForPath(filePath);
	}

	// const hash = await CalculateHashForPath(filePath);
	return { fileName, displayName, hash, relativePath, timestamp }
}

async function CalculateHashForPath(filePath) {
	const stats = await fsp.stat(filePath);
	if (stats.isDirectory()) {
		// Get all entries in the directory
		const entries = await fsp.readdir(filePath);
		const sortedEntries = entries.sort();
		let combinedHash = '';
		for (let entry of sortedEntries) {
			const fullPath = path.join(filePath, entry);
			const entryHash = await CalculateHashForPath(fullPath); // Process each entry sequentially
			combinedHash += entryHash; // Concatenate hashes
		}
		return crc32(combinedHash).toString(16);
	} else {
		// It's a file, generate hash as before
		const fileBuffer = await fsp.readFile(filePath);
		return crc32(fileBuffer).toString(16);
	}
}

module.exports = { GetFileData, CalculateHashForPath };
