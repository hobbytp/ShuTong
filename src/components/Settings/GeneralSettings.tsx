
import { useEffect, useState } from 'react';
import { Label, Section } from './Shared';

export function GeneralSettings() {
    const [theme, setTheme] = useState('dark');
    const [autoLaunch, setAutoLaunch] = useState(false);

    useEffect(() => {
        // Load initial settings if needed
    }, []);

    const handleThemeChange = (t: string) => {
        setTheme(t);
        // Implement theme persistence
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <Section title="Appearance">
                <div>
                    <Label>Theme Preference</Label>
                    <div className="grid grid-cols-3 gap-3">
                        {['light', 'dark', 'system'].map((t) => (
                            <button
                                key={t}
                                onClick={() => handleThemeChange(t)}
                                className={`
                                    px-4 py-3 rounded-lg border text-sm font-medium capitalize transition-all
                                    ${theme === t
                                        ? 'bg-zinc-800 border-indigo-500/50 text-white shadow-sm ring-1 ring-indigo-500/20'
                                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}
                                `}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </Section>

            <Section title="System">
                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div>
                        <div className="text-zinc-200 font-medium text-sm">Launch at Startup</div>
                        <div className="text-zinc-500 text-xs">Automatically open ShuTong when you log in</div>
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

            <Section title="About">
                <div className="text-sm text-zinc-400">
                    <p>ShuTong</p>
                    <p>Version 0.1.0-alpha</p>
                    <p className="mt-2 text-xs text-zinc-600">Built with React, Electron, and Local AI.</p>
                </div>
            </Section>
        </div>
    );
}
