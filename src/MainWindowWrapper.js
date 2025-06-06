class MainWindowWrapper {
  constructor() {
	this.webContents = new Proxy({}, {
		get: (target, prop) => {
			if (this.window && this.window.webContents) {
				return this.window.webContents[prop];
			}
			return undefined;
		}
	});
  }

  init(window) {
	this.window = window
  }
}

module.exports = new MainWindowWrapper();
