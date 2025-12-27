import Database from 'better-sqlite3';
import { ISettingsRepository } from './interfaces';

export class SQLiteSettingsRepository implements ISettingsRepository {
    constructor(private db: Database.Database) { }

    getAll(): Record<string, string> {
        try {
            const stmt = this.db.prepare('SELECT key, value FROM settings');
            const rows = stmt.all() as { key: string; value: string }[];
            const settings: Record<string, string> = {};
            for (const row of rows) {
                settings[row.key] = row.value;
            }
            return settings;
        } catch (err) {
            console.error('[SettingsRepository] Failed to get all settings:', err);
            return {};
        }
    }

    get(key: string): string | null {
        try {
            const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
            const row = stmt.get(key) as { value: string } | undefined;
            return row?.value ?? null;
        } catch (err) {
            console.error(`[SettingsRepository] Failed to get setting "${key}":`, err);
            return null;
        }
    }

    set(key: string, value: string): void {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO settings (key, value) 
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `);
            stmt.run(key, value);
        } catch (err) {
            console.error(`[SettingsRepository] Failed to set setting "${key}":`, err);
        }
    }

    delete(key: string): void {
        try {
            const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
            stmt.run(key);
        } catch (err) {
            console.error(`[SettingsRepository] Failed to delete setting "${key}":`, err);
        }
    }
}
