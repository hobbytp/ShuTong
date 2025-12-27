/**
 * Repository Factory
 * 
 * Creates and provides repository instances using the current database connection.
 * This is the main entry point for accessing repositories.
 */

import type Database from 'better-sqlite3';
import type { IBatchRepository, IRepositoryFactory } from './interfaces';
import { SQLiteJournalRepository } from './sqlite-journal.repository';
import { SQLitePulseCardRepository } from './sqlite-pulse-card.repository';
import { SQLiteScreenshotRepository } from './sqlite-screenshot.repository';
import { SQLiteSettingsRepository } from './sqlite-settings.repository';
import { SQLiteTimelineCardRepository } from './sqlite-timeline-card.repository';
import { SQLiteWindowSwitchRepository } from './sqlite-window-switch.repository';

// Temporary stub for Batch Repository (implementation still in storage.ts)
class BatchRepositoryStub implements IBatchRepository {
    constructor(_db: Database.Database) {
        void _db;
    }

    createWithScreenshots(_startTs: number, _endTs: number, _screenshotIds: number[]): number | null {
        // Still using storage.ts implementation for batches
        void _startTs;
        void _endTs;
        void _screenshotIds;
        return null; // Will be implemented later
    }

    getById() { return null; }
    getByStatus() { return []; }
    updateStatus() { }
    getScreenshotIds() { return []; }
}

/**
 * Create the repository factory for the given database.
 * All repositories are instantiated immediately.
 */
export function createRepositoryFactory(db: Database.Database): IRepositoryFactory {
    return {
        screenshots: new SQLiteScreenshotRepository(db),
        timelineCards: new SQLiteTimelineCardRepository(db),
        batches: new BatchRepositoryStub(db),
        settings: new SQLiteSettingsRepository(db),
        journals: new SQLiteJournalRepository(db),
        pulseCards: new SQLitePulseCardRepository(db),
        windowSwitches: new SQLiteWindowSwitchRepository(db),
    };
}
