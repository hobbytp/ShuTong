import { useEffect, useRef } from 'react';
import { Sprout, Send, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ExpertDeck } from './components/ExpertDeck';
import { PageHeader } from '../../components/ui/page-header';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke, on } from '../../lib/ipc';
import { useTranslation } from 'react-i18next';
import { useSproutStore } from './store';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string; // Expert name
    content: string;
    timestamp: number;
}

export function SproutView() {
    const { i18n } = useTranslation();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Zustand Store
    const {
        seed, setSeed,
        maxRounds, setMaxRounds,
        expansionLevel, setExpansionLevel,
        messages, setMessages, addMessage,
        experts, setExperts,
        status, setStatus,
        errorMsg, setErrorMsg,
        activeSpeaker, setActiveSpeaker,
        threadId, setThreadId
    } = useSproutStore();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        // Listen for Sprout updates
        // @ts-ignore
        const cleanup = window.electron?.on('app-event', (event: any) => {
            // IPC doesn't use 'app-event', it uses specific channels we named sprout:update:THREADID
            // BUT here we need to listen generically or know the threadID.
            // Let's implement dynamic subscription in startSession
        });

    }, [messages, activeSpeaker]);

    // Subscription Effect - Handles persistence and reconnection
    useEffect(() => {
        if (!threadId) return;

        console.log(`[SproutView] Subscribing to thread: ${threadId} `);

        // Subscribe to updates
        const removeUpdateListener = on(`sprout:update:${threadId}`, (_event: any, chunk: any) => {
            console.log('[SproutView] Update:', chunk);

            // LangGraph stream format: { nodeKey: { ...nodeOutput } }
            // Flatten: extract the node output from the wrapper
            let data = chunk;
            const keys = Object.keys(chunk);
            if (keys.length === 1 && typeof chunk[keys[0]] === 'object') {
                // Flatten single-node output
                data = chunk[keys[0]];
                console.log('[SproutView] Flattened data from node:', keys[0], data);
            }

            // 1. Detect Experts (from 'supervisor' step)
            if (data.experts && Array.isArray(data.experts) && data.experts.length > 0) {
                console.log('[SproutView] Setting experts:', data.experts);
                setExperts(data.experts);
            }

            // 2. Detect Messages
            if (data.messages && Array.isArray(data.messages)) {
                // Last message strategy
                const lastMsgRaw = data.messages[data.messages.length - 1];
                if (lastMsgRaw) {
                    // Normalize message
                    const newContent = typeof lastMsgRaw.content === 'string'
                        ? lastMsgRaw.content
                        : (lastMsgRaw.content?.candidates?.[0]?.message?.content || JSON.stringify(lastMsgRaw.content));

                    // Check for tool message type
                    let newRole: Message['role'] = 'assistant';
                    if (lastMsgRaw.getType?.() === 'human') newRole = 'user';
                    if (lastMsgRaw.getType?.() === 'tool') newRole = 'tool';

                    const newName = lastMsgRaw.name;

                    console.log('[SproutView] Processing message:', { name: newName, role: newRole, contentPreview: newContent?.substring(0, 50) });

                    // Message Handling (avoid duplicates check needs access to current messages)
                    // Since we use Functional Updates in the store or robust logic,
                    // we can rely on addMessage or setMessages with predicate.
                    // Ideally, backend shouldn't send duplicate full history chunks if possible,
                    // but here we check against the STORE's last message.

                    useSproutStore.setState((state) => {
                        const lastPrev = state.messages[state.messages.length - 1];

                        // Skip duplicates - but only if content AND name match exactly
                        if (lastPrev && lastPrev.content === newContent && lastPrev.name === newName) {
                            console.log('[SproutView] Skipping duplicate message:', newName);
                            return {}; // No change
                        }

                        console.log('[SproutView] Adding message from:', newName, 'total messages:', state.messages.length + 1);
                        if (newName) setActiveSpeaker(newName);

                        return {
                            messages: [...state.messages, {
                                id: `${Date.now()}-${Math.random()}`,
                                role: newRole,
                                name: newName,
                                content: newContent || '',
                                timestamp: Date.now()
                            }]
                        };
                    });
                }
            }

            // 3. Detect Next Speaker
            if (data.next_speaker) {
                // setActiveSpeaker(data.next_speaker);
            }

            // 4. Report
            if (data.report) {
                addMessage({
                    id: 'report',
                    role: 'assistant',
                    name: 'System',
                    content: `### 🌱 Sprouting Report\n\n**Core Meaning**: ${data.report.core_meaning}\n\n**Connections**:\n${data.report.connections.map((c: string) => `- ${c}`).join('\n')}\n\n**Pathways**:\n- 📖 Theory: ${data.report.pathways.theory}\n- 🛠️ Practice: ${data.report.pathways.practice}\n- 🔄 Inversion: ${data.report.pathways.inversion}`,
                    timestamp: Date.now()
                });
            }
        });

        const removeCompleteListener = on(`sprout:complete:${threadId}`, () => {
            setStatus('done');
            setActiveSpeaker(null);
        });

        const removeErrorListener = on(`sprout:error:${threadId}`, (_event: any, { error }: any) => {
            setStatus('idle');
            setErrorMsg(error);
            setActiveSpeaker(null);
            addMessage({
                id: `error-${Date.now()}`,
                role: 'system',
                content: `🚨 **Error:** ${error}`,
                timestamp: Date.now()
            });
        });

        // Cleanup on unmount or thread change
        return () => {
            removeUpdateListener?.();
            removeCompleteListener?.();
            removeErrorListener?.();
        };
    }, [threadId]); // Only re-run if threadId changes

    const handleStart = async () => {
        if (!seed.trim()) return;

        // Reset previous state but keep seed until confirmed
        // reset(); // Don't reset everything, just status/messages/experts for new run

        setStatus('running');
        setErrorMsg(null);
        setExperts([]);
        setMessages([]); // Clear previous messages
        setActiveSpeaker(null);

        // Add User Seed Message
        addMessage({ id: 'user-seed', role: 'user', content: seed, timestamp: Date.now() });

        try {
            // @ts-ignore
            const result = await invoke('sprout:start-session', seed, { max_rounds: maxRounds, expansion_level: expansionLevel, language: i18n.language });

            if (result.success && result.threadId) {
                setThreadId(result.threadId);

                // Set initial experts from response to avoid race condition
                if (result.initialExperts && Array.isArray(result.initialExperts) && result.initialExperts.length > 0) {
                    console.log('[SproutView] Setting initial experts from response:', result.initialExperts);
                    setExperts(result.initialExperts);
                }
                // Effect will pick up subscription
            } else {
                console.error("Failed to start session:", result.error);
                setStatus('idle');
                setErrorMsg(result.error || null);
            }
        } catch (e: any) {
            console.error(e);
            setStatus('idle');
            setErrorMsg(e.message);
        }
    };

    return (
        <div className="h-full flex flex-col bg-zinc-950 text-zinc-50 font-sans">
            <PageHeader
                title="AutoExpert"
                subtitle="From Seeds to Sprouts"
                icon={Sprout}
            />

            {/* Error Banner */}
            {errorMsg && (
                <div className="bg-red-900/50 border-b border-red-800/50 p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-900/80 flex items-center justify-center flex-shrink-0 text-red-200">
                        ⚠️
                    </div>
                    <div className="flex-1">
                        <h3 className="text-red-200 font-medium text-sm">Session Error</h3>
                        <p className="text-red-300/80 text-xs">{errorMsg}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-red-100">
                        Dismiss
                    </Button>
                </div>
            )}

            {/* Top Zone: Expert Deck */}
            <div className="flex-shrink-0 bg-zinc-900/30 border-b border-zinc-800/50 min-h-[320px] relative">
                <ExpertDeck
                    experts={experts.map(e => ({
                        ...e,
                        isActive: activeSpeaker === e.name
                    }))}
                />

                {/* Empty State / Initial Prompt */}
                {status === 'idle' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-zinc-950/80 backdrop-blur-sm z-10">
                        <div className="max-w-xl w-full text-center space-y-6">
                            <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Sprout className="w-8 h-8 text-green-500" />
                            </div>
                            <h2 className="text-2xl font-bold text-zinc-100">Plant a Seed</h2>
                            <p className="text-zinc-400">
                                Enter a topic, a quote, or a meeting note.
                                We'll assemble a team of experts to analyze it for you.
                            </p>

                            <div className="flex flex-col gap-4">
                                <div className="flex gap-4 w-full">
                                    {/* Expansion Level */}
                                    <div className="flex-1 flex items-center gap-4 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
                                        <span className="text-sm text-zinc-400 min-w-[60px]">Growth:</span>
                                        <select
                                            value={expansionLevel}
                                            onChange={(e) => setExpansionLevel(e.target.value as any)}
                                            className="flex-1 bg-zinc-700 text-zinc-200 text-sm rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 border-none"
                                        >
                                            <option value="none">Fixed Team</option>
                                            <option value="moderate">Expand (1-3)</option>
                                            <option value="unlimited">Unlimited</option>
                                        </select>
                                    </div>

                                    {/* Max Rounds */}
                                    <div className="flex-1 flex items-center gap-4 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
                                        <span className="text-sm text-zinc-400 min-w-[60px]">Depth:</span>
                                        <input
                                            type="range"
                                            min="1"
                                            max="10"
                                            value={maxRounds}
                                            onChange={(e) => setMaxRounds(parseInt(e.target.value))}
                                            className="flex-1 accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <span className="text-sm font-medium text-indigo-400 w-8 text-right">{maxRounds}</span>
                                        <span className="text-xs text-zinc-500">Rounds</span>
                                    </div>

                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="e.g. 'The future of remote work is asynchronous...'"
                                        className="flex-1 bg-zinc-900/50 border border-zinc-700 rounded-lg px-4 h-12 text-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={seed}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSeed(e.target.value)}
                                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleStart()}
                                        disabled={status !== 'idle'}
                                    />
                                    <Button size="lg" className="h-12 w-12 p-0" onClick={handleStart} disabled={status !== 'idle'}>
                                        <Send size={20} />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Zone: Transcript */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap - 4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} `}>
                        <div className={`w - 8 h - 8 rounded - full flex items - center justify - center flex - shrink - 0 ${msg.role === 'user' ? 'bg-zinc-700' : 'bg-indigo-600'} `}>
                            {msg.role === 'user' ? '👤' : (experts.find(e => e.name === msg.name)?.emoji || '🤖')}
                        </div>
                        <div className={`max - w - [80 %] rounded - 2xl p - 4 ${msg.role === 'user'
                            ? 'bg-zinc-800 text-zinc-100 rounded-tr-none'
                            : msg.role === 'tool'
                                ? 'bg-zinc-900/50 border border-zinc-800/50 text-zinc-400 italic text-sm'
                                : 'bg-zinc-900/80 border border-zinc-800 text-zinc-300 rounded-tl-none'
                            } `}>
                            {msg.name && <div className="text-xs font-bold text-zinc-500 mb-1">{msg.name} {msg.role === 'tool' && '(Tool Output)'}</div>}
                            <div className="prose prose-invert prose-sm max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.content}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}

                {status === 'running' && !activeSpeaker && (
                    <div className="flex justify-center text-zinc-500 animate-pulse text-sm">
                        <Sparkles className="w-4 h-4 mr-2" />
                        Thinking...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
}
