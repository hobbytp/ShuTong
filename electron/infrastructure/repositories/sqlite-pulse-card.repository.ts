import Database from 'better-sqlite3';
import { IPulseCardRepository, PulseCard } from './interfaces';

export class SQLitePulseCardRepository implements IPulseCardRepository {
    constructor(private db: Database.Database) { }

    save(card: PulseCard): boolean {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO pulse_cards (id, type, title, content, suggested_actions, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                card.id,
                card.type,
                card.title,
                card.content,
                JSON.stringify(card.suggested_actions || []),
                card.created_at
            );
            return true;
        } catch (err) {
            console.error('[PulseCardRepository] Failed to save:', err);
            return false;
        }
    }

    getMany(limit = 50): PulseCard[] {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM pulse_cards ORDER BY created_at DESC LIMIT ?
            `);
            const rows = stmt.all(limit) as any[];
            return rows.map(row => ({
                ...row,
                suggested_actions: JSON.parse(row.suggested_actions || '[]')
            }));
        } catch (err) {
            console.error('[PulseCardRepository] Failed to get many:', err);
            return [];
        }
    }

    getById(id: string): PulseCard | null {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM pulse_cards WHERE id = ? LIMIT 1
            `);
            const row = stmt.get(id) as any;
            if (!row) return null;
            return {
                ...row,
                suggested_actions: JSON.parse(row.suggested_actions || '[]')
            };
        } catch (err) {
            console.error('[PulseCardRepository] Failed to get by id:', err);
            return null;
        }
    }

    update(card: Pick<PulseCard, 'id'> & Partial<Omit<PulseCard, 'id'>>): boolean {
        try {
            const existing = this.getById(card.id);
            if (!existing) return false;

            const title = card.title ?? existing.title;
            const content = card.content ?? existing.content;
            const suggestedActions = card.suggested_actions ?? existing.suggested_actions;
            const createdAt = card.created_at ?? existing.created_at;

            const stmt = this.db.prepare(`
                UPDATE pulse_cards
                SET title = ?, content = ?, suggested_actions = ?, created_at = ?
                WHERE id = ?
            `);
            stmt.run(title, content, JSON.stringify(suggestedActions || []), createdAt, card.id);
            return true;
        } catch (err) {
            console.error('[PulseCardRepository] Failed to update:', err);
            return false;
        }
    }

    getLatestByType(type: string): PulseCard | null {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM pulse_cards WHERE type = ? ORDER BY created_at DESC LIMIT 1
            `);
            const row = stmt.get(type) as any;
            if (!row) return null;
            return {
                ...row,
                suggested_actions: JSON.parse(row.suggested_actions || '[]')
            };
        } catch (err) {
            console.error('[PulseCardRepository] Failed to get latest by type:', err);
            return null;
        }
    }
}
