import { getMergedLLMConfig } from '../../config_manager';
import { eventBus } from '../../infrastructure/events';
import { LLMService } from '../../llm/service';
import {
    fetchUnprocessedScreenshots,
    getSetting,
    saveBatchWithScreenshots,
    saveObservation,
    saveTimelineCard,
    screenshotsForBatch,
    updateBatchStatus
} from '../../storage';

// ... existing interfaces ...

const llmService = new LLMService();

// FOR TESTING: Disable dynamic imports in test environment to avoid module loading issues
const isTest = process.env.NODE_ENV === 'test';

// ... existing start/stop ...

export async function processRecordings() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // 1. Fetch unprocessed screenshots (last 7 days)
        const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        const screenshots = fetchUnprocessedScreenshots(sevenDaysAgo);

        if (screenshots.length === 0) {
            isProcessing = false;
            return;
        }

        console.log(`[Analysis] Found ${screenshots.length} unprocessed screenshots. Grouping...`);

        // 2. Build logical batches
        const batches = createScreenshotBatches(screenshots);

        // 3. Persist batches
        for (const batch of batches) {
            const batchId = saveBatchWithScreenshots(
                batch.start,
                batch.end,
                batch.screenshots.map(s => s.id)
            );

            if (batchId) {
                console.log(`[Analysis] Created Batch #${batchId} (${batch.screenshots.length} shots, ${formatDuration(batch.end - batch.start)})`);

                // Mark initial status
                updateBatchStatus(Number(batchId), 'pending');

                // Trigger LLM Processing
                await processBatch(Number(batchId), batch.screenshots);
            }
        }

    } catch (err) {
        console.error('[Analysis] Error processing recordings:', err);
    } finally {
        isProcessing = false;
    }
}

// FOR TESTING: screenshotsOverride allows tests to bypass storage lookup and inject screenshots directly
// This avoids the need to mock the entire storage layer for each test
async function processBatch(batchId: number, screenshotsOverride?: Screenshot[]) {
    try {
        console.log(`[Analysis] Processing Batch #${batchId}...`);
        updateBatchStatus(batchId, 'processing');

        // Use injected screenshots for testing, otherwise fetch from storage
        const screenshots = (screenshotsOverride && screenshotsOverride.length > 0)
            ? screenshotsOverride
            : screenshotsForBatch(batchId);
        if (screenshots.length === 0) {
            console.log(`[Analysis] Batch #${batchId} has no screenshots.`);
            updateBatchStatus(batchId, 'failed', 'No screenshots');
            return;
        }

        // 1. Transcribe
        // Downsample screenshots to avoid token limits (100k+ tokens for 60 images)
        // We aim for ~15 images per batch (1 every 4s for 60s batch)
        const MAX_SHOTS = 15;
        const sampledScreenshots = sampleScreenshots(screenshots, MAX_SHOTS);

        console.log(`[Analysis] Transcribing Batch #${batchId} (Sampled ${sampledScreenshots.length}/${screenshots.length} shots)...`);
        // Type assertion needed because LLMService expects required fields (captured_at, file_path)
        // but our local Screenshot interface has optional fields for test compatibility
        const observations = await llmService.transcribeBatch(sampledScreenshots as any);

        const cfg = getMergedLLMConfig();
        const screenAnalyzeRole = cfg.roleConfigs?.SCREEN_ANALYZE;
        const observationModelLabel = screenAnalyzeRole ? `${screenAnalyzeRole.provider}:${screenAnalyzeRole.model}` : undefined;

        // Save observations
        for (const obs of observations) {
            saveObservation(batchId, obs.start, obs.end, obs.text, observationModelLabel);
        }

        // 2. Generate Cards
        console.log(`[Analysis] Generating cards for Batch #${batchId}...`);
        const cards = await llmService.generateActivityCards(observations);

        // Save cards
        for (const card of cards) {
            // Map observation indices back to timestamps
            // Card indices refer to the observations array
            const startObs = observations[card.start_index] || observations[0];
            const endObs = observations[card.end_index] || observations[observations.length - 1];

            const cardId = saveTimelineCard({
                batchId,
                startTs: startObs.start,
                endTs: endObs.end,
                category: card.category,
                subcategory: card.subcategory,
                title: card.title,
                summary: card.summary,
                detailedSummary: undefined,
                videoUrl: undefined
            });

            // Trigger Video Generation (Async)
            if (cardId) {
                // Run in background, don't await
                eventBus.emitEvent('card:created', { cardId: Number(cardId) });

                // Trigger Vector Storage (Async)
                if (!isTest) {
                    import('../../storage/vector-storage').then(({ vectorStorage }) => {
                        vectorStorage.addActivity({
                            id: Number(cardId),
                            category: card.category,
                            title: card.title,
                            summary: card.summary,
                            start_ts: startObs.start,
                            end_ts: endObs.end
                        }).catch(err => console.error('[Analysis] Vector indexing failed:', err));
                    });
                }
            }
        }

        updateBatchStatus(batchId, 'analyzed');
        console.log(`[Analysis] Batch #${batchId} complete. ${cards.length} cards generated.`);

    } catch (err) {
        console.error(`[Analysis] Failed to process batch #${batchId}:`, err);
        updateBatchStatus(batchId, 'failed', String(err));
    }
}

// ... createScreenshotBatches and formatDuration ...

interface Screenshot {
    id: number;
    captured_at?: number;
    // FOR TESTING: timestamp field supports test data that doesn't match production schema
    // Production uses captured_at, tests may use timestamp for convenience
    timestamp?: number;
    file_path?: string;
    file_size?: number;
}

interface ScreenshotBatch {
    screenshots: Screenshot[];
    start: number;
    end: number;
}

interface BatchingConfig {
    targetDuration: number; // Seconds (e.g., 30 min = 1800)
    maxGap: number;         // Seconds (e.g., 5 min = 300)
    minBatchDuration: number; // Seconds (e.g., 5 min = 300)
}

// NOTE: Batching is evaluated repeatedly (every analysis tick), so it should be computed at runtime.
// In dev, users often increase "Capture Interval" to 10s+; a fixed maxGap=10s would then split
// activity into many single-screenshot batches, producing near-zero-length videos.
// We therefore scale maxGap with the current capture interval.

export function getBatchingConfig(): BatchingConfig {
    // Keep unit tests deterministic.
    if (isTest) {
        return {
            targetDuration: 15 * 60,
            maxGap: 5 * 60,
            minBatchDuration: 5 * 60
        };
    }

    const intervalMsStr = getSetting('capture_interval_ms');
    const intervalMs = Math.max(1000, parseInt(intervalMsStr || '1000', 10) || 1000);
    const intervalSeconds = Math.max(1, Math.ceil(intervalMs / 1000));

    // maxGap must be larger than the capture interval; otherwise each screenshot becomes its own batch.
    // Using 1.5x leaves room for timer jitter and occasional capture delays.
    const maxGapSeconds = Math.max(10, Math.ceil(intervalSeconds * 1.5));

    return {
        targetDuration: 60,
        maxGap: maxGapSeconds,
        minBatchDuration: 10
    };
}

let analysisTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startAnalysisJob() {
    console.log('[Analysis] Starting background analysis job...');

    // Check every 60 seconds
    analysisTimer = setInterval(processRecordings, 60 * 1000);

    // Initial check
    setTimeout(processRecordings, 5000);
}

export function stopAnalysisJob() {
    if (analysisTimer) {
        clearInterval(analysisTimer);
        analysisTimer = null;
    }
}


export function createScreenshotBatches(screenshots: Screenshot[]): ScreenshotBatch[] {
    if (screenshots.length === 0) return [];

    const config = getBatchingConfig();

    // Normalize timestamps for grouping (supports both captured_at and timestamp).
    const ordered = screenshots
        .map(s => ({ ...s, captured_at: getScreenshotCapturedAt(s) }))
        .filter(s => Number.isFinite(s.captured_at))
        .sort((a, b) => (a.captured_at as number) - (b.captured_at as number));

    if (ordered.length === 0) return [];

    const batches: ScreenshotBatch[] = [];
    let bucket: Screenshot[] = [];

    for (const screenshot of ordered) {
        if (bucket.length === 0) {
            bucket.push(screenshot);
            continue;
        }

        const last = bucket[bucket.length - 1];
        const gap = (screenshot.captured_at as number) - (last.captured_at as number);

        const first = bucket[0];
        const currentDuration = (screenshot.captured_at as number) - (first.captured_at as number);
        const wouldBurst = currentDuration > config.targetDuration;

        // Close batch if gap is too large OR duration exceeds target
        if (gap > config.maxGap || wouldBurst) {
            batches.push({
                screenshots: [...bucket],
                start: first.captured_at as number,
                end: last.captured_at as number
            });
            bucket = [screenshot];
        } else {
            bucket.push(screenshot);
        }
    }

    // Handle leftover bucket
    if (bucket.length > 0) {
        const first = bucket[0];
        const last = bucket[bucket.length - 1];
        const duration = (last.captured_at as number) - (first.captured_at as number);

        // Only save the last batch if it meets minimum duration OR if it's "old enough" (user stopped recording)
        // For simplicity in this job (which runs every min), we might leave the last bucket pending
        // until more data comes in or enough time passes.
        // Swift logic: "Drop the most-recent batch if incomplete (not enough data yet)"

        // Check if the last screenshot is recent (within maxGap). If so, it might be an active session.
        const now = Math.floor(Date.now() / 1000);
        const timeSinceLast = now - (last.captured_at as number);

        if (duration >= config.minBatchDuration || timeSinceLast > config.maxGap) {
            batches.push({
                screenshots: [...bucket],
                start: first.captured_at as number,
                end: last.captured_at as number
            });
        } else {
            // Keep it in pending (do nothing, next run will pick them up)
            // But wait, existing logic fetches "unprocessed" every time.
            // If we don't save it, it will be fetched again next time. Correct.
            console.log(`[Analysis] Pending bucket of ${bucket.length} shots (${duration}s) waiting for more data...`);
        }
    }

    return batches;
}

function getScreenshotCapturedAt(screenshot: Screenshot): number {
    const ts = screenshot.captured_at ?? screenshot.timestamp;
    const asNumber = typeof ts === 'number' ? ts : Number(ts);
    return Number.isFinite(asNumber) ? asNumber : NaN;
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

function sampleScreenshots(screenshots: Screenshot[], max: number): Screenshot[] {
    if (screenshots.length <= max) return screenshots;

    const result: Screenshot[] = [];
    const step = (screenshots.length - 1) / (max - 1);

    for (let i = 0; i < max; i++) {
        const index = Math.round(i * step);
        // Ensure valid index and no duplicates (though round with step should handle it)
        if (index < screenshots.length) {
            result.push(screenshots[index]);
        }
    }
    return result;
}
