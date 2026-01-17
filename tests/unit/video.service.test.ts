import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron modules
vi.mock('electron', () => {
    // Helper vars
    const destroy = vi.fn();
    const isDestroyed = vi.fn().mockReturnValue(false);
    const loadURL = vi.fn();
    const loadFile = vi.fn();
    const on = vi.fn();
    const once = vi.fn();
    const send = vi.fn();

    // IMPORTANT: Use a regular function, NOT an arrow function, so it can be new-ed
    const BrowserWindow = vi.fn(function () {
        return {
            loadURL,
            loadFile,
            webContents: {
                on,
                once,
                send,
                isLoading: vi.fn().mockReturnValue(false)
            },
            on,
            destroy,
            isDestroyed
        };
    });

    return {
        BrowserWindow,
        ipcMain: {
            handle: vi.fn(),
            on: vi.fn(),
            once: vi.fn(),
            removeListener: vi.fn()
        },
        nativeImage: {
            createFromPath: vi.fn()
        },
        powerMonitor: {
            on: vi.fn(),
            removeListener: vi.fn()
        }
    };
});

import { generateVideo, resetVideoServiceState } from '../../electron/features/video/video.service';
import { BrowserWindow, ipcMain } from 'electron';

describe('VideoService Window Management', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetVideoServiceState();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should create a new window for the first task', async () => {
        generateVideo(['img1.png'], 'out.mp4');
        expect(BrowserWindow).toHaveBeenCalledTimes(1);
    });

    it('should reuse the window for sequential tasks', async () => {
        generateVideo(['img1.png'], 'out1.mp4');
        expect(BrowserWindow).toHaveBeenCalledTimes(1);

        generateVideo(['img2.png'], 'out2.mp4');
        expect(BrowserWindow).toHaveBeenCalledTimes(1);
    });

    it('should destroy window after idle timeout', async () => {
        generateVideo(['img1.png'], 'out.mp4');
        expect(BrowserWindow).toHaveBeenCalledTimes(1);

        // Get the mock instance and request ID
        const mockWindow = (BrowserWindow as any).mock.results[0].value;
        const sendCall = mockWindow.webContents.send.mock.calls.find((call: any) => call[0] === 'generate-video');
        expect(sendCall).toBeDefined();
        const requestId = sendCall[1].requestId;

        // Simulate video completion
        const onCompleteCall = (ipcMain.on as any).mock.calls.find((call: any) => call[0] === 'video-generated');
        expect(onCompleteCall).toBeDefined();
        const onCompleteCallback = onCompleteCall[1];

        // Trigger completion
        onCompleteCallback({}, { requestId, outputPath: 'out.mp4' });

        // Fast forward 30 seconds
        vi.advanceTimersByTime(30000);

        expect(mockWindow.destroy).toHaveBeenCalledTimes(1);
    });
});
