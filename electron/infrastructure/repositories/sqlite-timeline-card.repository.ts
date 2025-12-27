/**
 * SQLite Timeline Card Repository Implementation
 * 
 * Implements ITimelineCardRepository using better-sqlite3.
 */

import type Database from 'better-sqlite3';
import type { ITimelineCardRepository, TimelineCard } from './interfaces';

export class SQLiteTimelineCardRepository implements ITimelineCardRepository {
    constructor(private db: Database.Database) { }

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
    }): number | null {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO timeline_cards 
                (batch_id, start_ts, end_ts, category, subcategory, title, summary, detailed_summary, video_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(
                card.batchId ?? null,
                card.startTs,
                card.endTs,
                card.category,
                card.subcategory ?? null,
                card.title,
                card.summary,
                card.detailedSummary ?? null,
                card.videoUrl ?? null
            );
            return result.lastInsertRowid as number;
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to save:', err);
            return null;
        }
    }

    getById(id: number): TimelineCard | null {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM timeline_cards WHERE id = ?
            `);
            return (stmt.get(id) as TimelineCard) ?? null;
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to getById:', err);
            return null;
        }
    }

    getMany(options: {
        limit: number;
        offset: number;
        search?: string;
        category?: string;
    }): TimelineCard[] {
        try {
            let sql = `SELECT * FROM timeline_cards WHERE 1=1`;
            const params: (string | number)[] = [];

            if (options.search) {
                sql += ` AND (title LIKE ? OR summary LIKE ?)`;
                const searchTerm = `%${options.search}%`;
                params.push(searchTerm, searchTerm);
            }

            if (options.category) {
                sql += ` AND category = ?`;
                params.push(options.category);
            }

            sql += ` ORDER BY start_ts DESC LIMIT ? OFFSET ?`;
            params.push(options.limit, options.offset);

            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as TimelineCard[];
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to getMany:', err);
            return [];
        }
    }

    getCategories(): string[] {
        try {
            const stmt = this.db.prepare(`
                SELECT DISTINCT category FROM timeline_cards ORDER BY category
            `);
            const rows = stmt.all() as { category: string }[];
            return rows.map(r => r.category);
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to getCategories:', err);
            return [];
        }
    }

    update(id: number, updates: Partial<Omit<TimelineCard, 'id'>>): boolean {
        try {
            const fields: string[] = [];
            const values: (string | number | null)[] = [];

            if (updates.category !== undefined) {
                fields.push('category = ?');
                values.push(updates.category);
            }
            if (updates.subcategory !== undefined) {
                fields.push('subcategory = ?');
                values.push(updates.subcategory);
            }
            if (updates.title !== undefined) {
                fields.push('title = ?');
                values.push(updates.title);
            }
            if (updates.summary !== undefined) {
                fields.push('summary = ?');
                values.push(updates.summary);
            }
            if (updates.detailed_summary !== undefined) {
                fields.push('detailed_summary = ?');
                values.push(updates.detailed_summary);
            }
            if (updates.video_url !== undefined) {
                fields.push('video_url = ?');
                values.push(updates.video_url);
            }

            if (fields.length === 0) return true;

            values.push(id);
            const stmt = this.db.prepare(`
                UPDATE timeline_cards SET ${fields.join(', ')} WHERE id = ?
            `);
            const result = stmt.run(...values);
            return result.changes > 0;
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to update:', err);
            return false;
        }
    }

    delete(id: number): boolean {
        try {
            const stmt = this.db.prepare(`DELETE FROM timeline_cards WHERE id = ?`);
            const result = stmt.run(id);
            return result.changes > 0;
        } catch (err) {
            console.error('[TimelineCardRepo] Failed to delete:', err);
            return false;
        }
    }
}
