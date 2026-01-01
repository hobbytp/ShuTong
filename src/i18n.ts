import i18n from 'i18next';
import Backend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

i18n
    .use(Backend)
    .use(initReactI18next)
    .init({
        fallbackLng: 'en',
        debug: import.meta.env.DEV,

        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },

        backend: {
            loadPath: '/locales/{{lng}}/{{ns}}.json',
        }
    });

// Sync initial language from Main process (after i18n is ready)
if (typeof window !== 'undefined' && window.ipcRenderer) {
    window.ipcRenderer.invoke('get-language').then((savedLang: string) => {
        if (savedLang && savedLang !== i18n.language) {
            i18n.changeLanguage(savedLang);
        }
    }).catch((err: unknown) => {
        console.warn('[i18n] Failed to sync initial language:', err);
    });
}

export default i18n;
