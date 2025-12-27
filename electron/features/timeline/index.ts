/**
 * Timeline Feature Module
 * 
 * Handles screenshot analysis, activity cards, and cleanup.
 */

// Analysis service
export {
    createScreenshotBatches, getBatchingConfig, startAnalysisJob,
    stopAnalysisJob
} from './analysis.service';

// Analytics service
export {
    getActivityTimeline,
    getCaptureEfficiency, getDailyActivitySummary, getTopApps,
    setupAnalyticsIPC
} from './analytics.service';

export type {
    ActivityTimelineEvent, AppUsageEntry, DailyActivitySummary
} from './analytics.service';

// Cleanup
export { cleanupOldSnapshots } from './cleanup';
