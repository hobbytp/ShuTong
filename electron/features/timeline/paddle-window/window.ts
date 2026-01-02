
import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface OCRResult {
    text: string[];
    // points: number[][][]; // Optional for now
    confidence?: number;
}

export class PaddleOCRWindow {
    private static instance: PaddleOCRWindow;
    private window: BrowserWindow | null = null;
    private initPromise: Promise<void> | null = null;
    private isReady = false;

    private constructor() { }

    static getInstance(): PaddleOCRWindow {
        if (!PaddleOCRWindow.instance) {
            PaddleOCRWindow.instance = new PaddleOCRWindow();
        }
        return PaddleOCRWindow.instance;
    }

    private async createWindow(): Promise<BrowserWindow> {
        if (this.window && !this.window.isDestroyed()) {
            return this.window;
        }

        this.window = new BrowserWindow({
            width: 800,
            height: 600,
            show: false, // Hidden window
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false, // Required for 'require' in renderer
                webSecurity: false, // Allow loading local files
                backgroundThrottling: false // Keep running in background
            }
        });

        const htmlPath = path.join(__dirname, 'paddle_runner.html');
        // console.log('[PaddleManager] Loading:', htmlPath);

        await this.window.loadFile(htmlPath);

        // Open DevTools for debugging (optional, can be disabled)
        // this.window.webContents.openDevTools({ mode: 'detach' });

        this.window.webContents.on('render-process-gone', (_event, details) => {
            console.error('[PaddleManager] Renderer process gone:', details);
            this.window = null;
            this.isReady = false;
            this.initPromise = null;
        });

        this.window.on('closed', () => {
            this.window = null;
            this.isReady = false;
            this.initPromise = null;
        });

        // Forward console logs to main process
        this.window.webContents.on('console-message', (_event, _level, message) => {
            console.log(`[PaddleRenderer] ${message}`);
        });

        return this.window;
    }

    async init(): Promise<void> {
        if (this.isReady) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            await this.createWindow();
            if (!this.window) throw new Error('Failed to create window');

            // Wait for renderer ready signal with fallback timeout
            const READY_TIMEOUT_MS = 10000;
            await new Promise<void>((resolve) => {
                const timeoutId = setTimeout(() => {
                    ipcMain.removeListener('paddle-ready', handleReady);
                    console.warn('[PaddleManager] Ready timeout, proceeding anyway');
                    resolve(); // Proceed even if timeout (best effort)
                }, READY_TIMEOUT_MS);

                const handleReady = () => {
                    clearTimeout(timeoutId);
                    console.log('[PaddleManager] Renderer ready signal received');
                    resolve();
                };

                ipcMain.once('paddle-ready', handleReady);
            });

            this.isReady = true;
        })();

        return this.initPromise;
    }

    async extract(imagePath: string): Promise<OCRResult> {
        await this.init();
        if (!this.window) throw new Error('Paddle Window not active');

        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();

            const handleResult = (_event: any, result: any) => {
                // Validate requestId to prevent response mismatch
                if (result.requestId && result.requestId !== requestId) {
                    return; // Ignore stale response
                }
                ipcMain.removeListener('paddle-error', handleError);
                ipcMain.removeListener('paddle-result', handleResult);

                // Log inference duration if available
                if (result.inferenceDurationMs) {
                    console.log(`[PaddleManager] Inference took ${result.inferenceDurationMs}ms`);
                }

                resolve(result);
            };

            const handleError = (_event: any, error: any) => {
                // Handle both old (string) and new (object) error format
                const errorData = typeof error === 'string' ? { message: error } : error;

                if (errorData.requestId && errorData.requestId !== requestId) {
                    return; // Ignore stale error
                }
                ipcMain.removeListener('paddle-result', handleResult);
                ipcMain.removeListener('paddle-error', handleError);
                reject(new Error(errorData.message || 'Unknown error'));
            };

            ipcMain.on('paddle-result', handleResult);
            ipcMain.on('paddle-error', handleError);

            this.window!.webContents.send('ocr-request', { imagePath, requestId });
        });
    }

    async terminate() {
        if (this.window) {
            this.window.destroy();
            this.window = null;
            this.isReady = false;
            this.initPromise = null;
        }
    }
}
