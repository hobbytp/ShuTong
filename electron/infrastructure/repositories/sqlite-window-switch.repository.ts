import Database from 'better-sqlite3';
import { IWindowSwitchRepository, WindowSwitchRecord } from './interfaces';

export class SQLiteWindowSwitchRepository implements IWindowSwitchRepository {
    constructor(private db: Database.Database) { }

    save(event: WindowSwitchRecord): number | null {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO window_switches (timestamp, from_app, from_title, to_app, to_title, screenshot_id, skip_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(
                event.timestamp,
                event.from_app,
                event.from_title,
                event.to_app,
                event.to_title,
                event.screenshot_id || null,
                event.skip_reason || null
            );
            return result.lastInsertRowid as number;
        } catch (err) {
            console.error('[WindowSwitchRepository] Failed to save:', err);
            return null;
        }
    }

    getInRange(startTs: number, endTs: number, limit = 100): WindowSwitchRecord[] {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT ?
            `);
            return stmt.all(startTs, endTs, limit) as WindowSwitchRecord[];
        } catch (err) {
            console.error('[WindowSwitchRepository] Failed to get in range:', err);
            return [];
        }
    }

    getDwellStats(startTs: number, endTs: number): { app: string; total_seconds: number }[] {
        try {
            // Calculate dwell time as difference between consecutive switches
            // Use SQL window function (LEAD) to get next timestamp
            const stmt = this.db.prepare(`
                WITH ranked AS (
                    SELECT 
                        to_app,
                        timestamp,
                        LEAD(timestamp) OVER (ORDER BY timestamp) as next_ts
                    FROM window_switches
                    WHERE timestamp >= ? AND timestamp <= ?
                )
                SELECT 
                    to_app as app,
                    SUM(COALESCE(next_ts, ?) - timestamp) as total_seconds
                FROM ranked
                WHERE to_app IS NOT NULL
                GROUP BY to_app
                ORDER BY total_seconds DESC
            `);
            return stmt.all(startTs, endTs, endTs) as { app: string; total_seconds: number }[];
        } catch (err) {
            console.error('[WindowSwitchRepository] Failed to get dwell stats:', err);
            return [];
        }
    }

    searchByTitle(query: string, limit = 20): { app: string; title: string }[] {
        try {
            const stmt = this.db.prepare(`
                SELECT DISTINCT to_app as app, to_title as title
                FROM window_switches
                WHERE to_title LIKE ? OR to_app LIKE ?
                LIMIT ?
            `);
            const searchTerm = `%${query}%`;
            return stmt.all(searchTerm, searchTerm, limit) as { app: string; title: string }[];
        } catch (err) {
            console.error('[WindowSwitchRepository] Failed to search by title:', err);
            return [];
        }
    }
}
