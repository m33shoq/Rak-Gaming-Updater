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

// addonName to variableName to callbacks array
const registeredCallbacks = {}

async function updateWatchers() {
	if (activeWatchers.length > 0) {
		activeWatchers.forEach(watcher => watcher.close());
		activeWatchers.length = 0;
	}

	const wowPath = await getWoWPath()
	if (!wowPath) return;

	const accountsPath = path.join(wowPath, '_retail_', 'WTF', 'Account');
	if (!fs.existsSync(accountsPath)) {
		log.warn('WTF/Account directory does not exist:', accountsPath);
		return;
	}

	// add watcher to each folder in accountsPath except for "SavedVariables"
	const accountDirs = fs.readdirSync(accountsPath, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory() && dirent.name !== 'SavedVariables')
		.map(dirent => path.join(accountsPath, dirent.name));

	for (const accountDir of accountDirs) {
		const svPath = path.join(accountDir, 'SavedVariables');
		if (!fs.existsSync(svPath)) {
			log.warn('SavedVariables directory does not exist:', svPath);
			continue;
		}

		log.info('Setting up SV watchers in:', svPath);
		for (const addonName in registeredCallbacks) {
			const luaFilePath = path.join(svPath, `${addonName}.lua`);

			// we expect file to exist, if it dont this thing will work on next app launch
			if (!fs.existsSync(luaFilePath)) {
				continue;
			}

			const watcher = fs.watch(luaFilePath, (eventType, filename) => {
				log.info(`SV Watcher event: ${eventType} on ${filename}`);
				if (eventType !== 'change' || !filename) return; // filename is sometimes null

				const luaContent = fs.readFileSync(luaFilePath, "utf-8");
				try {
					const ast = luaparse.parse(luaContent, {
						comments: false,
						scope: true,
						locations: true,
						luaVersion: "5.1",
					});

					for (const variableName in registeredCallbacks[ addonName ]) {
						const varNode = findLuaVariable(ast, variableName);
						const jsObj = varNode ? luaValueToJs(varNode) : null;
						const callbacks = registeredCallbacks[ addonName ][ variableName ];
						for (const callback of callbacks) {
							try {
								callback(path.join(svPath, filename), jsObj);
							} catch {
								log.error('Error in SV callback for', addonName, variableName);
							}
						}
					}
				} catch (err) {
					log.error('Error parsing Lua file:', err);
					return;
				}
				// }
			});
			activeWatchers.push(watcher);
			log.info(`Watching SavedVariables for account: ${path.basename(accountDir)}, addon: ${addonName}`);
		}
	}
	log.info('SV Watchers updated. Total watchers:', activeWatchers.length);
}

store.onDidChange('updatePath', (newValue) => {
	log.info('updatePath changed, reloading watchers:', newValue);
	updateWatchers();
});

export function RegisterSVCallback(
	addonName: string,
	variableName: string,
	callback: (filePath: string, jsObject: Record<string, any>) => void
) {
	registeredCallbacks[addonName] = registeredCallbacks[addonName] || {};
	registeredCallbacks[addonName][variableName] = registeredCallbacks[addonName][variableName] || [];
	registeredCallbacks[addonName][variableName].push(callback);

	updateWatchers();
}
