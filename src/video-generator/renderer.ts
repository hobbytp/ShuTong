import { Muxer as MP4Muxer, ArrayBufferTarget as MP4ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';

export async function generateVideoFromImages({ requestId, images, durationPerFrame, outputFormat, outputPath }: {
    requestId: string;
    images: string[];
    durationPerFrame: number;
    outputFormat: 'mp4' | 'webm';
    outputPath: string;
}) {
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

        console.log('Starting video generation', { requestId, imagesCount: images.length, outputFormat, outputPath });
        
        const width = 1920; 
        const height = 1080;
        const fps = 30;
        // Ensure at least one frame per image
        const framesPerImage = Math.max(1, Math.round(durationPerFrame * fps));
        
        let muxer: any;
        let videoEncoder: VideoEncoder;
        
        const isMp4 = outputFormat === 'mp4';
        
        if (isMp4) {
            muxer = new MP4Muxer({
                target: new MP4ArrayBufferTarget(),
                video: {
                    codec: 'avc',
                    width,
                    height
                },
                fastStart: 'in-memory',
            });
            
            videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => console.error(e),
            });
            
            // H.264 High Profile Level 4.0
            const config: VideoEncoderConfig = {
                codec: 'avc1.640028', 
                width,
                height,
                bitrate: 5_000_000,
                hardwareAcceleration: 'prefer-hardware',
            };
            
            // Check support
            const support = await VideoEncoder.isConfigSupported(config);
            if (!support.supported) {
                console.warn('H.264 config not supported, falling back to WebM/VP9');
                throw new Error('H.264 not supported'); 
            }

            await videoEncoder.configure(config);
        } else {
            muxer = new WebMMuxer({
                target: new WebMArrayBufferTarget(),
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
            });
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        if (!ctx) throw new Error('Failed to get canvas context');

        let frameIndex = 0;
        const totalFrames = images.length * framesPerImage;

        for (let i = 0; i < images.length; i++) {
            const imagePath = images[i];
            // Use local-file protocol
            const imageUrl = `local-file://${imagePath}`;
            
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to load image (${response.status}): ${imagePath}`);
            }
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            
            // Calculate aspect ratio to fit
            const scale = Math.min(width / bitmap.width, height / bitmap.height);
            const x = (width - bitmap.width * scale) / 2;
            const y = (height - bitmap.height * scale) / 2;
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(bitmap, x, y, bitmap.width * scale, bitmap.height * scale);
            
            const frameDuration = 1_000_000 / fps; // microseconds

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
        }

        await videoEncoder.flush();
        muxer.finalize();
        
        const buffer = muxer.target.buffer;
        await videoAPI.saveVideo(buffer, outputPath);
        
        ipc.send('video-generated', { requestId, outputPath });

    } catch (error: any) {
        console.error('Video generation failed', error);
        window.ipcRenderer?.send('video-error', { requestId, error: error.message });
    }
}

if (typeof window !== 'undefined' && window.ipcRenderer) {
    window.ipcRenderer.on('generate-video', (_event, params) => generateVideoFromImages(params));
}
