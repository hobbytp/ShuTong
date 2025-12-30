import { BackupProgressEvent, DatabaseBackupMeta } from '../types';

export interface IDataBackupAdapter {
    readonly name: string;

    /**
     * Create a backup of this data source to the target directory.
     * @param targetDir Temporary directory to write backup files
     * @param onProgress Progress callback
     * @returns Metadata about the backed-up data
     */
    backup(
        targetDir: string,
        onProgress?: (event: Partial<BackupProgressEvent>) => void
    ): Promise<DatabaseBackupMeta>;

    /**
     * Restore data from the source directory.
     * @param sourceDir Directory containing extracted backup files
     * @param onProgress Progress callback
     */
    restore(
        sourceDir: string,
        onProgress?: (event: Partial<BackupProgressEvent>) => void
    ): Promise<void>;

    /**
     * Prepare for backup (e.g., flush buffers, acquire locks).
     */
    prepareForBackup(): Promise<void>;

    /**
     * Cleanup after backup (e.g., release locks).
     */
    cleanupAfterBackup(): Promise<void>;
}
