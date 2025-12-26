import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';

let videoWindow: BrowserWindow | null = null;

export function createVideoGenerationWindow() {
    if (videoWindow && !videoWindow.isDestroyed()) return;

    const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
    const APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..');

    videoWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.mjs')
        }
    });

    if (VITE_DEV_SERVER_URL) {
        videoWindow.loadURL(`${VITE_DEV_SERVER_URL}/src/video-generator/index.html`);
    } else {
        // In production, vite builds to dist/src/video-generator/index.html 
        // OR dist/video-generator/index.html depending on config.
        // Let's assume dist/src/video-generator/index.html based on input structure
        videoWindow.loadFile(path.join(APP_ROOT, 'dist/src/video-generator/index.html'));
    }

    videoWindow.webContents.on('did-finish-load', () => {
        console.log('[VideoService] Video generator window loaded');
    });
    
    videoWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[VideoService] Failed to load video generator:', errorCode, errorDescription);
    });
}

export function generateVideo(images: string[], outputPath: string, durationPerFrame: number = 0.5): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!videoWindow || videoWindow.isDestroyed()) {
            createVideoGenerationWindow();
        }
        
        // Wait for window to be ready if it's loading?
        // For now assume it's fast enough or we can queue.
        // Ideally we should wait for 'did-finish-load' if it's new.
        
        const requestId = Date.now().toString() + Math.random().toString().slice(2, 5);
        
        const onComplete = (event: any, data: any) => {
            if (data.requestId === requestId) {
                cleanup();
                resolve(data.outputPath);
            }
        };
        
        const onError = (event: any, data: any) => {
             if (data.requestId === requestId) {
                cleanup();
                reject(new Error(data.error));
            }
        };

        const onProgress = (event: any, data: any) => {
            if (data.requestId === requestId) {
                // Optional: emit progress event to main app
                // console.log(`[VideoService] Progress: ${data.progress}`);
            }
        }
        
        const cleanup = () => {
            ipcMain.removeListener('video-generated', onComplete);
            ipcMain.removeListener('video-error', onError);
            ipcMain.removeListener('video-progress', onProgress);
        };
        
        ipcMain.on('video-generated', onComplete);
        ipcMain.on('video-error', onError);
        ipcMain.on('video-progress', onProgress);
        
        // Ensure window is ready
        if (videoWindow?.webContents.isLoading()) {
             videoWindow.webContents.once('did-finish-load', () => {
                 videoWindow?.webContents.send('generate-video', {
                    requestId,
                    images,
                    durationPerFrame,
                    outputFormat: 'mp4',
                    outputPath
                });
             });
        } else {
            videoWindow?.webContents.send('generate-video', {
                requestId,
                images,
                durationPerFrame,
                outputFormat: 'mp4',
                outputPath
            });
        }
    });
}
