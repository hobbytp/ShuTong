/**
 * Database Connection Manager
 * 
 * Centralized database connection management.
 * Provides the single Database instance used by all repositories.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

let db: Database.Database | null = null;

/**
 * Get the database file path.
 */
export function getDbPath(): string {
    return path.join(app.getPath('userData'), 'shutong.sqlite');
}

/**
 * Get the database instance.
 * Must call initDatabase() before using this.
 */
export function getDatabase(): Database.Database | null {
    return db;
}

/**
 * Initialize the database connection.
 * Should be called once at app startup.
 */
export function initDatabase(): Database.Database {
    if (db) return db;

    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');

    // Create tables
    createTables(db);

    console.log('[Database] Initialized at', getDbPath());
    return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
        console.log('[Database] Closed');
    }
}

/**
 * Create all database tables.
 */
function createTables(database: Database.Database): void {
    // Legacy tables
    database.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            summary TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            type TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    `);

    // Phase 6 tables
    database.exec(`
        CREATE TABLE IF NOT EXISTS screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            is_deleted INTEGER DEFAULT 0,
            capture_type TEXT,
            app_bundle_id TEXT,
            window_title TEXT,
            monitor_id TEXT,
            roi_x INTEGER,
            roi_y INTEGER,
            roi_w INTEGER,
            roi_h INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at);

        CREATE TABLE IF NOT EXISTS analysis_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_start_ts INTEGER NOT NULL,
            batch_end_ts INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_batches_status ON analysis_batches(status);

        CREATE TABLE IF NOT EXISTS batch_screenshots (
            batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
            screenshot_id INTEGER NOT NULL REFERENCES screenshots(id),
            PRIMARY KEY (batch_id, screenshot_id)
        );

        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL REFERENCES analysis_batches(id),
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            observation TEXT NOT NULL,
            llm_model TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS timeline_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER REFERENCES analysis_batches(id),
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            detailed_summary TEXT,
            video_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_timeline_cards_start_ts ON timeline_cards(start_ts);

        CREATE TABLE IF NOT EXISTS pulse_cards (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            suggested_actions TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pulse_cards_created_at ON pulse_cards(created_at);

        CREATE TABLE IF NOT EXISTS window_switches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            from_app TEXT,
            from_title TEXT,
            to_app TEXT NOT NULL,
            to_title TEXT NOT NULL,
            screenshot_id INTEGER,
            skip_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_window_switches_timestamp ON window_switches(timestamp);
    `);

    // Migrations
    try {
        database.prepare('ALTER TABLE screenshots ADD COLUMN monitor_id TEXT').run();
    } catch (e) {
        // Ignore error if column already exists
    }

    try {
        database.prepare('ALTER TABLE screenshots ADD COLUMN roi_x INTEGER').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for roi_x:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE screenshots ADD COLUMN roi_y INTEGER').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for roi_y:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE screenshots ADD COLUMN roi_w INTEGER').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for roi_w:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE screenshots ADD COLUMN roi_h INTEGER').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for roi_h:', e);
        }
    }
}
