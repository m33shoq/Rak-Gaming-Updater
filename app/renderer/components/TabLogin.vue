<script setup lang="ts">
import log from 'electron-log/renderer'
import { IPC_EVENTS } from '@/events';

import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import UIButton from "@/renderer/components/Button.vue";
import Input from '@/renderer/components/Input.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';

const loginStore = useLoginStore();

const username = ref('');
const password = ref('');
const connectionErrorDisplay = ref('');
let connectionErrorInterval: NodeJS.Timeout | null = null;

async function handleLogin() {
	log.info('Login attempt with:', username.value, password.value);

	loginStore.setConnectionError('');
	loginStore.setDisconnectReason('');

	const credentials = { username: username.value, password: password.value };
	const res = await ipc.invoke(IPC_EVENTS.LOGIN_SEND_CREDENTIALS, credentials);
	if (res.success) {
		log.info('Login successful');
		ipc.send(IPC_EVENTS.SOCKET_INITIATE_CONNECT);
	} else {
		log.error('Login failed:', res.error);
		loginStore.setConnectionError(res.error);
		loginStore.setDisconnectReason('');
	}
}

function updateConnectionErrorDisplay() {
	if (loginStore.connectionErrorAt) {
		connectionErrorDisplay.value = `${loginStore.getConnectionError} (${Math.floor((Date.now() - loginStore.connectionErrorAt) / 1000)} sec ago)`;
	} else {
		connectionErrorDisplay.value = '';
	}
}

watch(() => loginStore.connectionErrorAt, (newVal) => {
	if (newVal) {
		updateConnectionErrorDisplay();
		if (!connectionErrorInterval) {
			connectionErrorInterval = setInterval(updateConnectionErrorDisplay, 1000);
		}
	} else if (connectionErrorInterval) {
		clearTimeout(connectionErrorInterval);
		connectionErrorInterval = null;
		connectionErrorDisplay.value = '';
	}
});

onMounted(async () => {
	if (loginStore.connectionErrorAt) {
		connectionErrorInterval = setInterval(updateConnectionErrorDisplay, 1000);
	}

	const authInfo = await ipc.invoke(IPC_EVENTS.LOGIN_CHECK);
	if (authInfo) {
		ipc.send(IPC_EVENTS.SOCKET_INITIATE_CONNECT);
	}
});

onBeforeUnmount(() => {
	if (connectionErrorInterval) {
		clearTimeout(connectionErrorInterval);
		connectionErrorInterval = null;
	}
});

</script>

<template>
	<TabContent>
		<div class="flex flex-col items-center-safe justify-center h-3/4">
			<Input class="min-w-100"
				type="text"
				:placeholder="$t('login.username')"
				v-model="username"
			/>
			<Input class="min-w-100"
				type="password"
				:placeholder="$t('login.password')"
				v-model="password"
			/>
			<UIButton :label="$t('login.login')" @click="handleLogin" class="mt-4 h-9 w-50"> </UIButton>
		</div>
		<p class="text-red-500" v-text="loginStore.getDisconnectReason && `Disconnected: ${loginStore.getDisconnectReason}`">
		</p>
		<p class="text-red-500" v-text="connectionErrorDisplay"></p>
	</TabContent>
</template>

<style scoped>

</style>
