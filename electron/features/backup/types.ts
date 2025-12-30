export interface BackupManifest {
    version: string;           // Manifest schema version, e.g. "1.0"
    appVersion: string;        // ShuTong app version
    createdAt: string;         // ISO timestamp
    platform: NodeJS.Platform; // 'win32' | 'darwin' | 'linux'
    databases: {
        sqlite?: DatabaseBackupMeta;
        vectorStore?: DatabaseBackupMeta;
        memoryStore?: DatabaseBackupMeta;
        [key: string]: DatabaseBackupMeta | undefined; // Allow future extensions
    };
    assets: {
        screenshots?: AssetBackupMeta;
        [key: string]: AssetBackupMeta | undefined;
    };
}

export interface DatabaseBackupMeta {
    type: string;              // 'better-sqlite3' | 'lancedb' | 'postgresql' | ...
    path: string;              // Relative path within backup
    sha256: string;            // Checksum
    rowCount?: number;         // Optional stats
}

export interface AssetBackupMeta {
    path: string;
    count: number;
    totalSizeBytes: number;
    sha256: string;            // Checksum of the folder (hash of hashes)
}

export interface BackupOptions {
    targetPath: string;        // Destination file path (.zip)
    includeScreenshots?: boolean; // Default: true
    signal?: AbortSignal;      // For cancellation
    onProgress?: (event: BackupProgressEvent) => void;
}

export interface RestoreOptions {
    sourcePath: string;        // Source backup file (.zip)
    signal?: AbortSignal;
    onProgress?: (event: BackupProgressEvent) => void;
}

export interface BackupProgressEvent {
    operation: 'backup' | 'restore';
    phase: BackupPhase;
    current: number;
    total: number;
    message: string;
}

export type BackupPhase =
    | 'preparing'
    | 'sqlite'
    | 'vectorStore'
    | 'memoryStore'
    | 'screenshots'
    | 'compressing'
    | 'extracting'
    | 'validating'
    | 'applying'
    | 'cleanup'
    | 'done'
    | 'error';

export interface BackupResult {
    success: boolean;
    error?: string;
    manifest?: BackupManifest;
    outputPath?: string;
}

export interface RestoreResult {
    success: boolean;
    error?: string;
    manifest?: BackupManifest;
}
