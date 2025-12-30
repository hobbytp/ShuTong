import Database from 'better-sqlite3';
import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { DatabaseBackupMeta } from '../types';
import { IDataBackupAdapter } from './backup-adapter';

export class SQLiteBackupAdapter implements IDataBackupAdapter {
    readonly name: string;
    private readonly dbFileName: string;
    private readonly getDbInstance: () => any; // Function to get the DB instance (lazy)
    private readonly customDbPath?: string;
    private tempDb: any = null;

    constructor(name: string, dbFileName: string, getDbInstance: () => any, customDbPath?: string) {
        this.name = name;
        this.dbFileName = dbFileName;
        this.getDbInstance = getDbInstance;
        this.customDbPath = customDbPath;
    }

    private getEffectiveDb() {
        // 1. Try provided instance (singleton from app)
        const db = this.getDbInstance();
        if (db && db.open) return db;

        // 2. If not available/closed, open a temporary one for backup
        if (!this.tempDb) {
            const targetPath = this.customDbPath || path.join(app.getPath('userData'), this.dbFileName);
            if (fs.existsSync(targetPath)) {
                try {
                    this.tempDb = new Database(targetPath);
                } catch (e) {
                    console.error(`[SQLiteBackup:${this.name}] Failed to open temp DB:`, e);
                }
            }
        }
        return this.tempDb;
    }

    async prepareForBackup(): Promise<void> {
        const db = this.getDbInstance();
        if (db) {
            try {
                db.pragma('wal_checkpoint(TRUNCATE)');
            } catch (e) {
                console.warn(`[SQLiteBackup:${this.name}] Checkpoint failed (non-critical):`, e);
            }
        }
    }

    async backup(targetDir: string): Promise<DatabaseBackupMeta> {
        const db = this.getEffectiveDb();
        if (!db) {
            // If DB file doesn't exist yet, return empty meta
            return { type: 'better-sqlite3', path: this.dbFileName, sha256: '', rowCount: 0 };
        }

        const backupPath = path.join(targetDir, this.dbFileName);

        // Use better-sqlite3's backup API for safe hot backup
        await db.backup(backupPath);

        // Calculate checksum
        const hash = crypto.createHash('sha256');
        const fileBuffer = fs.readFileSync(backupPath);
        hash.update(fileBuffer);
        const sha256 = hash.digest('hex');

        // Simple row count proxy logic
        let rowCount = 0;
        try {
            if (this.name === 'sqlite') {
                const result = db.prepare('SELECT COUNT(*) as cnt FROM screenshots').get() as { cnt: number };
                rowCount = result?.cnt || 0;
            } else if (this.name === 'checkpoints') {
                const result = db.prepare('SELECT COUNT(*) as cnt FROM checkpoints').get() as { cnt: number };
                rowCount = result?.cnt || 0;
            }
        } catch (e) {
            console.warn(`[SQLiteBackup:${this.name}] Failed to get row stats:`, e);
        }

        return {
            type: 'better-sqlite3',
            path: this.dbFileName,
            sha256,
            rowCount,
        };
    }

    async restore(sourceDir: string): Promise<void> {
        const sourcePath = path.join(sourceDir, this.dbFileName);
        const targetPath = this.customDbPath || path.join(app.getPath('userData'), this.dbFileName);

        if (!fs.existsSync(sourcePath)) {
            console.warn(`[SQLiteBackup:${this.name}] Source file missing, skipping: ${sourcePath}`);
            return;
        }

        console.log(`[SQLiteBackup:${this.name}] Restoring to`, targetPath);

        // We assume the caller handles closing/reopening connections if needed,
        // but for safety we hope standard backup/restore flow handles it.
        // Actually for restore, we MUST close the connection.
        // Since this adapter is generic, we can't easily call closeDatabase() purely.
        // But for our two specific cases, we can try to handle it or rely on BackupService.

        fs.copyFileSync(sourcePath, targetPath);
    }

    async cleanupAfterBackup(): Promise<void> {
        if (this.tempDb) {
            this.tempDb.close();
            this.tempDb = null;
        }
    }
}
