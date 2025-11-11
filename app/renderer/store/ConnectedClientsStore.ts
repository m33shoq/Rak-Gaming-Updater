import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { IPC_EVENTS } from '@/events';


type clientInfo = {
	id: string;
	username: string;
	role: string;
	NICKNAME?: string;
	LAST_RELOAD?: number; // UNIX seconds
	APP_VERSION?: string;
}

// const dummyClientInfo: clientInfo = {
// 	id: 'dummy-id',
// 	username: 'dummy-username',
// 	role: 'dummy-role',
// };

// let dummyClientInfoArray: Array<clientInfo> = [ dummyClientInfo, dummyClientInfo, dummyClientInfo, dummyClientInfo, dummyClientInfo, dummyClientInfo, dummyClientInfo, dummyClientInfo ];
// dummyClientInfoArray = [...dummyClientInfoArray, ...dummyClientInfoArray, ...dummyClientInfoArray]


export const useConnectedClientsStore = defineStore('connectedClients', () => {
	const connectedClients = ref<Array<clientInfo>>([]);

	const getClients = computed(() => connectedClients.value?.sort((a, b) => {
		if (a.NICKNAME && b.NICKNAME) {
			return a.NICKNAME.localeCompare(b.NICKNAME);
		} else if (a.NICKNAME) {
			return -1;
		} else if (b.NICKNAME) {
			return 1;
		} else {
			return a.username.localeCompare(b.username);
		}
	}));

	function setClients(clients: Array<clientInfo>) {
		connectedClients.value = clients;
	}

	ipc.on(IPC_EVENTS.STATUS_CONNECTED_CLIENTS_CALLBACK, (event, clients) => {
		setClients(clients);
	});

	return {
		connectedClients,
		getClients,
		setClients,
	};
});

