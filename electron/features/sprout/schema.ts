import { BaseMessage } from "@langchain/core/messages";

export interface AgentPersona {
    id: string;
    name: string;
    role: string;
    emoji: string;
    description: string;
    /**
     * 0-100 rating of relevance or expertise match
     */
    relevance: number;
}

export interface SproutReport {
    core_meaning: string;
    connections: string[];
    pathways: {
        theory: string;
        practice: string;
        inversion: string;
    };
}

export interface AutoExpertConfig {
    dynamism: 'safe' | 'default' | 'wild';
    /**
     * @check TBD: currently only 'sequential' is supported. 'parallel' is reserved for future use.
     */
    execution_mode: 'sequential' | 'parallel';
    max_rounds?: number;
    expansion_level?: 'none' | 'moderate' | 'unlimited';
    language?: string;
}

export interface AutoExpertState {
    messages: BaseMessage[];
    /**
     * The original seed input by the user
     */
    seed: string;
    /**
     * Retrieved context from memory/vector store
     */
    context_summary: string;
    /**
     * The roster of experts recruited for this session
     */
    experts: AgentPersona[];
    /**
     * The next expert scheduled to speak (for sequential mode)
     */
    next_speaker?: string;
    /**
     * The final output report
     */
    report?: SproutReport;
    /**
     * Configuration for this run
     */
    config: AutoExpertConfig;
    /**
     * Current round of discussion
     */
    current_round: number;
    /**
     * Thread ID for persistence
     */
    thread_id: string;
    /**
     * User ID for personalization
     */
    user_id: string;
}

export const DEFAULT_AUTO_EXPERT_STATE: Partial<AutoExpertState> = {
    messages: [],
    experts: [],
    config: { dynamism: 'default', execution_mode: 'sequential', max_rounds: 3, expansion_level: 'none', language: 'en' },
    current_round: 0,
    thread_id: 'default',
    user_id: 'local'
};

export const sproutStateChannels = {
    messages: {
        reducer: (x: any, y: any) => (x || []).concat(y || []),
        default: () => []
    },
    seed: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => ''
    },
    context_summary: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => ''
    },
    experts: {
        reducer: (x: any, y: any) => {
            // Merge experts, avoiding duplicates by ID
            const combined = [...(x || []), ...(y || [])];
            const unique = new Map();
            combined.forEach((e: any) => unique.set(e.id, e));
            return Array.from(unique.values());
        },
        default: () => []
    },
    next_speaker: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined
    },
    report: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined
    },
    config: {
        reducer: (x: any, y: any) => ({ ...x, ...y }),
        default: () => ({ dynamism: 'default', execution_mode: 'sequential', max_rounds: 3, expansion_level: 'none', language: 'en' })
    },
    current_round: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => 0
    },
    thread_id: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => 'default'
    },
    user_id: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => 'local'
    }
};
