import Database from 'better-sqlite3';
import { IJournalRepository, JournalEntry } from './interfaces';

export class SQLiteJournalRepository implements IJournalRepository {
    constructor(private db: Database.Database) { }

    add(entry: { content: string; type: 'intention' | 'reflection' }): number | null {
        try {
            const timestamp = new Date().toISOString();
            const stmt = this.db.prepare(`
                INSERT INTO journal (type, content, timestamp)
                VALUES (?, ?, ?)
            `);
            const result = stmt.run(entry.type, entry.content, timestamp);
            return result.lastInsertRowid as number;
        } catch (err) {
            console.error('[JournalRepository] Failed to add entry:', err);
            return null;
        }
    }

    getAll(): JournalEntry[] {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM journal ORDER BY id DESC
            `);
            return stmt.all() as JournalEntry[];
        } catch (err) {
            console.error('[JournalRepository] Failed to get all entries:', err);
            return [];
        }
    }

    getByType(type: 'intention' | 'reflection'): JournalEntry[] {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM journal 
                WHERE type = ? 
                ORDER BY id DESC
            `);
            return stmt.all(type) as JournalEntry[];
        } catch (err) {
            console.error(`[JournalRepository] Failed to get entries by type "${type}":`, err);
            return [];
        }
    }
}
