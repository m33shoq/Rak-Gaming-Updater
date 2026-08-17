console.log('Renderer process started');
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import log from 'electron-log/renderer';

import { installWowheadTooltipEnhancements } from '@/renderer/utils/wowheadTooltips';

import "tailwindcss";

const isTimelineWindow = new URLSearchParams(window.location.search).get('window') === 'timeline';
const RootComponent = isTimelineWindow
	? (await import('@/renderer/TimelineWindowApp.vue')).default
	: (await import('@/renderer/App.vue')).default;
const app = createApp(RootComponent);

installWowheadTooltipEnhancements();

import en from '@/translations/en.json';
import ru from '@/translations/ru.json';
import ko from '@/translations/ko.json';
import uk from '@/translations/uk.json';
import { IPC_EVENTS } from '@/events';


const selectedAppLang = await ipc.invoke(IPC_EVENTS.APP_GET_LANGUAGE);
const i18n = createI18n({
	locale: selectedAppLang,
	fallbackLocale: 'en',
	messages: {
		en,
		ru,
		ko,
		uk,
	}
})

app.use(i18n);
app.use(createPinia());
app.mount('#app')

log.info(isTimelineWindow ? 'Timeline renderer process initialized' : 'Renderer process initialized');
console.log('Renderer process initialized');
