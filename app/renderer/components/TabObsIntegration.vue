<script setup lang="ts">
import { computed, ref } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Input from '@/renderer/components/Input.vue';
import UIButton from '@/renderer/components/Button.vue';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useObsStatus } from '@/renderer/composables/useObsStatus';

const { obsStatus, saveObsSettings, reconnectObs } = useObsStatus();
const obsEnabled = getElectronStoreRef('obsEnabled', false);
const obsPort = getElectronStoreRef('obsPort', 4455);
const obsPassword = getElectronStoreRef('obsPassword', '');

const saveStatus = ref('');
const isSaving = ref(false);
const isReconnecting = ref(false);

const connectionStateLabel = computed(() => {
	if (obsStatus.value.connected) return 'obs.status.connected';
	if (obsStatus.value.reconnecting) return 'obs.status.reconnecting';
	return 'obs.status.disconnected';
});

const streamStateLabel = computed(() => {
	if (obsStatus.value.streaming) return 'obs.status.streaming';
	return 'obs.status.offline';
});

const appRunningLabel = computed(() => {
	if (obsStatus.value.appRunning === true) return 'Running';
	if (obsStatus.value.appRunning === false) return 'Not running';
	return 'Unknown';
});

const websocketEnabledLabel = computed(() => {
	if (obsStatus.value.websocketEnabled === true) return 'Enabled';
	if (obsStatus.value.websocketEnabled === false) return 'Disabled';
	return 'Unknown';
});

const statusUpdatedAtLabel = computed(() => {
	if (!obsStatus.value.updatedAt) return '-';
	return new Date(obsStatus.value.updatedAt).toLocaleString();
});

async function applySettings() {
	isSaving.value = true;
	saveStatus.value = '';

	const normalizedPort = Number(obsPort.value);
	const payload: ObsSettings = {
		enabled: obsEnabled.value,
		port: Number.isFinite(normalizedPort) ? normalizedPort : 4455,
		password: obsPassword.value,
	};

	try {
		const response = await saveObsSettings(payload);
		if (response?.success) {
			saveStatus.value = 'obs.settings_saved';
			return;
		}
		saveStatus.value = response?.error || 'obs.settings_save_failed';
	} catch (error: any) {
		saveStatus.value = error?.message || 'obs.settings_save_failed';
	} finally {
		isSaving.value = false;
	}
}

async function forceReconnect() {
	isReconnecting.value = true;
	try {
		await reconnectObs();
	} finally {
		isReconnecting.value = false;
	}
}
</script>

<template>
	<TabContent>
		<div class="max-w-xl">
			<div class="mb-4">
				<p class="text-base font-semibold">{{ $t('obs.title') }}</p>
				<p class="text-xs opacity-75">{{ $t('obs.description') }}</p>
			</div>

			<Checkbox :label="$t('obs.enabled')" v-model="obsEnabled" />

			<div class="mt-4">
				<label class="text-sm opacity-80 block mb-1">{{ $t('obs.port') }}</label>
				<input
					type="number"
					min="1"
					max="65535"
					v-model.number="obsPort"
					class="dark:bg-dark4 dark:hover:bg-dark4/80 bg-light4 hover:bg-light4/80 p-2 rounded-md focus:outline-hidden transition-all ease-in w-full"
				/>
			</div>

			<div class="mt-4">
				<label class="text-sm opacity-80 block mb-1">{{ $t('obs.password') }}</label>
				<input
					type="password"
					v-model="obsPassword"
					:placeholder="$t('obs.password_placeholder')"
					class="dark:bg-dark4 dark:hover:bg-dark4/80 bg-light4 hover:bg-light4/80 p-2 rounded-md focus:outline-hidden transition-all ease-in w-full"
				/>
			</div>

			<div class="flex gap-2 flex-wrap mt-5">
				<UIButton :label="$t('obs.apply_settings')" :disabled="isSaving" @click="applySettings" />
				<UIButton :label="$t('obs.reconnect')" :disabled="isReconnecting || !obsEnabled" @click="forceReconnect" />
			</div>

			<p v-if="saveStatus" class="text-xs mt-2 opacity-80">{{ $t(saveStatus) }}</p>

			<div class="mt-6 border border-gray-500/30 rounded-lg p-4 dark:bg-dark3 bg-light3">
				<div class="flex flex-wrap items-center gap-3 text-xs mb-3">
					<div class="flex items-center gap-2">
						<span class="opacity-70">App:</span>
						<span class="px-2 py-1 rounded text-xs"
							:class="obsStatus.appRunning === true ? 'bg-green-700 text-white' : (obsStatus.appRunning === false ? 'bg-gray-600 text-white' : 'bg-gray-500 text-white')"
						>
							{{ appRunningLabel }}
						</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="opacity-70">WS:</span>
						<span class="px-2 py-1 rounded text-xs"
							:class="obsStatus.websocketEnabled === true ? 'bg-green-700 text-white' : (obsStatus.websocketEnabled === false ? 'bg-red-700 text-white' : 'bg-gray-500 text-white')"
						>
							{{ websocketEnabledLabel }}
						</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="opacity-70">Conn:</span>
						<span class="px-2 py-1 rounded text-xs"
							:class="obsStatus.connected ? 'bg-green-700 text-white' : (obsStatus.reconnecting ? 'bg-amber-600 text-black' : 'bg-gray-500 text-white')"
						>
							{{ $t(connectionStateLabel) }}
						</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="opacity-70">Stream:</span>
						<span class="px-2 py-1 rounded text-xs"
							:class="obsStatus.streaming ? 'bg-red-700 text-white' : 'bg-blue-700 text-white'"
						>
							{{ $t(streamStateLabel) }}
						</span>
					</div>
				</div>
				<p class="text-xs opacity-80 break-words"><span class="opacity-60">{{ $t('obs.service') }}:</span> {{ obsStatus.serviceName || '-' }}</p>
				<p class="text-xs opacity-80 break-words mt-1"><span class="opacity-60">{{ $t('obs.server') }}:</span> {{ obsStatus.server || '-' }}</p>
				<p class="text-xs opacity-80 break-words mt-1"><span class="opacity-60">{{ $t('obs.last_update') }}:</span> {{ statusUpdatedAtLabel }}</p>
				<p v-if="obsStatus.lastError" class="text-xs text-red-400 break-words mt-2">{{ obsStatus.lastError }}</p>
			</div>
		</div>
	</TabContent>
</template>

<style scoped>
</style>
