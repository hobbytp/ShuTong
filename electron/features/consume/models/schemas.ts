// Schema interfaces for Context Agent

import { QueryType, ActionType, ReflectionType } from './enums';

export interface Intent {
    originalQuery: string;
    queryType: QueryType;
    enhancedQuery: string;
}

export interface ContextItem {
    id: string;
    content: string;
    source: string;
    relevanceScore?: number;
    metadata?: Record<string, any>;
}

export interface DocumentInfo {
    id: string;
    title: string;
    content: string;
    summary?: string;
    tags?: string[];
}

export interface ExecutionStep {
    action: ActionType;
    description: string;
    status?: 'pending' | 'running' | 'success' | 'failed';
    result?: string;
    startTime?: Date;
    endTime?: Date;
}

export interface ExecutionPlan {
    steps: ExecutionStep[];
}

export interface ExecutionResult {
    success: boolean;
    plan: ExecutionPlan;
    outputs: any[];
    errors: string[];
    executionTime?: number;
}

export interface ReflectionResult {
    reflectionType: ReflectionType;
    successRate: number;
    summary: string;
    issues: string[];
    improvements: string[];
    shouldRetry: boolean;
    retryStrategy?: string;
}

export interface ToolCall {
    toolName: string;
    parameters: Record<string, any>;
}

export interface ToolResult {
    toolName: string;
    success: boolean;
    result: any;
    error?: string;
}
