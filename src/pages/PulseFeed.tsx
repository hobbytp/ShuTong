import { AlertCircle, ChevronRight, Lightbulb, Loader2, MessageCircle, Sparkles, Target, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentChat } from '../components/AgentChat';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

interface PulseCard {
    id: string;
    type: 'briefing' | 'action' | 'sprouting' | 'challenge' | 'research_proposal' | 'research_report' | 'learning_path';
    title: string;
    content: string;
    suggested_actions?: string[];
    created_at: number;
}

type ResearchMode = 'auto' | 'fast' | 'deep';

interface ResearchProposalContent {
    schema: 'pulse_research_proposal_v1';
    status: 'proposed' | 'dismissed' | 'running' | 'completed' | 'failed';
    question: string;
    evidence: string[];
    selected_mode?: ResearchMode;
    decided_mode?: 'fast' | 'deep';
    decision_reason?: string;
    started_at?: number;
    completed_at?: number;
    error?: string;
    deliverable_card_ids?: string[];
}

const CARD_ICONS: Record<string, any> = {
    'briefing': Sparkles,
    'action': Target,
    'sprouting': Lightbulb,
    'challenge': AlertCircle,
    'research_proposal': Lightbulb,
    'research_report': Sparkles,
    'learning_path': Target
};

const CARD_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
    'briefing': { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', icon: 'text-indigo-400' },
    'action': { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400' },
    'sprouting': { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400' },
    'challenge': { bg: 'bg-rose-500/10', border: 'border-rose-500/30', icon: 'text-rose-400' },
    'research_proposal': { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400' },
    'research_report': { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', icon: 'text-indigo-400' },
    'learning_path': { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400' }
};

function safeParseProposal(content: string): ResearchProposalContent | null {
    try {
        const parsed = JSON.parse(content) as ResearchProposalContent;
        if (parsed?.schema !== 'pulse_research_proposal_v1') return null;
        return parsed;
    } catch {
        return null;
    }
}

interface DeliverableContent {
    schema: 'pulse_research_deliverable_v1';
    save_status: 'pending_save' | 'saved' | 'discarded';
    body: string;
    citations: { title: string; url: string }[];
    uncertainty?: string[];
    budget_limited: boolean;
}

function safeParseDeliverable(content: string): DeliverableContent | null {
    try {
        const parsed = JSON.parse(content) as DeliverableContent;
        if (parsed?.schema !== 'pulse_research_deliverable_v1') return null;
        return parsed;
    } catch {
        return null;
    }
}

export function PulseFeed() {
    const { t } = useTranslation();
    const [cards, setCards] = useState<PulseCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);
    const [proposalGenerating, setProposalGenerating] = useState(false);
    const [proposalBusy, setProposalBusy] = useState<Record<string, boolean>>({});
    const [deliverableBusy, setDeliverableBusy] = useState<Record<string, boolean>>({});
    const [proposalMode, setProposalMode] = useState<Record<string, ResearchMode>>({});
    const [chatOpen, setChatOpen] = useState(false);

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

    const reloadCards = useCallback(async () => {
        if (!window.ipcRenderer) return;
        try {
            const result = await window.ipcRenderer.invoke('get-pulse-cards', 50);
            if (result.success) {
                const loadedCards = result.cards.map((c: any) => ({
                    ...c,
                    created_at: c.created_at * 1000
                }));
                setCards(loadedCards);
            }
        } catch (err) {
            console.error('Failed to reload cards:', err);
        }
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

    const generateProposal = useCallback(async () => {
        if (!window.ipcRenderer) return;
        setProposalGenerating(true);
        try {
            const result = await window.ipcRenderer.invoke('generate-research-proposal');
            if (result.success) {
                await reloadCards();
            }
        } catch (err) {
            console.error('Failed to generate proposal:', err);
        } finally {
            setProposalGenerating(false);
        }
    }, [reloadCards]);

    const dismissProposal = useCallback(async (cardId: string) => {
        if (!window.ipcRenderer) return;
        setProposalBusy(prev => ({ ...prev, [cardId]: true }));
        try {
            await window.ipcRenderer.invoke('dismiss-research-proposal', cardId);
            await reloadCards();
        } catch (err) {
            console.error('Failed to dismiss proposal:', err);
        } finally {
            setProposalBusy(prev => ({ ...prev, [cardId]: false }));
        }
    }, [reloadCards]);

    const startResearch = useCallback(async (cardId: string) => {
        if (!window.ipcRenderer) return;
        const mode = proposalMode[cardId] || 'auto';
        setProposalBusy(prev => ({ ...prev, [cardId]: true }));
        try {
            await window.ipcRenderer.invoke('start-research-from-proposal', { cardId, mode });
            await reloadCards();
        } catch (err) {
            console.error('Failed to start research:', err);
        } finally {
            setProposalBusy(prev => ({ ...prev, [cardId]: false }));
        }
    }, [proposalMode, reloadCards]);

    const saveDeliverable = useCallback(async (cardId: string) => {
        if (!window.ipcRenderer) return;
        setDeliverableBusy(prev => ({ ...prev, [cardId]: true }));
        try {
            await window.ipcRenderer.invoke('save-deliverable', cardId);
            await reloadCards();
        } catch (err) {
            console.error('Failed to save deliverable:', err);
        } finally {
            setDeliverableBusy(prev => ({ ...prev, [cardId]: false }));
        }
    }, [reloadCards]);

    const discardDeliverable = useCallback(async (cardId: string) => {
        if (!window.ipcRenderer) return;
        setDeliverableBusy(prev => ({ ...prev, [cardId]: true }));
        try {
            await window.ipcRenderer.invoke('discard-deliverable', cardId);
            await reloadCards();
        } catch (err) {
            console.error('Failed to discard deliverable:', err);
        } finally {
            setDeliverableBusy(prev => ({ ...prev, [cardId]: false }));
        }
    }, [reloadCards]);

    const handlePulseChat = useCallback(async (msg: string) => {
        if (!window.ipcRenderer) return;
        const result = await window.ipcRenderer.invoke('ask-pulse', msg);
        if (result.success) {
            return result.response;
        }
    }, []);

    return (
        <div className="p-8 max-w-4xl mx-auto min-h-screen text-zinc-50">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                        <Sparkles size={22} className="text-indigo-400" />
                        {t('pulse.title', 'Pulse')}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">{t('pulse.subtitle', 'AI-powered insights from your activity.')}</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={generateProposal}
                        disabled={proposalGenerating}
                        className={proposalGenerating ? 'opacity-80' : ''}
                    >
                        {proposalGenerating ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Zap size={16} className="mr-2" />}
                        {t('pulse.research_proposal', 'Research Proposal')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setChatOpen(!chatOpen)}
                        className={chatOpen ? 'bg-indigo-600 text-white' : ''}
                    >
                        <MessageCircle size={16} className="mr-2" />
                        {t('pulse.ask_pulse', 'Ask Pulse')}
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
                                {type === 'briefing' && t('pulse.briefing_desc', 'Daily summary')}
                                {type === 'action' && t('pulse.action_desc', 'Todo items')}
                                {type === 'sprouting' && t('pulse.sprouting_desc', 'Connect ideas')}
                                {type === 'challenge' && t('pulse.challenge_desc', 'Improve focus')}
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
                        <p className="text-zinc-500">{t('pulse.no_insights', 'No insights yet. Generate a card above to get started.')}</p>
                    </Card>
                )}

                {cards.map(card => {
                    const Icon = CARD_ICONS[card.type];
                    const colors = CARD_COLORS[card.type];
                    const proposal = card.type === 'research_proposal' ? safeParseProposal(card.content) : null;
                    const isProposal = card.type === 'research_proposal' && proposal;
                    const busy = Boolean(proposalBusy[card.id]);
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
                                            {isProposal && (
                                                <span className="text-xs text-zinc-500">
                                                    {proposal.status}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-semibold text-zinc-100 mb-2">{card.title}</h3>

                                        {isProposal ? (
                                            <div className="space-y-3">
                                                <p className="text-sm text-zinc-300 whitespace-pre-wrap">{proposal.question}</p>

                                                {proposal.evidence && proposal.evidence.length > 0 && (
                                                    <div className="space-y-1">
                                                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Evidence</p>
                                                        {proposal.evidence.map((ev, i) => (
                                                            <div key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                                                                <ChevronRight size={14} className={`${colors.icon} mt-0.5`} />
                                                                <span className="whitespace-pre-wrap">{ev}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {proposal.decision_reason && (
                                                    <p className="text-xs text-zinc-500 whitespace-pre-wrap">{proposal.decision_reason}</p>
                                                )}

                                                {proposal.status === 'proposed' && (
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <select
                                                            value={proposalMode[card.id] || 'auto'}
                                                            onChange={(e) => setProposalMode(prev => ({ ...prev, [card.id]: e.target.value as ResearchMode }))}
                                                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                            disabled={busy}
                                                        >
                                                            <option value="auto">{t('pulse.auto', 'Auto')}</option>
                                                            <option value="fast">{t('pulse.fast', 'Fast')}</option>
                                                            <option value="deep">{t('pulse.deep', 'Deep')}</option>
                                                        </select>

                                                        <Button size="sm" onClick={() => startResearch(card.id)} disabled={busy}>
                                                            {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                                                            {t('pulse.start', 'Start')}
                                                        </Button>

                                                        <Button variant="outline" size="sm" onClick={() => dismissProposal(card.id)} disabled={busy}>
                                                            {t('pulse.dismiss', 'Dismiss')}
                                                        </Button>
                                                    </div>
                                                )}

                                                {proposal.status === 'running' && (
                                                    <div className="flex items-center gap-2 text-sm text-amber-300">
                                                        <Loader2 size={14} className="animate-spin" />
                                                        {t('pulse.running_research', 'Running research...')}
                                                    </div>
                                                )}

                                                {proposal.status === 'failed' && proposal.error && (
                                                    <p className="text-sm text-rose-300 whitespace-pre-wrap">{proposal.error}</p>
                                                )}
                                            </div>
                                        ) : (card.type === 'research_report' || card.type === 'learning_path') ? (() => {
                                            const deliverable = safeParseDeliverable(card.content);
                                            const dBusy = Boolean(deliverableBusy[card.id]);
                                            if (!deliverable) {
                                                return <p className="text-sm text-zinc-400 whitespace-pre-wrap">{card.content}</p>;
                                            }
                                            return (
                                                <div className="space-y-3">
                                                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{deliverable.body}</p>

                                                    {deliverable.uncertainty && deliverable.uncertainty.length > 0 && (
                                                        <div className="space-y-1">
                                                            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Uncertainty</p>
                                                            {deliverable.uncertainty.map((u, i) => (
                                                                <div key={i} className="flex items-start gap-2 text-sm text-amber-300">
                                                                    <AlertCircle size={14} className="mt-0.5" />
                                                                    <span className="whitespace-pre-wrap">{u}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {deliverable.budget_limited && (
                                                        <p className="text-xs text-amber-400">{t('pulse.budget_limited_note', 'Note: This result was budget-limited.')}</p>
                                                    )}

                                                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                        <span className="uppercase tracking-wider">{t('pulse.status', 'Status')}:</span>
                                                        <span className={deliverable.save_status === 'saved' ? 'text-emerald-400' : deliverable.save_status === 'discarded' ? 'text-rose-400' : 'text-amber-400'}>
                                                            {deliverable.save_status === 'pending_save' ? t('pulse.pending_save', 'Pending Save') : deliverable.save_status === 'saved' ? t('pulse.saved', 'Saved') : t('pulse.discarded', 'Discarded')}
                                                        </span>
                                                    </div>

                                                    {deliverable.save_status === 'pending_save' && (
                                                        <div className="flex items-center gap-3 pt-2">
                                                            <Button size="sm" onClick={() => saveDeliverable(card.id)} disabled={dBusy}>
                                                                {dBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                                                                {t('pulse.save', 'Save')}
                                                            </Button>
                                                            <Button variant="outline" size="sm" onClick={() => discardDeliverable(card.id)} disabled={dBusy}>
                                                                {t('pulse.discard', 'Discard')}
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : (
                                            <p className="text-sm text-zinc-400 whitespace-pre-wrap">{card.content}</p>
                                        )}

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
                <AgentChat
                    agentId="pulse"
                    title={t('pulse.ask_pulse', 'Ask Pulse')}
                    onSendMessage={handlePulseChat}
                    onClose={() => setChatOpen(false)}
                />
            )}
        </div>
    );
}
