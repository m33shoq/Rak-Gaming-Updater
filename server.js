const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const secretKey = 'your-secret-key4';
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
    if (user && bcrypt.compareSync(password, user.password)) {
        const token = jwt.sign({ username: user.username, role: user.role }, secretKey);
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

	const fileChunks = {};

	socket.on('upload-file-chunk', (data) => {
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

			// Save the combined file
			const uploadsDir = path.join(__dirname, 'uploads');
			if (!fs.existsSync(uploadsDir)) {
				fs.mkdirSync(uploadsDir, { recursive: true });
			}

			const filePath = path.join(uploadsDir, fileName);
			fs.writeFileSync(filePath, fileBuffer);
			console.log('File saved:', filePath);

			// Notify other clients about the new file
			uploadedFiles.push({ fileName, relativePath, timestamp });
			socket.broadcast.emit('new-file', { fileName, relativePath, timestamp });
			socket.emit('new-file', { fileName, relativePath, timestamp });

			// Clean up the chunks array for this file
			delete fileChunks[fileName];
		}
	});

	socket.on('request-file', (data) => {
		let fileName = data.fileName;
		console.log('File requested:', fileName);
		const filePath = path.join(__dirname, 'uploads', fileName);
		if (fs.existsSync(filePath)) {
			const file = fs.readFileSync(filePath);
			send_data_in_chunks(socket, { fileName: fileName, file: file, timestamp: data.timestamp, relativePath: data.relativePath});
		} else {
			socket.emit('file-not-found', { fileName });
		}
	})
	socket.on('delete-file', (data) => {
		// remove from uploadedFiles
		uploadedFiles = uploadedFiles.filter(file => !(file.fileName === data.fileName && file.relativePath === data.relativePath && file.timestamp === data.timestamp));

		let fileName = data.fileName;
		console.log('File deleted:', fileName);
		const filePath = path.join(__dirname, 'uploads', fileName);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
			socket.emit('file-deleted', data);
			socket.broadcast.emit('file-deleted', data);
		}
	})
});

http.listen(3000, () => {
    console.log('Server listening on port 3000');
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
		socket.emit('file-content-chunk', {
			chunk: chunk,
			chunkNumber: i,
			totalChunks: totalChunks,
			fileName: fileName,
			relativePath: relativePath,
			timestamp: timestamp,
		});
	}
}