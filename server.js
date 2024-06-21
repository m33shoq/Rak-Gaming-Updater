const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const secretKey = 'your-secret-key';
let connectedClients = [];
let updateLogs = [];

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = JSON.parse(fs.readFileSync('users.json'));

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (user && bcrypt.compareSync(password, user.password)) {
        const token = jwt.sign({ username: user.username }, secretKey);
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/status', (req, res) => {
    res.json({ clients: connectedClients });
});

app.get('/logs', (req, res) => {
    res.json({ logs: updateLogs });
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        try {
            const user = jwt.verify(token, secretKey);
            socket.user = user;
            return next();
        } catch (err) {
            return next(new Error('Authentication error'));
        }
    }
    next(new Error('Authentication error'));
});

io.on('connection', (socket) => {
    connectedClients.push(socket.id);
    socket.on('disconnect', () => {
        connectedClients = connectedClients.filter(id => id !== socket.id);
    });

    socket.on('update', (data) => {
        if (socket.user.username !== 'admin') {
            socket.emit('update-failed', { error: 'Unauthorized' });
            return;
        }

        const destPath = path.join(data.destination, data.fileName);
        fs.copyFile(data.source, destPath, (err) => {
            if (err) {
                socket.emit('update-failed', { error: err.message });
            } else {
                const log = `Updated ${data.fileName} at ${new Date().toLocaleString()}`;
                updateLogs.push(log);
                socket.emit('update-success', { message: log });
            }
        });
    });
});

http.listen(3000, () => {
    console.log('Server listening on port 3000');
});
