import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentChat } from '../AgentChat';
import { Button } from '../ui/button';

export interface TopicFilter {
    name: string;
    definition: any;
}

export interface TimelineChatButtonProps {
    onFilterChange?: (filter: TopicFilter | null) => void;
}

export function TimelineChatButton({ onFilterChange }: TimelineChatButtonProps) {
    const { t } = useTranslation();
    const [chatOpen, setChatOpen] = useState(false);

    const handleTopicChat = async (msg: string) => {
        if (!window.ipcRenderer) return;
        return window.ipcRenderer.invoke('topic:discover', msg);
    };

    return (
        <>
            <div className="fixed bottom-8 right-8 z-50">
                <Button
                    className={`rounded-full w-14 h-14 shadow-xl transition-all ${chatOpen ? 'bg-zinc-800' : 'bg-indigo-600 hover:bg-indigo-500'}`}
                    onClick={() => setChatOpen(!chatOpen)}
                >
                    <MessageCircle size={24} className={chatOpen ? 'text-zinc-400' : 'text-white'} />
                </Button>
            </div>

            {chatOpen && (
                <AgentChat
                    agentId="topic"
                    title={t('topic.agent_title', 'Topic Assistant')}
                    initialMessage={t('topic.agent_welcome', 'Hi! I can help you create a custom timeline topic. Try saying "Show me my ShuTong development work".')}
                    onSendMessage={handleTopicChat}
                    onClose={() => setChatOpen(false)}
                    onFilterChange={onFilterChange}
                />
            )}
        </>
    );
}
