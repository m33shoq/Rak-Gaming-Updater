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

let uploadedFiles = [];

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = JSON.parse(fs.readFileSync('users.json'));

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
	console.log(user, password, user.password)
    if (user && password === user.password) { //     if (user && bcrypt.compareSync(password, user.password)) {
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

app.get('/files', (req, res) => {
	res.json({ files: uploadedFiles });
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


	socket.on('upload-file', (data) => { // fileName file relativePath
		const uploadsDir = path.join(__dirname, 'uploads');
		if (!fs.existsSync(uploadsDir)) {
			fs.mkdirSync(uploadsDir, { recursive: true });
		}

		const filePath = path.join(uploadsDir, data.fileName);
		fs.writeFileSync(filePath, data.file);
		console.log('File saved:', filePath);
		const timestamp = data.timestamp
		const fileName = data.fileName;
		const relativePath = data.relativePath;


		// Notify other clients about the new file
		uploadedFiles.push({ fileName: fileName, relativePath: relativePath, timestamp: timestamp});
		socket.broadcast.emit('new-file', { fileName: fileName, relativePath: relativePath, timestamp: timestamp});
		socket.emit('new-file', { fileName: fileName, relativePath: relativePath, timestamp: timestamp});
	});

	socket.on('request-file', (data) => {
		let fileName = data.fileName;
		console.log('File requested:', fileName);
		const filePath = path.join(__dirname, 'uploads', fileName);
		if (fs.existsSync(filePath)) {
			const file = fs.readFileSync(filePath, 'utf-8');
			socket.emit('file-content', { fileName, file });
		} else {
			socket.emit('file-not-found', { fileName });
		}
	})
	socket.on('delete-file', (data) => {
		// remove from uploadedFiles
		uploadedFiles = uploadedFiles.filter(file => !(file.fileName === data.fileName && file.relativePath === data.relativePath && file.timestamp === data.timestamp));

		let fileName = data.file_name;
		console.log('File deleted:', fileName);
		const filePath = path.join(__dirname, 'uploads', fileName);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
			socket.emit('file-deleted', { fileName });
		}
	})
});

http.listen(3000, () => {
    console.log('Server listening on port 3000');
});
