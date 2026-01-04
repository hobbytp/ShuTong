export type ContextType = 'activity_context' | 'intent_context' | 'semantic_context' | 'procedural_context' | 'state_context';

export interface Entity {
    name: string;
    type: 'person' | 'project' | 'meeting' | 'document' | 'organization' | 'product' | 'location' | 'tool' | 'other';
    description?: string;
    aliases?: string[];
    metadata?: Record<string, any>;
}

export interface ContextItem {
    context_type: ContextType;
    title: string;
    summary: string;
    keywords: string[];
    importance: number;
    confidence: number;
    entities: Entity[];
    event_time?: string | null;
    screen_ids?: number[];
}

export interface AnalysisResult {
    items: ContextItem[];
}

export interface PromptTemplates {
    screenshot_analyze: string;
}
