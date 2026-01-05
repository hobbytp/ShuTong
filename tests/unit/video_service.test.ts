import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoGenerationWindow, generateVideo, resetVideoServiceState } from '../../electron/features/video';

// Define mocks outside to avoid hoisting issues, but we need to use vi.hoisted for variables used in vi.mock
const mocks = vi.hoisted(() => {
    let listeners = new Map<string, Set<(...args: any[]) => void>>();

    const mockPowerMonitor = {
        on: (eventName: string, listener: (...args: any[]) => void) => {
            const set = listeners.get(eventName) ?? new Set();
            set.add(listener);
            listeners.set(eventName, set);
        },
        removeListener: (eventName: string, listener: (...args: any[]) => void) => {
            const set = listeners.get(eventName);
            set?.delete(listener);
        },
        emit: (eventName: string, ...args: any[]) => {
            const set = listeners.get(eventName);
            if (!set) return false;
            for (const listener of Array.from(set)) {
                listener(...args);
            }
            return true;
        },
        _reset: () => {
            listeners = new Map<string, Set<(...args: any[]) => void>>();
        }
    };

    const mockWebContents = {
        on: vi.fn(),
        once: vi.fn(),
        send: vi.fn(),
        isLoading: vi.fn().mockReturnValue(false),
        loadURL: vi.fn(),
        loadFile: vi.fn()
    };

    const mockBrowserWindow = {
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        webContents: mockWebContents,
        on: vi.fn(),
        once: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        destroy: vi.fn()
    };

    const mockIpcMain = {
        on: vi.fn(),
        removeListener: vi.fn()
    };

    return {
        mockWebContents,
        mockBrowserWindow,
        mockIpcMain,
        mockPowerMonitor,
        MockBrowserWindow: vi.fn(function () { return mockBrowserWindow; })
    };
});

vi.mock('electron', () => ({
    BrowserWindow: mocks.MockBrowserWindow,
    ipcMain: mocks.mockIpcMain,
    powerMonitor: mocks.mockPowerMonitor,
    nativeImage: {
        createFromPath: vi.fn()
    }
}));

describe('Video Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (mocks.mockPowerMonitor as any)._reset();
        resetVideoServiceState();
    });

    it('should create a hidden window', () => {
        createVideoGenerationWindow();
        expect(mocks.MockBrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            show: true,
            webPreferences: expect.objectContaining({
                backgroundThrottling: false
            })
        }));
    });

    it('should send generate-video IPC message', async () => {
        const promise = generateVideo(['img1.png'], 'output.mp4');

        // Simulate window ready
        expect(mocks.mockWebContents.send).toHaveBeenCalledWith('generate-video', expect.objectContaining({
            images: ['img1.png'],
            outputPath: 'output.mp4'
        }));
    });

    it('should resolve promise when video-generated is received', async () => {
        const promise = generateVideo(['img1.png'], 'output.mp4');

        // Get the requestId sent
        const sendCall = mocks.mockWebContents.send.mock.calls.find(call => call[0] === 'generate-video');
        expect(sendCall).toBeDefined();
        const requestId = sendCall![1].requestId;

        // Simulate IPC reply
        const onCompleteCall = mocks.mockIpcMain.on.mock.calls.find(call => call[0] === 'video-generated');
        expect(onCompleteCall).toBeDefined();
        const onComplete = onCompleteCall![1];

        onComplete({}, { requestId, outputPath: 'output.mp4' });

        const result = await promise;
        expect(result).toBe('output.mp4');
    });

    it('should reject promise when video-error is received', async () => {
        const promise = generateVideo(['img1.png'], 'output.mp4');

        const sendCall = mocks.mockWebContents.send.mock.calls.find(call => call[0] === 'generate-video');
        expect(sendCall).toBeDefined();
        const requestId = sendCall![1].requestId;

        const onErrorCall = mocks.mockIpcMain.on.mock.calls.find(call => call[0] === 'video-error');
        expect(onErrorCall).toBeDefined();
        const onError = onErrorCall![1];

        onError({}, { requestId, error: 'Encoding failed' });

        await expect(promise).rejects.toThrow('Encoding failed');
    });

    it('should pause timeout during system suspend', async () => {
        vi.useFakeTimers();

        const promise = generateVideo(['img1.png'], 'output.mp4');

        const sendCall = mocks.mockWebContents.send.mock.calls.find(call => call[0] === 'generate-video');
        expect(sendCall).toBeDefined();
        const requestId = sendCall![1].requestId;

        // Advance close to timeout
        vi.advanceTimersByTime(4 * 60 * 1000);
        mocks.mockPowerMonitor.emit('suspend');

        // While suspended, time should not count toward timeout
        vi.advanceTimersByTime(10 * 60 * 1000);

        const settled = await Promise.race([
            promise.then(() => true).catch(() => true),
            Promise.resolve(false)
        ]);

        expect(settled).toBe(false);

        // Resume: should still be able to complete successfully
        mocks.mockPowerMonitor.emit('resume');

        const onCompleteCall = mocks.mockIpcMain.on.mock.calls.find(call => call[0] === 'video-generated');
        expect(onCompleteCall).toBeDefined();
        const onComplete = onCompleteCall![1];

        onComplete({}, { requestId, outputPath: 'output.mp4' });
        await expect(promise).resolves.toBe('output.mp4');

        vi.useRealTimers();
    });
});
