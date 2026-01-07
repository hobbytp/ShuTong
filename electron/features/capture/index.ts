/**
 * Capture Feature Module
 * 
 * Handles screen/window capture, smart capture guard, and frame deduplication.
 */

// Core capture service
export {
    __test__captureFrame, __test__resetCaptureState,
    __test__setLastCapturedWindowApp, captureShutdownService, getIsRecording,
    setupScreenCapture,
    startRecording,
    stopRecording
} from './capture.service';

// Smart Capture Guard
export {
    clearPendingWindowCapture, getGuardSettings, getGuardStats, getIdleTime, getIntervalMultiplier, getLastWindow, getSkipLog, initCaptureGuard, isAppBlacklisted,
    isAppWhitelisted, isLocked, isOnBattery, isSuspended, notifyWindowChange, onDebouncedCapture, onWindowSwitch, recordCapture, recordSkip, resetGuardStats, shouldPauseForLowBattery, shouldSkipCapture, updateGuardSettings
} from './capture-guard';

export type {
    CaptureGuardSettings, CaptureSkipReason, GuardStatistics, SkipLogEntry, WindowSwitchEvent
} from './capture-guard';

// Frame Deduplication
export {
    calculateGridDistance, clearDedupState, getDedupSettings,
    getDedupStats, isFrameSimilar, resetDedupStats, resetLastFrame, sampleFrameGrid, updateDedupSettings
} from './frame-dedup';

export type { DedupSettings, DedupStats } from './frame-dedup';
