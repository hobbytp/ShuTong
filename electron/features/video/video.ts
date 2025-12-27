import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getScreenshotsForCard, updateCardVideoUrl } from '../../storage';
import { generateVideo } from './video.service';

type CardScreenshot = { file_path: string };

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

        const videosDir = getVideosDir();
        const outputVideoPath = path.join(videosDir, `activity_${cardId}.mp4`);
        const durationPerFrame = 0.5;

        const imagePaths = validScreenshots.map(s => s.file_path);

        const generatedVideoPath = await generateVideo(imagePaths, outputVideoPath, durationPerFrame);

        console.log(`[Video] Generated: ${generatedVideoPath}`);
        const normalizedPath = generatedVideoPath.replace(/\\/g, '/');
        updateCardVideoUrl(cardId, `media:///${normalizedPath}`);

        return generatedVideoPath;

    } catch (err) {
        console.error('[Video] Failed to generate video:', err);
        return null;
    }
}
