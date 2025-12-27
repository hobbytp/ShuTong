/**
 * Smart Capture Guard Module
 * 
 * Provides intelligent skip conditions for screenshot capture:
 * - System idle detection
 * - Screen lock detection
 * - Display sleep detection
 * - Sensitive app blacklist
 * - Window switch event tracking with debounce
 */

import { powerMonitor } from 'electron';

// --- Types ---

export interface CaptureGuardSettings {
    idleThresholdSeconds: number;          // Default: 30
    windowSwitchDebounceMs: number;        // Default: 2000
    blacklistedApps: string[];             // Default: ["1Password", "KeePass", "Bitwarden"]
    enableIdleDetection: boolean;          // Default: true
    enableLockDetection: boolean;          // Default: true
    // Power-Aware Capture (v2)
    enableBatteryMode: boolean;            // Default: true
    batteryModeIntervalMultiplier: number; // Default: 2.0
    criticalBatteryThreshold: number;      // Default: 20 (percent)
    // Whitelist Mode (v2)
    enableWhitelistMode: boolean;          // Default: false
    whitelistedApps: string[];             // Default: []
}

export interface WindowSwitchEvent {
    timestamp: number;       // Unix timestamp (seconds)
    from_app: string | null;
    from_title: string | null;
    to_app: string;
    to_title: string;
    screenshot_id?: number;  // FK to screenshots if captured
}

export type CaptureSkipReason =
    | 'idle'
    | 'locked'
    | 'suspended'
    | 'blacklisted'
    | 'similar_frame'
    | 'low_battery'
    | 'not_whitelisted'
    | null;

// Skip log entry for Guard Status Visibility (v2)
export interface SkipLogEntry {
    timestamp: number;      // Unix timestamp in seconds
    reason: CaptureSkipReason;
    appName?: string;       // App that was active when skipped
}

// Guard statistics for status visibility
export interface GuardStatistics {
    totalCaptures: number;
    totalSkips: number;
    skipsByReason: Record<string, number>;
    lastSkipTime: number | null;
    lastSkipReason: CaptureSkipReason;
}

// --- State ---

let isScreenLocked = false;
let isSystemSuspended = false;
let isOnBatteryPower = false;
let lastWindowApp: string | null = null;
let lastWindowTitle: string | null = null;
let pendingWindowCapture: NodeJS.Timeout | null = null;
let windowSwitchCallback: ((event: WindowSwitchEvent) => void) | null = null;
let debouncedCaptureCallback: (() => void) | null = null;

// Skip log (circular buffer, max 100 entries)
const MAX_SKIP_LOG_SIZE = 100;
let skipLog: SkipLogEntry[] = [];

// Guard statistics
let guardStats: GuardStatistics = {
    totalCaptures: 0,
    totalSkips: 0,
    skipsByReason: {},
    lastSkipTime: null,
    lastSkipReason: null
};

// Default settings
let guardSettings: CaptureGuardSettings = {
    idleThresholdSeconds: 30,
    windowSwitchDebounceMs: 2000,
    blacklistedApps: ['1Password', 'KeePass', 'Bitwarden', 'LastPass'],
    enableIdleDetection: true,
    enableLockDetection: true,
    enableBatteryMode: true,
    batteryModeIntervalMultiplier: 2.0,
    criticalBatteryThreshold: 20,
    enableWhitelistMode: false,
    whitelistedApps: []
};

// --- Initialization ---

let isInitialized = false;

/**
 * Initialize the capture guard system.
 * Sets up powerMonitor event listeners for lock/unlock and suspend/resume.
 */
export function initCaptureGuard(settings?: Partial<CaptureGuardSettings>) {
    if (isInitialized) return;
    isInitialized = true;

    if (settings) {
        guardSettings = { ...guardSettings, ...settings };
    }

    // Screen lock detection
    powerMonitor.on('lock-screen', () => {
        isScreenLocked = true;
        console.log('[CaptureGuard] Screen locked - pausing capture');
    });

    powerMonitor.on('unlock-screen', () => {
        isScreenLocked = false;
        console.log('[CaptureGuard] Screen unlocked - resuming capture');
    });

    // System suspend/resume detection
    powerMonitor.on('suspend', () => {
        isSystemSuspended = true;
        console.log('[CaptureGuard] System suspended - pausing capture');
    });

    powerMonitor.on('resume', () => {
        isSystemSuspended = false;
        console.log('[CaptureGuard] System resumed - resuming capture');
    });

    // Battery power detection (Power-Aware Capture v2)
    powerMonitor.on('on-battery', () => {
        isOnBatteryPower = true;
        console.log('[CaptureGuard] Switched to battery power - may throttle captures');
    });

    powerMonitor.on('on-ac', () => {
        isOnBatteryPower = false;
        console.log('[CaptureGuard] Switched to AC power - normal capture rate');
    });

    console.log('[CaptureGuard] Initialized with settings:', guardSettings);
}

/**
 * Update guard settings at runtime.
 */
export function updateGuardSettings(settings: Partial<CaptureGuardSettings>) {
    guardSettings = { ...guardSettings, ...settings };
    console.log('[CaptureGuard] Settings updated:', guardSettings);
}

/**
 * Get current guard settings.
 */
export function getGuardSettings(): CaptureGuardSettings {
    return { ...guardSettings };
}

// --- Core Guard Logic ---

/**
 * Check if capture should be skipped based on current system state.
 * Returns the skip reason or null if capture should proceed.
 */
export function shouldSkipCapture(activeAppName?: string): CaptureSkipReason {
    // Check screen lock
    if (guardSettings.enableLockDetection && isScreenLocked) {
        return 'locked';
    }

    // Check system suspended
    if (isSystemSuspended) {
        return 'suspended';
    }

    // Check idle state
    if (guardSettings.enableIdleDetection) {
        const idleSeconds = powerMonitor.getSystemIdleTime();
        if (idleSeconds >= guardSettings.idleThresholdSeconds) {
            return 'idle';
        }
    }

    // Check blacklisted apps
    if (activeAppName && isAppBlacklisted(activeAppName)) {
        return 'blacklisted';
    }

    // Check whitelist mode - if enabled, skip apps that are NOT on the whitelist
    if (guardSettings.enableWhitelistMode && activeAppName) {
        if (!isAppWhitelisted(activeAppName)) {
            return 'not_whitelisted';
        }
    }

    return null;
}

/**
 * Check if an app is in the blacklist.
 */
export function isAppBlacklisted(appName: string): boolean {
    const normalizedName = appName.toLowerCase().replace(/\.exe$/i, '');
    return guardSettings.blacklistedApps.some(
        blacklisted => normalizedName.includes(blacklisted.toLowerCase())
    );
}

/**
 * Check if an app is in the whitelist (for whitelist mode).
 */
export function isAppWhitelisted(appName: string): boolean {
    if (guardSettings.whitelistedApps.length === 0) {
        return false; // No apps whitelisted means nothing passes
    }
    const normalizedName = appName.toLowerCase().replace(/\.exe$/i, '');
    return guardSettings.whitelistedApps.some(
        whitelisted => normalizedName.includes(whitelisted.toLowerCase())
    );
}

// --- Window Switch Detection ---

/**
 * Register callback for window switch events.
 */
export function onWindowSwitch(callback: (event: WindowSwitchEvent) => void) {
    windowSwitchCallback = callback;
}

/**
 * Register callback for debounced capture after window switch.
 */
export function onDebouncedCapture(callback: () => void) {
    debouncedCaptureCallback = callback;
}

/**
 * Notify the guard that the active window has changed.
 * This triggers immediate event logging and debounced screenshot.
 */
export function notifyWindowChange(appName: string, windowTitle: string) {
    const now = Math.floor(Date.now() / 1000);

    // Skip if same window
    if (appName === lastWindowApp && windowTitle === lastWindowTitle) {
        return;
    }

    // Create window switch event
    const event: WindowSwitchEvent = {
        timestamp: now,
        from_app: lastWindowApp,
        from_title: lastWindowTitle,
        to_app: appName,
        to_title: windowTitle
    };

    // Update state
    lastWindowApp = appName;
    lastWindowTitle = windowTitle;

    // Notify callback immediately (for logging)
    if (windowSwitchCallback) {
        try {
            windowSwitchCallback(event);
        } catch (err) {
            console.error('[CaptureGuard] Window switch callback error:', err);
        }
    }

    // Cancel any pending debounced capture
    if (pendingWindowCapture) {
        clearTimeout(pendingWindowCapture);
        pendingWindowCapture = null;
    }

    // Schedule debounced capture
    if (debouncedCaptureCallback) {
        pendingWindowCapture = setTimeout(() => {
            pendingWindowCapture = null;
            // Only trigger if we're still on the same window
            if (appName === lastWindowApp && windowTitle === lastWindowTitle) {
                console.log(`[CaptureGuard] Debounced capture triggered for: ${appName}`);
                if (debouncedCaptureCallback) debouncedCaptureCallback();
            }
        }, guardSettings.windowSwitchDebounceMs);
    }
}

/**
 * Clear pending window capture timer.
 */
export function clearPendingWindowCapture() {
    if (pendingWindowCapture) {
        clearTimeout(pendingWindowCapture);
        pendingWindowCapture = null;
    }
}

// --- Status Getters ---

export function isLocked(): boolean {
    return isScreenLocked;
}

export function isSuspended(): boolean {
    return isSystemSuspended;
}

export function getIdleTime(): number {
    return powerMonitor.getSystemIdleTime();
}

export function getLastWindow(): { app: string | null; title: string | null } {
    return { app: lastWindowApp, title: lastWindowTitle };
}

// --- Power-Aware Capture (v2) ---

/**
 * Check if device is currently running on battery power.
 */
export function isOnBattery(): boolean {
    return isOnBatteryPower;
}

/**
 * Get the interval multiplier based on current power state.
 * Returns 1.0 when on AC power, or the configured multiplier when on battery.
 */
export function getIntervalMultiplier(): number {
    if (!guardSettings.enableBatteryMode) {
        return 1.0;
    }
    return isOnBatteryPower ? guardSettings.batteryModeIntervalMultiplier : 1.0;
}

/**
 * Check if device is in critical battery state (should pause capture).
 * Note: Electron's powerMonitor doesn't directly expose battery level,
 * so this needs to be called with the current battery percentage.
 */
export function shouldPauseForLowBattery(batteryPercent: number): boolean {
    if (!guardSettings.enableBatteryMode) {
        return false;
    }
    return isOnBatteryPower && batteryPercent < guardSettings.criticalBatteryThreshold;
}

// --- Guard Status Visibility (v2) ---

/**
 * Record a skip event for statistics and logging.
 * Called when a capture is skipped for any reason.
 */
export function recordSkip(reason: CaptureSkipReason, appName?: string): void {
    if (!reason) return;

    const now = Math.floor(Date.now() / 1000);

    // Update statistics
    guardStats.totalSkips++;
    guardStats.lastSkipTime = now;
    guardStats.lastSkipReason = reason;
    guardStats.skipsByReason[reason] = (guardStats.skipsByReason[reason] || 0) + 1;

    // Add to skip log (circular buffer)
    const entry: SkipLogEntry = { timestamp: now, reason, appName };
    skipLog.push(entry);
    if (skipLog.length > MAX_SKIP_LOG_SIZE) {
        skipLog.shift();
    }

    console.log(`[CaptureGuard] Skip recorded: ${reason}${appName ? ` (${appName})` : ''}`);
}

/**
 * Record a successful capture for statistics.
 */
export function recordCapture(): void {
    guardStats.totalCaptures++;
}

/**
 * Get current guard statistics.
 */
export function getGuardStats(): GuardStatistics {
    return { ...guardStats, skipsByReason: { ...guardStats.skipsByReason } };
}

/**
 * Get recent skip log entries.
 * @param limit Maximum number of entries to return (default: all)
 */
export function getSkipLog(limit?: number): SkipLogEntry[] {
    if (limit && limit > 0) {
        return skipLog.slice(-limit);
    }
    return [...skipLog];
}

/**
 * Reset guard statistics and skip log.
 */
export function resetGuardStats(): void {
    guardStats = {
        totalCaptures: 0,
        totalSkips: 0,
        skipsByReason: {},
        lastSkipTime: null,
        lastSkipReason: null
    };
    skipLog = [];
}
