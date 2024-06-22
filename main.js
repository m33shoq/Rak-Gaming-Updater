const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fetch = require('node-fetch');

let isDev;
(async () => {
    isDev = (await import('electron-is-dev')).default;
})();

let mainWindow;
let tray;
let token = '';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
		icon: path.join(__dirname, 'trayicon.png'),
		maximizable: false,
		minimizable: true,
		fullscreenable: false,
		resizable: false,
		frame: false,
    });

    // Set the minimum size of the window
    mainWindow.setMinimumSize(800, 600);
    mainWindow.setMenu(null);

    const url = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, 'index.html')}`;

    console.log(`Loading URL: ${url}`);
    mainWindow.loadURL(url).catch(err => {
        console.error('Failed to load URL:', err);
    });

    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => (mainWindow = null));
}

app.on('ready', () => {
    console.log('App is ready');
    createWindow();

    tray = new Tray(path.join(__dirname, 'trayIcon.png'));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); }},
    ]);
    tray.setToolTip('File Update App');
    tray.setContextMenu(contextMenu);
	tray.on('double-click', () => {
		if (mainWindow.isVisible()) {
			mainWindow.hide();
		} else {
			mainWindow.show();
		}
	});

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });

	ipcMain.on('minimize-app', (event) => {
		mainWindow.minimize();
	});

	ipcMain.on('close-app', (event) => {
		mainWindow.close();
	});

    ipcMain.on('select-update-path', async (event) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        if (result.filePaths.length > 0) {
            updatePath = result.filePaths[0];
            event.reply('update-path-selected', updatePath);
        }
    });

    ipcMain.on('login', async (event, { username, password }) => {
        try {
            const response = await fetch('http://localhost:3000/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.token) {
                token = data.token;
                event.reply('login-success', { token });
            } else {
                event.reply('login-failed', { error: 'Invalid credentials' });
            }
        } catch (err) {
            event.reply('login-failed', { error: 'Error logging in' });
        }
    });

    ipcMain.on('push-update', (event, data) => {
        if (!token) {
            event.reply('push-update-failed', { error: 'User not authenticated' });
            return;
        }
        // Logic to push the update by sending data to the server
        // Example logic here
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
