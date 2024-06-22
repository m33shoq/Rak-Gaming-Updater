const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
const fs = require('fs');
const archiver = require('archiver');
const unzipper = require('unzipper');
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
        // wipe the widget container and logs list and files frame
		document.getElementById('widget-container').innerHTML = '';
		document.getElementById('logs-list').innerHTML = '';
		document.getElementById('files-list').innerHTML = '';


		showMain();
		showAdmin();

		requestFilesData();
    });

    socket.on('disconnect', (reason) => {
		console.log(`Socket Disconnected: ${reason}`);
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

	const fileChunks = {};

	socket.on('file-content-chunk', (data) => {
		// if (data.fileName && localStorage.getItem('updatePath')) {
			const { chunk, chunkNumber, totalChunks, fileName, relativePath, timestamp } = data;

			// Initialize the file's chunk array if it doesn't exist
			if (!fileChunks[fileName]) {
				fileChunks[fileName] = new Array(totalChunks).fill(null);
			}

			// Store the chunk in the corresponding position
			fileChunks[fileName][chunkNumber] = chunk;

			// Check if all chunks have been received
			const allChunksReceived = fileChunks[fileName].every((chunk) => chunk !== null);

			if (allChunksReceived) {
				// Combine all chunks
				const fileBuffer = Buffer.concat(fileChunks[fileName]);


				const updatePath = localStorage.getItem('updatePath');
				const filePath = path.join(updatePath, relativePath, fileName);
				const uploadsDir = path.join(updatePath, relativePath);
				if (!fs.existsSync(uploadsDir)) {
					fs.mkdirSync(uploadsDir, { recursive: true });
				}

				// decompress the file if it is a zip file
				console.log(fileName, fileName.endsWith('.zip'));
				if (fileName.endsWith('.zip')) {
					fs.writeFileSync(filePath, fileBuffer);
					fs.createReadStream(filePath)
						.pipe(unzipper.Extract({ path: uploadsDir }))
						.on('close', () => {
							console.log('File saved:', uploadsDir);
							fs.unlinkSync(filePath);
						})
						.on('error', (err) => {
							console.error('Extraction error:', err);
						});
				} else {
					fs.writeFileSync(filePath, fileBuffer);
					console.log('File saved:', filePath);
				}



				// Clean up the chunks array for this file
				delete fileChunks[fileName];

				const logsList = document.getElementById('logs-list');
				const logItem = document.createElement('li');
				logItem.innerText = `Updated file: ${data.fileName} at ${new Date().toLocaleString()}`;
				logsList.appendChild(logItem);
			}
		// }
	});

	socket.on('file-not-found', (data) => {
		console.log('File not found:', data);
		const logsList = document.getElementById('logs-list');
		const logItem = document.createElement('li');
		logItem.innerText = `File not found: ${data} at ${new Date().toLocaleString()}`;
		logsList.appendChild(logItem);
	});

	socket.on('file-deleted', (data) => {
		console.log('File deleted:', data.fileName);
		const logsList = document.getElementById('logs-list');
		const logItem = document.createElement('li');
		logItem.innerText = `Deleted file: ${data.fileName} at ${new Date().toLocaleString()}`;
		logsList.appendChild(logItem);

		// Remove the file from the widget container and files list
		const widgetContainer = document.getElementById('widget-container');
		const filesList = document.getElementById('files-list');
		for (let child of widgetContainer.children) {
			if (child.innerText.includes(data.fileName)) {
				widgetContainer.removeChild(child);
				break;
			}
		}
		for (let child of filesList.children) {
			if (child.innerText.includes(data.fileName)) {
				filesList.removeChild(child);
				break;
			}
		}

	})

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
	ipcRenderer.send('open-file-dialog-file');
});

document.getElementById('add-folder-btn').addEventListener('click', () => {
	ipcRenderer.send('open-file-dialog-folder');
});

ipcRenderer.on('selected-directory', (event, folderPath) => {
	if (!localStorage.getItem('relativePath')) return
	if (folderPath) {
		console.log("Selected path:", folderPath);
		const stats = fs.statSync(folderPath);

		if (stats.isDirectory()) {
			// Existing directory logic
			compressAndSendFolder(folderPath);
		} else if (stats.isFile()) {
			const fileExtension = path.extname(folderPath);

			if (fileExtension === '.zip') {
				// Send the .zip file directly
				sendFile(folderPath);
			} else {
				// Compress and send the file
				compressAndSendFile(folderPath);
			}
		}
	}
    // if (folderPath) {;
	// 	console.log("Selected folder path:", folderPath);
	// 	const folderName = path.basename(folderPath);
    //     const outputPath = path.join(folderPath, '..', `${folderName}.zip`);
	// 	console.log("Output path:", outputPath)
    //     const output = fs.createWriteStream(outputPath);
    //     const archive = archiver('zip', {
    //         zlib: { level: 9 }
    //     });

    //     output.on('close', function() {
	// 		console.log((archive.pointer() / 1024 / 1024).toFixed(2) + ' MB');
	// 		console.log('Archiver has been finalized and the output file descriptor has closed.');
	// 		// Send the file to the server here
	// 		const fileBuffer = fs.readFileSync(outputPath);
	// 		const stats = fs.statSync(outputPath); // Get file stats
	// 		const fileTimestamp = stats.mtime.toLocaleString(); // Use modification time as timestamp
	// 		send_data_in_chunks(socket, { file: fileBuffer, fileName: `${folderName}.zip`, relativePath: localStorage.getItem('relativePath'), timestamp: fileTimestamp});
	// 		// socket.emit('upload-file', { file: fileBuffer, fileName: `${folderName}.zip`, relativePath: localStorage.getItem('relativePath'), timestamp: fileTimestamp});
	// 		// delete the zip file after sending
	// 		fs.unlinkSync(outputPath);
	// 	});

    //     archive.on('error', function(err) {
    //         throw err;
    //     });

    //     archive.directory(folderPath, folderName);
    //     archive.pipe(output);
    //     archive.finalize();
    // }
});

document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-app');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});



function renderFiles(files) {
    const filesList = document.getElementById('files-list');
    // filesList.innerHTML = ''; // Clear existing list items

    files.forEach(file => {
		const div = document.createElement('div');
		div.innerHTML = `
			<div class="file-info-container">
				<div class="file-name-path">
					<span>${file.fileName}\n
					${file.relativePath}</span>
				</div>
				<div class="uploaded-time-container">
					<span>${file.timestamp}</span>
				</div>
				<button class="delete-btn">Delete</button>
			</div>
		`;
		// <button class="push-btn">Push</button>
		// Use 'line-item' class instead of 'file-item'
		div.classList.add('line-item');
		filesList.appendChild(div);

		// Attach event listeners to buttons
		// const pushBtn = div.querySelector('.push-btn');
		const deleteBtn = div.querySelector('.delete-btn');

		// pushBtn.addEventListener('click', () => {
		// 	console.log(`Pushing file: ${file.fileName}`);
		// });

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


function send_data_in_chunks(socket, data) {
	const CHUNK_SIZE = 256 * 1024; // 256KB
	const fileBuffer = data.file;
	const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

	const fileName = data.fileName;
	const relativePath = data.relativePath;
	const timestamp = data.timestamp;

	for (let i = 0; i < totalChunks; i++) {
		let start = i * CHUNK_SIZE;
		let end = start + CHUNK_SIZE;
		let chunk = fileBuffer.slice(start, end);
		socket.emit('upload-file-chunk', {
			chunk: chunk,
			chunkNumber: i,
			totalChunks: totalChunks,
			fileName: fileName,
			relativePath: relativePath,
			timestamp: timestamp,
		});
	}
}

function compressAndSendFolder(folderPath) {
    const folderName = path.basename(folderPath);
    const outputPath = path.join(folderPath, '..', `${folderName}.zip`);
    console.log("Output path:", outputPath);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function() {
        console.log((archive.pointer() / 1024 / 1024).toFixed(2) + ' MB');
        console.log('Archiver has been finalized and the output file descriptor has closed.');
        sendFile(outputPath);
    	fs.unlinkSync(outputPath);
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.directory(folderPath, folderName);
    archive.pipe(output);
    archive.finalize();
}

function compressAndSendFile(filePath) {
    const fileName = path.basename(filePath);
    const outputPath = path.join(path.dirname(filePath), `${fileName}.zip`);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function() {
        sendFile(outputPath);
    	fs.unlinkSync(outputPath);
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.file(filePath, { name: fileName });
    archive.pipe(output);
    archive.finalize();
}

function sendFile(filePath) {
    console.log("Sending file:", filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    const fileTimestamp = stats.mtime.toLocaleString();
    send_data_in_chunks(socket, { file: fileBuffer, fileName: path.basename(filePath), relativePath: localStorage.getItem('relativePath'), timestamp: fileTimestamp});
}
