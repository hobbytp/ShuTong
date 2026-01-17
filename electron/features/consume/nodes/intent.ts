// Intent Node - Analyzes user intent and classifies query type

import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { AgentStateType } from '../models/state';
// Intent type unused in import
import { QueryType, WorkflowStage } from '../models/enums';
import { getPromptManager } from '../../../llm/prompts/manager';
import { generateWithMessages } from '../llm/llm_client';

const promptManager = getPromptManager();

/**
 * Intent Node - Classifies query and handles simple chat directly
 */
export async function intentNode(
    state: AgentStateType
): Promise<Partial<AgentStateType>> {
    const query = state.query;
    const chatHistory = state.chatHistory || [];

    // 1. Classify query type
    const queryType = await classifyQuery(query, chatHistory);

    if (!queryType) {
        return {
            stage: WorkflowStage.FAILED,
            errors: ['Intent analysis failed: could not classify query'],
        };
    }

    // 2. Handle simple chat directly
    if (queryType === QueryType.SIMPLE_CHAT) {
        const response = await handleSimpleChat(query, chatHistory);
        return {
            intent: {
                originalQuery: query,
                queryType: QueryType.SIMPLE_CHAT,
                enhancedQuery: query,
            },
            finalContent: response,
            stage: WorkflowStage.COMPLETED,
        };
    }

    // 3. For complex queries, create intent and proceed
    return {
        intent: {
            originalQuery: query,
            queryType,
            enhancedQuery: query, // Can be enhanced later
        },
        stage: WorkflowStage.CONTEXT_GATHERING,
    };
}

/**
 * Classify query type using LLM
 * P1-4: Fixed type safety - proper types instead of any
 */
async function classifyQuery(
    query: string,
    chatHistory: BaseMessage[]
): Promise<QueryType | null> {
    try {
        const systemPrompt = promptManager.getPrompt(
            'chat_workflow.query_classification.system',
            {},
            'You are a query classifier. Classify the user query into one of: simple_chat, qa_analysis, document_edit, content_generation.'
        );
        const userPrompt = promptManager.getPrompt(
            'chat_workflow.query_classification.user',
            { query, chat_history: JSON.stringify(chatHistory) },
            `Classify this query: ${query}`
        );

        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ];

        const response = await generateWithMessages(messages);
        const lowerResponse = response.toLowerCase();

        if (lowerResponse.includes('simple_chat')) return QueryType.SIMPLE_CHAT;
        if (lowerResponse.includes('document_edit')) return QueryType.DOCUMENT_EDIT;
        if (lowerResponse.includes('content_generation')) return QueryType.CONTENT_GENERATION;
        if (lowerResponse.includes('qa_analysis')) return QueryType.QA_ANALYSIS;

        // Default to QA_ANALYSIS for complex queries
        return QueryType.QA_ANALYSIS;
    } catch (error) {
        console.error('Query classification failed:', error);
        return null;
    }
}

/**
 * Handle simple chat queries directly
 * P1-4: Fixed type safety
 */
async function handleSimpleChat(
    query: string,
    _chatHistory: BaseMessage[]
): Promise<string> {
    const systemPrompt = promptManager.getPrompt(
        'chat_workflow.social_interaction.system',
        {},
        'You are a helpful assistant. Respond naturally to the user.'
    );
    const userPrompt = promptManager.getPrompt(
        'chat_workflow.social_interaction.user',
        { query },
        query
    );

    const messages: BaseMessage[] = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
    ];

    const response = await generateWithMessages(messages);
    return response;
}

/**
 * Router function to determine next node after intent
 * P0-1: Returns actual node names for clarity
 */
export function intentRouter(state: AgentStateType): string {
    if (state.stage === WorkflowStage.COMPLETED) {
        return '__end__';
    }
    if (state.stage === WorkflowStage.FAILED) {
        return '__end__';
    }
    return 'contextPlan';
}
