import { BaseMessage } from "@langchain/core/messages";
import { ActivityVector } from "../storage/vector-storage";

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
}
