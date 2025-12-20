import { app, desktopCapturer, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { saveScreenshot } from './storage';

let captureInterval: NodeJS.Timeout | null = null;
let isRecording = false;

export function getIsRecording() {
    return isRecording;
}

function getRecordingsRoot() {
    const root = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
    }
    return root;
}

export function setupScreenCapture() {
    ipcMain.handle('start-recording-sync', () => {
        startRecording();
        return true;
    });

    ipcMain.handle('stop-recording-sync', () => {
        stopRecording();
        return true;
    });

    ipcMain.handle('get-recording-status', () => {
        return isRecording;
    });
}

export function startRecording() {
    if (isRecording) return;
    isRecording = true;
    app.emit('recording-changed', true);
    console.log('[ShuTong] Started recording');

    captureFrame();
    captureInterval = setInterval(() => {
        captureFrame();
    }, 1000);
}

export function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    app.emit('recording-changed', false);
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    console.log('[ShuTong] Stopped recording');
}

async function captureFrame() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 },
            fetchWindowIcons: false
        });

        const primarySource = sources[0];
        if (!primarySource) return;

        const jpeg = primarySource.thumbnail.toJPEG(60);

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];

        const dayDir = path.join(getRecordingsRoot(), dateStr);
        if (!fs.existsSync(dayDir)) {
            fs.mkdirSync(dayDir, { recursive: true });
        }

        const filePath = path.join(dayDir, `${timeStr}.jpg`);
        await fs.promises.writeFile(filePath, jpeg);

        const unixTs = Math.floor(now.getTime() / 1000);
        saveScreenshot(filePath, unixTs, jpeg.length);
    } catch (error: any) {
        console.error('[ShuTong] Capture error:', error);

        if (error.code === 'ENOSPC') {
            console.error('[ShuTong] CRITICAL: Disk full. Stopping recording.');
            stopRecording();
            app.emit('capture-error', {
                title: 'Disk Full',
                message: 'Stopped recording because there is no space left on the device.'
            });
        }
    }
}
