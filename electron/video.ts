import { app } from 'electron';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { getScreenshotsForCard, updateCardVideoUrl } from './storage';

// Set ffmpeg path
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

function getVideosDir() {
    const dir = path.join(app.getPath('userData'), 'videos');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export async function generateCardVideo(cardId: number): Promise<string | null> {
    try {
        console.log(`[Video] Starting video generation for card ${cardId}`);
        const screenshots = getScreenshotsForCard(cardId);

        if (screenshots.length === 0) {
            console.log('[Video] No screenshots found for card', cardId);
            return null;
        }

        // Create a temporary input file for ffmpeg concat demuxer
        // Format: file '/path/to/image.jpg'
        //         duration 0.5
        const videosDir = getVideosDir();
        const inputFilePath = path.join(videosDir, `input_${cardId}.txt`);
        const outputVideoPath = path.join(videosDir, `activity_${cardId}.mp4`);

        // Calculate duration per frame to target a reasonable video length
        // e.g., 60 screenshots -> 5 mins actual time -> maybe 10 seconds video?
        // Let's stick to a fixed frame rate for now, e.g., 2 FPS (0.5s per image)
        const durationPerFrame = 0.5;

        const fileContent = screenshots.map((s: any) => {
            // Escape backslashes for Windows ffmpeg
            const safePath = s.file_path.replace(/\\/g, '/');
            return `file '${safePath}'\nduration ${durationPerFrame}`;
        }).join('\n');

        // Add the last file again without duration to prevent the last frame from being skipped
        // or just rely on standard concat behavior. fluent-ffmpeg concat protocol might be easier 
        // but explicit file control is more robust for image sequences.

        fs.writeFileSync(inputFilePath, fileContent);

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(inputFilePath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions([
                    '-c:v libx264',
                    '-pix_fmt yuv420p', // Compatibility check
                    '-r 30',            // Output frame rate
                    '-movflags +faststart'
                ])
                .save(outputVideoPath)
                .on('end', async () => {
                    console.log(`[Video] Generated: ${outputVideoPath}`);
                    // Clean up input file
                    fs.unlinkSync(inputFilePath);

                    // Update DB
                    // Normalize path for URL (forward slashes) and ensure media protocol format
                    const normalizedPath = outputVideoPath.replace(/\\/g, '/');
                    updateCardVideoUrl(cardId, `media:///${normalizedPath}`);
                    resolve(outputVideoPath);
                })
                .on('error', (err: any) => {
                    console.error('[Video] Error generating video:', err);
                    if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
                    reject(err);
                });
        });

    } catch (err) {
        console.error('[Video] Failed to generate video:', err);
        return null;
    }
}
