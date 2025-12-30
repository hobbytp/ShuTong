export interface BackupProgressEvent {
    operation: 'backup' | 'restore';
    phase: 'preparing' | 'sqlite' | 'vectorStore' | 'memoryStore' | 'screenshots' | 'compressing' | 'extracting' | 'validating' | 'applying' | 'cleanup' | 'done' | 'error';
    current: number;
    total: number;
    message: string;
}

export interface BackupOptions {
    targetPath: string;
    includeScreenshots?: boolean;
}

export interface RestoreOptions {
    sourcePath: string;
}

export interface BackupResult {
    success: boolean;
    error?: string;
    manifest?: any;
    outputPath?: string;
}

export interface RestoreResult {
    success: boolean;
    error?: string;
    manifest?: any;
}
