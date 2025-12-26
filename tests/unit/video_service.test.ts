import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoGenerationWindow, generateVideo, resetVideoServiceState } from '../../electron/video_service';

// Define mocks outside to avoid hoisting issues, but we need to use vi.hoisted for variables used in vi.mock
const mocks = vi.hoisted(() => {
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
        isDestroyed: vi.fn().mockReturnValue(false)
    };

    const mockIpcMain = {
        on: vi.fn(),
        removeListener: vi.fn()
    };

    return {
        mockWebContents,
        mockBrowserWindow,
        mockIpcMain,
        MockBrowserWindow: vi.fn(function() { return mockBrowserWindow; })
    };
});

vi.mock('electron', () => ({
    BrowserWindow: mocks.MockBrowserWindow,
    ipcMain: mocks.mockIpcMain
}));

describe('Video Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetVideoServiceState();
    });

    it('should create a hidden window', () => {
        createVideoGenerationWindow();
        expect(mocks.MockBrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            show: false,
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
});
