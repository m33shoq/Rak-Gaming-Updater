import { BrowserWindow, WebContents } from 'electron';

class MainWindowWrapper {
  private window: BrowserWindow | null = null;

  get webContents(): WebContents | undefined {
    return this.window?.webContents;
  }

  init(window: BrowserWindow): void {
    this.window = window;
  }
}

export default new MainWindowWrapper();
