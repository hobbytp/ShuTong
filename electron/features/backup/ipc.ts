import { BrowserWindow, dialog, ipcMain } from 'electron';
import { backupService } from './backup-service';
import { BackupOptions, RestoreOptions } from './types';

export function setupBackupIPC() {
    ipcMain.handle('backup:create', async (_, options: BackupOptions) => {
        return backupService.createBackup(options);
    });

    ipcMain.handle('backup:restore', async (_, options: RestoreOptions) => {
        return backupService.restoreBackup(options);
    });

    ipcMain.handle('backup:save-dialog', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return { canceled: true };

        return dialog.showSaveDialog(win, {
            title: 'Export Backup',
            defaultPath: `shutong-backup-${new Date().toISOString().slice(0, 10)}.zip`,
            filters: [{ name: 'ShuTong Backup', extensions: ['zip'] }]
        });
    });

    ipcMain.handle('backup:open-dialog', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return { canceled: true };

        return dialog.showOpenDialog(win, {
            title: 'Import Backup',
            filters: [{ name: 'ShuTong Backup', extensions: ['zip'] }],
            properties: ['openFile']
        });
    });
}
