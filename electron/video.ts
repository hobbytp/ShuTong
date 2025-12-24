import { app } from 'electron';
import ffmpegStaticImport from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { getScreenshotsForCard, updateCardVideoUrl } from './storage';

// Handle ESM import - ffmpeg-static might return { default: path } or just the path
const ffmpegPath = typeof ffmpegStaticImport === 'string'
    ? ffmpegStaticImport
    : (ffmpegStaticImport as any)?.default || null;

// Set ffmpeg path
console.log('[Video] ffmpeg-static raw import:', ffmpegStaticImport);
console.log('[Video] Resolved ffmpeg path:', ffmpegPath);

if (ffmpegPath && typeof ffmpegPath === 'string') {
    const resolvedPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    console.log('[Video] Setting ffmpeg path to:', resolvedPath);

    // Verify the binary exists
    if (fs.existsSync(resolvedPath)) {
        ffmpeg.setFfmpegPath(resolvedPath);
        console.log('[Video] ffmpeg binary verified at:', resolvedPath);
    } else {
        console.error('[Video] ffmpeg binary NOT FOUND at:', resolvedPath);
    }
} else {
    console.warn('[Video] ffmpeg-static path is null/undefined. Using system PATH or may fail.');
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

        console.log(`[Video] Found ${screenshots.length} screenshots for card ${cardId}`);

        // Validate that screenshot files exist
        const validScreenshots = screenshots.filter((s: any) => {
            const exists = fs.existsSync(s.file_path);
            if (!exists) {
                console.warn(`[Video] Screenshot file missing: ${s.file_path}`);
            }
            return exists;
        });

        if (validScreenshots.length === 0) {
            console.error('[Video] All screenshot files are missing! Cannot generate video.');
            return null;
        }

        if (validScreenshots.length < screenshots.length) {
            console.warn(`[Video] ${screenshots.length - validScreenshots.length} screenshots were missing, using ${validScreenshots.length} available.`);
        }

        // Create a temporary input file for ffmpeg concat demuxer
        const videosDir = getVideosDir();
        const inputFilePath = path.join(videosDir, `input_${cardId}.txt`);
        const outputVideoPath = path.join(videosDir, `activity_${cardId}.mp4`);

        const durationPerFrame = 0.5;

        const fileContent = validScreenshots.map((s: any) => {
            // Escape backslashes for Windows ffmpeg
            const safePath = s.file_path.replace(/\\/g, '/');
            return `file '${safePath}'\nduration ${durationPerFrame}`;
        }).join('\n');

        console.log(`[Video] Input file content (first 500 chars):\n${fileContent.substring(0, 500)}`);

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
