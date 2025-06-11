<script setup lang="ts">
import { ref } from 'vue';
import log from 'electron-log/renderer'

import UIButton from "@/components/Button.vue";
import Input from '@/components/Input.vue';
import { useLoginStore } from '@/store/LoginStore';

const loginStore = useLoginStore();

api.socket_on_connect(async () => {
	log.info('Connected to server');
	loginStore.setConnected(true);
	const authInfo = await api.check_for_login();
	if (authInfo.username && authInfo.password) {
		loginStore.setAuthInfo(authInfo)
	} else {
		loginStore.setAuthInfo();
	}
});

api.socket_on_disconnect((reason) => {
	log.error('Disconnected from server:', reason);
	loginStore.setConnected(false);
});

(async () => {
	const authInfo = await api.check_for_login();
	if (authInfo) {
		api.socket_connect();
	}
})();


const username = ref('');
const password = ref('');

async function handleLogin() {
	log.info('Login attempt with:', username.value, password.value);
	const credentials = { username: username.value, password: password.value };
	const res = await api.IPCinvoke('login', credentials);
	if (res.success) {
		log.info('Login successful');
	}
}

</script>

<template>
	<div class="tab-content">
		<h1 class="tab-title-label">Login</h1>
		<Input type="text" placeholder="Username" v-model="username"/>
		<Input type="password" placeholder="Password" v-model="password"/>
		<UIButton :label="'Login'" @click="handleLogin"> </UIButton>
		<p id="login-error" class="error-text"></p>
		<p id="disconnect-reason" class="error-text"></p>
	</div>
</template>

<style scoped>

</style>
