let isConnected = false;
let userData = null;
const widgetContainerMap = new Map();
const filesListMap = new Map();

async function onNewFile(data) {
	addFileToWidget(data);
	if (isAdmin()) {
		addFileToAdminWidget(data);
	}
	if (await api.store.get('autoupdate') == true) {
			const shouldDownload = await api.shouldDownloadFile(data);
			console.log("ShouldDownloadFile:", shouldDownload)
			if (shouldDownload) {
			console.log('Auto updating file:', data.fileName)
			api.requestFile(data);
		} else {
			console.log('File is up to date:', data.fileName);
		}
	}
}

async function initializeSocket() {
	 userData = await api.check_for_login()
	if (userData) {
		api.socket_connect();
	} else {
		showLogin();
	}

	api.socket_on_connect(() => {
		isConnected = true;
		console.log("Socket connected");
		log(`Connected at ${new Date().toLocaleString()}`);
		widgetContainerMap.clear();
		filesListMap.clear();
		document.getElementById('updater-frame').innerHTML = '';
		document.getElementById('files-list').innerHTML = '';

		showMain();
		requestFilesData();
	});

	api.socket_on_disconnect((event, description) => {
		isConnected = false
		console.log(`Socket Disconnected`, description);
		log(`Disconnected at ${new Date().toLocaleString()}`);
		document.getElementById('disconnect-reason').innerText = `Disconnected: ${description}`
		document.getElementById('login-error').innerText = ``
		showLogin();
	});

	api.socket_on_connect_error((event, description) => {
		console.log('Connect failed:', description)
		document.getElementById('login-error').innerText = `connect failed: ${description}`
	});

	api.socket_on_new_file(async (event, data) => {
		console.log('New file available:', data, data.fileName);
		log(`New file available: ${data.fileName} at ${new Date().toLocaleString()}`);
		onNewFile(data)
	});

	api.socket_on_file_not_found((event, data) => {
		console.log('File not found:', data);
    log(`File not found: ${data.fileName} at ${new Date().toLocaleString()}`);
	});

	api.socket_on_file_deleted((event, data) => {
    log(`File deleted from the server: ${data.fileName} at ${new Date().toLocaleString()}`);

		removeFileFromWidget(data);
		if (isAdmin()) {
			removeFileFromAdminWidget(data);
		}
	})

	api.IR_onFileChunkReceived((event, data) => {
		const { progressPercent, fileName, relativePath, timestamp, hash } = data;
		console.log('File chunk received:', fileName, progressPercent);
		const uniqueId = generateUniqueId(data);
		const lineItem = widgetContainerMap.get(uniqueId);

		if (lineItem) {
			const updateBtn = lineItem.querySelector('.update-btn');
			updateBtn.Disable(`Downloading... ${progressPercent}%`);
			updateBtn.UpdateDownloadTimer();
		}
	});

	api.IR_onFileDownloaded((event, data) => {
		console.log('File downloaded:', data.fileName);
		console.log('File downloaded:', data);
		log(`File downloaded: ${data.fileName} at ${new Date().toLocaleString()}`);
		const uniqueId = generateUniqueId(data);
		const lineItem = widgetContainerMap.get(uniqueId);
		if (lineItem) {
			const updateBtn = lineItem.querySelector('.update-btn');
			updateBtn.Disable('Up to date'); // maybe should use .Update here but it's not necessary
		}
	});

}


document.getElementById('login-btn').addEventListener('click', async () => {
	const username = document.getElementById('username').value
	const password = document.getElementById('password').value

	let {success, error} = await api.IR_sendLogin({ username, password })
	console.log("Login result:", success, error)

	if (success) { // we recieved token so we can try to connect to the socket
		console.log("Login successful")
		userData = await api.check_for_login()
		console.log(userData)
		api.socket_connect();
	} else {
		console.log("Login failed:", error)
		document.getElementById('login-error').innerText = error
	}
});

document.getElementById('minimize-btn').addEventListener('click', () => {
	api.IR_minimizeApp();
});

document.getElementById('close-btn').addEventListener('click', () => {
	api.IR_closeApp();
});

api.IR_GetAppVersion().then(version => {
	document.getElementById('version').innerText = `Version ${version}`;
})

function log(...args) {
  const logsList = document.getElementById('logs-list')
  const logItem = document.createElement('li')
	logItem.innerText = args.join(' ')
  if (logsList.firstChild) {
		logsList.insertBefore(logItem, logsList.firstChild)
  } else {
    logsList.appendChild(logItem)
  }
}

api.IR_onLog((event, data) => {
	log(data)
})

function isAdmin() {
	return userData && userData.role === 'admin';
}

let tab_buttons = {}
let admin_tabs = {
	admin: true,
	status: true,
}
function showLogin() {
	console.log("Displaying login screen");
	document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
	document.getElementById(`login-container`).style.display = 'block';
	// hide tab buttons while on login screen
	document.querySelectorAll('.tab-button').forEach(button => {
		button.style.display = 'none';
	});
}

function showMain() {
	if (!isConnected) return showLogin();
	tab_buttons['main'].click();
}

function showAdmin() {
	if (!isConnected) return showLogin();
	if (isAdmin()) {
		tab_buttons['admin'].click();
	} else {
		showMain()
	}
}

function showSettings() {
	if (!isConnected) return showLogin();
	tab_buttons['settings'].click();
}

function showStatus() {
	if (!isConnected) return showLogin();
	tab_buttons['status'].click();
}

document.querySelectorAll('.tab-button').forEach(button => {
	const tabName = button.dataset.tabName
	console.log("Tab name:", tabName);
	tab_buttons[tabName] = button;
	button.addEventListener('click', () => {
		// update all tabs visibility based on user role
		document.querySelectorAll('.tab-button').forEach(button => {
			if (admin_tabs[button.dataset.tabName] && !isAdmin()) {
				button.style.display = 'none';
			} else {
				button.style.display = 'block';
			}
		});

		if (tabName === 'admin' && !isAdmin()) {
			return;
		}

		document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
		document.getElementById(`${tabName}-container`).style.display = 'block';

    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
		console.log("Switching to tab:", tabName);
    });
})

function generateUniqueId({fileName, relativePath, timestamp, hash}) {
  return `${fileName}^${relativePath}^${timestamp}^${hash}`;
}

function ButtonEnable(text) {
	this.disabled = false;
	this.classList.remove('disabled-btn');
	this.textContent = text;
}

function ButtonDisable(text) {
	console.log('Disabling button:', text);
	this.disabled = true;
	this.classList.add('disabled-btn');
	this.textContent = text;
}

function ButtonOnClick() {
	const data = this.fileData;
	this.Disable('Fetching...');
	this.UpdateDownloadTimer();
	api.requestFile(data);
}

async function ButtonUpdate() {
	const data = this.fileData;

	if (!await api.IR_GetWoWPath()) {
		this.Disable('No WoW path set');
	} else if (!await api.shouldDownloadFile(data)) {
		this.Disable('Up to date');
	} else {
		this.Enable('Update');
		this.addEventListener('click', ButtonOnClick);
	}
}

function ButtonUpdateDownloadTimer() {
	if (this.downloadTimer) clearTimeout(this.downloadTimer);
	this.downloadTimer = setTimeout(() => {
		this.Update()
	}, 5000);
}

const widgetContainer = document.getElementById('updater-frame');
async function addFileToWidget(data) {
  const uniqueId = generateUniqueId(data);
	if (widgetContainerMap.has(uniqueId)) {
		console.log('File already exists in widget:', data.fileName);
		return;
	}

  const lineItem = document.createElement('div');
	widgetContainerMap.set(uniqueId, lineItem);
  lineItem.className = 'line-item';

  let time = new Date(data.timestamp * 1000).toLocaleString();

  // Create the inner HTML structure to include file name, relative path, and timestamp
  lineItem.innerHTML = `
    <div class="file-info-container" id=${uniqueId}>
      <div class="file-name-path">
        <span>${data.fileName}\n
        ${data.relativePath}</span>
      </div>
      <div class="uploaded-time-container">
        <span>${time}</span>
      </div>
      <button class="update-btn">Update</button>
    </div>
  `;

  // Find the button within the newly created structure
  const updateBtn = lineItem.querySelector('.update-btn');
  updateBtn.fileData = data;
	updateBtn.Disable = ButtonDisable;
	updateBtn.Enable = ButtonEnable;
	updateBtn.Update = ButtonUpdate;
	updateBtn.UpdateDownloadTimer = ButtonUpdateDownloadTimer;

	updateBtn.Disable("Up to date");
	updateBtn.Update();

  widgetContainer.appendChild(lineItem)
}
function removeFileFromWidget(data) {
	const uniqueId = generateUniqueId(data);
	const lineItem = widgetContainerMap.get(uniqueId);
	if (lineItem) {
		lineItem.parentNode.removeChild(lineItem);
		lineItem.remove();
		widgetContainerMap.delete(uniqueId);
	}
}

function UpdateFileWidget() {
  widgetContainer.querySelectorAll('.line-item').forEach(lineItem => {
    const updateBtn = lineItem.querySelector('.update-btn');
		updateBtn.Update();
  });
}

document.getElementById('refresh-btn').addEventListener('click', async function() {
  this.classList.add('disabled-btn');
  this.disabled = true;

  setTimeout(() => {
		this.classList.remove('disabled-btn');
		this.disabled = false;
  }, 4000);

	console.log('Requesting files data')
	widgetContainerMap.clear();
	filesListMap.clear();
  document.getElementById('updater-frame').innerHTML = '';
  document.getElementById('files-list').innerHTML = '';
  filesData = await api.fetchFilesData()

	console.log('Files data:', filesData);
	filesData.files.forEach(onNewFile);
})

async function requestFilesData() {
	document.getElementById('refresh-btn').click();
}

document.getElementById('select-path-btn').addEventListener('click', async () => {
	console.log("Select WoW path button clicked");
	const updatePath = await api.IR_selectUpdatePath();
	if (updatePath) {
		document.getElementById('selected-path').innerText = `WoW Path: ${updatePath}`;
		api.store.set('updatePath', updatePath);
	} else {
		document.getElementById('selected-path').innerText = 'WoW Path: Invalid Path Supplied';
		api.store.set('updatePath', null);
	}
	UpdateFileWidget();
});



(async () => {
	const updatePath = await api.IR_GetWoWPath();
	const relativePath = await api.store.get('relativePath');
	const autoupdate = await api.store.get('autoupdate');
	const startWithWindows = await api.store.get('startWithWindows');
	const startMinimized = await api.store.get('startMinimized');
	console.log('autoupdate:', autoupdate);
	document.getElementById('selected-path').innerText = `Wow Path: ${updatePath || 'None'}`;
	document.getElementById('relative-path').innerText = `Relative Path: ${relativePath || 'None'}`;
	document.getElementById('auto-update-checkbox').checked = autoupdate == true;
	document.getElementById('start-with-windows-checkbox').checked = startWithWindows == true;
	document.getElementById('start-minimized-checkbox').checked = startMinimized == true;
})();

document.getElementById('auto-update-checkbox').addEventListener('change', () => {
	api.store.set('autoupdate', document.getElementById('auto-update-checkbox').checked);
})

document.getElementById('start-with-windows-checkbox').addEventListener('change', () => {
	api.IR_setStartWithWindows(document.getElementById('start-with-windows-checkbox').checked);
})

document.getElementById('start-minimized-checkbox').addEventListener('change', () => {
	api.store.set('startMinimized', document.getElementById('start-minimized-checkbox').checked);
})

const filesList = document.getElementById('files-list');
function addFileToAdminWidget(file) {
	const uniqueId = generateUniqueId(file);
	if (filesListMap.has(uniqueId)) {
		console.log('File already exists in admin widget:', file.fileName);
		return;
	}

	const div = document.createElement('div');
	filesListMap.set(uniqueId, div);

  let time = new Date(file.timestamp * 1000).toLocaleString();
	div.innerHTML = `
		<div class="file-info-container">
			<div class="file-name-path">
				<span>${file.fileName}\n
				${file.relativePath}</span>
			</div>
			<div class="uploaded-time-container">
				<span>${time}</span>
			</div>
			<button class="delete-btn">Delete</button>
		</div>
	`;
	div.classList.add('line-item');
	filesList.appendChild(div);

	const deleteBtn = div.querySelector('.delete-btn');

	deleteBtn.addEventListener('click', () => {
		console.log(`Deleting file: ${file.fileName}`);
		api.socket_emit_delete_file(file);
	});
}
function removeFileFromAdminWidget(file) {
	const uniqueId = generateUniqueId(file);
	const lineItem = filesListMap.get(uniqueId);
	if (lineItem) {
		lineItem.parentNode.removeChild(lineItem);
		lineItem.remove();
		filesListMap.delete(uniqueId);
	}
}

document.getElementById('add-files-btn').addEventListener('click', () => {
	api.IR_openFileDialogFile();
})

document.getElementById('add-folder-btn').addEventListener('click', () => {
	api.IR_openFileDialogFolder();
})

document.getElementById('set-relative-path-btn').addEventListener('click', async () => {
	console.log("Select WoW path button clicked");
	const path = await api.IR_selectRelativePath();
	if (path) {
		document.getElementById('relative-path').innerText = `Relative Path: ${path}`;
		api.store.set('relativePath', path);
	} else {
		document.getElementById('relative-path').innerText = 'Relative Path: Invalid Path Supplied';
		api.store.set('relativePath', null);
	}
})


initializeSocket()


api.IR_onConnectedClients((event, clients) => {
	if (!isAdmin) return;

	const clientsList = document.getElementById('clients-list')
	clientsList.innerHTML = ''
	clients.forEach(client => {
		const clientItem = document.createElement('li')
		clientItem.innerText = `${client.username}(${client.role})`
		if (clientsList.firstChild) {
			clientsList.insertBefore(clientItem, clientsList.firstChild)
		} else {
			clientsList.appendChild(clientItem)
		}
	});
})


