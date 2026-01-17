// Executor Node - Generates responses based on intent

import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { AgentStateType } from '../models/state';
import { ExecutionResult, ExecutionPlan, ExecutionStep, Intent, ContextItem } from '../models/schemas';
import { ActionType, QueryType, WorkflowStage } from '../models/enums';
import { getPromptManager } from '../../../llm/prompts/manager';
import { generateWithMessages } from '../llm/llm_client';

const promptManager = getPromptManager();

/**
 * Executor Node - Generates response based on intent type
 */
export async function executorNode(
    state: AgentStateType
): Promise<Partial<AgentStateType>> {
    const intent = state.intent;
    const contexts = state.contexts || [];

    if (!intent) {
        return {
            errors: ['Execution failed: no intent available'],
            stage: WorkflowStage.FAILED,
        };
    }

    // 1. Generate execution plan
    const plan = generateExecutionPlan(intent.queryType);

    // 2. Execute based on query type
    let result: { success: boolean; output: string; error?: string };

    try {
        switch (intent.queryType) {
            case QueryType.QA_ANALYSIS:
                result = await executeWithPrompt(
                    'chat_workflow.executor.answer',
                    intent,
                    contexts,
                    'You are a helpful assistant. Use the provided context to answer the user query accurately.',
                    `Query: ${intent.originalQuery}`
                );
                break;
            case QueryType.DOCUMENT_EDIT:
                result = await executeWithPrompt(
                    'chat_workflow.executor.edit',
                    intent,
                    contexts,
                    'You are an editor. Edit or rewrite the content based on the user request.',
                    `Edit request: ${intent.originalQuery}`
                );
                break;
            case QueryType.CONTENT_GENERATION:
                result = await executeWithPrompt(
                    'chat_workflow.executor.generate',
                    intent,
                    contexts,
                    'You are a content generator. Generate content based on the user request and context.',
                    `Generate: ${intent.originalQuery}`
                );
                break;
            default:
                result = await executeWithPrompt(
                    'chat_workflow.executor.answer',
                    intent,
                    contexts,
                    'You are a helpful assistant.',
                    `Query: ${intent.originalQuery}`
                );
        }
    } catch (error) {
        result = {
            success: false,
            output: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }

    // P1-7: Update step status
    if (plan.steps.length > 0) {
        plan.steps[0].status = result.success ? 'success' : 'failed';
        plan.steps[0].endTime = new Date();
    }

    // 3. Build execution result
    const executionResult: ExecutionResult = {
        success: result.success,
        plan,
        outputs: result.success ? [{ type: 'content', content: result.output }] : [],
        errors: result.error ? [result.error] : [],
    };

    return {
        execution: executionResult,
        finalContent: result.output,
        stage: WorkflowStage.REFLECTION,
    };
}

/**
 * Generate execution plan based on query type
 * P1-7: Initialize step with proper status
 */
function generateExecutionPlan(queryType: QueryType): ExecutionPlan {
    const steps: ExecutionStep[] = [];

    switch (queryType) {
        case QueryType.QA_ANALYSIS:
            steps.push({
                action: ActionType.ANSWER,
                description: 'Generate answer',
                status: 'running',
                startTime: new Date(),
            });
            break;
        case QueryType.DOCUMENT_EDIT:
            steps.push({
                action: ActionType.EDIT,
                description: 'Edit document',
                status: 'running',
                startTime: new Date(),
            });
            break;
        case QueryType.CONTENT_GENERATION:
            steps.push({
                action: ActionType.GENERATE,
                description: 'Generate content',
                status: 'running',
                startTime: new Date(),
            });
            break;
    }

    return { steps };
}

/**
 * P2-9: DRY - Common execution function for all prompt types
 */
async function executeWithPrompt(
    promptPath: string,
    intent: Intent,
    contexts: ContextItem[],
    defaultSystemPrompt: string,
    defaultUserPromptPrefix: string
): Promise<{ success: boolean; output: string; error?: string }> {
    try {
        const contextSummary = prepareContextSummary(contexts);

        const systemPrompt = promptManager.getPrompt(
            `${promptPath}.system`,
            {},
            defaultSystemPrompt
        );
        const userPrompt = promptManager.getPrompt(
            `${promptPath}.user`,
            {
                query: intent.originalQuery,
                enhanced_query: intent.enhancedQuery,
                collected_contexts: contextSummary,
                chat_history: '',
                current_document: '',
                selected_content: '',
            },
            `${defaultUserPromptPrefix}\n\nContext:\n${contextSummary}`
        );

        const messages: BaseMessage[] = [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ];

        const response = await generateWithMessages(messages);
        return { success: true, output: response };
    } catch (error) {
        return {
            success: false,
            output: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Prepare context summary for prompt
 */
function prepareContextSummary(contexts: ContextItem[]): string {
    if (contexts.length === 0) {
        return 'No additional context available.';
    }

    return contexts
        .slice(0, 5)
        .map((ctx, i) => {
            const content = ctx.content || '';
            const truncated = content.length > 500 ? content.substring(0, 500) + '...' : content;
            return `[${i + 1}] ${ctx.source}: ${truncated}`;
        })
        .join('\n\n');
}
