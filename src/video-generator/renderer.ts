import { Muxer as MP4Muxer } from 'mp4-muxer';
import { Muxer as WebMMuxer } from 'webm-muxer';

// Custom Target for IPC Streaming
class IpcTarget {
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private streamId: string, private videoAPI: NonNullable<Window['videoAPI']>) { }

    write(chunk: Uint8Array | ArrayBuffer, _offset?: number) {
        // Handle both Uint8Array (which has .buffer) and raw ArrayBuffer
        const buffer = chunk instanceof Uint8Array ? chunk.buffer : chunk;

        // Chain writes to ensure order and catch errors
        this.writeQueue = this.writeQueue.then(() =>
            this.videoAPI.writeChunk(this.streamId, buffer)
        ).catch(err => {
            console.error('[IpcTarget] Write failed:', err);
            // Optionally propagate error/stop
        });
    }

    async waitForWrites() {
        await this.writeQueue;
    }
}

export async function generateVideoFromImages({ requestId, images, durationPerFrame, outputFormat, outputPath }: {
    requestId: string;
    images: string[];
    durationPerFrame: number;
    outputFormat: 'mp4' | 'webm';
    outputPath: string;
}) {
    let videoEncoder: VideoEncoder | null = null;
    let streamId: string | null = null;
    let ipcTarget: IpcTarget | null = null;

    try {
        const ipc = window.ipcRenderer;
        const videoAPI = window.videoAPI;
        if (!ipc) {
            console.error('Video generation failed: ipcRenderer not available');
            return;
        }
        if (!videoAPI) {
            ipc.send('video-error', { requestId, error: 'videoAPI not available' });
            return;
        }
        if (!Array.isArray(images) || images.length === 0) {
            ipc.send('video-error', { requestId, error: 'No images provided' });
            return;
        }

        console.log('Starting video generation (streaming)', { requestId, imagesCount: images.length, outputFormat, outputPath });

        const width = 1920;
        const height = 1080;
        const fps = 30;
        const framesPerImage = Math.max(1, Math.round(durationPerFrame * fps));

        // 1. Open Stream
        try {
            streamId = await videoAPI.openStream(outputPath);
            ipcTarget = new IpcTarget(streamId!, videoAPI);
        } catch (e: any) {
            throw new Error(`Failed to open output stream: ${e.message}`);
        }

        let muxer: any;
        const isMp4 = outputFormat === 'mp4';

        if (isMp4) {
            muxer = new MP4Muxer({
                target: ipcTarget as any, // Cast to match Target interface loosely
                video: {
                    codec: 'avc',
                    width,
                    height
                },
                fastStart: false, // Must be false for streaming without seeking
            });

            videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => console.error(e),
            });

            const config: VideoEncoderConfig = {
                codec: 'avc1.640028',
                width,
                height,
                bitrate: 5_000_000,
                hardwareAcceleration: 'prefer-software',
            };

            const support = await VideoEncoder.isConfigSupported(config);
            if (!support.supported) {
                console.warn('H.264 config not supported, falling back to WebM/VP9');
                throw new Error('H.264 not supported');
            }

            await videoEncoder.configure(config);
        } else {
            muxer = new WebMMuxer({
                target: ipcTarget as any,
                video: {
                    codec: 'V_VP9',
                    width,
                    height,
                    frameRate: fps
                }
            });
            videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => console.error(e),
            });

            await videoEncoder.configure({
                codec: 'vp09.00.10.08',
                width,
                height,
                bitrate: 5_000_000,
                hardwareAcceleration: 'prefer-software',
            });
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        let frameIndex = 0;
        const totalFrames = images.length * framesPerImage;

        for (let i = 0; i < images.length; i++) {
            const imagePath = images[i];
            const imageUrl = `local-file://${imagePath}`;

            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to load image (${response.status}): ${imagePath}`);
            }
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);

            const scale = Math.min(width / bitmap.width, height / bitmap.height);
            const x = (width - bitmap.width * scale) / 2;
            const y = (height - bitmap.height * scale) / 2;

            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(bitmap, x, y, bitmap.width * scale, bitmap.height * scale);

            const frameDuration = 1_000_000 / fps;

            for (let j = 0; j < framesPerImage; j++) {
                const timestamp = frameIndex * frameDuration;

                const frame = new VideoFrame(canvas, {
                    timestamp,
                    duration: frameDuration
                });

                videoEncoder.encode(frame, { keyFrame: frameIndex % 30 === 0 });
                frame.close();
                frameIndex++;

                if (frameIndex % 10 === 0) {
                    ipc.send('video-progress', { requestId, progress: frameIndex / totalFrames });
                }
            }
            bitmap.close();

            // Periodically wait for writes to prevent memory buildup in valid writeQueue promises (optional but good practice)
            // if (i % 5 === 0) await ipcTarget?.waitForWrites();
        }

        await videoEncoder.flush();
        videoEncoder.close();
        videoEncoder = null;

        muxer.finalize(); // This triggers final writes

        // Wait for all chunks to be sent
        if (ipcTarget) {
            await ipcTarget.waitForWrites();
        }

        // Close stream
        if (streamId) {
            await videoAPI.closeStream(streamId);
            streamId = null;
        }

        ipc.send('video-generated', { requestId, outputPath });

    } catch (error: any) {
        console.error('Video generation failed', error);
        window.ipcRenderer?.send('video-error', { requestId, error: error.message });

        // Try to close stream on error
        if (streamId) {
            try {
                await window.videoAPI?.closeStream(streamId);
            } catch (e) { /* ignore */ }
        }
    } finally {
        try { videoEncoder?.close(); } catch { }
        videoEncoder = null;
    }
}

if (typeof window !== 'undefined' && window.ipcRenderer) {
    window.ipcRenderer.on('generate-video', (_event, params) => generateVideoFromImages(params));
    // Signal to main process that the video generator is ready to receive messages
    window.ipcRenderer.send('video-generator-ready');
    console.log('[VideoGenerator] Renderer ready and listening for generate-video messages');
}
