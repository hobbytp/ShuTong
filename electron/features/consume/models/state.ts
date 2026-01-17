// AgentState definition using LangGraph Annotation API

import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import {
    Intent,
    ContextItem,
    ExecutionResult,
    ReflectionResult,
    ToolCall,
} from './schemas';
import { ContextSufficiency, WorkflowStage } from './enums';

// Define the agent state using Annotation.Root
export const AgentState = Annotation.Root({
    // User query
    query: Annotation<string>({
        reducer: (_, b) => b,
        default: () => '',
    }),

    // Optional document ID for document-related queries
    documentId: Annotation<string | null>({
        reducer: (_, b) => b,
        default: () => null,
    }),

    // Chat history for context
    chatHistory: Annotation<BaseMessage[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
    }),

    // Intent analysis result
    intent: Annotation<Intent | null>({
        reducer: (_, b) => b,
        default: () => null,
    }),

    // Collected context items (uses concat reducer for accumulation)
    contexts: Annotation<ContextItem[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
    }),

    // Context sufficiency status
    contextSufficiency: Annotation<ContextSufficiency>({
        reducer: (_, b) => b,
        default: () => ContextSufficiency.INSUFFICIENT,
    }),

    // Current iteration count for context gathering loop
    contextIteration: Annotation<number>({
        reducer: (_, b) => b,
        default: () => 0,
    }),

    // Planned tool calls for context gathering
    plannedToolCalls: Annotation<ToolCall[]>({
        reducer: (_, b) => b,
        default: () => [],
    }),

    // Execution result
    execution: Annotation<ExecutionResult | null>({
        reducer: (_, b) => b,
        default: () => null,
    }),

    // Reflection result
    reflection: Annotation<ReflectionResult | null>({
        reducer: (_, b) => b,
        default: () => null,
    }),

    // Current workflow stage
    stage: Annotation<WorkflowStage>({
        reducer: (_, b) => b,
        default: () => WorkflowStage.INTENT_ANALYSIS,
    }),

    // Error accumulator
    errors: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
    }),

    // Retry count for reflection-driven retries (separate from context iteration)
    retryCount: Annotation<number>({
        reducer: (_, b) => b,
        default: () => 0,
    }),

    // Final output content
    finalContent: Annotation<string>({
        reducer: (_, b) => b,
        default: () => '',
    }),
});

// Type alias for the state
export type AgentStateType = typeof AgentState.State;
