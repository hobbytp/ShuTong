// Enums for Context Agent workflow

export enum QueryType {
    SIMPLE_CHAT = 'simple_chat',
    QA_ANALYSIS = 'qa_analysis',
    DOCUMENT_EDIT = 'document_edit',
    CONTENT_GENERATION = 'content_generation',
}

export enum WorkflowStage {
    INTENT_ANALYSIS = 'intent_analysis',
    CONTEXT_GATHERING = 'context_gathering',
    EXECUTION = 'execution',
    REFLECTION = 'reflection',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

export enum ContextSufficiency {
    SUFFICIENT = 'sufficient',
    PARTIAL = 'partial',
    INSUFFICIENT = 'insufficient',
}

export enum ActionType {
    ANSWER = 'answer',
    EDIT = 'edit',
    GENERATE = 'generate',
}

export enum ReflectionType {
    SUCCESS = 'success',
    PARTIAL_SUCCESS = 'partial_success',
    FAILURE = 'failure',
    NEED_MORE_INFO = 'need_more_info',
}

export enum EventType {
    THINKING = 'thinking',
    RUNNING = 'running',
    STREAM_CHUNK = 'stream_chunk',
    DONE = 'done',
    FAIL = 'fail',
    NODE_COMPLETE = 'node_complete',
}
