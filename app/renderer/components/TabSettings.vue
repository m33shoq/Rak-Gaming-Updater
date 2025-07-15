<script setup lang="ts">
import log from 'electron-log/renderer';

import { watch } from 'vue';

import TabContent from '@/renderer/components/TabContent.vue';
import Checkbox from '@/renderer/components/Checkbox.vue';
import Dropdown from '@/renderer/components/Dropdown.vue';
import UIButton from '@/renderer/components/Button.vue';

import { getElectronStoreRef } from '@/renderer/store/ElectronRefStore';

import { useI18n } from 'vue-i18n'
const { locale } = useI18n()

watch(locale, (newLocale) => {
	log.info('Locale changed to:', newLocale);
	api.store.set('locale', newLocale);
});

const localeOptions = [
	{ value: 'en', label: 'English (en)' },
	{ value: 'ru', label: 'Русский (ru)' },
	{ value: 'uk', label: 'Українська (uk)' },
	{ value: 'ko', label: '한국어 (ko)' },
]

const startWithWindows = getElectronStoreRef('startWithWindows', false);
const startMinimized = getElectronStoreRef('startMinimized', false);
const quitOnClose = getElectronStoreRef('quitOnClose', false);
const darkMode = getElectronStoreRef('darkMode', true);

function openLogsFolder() {
	api.IR_OpenLogsFolder();
}

</script>

<template>
	<TabContent>
		<Checkbox :label="$t('settings.darkmode')" v-model="darkMode" />
		<Checkbox :label="$t('settings.winstartup')" v-model="startWithWindows" />
		<Checkbox :label="$t('settings.winminimized')" v-model="startMinimized" />
		<Checkbox :label="$t('settings.exitonclose')" v-model="quitOnClose" />
		<Dropdown :label="$t('settings.language')" v-model="locale" :options="localeOptions" />
		<UIButton :label="$t('settings.openlogs')" @click="openLogsFolder" class="absolute bottom-20"/>
	</TabContent>
</template>

<style scoped>

</style>
