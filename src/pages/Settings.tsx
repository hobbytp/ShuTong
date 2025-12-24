import { useState } from 'react';
import { LLMSettings } from '../components/Settings/LLMSettings';
import { Sidebar } from '../components/Settings/Sidebar';

import { GeneralSettings } from '../components/Settings/GeneralSettings';
import { MCPSettings } from '../components/Settings/MCPSettings';
import { RecordingSettings } from '../components/Settings/RecordingSettings';
import { StorageSettings } from '../components/Settings/StorageSettings';

export function Settings({ onBack }: { onBack: () => void }) {
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
                <div className="max-w-4xl mx-auto p-8 md:p-12">
                    <header className="mb-8">
                        <h1 className="text-3xl font-bold tracking-tight text-white mb-2 capitalize">
                            {activeTab === 'llm' ? 'AI Models & Providers' : activeTab + ' Settings'}
                        </h1>
                        <p className="text-zinc-400 text-sm">
                            Manage your application preferences and configurations.
                        </p>
                    </header>

                    <div className="space-y-6">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
}
