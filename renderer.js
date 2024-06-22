const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
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

function addLineToWidget(text) {
    const widgetContainer = document.getElementById('widget-container');
    const lineItem = document.createElement('div');
    lineItem.className = 'line-item';

    const textNode = document.createElement('span');
    textNode.innerText = text;

    const button = document.createElement('button');
    button.innerText = 'Update';
    // Add event listener to button
    button.addEventListener('click', () => {
        console.log(`Button clicked for ${text}`);
        // Implement button click functionality here
    });

    lineItem.appendChild(textNode);
    lineItem.appendChild(button);

    widgetContainer.appendChild(lineItem);
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
    });

    socket.on('disconnect', () => {
        console.log("Socket disconnected");
        showLogin();
    });

    socket.on('update-success', (data) => {
        console.log("Update success:", data.message);
        const logsList = document.getElementById('logs-list');
        const newLog = document.createElement('li');
        newLog.innerText = data.message;
        logsList.appendChild(newLog);
    });

    socket.on('update-failed', (data) => {
        console.log("Update failed:", data.error);
        alert(`Update failed: ${data.error}`);
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

		const filesData = [
			{ fileName: "Report.pdf", relativePath: "/reports/2023/", id: "1", uploadedTime: "2023" },
			{ fileName: "Buet.xlsx", relativePath: "/budgets/2023/", id: "2",  uploadedTime: "04-02 11:30" },
			{ fileName: "Budget2.xlsx", relativePath: "/budgets/2023/", id: "2",  uploadedTime: "04-02 11:30" },
			{ fileName: "Budget3.xlsx", relativePath: "/budgets/2023/", id: "2", uploadedTime: "04-02 11:30" },
			// Add more file objects as needed
		];
		renderFiles(filesData);
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

// document.getElementById('push-update-btn').addEventListener('click', () => {
//     const selectedPath = document.getElementById('selected-path').innerText.replace('Selected Path: ', '');
//     console.log("Push update button clicked, selected path:", selectedPath);
//     if (selectedPath && token) {
//         socket.emit('update', { destination: selectedPath, fileName: 'hello world.txt', source: 'hello world.txt', token });
//     } else {
//         alert('Please select a path first or login.');
//     }
// });

// Toggle visibility of clients status and logs
// document.getElementById('toggle-clients-btn').addEventListener('click', () => {
//     const clientsStatus = document.getElementById('clients-status');
//     clientsStatus.style.display = clientsStatus.style.display === 'none' ? 'block' : 'none';
// });

// document.getElementById('toggle-logs-btn').addEventListener('click', () => {
//     const logsFrame = document.getElementById('logs-frame');
//     logsFrame.style.display = logsFrame.style.display === 'none' ? 'block' : 'none';
// });

// Fetch status and logs periodically
setInterval(() => {
    console.log("Fetching status and logs");
	const exampleText = `Line ${Math.floor(Math.random() * 100)}`;
    addLineToWidget(exampleText);
    // fetch('http://localhost:3000/status').then(res => res.json()).then(data => {
    //     const clientsList = document.getElementById('clients-list');
    //     clientsList.innerHTML = '';
    //     data.clients.forEach(client => {
    //         const clientItem = document.createElement('li');
    //         clientItem.innerText = `Client ${client}`;
    //         clientsList.appendChild(clientItem);
    //     });
    // }).catch(err => {
    //     console.error('Failed to fetch status:', err);
    // });

    // fetch('http://localhost:3000/logs').then(res => res.json()).then(data => {
    //     const logsList = document.getElementById('logs-list');
    //     logsList.innerHTML = '';
    //     data.logs.forEach(log => {
    //         const logItem = document.createElement('li');
    //         logItem.innerText = log;
    //         logsList.appendChild(logItem);
    //     });
    // }).catch(err => {
    //     console.error('Failed to fetch logs:', err);
    // });
}, 5000);

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
			// Implement the push functionality here
		});

		deleteBtn.addEventListener('click', () => {
			console.log(`Deleting file: ${file.fileName}`);
			// Implement the delete functionality here
			filesList.removeChild(div); // Remove the file item from the list
		});
	});
}