import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let videoWindow: BrowserWindow | null = null;
let videoIpcConfigured = false;

export function setupVideoIPC() {
    if (videoIpcConfigured) return;
    videoIpcConfigured = true;

    ipcMain.handle('video:save', async (_event, buffer: ArrayBuffer, filePath: string) => {
        try {
            await fs.writeFile(filePath, Buffer.from(buffer));
            return { success: true };
        } catch (error: any) {
            console.error('[VideoService] Failed to save video:', error);
            throw error;
        }
    });
}

export function createVideoGenerationWindow() {
    if (videoWindow && !videoWindow.isDestroyed()) return;

    const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
    const APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..');
    const preloadPath = path.join(APP_ROOT, 'dist-electron', 'preload.mjs');

    console.log('[VideoService] Creating window with preload:', preloadPath);

    videoWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Ensure we have access to full Node/Electron capabilities where allowed
            backgroundThrottling: false,
            preload: preloadPath
        }
    });

    if (VITE_DEV_SERVER_URL) {
        const url = `${VITE_DEV_SERVER_URL}/src/video-generator/index.html`;
        console.log('[VideoService] Loading URL:', url);
        videoWindow.loadURL(url);
    } else {
        // In production, vite builds to dist/src/video-generator/index.html 
        // OR dist/video-generator/index.html depending on config.
        const prodPath = path.join(APP_ROOT, 'dist/src/video-generator/index.html');
        console.log('[VideoService] Loading file:', prodPath);
        videoWindow.loadFile(prodPath);
    }

    videoWindow.webContents.on('did-finish-load', () => {
        console.log('[VideoService] Video generator window loaded');
    });

    videoWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('[VideoService] Failed to load video generator:', errorCode, errorDescription);
        // Destroy the window so next request will recreate it
        videoWindow?.destroy();
        videoWindow = null;
    });
}

export function resetVideoServiceState() {
    videoWindow = null;
    requestQueue.length = 0;
    isProcessing = false;
}

function replaceExtension(filePath: string, newExtension: string) {
    const normalizedExt = newExtension.startsWith('.') ? newExtension : `.${newExtension}`;
    return filePath.replace(/\.[^.\\/]+$/, normalizedExt);
}

const requestQueue: Array<() => Promise<void>> = [];
let isProcessing = false;

export function generateVideo(
    images: string[],
    outputPath: string,
    durationPerFrame: number = 0.5,
    outputFormat: 'mp4' | 'webm' = 'mp4'
): Promise<string> {
    return new Promise((resolve, reject) => {
        const task = async () => {
            try {
                const result = await executeVideoGeneration(images, outputPath, durationPerFrame, outputFormat);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };

        requestQueue.push(task);
        processNextTask();
    });
}

async function processNextTask() {
    if (isProcessing || requestQueue.length === 0) return;
    isProcessing = true;

    const task = requestQueue.shift();
    if (task) {
        try {
            await task();
        } catch (err) {
            console.error('[VideoService] Task failed:', err);
        } finally {
            isProcessing = false;
            // Add a small delay to allow cleanup/GC if needed
            setTimeout(processNextTask, 100);
        }
    } else {
        isProcessing = false;
    }
}

function executeVideoGeneration(
    images: string[],
    outputPath: string,
    durationPerFrame: number,
    outputFormat: 'mp4' | 'webm'
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!videoWindow || videoWindow.isDestroyed()) {
            createVideoGenerationWindow();
        }

        const requestId = Date.now().toString() + Math.random().toString().slice(2, 5);
        const timeoutMs = 5 * 60 * 1000; // 5 minutes timeout

        const timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error('Video generation timed out'));
        }, timeoutMs);

        const onComplete = (_event: any, data: any) => {
            if (data.requestId === requestId) {
                cleanup();
                resolve(data.outputPath);
            }
        };

        const onError = (_event: any, data: any) => {
            if (data.requestId !== requestId) return;

            const errorMessage = String(data?.error ?? 'Video generation failed');
            cleanup();

            if (outputFormat === 'mp4' && /H\.264 not supported/i.test(errorMessage)) {
                console.warn('[VideoService] H.264 not supported, falling back to WebM');
                const fallbackPath = replaceExtension(outputPath, '.webm');
                // Re-queue as a new task
                generateVideo(images, fallbackPath, durationPerFrame, 'webm')
                    .then(resolve)
                    .catch(reject);
                return;
            }

            reject(new Error(errorMessage));
        };

        const onProgress = (_event: any, data: any) => {
            if (data.requestId === requestId) {
                // Optional: emit progress event to main app
            }
        }

        const cleanup = () => {
            clearTimeout(timeoutTimer);
            ipcMain.removeListener('video-generated', onComplete);
            ipcMain.removeListener('video-error', onError);
            ipcMain.removeListener('video-progress', onProgress);
        };

        ipcMain.on('video-generated', onComplete);
        ipcMain.on('video-error', onError);
        ipcMain.on('video-progress', onProgress);

        const sendParams = {
            requestId,
            images,
            durationPerFrame,
            outputFormat,
            outputPath
        };

        // Ensure window is ready
        if (videoWindow?.webContents.isLoading()) {
            console.log('[VideoService] Window loading... queuing trigger');
            videoWindow.webContents.once('did-finish-load', () => {
                console.log('[VideoService] Window loaded. Sending generate-video');
                videoWindow?.webContents.send('generate-video', sendParams);
            });
        } else {
            console.log('[VideoService] Window ready. Sending generate-video');
            videoWindow?.webContents.send('generate-video', sendParams);
        }
    });
}
