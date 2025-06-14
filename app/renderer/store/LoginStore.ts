import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import log from 'electron-log/renderer'

export const useLoginStore = defineStore('Login', () =>{
	const state = ref({
		isSocketConnected: false as boolean,
		username: '' as string,
		role: '' as string,
		disconnectReason: '' as string,
		connectionError: '' as string,
		connectionErrorAt: 0 as number,
	})

	const isConnected = computed(() => state.value.isSocketConnected);
	const getUsername = computed(() => state.value.username);
	const getRole = computed(() => state.value.role);
	const getDisconnectReason = computed(() => state.value.disconnectReason);
	const getConnectionError = computed(() => state.value.connectionError);
	const isAdmin = computed(() => state.value.isSocketConnected && state.value.role === 'admin');
	const connectionErrorAt = computed(() => state.value.connectionErrorAt);

	function setConnected(isSocketConnected: boolean) {
		if (state.value.isSocketConnected === isSocketConnected) return;
		state.value.isSocketConnected = isSocketConnected;
	}
	function setAuthInfo(authInfo?: { username: string; role: string }) {
		if (authInfo) {
			state.value.username = authInfo.username;
			state.value.role = authInfo.role;
		} else {
			state.value.username = '';
			state.value.role = '';
		}
	}
	function setDisconnectReason(reason: string) {
		state.value.disconnectReason = reason;
	}
	function setConnectionError(error: string) {
		state.value.connectionError = error;
		if (error) {
			state.value.connectionErrorAt = Date.now();
		} else {
			state.value.connectionErrorAt = 0;
		}
	}

	api.socket_on_connect(async () => {
		log.info('Connected to server');
		setConnected(true);
		const authInfo = await api.check_for_login();
		setAuthInfo(authInfo);

		setConnectionError('');
		setDisconnectReason('');
	});

	api.socket_on_disconnect((event, reason) => {
		log.error('Disconnected from server:', reason);
		setConnected(false);
		setDisconnectReason(reason.description);
	});

	api.socket_on_connect_error((event, description) => {
		log.error('Connect failed:', description);
		setConnectionError(description);
	});


	return {
		state,

		setConnected,
		setAuthInfo,
		setDisconnectReason,
		setConnectionError,

		isConnected,
		getUsername,
		getRole,
		getDisconnectReason,
		getConnectionError,
		isAdmin,
		connectionErrorAt,
	};
});
