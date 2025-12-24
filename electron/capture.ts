import { app, desktopCapturer, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getSetting, saveScreenshot } from './storage';

let captureInterval: NodeJS.Timeout | null = null;
let isRecording = false;
let currentIntervalMs = 1000; // Track current interval for dynamic updates

interface CaptureConfig {
    interval: number;
    resolution: { width: number; height: number };
    quality: number;
    screenIndex: number;
    minDiskSpaceGB: number;
    captureMode: 'screen' | 'window';
    excludedApps: string[];
    excludedTitlePatterns: string[];
}

interface ActiveWindowInfo {
    title: string;
    owner: {
        name: string;
        processId?: number;
    };
    id?: number;
}

function getCaptureConfig(): CaptureConfig {
    const intervalStr = getSetting('capture_interval_ms');
    const resolutionStr = getSetting('capture_resolution');
    const qualityStr = getSetting('capture_quality');
    const screenIndexStr = getSetting('capture_screen_index');
    const minDiskSpaceStr = getSetting('min_disk_space_gb');
    const captureModeStr = getSetting('capture_mode');
    const excludedAppsStr = getSetting('excluded_apps');
    const excludedPatternsStr = getSetting('excluded_title_patterns');

    const [width, height] = (resolutionStr || '1920x1080').split('x').map(Number);

    let excludedApps: string[] = [];
    let excludedPatterns: string[] = [];
    try {
        if (excludedAppsStr) excludedApps = JSON.parse(excludedAppsStr);
        if (excludedPatternsStr) excludedPatterns = JSON.parse(excludedPatternsStr);
    } catch { /* ignore parse errors */ }

    return {
        interval: parseInt(intervalStr || '1000'),
        resolution: { width: width || 1920, height: height || 1080 },
        quality: parseInt(qualityStr || '60'),
        screenIndex: parseInt(screenIndexStr || '0'),
        minDiskSpaceGB: parseFloat(minDiskSpaceStr || '1'),
        captureMode: (captureModeStr as 'screen' | 'window') || 'screen',
        excludedApps,
        excludedTitlePatterns: excludedPatterns
    };
}

/**
 * Check if there's enough disk space to continue recording.
 * Returns true if enough space, false otherwise.
 */
async function checkDiskSpace(minGB: number): Promise<boolean> {
    try {
        const userDataPath = app.getPath('userData');
        const stats = await fs.promises.statfs(userDataPath);
        const freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024);
        return freeGB >= minGB;
    } catch {
        return true;
    }
}

/**
 * Get active window info using get-windows package (successor to active-win).
 * Returns null if unable to get info.
 */
async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
    try {
        // Dynamic import because get-windows is ESM-only
        const getWindowsModule = await import('get-windows');
        const activeWindow = getWindowsModule.activeWindow;

        if (typeof activeWindow !== 'function') {
            console.warn('[ShuTong] get-windows module not available');
            return null;
        }

        const win = await activeWindow();
        if (!win) return null;

        return {
            title: win.title || '',
            id: win.id,
            owner: {
                name: win.owner?.name || '',
                processId: win.owner?.processId
            }
        };
    } catch (err) {
        console.error('[ShuTong] Failed to get active window:', err);
        return null;
    }
}

/**
 * Check if the current active window should be excluded from capture.
 */
function shouldExcludeWindow(
    windowInfo: ActiveWindowInfo | null,
    excludedApps: string[],
    excludedPatterns: string[]
): boolean {
    if (!windowInfo) return false;

    const appName = windowInfo.owner.name.toLowerCase();
    const title = windowInfo.title.toLowerCase();

    // Check excluded apps
    for (const excludedApp of excludedApps) {
        if (appName.includes(excludedApp.toLowerCase())) {
            console.log(`[ShuTong] Skipping capture: App "${appName}" is in exclusion list`);
            return true;
        }
    }

    // Check excluded title patterns
    for (const pattern of excludedPatterns) {
        if (title.includes(pattern.toLowerCase())) {
            console.log(`[ShuTong] Skipping capture: Title contains excluded pattern "${pattern}"`);
            return true;
        }
    }

    return false;
}

/**
 * Match window source with improved strategy:
 * 1. Try to match by window ID if available (most accurate)
 * 2. Fall back to title matching with multiple strategies
 */
function findMatchingSource(
    sources: Electron.DesktopCapturerSource[],
    activeWindow: ActiveWindowInfo
): Electron.DesktopCapturerSource | null {
    // Strategy 1: Match by window ID (format: "window:123:0" on some platforms)
    if (activeWindow.id) {
        const idMatch = sources.find(s => s.id.includes(`:${activeWindow.id}:`));
        if (idMatch) return idMatch;
    }

    // Strategy 2: Exact title match
    const exactMatch = sources.find(s =>
        s.name.toLowerCase() === activeWindow.title.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    // Strategy 3: Title starts with (handles truncated titles)
    const startsWithMatch = sources.find(s =>
        s.name.toLowerCase().startsWith(activeWindow.title.toLowerCase().substring(0, 20))
    );
    if (startsWithMatch) return startsWithMatch;

    // Strategy 4: Title contains (most lenient)
    const containsMatch = sources.find(s =>
        s.name.toLowerCase().includes(activeWindow.title.toLowerCase().substring(0, 15)) ||
        activeWindow.title.toLowerCase().includes(s.name.toLowerCase().substring(0, 15))
    );
    if (containsMatch) return containsMatch;

    // Strategy 5: App name match (last resort)
    const appNameMatch = sources.find(s =>
        s.name.toLowerCase().includes(activeWindow.owner.name.toLowerCase())
    );
    if (appNameMatch) return appNameMatch;

    return null;
}

export function getIsRecording() {
    return isRecording;
}

function getRecordingsRoot() {
    const root = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
    }
    return root;
}

export function setupScreenCapture() {
    ipcMain.handle('start-recording-sync', () => {
        startRecording();
        return true;
    });

    ipcMain.handle('stop-recording-sync', () => {
        stopRecording();
        return true;
    });

    ipcMain.handle('get-recording-status', () => {
        return isRecording;
    });
}

export function startRecording() {
    if (isRecording) return;
    isRecording = true;
    app.emit('recording-changed', true);
    console.log('[ShuTong] Started recording');

    const config = getCaptureConfig();
    currentIntervalMs = config.interval;
    captureFrame(config);
    captureInterval = setInterval(() => {
        const config = getCaptureConfig();

        // Dynamic interval: restart timer if interval changed
        if (config.interval !== currentIntervalMs) {
            console.log(`[ShuTong] Interval changed from ${currentIntervalMs}ms to ${config.interval}ms, restarting timer`);
            currentIntervalMs = config.interval;
            if (captureInterval) {
                clearInterval(captureInterval);
                captureInterval = setInterval(() => {
                    const config = getCaptureConfig();
                    captureFrame(config);
                }, currentIntervalMs);
            }
        }

        captureFrame(config);
    }, config.interval);
}

export function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    app.emit('recording-changed', false);
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    console.log('[ShuTong] Stopped recording');
}

async function captureFrame(config: CaptureConfig) {
    try {
        // Pre-check disk space
        const hasSpace = await checkDiskSpace(config.minDiskSpaceGB);
        if (!hasSpace) {
            console.warn(`[ShuTong] Low disk space (< ${config.minDiskSpaceGB}GB). Stopping recording.`);
            stopRecording();
            app.emit('capture-error', {
                title: 'Low Disk Space',
                message: `Recording stopped because disk space fell below ${config.minDiskSpaceGB}GB.`
            });
            return;
        }

        // Privacy filter check
        const activeWindow = await getActiveWindow();
        if (shouldExcludeWindow(activeWindow, config.excludedApps, config.excludedTitlePatterns)) {
            return; // Skip this frame
        }

        let jpeg: Buffer;
        let appName: string | null = null;
        let captureType: 'screen' | 'window' = 'screen';

        if (config.captureMode === 'window' && activeWindow) {
            // Window-level capture: Find the active window in desktopCapturer sources
            const sources = await desktopCapturer.getSources({
                types: ['window'],
                thumbnailSize: config.resolution,
                fetchWindowIcons: false
            });

            // Use improved matching strategy
            const matchedSource = findMatchingSource(sources, activeWindow);

            if (!matchedSource) {
                console.warn('[ShuTong] No window source found, falling back to screen capture');
                // Fallback to screen capture
                const screens = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: config.resolution,
                    fetchWindowIcons: false
                });
                const screen = screens[config.screenIndex] || screens[0];
                if (!screen) return;
                jpeg = screen.thumbnail.toJPEG(config.quality);
                captureType = 'screen';
            } else {
                jpeg = matchedSource.thumbnail.toJPEG(config.quality);
                appName = activeWindow.owner.name;
                captureType = 'window';
            }
        } else {
            // Full screen capture
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: config.resolution,
                fetchWindowIcons: false
            });
            const selectedSource = sources[config.screenIndex] || sources[0];
            if (!selectedSource) return;
            jpeg = selectedSource.thumbnail.toJPEG(config.quality);

            // Still record active window info for metadata
            if (activeWindow) {
                appName = activeWindow.owner.name;
            }
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];

        const dayDir = path.join(getRecordingsRoot(), dateStr);
        if (!fs.existsSync(dayDir)) {
            fs.mkdirSync(dayDir, { recursive: true });
        }

        const filePath = path.join(dayDir, `${timeStr}.jpg`);
        await fs.promises.writeFile(filePath, jpeg);

        const unixTs = Math.floor(now.getTime() / 1000);
        // Save with metadata
        saveScreenshot(filePath, unixTs, jpeg.length, captureType, appName || undefined);

        // Log capture info in window mode
        if (config.captureMode === 'window' && appName) {
            console.log(`[ShuTong] Captured [${captureType}]: ${appName}`);
        }
    } catch (error: any) {
        console.error('[ShuTong] Capture error:', error);

        if (error.code === 'ENOSPC') {
            console.error('[ShuTong] CRITICAL: Disk full. Stopping recording.');
            stopRecording();
            app.emit('capture-error', {
                title: 'Disk Full',
                message: 'Stopped recording because there is no space left on the device.'
            });
        }
    }
}
