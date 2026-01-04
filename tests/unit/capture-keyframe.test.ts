import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks - must be hoisted
const mocks = vi.hoisted(() => ({
    saveScreenshot: vi.fn().mockReturnValue(1),
    getSetting: vi.fn(),
    saveWindowSwitch: vi.fn(),
    checkFrameSimilarity: vi.fn(),
    isFrameSimilar: vi.fn(),
    resetLastFrame: vi.fn(),
    updateDedupSettings: vi.fn(),
    getActiveWindow: vi.fn(),
    desktopCapturer: {
        getSources: vi.fn()
    },
    writeFile: vi.fn().mockResolvedValue(undefined),
    getIdleTime: vi.fn().mockReturnValue(5), // Default: 5 seconds idle = active
    getGuardSettings: vi.fn().mockReturnValue({ idleThresholdSeconds: 30 })
}));

// Create mock thumbnail factory
function createMockThumbnail() {
    return {
        isEmpty: vi.fn().mockReturnValue(false),
        getSize: vi.fn().mockReturnValue({ width: 100, height: 100 }),
        toBitmap: vi.fn().mockReturnValue(Buffer.alloc(100 * 100 * 4)), // RGBA buffer
        toJPEG: vi.fn().mockReturnValue(Buffer.from('fake-jpeg-content')),
        toPNG: vi.fn().mockReturnValue(Buffer.from('fake-png-content'))
    };
}

vi.mock('../../electron/storage', () => ({
    saveScreenshot: mocks.saveScreenshot,
    getSetting: mocks.getSetting,
    saveWindowSwitch: mocks.saveWindowSwitch
}));

vi.mock('../../electron/features/capture/frame-dedup', () => ({
    checkFrameSimilarity: mocks.checkFrameSimilarity,
    isFrameSimilar: mocks.isFrameSimilar,
    resetLastFrame: mocks.resetLastFrame,
    updateDedupSettings: mocks.updateDedupSettings
}));

// Mocking get-windows dynamic import
vi.mock('get-windows', () => ({
    activeWindow: mocks.getActiveWindow
}));

// Mocking capture-guard to allow capture
vi.mock('../../electron/features/capture/capture-guard', () => ({
    shouldSkipCapture: vi.fn().mockReturnValue(false),
    recordCapture: vi.fn(),
    recordSkip: vi.fn(),
    notifyWindowChange: vi.fn(),
    updateGuardSettings: vi.fn(),
    initCaptureGuard: vi.fn(),
    getIntervalMultiplier: vi.fn().mockReturnValue(1),
    onDebouncedCapture: vi.fn(),
    onWindowSwitch: vi.fn(),
    clearPendingWindowCapture: vi.fn(),
    getIdleTime: mocks.getIdleTime,
    getGuardSettings: mocks.getGuardSettings
}));

vi.mock('electron', () => ({
    app: { getPath: vi.fn().mockReturnValue('/tmp') },
    desktopCapturer: mocks.desktopCapturer,
    ipcMain: {
        handle: vi.fn(),
    },
    screen: {
        getPrimaryDisplay: vi.fn().mockReturnValue({ size: { width: 1920, height: 1080 } }),
        getAllDisplays: vi.fn().mockReturnValue([
            { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
        ])
    },
    BrowserWindow: {
        getAllWindows: vi.fn().mockReturnValue([])
    }
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        promises: {
            statfs: vi.fn().mockResolvedValue({ bfree: 100 * 1024 * 1024 * 1024, bsize: 1 }),
            writeFile: mocks.writeFile
        }
    }
}));

// Mock eventBus
vi.mock('../../electron/infrastructure/events', () => ({
    eventBus: {
        emitEvent: vi.fn()
    }
}));

// Import SUT after mocks are set up
import {
    __test__captureFrame,
    __test__resetCaptureState
} from '../../electron/features/capture/capture.service';

describe('Smart Keyframe Capture (Buffer-Commit)', () => {
    // Default test config
    const testConfig = {
        interval: 1000,
        resolution: { width: 1920, height: 1080 },
        quality: 60,
        screenIndex: 0,
        minDiskSpaceGB: 1,
        captureMode: 'screen' as const,
        excludedApps: [],
        excludedTitlePatterns: [],
        guard: {
            idleThreshold: 30,
            enableIdleDetection: true,
            enableLockDetection: true,
            debounceMs: 2000
        },
        dedup: {
            similarityThreshold: 0.05,
            enableSimilarityDedup: true
        }
    };

    beforeEach(() => {
        // Reset capture state first
        __test__resetCaptureState();

        vi.clearAllMocks();

        // Default mocks
        const mockThumbnail = createMockThumbnail();
        mocks.desktopCapturer.getSources.mockResolvedValue([
            { id: 'screen:0:0', name: 'Screen 1', thumbnail: mockThumbnail }
        ]);

        mocks.getSetting.mockImplementation((key: string) => {
            const defaults: Record<string, string> = {
                'capture_interval_ms': '1000',
                'capture_resolution': '1920x1080',
                'capture_quality': '60',
                'capture_screen_index': '0',
                'min_disk_space_gb': '1',
                'capture_mode': 'screen',
                'excluded_apps': '[]',
                'excluded_title_patterns': '[]',
                'guard_idle_threshold': '30',
                'guard_enable_idle_detection': 'true',
                'guard_enable_lock_detection': 'true',
                'guard_debounce_ms': '2000',
                'dedup_similarity_threshold': '0.05',
                'dedup_enable': 'true'
            };
            return defaults[key] || null;
        });

        // Reset getIdleTime/getGuardSettings to defaults (non-idle, standard settings)
        mocks.getIdleTime.mockReturnValue(5); // 5 seconds = active
        mocks.getGuardSettings.mockReturnValue({ idleThresholdSeconds: 30 });
    });

    afterEach(() => {
        __test__resetCaptureState();
    });

    it('should save first frame as Onset with trigger type in captureType', async () => {
        // Active window info
        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Test Window',
            owner: { name: 'TestApp', processId: 123 }
        });

        // First frame is always "not similar" (onset)
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: false, distance: 1.0 });

        // Call captureFrame directly (bypasses interval logic)
        await __test__captureFrame(testConfig);

        // Verify saveScreenshot was called with 'screen:onset'
        expect(mocks.saveScreenshot).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Number),
            expect.any(Number),
            'screen:onset',
            'TestApp',
            'Test Window',
            'screen:0:0',
            undefined
        );
    });

    it('should buffer similar frames instead of saving', async () => {
        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Test Window',
            owner: { name: 'TestApp', processId: 123 }
        });

        // Set user as idle to prevent Checkpoint from triggering
        mocks.getIdleTime.mockReturnValue(60); // 60 seconds idle = no checkpoint

        // First frame is Onset (isFirstCapture=true), so checkFrameSimilarity is NOT called.
        // Second frame: similar -> Buffer (no save)
        // Only the second call goes through similarity check
        mocks.checkFrameSimilarity
            .mockReturnValueOnce({ isSimilar: false, distance: 1.0 }) // First frame
            .mockReturnValue({ isSimilar: true, distance: 0.02 }); // Subsequent frames

        // First capture (onset)
        await __test__captureFrame(testConfig);
        expect(mocks.saveScreenshot).toHaveBeenCalledTimes(1);
        expect(mocks.checkFrameSimilarity).toHaveBeenCalled();

        // Second capture (should be buffered, not saved because user is idle)
        await __test__captureFrame(testConfig);

        // Logic change: checkFrameSimilarity is now ALWAYS called to update state.
        // It's called with updateState=false for check, and updateState=true if saving.
        // If buffered, it's called once (check).
        expect(mocks.checkFrameSimilarity).toHaveBeenCalled();

        expect(mocks.saveScreenshot).toHaveBeenCalledTimes(1); // Still 1, no new save
    });

    it('should save Exit keyframe when window switches after minimum dwell time', async () => {
        vi.useFakeTimers();

        // Set idle to prevent Checkpoint from triggering during this test
        mocks.getIdleTime.mockReturnValue(60); // Idle = no checkpoint

        // Window A first
        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Window A',
            owner: { name: 'App A', processId: 101 }
        });

        // Frame 1: Onset for A (not similar)
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: false, distance: 1.0 });
        await __test__captureFrame(testConfig);
        expect(mocks.saveScreenshot).toHaveBeenCalledTimes(1);

        // Frame 2: Similar to 1 -> Buffer (no checkpoint because user is idle)
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: true, distance: 0.02 });
        await __test__captureFrame(testConfig);
        expect(mocks.saveScreenshot).toHaveBeenCalledTimes(1); // No new save

        // Wait for dwell time (simulate 1.5 seconds passing for minDwellTime)
        vi.advanceTimersByTime(1500); // Advance beyond MIN_DWELL_TIME_MS (1000ms)

        // Frame 3: Window switch to B
        mocks.getActiveWindow.mockResolvedValue({
            id: 2,
            title: 'Window B',
            owner: { name: 'App B', processId: 102 }
        });
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: false, distance: 1.0 });
        await __test__captureFrame(testConfig);

        vi.useRealTimers();

        // Check for Exit frame was written to file
        const exitWrite = mocks.writeFile.mock.calls.find(
            (call: string[]) => call[0].includes('exit')
        );
        expect(exitWrite).toBeDefined();

        // Check new Onset was saved for App B
        const onsetBCall = mocks.saveScreenshot.mock.calls.find(
            (call: any[]) => call[3] === 'screen:onset' && call[4] === 'App B'
        );
        expect(onsetBCall).toBeDefined();
    });

    it('should discard Exit frame if dwell time is below minimum', async () => {
        vi.useFakeTimers();

        // Window A first
        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Window A',
            owner: { name: 'App A', processId: 101 }
        });

        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: true, distance: 0.02 });

        // Frame 1: Onset for A
        mocks.checkFrameSimilarity.mockReturnValueOnce({ isSimilar: false, distance: 1.0 });
        await __test__captureFrame(testConfig);

        // Frame 2: Buffer (similar)
        await __test__captureFrame(testConfig);

        // Quick switch (only 500ms, below MIN_DWELL_TIME_MS of 1000ms)
        vi.advanceTimersByTime(500);

        // Frame 3: Switch to B
        mocks.getActiveWindow.mockResolvedValue({
            id: 2,
            title: 'Window B',
            owner: { name: 'App B', processId: 102 }
        });
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: false, distance: 1.0 });
        await __test__captureFrame(testConfig);

        vi.useRealTimers();

        // fs.writeFile should NOT have been called with 'exit' filename
        const exitWrite = mocks.writeFile.mock.calls.find(
            (call: string[]) => call[0].includes('exit')
        );
        expect(exitWrite).toBeUndefined();
    });

    it('should save Checkpoint keyframe after 30s of active dwelling', async () => {
        vi.useFakeTimers();

        // Mock idle time to simulate active user (< 30s idle)
        mocks.getIdleTime.mockReturnValue(5); // 5 seconds idle = active
        mocks.getGuardSettings.mockReturnValue({ idleThresholdSeconds: 30 });

        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Window A',
            owner: { name: 'App A', processId: 101 }
        });

        // All frames are similar after the first one
        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: true, distance: 0.02 });

        // First frame: Onset
        await __test__captureFrame(testConfig);

        // Advance time by 31 seconds (beyond CHECKPOINT_INTERVAL_MS of 30s)
        vi.advanceTimersByTime(31000);

        // Second frame: Should trigger Checkpoint
        await __test__captureFrame(testConfig);

        vi.useRealTimers();

        // Check for Checkpoint frame was written
        // Note: With multi-monitor support, checkpoint saves via savePendingFrame which calls saveScreenshot
        // And saveScreenshot is mocked.
        // It also calls fs.writeFile.

        // Wait, savePendingFrame logic:
        // await fs.promises.writeFile(filePath, png);
        // saveScreenshot(...)

        // So checking writeFile is correct.
        const checkpointWrite = mocks.writeFile.mock.calls.find(
            (call: string[]) => call[0].includes('checkpoint')
        );

        // If this fails, it means savePendingFrame wasn't called.
        // Why?
        // if (triggerType === 'checkpoint') { savePendingFrame(...) }
        // triggerType depends on timeSinceLastSave > CHECKPOINT_INTERVAL

        // In this test:
        // Frame 1 (Onset) -> save time T
        // Advance 31s
        // Frame 2 -> time T+31s
        // timeSinceLastSave = 31s > 30s -> Checkpoint!
        // isSimilar = true -> enters pending logic
        // But if pending, we check for checkpoint.

        // In capture.service.ts:
        // if (simResult.isSimilar) {
        //    pendingFrames.set(...)
        //    if (timeSinceLastSave > CHECKPOINT_INTERVAL && !isUserIdle) {
        //       savePendingFrame(..., 'checkpoint')
        //       lastCaptureTime = now
        //    }
        // }

        expect(checkpointWrite).toBeDefined();
    });

    it('should NOT save Checkpoint if user is idle', async () => {
        vi.useFakeTimers();

        // Mock idle time to simulate idle user (>= 30s idle)
        mocks.getIdleTime.mockReturnValue(60); // 60 seconds idle = inactive
        mocks.getGuardSettings.mockReturnValue({ idleThresholdSeconds: 30 });

        mocks.getActiveWindow.mockResolvedValue({
            id: 1,
            title: 'Window A',
            owner: { name: 'App A', processId: 101 }
        });

        mocks.checkFrameSimilarity.mockReturnValue({ isSimilar: true, distance: 0.02 });

        // First frame: Onset
        await __test__captureFrame(testConfig);

        // Advance time by 31 seconds
        vi.advanceTimersByTime(31000);

        // Second frame: Should NOT trigger Checkpoint (user idle)
        await __test__captureFrame(testConfig);

        vi.useRealTimers();

        // Check for Checkpoint frame was NOT written
        const checkpointWrite = mocks.writeFile.mock.calls.find(
            (call: string[]) => call[0].includes('checkpoint')
        );
        expect(checkpointWrite).toBeUndefined();
    });
});
