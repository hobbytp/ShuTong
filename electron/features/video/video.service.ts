import { BrowserWindow, ipcMain, nativeImage, powerMonitor } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { streamManager } from './stream-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let videoWindow: BrowserWindow | null = null;
let videoIpcConfigured = false;
let idleDestructionTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT_MS = 30 * 1000; // 30 seconds idle timeout

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

    ipcMain.handle('video:open-stream', async (_event, filePath: string) => {
        try {
            return await streamManager.createStream(filePath);
        } catch (error) {
            console.error('[VideoService] Failed to open stream:', error);
            throw error;
        }
    });

    ipcMain.handle('video:write-chunk', async (_event, streamId: string, chunk: ArrayBuffer) => {
        await streamManager.writeChunk(streamId, chunk);
    });

    ipcMain.handle('video:close-stream', async (_event, streamId: string) => {
        await streamManager.closeStream(streamId);
    });
}

export function createVideoGenerationWindow() {
    // Always cancel any pending destruction timer first to prevent race conditions
    // where the timer could fire during a new video generation task
    cancelIdleDestruction();

    if (videoWindow && !videoWindow.isDestroyed()) {
        return;
    }

    const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
    const APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..');
    const preloadPath = path.join(APP_ROOT, 'dist-electron', 'preload.mjs');

    // Use .ico for Windows, PNG for other platforms
    const VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : path.join(APP_ROOT, 'dist');
    const iconFile = process.platform === 'win32' ? 'icon.ico' : 'ShuTong.png';
    const iconPath = path.join(VITE_PUBLIC, iconFile);

    console.log('[VideoService] Creating window with preload:', preloadPath);

    videoWindow = new BrowserWindow({
        show: true,
        x: -2000, // Move far off-screen
        y: -2000,
        width: 1,
        height: 1,
        skipTaskbar: true, // Hide from Windows taskbar to avoid user confusion
        icon: nativeImage.createFromPath(iconPath),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Ensure we have access to full Node/Electron capabilities where allowed
            backgroundThrottling: false,
            preload: preloadPath
        }
    });

    if (VITE_DEV_SERVER_URL) {
        const baseUrl = VITE_DEV_SERVER_URL.endsWith('/') ? VITE_DEV_SERVER_URL.slice(0, -1) : VITE_DEV_SERVER_URL;
        const url = `${baseUrl}/src/video-generator/index.html`;
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
        videoWindow?.destroy();
        videoWindow = null;
    });

    videoWindow.on('unresponsive', () => {
        console.error('[VideoService] Video generator window became unresponsive');
        videoWindow?.destroy();
        videoWindow = null;
    });

    videoWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[VideoService] Video generator render process gone:', details.reason, details.exitCode);
        videoWindow?.destroy();
        videoWindow = null;
    });

    videoWindow.on('closed', () => {
        videoWindow = null;
    });
}

export function resetVideoServiceState() {
    if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.destroy();
    }
    videoWindow = null;
    requestQueue.length = 0;
    activeTasks = 0;
    cancelIdleDestruction();
}

function cancelIdleDestruction() {
    if (idleDestructionTimer) {
        clearTimeout(idleDestructionTimer);
        idleDestructionTimer = null;
    }
}

function scheduleIdleDestruction() {
    cancelIdleDestruction();
    idleDestructionTimer = setTimeout(() => {
        if (videoWindow && !videoWindow.isDestroyed()) {
            console.log('[VideoService] Idle timeout reached, destroying video window');
            videoWindow.destroy();
            videoWindow = null;
        }
    }, IDLE_TIMEOUT_MS);
}

function replaceExtension(filePath: string, newExtension: string) {
    const normalizedExt = newExtension.startsWith('.') ? newExtension : `.${newExtension}`;
    return filePath.replace(/\.[^.\\/]+$/, normalizedExt);
}

const requestQueue: Array<() => Promise<void>> = [];

let activeTasks = 0;
const MAX_CONCURRENT_TASKS = 3;

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
    if (activeTasks >= MAX_CONCURRENT_TASKS || requestQueue.length === 0) return;
    activeTasks++;

    const task = requestQueue.shift();
    if (task) {
        try {
            await task();
        } catch (err) {
            console.error('[VideoService] Task failed:', err);
        } finally {
            activeTasks--;
            // Add a small delay to allow cleanup/GC if needed
            setTimeout(processNextTask, 100);
        }
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

        const onTimeout = () => {
            cleanup();
            reject(new Error('Video generation timed out'));
        };

        let remainingTimeoutMs = timeoutMs;
        let timeoutStartMs = Date.now();
        let pauseCount = 0;

        let timeoutTimer: NodeJS.Timeout | null = setTimeout(onTimeout, remainingTimeoutMs);

        const pauseTimeout = () => {
            pauseCount++;
            if (pauseCount > 1) return; // already paused
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
            const elapsed = Date.now() - timeoutStartMs;
            remainingTimeoutMs = Math.max(0, remainingTimeoutMs - elapsed);
            console.log('[VideoService] Timeout paused, remaining:', remainingTimeoutMs, 'ms');
        };

        const resumeTimeout = () => {
            if (pauseCount <= 0) return;
            pauseCount--;
            if (pauseCount > 0) return; // still paused by another event
            timeoutStartMs = Date.now();
            if (remainingTimeoutMs <= 0) {
                onTimeout();
                return;
            }
            timeoutTimer = setTimeout(onTimeout, remainingTimeoutMs);
            console.log('[VideoService] Timeout resumed, remaining:', remainingTimeoutMs, 'ms');
        };

        const onSuspend = () => pauseTimeout();
        const onResume = () => resumeTimeout();
        const onLockScreen = () => pauseTimeout();
        const onUnlockScreen = () => resumeTimeout();

        powerMonitor.on('suspend', onSuspend);
        powerMonitor.on('resume', onResume);
        powerMonitor.on('lock-screen', onLockScreen);
        powerMonitor.on('unlock-screen', onUnlockScreen);

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
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }

            powerMonitor.removeListener('suspend', onSuspend);
            powerMonitor.removeListener('resume', onResume);
            powerMonitor.removeListener('lock-screen', onLockScreen);
            powerMonitor.removeListener('unlock-screen', onUnlockScreen);

            ipcMain.removeListener('video-generated', onComplete);
            ipcMain.removeListener('video-error', onError);
            ipcMain.removeListener('video-progress', onProgress);

            // Instead of destroying immediately, schedule idle destruction
            scheduleIdleDestruction();
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

        // Wait for renderer to be ready before sending the message
        // The renderer will send 'video-generator-ready' when its listener is registered
        const sendWhenReady = () => {
            console.log('[VideoService] Sending generate-video to renderer');
            videoWindow?.webContents.send('generate-video', sendParams);
        };

        const onRendererReady = () => {
            ipcMain.removeListener('video-generator-ready', onRendererReady);
            sendWhenReady();
        };

        // Check if we need to wait for either DOM load or renderer script initialization
        if (videoWindow?.webContents.isLoading()) {
            console.log('[VideoService] Window loading... waiting for renderer-ready signal');
            ipcMain.once('video-generator-ready', onRendererReady);
        } else {
            // Window already loaded - check if renderer is ready
            // Give the renderer a short window to signal readiness, otherwise send immediately
            // (covers the case where window was reused and renderer is already ready)
            const readyTimeout = setTimeout(() => {
                ipcMain.removeListener('video-generator-ready', onRendererReady);
                console.log('[VideoService] Renderer ready timeout - sending generate-video');
                sendWhenReady();
            }, 500);

            ipcMain.once('video-generator-ready', () => {
                clearTimeout(readyTimeout);
                ipcMain.removeListener('video-generator-ready', onRendererReady);
                sendWhenReady();
            });
        }
    });
}
