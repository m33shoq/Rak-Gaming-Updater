const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const secretKey = 'your-secret-key10';
let connectedClients = [];
let updateLogs = [];

let uploadedFiles = [];
function generateUniqueId({fileName, relativePath, timestamp, hash}) {
    return `${fileName}-${hash}`;
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

const users = JSON.parse(fs.readFileSync('users.json'));

app.get('/', (req, res) => {
	res.send('Hello World!');
  });

app.get('/index.html', function(req, res) {
	res.sendFile(path.join(__dirname, '/index.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
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
		const { chunk, chunkNumber, totalChunks, fileName, relativePath, timestamp, hash } = data;

		socket.emit('ack', {
			chunkNumber: chunkNumber,
			fileName: fileName,
			hash: hash,
			status: 'received', // You can include additional status information if needed
		});


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

			// Assuming generateUniqueID is a function that returns a unique string
			const uniqueFileName = generateUniqueId({fileName, relativePath, timestamp, hash}) + path.extname(fileName); // Append original file extension

			// Save the combined file
			const uploadsDir = path.join(__dirname, 'uploads');
			if (!fs.existsSync(uploadsDir)) {
				fs.mkdirSync(uploadsDir, { recursive: true });
			}

			const filePath = path.join(uploadsDir, uniqueFileName); // Use uniqueFileName instead of fileName
			fs.writeFileSync(filePath, fileBuffer);
			console.log('File saved:', filePath);

			// Notify other clients about the new file
			uploadedFiles.push({ fileName, relativePath, timestamp, hash });
			socket.broadcast.emit('new-file', { fileName, relativePath, timestamp, hash });
			socket.emit('new-file', { fileName, relativePath, timestamp, hash });

			// Clean up the chunks array for this file
			delete fileChunks[fileName];
		}
	});

	socket.on('request-file', ({fileName, timestamp, relativePath, hash}) => {
		console.log('File requested:', fileName);
		const uniqueFileName = generateUniqueId({fileName, timestamp, relativePath, hash}) + path.extname(fileName);
		const filePath = path.join(__dirname, 'uploads', uniqueFileName);
		if (fs.existsSync(filePath)) {
			const file = fs.readFileSync(filePath);
			send_data_in_chunks(socket, { fileName, file, timestamp, relativePath, hash});
		} else {
			socket.emit('file-not-found', { fileName });
		}
	})
	socket.on('delete-file', (data) => {
		// remove from uploadedFiles
		uploadedFiles = uploadedFiles.filter(file => !(file.fileName === data.fileName && file.relativePath === data.relativePath && file.timestamp === data.timestamp && file.hash === data.hash));

		const isDuplicateFilePresent = uploadedFiles.some(file => file.fileName === data.fileName && file.hash === data.hash);
		if (!isDuplicateFilePresent) {
			// Proceed with deletion only if no duplicate file is found
			let fileName = generateUniqueId(data) + path.extname(data.fileName);
			console.log('File deleted:', fileName);
			const filePath = path.join(__dirname, 'uploads', fileName);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} else {
			console.log('File not deleted due to a duplicate in uploadedFiles:', data.fileName);
		}
		socket.emit('file-deleted', data);
		socket.broadcast.emit('file-deleted', data);
	})
});

http.listen(PORT, () => {
    console.log('Server listening on port ' + PORT);
});


async function send_data_in_chunks(socket, data) {
    const CHUNK_SIZE = 32 * 1024; // 32KB
    const fileBuffer = data.file;
    const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

    const fileName = data.fileName;
    const relativePath = data.relativePath;
    const timestamp = data.timestamp;

    // Function to send a single chunk and wait for an ACK
    const sendChunkAndWaitForAck = (chunk, chunkNumber) => {
        return new Promise((resolve, reject) => {
            const ackListener = (ackData) => {
                if (ackData.chunkNumber === chunkNumber && ackData.hash === data.hash && ackData.fileName === fileName) {
                    socket.off('ack', ackListener); // Remove listener after receiving ACK
                    resolve();
                }
            };
            socket.on('ack', ackListener);

            socket.emit('file-content-chunk', {
                chunk: chunk,
                chunkNumber: chunkNumber,
                totalChunks: totalChunks,
                fileName: fileName,
                relativePath: relativePath,
                timestamp: timestamp,
                hash: data.hash
            });

            // Timeout for ACK
            setTimeout(() => {
                socket.off('ack', ackListener); // Ensure to remove listener to prevent memory leak
                reject(`Timeout waiting for ACK for chunk ${chunkNumber}`);
            }, 5000); // 5 seconds timeout for ACK
        });
    };

    // Send each chunk and wait for ACK
    for (let i = 0; i < totalChunks; i++) {
        let start = i * CHUNK_SIZE;
        let end = start + CHUNK_SIZE;
        let chunk = fileBuffer.slice(start, end);

        try {
            await sendChunkAndWaitForAck(chunk, i);
            console.log(`Chunk ${i} sent and acknowledged`);
        } catch (error) {
            console.error(error);
            // Optionally, implement retry logic here
            i--; // Retry sending the current chunk
        }
    }
}