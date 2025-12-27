/**
 * Video Feature Module
 * 
 * Handles video generation from timeline card screenshots.
 */
import { eventBus } from '../../infrastructure/events';
import { generateCardVideo } from './video';

export {
    generateCardVideo
} from './video';

export {
    createVideoGenerationWindow,
    generateVideo,
    resetVideoServiceState, setupVideoIPC
} from './video.service';

export function setupVideoSubscribers() {
    eventBus.subscribe('card:created', async ({ cardId }) => {
        try {
            // console.log(`[Video] Received card:created for ${cardId}, generating video...`);
            const videoPath = await generateCardVideo(cardId);
            if (videoPath) {
                eventBus.emitEvent('video:generated', { cardId, videoPath });
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[Video] Failed to generate video for card ${cardId}:`, err);
            eventBus.emitEvent('video:generation-failed', { cardId, error: errorMessage });
        }
    });
    console.log('[Video] Subscribers initialized');
}
