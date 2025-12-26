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

import { powerMonitor, app } from 'electron';

// --- Types ---

export interface CaptureGuardSettings {
    idleThresholdSeconds: number;          // Default: 30
    windowSwitchDebounceMs: number;        // Default: 2000
    blacklistedApps: string[];             // Default: ["1Password", "KeePass", "Bitwarden"]
    enableIdleDetection: boolean;          // Default: true
    enableLockDetection: boolean;          // Default: true
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
    | null;

// --- State ---

let isScreenLocked = false;
let isSystemSuspended = false;
let lastWindowApp: string | null = null;
let lastWindowTitle: string | null = null;
let pendingWindowCapture: NodeJS.Timeout | null = null;
let windowSwitchCallback: ((event: WindowSwitchEvent) => void) | null = null;
let debouncedCaptureCallback: (() => void) | null = null;

// Default settings
let guardSettings: CaptureGuardSettings = {
    idleThresholdSeconds: 30,
    windowSwitchDebounceMs: 2000,
    blacklistedApps: ['1Password', 'KeePass', 'Bitwarden', 'LastPass'],
    enableIdleDetection: true,
    enableLockDetection: true
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
                debouncedCaptureCallback();
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
