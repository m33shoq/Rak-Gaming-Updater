import path from 'path';
import fs from 'fs';
import log from 'electron-log/main';
import luaparse from 'luaparse';
import { getWoWPath } from './wowPathUtility';
import store from '@/main/store';

// Find the assignment for your variable
function findLuaVariable(ast, varName) {
  for (const node of ast.body) {
    if (
      node.type === 'AssignmentStatement' &&
      node.variables[0]?.name === varName
    ) {
      return node.init[0]; // The value assigned
    }
  }
  return null;
}

function luaValueToJs(node) {
  if (!node) return null;
  switch (node.type) {
    case 'TableConstructorExpression': {
	  const obj: Record<string | number | symbol, any> = {};
      let arrayIndex = 1;
      for (const field of node.fields) {
        let key: string | number | boolean | null = null;
        if (field.type === 'TableKeyString') {
          key = field.key.name;
        } else if (field.type === 'TableKey') {
          const k = field.key;
          if (k.type === 'Identifier') {
            key = k.name;
          } else if (
            k.type === 'StringLiteral' ||
            k.type === 'NumericLiteral' ||
            k.type === 'BooleanLiteral'
          ) {
            if (k.value !== null && k.value !== undefined) {
              key = k.value;
            } else if (typeof k.raw === 'string') {
              key = k.raw.replace(/^"(.*)"$/, '$1');
            }
          }
        } else if (field.type === 'TableValue') {
          key = arrayIndex++;
        }
        if (key !== null && key !== undefined) {
		  // Convert boolean keys to string for JS object compatibility
		  const jsKey = typeof key === 'boolean' ? String(key) : key;
		  obj[jsKey] = luaValueToJs(field.value);
        }
      }
      return obj;
    }
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      if (node.value !== null && node.value !== undefined) {
        return node.value;
      } else if (typeof node.raw === 'string') {
        return node.raw.replace(/^"(.*)"$/, '$1');
      }
      return null;
    default:
      return null;
  }
}

let activeWatchers: fs.FSWatcher[] = [];
let watcherGeneration = 0;
let watcherRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const pendingFileReads = new Map<string, ReturnType<typeof setTimeout>>();
const FILE_EVENT_DEBOUNCE_MS = 250;
const FILE_READ_RETRY_DELAYS_MS = [150, 350, 750] as const;
const ACCOUNT_REFRESH_DEBOUNCE_MS = 1_500;

type SVCallback = (
	filePath: string,
	jsObject: Record<string, any> | null
) => void;

// addonName to variableName to callbacks array
const registeredCallbacks: Record<
	string,
	Record<string, SVCallback[]>
> = {};

function clearActiveWatchers() {
	for (const watcher of activeWatchers) {
		try {
			watcher.close();
		} catch (error) {
			log.debug('Failed to close an SV watcher', error);
		}
	}
	activeWatchers = [];

	for (const timer of pendingFileReads.values()) {
		clearTimeout(timer);
	}
	pendingFileReads.clear();

	if (watcherRefreshTimer) {
		clearTimeout(watcherRefreshTimer);
		watcherRefreshTimer = null;
	}
}

function isFileMissing(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as NodeJS.ErrnoException).code === 'ENOENT'
	);
}

async function wait(delayMs: number) {
	await new Promise<void>(resolve => setTimeout(resolve, delayMs));
}

async function readSavedVariablesFile(
	filePath: string,
	addonName: string,
	generation: number
) {
	let lastError: unknown;

	for (let attempt = 0; attempt <= FILE_READ_RETRY_DELAYS_MS.length; attempt++) {
		if (generation !== watcherGeneration) return;

		if (attempt > 0) {
			await wait(FILE_READ_RETRY_DELAYS_MS[attempt - 1]);
			if (generation !== watcherGeneration) return;
		}

		try {
			const luaContent = await fs.promises.readFile(filePath, 'utf-8');
			if (generation !== watcherGeneration) return;

			const ast = luaparse.parse(luaContent, {
				comments: false,
				luaVersion: '5.1',
			});

			if (generation !== watcherGeneration) return;

			for (const variableName in registeredCallbacks[addonName]) {
				const varNode = findLuaVariable(ast, variableName);
				const jsObject = varNode ? luaValueToJs(varNode) : null;

				for (const callback of registeredCallbacks[addonName][variableName]) {
					try {
						callback(filePath, jsObject);
					} catch (error) {
						log.error(
							'Error in SV callback for',
							addonName,
							variableName,
							error
						);
					}
				}
			}

			return;
		} catch (error) {
			lastError = error;
		}
	}

	// A rename event can legitimately mean that the file was removed.
	if (isFileMissing(lastError)) {
		log.debug('SavedVariables file no longer exists:', filePath);
		return;
	}

	log.error('Failed to read or parse SavedVariables file:', filePath, lastError);
}

function scheduleSavedVariablesRead(
	filePath: string,
	addonName: string,
	generation: number
) {
	const fileKey = filePath.toLowerCase();
	const existingTimer = pendingFileReads.get(fileKey);
	if (existingTimer) clearTimeout(existingTimer);

	const timer = setTimeout(() => {
		pendingFileReads.delete(fileKey);
		void readSavedVariablesFile(filePath, addonName, generation);
	}, FILE_EVENT_DEBOUNCE_MS);

	pendingFileReads.set(fileKey, timer);
}

function scheduleWatcherRefresh() {
	if (watcherRefreshTimer) clearTimeout(watcherRefreshTimer);

	watcherRefreshTimer = setTimeout(() => {
		watcherRefreshTimer = null;
		void updateWatchers();
	}, ACCOUNT_REFRESH_DEBOUNCE_MS);
}

async function updateWatchers() {
	const generation = ++watcherGeneration;
	clearActiveWatchers();

	try {
		const wowPath = await getWoWPath();
		if (!wowPath || generation !== watcherGeneration) return;

		const accountsPath = path.join(wowPath, '_retail_', 'WTF', 'Account');
		if (!fs.existsSync(accountsPath)) {
			log.warn('WTF/Account directory does not exist:', accountsPath);
			return;
		}

		const addonByFileName = new Map<string, string>(
			Object.keys(registeredCallbacks).map(addonName => [
				`${addonName}.lua`.toLowerCase(),
				addonName,
			])
		);

		// Account folders are created infrequently. Watching their parent catches
		// newly-created WoW accounts without requiring a background poll.
		const accountsWatcher = fs.watch(accountsPath, (eventType) => {
			if (eventType === 'rename') scheduleWatcherRefresh();
		});
		accountsWatcher.on('error', error => {
			log.error('WTF/Account watcher error:', accountsPath, error);
		});
		activeWatchers.push(accountsWatcher);

		const accountDirs = fs.readdirSync(accountsPath, { withFileTypes: true })
			.filter(dirent => dirent.isDirectory() && dirent.name !== 'SavedVariables')
			.map(dirent => path.join(accountsPath, dirent.name));
		const initialFiles: Array<{
			addonName: string;
			filePath: string;
			mtimeMs: number;
		}> = [];
		let watchedDirectories = 0;
		let pendingDirectories = 0;

		for (const accountDir of accountDirs) {
			if (generation !== watcherGeneration) return;

			const svPath = path.join(accountDir, 'SavedVariables');
			if (!fs.existsSync(svPath)) {
				log.debug('SavedVariables directory does not exist:', svPath);
				try {
					const watcher = fs.watch(accountDir, (eventType, filename) => {
						if (
							generation !== watcherGeneration ||
							eventType !== 'rename'
						) return;

						if (
							!filename ||
							path.basename(String(filename)).toLowerCase() === 'savedvariables'
						) {
							scheduleWatcherRefresh();
						}
					});
					watcher.on('error', error => {
						log.error('WoW account directory watcher error:', accountDir, error);
					});
					activeWatchers.push(watcher);
					pendingDirectories++;
				} catch (error) {
					log.warn('Failed to watch WoW account directory:', accountDir, error);
				}
				continue;
			}

			let watcher: fs.FSWatcher;
			try {
				watcher = fs.watch(svPath, (eventType, filename) => {
					if (generation !== watcherGeneration) return;

					if (!filename) {
						for (const addonName of addonByFileName.values()) {
							scheduleSavedVariablesRead(
								path.join(svPath, `${addonName}.lua`),
								addonName,
								generation
							);
						}
						return;
					}

					const changedFileName = path.basename(String(filename)).toLowerCase();
					const addonName = addonByFileName.get(changedFileName);
					if (!addonName) return;

					log.debug(`SV watcher event: ${eventType} on ${filename}`);
					scheduleSavedVariablesRead(
						path.join(svPath, `${addonName}.lua`),
						addonName,
						generation
					);
				});
			} catch (error) {
				log.warn('Failed to watch SavedVariables directory:', svPath, error);
				continue;
			}
			watcher.on('error', error => {
				log.error('SavedVariables directory watcher error:', svPath, error);
			});
			activeWatchers.push(watcher);
			watchedDirectories++;

			for (const addonName of Object.keys(registeredCallbacks)) {
				const filePath = path.join(svPath, `${addonName}.lua`);
				try {
					const stats = fs.statSync(filePath);
					if (stats.isFile()) {
						initialFiles.push({ addonName, filePath, mtimeMs: stats.mtimeMs });
					}
				} catch (error) {
					if (!isFileMissing(error)) {
						log.warn('Failed to inspect SavedVariables file:', filePath, error);
					}
				}
			}
		}

		log.info(
			'SV watchers updated.',
			'Watched SavedVariables directories:',
			watchedDirectories,
			'Pending directories:',
			pendingDirectories,
			'Active watchers:',
			activeWatchers.length
		);

		// Merge all existing account data once at startup. Processing the most
		// recently-written file last preserves the active account as MY_NICKNAME.
		initialFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const initialFile of initialFiles) {
			if (generation !== watcherGeneration) return;
			await readSavedVariablesFile(
				initialFile.filePath,
				initialFile.addonName,
				generation
			);
		}
	} catch (error) {
		if (generation === watcherGeneration) {
			log.error('Failed to update SV watchers:', error);
		}
	}
}

store.onDidChange('updatePath', (newValue) => {
	log.info('updatePath changed, reloading watchers:', newValue);
	void updateWatchers();
});

export function RegisterSVCallback(
	addonName: string,
	variableName: string,
	callback: SVCallback
) {
	registeredCallbacks[addonName] = registeredCallbacks[addonName] || {};
	registeredCallbacks[addonName][variableName] = registeredCallbacks[addonName][variableName] || [];
	registeredCallbacks[addonName][variableName].push(callback);

	void updateWatchers();
}
