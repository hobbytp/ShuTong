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
import { captureMonitor, testNativeCapture } from './native-capture';

// Use native DXGI capture instead of Electron's WGC-based desktopCapturer
// This bypasses the WGC E_INVALIDARG errors on dual-GPU laptops
const USE_NATIVE_CAPTURE = true;
let nativeCaptureAvailable = false;
let nativeCaptureInitialized = false;

// Initialize native capture immediately (will be awaited on first capture if needed)
const nativeCapturePromise = (async () => {
    if (!USE_NATIVE_CAPTURE) return false;
    try {
        console.log('[ShuTong] Testing native DXGI capture...');
        const available = await testNativeCapture();
        nativeCaptureAvailable = available;
        nativeCaptureInitialized = true;
        if (available) {
            console.log('[ShuTong] ✅ Native DXGI capture enabled (bypassing WGC)');
        } else {
            console.warn('[ShuTong] ⚠️ Native capture unavailable, will use WGC');
        }
        return available;
    } catch (err) {
        console.error('[ShuTong] Native capture init error:', err);
        nativeCaptureInitialized = true;
        return false;
    }
})();



/**
 * Wrapper for desktopCapturer.getSources with retry logic.
 * Windows Graphics Capture (WGC) can timeout on first frame; retry helps.
 */
// --- Circuit Breaker State ---
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 2; // Trip breaker after 2 failures
const BASE_COOL_DOWN_MS = 30000;    // Base cooldown: 30 seconds
const MAX_COOL_DOWN_MS = 300000;    // Max cooldown: 5 minutes
let coolDownUntil = 0;
let currentCoolDownMs = BASE_COOL_DOWN_MS;

// Memory thresholds for proactive protection
const HARD_MEMORY_LIMIT_MB = 800;   // 800MB: Hard stop (lowered from 1GB for earlier detection)
const ELEVATED_MEMORY_MB = 500;     // 500MB: Trip breaker on first failure if exceeded

// Memory growth rate detection
let lastMemoryCheckMB = 0;
let lastMemoryCheckTime = Date.now();
const MEMORY_GROWTH_THRESHOLD_MB_PER_SEC = 10; // If growing faster than 10MB/s, trip breaker

// Track WGC state for diagnostics
let totalWGCCalls = 0;
let totalWGCFailures = 0;

/**
 * Wrapper for desktopCapturer.getSources with retry logic and Circuit Breaker.
 * Windows Graphics Capture (WGC) can timeout on first frame; retry helps.
 * If failures persist, we back off to avoid overloading the system.
 */
async function getSourcesWithRetry(
    options: Electron.SourcesOptions,
    maxRetries: number = 1 // Reduced default retries to 1
): Promise<Electron.DesktopCapturerSource[]> {
    // 1. Check Circuit Breaker
    if (Date.now() < coolDownUntil) {
        // Log only once per minute to avoid spam
        if (Math.random() < 0.05) {
            console.warn(`[ShuTong] Capture skipped (Circuit Breaker active for ${((coolDownUntil - Date.now()) / 1000).toFixed(0)}s)`);
        }
        metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
        return [];
    }

    // 2. Safety Valve: Check Memory Usage and Growth Rate
    const mem = process.memoryUsage();
    const rssMB = mem.rss / 1024 / 1024;
    const now = Date.now();
    const timeDeltaSec = (now - lastMemoryCheckTime) / 1000;

    // Hard Limit: If RSS > 800MB, WGC is likely leaking. Stop immediately.
    if (rssMB > HARD_MEMORY_LIMIT_MB) {
        console.error(`[ShuTong] 🚨 OFF-HEAP MEMORY LEAK DETECTED (RSS: ${rssMB.toFixed(0)}MB). Stopping capture to protect system.`);
        coolDownUntil = Date.now() + 5 * 60 * 1000; // 5 minutes
        stopRecording(); // Hard stop
        return [];
    }

    // Memory Growth Detection: If memory growing too fast, WGC is silently leaking
    if (lastMemoryCheckMB > 0 && timeDeltaSec > 5) {
        const growthMBPerSec = (rssMB - lastMemoryCheckMB) / timeDeltaSec;
        if (growthMBPerSec > MEMORY_GROWTH_THRESHOLD_MB_PER_SEC) {
            console.warn(`[ShuTong] ⚠️ RAPID MEMORY GROWTH DETECTED: ${growthMBPerSec.toFixed(1)}MB/s. Tripping circuit breaker.`);
            currentCoolDownMs = Math.min(currentCoolDownMs * 2, MAX_COOL_DOWN_MS);
            coolDownUntil = Date.now() + currentCoolDownMs;
            consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
            metrics.incCounter('capture.circuit_breaker_opened_total', { source: 'memory_growth' });
            metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
            lastMemoryCheckMB = rssMB;
            lastMemoryCheckTime = now;
            return [];
        }
    }
    lastMemoryCheckMB = rssMB;
    lastMemoryCheckTime = now;

    // Circuit is closed (healthy)
    metrics.setGauge('capture.circuit_breaker_state', 0, { source: 'wgc' });
    totalWGCCalls++;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const sources = await desktopCapturer.getSources(options);
            // Filter out sources with empty thumbnails (WGC timeout symptom)
            const validSources = sources.filter(s => !s.thumbnail.isEmpty());

            if (validSources.length > 0) {
                // Success! Reset breaker and exponential backoff
                if (consecutiveFailures > 0) {
                    console.log(`[ShuTong] WGC recovered after ${consecutiveFailures} failures. Total: ${totalWGCCalls} calls, ${totalWGCFailures} failures.`);
                    consecutiveFailures = 0;
                    currentCoolDownMs = BASE_COOL_DOWN_MS; // Reset exponential backoff
                    metrics.setGauge('capture.consecutive_failures', 0, { source: 'wgc' });
                }

                return validSources;
            }

            // Empty thumbnails - WGC returned but capture failed
            totalWGCFailures++;
            console.warn(`[ShuTong] WGC returned empty thumbnails (${attempt + 1}/${maxRetries + 1}). Total failures: ${totalWGCFailures}`);

            if (attempt === maxRetries) {
                // Treated as failure if we still have empty sources
                // Apply same exponential backoff logic as catch block
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || rssMB > ELEVATED_MEMORY_MB) {
                    // Double the cooldown (exponential backoff)
                    currentCoolDownMs = Math.min(currentCoolDownMs * 2, MAX_COOL_DOWN_MS);
                    coolDownUntil = Date.now() + currentCoolDownMs;
                    console.error(`[ShuTong] 🔴 CIRCUIT BREAKER TRIPPED (empty thumbnails). Cooldown: ${currentCoolDownMs / 1000}s`);
                    metrics.incCounter('capture.circuit_breaker_opened_total', { source: 'wgc_empty' });
                    metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
                }
            }

            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            totalWGCFailures++;
            console.warn(`[ShuTong] desktopCapturer exception (${attempt + 1}/${maxRetries + 1}):`, err);

            // PROACTIVE: Trip breaker immediately if memory is already elevated
            // This prevents the leak from spiraling to critical levels
            if (rssMB > ELEVATED_MEMORY_MB) {
                currentCoolDownMs = Math.min(currentCoolDownMs * 2, MAX_COOL_DOWN_MS);
                console.error(`[ShuTong] ⚠️ Capture failed while memory elevated (${rssMB.toFixed(0)}MB). Cooldown: ${currentCoolDownMs / 1000}s`);
                coolDownUntil = Date.now() + currentCoolDownMs;
                consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
                metrics.incCounter('capture.circuit_breaker_opened_total', { source: 'wgc_proactive' });
                metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
                return [];
            }

            if (attempt === maxRetries) {
                consecutiveFailures++;
                metrics.setGauge('capture.consecutive_failures', consecutiveFailures, { source: 'wgc' });
                metrics.incCounter('capture.errors_total', { error_category: 'wgc_timeout' });

                console.error(`[ShuTong] Capture cycle failed. Consecutive: ${consecutiveFailures}, Total failures: ${totalWGCFailures}`);

                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    // Double the cooldown (exponential backoff)
                    currentCoolDownMs = Math.min(currentCoolDownMs * 2, MAX_COOL_DOWN_MS);
                    coolDownUntil = Date.now() + currentCoolDownMs;
                    console.error(`[ShuTong] 🔴 CIRCUIT BREAKER TRIPPED. Cooldown: ${currentCoolDownMs / 1000}s (next will be ${Math.min(currentCoolDownMs * 2, MAX_COOL_DOWN_MS) / 1000}s)`);
                    metrics.incCounter('capture.circuit_breaker_opened_total', { source: 'wgc' });
                    metrics.setGauge('capture.circuit_breaker_state', 1, { source: 'wgc' });
                }
                return [];
            }

            await new Promise(r => setTimeout(r, 3000));
        }
    }
    return [];
}

let captureInterval: NodeJS.Timeout | null = null;
let isRecording = false;
let currentIntervalMs = 1000; // Track current interval for dynamic updates
let lastCapturedWindowApp: string | null = null;

// Observability State
export type CaptureStage = 'IDLE' | 'GET_CONFIG' | 'GET_SOURCES' | 'FIND_SOURCE' | 'GET_THUMBNAIL' | 'PROCESS_BITMAP' | 'DEDUP_CHECK' | 'SAVE_IO';
let currentCaptureStage: CaptureStage = 'IDLE';
let captureStartTime = 0;
let isCapturingFrame = false;
const CAPTURE_WATCHDOG_MS = 15000; // Force reset if stuck > 15s

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
    captureEngine: 'auto' | 'native' | 'wgc';
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
    const captureEngineStr = getSetting('capture_engine');

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
        },
        captureEngine: (captureEngineStr as 'auto' | 'native' | 'wgc') || 'auto'
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

    // Native capture is initialized at module load time
    // It will be awaited on first capture if not yet ready

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
        triggerCapture(config);
    });

    const triggerCapture = async (config: CaptureConfig) => {
        if (isCapturingFrame) {
            const elapsed = Date.now() - captureStartTime;
            if (elapsed > CAPTURE_WATCHDOG_MS) {
                console.warn(`[ShuTong] ⚠️ Capture Watchdog triggered! Resetting stuck lock. Stuck at: ${currentCaptureStage} for ${elapsed}ms`);
                metrics.incCounter('capture.watchdog_reset_total', { stage: currentCaptureStage });
                isCapturingFrame = false;
            } else {
                console.warn(`[ShuTong] Capture skipped (Previous capture still running). Stage: ${currentCaptureStage}, Elapsed: ${elapsed}ms`);
                return;
            }
        }

        isCapturingFrame = true;
        captureStartTime = Date.now();
        currentCaptureStage = 'GET_CONFIG';

        try {
            await captureFrame(config);
        } catch (err) {
            console.error('[ShuTong] Trigger capture error:', err);
        } finally {
            isCapturingFrame = false;
            captureStartTime = 0;
            currentCaptureStage = 'IDLE';
        }
    };

    // Initial trigger
    triggerCapture(lastConfig);

    captureInterval = setInterval(() => {
        const newConfig = getCaptureConfig();

        // Only update guard settings if they actually changed
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

        // Update dedup settings
        if (lastConfig.dedup.similarityThreshold !== newConfig.dedup.similarityThreshold ||
            lastConfig.dedup.enableSimilarityDedup !== newConfig.dedup.enableSimilarityDedup) {
            updateDedupSettings({
                similarityThreshold: newConfig.dedup.similarityThreshold,
                enableSimilarityDedup: newConfig.dedup.enableSimilarityDedup
            });
        }

        // Dynamic interval logic
        const effectiveInterval = Math.round(newConfig.interval * getIntervalMultiplier());
        if (effectiveInterval !== currentIntervalMs) {
            console.log(`[ShuTong] Interval changed from ${currentIntervalMs}ms to ${effectiveInterval}ms`);
            currentIntervalMs = effectiveInterval;
            if (captureInterval) {
                clearInterval(captureInterval);
                captureInterval = setInterval(() => {
                    triggerCapture(getCaptureConfig());
                }, currentIntervalMs);
            }
        }

        triggerCapture(newConfig);
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
        currentCaptureStage = 'GET_CONFIG';
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

        currentCaptureStage = 'FIND_SOURCE';
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
            currentCaptureStage = 'SAVE_IO'; // Switch handling involves IO
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
        currentCaptureStage = 'GET_SOURCES';
        const sourceTimer = metrics.startTimer('capture.get_sources_duration_seconds');

        const captures: {
            thumbnail: Electron.NativeImage,
            monitorId: string,
            appName: string | null,
            captureType: 'screen' | 'window',
            roi?: { x: number, y: number, w: number, h: number }
        }[] = [];

        // Get displays for ROI calculation
        const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);

        // ========== CAPTURE ENGINE SELECTION ==========
        // Priority:
        // 1. "WGC" mode -> Force WGC (Skip native)
        // 2. "Native" mode -> Force Native (Try even if not auto-detected)
        // 3. "Auto" mode -> Use Native if available, fallback to WGC

        const forceWGC = config.captureEngine === 'wgc';
        const forceNative = config.captureEngine === 'native';
        const useNative = !forceWGC && (forceNative || (USE_NATIVE_CAPTURE && nativeCaptureAvailable));

        let nativeCaptureSuccess = false;

        // Try Native Capture
        if (useNative) {
            // Ensure initialization check
            if (!nativeCaptureInitialized) {
                // If forced or auto, wait for it
                await nativeCapturePromise;
            }

            // Double check availability after wait, unless forced
            if (nativeCaptureAvailable || forceNative) {
                try {
                    const nativeResult = await captureMonitor(config.screenIndex);
                    if (nativeResult) {
                        captures.push({
                            thumbnail: nativeResult.image,
                            monitorId: nativeResult.sourceId,
                            appName: activeWindow?.owner.name || null,
                            captureType: 'screen'
                        });
                        sourceTimer.end();
                        nativeCaptureSuccess = true;

                        if (forceNative || Math.random() < 0.01) {
                            console.log(`[ShuTong] Used Native Capture (Engine: ${config.captureEngine})`);
                        }
                    } else {
                        console.warn('[ShuTong] Native capture returned null.');
                    }
                } catch (err) {
                    console.error('[ShuTong] Native capture error:', err);
                }
            }
        }

        // If Native failed AND we forced it, we should probably stop or warn?
        // Current decision: If Native fails, we FALLBACK to WGC unless explicitly prevented?
        // Robustness principle: Fallback is better than black screen unless strictly debugging.
        // But if user sets 'Native' and it breaks, they might want to know. 
        // We will fallback but log warning.

        if (forceNative && !nativeCaptureSuccess) {
            console.warn('[ShuTong] Forced Native capture failed. Falling back to WGC for safety.');
        }

        // ========== WGC CAPTURE PATH (fallback) ==========
        if (captures.length === 0 && config.captureMode === 'window' && activeWindow) {
            // Window-level capture via WGC
            const sources = await getSourcesWithRetry({
                types: ['window'],
                thumbnailSize: config.resolution,
                fetchWindowIcons: false
            });

            // Use improved matching strategy
            currentCaptureStage = 'FIND_SOURCE';
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
                currentCaptureStage = 'GET_SOURCES'; // Retry sources
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
        }

        // Screen capture via WGC (fallback if native capture failed and not in window mode)
        if (captures.length === 0) {
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

                captures.push({
                    thumbnail: screenSource.thumbnail,
                    monitorId: screenSource.id,
                    appName: activeWindow?.owner.name || null,
                    captureType: 'screen',
                    roi
                });
            }
        }

        sourceTimer.end(); // End source acquisition timer

        if (captures.length === 0) return;

        // Process Each Capture
        // -------------------------------------------------------------------------
        for (const capture of captures) {
            const { thumbnail, monitorId, appName, captureType, roi } = capture;

            if (!thumbnail) continue;
            if (typeof thumbnail.isEmpty === 'function' && thumbnail.isEmpty()) continue;

            currentCaptureStage = 'PROCESS_BITMAP';
            const bitmapTimer = metrics.startTimer('capture.bitmap_processing_duration_seconds');

            const size = thumbnail.getSize();

            // P1: Log warning for abnormally small images (User Request)
            if (size.width < 14 || size.height < 14) {
                console.warn(`[ShuTong] ⚠️ Capture Warning: Extremely small thumbnail detected (${size.width}x${size.height}) from monitor ${monitorId}. App: ${appName}`);
                // Proceeding to save for now to aid debugging, but tagged as suspicious in logs.
            }

            const bitmap = thumbnail.toBitmap();
            const estimatedBytes = Math.round(bitmap.length * 0.07); // Rough PNG estimate

            bitmapTimer.end();

            currentCaptureStage = 'DEDUP_CHECK';

            let shouldSave = false;

            // Similarity Check
            if (config.dedup.enableSimilarityDedup) {
                // Scale ROI to thumbnail size for accurate dedup
                let dedupRoi = roi;
                if (roi && monitorId) {
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
                    } catch (_e) {
                        // Ignore scaling error, fallback to original ROI
                    }
                }

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
                        roi: roi
                    };
                    pendingFrames.set(monitorId, pendingFrame);
                } else {
                    // DIFFERENT -> Save (Onset)
                    shouldSave = true;
                    checkFrameSimilarity(bitmap, size.width, size.height, estimatedBytes, true, monitorId, dedupRoi);
                    pendingFrames.delete(monitorId);
                }
            } else {
                shouldSave = true;
            }

            // Checkpoint Logic
            const now = Date.now();
            const timeSinceLastCheckpoint = now - lastCheckpointTime;
            if (timeSinceLastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
                const pending = pendingFrames.get(monitorId);
                if (pending) {
                    console.log(`[ShuTong] Saving CHECKPOINT keyframe for ${monitorId}`);
                    await savePendingFrame(pending, 'checkpoint', monitorId);
                    pendingFrames.delete(monitorId);
                }
            }

            if (shouldSave) {
                currentCaptureStage = 'SAVE_IO';
                const ioTimer = metrics.startTimer('capture.io_duration_seconds');

                const png = thumbnail.toPNG();

                const dateStr = new Date().toISOString().slice(0, 10);
                const timeStr = new Date().toISOString().replace(/[:.]/g, '-');
                const dayDir = path.join(getRecordingsRoot(), dateStr);

                if (!fs.existsSync(dayDir)) {
                    fs.mkdirSync(dayDir, { recursive: true });
                }

                const safeMonitor = monitorId.replace(/[^a-zA-Z0-9]/g, '_');
                const filePath = path.join(dayDir, `${timeStr}_${safeMonitor}.png`);

                await fs.promises.writeFile(filePath, png);

                const unixTs = Math.floor(Date.now() / 1000);
                const fullCaptureType = `${captureType}:onset`;

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

                ioTimer.end();
            }
        }

        // Update Checkpoint Timer
        const captureEndTime = Date.now();
        if (captureEndTime - lastCheckpointTime >= CHECKPOINT_INTERVAL_MS) {
            lastCheckpointTime = captureEndTime;
        }

        // Record successful capture for statistics
        recordCapture();
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
