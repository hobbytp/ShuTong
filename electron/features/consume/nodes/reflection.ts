// Reflection Node - Evaluates execution results

import { AgentStateType } from '../models/state';
import { ReflectionResult, ExecutionResult } from '../models/schemas';
import { ReflectionType, ContextSufficiency, WorkflowStage } from '../models/enums';

const MAX_RETRIES = 1;

/**
 * Reflection Node - Evaluates results and decides on retry
 * P0-3: Uses retryCount instead of contextIteration for retry tracking
 */
export async function reflectionNode(
    state: AgentStateType
): Promise<Partial<AgentStateType>> {
    const execution = state.execution;
    const contextSufficiency = state.contextSufficiency;

    // 1. Evaluate execution results
    const evaluation = evaluateExecution(execution, contextSufficiency);

    // 2. Analyze issues
    const issues = analyzeIssues(execution, contextSufficiency);

    // 3. Generate improvements
    const improvements = generateImprovements(issues);

    // 4. Decide retry - P0-3: Use dedicated retryCount
    const currentRetries = state.retryCount || 0;
    const { shouldRetry, retryStrategy } = decideRetry(
        evaluation,
        issues,
        currentRetries
    );

    // 5. Generate summary
    const summary = generateSummary(evaluation, execution);

    const reflection: ReflectionResult = {
        reflectionType: evaluation.type,
        successRate: evaluation.successRate,
        summary,
        issues,
        improvements,
        shouldRetry,
        retryStrategy,
    };

    // Determine next stage
    const nextStage = shouldRetry
        ? WorkflowStage.CONTEXT_GATHERING
        : WorkflowStage.COMPLETED;

    return {
        reflection,
        stage: nextStage,
        // P0-3: Increment retryCount if retrying, reset contextIteration for new context loop
        retryCount: shouldRetry ? currentRetries + 1 : currentRetries,
        contextIteration: shouldRetry ? 0 : state.contextIteration,
    };
}

/**
 * Evaluate execution results
 * P1-4: Fixed type safety
 */
function evaluateExecution(
    execution: ExecutionResult | null,
    contextSufficiency: ContextSufficiency
): { type: ReflectionType; successRate: number } {
    if (!execution) {
        return { type: ReflectionType.FAILURE, successRate: 0 };
    }

    let successRate = execution.success ? 1.0 : 0.0;

    // Consider execution plan steps
    if (execution.plan?.steps?.length > 0) {
        const successfulSteps = execution.plan.steps.filter(
            (s) => s.status === 'success'
        ).length;
        successRate = successfulSteps / execution.plan.steps.length;
    }

    // Determine reflection type
    let type: ReflectionType;
    if (successRate >= 0.9) {
        type = ReflectionType.SUCCESS;
    } else if (successRate >= 0.5) {
        type = ReflectionType.PARTIAL_SUCCESS;
    } else {
        type = ReflectionType.FAILURE;
    }

    // Check if more info needed
    if (contextSufficiency === ContextSufficiency.INSUFFICIENT) {
        type = ReflectionType.NEED_MORE_INFO;
    }

    return { type, successRate };
}

/**
 * Analyze issues from execution
 * P1-4: Fixed type safety
 */
function analyzeIssues(
    execution: ExecutionResult | null,
    contextSufficiency: ContextSufficiency
): string[] {
    const issues: string[] = [];

    if (execution?.errors && execution.errors.length > 0) {
        for (const err of execution.errors) {
            issues.push(`Execution error: ${err}`);
        }
    }

    if (contextSufficiency === ContextSufficiency.INSUFFICIENT) {
        issues.push('Insufficient context information collected');
    }

    if (execution?.executionTime && execution.executionTime > 30) {
        issues.push(`Execution time too long: ${execution.executionTime.toFixed(1)}s`);
    }

    return issues;
}

/**
 * Generate improvement suggestions
 */
function generateImprovements(issues: string[]): string[] {
    const improvements: string[] = [];

    for (const issue of issues) {
        if (issue.includes('Insufficient context')) {
            improvements.push('Collect more relevant context information');
            improvements.push('Try using web search for latest information');
        } else if (issue.includes('Execution error')) {
            improvements.push('Check input parameter validity');
            improvements.push('Optimize error handling');
        } else if (issue.includes('too long')) {
            improvements.push('Optimize algorithm or use caching');
        }
    }

    if (improvements.length === 0) {
        improvements.push('Continue monitoring performance');
    }

    return improvements.slice(0, 5);
}

/**
 * Decide if retry is needed
 * P0-3: Now uses dedicated retryCount
 */
function decideRetry(
    evaluation: { type: ReflectionType; successRate: number },
    issues: string[],
    currentRetries: number
): { shouldRetry: boolean; retryStrategy?: string } {
    if (currentRetries >= MAX_RETRIES) {
        return { shouldRetry: false };
    }

    if (evaluation.type === ReflectionType.NEED_MORE_INFO) {
        return {
            shouldRetry: true,
            retryStrategy: 'Collect more context before retrying',
        };
    }

    if (evaluation.type === ReflectionType.FAILURE && evaluation.successRate < 0.3) {
        const hasTemporaryIssue = issues.some(
            (i) => i.includes('temporary') || i.includes('network')
        );
        if (hasTemporaryIssue) {
            return {
                shouldRetry: true,
                retryStrategy: 'Retry after delay (possible temporary issue)',
            };
        }
    }

    return { shouldRetry: false };
}

/**
 * Generate summary
 * P1-4: Fixed type safety
 */
function generateSummary(
    evaluation: { type: ReflectionType; successRate: number },
    execution: ExecutionResult | null
): string {
    const parts: string[] = [];

    switch (evaluation.type) {
        case ReflectionType.SUCCESS:
            parts.push('✅ Task completed successfully');
            break;
        case ReflectionType.PARTIAL_SUCCESS:
            parts.push('⚠️ Task partially completed');
            break;
        case ReflectionType.FAILURE:
            parts.push('❌ Task execution failed');
            break;
        case ReflectionType.NEED_MORE_INFO:
            parts.push('ℹ️ More information needed');
            break;
    }

    parts.push(`Success rate: ${(evaluation.successRate * 100).toFixed(0)}%`);

    if (execution?.outputs && execution.outputs.length > 0) {
        parts.push(`Generated ${execution.outputs.length} outputs`);
    }

    return parts.join(' | ');
}

/**
 * Router function for reflection node
 * P0-1: Returns actual node names
 */
export function reflectionRouter(state: AgentStateType): string {
    const reflection = state.reflection;

    if (reflection?.shouldRetry) {
        return 'contextPlan';
    }

    return '__end__';
}
