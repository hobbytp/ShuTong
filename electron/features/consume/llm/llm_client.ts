// LLM Client abstraction for Context Agent

import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';
import 'dotenv/config';

// Singleton LLM instance
let llmInstance: ChatOpenAI | null = null;

export function getLLM(): ChatOpenAI {
    if (!llmInstance) {
        llmInstance = new ChatOpenAI({
            modelName: process.env.OPENAI_MODEL_NAME || 'gpt-4o',
            temperature: 0.7,
            streaming: true,
            timeout: 60000, // 60 second timeout for resilience
            maxRetries: 2,  // Retry on transient failures
        });
    }
    return llmInstance;
}

/**
 * Generate a response from the LLM
 */
export async function generateWithMessages(
    messages: BaseMessage[],
    _options?: { streaming?: boolean }
): Promise<string> {
    const llm = getLLM();
    const response = await llm.invoke(messages);
    return response.content as string;
}

/**
 * Stream response from the LLM
 */
export async function* generateStreamForAgent(
    messages: BaseMessage[]
): AsyncGenerator<string, void, unknown> {
    const llm = getLLM();
    const stream = await llm.stream(messages);

    for await (const chunk of stream) {
        if (chunk.content) {
            yield chunk.content as string;
        }
    }
}
