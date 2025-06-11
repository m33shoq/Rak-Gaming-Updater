import { defineStore } from 'pinia';

export const useLoginStore = defineStore('Login', {
	state: () => ({
		isSocketConnected: false,
		username: '',
		role: '',
	}),

	getters: {
		isConnected: (state) => state.isSocketConnected,
		getUsername: (state) => state.username,
		getRole: (state) => state.role,
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
	},
});
