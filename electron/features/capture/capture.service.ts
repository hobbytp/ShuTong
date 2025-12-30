import { app, desktopCapturer, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { eventBus } from '../../infrastructure/events';
import { getSetting, saveScreenshot, saveWindowSwitch } from '../../storage';
import {
    clearPendingWindowCapture,
    getIntervalMultiplier,
    initCaptureGuard,
    notifyWindowChange,
    onDebouncedCapture,
    onWindowSwitch,
    recordCapture,
    recordSkip,
    shouldSkipCapture,
    updateGuardSettings
} from './capture-guard';
import {
    isFrameSimilar,
    resetLastFrame,
    updateDedupSettings
} from './frame-dedup';

let captureInterval: NodeJS.Timeout | null = null;
let isRecording = false;
let currentIntervalMs = 1000; // Track current interval for dynamic updates
let lastCapturedWindowApp: string | null = null;

interface CaptureConfig {
    interval: number;
    resolution: { width: number; height: number };
    quality: number;
    screenIndex: number;
    minDiskSpaceGB: number;
    captureMode: 'screen' | 'window';
    excludedApps: string[];
    excludedTitlePatterns: string[];
    guard: {
        idleThreshold: number;
        enableIdleDetection: boolean;
        enableLockDetection: boolean;
        debounceMs: number;
    };
    dedup: {
        similarityThreshold: number;
        enableSimilarityDedup: boolean;
    };
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

    // Smart Capture Guard Settings
    const idleThresholdStr = getSetting('guard_idle_threshold');
    const enableIdleStr = getSetting('guard_enable_idle_detection');
    const lockDetectionStr = getSetting('guard_enable_lock_detection');
    const debounceMsStr = getSetting('guard_debounce_ms');

    // Frame Deduplication Settings
    const similarityThresholdStr = getSetting('dedup_similarity_threshold');
    const enableDedupStr = getSetting('dedup_enable');

    const [width, height] = (resolutionStr || '1920x1080').split('x').map(Number);

    let excludedApps: string[] = [];
    let excludedPatterns: string[] = [];
    try {
        if (excludedAppsStr) excludedApps = JSON.parse(excludedAppsStr);
        if (excludedPatternsStr) excludedPatterns = JSON.parse(excludedPatternsStr);
    } catch { /* ignore parse errors */ }

    // Defaults
    const idleThreshold = idleThresholdStr ? parseInt(idleThresholdStr) : 30;
    const enableIdleDetection = enableIdleStr !== 'false'; // Default true
    const enableLockDetection = lockDetectionStr !== 'false'; // Default true
    const debounceMs = debounceMsStr ? parseInt(debounceMsStr) : 2000;
    const similarityThreshold = similarityThresholdStr ? parseFloat(similarityThresholdStr) : 0.05;
    const enableSimilarityDedup = enableDedupStr !== 'false'; // Default true

    return {
        interval: parseInt(intervalStr || '1000'),
        resolution: { width: width || 1920, height: height || 1080 },
        quality: parseInt(qualityStr || '60'),
        screenIndex: parseInt(screenIndexStr || '0'),
        minDiskSpaceGB: parseFloat(minDiskSpaceStr || '1'),
        captureMode: (captureModeStr as 'screen' | 'window') || 'screen',
        excludedApps,
        excludedTitlePatterns: excludedPatterns,
        guard: {
            idleThreshold,
            enableIdleDetection,
            enableLockDetection,
            debounceMs
        },
        dedup: {
            similarityThreshold,
            enableSimilarityDedup
        }
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
        const idMatch = sources.find(s => s.id.includes(`:${activeWindow.id}: `));
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
    eventBus.emitEvent('recording:state-changed', { isRecording: true });
    console.log('[ShuTong] Started recording');

    let lastConfig = getCaptureConfig();

    // Initialize Smart Capture Guard with settings
    initCaptureGuard({
        idleThresholdSeconds: lastConfig.guard.idleThreshold,
        windowSwitchDebounceMs: lastConfig.guard.debounceMs,
        enableIdleDetection: lastConfig.guard.enableIdleDetection,
        enableLockDetection: lastConfig.guard.enableLockDetection,
        blacklistedApps: lastConfig.excludedApps // Reuse existing excluded apps list
    });

    // Initialize Frame Deduplication settings
    updateDedupSettings({
        similarityThreshold: lastConfig.dedup.similarityThreshold,
        enableSimilarityDedup: lastConfig.dedup.enableSimilarityDedup
    });

    // Set up window switch event handler to persist events
    onWindowSwitch((event) => {
        saveWindowSwitch({
            timestamp: event.timestamp,
            from_app: event.from_app,
            from_title: event.from_title,
            to_app: event.to_app,
            to_title: event.to_title,
            skip_reason: null
        });
        console.log(`[ShuTong] Window switch: ${event.from_app || 'null'} -> ${event.to_app} `);
    });

    // Set up debounced capture callback (triggers capture after window switch settles)
    onDebouncedCapture(() => {
        const config = getCaptureConfig();
        captureFrame(config);
    });

    currentIntervalMs = Math.round(lastConfig.interval * getIntervalMultiplier());
    captureFrame(lastConfig);
    captureInterval = setInterval(() => {
        const newConfig = getCaptureConfig();

        // Only update guard settings if they actually changed (avoid excessive logging)
        const currentSettings = {
            idleThresholdSeconds: lastConfig.guard.idleThreshold,
            windowSwitchDebounceMs: lastConfig.guard.debounceMs,
            enableIdleDetection: lastConfig.guard.enableIdleDetection,
            enableLockDetection: lastConfig.guard.enableLockDetection,
        };
        const newSettings = {
            idleThresholdSeconds: newConfig.guard.idleThreshold,
            windowSwitchDebounceMs: newConfig.guard.debounceMs,
            enableIdleDetection: newConfig.guard.enableIdleDetection,
            enableLockDetection: newConfig.guard.enableLockDetection,
        };
        if (JSON.stringify(currentSettings) !== JSON.stringify(newSettings) ||
            JSON.stringify(lastConfig.excludedApps) !== JSON.stringify(newConfig.excludedApps)) {
            updateGuardSettings({
                idleThresholdSeconds: newConfig.guard.idleThreshold,
                windowSwitchDebounceMs: newConfig.guard.debounceMs,
                enableIdleDetection: newConfig.guard.enableIdleDetection,
                enableLockDetection: newConfig.guard.enableLockDetection,
                blacklistedApps: newConfig.excludedApps
            });
        }

        // Update dedup settings at runtime
        if (lastConfig.dedup.similarityThreshold !== newConfig.dedup.similarityThreshold ||
            lastConfig.dedup.enableSimilarityDedup !== newConfig.dedup.enableSimilarityDedup) {
            updateDedupSettings({
                similarityThreshold: newConfig.dedup.similarityThreshold,
                enableSimilarityDedup: newConfig.dedup.enableSimilarityDedup
            });
        }

        // Dynamic interval: apply battery mode multiplier and restart timer if interval changed
        const effectiveInterval = Math.round(newConfig.interval * getIntervalMultiplier());
        if (effectiveInterval !== currentIntervalMs) {
            console.log(`[ShuTong] Interval changed from ${currentIntervalMs}ms to ${effectiveInterval}ms (base: ${newConfig.interval}ms, multiplier: ${getIntervalMultiplier()})`);
            currentIntervalMs = effectiveInterval;
            if (captureInterval) {
                clearInterval(captureInterval);
                captureInterval = setInterval(() => {
                    const config = getCaptureConfig();
                    captureFrame(config);
                }, currentIntervalMs);
            }
        }

        captureFrame(newConfig);

        // Update lastConfig for next iteration comparison
        lastConfig = newConfig;
    }, lastConfig.interval);
}

export function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    eventBus.emitEvent('recording:state-changed', { isRecording: false });
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    // Clear any pending debounced window captures
    clearPendingWindowCapture();
    lastCapturedWindowApp = null;
    console.log('[ShuTong] Stopped recording');
}

// --- Test Helpers ---

export function __test__resetCaptureState() {
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    isRecording = false;
    currentIntervalMs = 1000;
    lastCapturedWindowApp = null;
}

export function __test__setLastCapturedWindowApp(appName: string | null) {
    lastCapturedWindowApp = appName;
}

async function captureFrame(config: CaptureConfig) {
    try {
        // Pre-check disk space
        const hasSpace = await checkDiskSpace(config.minDiskSpaceGB);
        if (!hasSpace) {
            console.warn(`[ShuTong] Low disk space(<${config.minDiskSpaceGB}GB).Stopping recording.`);
            stopRecording();
            eventBus.emitEvent('capture:error', {
                title: 'Low Disk Space',
                message: `Recording stopped because disk space fell below ${config.minDiskSpaceGB} GB.`
            });
            return;
        }

        // Get active window info for all checks
        const activeWindow = await getActiveWindow();
        const currentApp = activeWindow?.owner.name || null;
        const currentTitle = activeWindow?.title || '';

        // Smart Capture Guard: Check if we should skip this capture
        const skipReason = shouldSkipCapture(currentApp || undefined);
        if (skipReason) {
            // Even when skipping, track window change for accurate dwell time
            if (currentApp && currentApp !== lastCapturedWindowApp) {
                notifyWindowChange(currentApp, currentTitle);
                lastCapturedWindowApp = currentApp; // Update tracking
            }
            recordSkip(skipReason, currentApp || undefined);
            return; // Skip this frame due to guard condition
        }

        // Privacy filter check: only check title patterns here
        // (app blacklist is already handled by shouldSkipCapture above)
        if (shouldExcludeWindow(activeWindow, [], config.excludedTitlePatterns)) {
            recordSkip('blacklisted', activeWindow?.owner?.name);
            return; // Skip this frame due to title pattern match
        }

        // Detect window change for event tracking (only if not already notified above)
        const windowChanged = currentApp && currentApp !== lastCapturedWindowApp;
        if (windowChanged) {
            notifyWindowChange(currentApp, currentTitle);
            lastCapturedWindowApp = currentApp;
            // Reset last frame on window change to ensure we capture
            resetLastFrame();
        }

        let thumbnail: Electron.NativeImage | null = null;
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
                thumbnail = screen.thumbnail;
                captureType = 'screen';
            } else {
                thumbnail = matchedSource.thumbnail;
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
            thumbnail = selectedSource.thumbnail;

            // Still record active window info for metadata
            if (activeWindow) {
                appName = activeWindow.owner.name;
            }
        }

        if (!thumbnail || thumbnail.isEmpty()) return;

        // Frame deduplication check using raw bitmap
        // Only check if window hasn't changed (window change always captures)
        if (!windowChanged && config.dedup.enableSimilarityDedup) {
            const size = thumbnail.getSize();
            const bitmap = thumbnail.toBitmap();
            // Estimate JPEG size (typically ~5-10% of raw bitmap for quality 60)
            const estimatedJpegBytes = Math.round(bitmap.length * 0.07);
            if (isFrameSimilar(bitmap, size.width, size.height, estimatedJpegBytes)) {
                // Skip this frame - too similar to last one
                console.log('[ShuTong] Skipped similar frame (dedup)');
                recordSkip('similar_frame', appName || undefined);
                return;
            }
        }

        // Convert to JPEG for storage
        const jpeg = thumbnail.toJPEG(config.quality);

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
        const screenshotId = saveScreenshot(filePath, unixTs, jpeg.length, captureType, appName || undefined);

        // Notify UI about new screenshot for real-time updates
        if (screenshotId) {
            eventBus.emitEvent('screenshot:captured', { id: screenshotId as number, timestamp: unixTs });
        }

        // Log capture info in window mode
        if (config.captureMode === 'window' && appName) {
            console.log(`[ShuTong] Captured[${captureType}]: ${appName} `);
        }

        // Record successful capture for statistics
        recordCapture();
    } catch (error: any) {
        console.error('[ShuTong] Capture error:', error);

        if (error.code === 'ENOSPC') {
            console.error('[ShuTong] CRITICAL: Disk full. Stopping recording.');
            stopRecording();
            eventBus.emitEvent('capture:error', {
                title: 'Disk Full',
                message: 'Stopped recording because there is no space left on the device.',
                fatal: true
            });
        }
    }
}

export async function __test__captureFrame(config: CaptureConfig) {
    await captureFrame(config);
}
