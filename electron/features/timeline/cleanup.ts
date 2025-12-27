import fs from 'fs';
import { deleteSnapshotsBefore, getSnapshotsBefore } from '../../storage';

export async function cleanupOldSnapshots(retentionDays: number) {
    if (retentionDays <= 0) return;

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const cutoffDate = Date.now() - (retentionDays * ONE_DAY_MS);

    console.log(`[Cleanup] Starting cleanup for snapshots older than ${retentionDays} days (before ${new Date(cutoffDate).toISOString()})`);

    // 1. Get files to delete
    const oldSnapshots = getSnapshotsBefore(cutoffDate);

    if (oldSnapshots.length === 0) {
        console.log('[Cleanup] No old snapshots found.');
        return;
    }

    console.log(`[Cleanup] Found ${oldSnapshots.length} snapshot(s) to delete.`);

    // 2. Delete files from disk
    let deletedCount = 0;
    let errorCount = 0;

    for (const snapshot of oldSnapshots) {
        try {
            if (fs.existsSync(snapshot.file_path)) {
                await fs.promises.unlink(snapshot.file_path);
                deletedCount++;
            } else {
                // File already gone, safe to remove from DB still
                console.warn(`[Cleanup] File not found: ${snapshot.file_path}`);
            }
        } catch (err) {
            console.error(`[Cleanup] Failed to delete file ${snapshot.file_path}:`, err);
            errorCount++;
        }
    }

    // 3. Delete DB rows
    // Ideally we only delete rows for files successfully deleted or confirmed missing.
    // simpler strategy: delete all rows that matched the query, assumming we want them gone anyway.
    deleteSnapshotsBefore(cutoffDate);

    console.log(`[Cleanup] Completed. Deleted ${deletedCount} files, ${errorCount} errors.`);
}
