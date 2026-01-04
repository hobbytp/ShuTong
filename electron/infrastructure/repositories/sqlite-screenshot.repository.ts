/**
 * SQLite Screenshot Repository Implementation
 * 
 * Implements IScreenshotRepository using better-sqlite3.
 */

import type Database from 'better-sqlite3';
import type { IScreenshotRepository, Screenshot } from './interfaces';

export class SQLiteScreenshotRepository implements IScreenshotRepository {
    constructor(private db: Database.Database) { }

    save(data: {
        filePath: string;
        capturedAt: number;
        fileSize?: number;
        captureType?: string;
        appBundleId?: string;
        windowTitle?: string;
        monitorId?: string;
        roi?: { x: number; y: number; w: number; h: number };
    }): number | null {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO screenshots (
                    file_path, captured_at, file_size, capture_type, 
                    app_bundle_id, window_title, monitor_id, 
                    roi_x, roi_y, roi_w, roi_h
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(
                data.filePath,
                data.capturedAt,
                data.fileSize ?? null,
                data.captureType ?? null,
                data.appBundleId ?? null,
                data.windowTitle ?? null,
                data.monitorId ?? null,
                data.roi?.x ?? null,
                data.roi?.y ?? null,
                data.roi?.w ?? null,
                data.roi?.h ?? null
            );
            return result.lastInsertRowid as number;
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to save:', err);
            return null;
        }
    }

    getByIds(ids: number[]): Screenshot[] {
        if (ids.length === 0) return [];
        try {
            const placeholders = ids.map(() => '?').join(',');
            const stmt = this.db.prepare(`
                SELECT * FROM screenshots WHERE id IN (${placeholders})
            `);
            return stmt.all(...ids) as Screenshot[];
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to getByIds:', err);
            return [];
        }
    }

    getUnprocessed(sinceTimestamp: number): Screenshot[] {
        try {
            const stmt = this.db.prepare(`
                SELECT s.*
                FROM screenshots s
                LEFT JOIN batch_screenshots bs ON s.id = bs.screenshot_id
                WHERE bs.batch_id IS NULL
                  AND s.captured_at >= ?
                  AND s.is_deleted = 0
                ORDER BY s.captured_at ASC
            `);
            return stmt.all(sinceTimestamp) as Screenshot[];
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to getUnprocessed:', err);
            return [];
        }
    }

    getForBatch(batchId: number): Screenshot[] {
        try {
            const stmt = this.db.prepare(`
                SELECT s.*
                FROM screenshots s
                JOIN batch_screenshots bs ON s.id = bs.screenshot_id
                WHERE bs.batch_id = ?
                ORDER BY s.captured_at ASC
            `);
            return stmt.all(batchId) as Screenshot[];
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to getForBatch:', err);
            return [];
        }
    }

    getBefore(timestamp: number): Pick<Screenshot, 'id' | 'file_path'>[] {
        try {
            const stmt = this.db.prepare(`
                SELECT id, file_path FROM screenshots
                WHERE captured_at < ? AND is_deleted = 0
            `);
            return stmt.all(timestamp) as Pick<Screenshot, 'id' | 'file_path'>[];
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to getBefore:', err);
            return [];
        }
    }

    deleteBefore(timestamp: number): void {
        try {
            const stmt = this.db.prepare(`
                DELETE FROM screenshots WHERE captured_at < ?
            `);
            stmt.run(timestamp);
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to deleteBefore:', err);
        }
    }

    markDeleted(id: number): void {
        try {
            const stmt = this.db.prepare(`
                UPDATE screenshots SET is_deleted = 1 WHERE id = ?
            `);
            stmt.run(id);
        } catch (err) {
            console.error('[ScreenshotRepo] Failed to markDeleted:', err);
        }
    }
}
