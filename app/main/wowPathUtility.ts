import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { app } from 'electron';
import log from 'electron-log/main';
import { setExternalVBSLocation, promisified } from 'regedit';
import store from './store';


let vbsPath: string;
if (process.env.NODE_ENV === 'development') {
	vbsPath = path.join(process.cwd(), 'node_modules', 'regedit', 'vbs');
} else {
	vbsPath = path.join(app.getAppPath(), '..', 'vbs');
}
setExternalVBSLocation(vbsPath);
log.info('VBS Path:', vbsPath);
async function wowDefaultPath(): Promise<string | null> {
	if (process.platform === 'win32') {
		// log.info('Checking default WoW path on Windows');
		const key = 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft';

		try {
			const results = await promisified.list([key]);
			if (!results[key].exists) {
				log.info('Registry key does not exist:', key);
				// Optionally, prompt the user to manually select the WoW installation path
				return null;
			}
			// log.info('Registry results:', results);
			const value = results[key].values.InstallPath.value;
			// log.info('Registry WoW Path:', value, typeof value);
			if (typeof value === 'string') {
				let path = validateWoWPath(value);
				// log.info('Validated WoW Path:', path);
				return path;
			} else {
				// log.error('WoW path is not a string:', value);
				// Optionally, prompt the user for input or provide a default path
				return null;
			}
		} catch (e) {
			log.error('Error accessing registry for WoW path:', e);
			// Show an error dialog to the user or log the error
			// Optionally, prompt the user to manually select the WoW installation path
			return null;
		}
	}
	return null;
}

export function validateWoWPath(inputPath: string): string | null {
	log.info('Validating WoW Path:', inputPath);
	// Normalize the input path to handle different path formats
	const normalizedPath = path.normalize(inputPath);
	// Split the path to analyze its components
	const pathComponents = normalizedPath.split(path.sep);

	// Find the index of the "World of Warcraft" folder in the path
	const wowIndex = pathComponents.map((component) => component.toLowerCase()).indexOf('world of warcraft'.toLowerCase());

	// If "World of Warcraft" is not in the path, the path is invalid
	if (wowIndex === -1) {
		log.info('Invalid WoW Path:', inputPath);
		return null;
	}

	// Construct the path up to and including "World of Warcraft"
	const wowPath = pathComponents.slice(0, wowIndex + 1).join(path.sep);

	// Check if the "_retail_" folder exists within the "World of Warcraft" directory
	const retailPath = path.join(wowPath, '_retail_');
	if (fs.existsSync(retailPath)) {
		// Return the path to "World of Warcraft" if "_retail_" exists within it
		log.info('Valid WoW Path:', wowPath);
		return wowPath;
	}

	// Return null if the "_retail_" folder does not exist within the "World of Warcraft" directory
	log.info('Invalid WoW Path(no _retail_):', inputPath);
	return null;
}

export async function getWoWPath(): Promise<string | null> {
	let path = await store.get('updatePath');
	if (!path) {
		path = await wowDefaultPath();
	}
	return path;
}

/**
 * Check if a given path is within another path
 * @param {string} basePath - The base path to check against
 * @param {string} targetPath - The target path to check
 * @returns {boolean} - True if targetPath is within basePath, false otherwise
 */
export function isPathWithin(basePath: string, targetPath: string): boolean {
	const resolvedBasePath = path.resolve(basePath);
	const resolvedTargetPath = path.resolve(targetPath);
	return resolvedTargetPath.startsWith(resolvedBasePath);
}

export async function getFolderSize(folderPath: string, signal: AbortSignal): Promise<string> {
	let totalSize = 0;

	async function calculateSize(directory: string): Promise<void> {
		const files = await fsp.readdir(directory, { withFileTypes: true });

		for (const file of files) {
			if (signal && signal.aborted) {
				throw new Error('Operation aborted');
			}

			const filePath = path.join(directory, file.name);
			try {
				const stats = await fsp.stat(filePath);

				if (stats.isDirectory()) {
					await calculateSize(filePath); // Recursively calculate size for subdirectories
				} else if (file.name.startsWith('WTF-')) {
					totalSize += stats.size; // Accumulate file size for files starting with WTF-
				}
			} catch (error: any) {
				if (error.code === 'EPERM' || error.code === 'EACCES') {
					console.warn(`Skipping inaccessible file: ${filePath}`);
				} else {
					throw error; // Re-throw other errors
				}
			}
		}
	}

	await calculateSize(folderPath);
	const totalSizeInMB = totalSize / (1024 * 1024); // Convert bytes to megabytes
	log.info(`Total size for ${folderPath}:`, totalSizeInMB.toFixed(2), 'MB');
	return totalSizeInMB.toFixed(2); // Return size in MB with 2 decimal places
}
