
import { BaseMessage } from "@langchain/core/messages";
import { TopicGroup } from "../topic-discovery.service";

/**
 * The state of the Topic Agent conversation.
 */
export interface TopicState {
    /**
     * Conversation history
     */
    messages: BaseMessage[];

    /**
     * The derived intent of the user's last message.
     */
    user_intent: 'SEARCH' | 'FILTER' | 'SAVE' | 'CHAT' | 'LIST' | 'EDIT' | 'DELETE' | 'VIEW' | null;

    /**
     * The current draft topic being built/refined.
     * Note: Using string[] instead of Set for JSON serialization compatibility.
     */
    current_draft: {
        originalQuery: string;
        groups: TopicGroup[];
        excludedEntities: string[];
    } | null;

    /**
     * The final response text to be sent to the user.
     */
    final_response: string;

    /**
     * Thread ID for persistence.
     */
    thread_id: string;

    /**
     * Optional confirmation message for SAVE actions
     */
    save_result?: string;

    /**
     * Optional filter criteria for frontend state
     */
    active_filter?: {
        name: string;
        definition: any;
    };
}

export const topicStateChannels = {
    messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => []
    },
    user_intent: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => null
    },
    current_draft: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => null
    },
    final_response: {
        reducer: (x: string, y: string) => y ?? x,
        default: () => ""
    },
    thread_id: {
        reducer: (x: string, y: string) => y ?? x,
        default: () => "default"
    },
    save_result: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
        default: () => undefined
    },
    active_filter: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined
    }
};
