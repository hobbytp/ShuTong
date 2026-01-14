export interface SproutReport {
    /**
     * The DNA of the idea: A First Principles definition or deep decoding.
     */
    core_essence: string;
    /**
     * A mental model or framework used to reframe the topic.
     * e.g. "Analyzed via 'Antifragility'"
     */
    mental_model_lens: string;
    /**
     * The insight gained from applying the lens.
     */
    perspective_shift: string;
    /**
     * Connections to distant fields (e.g., Biology, Architecture).
     */
    cross_pollination: {
        field: string;
        insight: string;
    }[];
    /**
     * High-value questions to provoke further thought.
     */
    rabbit_holes: {
        type: 'deepen' | 'invert' | 'expand';
        question: string;
    }[];
    /**
     * Concrete micro-experiments to test the idea.
     */
    experiments: {
        title: string;
        steps: string[];
    }[];
}

export interface SproutMessage {
    id: string;
    sprout_id?: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string;
    content: string;
    timestamp: number;
}

export interface SproutSession {
    id: string;
    topic: string;
    status: 'active' | 'completed';
    created_at: number;
    heatmap_score: number;
    report?: SproutReport;
}

