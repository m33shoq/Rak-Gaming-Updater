import dotenv from 'dotenv';
dotenv.config();

const useDevelopmentServer = process.env.ELECTRON_USE_DEV_URL === '1';
export const SERVER_URL = useDevelopmentServer ? 'http://localhost:3001' : `https://rak-gaming-updater.org`//`https://rak-gaming-annoucer-bot-93b48b086bae.herokuapp.com`;
console.log('Using server:', useDevelopmentServer ? 'dev' : 'prod', SERVER_URL);
export const SERVER_API_URL = `${SERVER_URL}/api`;
export const SERVER_LOGIN_ENDPOINT = `${SERVER_API_URL}/login`;
export const SERVER_UPLOADS_ENDPOINT = `${SERVER_API_URL}/upload`;
export const SERVER_EXISTING_FILES_ENDPOINT = `${SERVER_API_URL}/files`;
export const SERVER_DOWNLOAD_ENDPOINT = `${SERVER_API_URL}/download`;
