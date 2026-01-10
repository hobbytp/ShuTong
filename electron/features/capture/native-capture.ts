/**
 * Native Screenshot Service - Bypasses Electron's desktopCapturer/WGC
 * 
 * Uses node-screenshots which directly calls DXGI Desktop Duplication API,
 * avoiding the WGC E_INVALIDARG issues on dual-GPU laptops.
 */

import { nativeImage, NativeImage } from 'electron';
import { Monitor, Window } from 'node-screenshots';

export interface NativeScreenshotResult {
    image: NativeImage;
    width: number;
    height: number;
    sourceId: string;
    sourceName: string;
}

/**
 * Capture the primary monitor using native DXGI
 */
export async function captureMonitor(monitorIndex: number = 0): Promise<NativeScreenshotResult | null> {
    try {
        const monitors = Monitor.all();
        if (monitors.length === 0) {
            console.warn('[NativeCapture] No monitors found');
            return null;
        }

        const monitor = monitors[monitorIndex] || monitors[0];
        const image = monitor.captureImageSync();

        if (!image) {
            console.warn('[NativeCapture] Failed to capture monitor');
            return null;
        }

        // Convert to Electron NativeImage
        const buffer = image.toPngSync();
        const nativeImg = nativeImage.createFromBuffer(buffer);

        return {
            image: nativeImg,
            width: image.width,
            height: image.height,
            sourceId: `monitor:${monitorIndex}`,
            sourceName: `Monitor ${monitorIndex + 1}`
        };
    } catch (err) {
        console.error('[NativeCapture] Monitor capture error:', err);
        return null;
    }
}

/**
 * Capture a specific window by title match
 */
export async function captureWindow(titlePattern: string): Promise<NativeScreenshotResult | null> {
    try {
        const windows = Window.all();
        const targetWindow = windows.find(w =>
            w.title.toLowerCase().includes(titlePattern.toLowerCase())
        );

        if (!targetWindow) {
            console.warn(`[NativeCapture] Window not found: ${titlePattern}`);
            return null;
        }

        const image = targetWindow.captureImageSync();

        if (!image) {
            console.warn('[NativeCapture] Failed to capture window');
            return null;
        }

        // Convert to Electron NativeImage
        const buffer = image.toPngSync();
        const nativeImg = nativeImage.createFromBuffer(buffer);

        return {
            image: nativeImg,
            width: image.width,
            height: image.height,
            sourceId: `window:${targetWindow.id}`,
            sourceName: targetWindow.title
        };
    } catch (err) {
        console.error('[NativeCapture] Window capture error:', err);
        return null;
    }
}

/**
 * Get all available monitors
 */
export function getMonitors(): { id: number; name: string; width: number; height: number }[] {
    try {
        const monitors = Monitor.all();
        return monitors.map((m, i) => ({
            id: i,
            name: `Monitor ${i + 1}`,
            width: m.width,
            height: m.height
        }));
    } catch (err) {
        console.error('[NativeCapture] Failed to list monitors:', err);
        return [];
    }
}

/**
 * Get all available windows (excluding system windows)
 */
export function getWindows(): { id: number; title: string; appName: string }[] {
    try {
        const windows = Window.all();
        return windows
            .filter(w => w.title && w.title.length > 0) // Filter empty titles
            .map(w => ({
                id: w.id,
                title: w.title,
                appName: w.appName || 'Unknown'
            }));
    } catch (err) {
        console.error('[NativeCapture] Failed to list windows:', err);
        return [];
    }
}

/**
 * Test if native capture is available and working
 */
export async function testNativeCapture(): Promise<boolean> {
    try {
        const monitors = Monitor.all();
        if (monitors.length === 0) {
            console.warn('[NativeCapture] No monitors available');
            return false;
        }

        // Try a quick capture
        const testImage = monitors[0].captureImageSync();
        if (!testImage) {
            console.warn('[NativeCapture] Test capture failed');
            return false;
        }

        // Test PNG conversion
        const png = testImage.toPngSync();
        if (!png || png.length === 0) {
            console.warn('[NativeCapture] PNG conversion failed');
            return false;
        }

        return true;
    } catch (err) {
        console.error('[NativeCapture] Test failed:', err);
        return false;
    }
}
