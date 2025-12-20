export interface Screenshot {
    id: number;
    captured_at: number;
    file_path: string;
    file_size: number;
}

export interface Observation {
    id: number;
    batch_id: number;
    start_ts: number;
    end_ts: number;
    observation: string;
    llm_model: string;
}

export interface ActivityCard {
    id: number;
    batch_id: number;
    start_ts: number;
    end_ts: number;
    category: 'Work' | 'Personal' | 'Distraction' | 'Idle';
    subcategory?: string;
    title: string;
    summary: string;
    detailed_summary?: string;
    video_url?: string;
    created_at: string;
    observations?: Observation[]; // Populated in detail view
}
