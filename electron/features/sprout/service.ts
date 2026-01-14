import { getDatabase } from '../../infrastructure/database/db-connection';
import { SproutReport, SproutSession, SproutMessage } from '../../../shared/sprout';
import { v4 as uuidv4 } from 'uuid';

export class SproutService {

    static createSprout(topic: string): SproutSession {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const session: SproutSession = {
            id: uuidv4(),
            topic,
            status: 'active',
            created_at: Date.now(),
            heatmap_score: 0
        };

        db.prepare(`
            INSERT INTO sprouts (id, topic, status, created_at, heatmap_score)
            VALUES (@id, @topic, @status, @created_at, @heatmap_score)
        `).run(session);

        return session;
    }

    static addMessage(sproutId: string, role: string, content: string, name?: string): SproutMessage {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const message: SproutMessage = {
            id: uuidv4(),
            sprout_id: sproutId,
            role: role as any,
            name,
            content,
            timestamp: Date.now()
        };

        db.prepare(`
            INSERT INTO sprout_messages (id, sprout_id, role, name, content, timestamp)
            VALUES (@id, @sprout_id, @role, @name, @content, @timestamp)
        `).run(message);

        // Update heatmap score slightly for activity
        db.prepare('UPDATE sprouts SET heatmap_score = heatmap_score + 1 WHERE id = ?').run(sproutId);

        return message;
    }

    static completeSprout(sproutId: string, report: SproutReport): void {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const reportId = uuidv4();

        const transaction = db.transaction(() => {
            db.prepare(`
                INSERT INTO sprout_reports (id, sprout_id, json_data)
                VALUES (?, ?, ?)
            `).run(reportId, sproutId, JSON.stringify(report));

            db.prepare(`
                UPDATE sprouts SET status = 'completed' WHERE id = ?
            `).run(sproutId);
        });

        transaction();
    }

    static getHistory(): SproutSession[] {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const sprouts = db.prepare(`
            SELECT * FROM sprouts ORDER BY created_at DESC
        `).all() as SproutSession[];

        return sprouts;
    }

    static getSproutDetails(sproutId: string): { session: SproutSession, messages: SproutMessage[], report: SproutReport | null } {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const session = db.prepare('SELECT * FROM sprouts WHERE id = ?').get(sproutId) as SproutSession;
        if (!session) throw new Error('Sprout not found');

        const messages = db.prepare(`
            SELECT * FROM sprout_messages WHERE sprout_id = ? ORDER BY timestamp ASC
        `).all(sproutId) as SproutMessage[];

        const reportRow = db.prepare('SELECT json_data FROM sprout_reports WHERE sprout_id = ?').get(sproutId) as { json_data: string };
        const report = reportRow ? JSON.parse(reportRow.json_data) : null;

        return { session, messages, report };
    }

    static deleteSprout(sproutId: string): void {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        // FKs are ON DELETE CASCADE, so simple deletion works
        db.prepare('DELETE FROM sprouts WHERE id = ?').run(sproutId);
    }
}
