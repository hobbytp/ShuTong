import { constants } from 'fs';
import fs from 'fs/promises';

/**
 * Validates that the target path is writable and has sufficient permissions.
 * (Note: precise disk space check requires native modules, skipping for MVP)
 */
export async function validateMigrationTarget(targetPath: string): Promise<void> {
    try {
        await fs.mkdir(targetPath, { recursive: true });
        await fs.access(targetPath, constants.W_OK);
    } catch (err: any) {
        throw new Error(`Target path is not writable: ${err.message}`);
    }
}

/**
 * Recursively copies data from source to target.
 * wrapper around fs.cp with error handling.
 */
export async function copyUserData(sourcePath: string, targetPath: string, onProgress?: (file: string) => void): Promise<void> {
    console.log(`[Migration] Starting copy from ${sourcePath} to ${targetPath}`);

    try {
        // Ensure source exists
        try {
            await fs.access(sourcePath, constants.R_OK);
        } catch {
            throw new Error(`Source path does not exist or is not readable: ${sourcePath}`);
        }

        // Ensure target directory exists
        await fs.mkdir(targetPath, { recursive: true });

        // Node.js 16.7.0+ supports fs.cp which is recursive and efficient
        await fs.cp(sourcePath, targetPath, {
            recursive: true,
            preserveTimestamps: true,
            errorOnExist: false,
            force: true,
            filter: (src) => {
                // We can add logic here to skip lock files or temp files if needed
                // For now, copy everything
                if (onProgress) {
                    onProgress(src);
                }
                return true;
            }
        });

        console.log('[Migration] Copy completed successfully.');

    } catch (err: any) {
        console.error('[Migration] Copy failed:', err);
        throw err;
    }
}
