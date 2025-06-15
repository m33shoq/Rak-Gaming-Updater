import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

type clientInfo = {
	id: string;
	username: string;
	role: string;
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

	const getClients = computed(() => connectedClients.value);

	function setClients(clients: Array<clientInfo>) {
		connectedClients.value = clients;
	}

	api.IR_onConnectedClients((event, clients) => {
		setClients(clients);
	});


	return {
		connectedClients,
		getClients,
		setClients,
	};


});

