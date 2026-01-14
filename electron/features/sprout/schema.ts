import { BaseMessage } from "@langchain/core/messages";
import { SproutReport } from "@shared/sprout";

export * from "@shared/sprout";

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

// Note: State channels are now defined via Annotation API in agent.ts (LangGraph v1.0+ pattern)
// The sproutStateChannels export has been removed as it was a duplicate
