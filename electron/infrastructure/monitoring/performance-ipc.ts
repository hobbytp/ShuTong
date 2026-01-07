/**
 * Performance IPC Setup - Registers IPC handlers for performance monitoring.
 */

import { BrowserWindow, ipcMain } from 'electron';
// FIX: Import directly from source files to avoid circular dependency
import { metricsCollector, PerformanceSnapshot } from './metrics-collector';
import { systemMonitor } from './system-monitor';

// FIX: Support multiple subscribers
const subscribedWindows = new Set<BrowserWindow>();
let pushIntervalId: NodeJS.Timeout | null = null;
const PUSH_INTERVAL_MS = 5000;

/**
 * Setup performance monitoring IPC handlers.
 * Call this from main.ts during app initialization.
 */
export function setupPerformanceIPC(): void {
    // Start system monitor
    systemMonitor.start();

    // Get current snapshot (pull)
    ipcMain.handle('performance:getSnapshot', (): PerformanceSnapshot => {
        return metricsCollector.getSnapshot();
    });

    // Subscribe to push updates
    ipcMain.handle('performance:subscribe', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;

        subscribedWindows.add(win);

        // Clean up when window is closed
        win.once('closed', () => {
            subscribedWindows.delete(win);
            if (subscribedWindows.size === 0 && pushIntervalId) {
                clearInterval(pushIntervalId);
                pushIntervalId = null;
            }
        });

        // Start pushing if not already
        if (!pushIntervalId) {
            pushIntervalId = setInterval(() => {
                // Clean up destroyed windows and push to remaining
                for (const w of subscribedWindows) {
                    if (w.isDestroyed()) {
                        subscribedWindows.delete(w);
                    } else {
                        const snapshot = metricsCollector.getSnapshot();
                        w.webContents.send('performance:update', snapshot);
                    }
                }

                // Stop interval if no subscribers left
                if (subscribedWindows.size === 0 && pushIntervalId) {
                    clearInterval(pushIntervalId);
                    pushIntervalId = null;
                }
            }, PUSH_INTERVAL_MS);
        }

        console.log(`[Performance] Client subscribed (total: ${subscribedWindows.size})`);
    });

    // Unsubscribe from push updates
    ipcMain.handle('performance:unsubscribe', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            subscribedWindows.delete(win);
        }

        if (subscribedWindows.size === 0 && pushIntervalId) {
            clearInterval(pushIntervalId);
            pushIntervalId = null;
        }

        console.log(`[Performance] Client unsubscribed (remaining: ${subscribedWindows.size})`);
    });

    console.log('[Performance] IPC handlers registered');
}

/**
 * Shutdown performance monitoring (call on app quit)
 */
export function shutdownPerformanceMonitoring(): void {
    systemMonitor.stop();
    if (pushIntervalId) {
        clearInterval(pushIntervalId);
        pushIntervalId = null;
    }
    subscribedWindows.clear();
}
