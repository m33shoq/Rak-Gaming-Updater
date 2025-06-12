import { defineStore } from 'pinia';

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


export const useConnectedClientsStore = defineStore('connectedClients', {
	state: () => ({
		connectedClients: [] as Array<clientInfo>,
	}),

	getters: {
		getClients: (state) => state.connectedClients,
	},

	actions: {
		setClients: function (clients: Array<clientInfo>) {
			this.connectedClients = clients;
		}
	},
});
