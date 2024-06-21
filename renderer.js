const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
let token = localStorage.getItem('token');

function showLogin() {
    console.log("Displaying login screen");
    document.getElementById('login-container').style.display = 'block';
    document.getElementById('main-container').style.display = 'none';
}

function showMain() {
    console.log("Displaying main interface");
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('main-container').style.display = 'block';
}

function initializeSocket() {
    if (token) {
        console.log("Token found, connecting with token:", token);
        socket.auth = { token };
        socket.connect();
    } else {
        console.log("No token found, showing login");
        showLogin();
    }

    socket.on('connect', () => {
        console.log("Socket connected");
        showMain();
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
    console.log("Select update path button clicked");
    ipcRenderer.send('select-update-path');
});

ipcRenderer.on('update-path-selected', (event, path) => {
    console.log("Update path selected:", path);
    document.getElementById('selected-path').innerText = `Selected Path: ${path}`;
});

document.getElementById('push-update-btn').addEventListener('click', () => {
    const selectedPath = document.getElementById('selected-path').innerText.replace('Selected Path: ', '');
    console.log("Push update button clicked, selected path:", selectedPath);
    if (selectedPath && token) {
        socket.emit('update', { destination: selectedPath, fileName: 'example.txt', source: 'source/path/example.txt' });
    } else {
        alert('Please select a path first or login.');
    }
});

// Fetch status and logs periodically
setInterval(() => {
    console.log("Fetching status and logs");
    fetch('http://localhost:3000/status').then(res => res.json()).then(data => {
        const clientsList = document.getElementById('clients-list');
        clientsList.innerHTML = '';
        data.clients.forEach(client => {
            const clientItem = document.createElement('li');
            clientItem.innerText = `Client ${client}`;
            clientsList.appendChild(clientItem);
        });
    }).catch(err => {
        console.error('Failed to fetch status:', err);
    });

    fetch('http://localhost:3000/logs').then(res => res.json()).then(data => {
        const logsList = document.getElementById('logs-list');
        logsList.innerHTML = '';
        data.logs.forEach(log => {
            const logItem = document.createElement('li');
            logItem.innerText = log;
            logsList.appendChild(logItem);
        });
    }).catch(err => {
        console.error('Failed to fetch logs:', err);
    });
}, 5000);
