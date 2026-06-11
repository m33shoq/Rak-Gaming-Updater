import { ref } from 'vue';
import { IPC_EVENTS } from '@/events';

const defaultObsSettings: ObsSettings = {
	enabled: false,
	port: 4455,
	password: '',
};

const defaultObsStatus: ObsStatus = {
	connected: false,
	streaming: false,
	reconnecting: false,
	appRunning: null,
	websocketEnabled: null,
	lastError: null,
	updatedAt: Date.now(),
	serviceName: null,
	server: null,
};

const obsSettings = ref<ObsSettings>({ ...defaultObsSettings });
const obsStatus = ref<ObsStatus>({ ...defaultObsStatus });
let isObsStatusInitialized = false;

async function refreshObsData() {
	const response = await ipc.invoke(IPC_EVENTS.OBS_SETTINGS_GET);
	if (response?.settings) {
		obsSettings.value = {
			...defaultObsSettings,
			...response.settings,
		};
	}

	if (response?.status) {
		obsStatus.value = {
			...defaultObsStatus,
			...response.status,
		};
	}

	return response;
}

async function saveObsSettings(nextSettings: ObsSettings) {
	const response = await ipc.invoke(IPC_EVENTS.OBS_SETTINGS_SET, nextSettings);
	if (response?.settings) {
		obsSettings.value = {
			...defaultObsSettings,
			...response.settings,
		};
	}
	if (response?.status) {
		obsStatus.value = {
			...defaultObsStatus,
			...response.status,
		};
	}
	return response;
}

async function reconnectObs() {
	const response = await ipc.invoke(IPC_EVENTS.OBS_RECONNECT);
	if (response?.status) {
		obsStatus.value = {
			...defaultObsStatus,
			...response.status,
		};
	}
	return response;
}

export function useObsStatus() {
	if (!isObsStatusInitialized) {
		isObsStatusInitialized = true;
		ipc.on(IPC_EVENTS.OBS_STATUS_UPDATED, (event, status: ObsStatus) => {
			obsStatus.value = {
				...defaultObsStatus,
				...status,
			};
		});
		void refreshObsData();
	}

	return {
		obsSettings,
		obsStatus,
		refreshObsData,
		saveObsSettings,
		reconnectObs,
	};
}
