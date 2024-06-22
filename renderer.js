const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
const fs = require('fs');
const archiver = require('archiver');
const path = require('path');
let token = localStorage.getItem('token');

// Example function to check if the user is an admin
function isAdmin() {
    // Implement your logic to determine if the user is an admin
    // This could involve checking a user object, a token, etc.
    return true; // Placeholder return value
}

// Function to toggle the admin tab visibility
function showAdmin() {
    if (isAdmin()) {
		document.getElementById('admin-container').style.display = 'block';
		document.getElementById('main-container').style.display = 'none';
		document.getElementById('login-container').style.display = 'none';
		document.getElementById('toggle-panel-btn').textContent = 'Main Panel';
	} else {
		showMain()
    }
}

// Call the function to ensure the admin tab is correctly shown/hidden on page load

function showLogin() {
    console.log("Displaying login screen");
    document.getElementById('login-container').style.display = 'block';
    document.getElementById('main-container').style.display = 'none';
	document.getElementById('admin-container').style.display = 'none';
}

function showMain() {
    console.log("Displaying main interface");
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('main-container').style.display = 'block';
	document.getElementById('admin-container').style.display = 'none';
	document.getElementById('toggle-panel-btn').textContent = 'Admin Panel';
}

function addLineToWidget(data) {
    const widgetContainer = document.getElementById('widget-container');
    const lineItem = document.createElement('div');
    lineItem.className = 'line-item';

    const textNode = document.createElement('span');
    textNode.innerText = data.fileName;

    const button = document.createElement('button');
    button.innerText = 'Update';
    // Add event listener to button
    button.addEventListener('click', () => {
        console.log(`Button clicked for ${data.fileName}`);
        requestFile(data);
    });

    lineItem.appendChild(textNode);
    lineItem.appendChild(button);

    widgetContainer.appendChild(lineItem);
}


function requestFilesData() {
    fetch('http://localhost:3000/files')
        .then(response => response.json())
        .then(data => {
            console.log('Files data:', data);
            renderFiles(data.files); // Assuming the server responds with an object that has a 'files' property
			for (let file of data.files) {
				addLineToWidget(file);
			}
        })
        .catch(error => console.error('Error fetching files data:', error));
}

function initializeSocket() {
    if (token) {
        // console.log("Token found, connecting with token:", token);
        socket.auth = { token };
        socket.connect();
    } else {
        // console.log("No token found, showing login");
        showLogin();
    }

    socket.on('connect', () => {
        console.log("Socket connected");
        showMain();
		showAdmin();
		requestFilesData();
    });

    socket.on('disconnect', () => {
        console.log("Socket disconnected");
        showLogin();
    });

	socket.on('new-file', (data) => { // fileName relativePath timestamp
		console.log('New file available:', data.fileName);
		addLineToWidget(data);
		if (isAdmin()) {
			renderFiles([{ fileName: data.fileName, relativePath: data.relativePath, timestamp: data.timestamp }]);
		}
		if (localStorage.getItem('autoupdate') === 'true') {
			requestFile({ fileName: data.fileName, relativePath: data.relativePath, timestamp: data.timestamp });
		}
	});

	socket.on('file-content', (data) => {
		if (data.file && data.fileName && localStorage.getItem('updatePath')) {
			console.log('Received file:', data.fileName);
			// const filePath = path.join(localStorage.getItem('updatePath'), data.fileName);
		}
	});

	if (isAdmin()) {
		document.getElementById('toggle-panel-btn').style.display = 'block';
		document.getElementById('toggle-panel-btn').addEventListener('click', () => {
			if (document.getElementById('admin-container').style.display === 'none') {
				showAdmin();
			} else {
				showMain();
			}
		});
	}
}

initializeSocket();

document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    console.log("Attempting login with username:", username);
    ipcRenderer.send('login', { username, password });
});

ipcRenderer.on('login-success', (event, data) => {
    console.log("Login successful, token received:", data.token);
    token = data.token;
    localStorage.setItem('token', token);
    socket.auth = { token };
    socket.connect();
    showMain();
});

ipcRenderer.on('login-failed', (event, error) => {
    console.log("Login failed:", error.error);
    document.getElementById('login-error').innerText = error.error;
});

document.getElementById('select-path-btn').addEventListener('click', () => {
    console.log("Select WoW path button clicked");
    ipcRenderer.send('select-update-path');
});

console.log(localStorage.getItem('updatePath'));
document.getElementById('selected-path').innerText = `Wow Path: ${localStorage.getItem('updatePath') || 'None'}`;

ipcRenderer.on('update-path-selected', (event, path) => {
	if (path) {
		document.getElementById('selected-path').innerText = `WoW Path: ${path}`;
		localStorage.setItem('updatePath', path);
	} else {
		document.getElementById('selected-path').innerText = 'WoW Path: Invalid Path Supplied';
		localStorage.removeItem('updatePath');
	}
});


const autoUpdateCheckbox = document.getElementById('auto-update-checkbox');

// Set the checkbox state based on localStorage value on page load
autoUpdateCheckbox.checked = localStorage.getItem('autoupdate') === 'true';

// Add event listener for checkbox state change
autoUpdateCheckbox.addEventListener('change', function() {
	// Store the checkbox state in localStorage
	localStorage.setItem('autoupdate', autoUpdateCheckbox.checked);
});

document.getElementById('add-files-btn').addEventListener('click', () => {
	ipcRenderer.send('open-file-dialog');
  });

ipcRenderer.on('selected-directory', (event, folderPath) => {
	if (!localStorage.getItem('relativePath')) return
    if (folderPath) {;
		console.log("Selected folder path:", folderPath);
		const folderName = path.basename(folderPath);
        const outputPath = path.join(folderPath, '..', `${folderName}.zip`);
		console.log("Output path:", outputPath)
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', function() {
            console.log(archive.pointer() + ' total bytes');
            console.log('Archiver has been finalized and the output file descriptor has closed.');
            // Send the file to the server here
            const fileBuffer = fs.readFileSync(outputPath);
            socket.emit('upload-file', { file: fileBuffer, fileName: `${folderName}.zip`, relativePath: localStorage.getItem('relativePath'), timestamp: new Date().toLocaleString()});
			// delete the zip file after sending
			fs.unlinkSync(outputPath);
        });

        archive.on('error', function(err) {
            throw err;
        });

        archive.directory(folderPath, false);
        archive.pipe(output);
        archive.finalize();
    }
});

document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-app');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});



function renderFiles(files) {
    const filesList = document.getElementById('files-list');
    filesList.innerHTML = ''; // Clear existing list items

    files.forEach(file => {
		const div = document.createElement('div');
		div.innerHTML = `
			<div class="file-info-container">
				<div class="file-name-path">
					<span>${file.fileName}\n
					${file.relativePath}</span>
				</div>
				<div class="uploaded-time-container">
					<span>${file.uploadedTime}</span>
				</div>
				<div class="buttons-container">
					<button class="push-btn">Push</button>
					<button class="delete-btn">Delete</button>
				</div>
			</div>
		`;
		// Use 'line-item' class instead of 'file-item'
		div.classList.add('line-item');
		filesList.appendChild(div);

		// Attach event listeners to buttons
		const pushBtn = div.querySelector('.push-btn');
		const deleteBtn = div.querySelector('.delete-btn');

		pushBtn.addEventListener('click', () => {
			console.log(`Pushing file: ${file.fileName}`);
		});

		deleteBtn.addEventListener('click', () => {
			console.log(`Deleting file: ${file.fileName}`);
			socket.emit('delete-file', { fileName: file.fileName, relativePath: file.relativePath, timestamp: file.timestamp});
			filesList.removeChild(div);
		});
	});
}


function requestFile(data) {
	console.log("Requesting file:", data.fileName);
	socket.emit('request-file', data);
}

document.getElementById('relative-path').innerText = `Relative Path: ${localStorage.getItem('relativePath') || 'None'}`;
document.getElementById('set-relative-path-btn').addEventListener('click', () => {
	console.log("Select WoW path button clicked");
	ipcRenderer.send('select-relative-path');
});

ipcRenderer.on('relative-path-selected', (event, path) => {
	if (path) {
		document.getElementById('relative-path').innerText = `Relative Path: ${path}`;
		localStorage.setItem('relativePath', path);
	} else {
		document.getElementById('relative-path').innerText = 'Relative Path: Invalid Path Supplied';
		localStorage.removeItem('relativePath');
	}
});
