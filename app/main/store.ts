import Store from "electron-store";

interface StoreSchema {
  authToken: string | null;
  updatePath: string | null;
  relativePath: string | null;
  autoupdate: boolean;
  startWithWindows: boolean;
  startMinimized: boolean;
  quitOnClose: boolean;
  maxBackupsFolderSize: number;
  backupsEnabled: boolean;
  backupsFolderPath: string | null;
  backupsPath: string | null;
  lastBackupTime: number | null;
  darkMode?: boolean;
  updaterInfo?: any;
  WCL_REFRESH_TOKEN?: string | null;
  windowSettings: {
	width: number;
	height: number;
	maximized: boolean;
  };
}

const store = new Store<StoreSchema>({
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
	backupsPath: null,
	lastBackupTime: null,
	darkMode: true,
	windowSettings: {
		width: 900,
		height: 600,
		maximized: false,
	},
  },
});

export default store;
