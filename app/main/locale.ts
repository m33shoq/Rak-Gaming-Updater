import { app } from 'electron';
import log from 'electron-log/main';
import path from 'path';

const locales = ['en', 'ru', 'ko', 'uk'];

import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set the locale based on the user's system locale
const preferredLanguages: string[] = app.getPreferredSystemLanguages();
let selectedLanguage: string = 'en';

console.log('preferredLanguages', preferredLanguages);
console.log('availableLanguages', locales);

for (const lang of preferredLanguages) {
	const processedLang = lang.split('-')[0];
	if (locales.includes(processedLang)) {
		selectedLanguage = processedLang;
		break;
	}
}

import en from '@/translations/en.json';
import ru from '@/translations/ru.json';
import ko from '@/translations/ko.json';
import uk from '@/translations/uk.json';

class Locale {
	constructor(locale: string) {
		log.info('Selected language:', locale);
		this.selectedLocale = locale;

		// we're in dist\main.js
		// ->       dist\en.json

		if (locale === 'en') {
			this.translations = en;
		} else if (locale === 'ru') {
			this.translations = ru;
		} else if (locale === 'ko') {
			this.translations = ko;
		} else if (locale === 'uk') {
			this.translations = uk;
		} else {
			log.error(`Locale ${locale} not found, falling back to English`);
			this.translations = en;
		}

		this.L = new Proxy(this.translations, {
			get: (target, prop: string) => {
				if (prop in target) {
					return target[prop];
				}
				return prop;
			},
		});
	}

	public selectedLocale: string;
	public translations: Record<string, string> = {};
	public L: Record<string, string>;
}

const locale = new Locale(selectedLanguage);

export default locale;


