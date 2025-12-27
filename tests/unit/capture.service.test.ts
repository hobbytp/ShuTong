import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 1. Hoist mocks due to vitest hoisting
const mocks = vi.hoisted(() => ({
    mockEmitEvent: vi.fn(),
    mockTypedHandle: vi.fn(),
    mockGetSetting: vi.fn(),
    mockSaveScreenshot: vi.fn(),
    mockGetCaptureConfig: vi.fn().mockReturnValue({
        screenshotInterval: 1000,
        minDiskSpaceGB: 1,
        resolution: '1920x1080',
        imageFormat: 'jpeg',
        jpegQuality: 80
    }),
    mockStatfs: vi.fn().mockResolvedValue({ bfree: 10 * 1024 * 1024 * 1024, bsize: 1 }), // 10GB
    mockDesktopCapturer: {
        getSources: vi.fn().mockResolvedValue([{
            id: 'screen:1',
            name: 'Screen 1',
            thumbnail: {
                toPNG: vi.fn().mockReturnValue(Buffer.from([])),
                isEmpty: vi.fn().mockReturnValue(false),
                getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
                toBitmap: vi.fn().mockReturnValue(Buffer.alloc(100)),
                toJPEG: vi.fn().mockReturnValue(Buffer.alloc(100))
            }
        }])
    }
}));

// 2. Mock dependencies
vi.mock('electron', () => ({
    app: { getPath: vi.fn().mockReturnValue('/tmp') },
    desktopCapturer: mocks.mockDesktopCapturer,
    screen: {
        getPrimaryDisplay: vi.fn().mockReturnValue({ size: { width: 1920, height: 1080 } }),
        getAllDisplays: vi.fn().mockReturnValue([])
    }
}));

vi.mock('../../electron/infrastructure/events', () => ({
    eventBus: {
        emitEvent: mocks.mockEmitEvent
    }
}));

vi.mock('../../electron/infrastructure/ipc/typed-ipc', () => ({
    typedHandle: mocks.mockTypedHandle
}));

vi.mock('../../electron/infrastructure/config', () => ({
    getCaptureConfig: mocks.mockGetCaptureConfig
}));

vi.mock('../../electron/storage', () => ({
    saveScreenshot: mocks.mockSaveScreenshot,
    getSetting: mocks.mockGetSetting
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        promises: {
            writeFile: vi.fn().mockResolvedValue(undefined),
            statfs: mocks.mockStatfs
        }
    }
}));

vi.mock('../../electron/features/capture/frame-dedup', () => ({
    isFrameSimilar: vi.fn().mockReturnValue(false),
    resetLastFrame: vi.fn(),
    updateDedupSettings: vi.fn()
}));

vi.mock('../../electron/features/capture/capture-guard', () => ({
    shouldCapture: vi.fn().mockReturnValue(true),
    updateGuardSettings: vi.fn(),
    initCaptureGuard: vi.fn(),
    getIntervalMultiplier: vi.fn().mockReturnValue(1),
    shouldSkipCapture: vi.fn().mockReturnValue(false),
    recordCapture: vi.fn(),
    recordSkip: vi.fn(),
    notifyWindowChange: vi.fn(),
    onWindowSwitch: vi.fn(),
    onDebouncedCapture: vi.fn(),
    clearPendingWindowCapture: vi.fn()
}));

// 3. Import System Under Test (SUT)
import {
    getIsRecording,
    startRecording,
    stopRecording
} from '../../electron/features/capture/capture.service';

describe('CaptureService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset internal state if possible (stopRecording ensures isRecording is false)
        stopRecording();
        mocks.mockEmitEvent.mockClear();
    });

    afterEach(() => {
        stopRecording();
    });

    it('should emit recording:state-changed when started', () => {
        startRecording();
        expect(getIsRecording()).toBe(true);
        expect(mocks.mockEmitEvent).toHaveBeenCalledWith('recording:state-changed', { isRecording: true });
    });

    it('should emit recording:state-changed when stopped', () => {
        startRecording();
        mocks.mockEmitEvent.mockClear();

        stopRecording();
        expect(getIsRecording()).toBe(false);
        expect(mocks.mockEmitEvent).toHaveBeenCalledWith('recording:state-changed', { isRecording: false });
    });

    it('should emit capture:error on low disk space', async () => {
        // Mock low disk space (0.5GB < 1GB min)
        // freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024)
        mocks.mockStatfs.mockResolvedValueOnce({ bfree: 0.5 * 1024 * 1024 * 1024, bsize: 1 });

        // Strategy: Use vi.useFakeTimers to trigger interval
        vi.useFakeTimers();
        startRecording();

        await vi.advanceTimersByTimeAsync(1100); // Wait for one interval

        expect(mocks.mockEmitEvent).toHaveBeenCalledWith('capture:error', expect.objectContaining({
            title: 'Low Disk Space'
        }));

        vi.useRealTimers();
    });
});
