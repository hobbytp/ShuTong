import { app } from 'electron';
import ffmpegStaticImport from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { getScreenshotsForCard, updateCardVideoUrl } from './storage';

type CardScreenshot = { file_path: string };

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

function toFfmpegConcatPath(filePath: string) {
    // Concat demuxer list uses single quotes, so escape any single quotes.
    // Also normalize Windows backslashes to forward slashes.
    return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export async function generateCardVideo(cardId: number): Promise<string | null> {
    try {
        console.log(`[Video] Starting video generation for card ${cardId}`);
        const screenshots = getScreenshotsForCard(cardId) as CardScreenshot[];

        if (screenshots.length === 0) {
            console.log('[Video] No screenshots found for card', cardId);
            return null;
        }

        console.log(`[Video] Found ${screenshots.length} screenshots for card ${cardId}`);

        // Validate that screenshot files exist
        const validScreenshots = screenshots.filter((s: CardScreenshot) => {
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

        const videosDir = getVideosDir();
        const outputVideoPath = path.join(videosDir, `activity_${cardId}.mp4`);

        const durationPerFrame = 0.5;

        // Fast path: a single image is common for very short batches.
        // Use -loop 1 instead of concat to avoid edge cases and improve reliability.
        if (validScreenshots.length === 1) {
            const imagePath = validScreenshots[0].file_path;

            return new Promise((resolve, reject) => {
                const stderrTail: string[] = [];
                let commandLine = '';

                ffmpeg()
                    .input(imagePath)
                    .inputOptions(['-loop 1'])
                    .outputOptions([
                        '-c:v libx264',
                        '-vf pad=ceil(iw/2)*2:ceil(ih/2)*2',
                        '-pix_fmt yuv420p',
                        '-r 30',
                        '-movflags +faststart'
                    ])
                    .duration(durationPerFrame)
                    .save(outputVideoPath)
                    .on('start', (cmd: string) => {
                        commandLine = cmd;
                    })
                    .on('stderr', (line: string) => {
                        stderrTail.push(line);
                        if (stderrTail.length > 40) stderrTail.shift();
                    })
                    .on('end', async () => {
                        console.log(`[Video] Generated: ${outputVideoPath}`);

                        const normalizedPath = outputVideoPath.replace(/\\/g, '/');
                        updateCardVideoUrl(cardId, `media:///${normalizedPath}`);
                        resolve(outputVideoPath);
                    })
                    .on('error', (err: any) => {
                        console.error('[Video] Error generating video:', err);
                        if (commandLine) {
                            console.error('[Video] ffmpeg command:', commandLine);
                        }
                        if (stderrTail.length > 0) {
                            console.error('[Video] ffmpeg stderr (tail):\n' + stderrTail.join('\n'));
                        }
                        reject(err);
                    });
            });
        }

        // Create a temporary input file for ffmpeg concat demuxer
        const inputFilePath = path.join(videosDir, `input_${cardId}.txt`);

        const lines: string[] = [];
        for (const s of validScreenshots) {
            const safePath = toFfmpegConcatPath(s.file_path);
            lines.push(`file '${safePath}'`);
            lines.push(`duration ${durationPerFrame}`);
        }
        // Concat demuxer ignores the last duration unless the last file is repeated.
        const lastSafePath = toFfmpegConcatPath(validScreenshots[validScreenshots.length - 1].file_path);
        lines.push(`file '${lastSafePath}'`);

        const fileContent = lines.join('\n');

        console.log(`[Video] Input file content (first 500 chars):\n${fileContent.substring(0, 500)}`);

        fs.writeFileSync(inputFilePath, fileContent);

        return new Promise((resolve, reject) => {
            const stderrTail: string[] = [];
            let commandLine = '';

            ffmpeg()
                .input(inputFilePath)
                .inputFormat('concat')
                .inputOptions(['-safe 0'])
                .outputOptions([
                    '-c:v libx264',
                    '-vf pad=ceil(iw/2)*2:ceil(ih/2)*2',
                    '-pix_fmt yuv420p',
                    '-r 30',
                    '-movflags +faststart'
                ])
                .save(outputVideoPath)
                .on('start', (cmd: string) => {
                    commandLine = cmd;
                })
                .on('stderr', (line: string) => {
                    stderrTail.push(line);
                    if (stderrTail.length > 40) stderrTail.shift();
                })
                .on('end', async () => {
                    console.log(`[Video] Generated: ${outputVideoPath}`);
                    fs.unlinkSync(inputFilePath);

                    const normalizedPath = outputVideoPath.replace(/\\/g, '/');
                    updateCardVideoUrl(cardId, `media:///${normalizedPath}`);
                    resolve(outputVideoPath);
                })
                .on('error', (err: any) => {
                    console.error('[Video] Error generating video:', err);
                    if (commandLine) {
                        console.error('[Video] ffmpeg command:', commandLine);
                    }
                    if (stderrTail.length > 0) {
                        console.error('[Video] ffmpeg stderr (tail):\n' + stderrTail.join('\n'));
                    }
                    if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
                    reject(err);
                });
        });

    } catch (err) {
        console.error('[Video] Failed to generate video:', err);
        return null;
    }
}
