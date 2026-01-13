import { create } from 'zustand';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string; // Expert name
    content: string;
    timestamp: number;
}

interface SproutState {
    seed: string;
    maxRounds: number;
    expansionLevel: 'none' | 'moderate' | 'unlimited';
    threadId: string | null;

    status: 'idle' | 'running' | 'done' | 'error';
    errorMsg: string | null;

    messages: Message[];
    experts: any[]; // Using any to match component for now, ideally strictly typed
    activeSpeaker: string | null;

    setSeed: (seed: string) => void;
    setMaxRounds: (rounds: number) => void;
    setExpansionLevel: (level: 'none' | 'moderate' | 'unlimited') => void;
    setThreadId: (id: string | null) => void;

    setStatus: (status: 'idle' | 'running' | 'done' | 'error') => void;
    setErrorMsg: (msg: string | null) => void;

    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
    addMessage: (msg: Message) => void;
    setExperts: (experts: any[]) => void;
    setActiveSpeaker: (speaker: string | null) => void;

    reset: () => void;
}

export const useSproutStore = create<SproutState>((set, get) => ({
    seed: '',
    maxRounds: 3,
    expansionLevel: 'moderate',
    threadId: null,

    status: 'idle',
    errorMsg: null,

    messages: [],
    experts: [],
    activeSpeaker: null,

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
    addMessage: (msg: Message) => set((state) => ({ messages: [...state.messages, msg] })),
    setExperts: (experts) => set({ experts }),
    setActiveSpeaker: (speaker) => set({ activeSpeaker: speaker }),

    reset: () => set({
        // seed: '', // Keep seed? Maybe reset. User might want to re-run. Let's reset seed on explicit reset.
        seed: '',
        status: 'idle',
        errorMsg: null,
        messages: [],
        experts: [],
        activeSpeaker: null,
        threadId: null
    })
}));
