const SERVER_URL = process.env.ELECTRON_USE_DEV_URL === '1' ? 'http://localhost:3001' : `https://rak-gaming-annoucer-bot-93b48b086bae.herokuapp.com`;
const SERVER_LOGIN_ENDPOINT = `${SERVER_URL}/login`;
const SERVER_UPLOADS_ENDPOINT = `${SERVER_URL}/upload`;
const SERVER_EXISTING_FILES_ENDPOINT = `${SERVER_URL}/files`;
const SERVER_DOWNLOAD_ENDPOINT = `${SERVER_URL}/download`;

module.exports = {
	SERVER_URL,
	SERVER_LOGIN_ENDPOINT,
	SERVER_UPLOADS_ENDPOINT,
	SERVER_EXISTING_FILES_ENDPOINT,
	SERVER_DOWNLOAD_ENDPOINT
}
