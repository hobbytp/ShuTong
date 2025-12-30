import { useCallback, useEffect, useState } from 'react';
import { BackupOptions, BackupProgressEvent, BackupResult, RestoreOptions, RestoreResult } from '../types/backup';

// Extend Window interface for IPC


export function useBackup() {
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [progress, setProgress] = useState<BackupProgressEvent | null>(null);

    useEffect(() => {
        // Listen for progress events from main process
        if (window.ipcRenderer) {
            const removeListener = window.ipcRenderer.on('backup:progress', (_event: any, data: BackupProgressEvent) => {
                setProgress(data);
            });
            return () => {
                removeListener();
            };
        }
    }, []);

    const createBackup = useCallback(async (options: BackupOptions): Promise<BackupResult> => {
        setIsBackingUp(true);
        setProgress({ operation: 'backup', phase: 'preparing', current: 0, total: 100, message: 'Starting backup...' });

        try {
            if (!window.ipcRenderer) throw new Error('Electron IPC not available');
            const result = await window.ipcRenderer.invoke('backup:create', options);
            return result;
        } catch (err: any) {
            return { success: false, error: err.message || 'Unknown error' };
        } finally {
            setIsBackingUp(false);
        }
    }, []);

    const restoreBackup = useCallback(async (options: RestoreOptions): Promise<RestoreResult> => {
        setIsRestoring(true);
        setProgress({ operation: 'restore', phase: 'preparing', current: 0, total: 100, message: 'Starting restore...' });

        try {
            if (!window.ipcRenderer) throw new Error('Electron IPC not available');
            const result = await window.ipcRenderer.invoke('backup:restore', options);
            return result;
        } catch (err: any) {
            return { success: false, error: err.message || 'Unknown error' };
        } finally {
            setIsRestoring(false);
        }
    }, []);

    const resetProgress = useCallback(() => {
        setProgress(null);
    }, []);

    const selectSavePath = useCallback(async () => {
        if (!window.ipcRenderer) return null;
        const result = await window.ipcRenderer.invoke('backup:save-dialog');
        return result.filePath;
    }, []);

    const selectOpenPath = useCallback(async () => {
        if (!window.ipcRenderer) return null;
        const result = await window.ipcRenderer.invoke('backup:open-dialog');
        if (result.filePaths && result.filePaths.length > 0) return result.filePaths[0];
        return null;
    }, []);

    return {
        isBackingUp,
        isRestoring,
        progress,
        createBackup,
        restoreBackup,
        resetProgress,
        selectSavePath,
        selectOpenPath
    };
}
