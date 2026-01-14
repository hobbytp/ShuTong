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

import { metrics } from '../monitoring/metrics-collector';

// ... import Database ...

// ...

/**
 * Initialize the database connection.
 * Should be called once at app startup.
 */
export function initDatabase(): Database.Database {
    if (db) return db;

    const rawDb = new Database(getDbPath());
    rawDb.pragma('journal_mode = WAL');

    // Create tables (use rawDb to avoid metric noise during startup)
    createTables(rawDb);

    // Instrument with Proxy for RED metrics
    db = new Proxy(rawDb, {
        get(target, prop, receiver) {
            // Get the value from the target directly
            const value = Reflect.get(target, prop, receiver);

            // If it's a function, we might need to bind it or intercept it
            if (typeof value === 'function') {
                if (prop === 'prepare') {
                    return function (this: any, ...args: any[]) {
                        // Apply to TARGET (rawDb), not 'this' (the proxy)
                        const stmt = value.apply(target, args);
                        return proxyStatement(stmt, args[0] as string);
                    };
                }

                if (prop === 'exec') {
                    return function (this: any, ...args: any[]) {
                        const timer = metrics.startTimer('db.query_duration_seconds', { operation: 'EXEC', table: 'multiple' });
                        metrics.incCounter('db.queries_total', { operation: 'EXEC', table: 'multiple' });
                        try {
                            // Apply to TARGET
                            const res = value.apply(target, args);
                            timer.end();
                            return res;
                        } catch (e) {
                            metrics.incCounter('db.errors_total', { operation: 'EXEC', table: 'multiple' });
                            throw e;
                        }
                    };
                }

                // For other functions (like pragma, close, etc.), bind to target
                // to avoid "Illegal invocation"
                return value.bind(target);
            }

            return value;
        }
    });

    console.log('[Database] Initialized at', getDbPath());
    return db;
}

function proxyStatement(stmt: any, sql: string) {
    // Simple parsing for operation and table
    const normalized = sql.trim().toUpperCase();
    const operation = normalized.split(' ')[0] || 'UNKNOWN';
    let table = 'unknown';

    try {
        if (operation === 'SELECT') {
            const match = normalized.match(/FROM\s+([^\s(;]+)/i);
            if (match) table = match[1].replace(/["`]/g, '');
        } else if (operation === 'INSERT') {
            const match = normalized.match(/INTO\s+([^\s(;]+)/i);
            if (match) table = match[1].replace(/["`]/g, '');
        } else if (operation === 'UPDATE') {
            const match = normalized.match(/UPDATE\s+([^\s(;]+)/i);
            if (match) table = match[1].replace(/["`]/g, '');
        } else if (operation === 'DELETE') {
            const match = normalized.match(/FROM\s+([^\s(;]+)/i);
            if (match) table = match[1].replace(/["`]/g, '');
        }
    } catch { /* ignore parsing errors */ }

    // Sanitize table name (remove schema or weird chars if any)
    table = table.split('.').pop() || table;

    return new Proxy(stmt, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);

            if (typeof value === 'function') {
                // Intercept execution methods
                if (['run', 'get', 'all', 'iterate'].includes(prop as string)) {
                    return function (this: any, ...args: any[]) {
                        const timer = metrics.startTimer('db.query_duration_seconds', { operation, table });
                        metrics.incCounter('db.queries_total', { operation, table });

                        try {
                            // Apply to TARGET (stmt)
                            const result = value.apply(target, args);
                            timer.end();
                            return result;
                        } catch (err) {
                            metrics.incCounter('db.errors_total', { operation, table });
                            throw err;
                        }
                    };
                }

                // Bind other methods (bind, columns, etc.) to target
                return value.bind(target);
            }

            return value;
        }
    });
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
    // ...
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
            context_type TEXT,
            entities TEXT,
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

    try {
        database.prepare('ALTER TABLE observations ADD COLUMN context_type TEXT').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for context_type:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE observations ADD COLUMN entities TEXT').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for entities:', e);
        }
    }

    // New migrations for Topic Tracking - REVERTED
    // We are no longer using project_name and domain columns
    // Keeping try-catch block to avoid errors on existing DBs but no new columns added


    // New Tables for Topic Feature - REVERTED
    // We are using JSON-based topic definitions in a simpler table or file
    database.exec(`
        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            definition TEXT NOT NULL, -- JSON string of rules/keywords
            color TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    try {
        database.prepare('ALTER TABLE timeline_cards ADD COLUMN is_merged INTEGER DEFAULT 0').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for is_merged:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE window_switches ADD COLUMN duration INTEGER').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for duration:', e);
        }
    }

    try {
        database.prepare('ALTER TABLE window_switches ADD COLUMN app_name TEXT').run();
        // Since we are adding app_name, we should probably migrate existing rows to copy from to_app
        database.prepare('UPDATE window_switches SET app_name = to_app WHERE app_name IS NULL').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for app_name:', e);
        }
    }


    try {
        database.prepare('ALTER TABLE window_switches ADD COLUMN window_title TEXT').run();
        // Migrate existing rows to copy from to_title
        database.prepare('UPDATE window_switches SET window_title = to_title WHERE window_title IS NULL').run();
    } catch (e: any) {
        if (!e.message.includes('duplicate column name')) {
            console.error('[Database] Migration failed for window_title:', e);
        }
    }

    // Sprouts Feature Tables
    database.exec(`
        CREATE TABLE IF NOT EXISTS sprouts (
            id TEXT PRIMARY KEY,
            topic TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'completed')),
            created_at INTEGER NOT NULL,
            heatmap_score INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sprouts_created_at ON sprouts(created_at);

        CREATE TABLE IF NOT EXISTS sprout_messages (
            id TEXT PRIMARY KEY,
            sprout_id TEXT NOT NULL REFERENCES sprouts(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            name TEXT,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sprout_messages_sprout_id ON sprout_messages(sprout_id);
        CREATE INDEX IF NOT EXISTS idx_sprout_messages_timestamp ON sprout_messages(timestamp);
        
        CREATE TABLE IF NOT EXISTS sprout_reports (
            id TEXT PRIMARY KEY,
            sprout_id TEXT NOT NULL REFERENCES sprouts(id) ON DELETE CASCADE,
            json_data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sprout_reports_sprout_id ON sprout_reports(sprout_id);
    `);
}
