<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import TabContent from '@/renderer/components/TabContent.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Input from '@/renderer/components/Input.vue';
import UIButton from '@/renderer/components/Button.vue';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';
import { IPC_EVENTS } from '@/events';

import { useObsStatus } from '@/renderer/composables/useObsStatus';

const { obsStatus, saveObsSettings, reconnectObs } = useObsStatus();
const { t } = useI18n();
const obsEnabled = getElectronStoreRef('obsEnabled', false);
const obsPort = getElectronStoreRef('obsPort', 4455);
const obsPassword = getElectronStoreRef('obsPassword', '');

const saveStatus = ref('');
const isSaving = ref(false);
const isReconnecting = ref(false);
const isInstallingSyncMarker = ref(false);
const syncMarkerStatus = ref('');
const syncMarkerStatusIsError = ref(false);

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

async function installSyncMarker() {
	if (isInstallingSyncMarker.value) return;
	isInstallingSyncMarker.value = true;
	syncMarkerStatus.value = '';
	syncMarkerStatusIsError.value = false;
	try {
		const response = await ipc.invoke(IPC_EVENTS.REVIEW_SYNC_OVERLAY_INSTALL);
		syncMarkerStatus.value = t('obs.sync_marker_ready', { scene: response.sceneName });
	} catch (error) {
		syncMarkerStatusIsError.value = true;
		syncMarkerStatus.value = error instanceof Error
			? error.message
			: t('obs.sync_marker_failed');
	} finally {
		isInstallingSyncMarker.value = false;
	}
}
</script>

<template>
	<TabContent>
		<div class="max-w-3xl">
			<div class="mb-2">
				<p class="text-base font-semibold">{{ $t('obs.title') }}</p>
				<p class="text-xs opacity-75">{{ $t('obs.description') }}</p>
				<div class="mt-1 text-xs opacity-75">
					<p class="font-medium opacity-90">{{ $t('obs.instructions_title') }}</p>
					<ul class="list-disc ml-4 space-y-0">
						<li>{{ $t('obs.instructions_step_1') }}</li>
						<li>{{ $t('obs.instructions_step_2') }}</li>
						<li>{{ $t('obs.instructions_step_3') }}</li>
					</ul>
				</div>
			</div>

			<Checkbox :label="$t('obs.enabled')" v-model="obsEnabled" />

			<div class="mt-2">
				<label class="text-sm opacity-80 block mb-1">{{ $t('obs.port') }}</label>
				<input
					type="number"
					min="1"
					max="65535"
					v-model.number="obsPort"
					class="w-full rounded-md border border-slate-300 bg-light4 p-2 text-slate-900 shadow-sm transition-all ease-in hover:border-slate-400 hover:bg-slate-50 focus:border-sky-500 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 dark:border-transparent dark:bg-dark4 dark:text-white dark:shadow-none dark:hover:bg-dark4/80"
				/>
			</div>

			<div class="mt-2">
				<label class="text-sm opacity-80 block mb-1">{{ $t('obs.password') }}</label>
				<input
					type="password"
					v-model="obsPassword"
					:placeholder="$t('obs.password_placeholder')"
					class="w-full rounded-md border border-slate-300 bg-light4 p-2 text-slate-900 shadow-sm transition-all ease-in placeholder:text-slate-500 hover:border-slate-400 hover:bg-slate-50 focus:border-sky-500 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 dark:border-transparent dark:bg-dark4 dark:text-white dark:shadow-none dark:placeholder:text-neutral-400 dark:hover:bg-dark4/80"
				/>
			</div>

			<div class="flex gap-2 flex-wrap mt-3">
				<UIButton :label="$t('obs.apply_settings')" :disabled="isSaving" @click="applySettings" />
				<UIButton :label="$t('obs.reconnect')" :disabled="isReconnecting || !obsEnabled" @click="forceReconnect" />
				<UIButton
					:label="$t('obs.install_sync_marker')"
					:disabled="isInstallingSyncMarker || !obsStatus.connected"
					@click="installSyncMarker"
				/>
			</div>

			<p v-if="saveStatus" class="text-xs mt-1 opacity-80">{{ $t(saveStatus) }}</p>
			<p
				v-if="syncMarkerStatus"
				class="text-xs mt-1"
				:class="syncMarkerStatusIsError ? 'text-red-700 dark:text-red-400' : 'text-teal-700 dark:text-teal-300'"
			>{{ syncMarkerStatus }}</p>

			<div class="mt-4 border border-gray-500/30 rounded-lg p-3 dark:bg-dark3 bg-light3">
				<div class="flex flex-wrap items-center gap-2 text-xs mb-2">
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
				<p class="text-xs opacity-80 break-words mt-0.5"><span class="opacity-60">{{ $t('obs.server') }}:</span> {{ obsStatus.server || '-' }}</p>
				<p class="text-xs opacity-80 break-words mt-0.5"><span class="opacity-60">{{ $t('obs.last_update') }}:</span> {{ statusUpdatedAtLabel }}</p>
				<p v-if="obsStatus.lastError" class="mt-1 break-words text-xs text-red-700 dark:text-red-400">{{ obsStatus.lastError }}</p>
			</div>
		</div>
	</TabContent>
</template>

<style scoped>
</style>
