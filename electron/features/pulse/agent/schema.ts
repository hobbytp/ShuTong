import { BaseMessage } from "@langchain/core/messages";
import { ActivityVector } from "../../../storage/vector-storage";
import { Memory } from "./memory-store";

export interface PulseState {
    messages: BaseMessage[];
    /**
     * Context retrieved from VectorStorage based on the conversation or trigger
     */
    relevant_activities: ActivityVector[];
    /**
     * The type of Pulse card we are aiming to generate (if any)
     */
    target_card_type?: 'briefing' | 'action' | 'sprouting' | 'challenge';
    /**
     * User's current derived intent
     */
    user_intent?: string;
    /**
     * Current system time context
     */
    current_time?: string;

    // ============ Memory Fields ============

    /**
     * Memories recalled from long-term storage for this turn
     */
    recalled_memories: Memory[];
    /**
     * Conversation thread identifier (for checkpointing)
     */
    thread_id: string;
    /**
     * User identifier (default: 'local' for local-first app)
     */
    user_id: string;
}

/**
 * Default values for PulseState
 */
export const DEFAULT_PULSE_STATE: Partial<PulseState> = {
    messages: [],
    relevant_activities: [],
    recalled_memories: [],
    thread_id: 'default',
    user_id: 'local'
};

/**
 * State channels definition for LangGraph
 * Defines how state updates are merged
 */
export const graphStateChannels = {
    messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => []
    },
    relevant_activities: {
        reducer: (_x: ActivityVector[], y: ActivityVector[]) => y, // Replace with new context
        default: () => []
    },
    target_card_type: {
        reducer: (x: PulseState['target_card_type'], y: PulseState['target_card_type']) => y ?? x,
        default: () => undefined
    },
    user_intent: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
        default: () => undefined
    },
    current_time: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
        default: () => new Date().toISOString()
    },
    recalled_memories: {
        reducer: (_x: Memory[], y: Memory[]) => y, // Replace with new recall
        default: () => []
    },
    thread_id: {
        reducer: (x: string, y: string) => y ?? x,
        default: () => 'default'
    },
    user_id: {
        reducer: (x: string, y: string) => y ?? x,
        default: () => 'local'
    }
};
