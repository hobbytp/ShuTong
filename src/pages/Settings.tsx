import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LLMSettings } from '../components/Settings/LLMSettings';
import { Sidebar } from '../components/Settings/Sidebar';

import { GeneralSettings } from '../components/Settings/GeneralSettings';
import { MCPSettings } from '../components/Settings/MCPSettings';
import { RecordingSettings } from '../components/Settings/RecordingSettings';
import { StorageSettings } from '../components/Settings/StorageSettings';

export function Settings({ onBack }: { onBack: () => void }) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('llm'); // specific default could be passed in props

    const renderContent = () => {
        switch (activeTab) {
            case 'general': return <GeneralSettings />;
            case 'recording': return <RecordingSettings />;
            case 'llm': return <LLMSettings />;
            case 'mcp': return <MCPSettings />;
            case 'storage': return <StorageSettings />;
            default: return <GeneralSettings />;
        }
    };

    return (
        <div className="flex h-full w-full bg-zinc-950 text-zinc-50 overflow-hidden font-sans">
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} onBack={onBack} />
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="max-w-4xl mx-auto p-6 md:p-8">
                    <header className="mb-6">
                        <h1 className="text-2xl font-bold tracking-tight text-white mb-1 capitalize">
                            {activeTab === 'llm' ? t('settings.ai_models_providers', 'AI Models & Providers') : t(`settings.${activeTab}`, activeTab) + ' ' + t('settings.title', 'Settings')}
                        </h1>
                        <p className="text-zinc-400 text-xs">
                            {t('settings.manage_prefs', 'Manage your application preferences and configurations.')}
                        </p>
                    </header>

                    <div className="space-y-5">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
}
