<script setup lang="ts">
import { watch } from 'vue';
import log from 'electron-log/renderer';
import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';

import { useI18n } from 'vue-i18n'
const { locale } = useI18n()

watch(locale, (newLocale) => {
	log.info('Locale changed to:', newLocale);
	api.store.set('locale', newLocale);
});

const startWithWindows = getElectronStoreRef('startWithWindows', false);
const startMinimized = getElectronStoreRef('startMinimized', false);
const quitOnClose = getElectronStoreRef('quitOnClose', false);

</script>

<template>
	<div class="tab-content">
		<Checkbox :label="$t('settings.winstartup')" v-model="startWithWindows" />
		<Checkbox :label="$t('settings.winminimized')" v-model="startMinimized" />
		<Checkbox :label="$t('settings.exitonclose')" v-model="quitOnClose" />
		<Dropdown :label="$t('settings.language')" v-model="locale" :options="[
			{ value: 'en', label: 'English' },
			{ value: 'ru', label: 'Русский' },
			{ value: 'uk', label: 'Українська' },
			{ value: 'ko', label: '한국어' },
		]" />
	</div>
</template>

<style scoped>

</style>
