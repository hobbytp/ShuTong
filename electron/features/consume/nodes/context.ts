// Context Node - Plans and executes context gathering

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../models/state';
import { ContextItem, ToolCall, ToolResult, Intent } from '../models/schemas';
import { ContextSufficiency, WorkflowStage } from '../models/enums';
import { getPromptManager } from '../../../llm/prompts/manager';
import { generateWithMessages } from '../llm/llm_client';
import { executeToolCalls } from '../tools/executor';

const promptManager = getPromptManager();
const MAX_CONTEXT_ITERATIONS = 2;

/**
 * Context Plan Node - Evaluates sufficiency and plans tool calls
 */
export async function contextPlanNode(
    state: AgentStateType
): Promise<Partial<AgentStateType>> {
    const intent = state.intent;
    const contexts = state.contexts || [];
    const iteration = state.contextIteration || 0;

    if (!intent) {
        return {
            errors: ['Context planning failed: no intent available'],
            stage: WorkflowStage.FAILED,
        };
    }

    // 1. Evaluate current context sufficiency
    const sufficiency = await evaluateSufficiency(intent, contexts);

    // P1-6: If sufficient, set flag to skip exec and go directly to executor
    if (sufficiency === ContextSufficiency.SUFFICIENT) {
        return {
            contextSufficiency: ContextSufficiency.SUFFICIENT,
            plannedToolCalls: [], // No tools needed
        };
    }

    // 2. Check iteration limit
    if (iteration >= MAX_CONTEXT_ITERATIONS) {
        return {
            contextSufficiency: ContextSufficiency.PARTIAL,
            plannedToolCalls: [], // Max iterations reached
        };
    }

    // 3. Plan tool calls
    const toolCalls = await planToolCalls(intent, contexts, iteration);

    return {
        plannedToolCalls: toolCalls,
        contextIteration: iteration + 1,
        contextSufficiency: sufficiency,
    };
}

/**
 * Context Exec Node - Executes planned tool calls
 */
export async function contextExecNode(
    state: AgentStateType
): Promise<Partial<AgentStateType>> {
    const toolCalls = state.plannedToolCalls || [];
    const intent = state.intent;

    if (toolCalls.length === 0) {
        // No tools to execute, proceed to execution
        return {};
    }

    if (!intent) {
        return {
            errors: ['Context execution failed: no intent available'],
        };
    }

    // Execute tool calls
    const toolResults = await executeToolCalls(toolCalls);

    // Filter and validate results
    const validatedItems = await validateAndFilterResults(
        toolCalls,
        toolResults,
        intent
    );

    return {
        contexts: validatedItems, // Will be merged via reducer
        plannedToolCalls: [], // Clear planned calls
    };
}

/**
 * Evaluate context sufficiency using LLM
 * P1-4: Fixed type safety - Intent instead of any
 */
async function evaluateSufficiency(
    intent: Intent,
    contexts: ContextItem[]
): Promise<ContextSufficiency> {
    if (contexts.length === 0) {
        return ContextSufficiency.INSUFFICIENT;
    }

    try {
        const systemPrompt = promptManager.getPrompt(
            'context_collection.sufficiency_evaluation.system',
            {},
            'You are evaluating if the collected context is sufficient to answer the query.'
        );
        const userPrompt = promptManager.getPrompt(
            'context_collection.sufficiency_evaluation.user',
            {
                query: intent.originalQuery,
                enhanced_query: intent.enhancedQuery,
                collected_contexts: JSON.stringify(contexts.slice(0, 5)), // Limit for prompt
            },
            `Query: ${intent.originalQuery}\nContexts: ${contexts.length} items`
        );

        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ];

        const response = await generateWithMessages(messages);
        const lowerResponse = response.toLowerCase();

        if (lowerResponse.includes('sufficient')) return ContextSufficiency.SUFFICIENT;
        if (lowerResponse.includes('partial')) return ContextSufficiency.PARTIAL;
        return ContextSufficiency.INSUFFICIENT;
    } catch (error) {
        console.error('Sufficiency evaluation failed:', error);
        return ContextSufficiency.PARTIAL;
    }
}

/**
 * Plan tool calls using LLM
 * P1-4: Fixed type safety
 */
async function planToolCalls(
    intent: Intent,
    contexts: ContextItem[],
    iteration: number
): Promise<ToolCall[]> {
    try {
        const systemPrompt = promptManager.getPrompt(
            'context_collection.tool_analysis.system',
            {},
            'You are planning which tools to call to gather context.'
        );
        const userPrompt = promptManager.getPrompt(
            'context_collection.tool_analysis.user',
            {
                query: intent.originalQuery,
                enhanced_query: intent.enhancedQuery,
                collected_contexts: JSON.stringify(contexts.slice(0, 3)),
                iteration: iteration.toString(),
            },
            `Plan tools for: ${intent.originalQuery}`
        );

        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ];

        const response = await generateWithMessages(messages);

        // Parse tool calls from response (simplified for now)
        // In production, use structured output
        const toolCalls: ToolCall[] = [];

        if (response.toLowerCase().includes('web_search')) {
            toolCalls.push({
                toolName: 'web_search',
                parameters: { query: intent.enhancedQuery },
            });
        }

        return toolCalls;
    } catch (error) {
        console.error('Tool planning failed:', error);
        return [];
    }
}

/**
 * Validate and filter tool results
 * P1-4: Fixed type safety
 */
async function validateAndFilterResults(
    _toolCalls: ToolCall[],
    toolResults: ToolResult[],
    _intent: Intent
): Promise<ContextItem[]> {
    const validItems: ContextItem[] = [];

    for (const result of toolResults) {
        if (result.success && result.result) {
            // Convert tool result to ContextItem
            const item: ContextItem = {
                id: `${result.toolName}-${Date.now()}`,
                content: typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result),
                source: result.toolName,
                metadata: { toolName: result.toolName },
            };
            validItems.push(item);
        }
    }

    return validItems;
}

/**
 * Router function to determine next node after context exec
 * P0-1: Returns actual node names directly
 */
export function contextRouter(state: AgentStateType): string {
    const sufficiency = state.contextSufficiency;
    const iteration = state.contextIteration || 0;
    const toolCalls = state.plannedToolCalls || [];

    // If sufficient or max iterations reached or no more tools, proceed to executor
    if (
        sufficiency === ContextSufficiency.SUFFICIENT ||
        iteration >= MAX_CONTEXT_ITERATIONS ||
        toolCalls.length === 0
    ) {
        return 'executorNode'; // P0-1: Return actual node name
    }

    // Otherwise, loop back to context plan
    return 'contextPlan';
}
