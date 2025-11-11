console.log('loading preload script');
import { contextBridge, ipcRenderer } from 'electron';


async function store_get(key: any) {
	if (key === 'authToken') return null;
	return await ipcRenderer.invoke('store-get', key);
}

async function store_set(key: any, value: any) {
	return await ipcRenderer.invoke('store-set', key, value);
}

contextBridge.exposeInMainWorld('ipc', {
	addListener: (...args: Parameters<typeof ipcRenderer.addListener>) => ipcRenderer.addListener(...args),
	invoke: (...args: Parameters<typeof ipcRenderer.invoke>) => ipcRenderer.invoke(...args),
	off: (...args: Parameters<typeof ipcRenderer.off>) => ipcRenderer.off(...args),
	on: (...args: Parameters<typeof ipcRenderer.on>) => ipcRenderer.on(...args),
	once: (...args: Parameters<typeof ipcRenderer.once>) => ipcRenderer.once(...args),
	postMessage: (...args: Parameters<typeof ipcRenderer.postMessage>) => ipcRenderer.postMessage(...args),
	removeAllListeners: (...args: Parameters<typeof ipcRenderer.removeAllListeners>) => ipcRenderer.removeAllListeners(...args),
	removeListener: (...args: Parameters<typeof ipcRenderer.removeListener>) => ipcRenderer.removeListener(...args),
	send: (...args: Parameters<typeof ipcRenderer.send>) => ipcRenderer.send(...args),
	sendSync: (...args: Parameters<typeof ipcRenderer.sendSync>) => ipcRenderer.sendSync(...args),
	sendToHost: (...args: Parameters<typeof ipcRenderer.sendToHost>) => ipcRenderer.sendToHost(...args),

})

contextBridge.exposeInMainWorld('store', {
	set: store_set,
	get: store_get,
	onSync: (key: string, callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
		ipcRenderer.send('store-sync-request', key); // subscribe to changes for the key
		ipcRenderer.on('store-sync', (_, changedKey, val) => changedKey === key && callback(val))
	},
});


console.log('preload script loaded');
