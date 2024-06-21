const { ipcRenderer } = require('electron');
const socket = require('socket.io-client')('http://localhost:3000');
let token = localStorage.getItem('token');

function showLogin() {
    document.getElementById('login-container').style.display = 'block';
    document.getElementById('main-container').style.display = 'none';
}

function showMain() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('main-container').style.display = 'block';
}

if (token) {
    socket.auth = { token };
    socket.connect();
} else {
    showLogin();
}

document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    ipcRenderer.send('login', { username, password });
});

ipcRenderer.on('login-success', (event, data) => {
    token = data.token;
    localStorage.setItem('token', token);
    socket.auth = { token };
    socket.connect();
    showMain();
});

ipcRenderer.on('login-failed', (event, error) => {
    document.getElementById('login-error').innerText = error.error;
});

document.getElementById('select-path-btn').addEventListener('click', () => {
    ipcRenderer.send('select-update-path');
});

ipcRenderer.on('update-path-selected', (event, path) => {
    document.getElementById('selected-path').innerText = `Selected Path: ${path}`;
});

document.getElementById('push-update-btn').addEventListener('click', () => {
    const selectedPath = document.getElementById('selected-path').innerText.replace('Selected Path: ', '');
    if (selectedPath && token) {
        socket.emit('update', { destination: selectedPath, fileName: 'example.txt', source: 'source/path/example.txt', token });
    } else {
        alert('Please select a path first or login.');
    }
});

socket.on('update-success', (data) => {
    const logsList = document.getElementById('logs-list');
    const newLog = document.createElement('li');
    newLog.innerText = data.message;
    logsList.appendChild(newLog);
});

socket.on('update-failed', (data) => {
    alert(`Update failed: ${data.error}`);
});

// Fetch status and logs periodically
setInterval(() => {
    fetch('/status').then(res => res.json()).then(data => {
        const clientsList = document.getElementById('clients-list');
        clientsList.innerHTML = '';
        data.clients.forEach(client => {
            const clientItem = document.createElement('li');
            clientItem.innerText = `Client ${client}`;
            clientsList.appendChild(clientItem);
        });
    });

    fetch('/logs').then(res => res.json()).then(data => {
        const logsList = document.getElementById('logs-list');
        logsList.innerHTML = '';
        data.logs.forEach(log => {
            const logItem = document.createElement('li');
            logItem.innerText = log;
            logsList.appendChild(logItem);
        });
    });
}, 5000);
