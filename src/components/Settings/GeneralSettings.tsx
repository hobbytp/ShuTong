import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label, Section } from './Shared';

export function GeneralSettings() {
    const { t, i18n } = useTranslation();
    const [theme, setTheme] = useState('dark');
    const [autoLaunch, setAutoLaunch] = useState(false);

    useEffect(() => {
        // Load initial settings if needed
    }, []);

    const handleThemeChange = (t: string) => {
        setTheme(t);
        // Implement theme persistence
    };

    const changeLanguage = async (lng: string) => {
        await i18n.changeLanguage(lng);
        try {
            const { invoke } = await import('../../lib/ipc');
            await invoke('change-language', lng);
        } catch (err) {
            console.error('Failed to save language setting', err);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <Section title={t('settings.general', 'General')}>
                <div>
                    <Label>{t('settings.language', 'Language')}</Label>
                    <select
                        value={i18n.language}
                        onChange={(e) => changeLanguage(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border text-sm font-medium bg-zinc-950 border-zinc-800 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    >
                        <option value="en">English</option>
                        <option value="zh">中文 (Chinese)</option>
                    </select>
                </div>
            </Section>

            <Section title={t('settings.appearance', 'Appearance')}>
                <div>
                    <Label>{t('settings.theme_preference', 'Theme Preference')}</Label>
                    <div className="grid grid-cols-3 gap-3">
                        {['light', 'dark', 'system'].map((themeOption) => (
                            <button
                                key={themeOption}
                                onClick={() => handleThemeChange(themeOption)}
                                className={`
                                    px-4 py-3 rounded-lg border text-sm font-medium capitalize transition-all
                                    ${theme === themeOption
                                        ? 'bg-zinc-800 border-indigo-500/50 text-white shadow-sm ring-1 ring-indigo-500/20'
                                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}
                                `}
                            >
                                {themeOption}
                            </button>
                        ))}
                    </div>
                </div>
            </Section>

            <Section title={t('settings.system', 'System')}>
                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div>
                        <div className="text-zinc-200 font-medium text-sm">{t('settings.launch_at_startup', 'Launch at Startup')}</div>
                        <div className="text-zinc-500 text-xs">{t('settings.launch_desc', 'Automatically open ShuTong when you log in')}</div>
                    </div>

                    <button
                        onClick={() => setAutoLaunch(!autoLaunch)}
                        className={`
                            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                            ${autoLaunch ? 'bg-indigo-500' : 'bg-zinc-700'}
                        `}
                    >
                        <span className={`
                            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                            ${autoLaunch ? 'translate-x-6' : 'translate-x-1'}
                        `} />
                    </button>
                </div>
            </Section>

            <Section title={t('settings.about', 'About')}>
                <div className="text-sm text-zinc-400">
                    <p>{t('app.title', 'ShuTong')}</p>
                    <p>Version 0.1.0-alpha</p>
                    <p className="mt-2 text-xs text-zinc-600">Built with React, Electron, and Local AI.</p>
                </div>
            </Section>
        </div>
    );
}
