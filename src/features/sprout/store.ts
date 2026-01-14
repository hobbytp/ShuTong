import { create } from 'zustand';
import { SproutReport, SproutSession, SproutMessage } from '@shared/sprout';
import { invoke } from '@/lib/ipc';

interface SproutState {
    seed: string;
    maxRounds: number;
    expansionLevel: 'none' | 'moderate' | 'unlimited';

    // History & Persistence
    history: SproutSession[];
    isLoadingHistory: boolean;
    activeSproutId: string | null; // For selecting viewing

    // Current Active Sprout State
    threadId: string | null;
    status: 'idle' | 'running' | 'done' | 'error';
    errorMsg: string | null;

    messages: SproutMessage[];
    experts: any[]; // Using any to match component for now
    activeSpeaker: string | null;
    report: SproutReport | null;

    // Actions
    setSeed: (seed: string) => void;
    setMaxRounds: (rounds: number) => void;
    setExpansionLevel: (level: 'none' | 'moderate' | 'unlimited') => void;
    setThreadId: (id: string | null) => void;

    setStatus: (status: 'idle' | 'running' | 'done' | 'error') => void;
    setErrorMsg: (msg: string | null) => void;

    setMessages: (messages: SproutMessage[] | ((prev: SproutMessage[]) => SproutMessage[])) => void;
    addMessage: (msg: SproutMessage) => void;
    setExperts: (experts: any[]) => void;
    setActiveSpeaker: (speaker: string | null) => void;
    setReport: (report: SproutReport | null) => void;

    // Async Actions
    loadHistory: () => Promise<void>;
    loadSprout: (id: string) => Promise<void>;
    deleteSprout: (id: string) => Promise<void>;
    reset: () => void;
}

export const useSproutStore = create<SproutState>((set, get) => ({
    seed: '',
    maxRounds: 3,
    expansionLevel: 'moderate',

    history: [],
    isLoadingHistory: false,
    activeSproutId: null,

    threadId: null,

    status: 'idle',
    errorMsg: null,

    messages: [],
    experts: [],
    activeSpeaker: null,
    report: null,

    setSeed: (seed) => set({ seed }),
    setMaxRounds: (rounds) => set({ maxRounds: rounds }),
    setExpansionLevel: (level) => set({ expansionLevel: level }),
    setThreadId: (id) => set({ threadId: id }),

    setStatus: (status) => set({ status }),
    setErrorMsg: (msg) => set({ errorMsg: msg }),

    setMessages: (updater) => {
        if (typeof updater === 'function') {
            set({ messages: updater(get().messages) });
        } else {
            set({ messages: updater });
        }
    },
    addMessage: (msg: SproutMessage) => set((state) => ({ messages: [...state.messages, msg] })),
    setExperts: (experts) => set({ experts }),
    setActiveSpeaker: (speaker) => set({ activeSpeaker: speaker }),
    setReport: (report) => set({ report }),

    loadHistory: async () => {
        set({ isLoadingHistory: true });
        try {
            const history = await invoke('sprout:history');
            set({ history, isLoadingHistory: false });
        } catch (error) {
            console.error('Failed to load history:', error);
            set({ isLoadingHistory: false });
        }
    },

    loadSprout: async (id: string) => {
        // Special case for creating a NEW sprout
        if (id === 'new') {
            set({
                activeSproutId: 'new',
                threadId: null,
                seed: '',
                status: 'idle',
                messages: [],
                experts: [],
                report: null,
                errorMsg: null
            });
            return;
        }

        // Loading existing sprout
        set({ status: 'running', activeSproutId: id, threadId: id, messages: [], experts: [], report: null });
        try {
            const { session, messages, report } = await invoke('sprout:load', id);
            set({
                activeSproutId: id,
                threadId: session.id,
                seed: session.topic,
                status: session.status === 'completed' ? 'done' : 'running',
                messages,
                report,
                experts: deriveExperts(messages)
            });
        } catch (error) {
            console.error('Failed to load sprout:', error);
            set({ errorMsg: 'Failed to load session', status: 'error' });
        }
    },

    deleteSprout: async (id: string) => {
        try {
            await invoke('sprout:delete', id);
            set((state) => ({
                history: state.history.filter(h => h.id !== id),
                activeSproutId: state.activeSproutId === id ? null : state.activeSproutId
            }));
        } catch (error) {
            console.error('Failed to delete sprout:', error);
        }
    },

    reset: () => set({
        // seed: '', // Keep seed? Maybe reset. User might want to re-run. Let's reset seed on explicit reset.
        seed: '',
        status: 'idle',
        errorMsg: null,
        messages: [],
        experts: [],
        activeSpeaker: null,
        threadId: null,
        activeSproutId: null,
        report: null
    })
}));

// Helper to extract unique experts from message history
function deriveExperts(messages: SproutMessage[]): any[] {
    const expertMap = new Map<string, any>();
    const EXCLUDED_NAMES = ['Supervisor', 'Synthesizer', 'web_search', 'Web Search', 'Tool', 'System', 'orchestrator'];

    // Role detection patterns (Chinese and English)
    const ROLE_PATTERNS: [RegExp, string][] = [
        [/心理学家/i, '心理学家'],
        [/经济学家/i, '经济学家'],
        [/历史学家/i, '历史学家'],
        [/社会学家/i, '社会学家'],
        [/哲学家/i, '哲学家'],
        [/未来学家/i, '未来学家'],
        [/生物学家/i, '生物学家'],
        [/建筑师|架构师/i, '系统架构师'],
        [/设计师/i, '设计师'],
        [/批判.*思考|批判.*分析/i, '批判思考者'],
        [/psychologist/i, 'Psychologist'],
        [/economist/i, 'Economist'],
        [/historian/i, 'Historian'],
        [/sociologist/i, 'Sociologist'],
        [/philosopher/i, 'Philosopher'],
        [/futurist/i, 'Futurist'],
        [/biologist/i, 'Biologist'],
        [/architect/i, 'Architect'],
        [/designer/i, 'Designer'],
        [/critic/i, 'Critical Thinker'],
    ];

    messages.forEach(msg => {
        // Filter out system roles and tools
        if (msg.role === 'assistant' && msg.name && !EXCLUDED_NAMES.includes(msg.name) && !expertMap.has(msg.name)) {

            let role = ''; // Empty = hidden
            let description = '';

            // Search for role in this expert's first message (intro)
            const expertMessages = messages.filter(m => m.name === msg.name && m.role === 'assistant');
            const firstMessage = expertMessages[0]?.content || '';

            // Try to detect role from message content
            for (const [pattern, roleName] of ROLE_PATTERNS) {
                if (pattern.test(firstMessage) || pattern.test(msg.name)) {
                    role = roleName;
                    break;
                }
            }

            // Extract first 1-2 sentences as intro/description (capped at 150 chars)
            if (firstMessage) {
                const intro = firstMessage.split(/[。！？.!?]/)[0].trim();
                description = intro.length > 150 ? intro.substring(0, 147) + '...' : intro;
            }

            expertMap.set(msg.name, {
                name: msg.name,
                role, // Empty string if not found -> will be hidden in UI
                emoji: '', // No longer used but keeping for type safety
                description
            });
        }
    });

    return Array.from(expertMap.values());
}
