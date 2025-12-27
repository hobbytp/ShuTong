/**
 * Repository Interfaces
 * 
 * Defines abstract interfaces for data access layer.
 * Implementation can be swapped (SQLite, in-memory mock, etc.)
 * without changing business logic.
 * 
 * Benefits:
 * - Testability: Use in-memory mocks for unit tests
 * - Flexibility: Can swap SQLite for other storage
 * - Separation: Business logic doesn't depend on storage details
 */

// =============================================================================
// Common Types
// =============================================================================

export interface Screenshot {
    id: number;
    captured_at: number;       // Unix timestamp (seconds)
    file_path: string;
    file_size: number | null;
    is_deleted: number;        // 0 or 1
    capture_type: string | null;
    app_bundle_id: string | null;
    window_title: string | null;
}

export interface AnalysisBatch {
    id: number;
    batch_start_ts: number;
    batch_end_ts: number;
    status: 'pending' | 'processing' | 'analyzed' | 'failed';
    reason: string | null;
    created_at: string;
}

export interface TimelineCard {
    id: number;
    batch_id: number | null;
    start_ts: number;
    end_ts: number;
    category: string;
    subcategory: string | null;
    title: string;
    summary: string;
    detailed_summary: string | null;
    video_url: string | null;
    created_at?: string;
}

export interface Observation {
    id: number;
    batch_id: number;
    start_ts: number;
    end_ts: number;
    observation: string;
    llm_model: string | null;
    created_at: string;
}

// =============================================================================
// Screenshot Repository Interface
// =============================================================================

export interface IScreenshotRepository {
    /**
     * Save a new screenshot record.
     * Returns the ID of the inserted record.
     */
    save(data: {
        filePath: string;
        capturedAt: number;
        fileSize?: number;
        captureType?: string;
        appBundleId?: string;
        windowTitle?: string;
    }): number | null;

    /**
     * Get screenshots by IDs.
     */
    getByIds(ids: number[]): Screenshot[];

    /**
     * Get screenshots not yet assigned to any batch.
     */
    getUnprocessed(sinceTimestamp: number): Screenshot[];

    /**
     * Get screenshots for a specific batch.
     */
    getForBatch(batchId: number): Screenshot[];

    /**
     * Get screenshots before a timestamp (for cleanup).
     */
    getBefore(timestamp: number): Pick<Screenshot, 'id' | 'file_path'>[];

    /**
     * Delete screenshots before a timestamp.
     */
    deleteBefore(timestamp: number): void;

    /**
     * Mark screenshot as deleted (soft delete).
     */
    markDeleted(id: number): void;
}

// =============================================================================
// Timeline Card Repository Interface
// =============================================================================

export interface ITimelineCardRepository {
    /**
     * Save a new timeline card.
     * Returns the ID of the inserted card.
     */
    save(card: {
        batchId?: number;
        startTs: number;
        endTs: number;
        category: string;
        subcategory?: string;
        title: string;
        summary: string;
        detailedSummary?: string;
        videoUrl?: string;
    }): number | null;

    /**
     * Get a card by ID with optional screenshots.
     */
    getById(id: number): TimelineCard | null;

    /**
     * Get cards with pagination and optional filters.
     */
    getMany(options: {
        limit: number;
        offset: number;
        search?: string;
        category?: string;
    }): TimelineCard[];

    /**
     * Get all distinct categories.
     */
    getCategories(): string[];

    /**
     * Update an existing card.
     */
    update(id: number, updates: Partial<Omit<TimelineCard, 'id'>>): boolean;

    /**
     * Delete a card.
     */
    delete(id: number): boolean;
}

// =============================================================================
// Analysis Batch Repository Interface
// =============================================================================

export interface IBatchRepository {
    /**
     * Create a new batch and link screenshots to it.
     * Returns the batch ID.
     */
    createWithScreenshots(
        startTs: number,
        endTs: number,
        screenshotIds: number[]
    ): number | null;

    /**
     * Get batch by ID.
     */
    getById(id: number): AnalysisBatch | null;

    /**
     * Get batches by status.
     */
    getByStatus(status: AnalysisBatch['status'], limit?: number): AnalysisBatch[];

    /**
     * Update batch status.
     */
    updateStatus(id: number, status: AnalysisBatch['status'], reason?: string): void;

    /**
     * Get screenshot IDs for a batch.
     */
    getScreenshotIds(batchId: number): number[];
}

// =============================================================================
// Settings Repository Interface
// =============================================================================

export interface ISettingsRepository {
    /**
     * Get all settings as key-value pairs.
     */
    getAll(): Record<string, string>;

    /**
     * Get a single setting by key.
     */
    get(key: string): string | null;

    /**
     * Set a setting value.
     */
    set(key: string, value: string): void;

    /**
     * Delete a setting.
     */
    delete(key: string): void;
}

// =============================================================================
// Repository Factory Interface
// =============================================================================

/**
 * Factory for creating repository instances.
 * Useful for dependency injection and testing.
 */
export interface IRepositoryFactory {
    screenshots: IScreenshotRepository;
    timelineCards: ITimelineCardRepository;
    batches: IBatchRepository;
    settings: ISettingsRepository;
}
