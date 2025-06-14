<script setup lang="ts">
import { ref } from 'vue';
import log from 'electron-log/renderer'

import TabContent from '@/renderer/components/TabContent.vue';

import UIButton from "@/renderer/components/Button.vue";
import Input from '@/renderer/components/Input.vue';

import { useLoginStore } from '@/renderer/store/LoginStore';

const loginStore = useLoginStore();

const username = ref('');
const password = ref('');

async function handleLogin() {
	log.info('Login attempt with:', username.value, password.value);

	loginStore.setConnectionError('');
	loginStore.setDisconnectReason('');

	const credentials = { username: username.value, password: password.value };
	const res = await api.IR_sendLogin(credentials);
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
	<TabContent>
		<h1 class="font-bold text-3xl">Login</h1>
		<Input type="text" placeholder="Username" v-model="username" />
		<Input type="password" placeholder="Password" v-model="password" />
		<UIButton :label="$t('login.login')" @click="handleLogin" class="mt-4 min-w-60"> </UIButton>
		<p id="disconnect-reason" class="error-text" v-text="loginStore.getDisconnectReason && `Disconnected: ${loginStore.getDisconnectReason}`">
		</p>
		<p id="login-error" class="error-text" v-text="loginStore.getConnectionError && `Connection ${loginStore.getConnectionError}`"></p>
	</TabContent>
</template>

<style scoped>

.error-text {
	color: #FF9494;
	margin-top: 10px;
}
</style>
