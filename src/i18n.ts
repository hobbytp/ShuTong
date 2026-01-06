import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Bundle locales to avoid 'file://' fetch issues in production Electron
// Note: Vite warns about public directory imports, but this is intentional for bundling
const localeModules = import.meta.glob('../public/locales/**/*.json', { eager: true });

const resources: Record<string, any> = {};

for (const path in localeModules) {
    // Correct regex to account for windows/unix paths and ensure we capture lang/ns
    const match = path.match(/locales\/([^/]+)\/([^/]+)\.json$/);
    if (match) {
        const [_, lng, ns] = match;
        resources[lng] = resources[lng] || {};
        // @ts-ignore - import.meta.glob types can be tricky
        resources[lng][ns] = localeModules[path].default || localeModules[path];
    }
}

i18n
    // .use(Backend) // Disable HTTP backend
    .use(initReactI18next)
    .init({
        resources, // Use bundled resources
        fallbackLng: 'en',
        debug: import.meta.env.DEV,

        interpolation: {
            escapeValue: false,
        },
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
