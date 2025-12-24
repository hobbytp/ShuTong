import { AlertCircle, ChevronRight, Lightbulb, Loader2, MessageCircle, Sparkles, Target, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

interface PulseCard {
    id: string;
    type: 'briefing' | 'action' | 'sprouting' | 'challenge';
    title: string;
    content: string;
    suggested_actions?: string[];
    created_at: number;
}

const CARD_ICONS: Record<string, any> = {
    'briefing': Sparkles,
    'action': Target,
    'sprouting': Lightbulb,
    'challenge': AlertCircle
};

const CARD_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
    'briefing': { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', icon: 'text-indigo-400' },
    'action': { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400' },
    'sprouting': { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400' },
    'challenge': { bg: 'bg-rose-500/10', border: 'border-rose-500/30', icon: 'text-rose-400' }
};

export function PulseFeed() {
    const [cards, setCards] = useState<PulseCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
    const [chatLoading, setChatLoading] = useState(false);

    useEffect(() => {
        const loadCards = async () => {
            if (!window.ipcRenderer) return;
            try {
                const result = await window.ipcRenderer.invoke('get-pulse-cards', 50);
                if (result.success) {
                    const loadedCards = result.cards.map((c: any) => ({
                        ...c,
                        created_at: c.created_at * 1000 // Convert Unix seconds to ms
                    }));
                    setCards(loadedCards);
                }
            } catch (err) {
                console.error('Failed to load history:', err);
            } finally {
                setLoading(false);
            }
        };
        loadCards();
    }, []);

    const generateCard = useCallback(async (type: 'briefing' | 'action' | 'sprouting' | 'challenge') => {
        if (!window.ipcRenderer) return;
        setGenerating(type);
        try {
            const result = await window.ipcRenderer.invoke('generate-pulse-card', type);
            if (result.success && result.card) {
                const newCard: PulseCard = {
                    id: `${type}-${Date.now()}`,
                    type,
                    title: result.card.title,
                    content: result.card.content,
                    suggested_actions: result.card.suggested_actions,
                    created_at: Date.now()
                };
                setCards(prev => [newCard, ...prev]);
            }
        } catch (err) {
            console.error('Failed to generate card:', err);
        } finally {
            setGenerating(null);
        }
    }, []);

    const sendChatMessage = useCallback(async () => {
        if (!chatInput.trim() || !window.ipcRenderer) return;

        const userMessage = chatInput.trim();
        setChatInput('');
        setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setChatLoading(true);

        try {
            const result = await window.ipcRenderer.invoke('ask-pulse', userMessage);
            if (result.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: result.response }]);
            }
        } catch (err) {
            console.error('Chat failed:', err);
        } finally {
            setChatLoading(false);
        }
    }, [chatInput]);

    return (
        <div className="p-8 max-w-4xl mx-auto min-h-screen text-zinc-50">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <Sparkles className="text-indigo-400" />
                        Pulse
                    </h1>
                    <p className="text-zinc-400 mt-1">AI-powered insights from your activity.</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setChatOpen(!chatOpen)}
                        className={chatOpen ? 'bg-indigo-600 text-white' : ''}
                    >
                        <MessageCircle size={16} className="mr-2" />
                        Ask Pulse
                    </Button>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                {(['briefing', 'action', 'sprouting', 'challenge'] as const).map(type => {
                    const Icon = CARD_ICONS[type];
                    const colors = CARD_COLORS[type];
                    const isGenerating = generating === type;
                    return (
                        <button
                            key={type}
                            onClick={() => generateCard(type)}
                            disabled={!!generating}
                            className={`p-4 rounded-xl border ${colors.border} ${colors.bg} hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                {isGenerating ? (
                                    <Loader2 size={18} className={`${colors.icon} animate-spin`} />
                                ) : (
                                    <Icon size={18} className={colors.icon} />
                                )}
                                <span className="text-sm font-medium text-zinc-200 capitalize">{type}</span>
                            </div>
                            <p className="text-xs text-zinc-500 text-left">
                                {type === 'briefing' && 'Daily summary'}
                                {type === 'action' && 'Todo items'}
                                {type === 'sprouting' && 'Connect ideas'}
                                {type === 'challenge' && 'Improve focus'}
                            </p>
                        </button>
                    );
                })}
            </div>

            {/* Cards Feed */}
            <div className="space-y-4">
                {cards.length === 0 && !loading && (
                    <Card className="bg-zinc-900/50 border-zinc-800 p-12 text-center">
                        <Zap className="mx-auto mb-4 text-zinc-600" size={32} />
                        <p className="text-zinc-500">No insights yet. Generate a card above to get started.</p>
                    </Card>
                )}

                {cards.map(card => {
                    const Icon = CARD_ICONS[card.type];
                    const colors = CARD_COLORS[card.type];
                    return (
                        <Card key={card.id} className={`border ${colors.border} ${colors.bg} overflow-hidden`}>
                            <div className="p-6">
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-xl ${colors.bg} border ${colors.border}`}>
                                        <Icon size={24} className={colors.icon} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`text-xs font-bold uppercase tracking-wider ${colors.icon}`}>
                                                {card.type}
                                            </span>
                                            <span className="text-xs text-zinc-600">
                                                {new Date(card.created_at).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-semibold text-zinc-100 mb-2">{card.title}</h3>
                                        <p className="text-sm text-zinc-400 whitespace-pre-wrap">{card.content}</p>

                                        {card.suggested_actions && card.suggested_actions.length > 0 && (
                                            <div className="mt-4 space-y-2">
                                                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Suggested Actions</p>
                                                {card.suggested_actions.map((action, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-sm text-zinc-300">
                                                        <ChevronRight size={14} className={colors.icon} />
                                                        {action}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Chat Panel */}
            {chatOpen && (
                <div className="fixed bottom-4 right-4 w-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                        <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                            <MessageCircle size={16} className="text-indigo-400" />
                            Ask Pulse
                        </h3>
                        <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
                    </div>

                    <div className="h-64 overflow-y-auto p-4 space-y-3">
                        {chatMessages.length === 0 && (
                            <p className="text-sm text-zinc-500 text-center mt-8">Ask anything about your activities...</p>
                        )}
                        {chatMessages.map((msg, i) => (
                            <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right' : ''}`}>
                                <div className={`inline-block max-w-[80%] p-3 rounded-lg ${msg.role === 'user'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-zinc-800 text-zinc-200'
                                    }`}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {chatLoading && (
                            <div className="flex items-center gap-2 text-zinc-500">
                                <Loader2 size={14} className="animate-spin" />
                                <span className="text-sm">Thinking...</span>
                            </div>
                        )}
                    </div>

                    <div className="p-3 border-t border-zinc-800">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                                placeholder="Ask a question..."
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                            <Button size="sm" onClick={sendChatMessage} disabled={chatLoading}>
                                Send
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
