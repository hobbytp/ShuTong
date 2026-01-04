import { Jimp } from 'jimp';
import { getMergedLLMConfig } from '../config_manager';
import { Screenshot } from '../infrastructure/repositories/interfaces';
import { safeParseJSON } from '../utils/json';
import { getLLMMetrics } from './metrics';
import { consumeStreamWithIdleTimeout, getLLMProvider } from './providers';

export interface Observation {
    start: number;
    end: number;
    text: string;
    context_type?: string;
    entities?: string;
}

export interface ActivityCard {
    title: string;
    summary: string;
    category: string;
    subcategory?: string;
    confidence: number;
    start_index: number;
    end_index: number;
}


export class LLMService {
    constructor() {
    }

    // No longer caching provider internally as it depends on the task (role)

    async transcribeBatch(screenshots: Screenshot[], prompt?: string): Promise<Observation[]> {
        if (screenshots.length === 0) return [];

        const config = getMergedLLMConfig();
        const roleConfig = config.roleConfigs['SCREEN_ANALYZE'];
        const providerKey = roleConfig?.provider;
        const providerCfg = providerKey ? config.providers[providerKey] : undefined;

        // Adaptive chunking integration
        const metrics = getLLMMetrics();
        const adaptiveConfig = config.adaptiveChunking;

        let maxPerChunk: number;
        if (adaptiveConfig?.enabled) {
            // Evaluate and potentially adjust chunk size based on performance
            metrics.evaluateAdaptiveChunking(adaptiveConfig);
            maxPerChunk = metrics.getChunkMetrics().adjustedSize;
        } else {
            maxPerChunk = providerCfg?.maxScreenshotsPerRequest || 15;
        }

        const delayMs = providerCfg?.chunkDelayMs || 1000;

        if (screenshots.length <= maxPerChunk) {
            return this._transcribeSingleChunk(screenshots, prompt);
        }

        // Multiple chunks
        const chunks = this.splitIntoChunks(screenshots, maxPerChunk);
        console.log(`[LLMService] Processing ${chunks.length} chunks of up to ${maxPerChunk} screenshots${adaptiveConfig?.enabled ? ' (adaptive)' : ''}`);

        const allObservations: Observation[] = [];
        for (let i = 0; i < chunks.length; i++) {
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            try {
                const chunkObs = await this._transcribeSingleChunk(chunks[i], prompt);
                allObservations.push(...chunkObs);
                console.log(`[LLMService] Chunk ${i + 1}/${chunks.length} complete: ${chunkObs.length} observations`);
            } catch (err) {
                console.error(`[LLMService] Chunk ${i + 1} failed:`, err);
                // Continue with remaining chunks (partial results)
            }
        }

        return allObservations;
    }

    private async _transcribeSingleChunk(screenshots: Screenshot[], customPrompt?: string): Promise<Observation[]> {
        // Prepare prompt
        const prompt = customPrompt || `
Analyize this sequence of screenshots from a user's computer. 
Describe what the user is doing in a chronological list of observations.
For each observation, provide the approximate start and end index (0-based) of the screenshots that match this activity.

Return JSON format:
{
  "observations": [
    { "start_index": 0, "end_index": 2, "text": "User is editing code in VS Code" }
  ]
}
        `.trim();

        // Prepare format for provider
        // Convert images to base64 using processImage (Jimp resizing)
        const images = await Promise.all(screenshots.map(async s => {
            const base64Data = await this.processImage(s);
            return {
                data: base64Data,
                mimeType: 'image/png'
            };
        }));

        try {
            const provider = getLLMProvider('SCREEN_ANALYZE');
            let responseStr: string;

            // Prefer streaming if available for more robust timeout handling
            if (provider.generateContentStream) {
                const config = getMergedLLMConfig();
                const roleConfig = config.roleConfigs['SCREEN_ANALYZE'];
                const providerKey = roleConfig?.provider;
                const providerCfg = providerKey ? config.providers[providerKey] : undefined;
                const idleTimeout = providerCfg?.streamIdleTimeout || 30000;

                try {
                    console.log('[LLMService] Using streaming for transcribeBatch');
                    responseStr = await consumeStreamWithIdleTimeout(
                        provider.generateContentStream({ prompt, images }),
                        idleTimeout
                    );
                } catch (streamError) {
                    // Fallback to non-streaming on streaming failure (has retry logic)
                    console.warn('[LLMService] Streaming failed, falling back to non-streaming:', streamError);
                    responseStr = await provider.generateContent({ prompt, images });
                }
            } else {
                responseStr = await provider.generateContent({ prompt, images });
            }

            const response = safeParseJSON(responseStr);
            
            // Legacy format
            if (response && response.observations) {
                return response.observations.map((obs: any) => {
                    const startShot = screenshots[obs.start_index] || screenshots[0];
                    const endShot = screenshots[obs.end_index] || screenshots[screenshots.length - 1];
                    return {
                        start: startShot.captured_at,
                        end: endShot.captured_at,
                        text: obs.text
                    };
                });
            }

            // New "items" format (MiniContext style)
            if (response && response.items) {
                // Default to whole chunk range if no specific indices provided
                const startShot = screenshots[0];
                const endShot = screenshots[screenshots.length - 1];
                
                return response.items.map((item: any) => {
                    // Try to map screen_ids if available (1-based index)
                    let itemStart = startShot.captured_at;
                    let itemEnd = endShot.captured_at;
                    
                    if (item.screen_ids && Array.isArray(item.screen_ids) && item.screen_ids.length > 0) {
                        const firstIdx = Math.min(...item.screen_ids) - 1;
                        const lastIdx = Math.max(...item.screen_ids) - 1;
                        if (screenshots[firstIdx]) itemStart = screenshots[firstIdx].captured_at;
                        if (screenshots[lastIdx]) itemEnd = screenshots[lastIdx].captured_at;
                    }

                    return {
                        start: itemStart,
                        end: itemEnd,
                        text: item.summary || item.title || "No summary",
                        context_type: item.context_type,
                        entities: item.entities ? JSON.stringify(item.entities) : undefined
                    };
                });
            }

            if (!response) {
                throw new Error("Invalid LLM response format for transcription");
            }
            
            throw new Error("Unknown LLM response format");

        } catch (err) {
            console.error('[LLMService] Single chunk transcription failed:', err);
            throw err;
        }
    }

    private splitIntoChunks<T>(arr: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    async generateActivityCards(observations: Observation[]): Promise<ActivityCard[]> {
        if (observations.length === 0) return [];

        const prompt = `
Based on these observations of user activity, group them into high-level Activity Cards.
Assign a category from: Work, Personal, Distraction, Idle, Meeting.
For each card, specify the start and end index (0-based) of the observations that belong to it.

Observations:
${observations.map((o, i) => `${i}: [${new Date(o.start * 1000).toLocaleTimeString()}] ${o.text}`).join('\n')}

Return JSON:
{
  "cards": [
    { 
      "title": "Coding in VS Code", 
      "summary": "Implemented the analysis pipeline.", 
      "category": "Work", 
      "confidence": 0.9,
      "start_index": 0,
      "end_index": 5
    }
  ]
}
        `.trim();

        try {
            const provider = getLLMProvider('TEXT_SUMMARY');
            let responseStr: string;

            // Prefer streaming if available for more robust timeout handling
            if (provider.generateContentStream) {
                const config = getMergedLLMConfig();
                const roleConfig = config.roleConfigs['TEXT_SUMMARY'];
                const providerKey = roleConfig?.provider;
                const providerCfg = providerKey ? config.providers[providerKey] : undefined;
                const idleTimeout = providerCfg?.streamIdleTimeout || 30000;

                try {
                    console.log('[LLMService] Using streaming for generateActivityCards');
                    responseStr = await consumeStreamWithIdleTimeout(
                        provider.generateContentStream({ prompt }),
                        idleTimeout
                    );
                } catch (streamError) {
                    // Fallback to non-streaming on streaming failure (has retry logic)
                    console.warn('[LLMService] Streaming failed, falling back to non-streaming:', streamError);
                    responseStr = await provider.generateContent({ prompt });
                }
            } else {
                responseStr = await provider.generateContent({ prompt });
            }

            const response = safeParseJSON(responseStr);

            if (!response || !response.cards) {
                throw new Error("Invalid LLM response format for cards");
            }

            return response.cards;
        } catch (err) {
            console.error('[LLMService] Card generation failed:', err);
            throw err;
        }
    }

    private async processImage(screenshot: Screenshot): Promise<string> {
        // 1. Read Image
        const image = await Jimp.read(screenshot.file_path);

        // 2. (Optional) Smart ROI Crop
        // If we have ROI metadata, we *could* crop here.
        // However, for "context", keeping full screen is often better, 
        // provided we have resolution.
        // For now, let's just resize to avoid OOM/Token limits.
        // Future: If ROI is very small (<20% screen), maybe crop to ROI + Padding?
        // Current Plan: Just Resize.

        // 3. Resize (MiniContext parity: 2048px)
        const MAX_DIM = 2048;
        if (image.width > MAX_DIM || image.height > MAX_DIM) {
            image.scaleToFit({ w: MAX_DIM, h: MAX_DIM });
        }

        // 4. Return Base64
        const buffer = await image.getBuffer('image/png');
        return buffer.toString('base64');
    }
}
