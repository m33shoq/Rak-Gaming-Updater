import log from 'electron-log/renderer'
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { IPC_EVENTS } from '@/events';

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

	ipc.on(IPC_EVENTS.SOCKET_CONNECTED_CALLBACK, async () => {
	// api.socket_on_connect(async (event) => {
		log.info('Socket connected');
		setConnected(true);
		const authInfo = await ipc.invoke(IPC_EVENTS.LOGIN_CHECK);
		setAuthInfo(authInfo);

		setConnectionError('');
		setDisconnectReason('');
	});

	ipc.on(IPC_EVENTS.SOCKET_DISCONNECTED_CALLBACK, (event, reason) => {
		log.info('Socket disconnected:', reason);
		setConnected(false);
		setDisconnectReason(reason.description);
	});

	ipc.on(IPC_EVENTS.SOCKET_CONNECT_ERROR_CALLBACK, (event, description) => {
		log.info('Socket connection error:', description);
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
