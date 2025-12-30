import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { DatabaseBackupMeta } from '../types';
import { IDataBackupAdapter } from './backup-adapter';

export class LanceDBBackupAdapter implements IDataBackupAdapter {
    readonly name: string;

    private readonly folderName: string;

    constructor(storeName: string, folderName: string) {
        this.name = `lancedb-${storeName}`;

        this.folderName = folderName;
    }

    async prepareForBackup(): Promise<void> {
        // Flush LanceDB - currently no explicit flush API
        // We rely on closing connections or ensuring no writes during backup
        // The BackupService should stop recording before backup
    }

    async backup(targetDir: string): Promise<DatabaseBackupMeta> {
        const sourcePath = path.join(app.getPath('userData'), this.folderName);
        const targetPath = path.join(targetDir, this.folderName);

        // If source doesn't exist, we just skip (return empty meta)
        if (!fs.existsSync(sourcePath)) {
            return {
                type: 'lancedb',
                path: this.folderName,
                sha256: '',
                rowCount: 0,
            };
        }

        // Ensure target parent exists (though targetDir usually exists)
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Recursive copy
        // Node.js 16.7+ supports fs.cpSync
        fs.cpSync(sourcePath, targetPath, { recursive: true });

        // Calculate folder checksum (hash of all file hashes)
        const sha256 = await this.calculateFolderChecksum(targetPath);

        return {
            type: 'lancedb',
            path: this.folderName,
            sha256,
        };
    }

    async restore(sourceDir: string): Promise<void> {
        const sourcePath = path.join(sourceDir, this.folderName);
        const targetPath = path.join(app.getPath('userData'), this.folderName);

        if (!fs.existsSync(sourcePath)) {
            // If backup didn't have this store, we should maybe clear current store to match snapshot?
            // Or keep current?
            // Backup reflects state at time T. If T didn't have store, T+1 shouldn't either.
            // So we delete current.
            if (fs.existsSync(targetPath)) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            }
            return;
        }

        // Remove existing
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }

        // Copy
        fs.cpSync(sourcePath, targetPath, { recursive: true });
    }

    async cleanupAfterBackup(): Promise<void> {
        // No special cleanup
    }

    private async calculateFolderChecksum(folderPath: string): Promise<string> {
        const hash = crypto.createHash('sha256');
        const files = this.getAllFiles(folderPath);
        // Sort files to ensure deterministic hash regardless of FS order
        for (const file of files.sort()) {
            const fileHash = crypto.createHash('sha256');
            const content = fs.readFileSync(file);
            fileHash.update(content);
            // Update main hash with file path (relative) and content hash
            // Use relative path to avoid path differences affecting hash
            const relPath = path.relative(folderPath, file).replace(/\\/g, '/'); // Normalize to forward slash
            hash.update(relPath);
            hash.update(fileHash.digest('hex'));
        }
        return hash.digest('hex');
    }

    private getAllFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.getAllFiles(fullPath));
            } else {
                results.push(fullPath);
            }
        }
        return results;
    }
}
