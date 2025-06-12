import { defineStore } from 'pinia';

export const useLoginStore = defineStore('Login', {
	state: () => ({
		isSocketConnected: false as boolean,
		username: '' as string,
		role: '' as string,
		disconnectReason: '' as string,
		connectionError: '' as string,
	}),

	getters: {
		isConnected: (state) => state.isSocketConnected,
		getUsername: (state) => state.username,
		getRole: (state) => state.role,
		getDisconnectReason: (state) => state.disconnectReason,
		getConnectionError: (state) => state.connectionError,
		isAdmin: (state) => state.isSocketConnected && state.role === 'admin',
	},

	actions: {
		setConnected: function (isSocketConnected: boolean) {
			if (this.isSocketConnected === isSocketConnected) return;
			this.isSocketConnected = isSocketConnected;
		},
		setAuthInfo: function (authInfo?: { username: string; role: string }) {
			if (authInfo) {
				this.username = authInfo.username;
				this.role = authInfo.role;
			} else {
				this.username = '';
				this.role = '';
			}
		},
		setDisconnectReason: function (reason: string) {
			this.disconnectReason = reason;
		},
		setConnectionError: function (error: string) {
			this.connectionError = error;
		},
	},
});
