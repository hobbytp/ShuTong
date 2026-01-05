import { vectorStorage } from '../../storage/vector-storage';
import { getScreenshotsInTimeRange } from '../../storage';
import { generateVideo } from '../video/video.service';
import path from 'path';
import { app } from 'electron';

/**
 * Smart Search Service
 * 
 * Handles "AI-Native" Topic creation by combining:
 * 1. Semantic Search (Vector DB)
 * 2. LLM-based Metadata Extraction (Query understanding)
 */

export interface SmartSearchResult {
    timeline: {
        startTs: number;
        endTs: number;
        description: string;
        screenshotCount: number;
    }[];
    videoPath?: string;
}

export class SmartSearchService {
    // private llmService: LLMService;

    constructor() {
        // this.llmService = new LLMService();
    }
}

export async function searchAndGenerateTimeline(userQuery: string): Promise<SmartSearchResult> {
    console.log(`[SmartSearch] Processing query: "${userQuery}"`);

    // 1. Semantic Search (High Recall)
    // Find observations that semantically match the user's intent
    // e.g. "ShuTong dev" -> matches "User is editing code in analysis.service.ts"
    const searchResults = await vectorStorage.search(userQuery, 100); // Get top 100 matches

    if (searchResults.length === 0) {
        console.log('[SmartSearch] No semantic matches found.');
        return { timeline: [] };
    }

    console.log(`[SmartSearch] Found ${searchResults.length} semantic matches.`);

    // 2. Group into timeline segments
    // Observations are typically short (minutes). We need to cluster them into contiguous sessions.
    const segments = clusterObservations(searchResults);
    console.log(`[SmartSearch] Clustered into ${segments.length} timeline segments.`);

    // 3. Fetch screenshots for each segment and flatten
    // Collect all screenshot paths for video generation
    const allScreenshotPaths: string[] = [];
    
    for (const segment of segments) {
        const screenshots = getScreenshotsInTimeRange(segment.startTs, segment.endTs) as any[];
        segment.screenshotCount = screenshots.length;
        
        for (const s of screenshots) {
            if (s.file_path) {
                allScreenshotPaths.push(s.file_path);
            }
        }
    }

    // 4. Generate Video (if we have screenshots)
    let videoPath: string | undefined;
    if (allScreenshotPaths.length > 0) {
        try {
            const videosDir = path.join(app.getPath('userData'), 'videos');
            const outputPath = path.join(videosDir, `topic_${Date.now()}.mp4`);
            
            console.log(`[SmartSearch] Generating video from ${allScreenshotPaths.length} screenshots...`);
            videoPath = await generateVideo(allScreenshotPaths, outputPath, 0.5); // 0.5s per frame
            
            // Normalize path for frontend
             videoPath = `media:///${videoPath.replace(/\\/g, '/')}`;
        } catch (err) {
            console.error('[SmartSearch] Failed to generate video:', err);
        }
    }

    return {
        timeline: segments,
        videoPath
    };
}

/**
 * Clusters individual observations into larger timeline segments if they are close in time.
 */
function clusterObservations(results: any[]) {
    // Sort by time
    const sorted = [...results].sort((a, b) => a.start_ts - b.start_ts);
    
    const segments: any[] = [];
    let currentSegment: any = null;
    const MAX_GAP = 5 * 60; // 5 minutes gap breaks the segment

    for (const obs of sorted) {
        if (!currentSegment) {
            currentSegment = {
                startTs: obs.start_ts,
                endTs: obs.end_ts,
                description: obs.summary || obs.text,
                ids: [obs.id],
                screenshots: [] // Placeholder
            };
            continue;
        }

        const gap = obs.start_ts - currentSegment.endTs;

        if (gap <= MAX_GAP) {
            // Extend segment
            currentSegment.endTs = Math.max(currentSegment.endTs, obs.end_ts);
            currentSegment.ids.push(obs.id);
            // Append description if it's distinct enough? 
            // For now keep first description as title
        } else {
            // Close segment
            segments.push(currentSegment);
            currentSegment = {
                startTs: obs.start_ts,
                endTs: obs.end_ts,
                description: obs.summary || obs.text,
                ids: [obs.id],
                screenshots: []
            };
        }
    }

    if (currentSegment) {
        segments.push(currentSegment);
    }

    return segments;
}
