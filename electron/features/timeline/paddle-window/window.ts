
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

export interface OCRResult {
    text: string[];
    confidence?: number;
    points?: number[][][];
    inferenceDurationMs?: number;
}

interface PendingRequest {
    resolve: (value: OCRResult | PromiseLike<OCRResult>) => void;
    reject: (reason?: any) => void;
    cleanup: () => void;
}

interface QueuedRequest {
    imagePath: string;
    resolve: (value: OCRResult | PromiseLike<OCRResult>) => void;
    reject: (reason?: any) => void;
}

export class PaddleOCRWindow {
    private static instance: PaddleOCRWindow;
    private window: BrowserWindow | null = null;
    private initPromise: Promise<void> | null = null;
    private isReady = false;

    // Active requests being processed (should be at most 1 due to serialization)
    private pendingRequests = new Map<string, PendingRequest>();

    // Queue for incoming requests
    private requestQueue: QueuedRequest[] = [];
    private isProcessingQueue = false;

    private initStartTime: number | null = null;

    private constructor() { }

    static getInstance(): PaddleOCRWindow {
        if (!PaddleOCRWindow.instance) {
            PaddleOCRWindow.instance = new PaddleOCRWindow();
        }
        return PaddleOCRWindow.instance;
    }

    public getInitStartTime(): number | null {
        return this.initStartTime;
    }

    private getHtmlPath(): string {
        // In production, files are copied to dist/paddle-window/
        // In dev, files are in dist-electron/paddle-window/ (copied by vite-plugin-static-copy)
        const basePath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'paddle-window')
            : path.join(app.getAppPath(), 'electron', 'features', 'timeline', 'paddle-window');

        return path.join(basePath, 'paddle_runner.html');
    }

    private async createWindow(): Promise<BrowserWindow> {
        if (this.window && !this.window.isDestroyed()) {
            return this.window;
        }

        this.window = new BrowserWindow({
            width: 800,
            height: 600,
            show: false, // Hidden window (set to true for debugging)
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false, // Required for 'require' in renderer
                webSecurity: false, // Allow loading local files
                backgroundThrottling: false, // Keep running in background
                offscreen: true // Use offscreen rendering for better performance/memory if not shown
            }
        });

        const htmlPath = this.getHtmlPath();
        console.log('[PaddleManager] Loading:', htmlPath);

        await this.window.loadFile(htmlPath);

        // this.window.webContents.openDevTools({ mode: 'detach' });

        this.window.webContents.on('render-process-gone', (_event, details) => {
            console.error('[PaddleManager] Renderer process gone:', details);
            this.cleanupAndReset('Renderer process gone: ' + JSON.stringify(details));
        });

        this.window.on('closed', () => {
            console.log('[PaddleManager] Window closed.');
            this.cleanupAndReset('Window closed');
        });

        // Forward console logs to main process
        this.window.webContents.on('console-message', (_event, _level, message) => {
            console.log(`[PaddleRenderer] ${message}`);
        });

        return this.window;
    }

    private cleanupAndReset(reason: string) {
        this.window = null;
        this.isReady = false;
        this.initPromise = null;
        this.initStartTime = null;

        // Clear all pending requests
        if (this.pendingRequests.size > 0) {
            console.warn(`[PaddleManager] Cleaning up ${this.pendingRequests.size} pending requests. Reason: ${reason}`);
            for (const [_, { reject, cleanup }] of this.pendingRequests) {
                cleanup(); // Removes IPC listeners
                reject(new Error(reason));
            }
            this.pendingRequests.clear();
        }

        // Clear queue
        if (this.requestQueue.length > 0) {
            console.warn(`[PaddleManager] Clearing ${this.requestQueue.length} queued requests. Reason: ${reason}`);
            for (const req of this.requestQueue) {
                req.reject(new Error(reason));
            }
            this.requestQueue = [];
        }

        this.isProcessingQueue = false;
    }

    async init(): Promise<void> {
        if (this.isReady && this.window && !this.window.isDestroyed()) return;
        if (this.initPromise) return this.initPromise;

        this.initStartTime = Date.now();
        this.initPromise = (async () => {
            await this.createWindow();
            if (!this.window) throw new Error('Failed to create window');

            // Wait for renderer ready signal with fallback timeout
            const READY_TIMEOUT_MS = 60000;
            await new Promise<void>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    ipcMain.removeListener('paddle-ready', handleReady);
                    console.warn('[PaddleManager] Ready timeout');
                    // Don't resolve, reject so we can retry or handle error
                    reject(new Error('PaddleOCR Init Timeout'));
                }, READY_TIMEOUT_MS);

                const handleReady = () => {
                    clearTimeout(timeoutId);
                    console.log('[PaddleManager] Renderer ready signal received');
                    resolve();
                };

                ipcMain.once('paddle-ready', handleReady);
            });

            this.isReady = true;
            this.initStartTime = null;
        })().catch(err => {
            this.initPromise = null;
            this.initStartTime = null;
            this.isReady = false;
            // Ensure we close the window if init failed to prevent zombie processes
            if (this.window) {
                this.window.destroy();
                this.window = null;
            }
            throw err;
        });

        return this.initPromise;
    }

    /**
     * Add request to queue and process if possible.
     * Guarantees sequential processing to avoid race conditions in renderer.
     */
    async extract(imagePath: string): Promise<OCRResult> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ imagePath, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessingQueue) return;
        if (this.requestQueue.length === 0) return;

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const req = this.requestQueue[0]; // Peek

            try {
                // Initialize if needed
                await this.init();

                if (!this.window || this.window.isDestroyed()) {
                    throw new Error('Window destroyed during processing');
                }

                // Execute the actual extraction
                const result = await this.executeExtraction(req.imagePath);

                // Remove from queue ONLY after completion (or failure)
                this.requestQueue.shift();
                req.resolve(result);

            } catch (err) {
                // Remove failed request
                this.requestQueue.shift();
                req.reject(err);

                // If critical error (window gone), we might need to stop loop? 
                // init() handles recreation, so we can continue loop.
                console.error('[PaddleManager] Request failed:', err);

                // Add a small delay to prevent rapid-fire failure loops
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        this.isProcessingQueue = false;
    }

    private executeExtraction(imagePath: string): Promise<OCRResult> {
        return new Promise((resolve, reject) => {
            if (!this.window) return reject(new Error('No window'));

            // Double check window isn't destroyed
            if (this.window.isDestroyed()) return reject(new Error('Window destroyed'));

            const requestId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
            const IPC_RESULT = 'paddle-result';
            const IPC_ERROR = 'paddle-error';

            const cleanup = () => {
                this.pendingRequests.delete(requestId);
                ipcMain.removeListener(IPC_RESULT, handleResult);
                ipcMain.removeListener(IPC_ERROR, handleError);
            };

            const handleResult = (_event: any, result: any) => {
                if (result.requestId && result.requestId !== requestId) return;
                cleanup();
                if (result.inferenceDurationMs) {
                    console.log(`[PaddleManager] Inference took ${result.inferenceDurationMs}ms`);
                }
                resolve(result);
            };

            const handleError = (_event: any, error: any) => {
                const errorData = typeof error === 'string' ? { message: error } : error;
                if (errorData.requestId && errorData.requestId !== requestId && errorData.requestId !== 'system') return;

                cleanup();

                // P1 Fix: Handle Critical WebGL Crash
                if (errorData.message === 'WEBGL_CONTEXT_LOST') {
                    console.error('[PaddleManager] Critical: WebGL Context Lost. Destroying window to force restart.');
                    this.cleanupAndReset('WebGL Context Lost');
                    if (this.window) {
                        this.window.destroy();
                        this.window = null;
                        this.isReady = false;
                    }
                    // Reject current request so it can be retried (or failed gracefully)
                    reject(new Error('WebGL Context Lost - Worker Restarting'));
                    return;
                }

                reject(new Error(errorData.message || 'Unknown error'));
            };

            this.pendingRequests.set(requestId, { resolve, reject, cleanup });
            ipcMain.on(IPC_RESULT, handleResult);
            ipcMain.on(IPC_ERROR, handleError);

            this.window.webContents.send('ocr-request', { imagePath, requestId });
        });
    }

    async terminate() {
        this.cleanupAndReset('Terminating');
        if (this.window) {
            this.window.destroy();
            this.window = null;
        }
    }
}
