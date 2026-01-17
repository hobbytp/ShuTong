// StreamEvent for streaming output

import { WorkflowStage, EventType } from './enums';

export interface StreamEvent {
    type: EventType;
    content: string;
    stage: WorkflowStage;
    progress?: number;
    metadata?: Record<string, any>;
}

export function createStreamEvent(
    type: EventType,
    content: string,
    stage: WorkflowStage,
    options?: { progress?: number; metadata?: Record<string, any> }
): StreamEvent {
    return {
        type,
        content,
        stage,
        progress: options?.progress,
        metadata: options?.metadata,
    };
}
