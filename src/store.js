const storePromise = (async () => {
  const { default: Store } = await import('electron-store');
  return new Store({
	defaults: {
	  authToken: null,
		updatePath: null,
		relativePath: null,
		autoupdate: false,
		startWithWindows: true,
		startMinimized: true,
		quitOnClose: false,
		maxBackupsFolderSize: 524,
		backupsEnabled: false,
		backupsFolderPath: null,
	},
  });
})();


class StoreWrapper {
	constructor() {
		this.store = null;
	}

  async init() {
	if (!this.store) {
	  this.store = await storePromise;
	}
  }

  async get(key) {
	await this.init();
	return this.store.get(key);
  }

  async set(key, value) {
	await this.init();
	return this.store.set(key, value);
  }

  async delete(key) {
	await this.init();
	return this.store.delete(key);
  }

//   async clear() {
// 	await this.init();
// 	return this.store.clear();
//   }
}

module.exports = new StoreWrapper();
