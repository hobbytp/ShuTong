import { useEffect, useRef, useState } from 'react';
import { Sprout, Sparkles, ChevronLeft, MessageSquare, LayoutGrid } from 'lucide-react';
import { Button } from '../../components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { send, on, invoke } from '../../lib/ipc';
import { useTranslation } from 'react-i18next';
import { useSproutStore } from './store';
import { BonsaiViz } from './components/BonsaiViz';
import { AnimatePresence, motion } from 'framer-motion';

export function SproutView() {
    const { t, i18n } = useTranslation();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showChat, setShowChat] = useState(false);

    // Zustand Store
    const {
        seed, setSeed,
        maxRounds, setMaxRounds,
        expansionLevel, setExpansionLevel,
        messages, addMessage,
        experts, setExperts,
        status, setStatus,
        errorMsg, setErrorMsg,
        activeSpeaker, setActiveSpeaker,
        threadId,
        report, setReport,
        activeSproutId, setMessages
    } = useSproutStore();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (showChat) scrollToBottom();
    }, [messages, showChat]);

    // Listen for updates via IPC (using the threadId)
    useEffect(() => {
        if (!threadId) return;

        // Channel name: sprout:update:THREAD_ID
        const channel = `sprout:update:${threadId}`;
        console.log(`[SproutView] Listening on ${channel}`);

        const unsubscribe = on(channel, (_event: unknown, payload: any) => {
            // Handle different update types based on chunk structure
            const defaultHandler = () => {
                // Fallback for raw chunks if any
                if (payload && typeof payload === 'object') {
                    // Check for active speaker
                    if (payload.next_speaker) {
                        setActiveSpeaker(payload.next_speaker);
                    }
                }
            };

            if (payload.type === 'message') {
                addMessage(payload.data);
                // Also update active speaker based on who sent it
                if (payload.data.role !== 'user') {
                    setActiveSpeaker(payload.data.name || 'Assistant');
                }
            } else if (payload.type === 'report') {
                setReport(payload.data);
                setStatus('done');
                setActiveSpeaker(null);
            } else if (payload.type === 'status') {
                if (payload.data === 'completed') {
                    setStatus('done');
                    setActiveSpeaker(null);
                }
            } else if (payload.error) {
                setErrorMsg(payload.error);
                setStatus('error');
            } else {
                defaultHandler();
            }
        });

        const unsubComplete = on(`sprout:complete:${threadId}`, () => {
            setStatus('done');
            setActiveSpeaker(null);
        });

        const unsubError = on(`sprout:error:${threadId}`, (_e: unknown, data: any) => {
            setErrorMsg(data.error);
            setStatus('error');
        });

        return () => {
            unsubscribe?.();
            unsubComplete?.();
            unsubError?.();
        };
    }, [threadId]);

    const handleStart = async () => {
        if (!seed.trim()) return;

        setStatus('running');
        setErrorMsg(null);
        setMessages([]);
        setExperts([]);
        setReport(null);
        setActiveSpeaker('Supervisor');

        // We use 'send' not 'invoke' for streaming start
        send('sprout:start', {
            seed,
            config: {
                max_rounds: maxRounds,
                expansion_level: expansionLevel,
                language: i18n.language // Pass current language
            }
        });
    };

    // Listen for creation event to bind threadId to new session
    useEffect(() => {
        const unsub = on('sprout:created', (_, data: any) => {
            if (activeSproutId === 'new') {
                useSproutStore.setState({
                    threadId: data.id,
                    activeSproutId: data.id
                });
            }
        });
        return () => unsub?.();
    }, [activeSproutId]);

    const isNew = activeSproutId === 'new';

    return (
        <div className="flex flex-col h-screen bg-zinc-950 relative overflow-hidden">
            {/* Header / Nav */}
            <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-center pointer-events-none">
                <div className="pointer-events-auto">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:text-white gap-2 bg-zinc-900/50 backdrop-blur"
                        onClick={() => useSproutStore.setState({ activeSproutId: null })}
                    >
                        <ChevronLeft className="w-4 h-4" />
                        {t('common.back', 'Garden')}
                    </Button>
                </div>

                <div className="pointer-events-auto flex gap-2">
                    {/* Toggle Chat / Viz */}
                    {status !== 'idle' && status !== 'error' && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="bg-zinc-900/50 backdrop-blur text-zinc-300 border-zinc-700 hover:bg-zinc-800"
                            onClick={() => setShowChat(!showChat)}
                        >
                            {showChat ? <LayoutGrid className="w-4 h-4 mr-2" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                            {showChat ? t('sprouts.view_viz', 'Visualization') : t('sprouts.view_log', 'Log')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 relative w-full h-full">

                {/* 0. Error Screen */}
                {status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-50 bg-zinc-950/90 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-xl max-w-md text-center space-y-4">
                            <h3 className="text-xl font-medium text-red-500">{t('common.error', 'An error occurred')}</h3>
                            <p className="text-zinc-300">{errorMsg || t('sprouts.error_generic', 'Something went wrong while growing your sprout.')}</p>
                            <Button
                                onClick={() => {
                                    setStatus('idle');
                                    setErrorMsg(null);
                                    if (activeSproutId !== 'new') useSproutStore.setState({ activeSproutId: null });
                                }}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                {t('common.retry', 'Try Again')}
                            </Button>
                        </div>
                    </div>
                )}

                {/* 1. Input / Setup Screen - Only if NEW and Idle */}
                {isNew && status === 'idle' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-40 bg-zinc-950">
                        <div className="max-w-2xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                            <div className="text-center space-y-4">
                                <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-indigo-500/10 border border-indigo-500/30 mb-4">
                                    <Sprout className="w-7 h-7 text-indigo-400" />
                                </div>
                                <h1 className="text-3xl font-bold tracking-tight text-zinc-100">{t('sprouts.plant_new', 'Plant a New Idea')}</h1>
                                <p className="text-sm text-zinc-500">{t('sprouts.subtitle', 'Let our AI experts nurture your seed into a full report.')}</p>
                            </div>

                            <div className="bg-indigo-500/10 border border-indigo-500/30 p-6 rounded-xl space-y-6">
                                <textarea
                                    className="w-full bg-transparent text-lg text-white placeholder:text-zinc-600 focus:outline-none resize-none min-h-[120px]"
                                    placeholder={t('sprouts.input_placeholder', 'What do you want to explore? e.g. "The future of sustainable fashion"')}
                                    value={seed}
                                    onChange={(e) => setSeed(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                            handleStart();
                                        }
                                    }}
                                />

                                <div className="flex justify-between items-center pt-4 border-t border-zinc-800">
                                    <div className="flex gap-6">
                                        {/* Rounds Selector */}
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-zinc-500 font-medium">{t('sprouts.rounds')}</label>
                                            <select
                                                value={maxRounds}
                                                onChange={(e) => setMaxRounds(Number(e.target.value))}
                                                className="bg-zinc-800 rounded px-3 py-1.5 text-zinc-300 outline-none border border-zinc-700 focus:border-indigo-500 transition-colors text-sm"
                                            >
                                                <option value={1}>1 {t('sprouts.rounds', 'Round')}</option>
                                                <option value={3}>3 {t('sprouts.rounds', 'Rounds')}</option>
                                                <option value={5}>5 {t('sprouts.rounds', 'Rounds')}</option>
                                            </select>
                                        </div>

                                        {/* Expansion Level Selector (Restored) */}
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-zinc-500 font-medium">{t('sprouts.expansion')}</label>
                                            <select
                                                value={expansionLevel === 'none' ? 0 : expansionLevel === 'unlimited' ? 2 : 1}
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    const level = val === 0 ? 'none' : val === 2 ? 'unlimited' : 'moderate';
                                                    setExpansionLevel(level);
                                                }}
                                                className="bg-zinc-800 rounded px-3 py-1.5 text-zinc-300 outline-none border border-zinc-700 focus:border-indigo-500 transition-colors text-sm"
                                            >
                                                <option value={0}>{t('sprouts.expansion_none', 'None')}</option>
                                                <option value={1}>{t('sprouts.expansion_moderate', 'Moderate')}</option>
                                                <option value={2}>{t('sprouts.expansion_unlimited', 'Max')}</option>
                                            </select>
                                        </div>
                                    </div>
                                    <Button
                                        size="lg"
                                        onClick={handleStart}
                                        disabled={!seed.trim()}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full px-8"
                                    >
                                        <Sprout className="w-4 h-4 mr-2" />
                                        {t('sprouts.start_growing', 'Start Growing')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. Visualization Layer - Always active if running/done */}
                {status !== 'idle' && status !== 'error' && (
                    <div
                        className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${showChat ? 'opacity-40 cursor-pointer' : 'opacity-100'}`}
                        onClick={() => showChat && setShowChat(false)}
                    >
                        <BonsaiViz />
                    </div>
                )}

                {/* 3. Floating Chat Layer (70% width, slides from right) */}
                <AnimatePresence>
                    {showChat && status !== 'idle' && (
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="absolute right-0 top-0 bottom-0 w-[70%] bg-zinc-950/95 border-l border-indigo-500/20 backdrop-blur-xl z-30 shadow-2xl flex flex-col"
                        >
                            <div className="p-4 border-b border-indigo-500/20 flex justify-between items-center bg-indigo-500/5">
                                <h3 className="font-semibold text-zinc-100">{t('sprouts.conversation', 'Conversation')}</h3>
                                {activeSpeaker && <span className="text-xs text-indigo-400 animate-pulse">{activeSpeaker} is typing...</span>}
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-700">
                                {messages.map((msg, idx) => {
                                    // Detect tool/system messages by role OR by name
                                    const TOOL_NAMES = ['web_search', 'search', 'Tool', 'System'];
                                    const isToolMessage = msg.role === 'tool' || (msg.name && TOOL_NAMES.some(t => msg.name?.toLowerCase().includes(t.toLowerCase())));

                                    if (isToolMessage) {
                                        return (
                                            <div key={idx} className="w-full flex justify-end mb-2">
                                                <details className="group bg-zinc-900/30 border border-zinc-800/50 rounded-lg max-w-[85%] text-xs open:bg-zinc-900/80 open:border-zinc-700 transition-all">
                                                    <summary className="flex items-center gap-2 p-2 cursor-pointer select-none text-zinc-500 hover:text-zinc-300">
                                                        <div className="p-1 bg-zinc-800 rounded">
                                                            <LayoutGrid className="w-3 h-3" />
                                                        </div>
                                                        <span className="font-medium">System Output / Search Results</span>
                                                        <ChevronLeft className="w-3 h-3 ml-auto rotate-180 group-open:-rotate-90 transition-transform" />
                                                    </summary>
                                                    <div className="p-3 pt-0 border-t border-zinc-800/50 mt-2">
                                                        <div className="prose prose-invert prose-xs max-w-none text-zinc-400 font-mono bg-black/20 p-2 rounded">
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm]}
                                                                components={{
                                                                    a: ({ node, href, children, ...props }) => (
                                                                        <a
                                                                            {...props}
                                                                            href={href}
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                if (href) invoke('app:open-external', href);
                                                                            }}
                                                                            className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                                                                        >
                                                                            {children}
                                                                        </a>
                                                                    )
                                                                }}
                                                            >
                                                                {msg.content}
                                                            </ReactMarkdown>
                                                        </div>
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs ${msg.role === 'user' ? 'bg-zinc-700' : 'bg-indigo-600'}`}>
                                                {msg.role === 'user' ? 'U' : (experts.find(e => e.name === msg.name)?.emoji || msg.name?.[0] || 'A')}
                                            </div>
                                            <div className={`max-w-[85%] rounded-lg p-3 text-sm ${msg.role === 'user'
                                                ? 'bg-zinc-800 text-zinc-100'
                                                : 'bg-zinc-800/50 border border-zinc-700 text-zinc-300'}`}>
                                                {msg.name && <div className="text-[10px] font-bold text-zinc-500 mb-1">{msg.name}</div>}
                                                <div className="prose prose-invert prose-xs max-w-none">
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm]}
                                                        components={{
                                                            a: ({ node, href, children, ...props }) => (
                                                                <a
                                                                    {...props}
                                                                    href={href}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        if (href) invoke('app:open-external', href);
                                                                    }}
                                                                    className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                                                                >
                                                                    {children}
                                                                </a>
                                                            )
                                                        }}
                                                    >
                                                        {msg.content}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Final Report Display */}
                                {report && (
                                    <div className="mt-8 animate-in fade-in duration-700">
                                        <div className="bg-gradient-to-br from-indigo-900/20 to-zinc-900 border border-indigo-500/30 rounded-xl p-5 space-y-6">
                                            {/* Header */}
                                            <div className="flex items-center gap-3 border-b border-indigo-500/20 pb-4">
                                                <div className="p-2 bg-indigo-500/20 rounded-lg">
                                                    <Sparkles className="w-5 h-5 text-indigo-400" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-medium text-indigo-100">{t('sprouts.report_title', 'Synthesis Report')}</h3>
                                                    <div className="text-xs text-indigo-400/80 uppercase tracking-wider">{report.mental_model_lens}</div>
                                                </div>
                                            </div>

                                            {/* Core Essence */}
                                            <div className="space-y-2">
                                                <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('sprouts.core_essence', 'CORE ESSENCE')}</div>
                                                <div className="text-base text-zinc-200 italic leading-relaxed">
                                                    "{report.core_essence}"
                                                </div>
                                            </div>

                                            {/* Perspective Shift */}
                                            <div className="space-y-2">
                                                <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('sprouts.perspective_shift', 'PERSPECTIVE SHIFT')}</div>
                                                <p className="text-sm text-zinc-300">
                                                    {report.perspective_shift}
                                                </p>
                                            </div>

                                            {/* Cross Pollination */}
                                            {report.cross_pollination?.length > 0 && (
                                                <div className="space-y-3">
                                                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('sprouts.cross_pollination', 'CROSS POLLINATION')}</div>
                                                    <div className="grid gap-2">
                                                        {report.cross_pollination.map((item, i) => (
                                                            <div key={i} className="bg-zinc-800/50 rounded-lg p-3 text-sm">
                                                                <span className="text-indigo-400 font-medium text-xs border border-indigo-500/30 px-1.5 py-0.5 rounded mr-2">
                                                                    {item.field}
                                                                </span>
                                                                <span className="text-zinc-300">{item.insight}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Rabbit Holes */}
                                            {report.rabbit_holes?.length > 0 && (
                                                <div className="space-y-3">
                                                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('sprouts.rabbit_holes', 'RABBIT HOLES')}</div>
                                                    <ul className="space-y-2">
                                                        {report.rabbit_holes.map((hole, i) => (
                                                            <li key={i} className="flex gap-2 text-sm text-zinc-400">
                                                                <span className="text-indigo-500/50">•</span>
                                                                <span>{hole.question}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 4. Report Ready Notification */}
                {report && !showChat && (
                    <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none flex justify-center items-end pb-20">
                        <motion.div
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="pointer-events-auto"
                        >
                            <Button
                                size="lg"
                                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-xl shadow-emerald-900/20"
                                onClick={() => setShowChat(true)}
                            >
                                <Sparkles className="w-4 h-4 mr-2" />
                                {t('sprouts.report_ready', 'Report Ready - View Log')}
                            </Button>
                        </motion.div>
                    </div>
                )}
            </div>
        </div>
    );
}
