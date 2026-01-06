import path from 'path';
import { getMergedLLMConfig } from '../../config_manager';
import { eventBus } from '../../infrastructure/events';
import { measure, metrics } from '../../infrastructure/monitoring/metrics.service';
import { Screenshot } from '../../infrastructure/repositories/interfaces';
import { LLMService } from '../../llm/service';
import {
    defaultRepository,
    type IAnalysisRepository
} from './analysis.repository';
import { isContextChange, parseWindowContext, type ActivityContext } from './context-parser';
import { sessionMerger } from './merge.service';
import { ocrService } from './ocr.service';
import { getAnalysisSystemPrompt } from './prompts/index';

// ... existing interfaces ...

const llmService = new LLMService();

// FOR TESTING: Disable dynamic imports in test environment to avoid module loading issues
const isTest = process.env.NODE_ENV === 'test';

let isProcessing = false;

// Initialize with default implementation
let repository: IAnalysisRepository = defaultRepository;

export function setRepositoryForTesting(repo: IAnalysisRepository) {
    repository = repo;
}

// Extended Screenshot type for analysis (adds test-compatibility fields)
export type AnalysisScreenshot = Screenshot & {
    ocr_text?: string;
    timestamp?: number;  // For test compatibility
};

export async function processRecordings() {
    if (isProcessing) {
        console.log('[Analysis] The previous processing has not been completed, so this scheduling is skipped.');
        return;
    }
    isProcessing = true;

    try {
        // 1. Fetch unprocessed screenshots (last 7 days)
        const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        // P0 Fix: Add limit to prevent OOM
        const BATCH_LIMIT = 500;
        const screenshots = repository.fetchUnprocessedScreenshots(sevenDaysAgo, BATCH_LIMIT);

        if (screenshots.length === 0) {
            isProcessing = false;
            return;
        }

        console.log(`[Analysis] Found ${screenshots.length} unprocessed screenshots. Grouping...`);

        // 2. Build logical batches (use event-based or time-based based on feature flag)
        const batches = useEventBasedBatching()
            ? createEventBatches(screenshots)
            : createScreenshotBatches(screenshots);

        // 3. Persist batches
        for (const batch of batches) {
            const batchId = repository.saveBatchWithScreenshots(
                batch.start,
                batch.end,
                batch.screenshots.map(s => s.id)
            );

            if (batchId) {
                console.log(`[Analysis] Created Batch #${batchId} (${batch.screenshots.length} shots, ${Math.round(batch.end - batch.start)}s)`);

                // Mark initial status
                repository.updateBatchStatus(Number(batchId), 'pending');

                // Trigger LLM Processing
                await processBatch(Number(batchId), batch.screenshots, (batch as any).context);
            }
        }

        // 4. Run Post-processing Merge (Scheme B)
        try {
            await sessionMerger.run();
        } catch (mergeErr) {
            console.warn('[Analysis] SessionMerger failed:', mergeErr);
        }
    } catch (err) {
        console.error('[Analysis] Error processing recordings:', err);
    } finally {
        isProcessing = false;
    }
}

// FOR TESTING: screenshotsOverride allows tests to bypass storage lookup and inject screenshots directly
// This avoids the need to mock the entire storage layer for each test
async function processBatch(batchId: number, screenshotsOverride?: AnalysisScreenshot[], context?: ActivityContext | null) {
    try {
        console.log(`[Analysis] Processing Batch #${batchId}...`);
        repository.updateBatchStatus(batchId, 'processing');

        // Use injected screenshots for testing, otherwise fetch from storage
        const screenshots = (screenshotsOverride && screenshotsOverride.length > 0)
            ? screenshotsOverride
            : repository.screenshotsForBatch(batchId);
        if (screenshots.length === 0) {
            console.log(`[Analysis] Batch #${batchId} has no screenshots.`);
            repository.updateBatchStatus(batchId, 'failed', 'No screenshots');
            return;
        }

        // 1. (Optional) OCR Extraction - sample screenshots for text extraction
        let ocrTexts: Map<string, string> = new Map();
        if (ocrService.isEnabled() && !isTest) {
            try {
                console.log(`[Analysis] Running OCR on sample screenshots for Batch #${batchId}...`);
                // Advanced Sampling Strategy (Phase 3)
                // 1. Prioritize the LAST frame (capture intent before context switch)
                // 2. Avoid Desktop/Empty windows
                // 3. For long duration batches, capture intermediate states
                const samplePaths = selectKeyframesForOCR(screenshots);

                if (samplePaths.length === 0) {
                    console.log('[Analysis] No suitable keyframes found for OCR (e.g. Desktop skipped)');
                } else {
                    const ocrResults = await ocrService.extractTextBatch(samplePaths);

                    for (const [path, result] of ocrResults) {
                        if (result?.text) {
                            ocrTexts.set(path, result.text);
                        }
                    }
                    console.log(`[Analysis] OCR extracted text from ${ocrTexts.size}/${samplePaths.length} samples`);
                }
            } catch (ocrError) {
                console.warn('[Analysis] OCR extraction failed, continuing without:', ocrError);
            }
        }

        // 2. Transcribe (with OCR context if available)
        console.log(`[Analysis] Transcribing Batch #${batchId} (${screenshots.length} shots)...`);

        // Dynamic Prompt Injection based on Activity Context
        const contextInfo = context ? `Current App: ${context.app}` : undefined;
        const prompt = getAnalysisSystemPrompt(contextInfo);
        console.log(`[Analysis] Using prompt for context: ${context ? context.activityType : 'default'}`);

        // We now use chunking internal to LLMService to process all screenshots without sampling loss
        const observations = await llmService.transcribeBatch(screenshots, prompt);

        // P0 Fix: Enhance observations with OCR text if available
        if (ocrTexts.size > 0) {
            // New logic: Include filename and truncate per image to preserve diversity
            const summaries: string[] = [];
            for (const [filePath, text] of ocrTexts) {
                const fileName = path.basename(filePath);
                // Truncate individual texts to ensure we fit multiple images in context
                const truncatedText = text.length > 800 ? text.slice(0, 800) + '...[truncated]' : text;
                summaries.push(`[Image: ${fileName}]\n${truncatedText}`);
            }
            const ocrSummary = summaries.join('\n---\n');

            // Add OCR context to first observation (will be used in generateActivityCards)
            if (observations.length > 0) {
                observations[0].text = `[OCR Context]\n${ocrSummary}\n\n[Visual Analysis]\n${observations[0].text}`;
                console.log(`[Analysis] Enhanced first observation with OCR context from ${ocrTexts.size} images`);
            }
        }

        const cfg = getMergedLLMConfig();
        const screenAnalyzeRole = cfg.roleConfigs?.SCREEN_ANALYZE;
        const observationModelLabel = screenAnalyzeRole ? `${screenAnalyzeRole.provider}:${screenAnalyzeRole.model}` : undefined;

        // Save observations
        for (const obs of observations) {
            const obsId = repository.saveObservation(batchId, obs.start, obs.end, obs.text, observationModelLabel, obs.context_type, obs.entities);

            // Ingest to Graph Memory if entities exist
            if (obs.entities) {
                try {
                    const entities = JSON.parse(obs.entities);
                    if (Array.isArray(entities) && entities.length > 0) {
                        // Use 'local' user ID for now as PulseAgent defaults to it
                        // Run in background to not block analysis
                        // Dynamic import to avoid premature instantiation
                        const { pulseAgent } = await import('../pulse/agent/pulse-agent');
                        pulseAgent.ingestStructuredEntities('local', obs.text, entities).catch(err => {
                            console.error('[Analysis] Async Graph Memory ingestion failed:', err);
                        });
                    }
                } catch (e) {
                    console.error('[Analysis] Failed to parse entities for Graph Memory ingestion:', e);
                }
            }

            // Ingest to Vector Storage (Async)
            if (!isTest && obsId) {
                import('../../storage/vector-storage').then(({ vectorStorage }) => {
                    vectorStorage.addObservation({
                        id: Number(obsId),
                        text: obs.text,
                        start_ts: obs.start,
                        end_ts: obs.end,
                        context_type: obs.context_type,
                        entities: obs.entities
                    }).catch(err => console.error('[Analysis] Vector indexing failed:', err));
                });
            }
        }

        // 2. Generate Cards
        console.log(`[Analysis] Generating cards for Batch #${batchId}...`);

        const cards = await measure('analysis.generate_cards', () => llmService.generateActivityCards(observations), {
            batchId,
            observationCount: observations.length
        });

        metrics.gauge('analysis.cards.generated_count', cards.length, { batchId });

        // Save cards
        for (const card of cards) {
            // Map observation indices back to timestamps
            // Card indices refer to the observations array
            const startObs = observations[card.start_index] || observations[0];
            const endObs = observations[card.end_index] || observations[observations.length - 1];

            const cardId = repository.saveTimelineCard({
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

        repository.updateBatchStatus(batchId, 'analyzed');
        console.log(`[Analysis] Batch #${batchId} complete. ${cards.length} cards generated.`);

    } catch (err) {
        console.error(`[Analysis] Failed to process batch #${batchId}:`, err);
        repository.updateBatchStatus(batchId, 'failed', String(err));
    }
}

// ... createScreenshotBatches and formatDuration ...



interface ScreenshotBatch {
    screenshots: AnalysisScreenshot[];
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

    const intervalMsStr = repository.getSetting('capture_interval_ms');
    const intervalMs = Math.max(1000, parseInt(intervalMsStr || '1000', 10) || 1000);
    const intervalSeconds = Math.max(1, Math.ceil(intervalMs / 1000));

    // maxGap must be larger than the capture interval; otherwise each screenshot becomes its own batch.
    // Increase tolerance to 2 min to account for frame deduplication and reading pauses.
    const maxGapSeconds = Math.max(120, Math.ceil(intervalSeconds * 3));

    return {
        targetDuration: 15 * 60,  // 15 minutes - align with MAX_BATCH_DURATION for semantic grouping
        maxGap: maxGapSeconds,
        minBatchDuration: 10
    };
}

let analysisTimer: NodeJS.Timeout | null = null;

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


export function createScreenshotBatches(screenshots: AnalysisScreenshot[]): ScreenshotBatch[] {
    if (screenshots.length === 0) return [];

    const config = getBatchingConfig();

    // Normalize timestamps for grouping (supports both captured_at and timestamp).
    const ordered = screenshots
        .map(s => ({ ...s, captured_at: getScreenshotCapturedAt(s) }))
        .filter(s => Number.isFinite(s.captured_at))
        .sort((a, b) => (a.captured_at as number) - (b.captured_at as number));

    if (ordered.length === 0) return [];

    const batches: ScreenshotBatch[] = [];
    let bucket: AnalysisScreenshot[] = [];

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

function getScreenshotCapturedAt(screenshot: AnalysisScreenshot): number {
    const ts = screenshot.captured_at ?? screenshot.timestamp;
    const asNumber = typeof ts === 'number' ? ts : Number(ts);
    return Number.isFinite(asNumber) ? asNumber : NaN;
}



/**
 * Extended batch interface with activity context
 */
interface EventBatch extends ScreenshotBatch {
    context: ActivityContext | null;
}

/**
 * Creates screenshot batches based on window switch events (semantic segmentation).
 * This replaces time-based batching with event-driven segmentation.
 * 
 * Logic:
 * 1. Fetch window_switch events for the screenshot time range
 * 2. For each screenshot, determine its context from the most recent window switch
 * 3. Create a new batch when context changes (different app or project)
 * 4. Cap batch duration at 15 minutes to prevent excessively long segments
 */
export function createEventBatches(screenshots: AnalysisScreenshot[]): EventBatch[] {
    metrics.incrementCounter('analysis.batches.process_triggered', 1, { screenshots: screenshots.length });
    if (screenshots.length === 0) return [];

    const config = getBatchingConfig();
    const MAX_BATCH_DURATION = 15 * 60; // 15 minutes hard cap

    // Normalize and sort screenshots
    const ordered = screenshots
        .map(s => ({ ...s, captured_at: getScreenshotCapturedAt(s) }))
        .filter(s => Number.isFinite(s.captured_at))
        .sort((a, b) => (a.captured_at as number) - (b.captured_at as number));

    if (ordered.length === 0) return [];

    // Get time range
    const startTs = ordered[0].captured_at as number;
    const endTs = ordered[ordered.length - 1].captured_at as number;

    // P0 Fix: Defensive null check for repositories
    const repos = repository.getRepositories();
    if (!repos) {
        console.warn('[Analysis] Repositories not ready, falling back to time-based batching');
        return createScreenshotBatches(screenshots) as EventBatch[];
    }

    const windowSwitches = repos.windowSwitches?.getInRange(startTs, endTs, 1000) || [];

    // Sort window switches by timestamp (ascending)
    const sortedSwitches = [...windowSwitches].sort((a, b) => a.timestamp - b.timestamp);

    // Build a timeline of context changes
    // Each switch event marks the start of a new context
    const contextTimeline: { timestamp: number; context: ActivityContext }[] = [];

    for (const sw of sortedSwitches) {
        if (sw.to_app) {
            const ctx = parseWindowContext(sw.to_app, sw.to_title || '');
            contextTimeline.push({ timestamp: sw.timestamp, context: ctx });
        }
    }

    // P2 Fix: Handle empty window switches
    if (contextTimeline.length === 0) {
        console.log('[Analysis] No window switches found for range, using time-based batching as fallback');
        return createScreenshotBatches(screenshots) as EventBatch[];
    }

    // P1 Fix: Optimized context lookup using index pointer (O(n) instead of O(n²))
    // Build event-based batches
    const batches: EventBatch[] = [];
    let bucket: AnalysisScreenshot[] = [];
    let currentContext: ActivityContext | null = null;
    let contextIndex = 0; // Track position in contextTimeline

    for (const screenshot of ordered) {
        const ts = screenshot.captured_at as number;

        // Advance context index while next context is still before or at this screenshot time
        while (contextIndex < contextTimeline.length - 1 &&
            contextTimeline[contextIndex + 1].timestamp <= ts) {
            contextIndex++;
        }

        // Get context: if timestamp is before first switch, we have null context
        const ctx = contextTimeline[contextIndex].timestamp <= ts
            ? contextTimeline[contextIndex].context
            : null;

        if (bucket.length === 0) {
            // Start new bucket
            bucket.push(screenshot);
            currentContext = ctx;
            continue;
        }

        const first = bucket[0];
        const duration = ts - (first.captured_at as number);
        const last = bucket[bucket.length - 1];
        const gap = ts - (last.captured_at as number);

        // Close batch conditions:
        // 1. Context changed (different app/project)
        // 2. Duration exceeds max (15 min)
        // 3. Gap exceeds maxGap (user went idle)
        const contextChanged = ctx && isContextChange(currentContext, ctx);
        const durationExceeded = duration > MAX_BATCH_DURATION;
        const gapExceeded = gap > config.maxGap;

        if (contextChanged || durationExceeded || gapExceeded) {
            // Close current batch
            batches.push({
                screenshots: [...bucket],
                start: first.captured_at as number,
                end: last.captured_at as number,
                context: currentContext
            });

            // Start new bucket
            bucket = [screenshot];
            currentContext = ctx;
        } else {
            bucket.push(screenshot);
        }
    }

    // Handle leftover bucket
    if (bucket.length > 0) {
        const first = bucket[0];
        const last = bucket[bucket.length - 1];
        const duration = (last.captured_at as number) - (first.captured_at as number);

        const now = Math.floor(Date.now() / 1000);
        const timeSinceLast = now - (last.captured_at as number);

        // Save if duration meets minimum OR session is old
        if (duration >= config.minBatchDuration || timeSinceLast > config.maxGap) {
            batches.push({
                screenshots: [...bucket],
                start: first.captured_at as number,
                end: last.captured_at as number,
                context: currentContext
            });
        } else {
            console.log(`[Analysis] Pending event bucket of ${bucket.length} shots (${duration}s) waiting for more data...`);
        }
    }

    return batches;
}

/**
 * Feature flag: Enable event-based batching
 * Set to true to use semantic segmentation, false for time-based
 */
export function useEventBasedBatching(): boolean {
    // TODO: Make this configurable via settings
    // For now, default to true (enable new feature)
    return true;
}

// Phase 3: Advanced Keyframe Selection
function selectKeyframesForOCR(screenshots: AnalysisScreenshot[]): string[] {
    if (!screenshots || screenshots.length === 0) return [];

    // Helper to check if a screenshot is "Desktop"
    const isDesktop = (s: AnalysisScreenshot) => {
        const app = (s.app_name || '').toLowerCase();
        const title = (s.window_title || '').trim();
        // Check for common desktop identifiers
        // "Program Manager" is the title of the desktop window in Windows
        // Explorer process usually owns it
        return (app.includes('explorer') && (title === 'Program Manager' || title === ''));
    };

    // Filter out desktop frames if possible
    // (Unless the whole batch is desktop? In that case we might skip everything)
    const validScreenshots = screenshots.filter(s => !isDesktop(s));

    // If all were desktop, return empty (skips OCR)
    // This avoidance is requested by user
    if (validScreenshots.length === 0) {
        return [];
    }

    const count = validScreenshots.length;
    const last = validScreenshots[count - 1]; // Priority 1: Screen before switch
    const first = validScreenshots[0];

    const selected: AnalysisScreenshot[] = [];

    // strategy: Always take the LAST frame (most recent state before switch)
    selected.push(last);

    // If we have more than 1 frame...
    if (count > 1) {
        const duration = (last.captured_at - first.captured_at);

        // If duration is significant (> 1 min) or we have many frames, take more context
        if (duration > 60 || count > 10) {
            // Add First frame
            selected.unshift(first);

            // Add Middle frame if gap is large
            if (count > 2) {
                const midIdx = Math.floor(count / 2);
                const mid = validScreenshots[midIdx];
                // Insert in middle if distinct
                if (mid !== first && mid !== last) {
                    selected.splice(1, 0, mid);
                }
            }
        }
    }

    // Dedup by path and return
    const uniquePaths = new Set<string>();
    selected.forEach(s => {
        if (s && s.file_path) uniquePaths.add(s.file_path);
    });

    return Array.from(uniquePaths).filter(p => p && typeof p === 'string');
}
