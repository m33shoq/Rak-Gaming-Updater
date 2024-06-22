const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
const fs = require('fs');
const archiver = require('archiver');
const unzipper = require('unzipper');
const path = require('path');
const { jwtDecode }	 = require('jwt-decode');
const crypto = require('crypto');

let token = localStorage.getItem('token');
let isConnected = false;

function generateHashForPath(entryPath) {
    let hashSum = crypto.createHash('sha256');

    if (fs.statSync(entryPath).isDirectory()) {
        // Get all entries in the directory
        const entries = fs.readdirSync(entryPath).sort();
        // Recursively generate hash for each entry
        entries.forEach(entry => {
            const fullPath = path.join(entryPath, entry);
            const entryHash = generateHashForPath(fullPath);
            hashSum.update(entryHash);
        });
    } else {
        // It's a file, generate hash as before
        const fileBuffer = fs.readFileSync(entryPath);
        hashSum.update(fileBuffer);
    }

    const finalHash = hashSum.digest('hex');
    return finalHash;
}

function shouldDownloadFile(serverFile) {
    if (!localStorage.getItem('updatePath')) return false;

    const localFilePath = path.join(localStorage.getItem('updatePath'), serverFile.relativePath, serverFile.fileName.replace('.zip', ''));
    // Check if the file exists
    if (!fs.existsSync(localFilePath)) {
        // console.log(`File does not exist: ${localFilePath}, should download`);
        return true; // If the file doesn't exist, return true to download it
    }

    const localFileHash = generateHashForPath(localFilePath);
    const shouldDownload = localFileHash !== serverFile.hash;
    // console.log(`File: ${localFilePath}, Should Download: ${shouldDownload}`);
    return shouldDownload;
}

function isAdmin() {
    const token = localStorage.getItem('token');
    if (!token) return false;

    try {
        const decoded = jwtDecode(token);
		console.log(`User role: ${decoded.role}`)
        return decoded.role === 'admin';
    } catch (error) {
        console.error('Error decoding token', error);
        return false;
    }
}

let tab_buttons = {};
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

function showLogs() {
	if (!isConnected) return showLogin();
	tab_buttons['logs'].click();
}

function showStatus() {
	if (!isConnected) return showLogin();
	tab_buttons['status'].click();
}

document.querySelectorAll('.tab-button').forEach(button => {
	const tabName = button.dataset.tabName
	console.log("Tab name:", tabName);
	tab_buttons[tabName] = button;
	button.addEventListener('click', function() {
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

		// Remove 'active' class from all buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
		console.log("Switching to tab:", tabName);
    });
});

function generateUniqueId({fileName, relativePath, timestamp, hash}) {
    return `${fileName}-${relativePath}-${timestamp}-${hash}`;
}

const widgetContainerMap = new Map();
const filesListMap = new Map();

function addFileToWidget(data) {
    const widgetContainer = document.getElementById('updater-frame');
    const lineItem = document.createElement('div');
    lineItem.className = 'line-item';

    // Create the inner HTML structure to include file name, relative path, and timestamp
    lineItem.innerHTML = `
        <div class="file-info-container">
            <div class="file-name-path">
                <span>${data.fileName}\n
				${data.relativePath}</span>
            </div>
            <div class="uploaded-time-container">
                <span>${data.timestamp}</span>
            </div>
            <button class="update-btn">Update</button>
        </div>
    `;

    // Find the button within the newly created structure
    const updateBtn = lineItem.querySelector('.update-btn');

    // Check if the file should be downloaded
	if (!shouldDownloadFile(data)) {
		console.log('Disable button:', data.fileName)
		updateBtn.disabled = true; // Disable the button if the file is up to date
		updateBtn.classList.add('disabled-btn'); // Add a class to change the visual appearance
		updateBtn.textContent = 'Up to date'
	} else {
		// Add event listener to the button for files that need to be updated
		updateBtn.addEventListener('click', () => {
			console.log(`Button clicked for ${data.fileName}`);
			requestFile(data);
		});
	}

    widgetContainer.appendChild(lineItem)

	const uniqueId = generateUniqueId(data);
	widgetContainerMap.set(uniqueId, lineItem);
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

function addFileToAdminWidget(file) {
    const filesList = document.getElementById('files-list');

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
	div.classList.add('line-item');
	filesList.appendChild(div);

	const deleteBtn = div.querySelector('.delete-btn');

	deleteBtn.addEventListener('click', () => {
		console.log(`Deleting file: ${file.fileName}`);
		socket.emit('delete-file', { fileName: file.fileName, relativePath: file.relativePath, timestamp: file.timestamp, hash: file.hash});
	});

	const uniqueId = generateUniqueId(file);
	filesListMap.set(uniqueId, div);
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

function requestFilesData() {
    fetch('http://localhost:3000/files')
        .then(response => response.json())
        .then(data => {
            console.log('Files data:', data);
			for (let file of data.files) {
				addFileToWidget(file);
			}
			if (isAdmin()) {
				for (let file of data.files) {
					addFileToAdminWidget(file);
				}
			}
        })
        .catch(error => console.error('Error fetching files data:', error));
}

function socket_connect(socket) {
    console.log("Attempting to connect to the server");
	try {
        socket.connect();
    } catch (error) {
		console.log("Failed to connect:", error)
        console.error("Failed to connect:", error);
		document.getElementById('login-error').innerText = 'Failed to connect to the server';
    }
}

function initializeSocket() {
    if (token) {
        socket.auth = { token };
        socket_connect(socket);
    } else {
        showLogin();
    }

    socket.on('connect', () => {
		isConnected = true;
        console.log("Socket connected");
        // wipe the widget container and logs list and files frame
		document.getElementById('updater-frame').innerHTML = '';
		document.getElementById('logs-list').innerHTML = '';
		document.getElementById('files-list').innerHTML = '';

		showMain();
		showAdmin();

		requestFilesData();
    });

    socket.on('disconnect', (reason) => {
		isConnected = false
		console.log(`Socket Disconnected: ${reason}`);
        showLogin();
    });

	socket.on('new-file', (data) => { // fileName relativePath timestamp
		console.log('New file available:', data.fileName);
		addFileToWidget(data);
		if (isAdmin()) {
			addFileToAdminWidget(data);
		}
		if (localStorage.getItem('autoupdate') === 'true') {
			if (shouldDownloadFile(data)) {
				console.log('Auto updating file:', data.fileName)
				requestFile(data);
			} else {
				console.log('File is up to date:', data.fileName);
			}
		}
	});

	const fileChunks = {};

	socket.on('file-content-chunk', (data) => {
		if (!localStorage.getItem('updatePath')) return
		const { chunk, chunkNumber, totalChunks, fileName, relativePath, timestamp, hash } = data;

		// After processing the chunk, send an acknowledgment back to the server
		socket.emit('ack', {
			chunkNumber: chunkNumber,
			fileName: fileName,
			hash: hash,
			status: 'received', // You can include additional status information if needed
		});

		console.log(`ACK sent for chunk ${chunkNumber} of file ${fileName}`)

		// Initialize the file's chunk array if it doesn't exist
		if (!fileChunks[fileName]) {
			fileChunks[fileName] = new Array(totalChunks).fill(null);
		}

		// Store the chunk in the corresponding position
		fileChunks[fileName][chunkNumber] = chunk;

		// Calculate the percentage of chunks received
		const chunksReceived = fileChunks[fileName].filter(chunk => chunk !== null).length;
		const progressPercent = Math.round((chunksReceived / totalChunks) * 100);

		// Update the button text to show download progress
		const uniqueId = generateUniqueId(data);
		const lineItem = widgetContainerMap.get(uniqueId);
		if (lineItem) {
			console.log('Updating button text:', progressPercent);
			const updateBtn = lineItem.querySelector('.update-btn');
			updateBtn.textContent = `Downloading... ${progressPercent}%`;
		}

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
			if (fileName.endsWith('.zip')) {
				console.log('Decompressing file:', filePath)
				fs.writeFileSync(filePath, fileBuffer);
				fs.createReadStream(filePath)
					.pipe(unzipper.Extract({ path: uploadsDir }))
					.on('close', () => {
						console.log('File saved:', uploadsDir);
						fs.unlinkSync(filePath);
					})
					.on('error', (err) => {
						console.error('Extraction error:', err);
					})
					.on('data', (data) => {
						console.log('Data:', data);
					});

			} else {
				fs.writeFileSync(filePath, fileBuffer);
				console.log('File saved:', filePath);
			}

			delete fileChunks[fileName];

			const logsList = document.getElementById('logs-list');
			const logItem = document.createElement('li');
			logItem.innerText = `Updated file: ${data.fileName} at ${new Date().toLocaleString()}`;
			logsList.appendChild(logItem);

			// TODO: Change update-btn state to 'Up to date'
			const uniqueId = generateUniqueId(data);
			const lineItem = widgetContainerMap.get(uniqueId);
			if (lineItem) {
				const updateBtn = lineItem.querySelector('.update-btn');
				updateBtn.disabled = true;
				updateBtn.classList.add('disabled-btn');
				updateBtn.textContent = 'Up to date';
			}
		}
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

		removeFileFromWidget(data);
		if (isAdmin()) {
			removeFileFromAdminWidget(data);
		}
	})
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
    socket_connect(socket);
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
		const hash = generateHashForPath(folderPath);
		const stats = fs.statSync(folderPath);
		console.log("Stats:", stats);

		if (stats.isDirectory()) {
			// Existing directory logic
			compressAndSendFolder(folderPath, hash);
		} else if (stats.isFile()) {
			const fileExtension = path.extname(folderPath);

			if (fileExtension === '.zip') {
				// Send the .zip file directly
				sendFile(folderPath, hash);
			} else {
				// Compress and send the file
				compressAndSendFile(folderPath, hash);
			}
		}
	}
});

document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-app');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});

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


async function send_data_in_chunks(socket, data) {
    const CHUNK_SIZE = 128 * 1024; // Adjusted to match the server.js example
    const fileBuffer = data.file;
    const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

    const fileName = data.fileName;
    const relativePath = data.relativePath;
    const timestamp = data.timestamp;
    const hash = data.hash;

    const sendChunkAndWaitForAck = (chunk, chunkNumber) => {
        return new Promise((resolve, reject) => {
            const ackListener = (ackData) => {
                if (ackData.chunkNumber === chunkNumber && ackData.hash === hash && ackData.fileName === fileName) {
                    socket.off('ack', ackListener); // Remove listener after receiving ACK
                    resolve();
                }
            };
            socket.on('ack', ackListener);

            socket.emit('upload-file-chunk', {
                chunk: chunk,
                chunkNumber: chunkNumber,
                totalChunks: totalChunks,
                fileName: fileName,
                relativePath: relativePath,
                timestamp: timestamp,
                hash: hash,
            });

            // Timeout for ACK
            setTimeout(() => {
                socket.off('ack', ackListener); // Ensure to remove listener to prevent memory leak
                reject(`Timeout waiting for ACK for chunk ${chunkNumber}`);
            }, 5000); // 5 seconds timeout for ACK
        });
    };

    for (let i = 0; i < totalChunks; i++) {
        let start = i * CHUNK_SIZE;
        let end = start + CHUNK_SIZE;
        let chunk = fileBuffer.slice(start, end);

        try {
            await sendChunkAndWaitForAck(chunk, i);
            console.log(`Chunk ${i} sent and acknowledged`);
        } catch (error) {
            console.error(error);
            i--; // Retry sending the current chunk
        }
    }
}

function compressAndSendFolder(folderPath, hash) {
    const folderName = path.basename(folderPath);
    const outputPath = path.join(folderPath, '..', `${folderName}.zip`);

    console.log("Output path:", outputPath);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function() {
        console.log((archive.pointer() / 1024 / 1024).toFixed(2) + ' MB');
        console.log('Archiver has been finalized and the output file descriptor has closed.');
        sendFile(outputPath, hash);
    	fs.unlinkSync(outputPath);
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.directory(folderPath, folderName);
    archive.pipe(output);
    archive.finalize();
}

function compressAndSendFile(filePath, hash) {
    const fileName = path.basename(filePath);
    const outputPath = path.join(path.dirname(filePath), `${fileName}.zip`);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function() {
        sendFile(outputPath, hash);
    	fs.unlinkSync(outputPath);
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.file(filePath, { name: fileName });
    archive.pipe(output);
    archive.finalize();
}

function sendFile(filePath, hash) {
    console.log("Sending file:", filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    const timestamp = stats.mtime.toLocaleString();
    send_data_in_chunks(socket, { file: fileBuffer, fileName: path.basename(filePath), relativePath: localStorage.getItem('relativePath'), timestamp, hash });
}


