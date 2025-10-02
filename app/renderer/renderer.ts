console.log('Renderer process started');
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import App from '@/renderer/App.vue';

import "tailwindcss";

const app = createApp(App);

import en from '@/translations/en.json';
import ru from '@/translations/ru.json';
import ko from '@/translations/ko.json';
import uk from '@/translations/uk.json';


const i18n = createI18n({
	locale: await api.getLanguage(),
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

console.log('Renderer process initialized');
