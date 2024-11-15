const electron = require('electron');
const { I18n } = require('i18n');
const app = electron.app || electron.remote.app;

const i18n = new I18n({
	locales: ['en', 'ru', 'ko', 'uk'], // Add more locales as needed 'en', 'ru', 'ko', 'uk'
	directory: __dirname,
	defaultLocale: 'en',
	extension: '.json',
	updateFiles: false,
});

// Set the locale based on the user's system locale
const preferredLanguages = app.getPreferredSystemLanguages();
const availableLanguages = i18n.getLocales();
let selectedLanguage = 'en'; // Default to English

console.log('preferredLanguages', preferredLanguages);
console.log('availableLanguages', availableLanguages);
// Check if any of the preferred languages are available in your translations
for (const lang of preferredLanguages) {
	const processedLang = lang.split('-')[0];
	if (availableLanguages.includes(processedLang)) {
		selectedLanguage = processedLang;
		break;
	}
}

// Set the language in your i18n module
i18n.setLocale(selectedLanguage);

module.exports = i18n;
