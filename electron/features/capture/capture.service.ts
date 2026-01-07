import { app, desktopCapturer, ipcMain, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import { eventBus } from '../../infrastructure/events';
import { metrics } from '../../infrastructure/monitoring/metrics-collector';
import { getSetting, saveScreenshot, saveWindowSwitch } from '../../storage';
// import { parseWindowContext } from '../timeline/context-parser';
import { Shutdownable, ShutdownPriority } from '../../infrastructure/lifecycle';
import {
    clearPendingWindowCapture,
    getGuardSettings,
    getIdleTime,
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
    checkFrameSimilarity,
    resetLastFrame,
    updateDedupSettings
} from './frame-dedup';

/**
 * Wrapper for desktopCapturer.getSources with retry logic.
 * Windows Graphics Capture (WGC) can timeout on first frame; retry helps.
 */
// --- Circuit Breaker State ---
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
const COOL_DOWN_PERIOD_MS = 30000;
let coolDownUntil = 0;

/**
 * Wrapper for desktopCapturer.getSources with retry logic and Circuit Breaker.
 * Windows Graphics Capture (WGC) can timeout on first frame; retry helps.
 * If failures persist, we back off to avoid overloading the system.
 */
async function getSourcesWithRetry(
    options: Electron.SourcesOptions,
    maxRetries: number = 2
): Promise<Electron.DesktopCapturerSource[]> {
    // 1. Check Circuit Breaker
    if (Date.now() < coolDownUntil) {
        console.warn(`[ShuTong] Capture skipped (Circuit Breaker active for ${(coolDownUntil - Date.now()) / 1000}s)`);
        metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
        return [];
    }

    // Circuit is closed (healthy)
    metrics.setGauge('capture.circuit_breaker_state', 0, { source: 'wgc' });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const sources = await desktopCapturer.getSources(options);
            // Filter out sources with empty thumbnails (WGC timeout symptom)
            const validSources = sources.filter(s => !s.thumbnail.isEmpty());

            if (validSources.length > 0) {
                // Success! Reset breaker
                if (consecutiveFailures > 0) {
                    console.log(`[ShuTong] WGC recovered after ${consecutiveFailures} failures.`);
                    consecutiveFailures = 0;
                    metrics.setGauge('capture.consecutive_failures', 0, { source: 'wgc' });
                }
                return validSources;
            }

            console.warn(`[ShuTong] WGC returned empty thumbnails, retrying (${attempt + 1}/${maxRetries})...`);

            if (attempt === maxRetries) {
                // Treated as failure if we still have empty sources
            }

            await new Promise(r => setTimeout(r, 2000)); // Increased backoff: 500ms -> 2000ms
        } catch (err) {
            console.warn(`[ShuTong] desktopCapturer failed (${attempt + 1}/${maxRetries}):`, err);

            if (attempt === maxRetries) {
                // Final failure for this cycle
                consecutiveFailures++;
                metrics.setGauge('capture.consecutive_failures', consecutiveFailures, { source: 'wgc' });
                metrics.incCounter('capture.errors_total', { error_category: 'wgc_timeout' });

                console.error(`[ShuTong] Capture cycle failed. Consecutive failures: ${consecutiveFailures}`);

                // Trip the breaker if threshold reached
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    coolDownUntil = Date.now() + COOL_DOWN_PERIOD_MS;
                    console.error(`[ShuTong] 🔴 CIRCUIT BREAKER TRIPPED. Pausing capture for ${COOL_DOWN_PERIOD_MS / 1000}s.`);
                    metrics.incCounter('capture.circuit_breaker_opened_total', { source: 'wgc' });
                    metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
                }
                return []; // Return empty instead of throwing
            }

            await new Promise(r => setTimeout(r, 2000)); // Increased backoff
        }
    }
    return [];
}

let captureInterval: NodeJS.Timeout | null = null;
let isRecording = false;
let currentIntervalMs = 1000; // Track current interval for dynamic updates
let lastCapturedWindowApp: string | null = null;

// --- Smart Keyframe State ---
interface PendingFrame {
    buffer: Buffer;
    timestamp: number;
    appName: string | null;
    windowTitle?: string;
    captureType: 'screen' | 'window';
    windowId?: number;
    thumbnail: Electron.NativeImage;
    roi?: { x: number, y: number, w: number, h: number };
}

let pendingFrames = new Map<string, PendingFrame>();
let lastWindowId: number | null = null;
let windowEnterTime: number = 0;
let lastCheckpointTime: number = 0; // Timestamp of last checkpoint save
const MIN_DWELL_TIME_MS = 1000; // Minimum 1 second dwell before saving Exit frame
const CHECKPOINT_INTERVAL_MS = 30000; // 30 seconds between checkpoints
// ----------------------------

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

    ipcMain.handle('stop-recording-sync', async () => {
        await stopRecording();
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

export async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    eventBus.emitEvent('recording:state-changed', { isRecording: false });
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    // Clear any pending debounced window captures
    clearPendingWindowCapture();

    // Commit any pending buffer as we stop
    const promises: Promise<void>[] = [];
    for (const [contextId, frame] of pendingFrames) {
        promises.push(savePendingFrame(frame, 'exit', contextId));
    }

    // Await all saves (Error Isolation: logic handled inside savePendingFrame catch)
    if (promises.length > 0) {
        console.log(`[Capture] Saving ${promises.length} pending frames...`);
        await Promise.allSettled(promises);
    }
    pendingFrames.clear();

    lastCapturedWindowApp = null;
    console.log('[ShuTong] Stopped recording');
}

/**
 * Helper to save a pending frame (e.g. on exit)
 */
async function savePendingFrame(frame: PendingFrame, trigger: 'exit' | 'checkpoint', monitorId: string = 'default') {
    try {
        // Use PNG for better quality (ROI/OCR)
        const png = frame.thumbnail.toPNG();

        const now = new Date(frame.timestamp); // Use frame's original timestamp

        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];

        const dayDir = path.join(getRecordingsRoot(), dateStr);
        if (!fs.existsSync(dayDir)) {
            fs.mkdirSync(dayDir, { recursive: true });
        }

        // Add monitorId to filename
        const safeMonitor = monitorId.replace(/[^a-zA-Z0-9]/g, '_');
        const filePath = path.join(dayDir, `${timeStr}_${safeMonitor}_${trigger}.png`);
        await fs.promises.writeFile(filePath, png);

        const unixTs = Math.floor(frame.timestamp / 1000);

        const fullCaptureType = `${frame.captureType}:${trigger}`;

        // const _context = parseWindowContext(frame.appName || '', frame.windowTitle || '');

        const screenshotId = saveScreenshot(
            filePath,
            unixTs,
            png.length,
            fullCaptureType,
            frame.appName || undefined,
            frame.windowTitle, // Pass window title if available
            monitorId,
            frame.roi
        );

        if (screenshotId) {
            eventBus.emitEvent('screenshot:captured', { id: screenshotId as number, timestamp: unixTs });
            console.log(`[ShuTong] Saved PENDING frame [${trigger}]: ${frame.appName} (Monitor: ${monitorId})`);
        }
    } catch (err) {
        console.error('[ShuTong] Failed to save pending frame:', err);
    }
}

export const captureShutdownService: Shutdownable = {
    name: 'CaptureService',
    priority: ShutdownPriority.HIGH,
    shutdown: async () => {
        await stopRecording();
    }
};

// --- Test Helpers ---

export function __test__resetCaptureState() {
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    isRecording = false;
    currentIntervalMs = 1000;
    lastCapturedWindowApp = null;
    // Reset smart keyframe state
    pendingFrames.clear();
    lastWindowId = null;
    windowEnterTime = 0;
    lastCheckpointTime = Date.now();
}

export function __test__setLastCapturedWindowApp(appName: string | null) {
    lastCapturedWindowApp = appName;
}

export function __test__setLastWindowId(windowId: number | null) {
    lastWindowId = windowId;
}

async function captureFrame(config: CaptureConfig) {
    const timer = metrics.startTimer('capture.duration_seconds');
    metrics.incCounter('capture.frames_total');

    try {
        // Pre-check disk space
        const hasSpace = await checkDiskSpace(config.minDiskSpaceGB);
        if (!hasSpace) {
            timer.end(); // End timer early
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
        const currentWindowId = activeWindow?.id;

        // Smart Capture Guard: Check if we should skip this capture
        const skipReason = shouldSkipCapture(currentApp || undefined);
        if (skipReason) {
            timer.end(); // End timer early for skipped frames
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
            timer.end();
            recordSkip('blacklisted', activeWindow?.owner?.name);
            return; // Skip this frame due to title pattern match
        }

        // Detect Window Switch (Global)
        // -------------------------------------------------------------------------
        const isFirstCapture = lastWindowId === null;
        const windowSwitched = !isFirstCapture && currentWindowId !== undefined && currentWindowId !== lastWindowId;

        // Detect window change for event tracking (only if not already notified above)
        const windowChanged = currentApp && currentApp !== lastCapturedWindowApp;
        if (windowChanged) {
            notifyWindowChange(currentApp, currentTitle);
            lastCapturedWindowApp = currentApp;
        }

        // Handle Window Switch: Commit all pending frames as 'exit'
        if (windowSwitched) {
            const dwellTime = Date.now() - windowEnterTime;

            // Iterate all pending frames and save them if dwell time was sufficient
            // We assume the user was "in the previous context" for all screens
            for (const [ctxId, frame] of pendingFrames) {
                if (dwellTime >= MIN_DWELL_TIME_MS) {
                    console.log(`[ShuTong] Saving EXIT keyframe for ctx ${ctxId} (dwell: ${dwellTime}ms)`);
                    await savePendingFrame(frame, 'exit', ctxId);
                }
            }

            // Clear all pending frames and dedup state as context changed
            pendingFrames.clear();
            resetLastFrame(); // Clear dedup state for all contexts

            // Update global state
            lastWindowId = currentWindowId || null;
            windowEnterTime = Date.now();
        } else if (isFirstCapture) {
            lastWindowId = currentWindowId || null;
            windowEnterTime = Date.now();
        }

        // Collect Captures
        // -------------------------------------------------------------------------
        const captures: {
            thumbnail: Electron.NativeImage,
            monitorId: string,
            appName: string | null,
            captureType: 'screen' | 'window',
            roi?: { x: number, y: number, w: number, h: number }
        }[] = [];

        // Get displays for ROI calculation
        const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);

        if (config.captureMode === 'window' && activeWindow) {
            // Window-level capture
            const sources = await getSourcesWithRetry({
                types: ['window'],
                thumbnailSize: config.resolution,
                fetchWindowIcons: false
            });

            // Use improved matching strategy
            const matchedSource = findMatchingSource(sources, activeWindow);

            if (matchedSource) {
                captures.push({
                    thumbnail: matchedSource.thumbnail,
                    monitorId: 'window', // Fixed context for window mode
                    appName: activeWindow.owner.name,
                    captureType: 'window'
                });
            } else {
                console.warn('[ShuTong] No window source found, falling back to screen capture');
                // Fallback to primary screen
                const screens = await getSourcesWithRetry({
                    types: ['screen'],
                    thumbnailSize: config.resolution,
                    fetchWindowIcons: false
                });
                const screen = screens[config.screenIndex] || screens[0];
                if (screen) {
                    captures.push({
                        thumbnail: screen.thumbnail,
                        monitorId: screen.id,
                        appName: activeWindow.owner.name, // Associate with active app even if screen capture
                        captureType: 'screen'
                    });
                }
            }
        } else {
            // Screen capture - Multi-monitor
            const screens = await getSourcesWithRetry({
                types: ['screen'],
                thumbnailSize: config.resolution,
                fetchWindowIcons: false
            });

            // Capture all screens
            for (let i = 0; i < screens.length; i++) {
                const screenSource = screens[i];
                let roi: { x: number, y: number, w: number, h: number } | undefined;

                // Smart ROI Calculation: Match source to display by ID
                if (activeWindow && 'bounds' in activeWindow) {
                    try {
                        // source.id format is typically "screen:display_id:0"
                        const parts = screenSource.id.split(':');
                        if (parts.length >= 2) {
                            const displayId = parseInt(parts[1], 10);
                            const display = displays.find(d => d.id === displayId);
                            if (display) {
                                roi = calculateROI(display.bounds, (activeWindow as any).bounds);
                                console.log(`[DEBUG] ROI for ${screenSource.id} (Display ${displayId}):`, roi);
                            } else {
                                console.log(`[DEBUG] Display ${displayId} not found`);
                            }
                        } else {
                            console.log(`[DEBUG] Invalid source ID format: ${screenSource.id}`);
                        }
                    } catch (e) {
                        console.warn('[ShuTong] Failed to match display for ROI:', e);
                    }
                }

                // Push to captures list
                // P0 Fix: Linter complained about roi possibly being undefined? No, tsconfig is strict.
                // But wait, the linter error wasn't specific.
                // The user just said "solve linter error".
                // I suspect "activeWindow" might be null in some path?
                // Or "currentTitle" is used below but not defined in this scope?
                // Ah, "currentTitle" is used in PendingFrame creation but defined at top of function.
                // Let's check "currentTitle".

                // Also "currentWindowId" is used.

                captures.push({
                    thumbnail: screenSource.thumbnail,
                    monitorId: screenSource.id,
                    appName: activeWindow?.owner.name || null,
                    captureType: 'screen',
                    roi
                });
            }
        }

        if (captures.length === 0) return;

        // Process Each Capture
        // -------------------------------------------------------------------------
        for (const capture of captures) {
            const { thumbnail, monitorId, appName, captureType, roi } = capture;

            if (!thumbnail) continue;
            if (typeof thumbnail.isEmpty === 'function' && thumbnail.isEmpty()) continue;

            const size = thumbnail.getSize();
            const bitmap = thumbnail.toBitmap();
            const estimatedBytes = Math.round(bitmap.length * 0.07); // Rough estimate

            let shouldSave = false;
            let triggerType = 'onset';

            // If window switched (handled above), we already cleared pending.
            // So for the NEW frame after switch, we should treat it as ONSET if it's the first one,
            // OR we just rely on dedup.
            // Actually, if we cleared dedup state (`resetLastFrame`), the next `checkFrameSimilarity`
            // will return { isSimilar: false } because there is no last frame.
            // So it will be saved as 'onset'. This is correct.

            // Similarity Check
            if (config.dedup.enableSimilarityDedup) {
                // Scale ROI to thumbnail size for accurate dedup
                let dedupRoi = roi;
                if (roi && monitorId) {
                    // Try to find display to get original size
                    try {
                        const parts = monitorId.split(':');
                        if (parts.length >= 2) {
                            const displayId = parseInt(parts[1], 10);
                            const display = displays.find(d => d.id === displayId);
                            if (display) {
                                const scaleX = size.width / display.bounds.width;
                                const scaleY = size.height / display.bounds.height;
                                dedupRoi = {
                                    x: Math.round(roi.x * scaleX),
                                    y: Math.round(roi.y * scaleY),
                                    w: Math.round(roi.w * scaleX),
                                    h: Math.round(roi.h * scaleY)
                                };
                            }
                        }
                    } catch (e) {
                        // Ignore scaling error, fallback to original ROI (might be wrong but safe)
                    }
                }

                // Check without updating state first (to decide logic)
                // Actually, we can just call it with updateState=false
                const simResult = checkFrameSimilarity(bitmap, size.width, size.height, estimatedBytes, false, monitorId, dedupRoi);

                if (simResult.isSimilar) {
                    // SIMILAR -> Buffer (Pending)
                    const pendingFrame: PendingFrame = {
                        buffer: bitmap,
                        thumbnail: thumbnail,
                        timestamp: Date.now(),
                        appName: appName,
                        windowTitle: currentTitle,
                        captureType: captureType,
                        windowId: currentWindowId,
                        roi: roi // Save ORIGINAL ROI for metadata
                    };
                    pendingFrames.set(monitorId, pendingFrame);
                } else {
                    // DIFFERENT -> Save (Onset)
                    shouldSave = true;
                    triggerType = 'onset';

                    // Update dedup state
                    checkFrameSimilarity(bitmap, size.width, size.height, estimatedBytes, true, monitorId, dedupRoi);

                    // Clear pending frame for this monitor as we are saving a new onset
                    pendingFrames.delete(monitorId);
                }
            } else {
                shouldSave = true;
            }

            // Checkpoint Logic (Global Trigger, Per-Monitor Action)
            const now = Date.now();
            const timeSinceLastCheckpoint = now - lastCheckpointTime;
            const systemIdleSeconds = getIdleTime();
            const guardSettings = getGuardSettings();
            const isActiveInput = systemIdleSeconds < guardSettings.idleThresholdSeconds;

            // If it's time for a checkpoint and user is active
            if (timeSinceLastCheckpoint >= CHECKPOINT_INTERVAL_MS && isActiveInput) {
                // If we have a pending frame for this monitor, save it
                const pending = pendingFrames.get(monitorId);
                if (pending) {
                    console.log(`[ShuTong] Saving CHECKPOINT keyframe for ${monitorId}`);
                    await savePendingFrame(pending, 'checkpoint', monitorId);
                    pendingFrames.delete(monitorId); // Clear after checkpoint
                }
                // We update lastCheckpointTime only after checking all? 
                // Since we are in a loop, we should update it once outside.
                // But we don't want to update it multiple times.
                // Let's defer update to outside loop or check if updated.
            }

            if (shouldSave) {
                // Save logic
                const png = thumbnail.toPNG(); // PNG

                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];

                const dayDir = path.join(getRecordingsRoot(), dateStr);
                if (!fs.existsSync(dayDir)) {
                    fs.mkdirSync(dayDir, { recursive: true });
                }

                // Filename with monitorId
                const safeMonitor = monitorId.replace(/[^a-zA-Z0-9]/g, '_');
                const filePath = path.join(dayDir, `${timeStr}_${safeMonitor}.png`); // Standard capture (onset)
                await fs.promises.writeFile(filePath, png);

                const unixTs = Math.floor(now.getTime() / 1000);
                const fullCaptureType = `${captureType}:${triggerType}`;

                // Phase 2: Context Extraction (Basic)
                // const _context = parseWindowContext(appName || '', currentTitle);
                // In future: Use context to tag screenshot metadata (e.g. project_name)

                const screenshotId = saveScreenshot(
                    filePath,
                    unixTs,
                    png.length,
                    fullCaptureType,
                    appName || undefined,
                    currentTitle,
                    monitorId,
                    roi
                );

                if (screenshotId) {
                    eventBus.emitEvent('screenshot:captured', { id: screenshotId as number, timestamp: unixTs });
                }
            }
        }

        // Update Checkpoint Timer
        const now = Date.now();
        if (now - lastCheckpointTime >= CHECKPOINT_INTERVAL_MS) {
            lastCheckpointTime = now;
        }

        // Record successful capture for statistics (count as 1 cycle)
        recordCapture();
        timer.end();
    } catch (err) {
        timer.end(); // Ensure timer ends on error
        console.error('[ShuTong] Capture failed:', err);

        if ((err as any).code === 'ENOSPC') {
            console.error('[ShuTong] CRITICAL: Disk full. Stopping recording.');
            stopRecording();
            eventBus.emitEvent('capture:error', {
                title: 'Disk Full',
                message: 'Stopped recording because there is no space left on the device.',
            });
        }
    }
}

export async function __test__captureFrame(config: CaptureConfig) {
    await captureFrame(config);
}

function calculateROI(
    displayBounds: Electron.Rectangle,
    windowBounds: { x: number; y: number; width: number; height: number }
): { x: number; y: number; w: number; h: number } | undefined {
    // Calculate intersection
    const x = Math.max(displayBounds.x, windowBounds.x);
    const y = Math.max(displayBounds.y, windowBounds.y);
    const w = Math.min(displayBounds.x + displayBounds.width, windowBounds.x + windowBounds.width) - x;
    const h = Math.min(displayBounds.y + displayBounds.height, windowBounds.y + windowBounds.height) - y;

    if (w > 0 && h > 0) {
        // ROI relative to Display (Screenshot)
        return {
            x: x - displayBounds.x,
            y: y - displayBounds.y,
            w,
            h
        };
    } else {
        console.log(`[DEBUG] calculateROI invalid intersection: w=${w}, h=${h}. Display: ${JSON.stringify(displayBounds)}, Window: ${JSON.stringify(windowBounds)}`);
    }
    return undefined;
}
