import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateVideoFromImages } from '../../src/video-generator/renderer';

// Mock external modules
vi.mock('mp4-muxer', () => ({
    Muxer: vi.fn(function() {
        return {
            addVideoChunk: vi.fn(),
            finalize: vi.fn(),
            target: { buffer: new ArrayBuffer(0) }
        };
    }),
    ArrayBufferTarget: vi.fn()
}));

vi.mock('webm-muxer', () => ({
    Muxer: vi.fn(function() {
        return {
            addVideoChunk: vi.fn(),
            finalize: vi.fn(),
            target: { buffer: new ArrayBuffer(0) }
        };
    }),
    ArrayBufferTarget: vi.fn()
}));

describe('Video Renderer', () => {
    let mockIpcRenderer: any;
    let mockVideoAPI: any;

    beforeEach(() => {
        // Mock window APIs
        mockIpcRenderer = {
            send: vi.fn(),
            on: vi.fn()
        };
        mockVideoAPI = {
            saveVideo: vi.fn().mockResolvedValue(undefined)
        };

        vi.stubGlobal('window', {
            ipcRenderer: mockIpcRenderer,
            videoAPI: mockVideoAPI
        });

        // Mock WebCodecs and Canvas APIs
        vi.stubGlobal('VideoEncoder', class {
            static isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
            configure = vi.fn();
            encode = vi.fn();
            flush = vi.fn().mockResolvedValue(undefined);
            constructor(init: any) {}
        });

        vi.stubGlobal('VideoFrame', class {
            close = vi.fn();
            constructor(source: any, init: any) {}
        });

        vi.stubGlobal('OffscreenCanvas', class {
            getContext = vi.fn().mockReturnValue({
                fillStyle: '',
                fillRect: vi.fn(),
                drawImage: vi.fn()
            });
            constructor(width: number, height: number) {}
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            blob: vi.fn().mockResolvedValue(new Blob())
        }));

        vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
            width: 100,
            height: 100,
            close: vi.fn()
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should generate MP4 video successfully', async () => {
        await generateVideoFromImages({
            requestId: 'req-1',
            images: ['img1.png'],
            durationPerFrame: 1,
            outputFormat: 'mp4',
            outputPath: 'output.mp4'
        });

        expect(mockIpcRenderer.send).toHaveBeenCalledWith('video-generated', {
            requestId: 'req-1',
            outputPath: 'output.mp4'
        });
        expect(mockVideoAPI.saveVideo).toHaveBeenCalled();
    });

    it('should generate WebM video successfully', async () => {
        await generateVideoFromImages({
            requestId: 'req-2',
            images: ['img1.png'],
            durationPerFrame: 1,
            outputFormat: 'webm',
            outputPath: 'output.webm'
        });

        expect(mockIpcRenderer.send).toHaveBeenCalledWith('video-generated', {
            requestId: 'req-2',
            outputPath: 'output.webm'
        });
    });

    it('should handle errors during generation', async () => {
        // Force an error
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        await generateVideoFromImages({
            requestId: 'req-3',
            images: ['img1.png'],
            durationPerFrame: 1,
            outputFormat: 'mp4',
            outputPath: 'output.mp4'
        });

        expect(mockIpcRenderer.send).toHaveBeenCalledWith('video-error', {
            requestId: 'req-3',
            error: 'Network error'
        });
    });
});
