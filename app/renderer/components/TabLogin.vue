<script setup lang="ts">
import { ref } from 'vue';
import log from 'electron-log/renderer'
import { storeToRefs } from 'pinia';

import UIButton from "@/renderer/components/Button.vue";
import Input from '@/renderer/components/Input.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';

const loginStore = useLoginStore();
const { connectionError, disconnectReason } = storeToRefs(loginStore);

const username = ref('');
const password = ref('');

async function handleLogin() {
	log.info('Login attempt with:', username.value, password.value);

	loginStore.setConnectionError('');
	loginStore.setDisconnectReason('');

	const credentials = { username: username.value, password: password.value };
	const res = await api.IPCinvoke('login', credentials);
	if (res.success) {
		log.info('Login successful');
		api.socket_connect();
	} else {
		log.error('Login failed:', res.error);
		loginStore.setConnectionError(res.error);
		loginStore.setDisconnectReason('');
	}
}

</script>

<template>
	<div class="tab-content">
		<h1 class="tab-title-label">Login</h1>
		<Input type="text" placeholder="Username" v-model="username" />
		<Input type="password" placeholder="Password" v-model="password" />
		<UIButton :label="'Login'" @click="handleLogin" style="margin-top: 15px;"> </UIButton>
		<p id="disconnect-reason" class="error-text" v-text="disconnectReason && `Disconnected: ${disconnectReason}`">
		</p>
		<p id="login-error" class="error-text" v-text="connectionError && `Connection ${connectionError}`"></p>
	</div>
</template>

<style scoped>

.error-text {
	color: #FF9494;
	margin-top: 10px;
}
</style>
