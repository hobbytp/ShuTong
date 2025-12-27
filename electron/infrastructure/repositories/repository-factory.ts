/**
 * Repository Factory
 * 
 * Creates and provides repository instances using the current database connection.
 * This is the main entry point for accessing repositories.
 */

import type Database from 'better-sqlite3';
import type { IBatchRepository, IRepositoryFactory, IScreenshotRepository, ISettingsRepository, ITimelineCardRepository } from './interfaces';
import { SQLiteScreenshotRepository } from './sqlite-screenshot.repository';
import { SQLiteTimelineCardRepository } from './sqlite-timeline-card.repository';

// Singleton instances
let screenshotRepo: IScreenshotRepository | null = null;
let timelineCardRepo: ITimelineCardRepository | null = null;

/**
 * Create or get the repository factory for the given database.
 * Repositories are lazily instantiated and cached.
 */
export function createRepositoryFactory(db: Database.Database): IRepositoryFactory {
    // Lazily create repositories
    if (!screenshotRepo) {
        screenshotRepo = new SQLiteScreenshotRepository(db);
    }
    if (!timelineCardRepo) {
        timelineCardRepo = new SQLiteTimelineCardRepository(db);
    }

    return {
        screenshots: screenshotRepo,
        timelineCards: timelineCardRepo,
        // Placeholder stubs until implemented
        batches: createBatchRepositoryStub(db),
        settings: createSettingsRepositoryStub(db),
    };
}

/**
 * Reset all repository instances (useful for testing).
 */
export function resetRepositories(): void {
    screenshotRepo = null;
    timelineCardRepo = null;
}

// Temporary stubs until full implementations are created
function createBatchRepositoryStub(_db: Database.Database): IBatchRepository {
    return {
        createWithScreenshots: () => null,
        getById: () => null,
        getByStatus: () => [],
        updateStatus: () => { },
        getScreenshotIds: () => [],
    };
}

function createSettingsRepositoryStub(_db: Database.Database): ISettingsRepository {
    return {
        getAll: () => ({}),
        get: () => null,
        set: () => { },
        delete: () => { },
    };
}
