import Store from "electron-store";

export interface StoreSchema {
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
  obsEnabled: boolean;
  obsPort: number;
  obsPassword: string;
  windowSettings: {
	width: number;
	height: number;
	maximized: boolean;
	x?: number;
	y?: number;
  };
  timelineWindowBounds?: {
	width: number;
	height: number;
	x: number;
	y: number;
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
  obsEnabled: false,
  obsPort: 4455,
  obsPassword: '',
	windowSettings: {
		width: 900,
		height: 600,
		maximized: false,
	},
  },
});

export default store;
