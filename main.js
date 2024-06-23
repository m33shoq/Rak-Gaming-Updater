const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
let Store;
let store;

(async () => {
  const module = await import('electron-store');
  Store = module.default;
  store = new Store();
})();
const validator = require('validator');

// Use dotenv or a similar package to manage environment variables
require('dotenv').config();

let isDev;
(async () => {
    isDev = (await import('electron-is-dev')).default;
})();

console.log('Is Dev:', isDev);

let mainWindow;
let tray;

// Securely store the token
function storeToken(token) {
    store.set('authToken', token);
}

function getToken() {
    return store.get('authToken', '');
}

function sanitizeInput(input) {
    return validator.escape(input);
}


function validateWoWPath(inputPath) {
    // Normalize the input path to handle different path formats
    const normalizedPath = path.normalize(inputPath);
    // Split the path to analyze its components
    const pathComponents = normalizedPath.split(path.sep);

    // Find the index of the "World of Warcraft" folder in the path
    const wowIndex = pathComponents.indexOf('World of Warcraft');

    // If "World of Warcraft" is not in the path, the path is invalid
    if (wowIndex === -1) {
        return null;
    }

    // Construct the path up to and including "World of Warcraft"
    const wowPath = pathComponents.slice(0, wowIndex + 1).join(path.sep);

    // Check if the "_retail_" folder exists within the "World of Warcraft" directory
    const retailPath = path.join(wowPath, '_retail_');
    if (fs.existsSync(retailPath)) {
        // Return the path to "World of Warcraft" if "_retail_" exists within it
        return wowPath;
    }

    // Return null if the "_retail_" folder does not exist within the "World of Warcraft" directory
    return null;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
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
    mainWindow.setMinimumSize(1400, 600);
    mainWindow.setMenu(null);

    const url = 'https://rak-gaming-annoucer-bot-93b48b086bae.herokuapp.com/index.html'
		//isDev
        // ? 'http://localhost:3000'
        // : `file://${path.join(__dirname, 'index.html')}`;

    console.log(`Loading URL: ${url}`);
    mainWindow.loadURL(url).catch(err => {
        console.error('Failed to load URL:', err);
    });

    mainWindow.webContents.openDevTools();

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

            updatePath = validateWoWPath(result.filePaths[0]);
            event.reply('update-path-selected', updatePath);
        }
    });
	ipcMain.on('select-relative-path', async (event) => {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ['openDirectory']
		});
		if (result.filePaths.length > 0) {
			let pathToWow = validateWoWPath(result.filePaths[0]);
			if (!pathToWow) {
				event.reply('relative-path-selected', null);
				return;
			}
			let relativePath = path.relative(pathToWow, result.filePaths[0]);
			console.log('Relative path:', relativePath)
			event.reply('relative-path-selected', relativePath);
		}
	})

    ipcMain.on('login', async (event, { username, password }) => {
        try {
			const loginUrl = process.env.LOGIN_URL || 'http://localhost:3000/login';
			const sanitizedUsername = sanitizeInput(username); // Implement sanitizeInput to sanitize user inputs
        	const sanitizedPassword = sanitizeInput(password);


            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: sanitizedUsername, password: sanitizedPassword })
            });

			if (!response.ok) {
				throw new Error('Network response was not ok');
			}

            const data = await response.json();
            if (data.token) {
                storeToken(data.token);
                event.reply('login-success', { token: data.token });
            } else {
                event.reply('login-failed', { error: 'Invalid credentials' });
            }
        } catch (err) {
			console.error('Login error:', err);
			event.reply('login-failed', { error: 'Error logging in' });
		}
    });


	ipcMain.on('open-file-dialog-folder', async (event) => {
		console.log('Opening file dialog: open-file-dialog')
		const { canceled, filePaths } = await dialog.showOpenDialog({
			properties: ['openDirectory']
		});
		if (!canceled && filePaths.length > 0) {
		  	event.reply('selected-directory', filePaths[0]);
		}
	});

	ipcMain.on('open-file-dialog-file', async (event) => {
		console.log('Opening file dialog: open-file-dialog')
		const { canceled, filePaths } = await dialog.showOpenDialog({
			properties: ['openFile']
		});
		if (!canceled && filePaths.length > 0) {
		  	event.reply('selected-directory', filePaths[0]);
		}
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
