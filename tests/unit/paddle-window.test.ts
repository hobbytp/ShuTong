import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaddleOCRWindow } from '../../electron/features/timeline/paddle-window/window';
import { BrowserWindow, ipcMain } from 'electron';

const mocks = vi.hoisted(() => {
    const mockWebContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
    };

    const mockWindow = {
        webContents: mockWebContents,
        loadFile: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        destroy: vi.fn(),
    };

    return {
        mockWebContents,
        mockWindow
    };
});

vi.mock('electron', () => {
    return {
        app: {
            isPackaged: false,
            getAppPath: vi.fn().mockReturnValue('/app'),
            getPath: vi.fn().mockReturnValue('/userData'),
        },
        BrowserWindow: vi.fn(function() { return mocks.mockWindow; }),
        ipcMain: {
            on: vi.fn(),
            once: vi.fn(),
            removeListener: vi.fn(),
        }
    };
});

describe('PaddleOCRWindow', () => {
    let paddleWindow: PaddleOCRWindow;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton
        (PaddleOCRWindow as any).instance = null;
        paddleWindow = PaddleOCRWindow.getInstance();

        // Setup successful init simulation
        (ipcMain.once as any).mockImplementation((channel: string, callback: any) => {
            if (channel === 'paddle-ready') {
                callback();
            }
        });
    });

    it('should reject pending extraction if render process crashes', async () => {
        // 1. Capture the crash handler
        let crashHandler: any;
        mocks.mockWebContents.on.mockImplementation((event, handler) => {
            if (event === 'render-process-gone') {
                crashHandler = handler;
            }
        });

        // 2. Start extraction
        const extractPromise = paddleWindow.extract('test.jpg');

        // 3. Wait a tick for async init
        await new Promise(r => setTimeout(r, 0));

        // 4. Verify crash handler was captured
        expect(crashHandler).toBeDefined();

        // 5. Simulate crash
        crashHandler({}, { reason: 'crashed' });

        // 6. Expect promise to reject (timeout 1s to be safe)
        await expect(extractPromise).rejects.toThrow('Renderer process gone');
    });

    it('should restart window on next request after crash', async () => {
        // 1. Capture crash handler
        let crashHandler: any;
        mocks.mockWebContents.on.mockImplementation((event, handler) => {
            if (event === 'render-process-gone') {
                crashHandler = handler;
            }
        });

        // 2. Initial init/extract
        const p1 = paddleWindow.extract('test1.jpg');
        await new Promise(r => setTimeout(r, 0));
        
        // 3. Crash
        expect(crashHandler).toBeDefined();
        crashHandler({}, { reason: 'crashed' });
        await expect(p1).rejects.toThrow();

        // 4. Verify window is nullified (mock logic doesn't expose internal state easily, 
        // but subsequent calls to BrowserWindow constructor implies restart)
        expect(BrowserWindow).toHaveBeenCalledTimes(1);

        // 5. Next request should create new window
        // Need to mock ready signal for the second window too
        (ipcMain.once as any).mockImplementation((channel: string, callback: any) => {
            if (channel === 'paddle-ready') {
                callback();
            }
        });

        // Mock result for second call to avoid timeout
        (ipcMain.on as any).mockImplementation((channel: string, callback: any) => {
            if (channel === 'paddle-result') {
                // Simulate success immediately for test2
                setTimeout(() => {
                    callback({}, { requestId: 'mock-id', text: ['Success'] });
                }, 10);
            }
        });
        
        // Hack: Override the random ID generation or just ensure the mock returns *any* result if we don't validate ID strictly in test
        // Actually, the window.ts logic checks ID. 
        // We can mock `extract` logic or just verify `createWindow` is called.
        // Let's just verify `createWindow` (BrowserWindow constructor) is called again.
        
        const p2 = paddleWindow.extract('test2.jpg');
        await new Promise(r => setTimeout(r, 0)); // Allow init to run

        expect(BrowserWindow).toHaveBeenCalledTimes(2);
        
        // Cleanup p2 to avoid hanging test if we didn't mock result perfectly
        paddleWindow.terminate();
        
        // Handle the rejection caused by termination
        await expect(p2).rejects.toThrow('Terminating');
    });
});
