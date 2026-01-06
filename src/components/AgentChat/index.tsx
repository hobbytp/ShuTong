import { Loader2, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSystemStore } from '../../stores/systemStore';
import { Button } from '../ui/button';

export interface AgentResponse {
    message?: string;
    response?: string;
    [key: string]: any;
}

export interface AgentChatProps {
    agentId: string;
    onSendMessage: (msg: string) => Promise<string | AgentResponse>;
    initialMessage?: string;
    title?: string;
    onClose?: () => void;
    onFilterChange?: (filter: { name: string; definition: any } | null) => void;
}

export function AgentChat({ onSendMessage, initialMessage, title, onClose, onFilterChange }: AgentChatProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>(
        initialMessage ? [{ role: 'assistant', content: initialMessage }] : []
    );
    const [loading, setLoading] = useState(false);

    // System readiness check
    const status = useSystemStore((state) => state.status);
    const isSystemReady = status === 'READY';

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const response = await onSendMessage(userMsg);
            // Handle different response formats
            const content = typeof response === 'string' ? response : response.message || response.response || JSON.stringify(response);

            // Check for active_filter in response
            if (typeof response === 'object' && response.active_filter && onFilterChange) {
                onFilterChange(response.active_filter);
            }

            setMessages(prev => [...prev, { role: 'assistant', content }]);
        } catch (err: any) {
            console.error('Chat failed:', err);
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed bottom-4 right-4 w-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col max-h-[600px]">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
                <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                    <MessageCircle size={16} className="text-indigo-400" />
                    {title || t('agent.chat_title', 'Agent Chat')}
                </h3>
                {onClose && (
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">×</button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px]">
                {messages.length === 0 && (
                    <p className="text-sm text-zinc-500 text-center mt-8">{t('agent.start_conversation', 'Start a conversation...')}</p>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`inline-block max-w-[85%] p-3 rounded-lg ${msg.role === 'user'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-800 text-zinc-200'
                            }`}>
                            <div className="prose prose-invert prose-sm max-w-none break-words">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.content}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex items-center gap-2 text-zinc-500">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-sm">{t('agent.thinking', 'Thinking...')}</span>
                    </div>
                )}
            </div>

            <div className="p-3 border-t border-zinc-800 bg-zinc-900">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && isSystemReady && handleSend()}
                        placeholder={isSystemReady ? t('agent.placeholder', 'Type a message...') : t('agent.initializing', 'Initializing Neural Engine...')}
                        className={`flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${!isSystemReady ? 'cursor-wait opacity-50' : ''}`}
                        disabled={!isSystemReady}
                        autoFocus={isSystemReady}
                    />
                    <Button size="sm" onClick={handleSend} disabled={loading || !isSystemReady}>
                        {t('agent.send', 'Send')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
