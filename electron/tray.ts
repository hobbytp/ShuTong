import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import path from 'path';
import { eventBus } from './infrastructure/events';

let tray: Tray | null = null;
let isQuitting = false;

// Helpers to expose status to main.ts
export function setIsQuitting(value: boolean) {
    isQuitting = value;
}

export function getIsQuitting() {
    return isQuitting;
}

export function setupTray(getMainWindow: () => BrowserWindow | null) {
    const iconPath = path.join(process.env.VITE_PUBLIC, 'electron-vite.svg');
    // Use a simple logic to ensure icon exists or use fallback if needed
    // ideally we should have a tray-specific icon
    const icon = nativeImage.createFromPath(iconPath);

    tray = new Tray(icon);
    tray.setToolTip('ShuTong');

    updateTrayMenu(getMainWindow, false);

    tray.on('double-click', () => {
        const win = getMainWindow();
        if (win) {
            if (win.isVisible()) {
                if (win.isFocused()) {
                    win.hide();
                } else {
                    win.show();
                    win.focus();
                }
            } else {
                win.show();
                win.focus();
            }
        }
    });
}

export function updateTrayMenu(getMainWindow: () => BrowserWindow | null, isRecording: boolean) {
    if (!tray) return;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open ShuTong',
            click: () => {
                const win = getMainWindow();
                if (win) {
                    win.show();
                    win.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: isRecording ? 'Stop Recording' : 'Start Recording',
            click: () => {
                // We need to trigger start/stop recording in main process
                // This is a bit circular dependency if we import startRecording/stopRecording from main.ts
                // So we will emit an event or call a global function provided by main.ts
                // Ideally main.ts should pass a callback
                const win = getMainWindow();
                if (win) {
                    // Send IPC to renderer? Or call main process function directly?
                    // Since capture logic is in main process (screenCapture), we can expose a callback in setupTray
                    // For simplicity, let's assume we send a message to the window to toggle it, 
                    // OR simpler: main.ts passes the toggle callback.
                    // Let's refactor setupTray to accept callbacks.
                    // For now, let's just make it emit an event on app or something.
                    eventBus.emitEvent('command:toggle-recording', {});
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: async () => {
                try {
                    const { getIsResetting } = await import('./storage');
                    if (getIsResetting()) {
                        const { dialog } = await import('electron');
                        dialog.showErrorBox('Cannot Quit', 'Database reset in progress. Please wait until completion.');
                        return;
                    }
                    // Check Backup/Restore Status
                    const { backupService } = await import('./features/backup');
                    if (backupService.isInProgress) {
                        const { dialog } = await import('electron');
                        dialog.showErrorBox('Cannot Quit', 'Data backup/restore in progress. Please wait until completion.');
                        return;
                    }
                } catch (err) {
                    console.error('Failed to check reset status:', err);
                }
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(isRecording ? 'ShuTong - Recording 🔴' : 'ShuTong - Idle');
}
