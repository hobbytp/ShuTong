/**
 * Activity Analytics Service
 * 
 * Provides aggregated analytics data for the Activity Dashboard (Smart Capture Guard v2).
 * Builds on existing storage functions to provide daily summaries, app usage patterns,
 * and timeline data.
 */

import { typedHandle } from '../../infrastructure/ipc/typed-ipc';
import { WindowSwitchRecord } from '../../storage';
import { defaultAnalyticsRepository, IAnalyticsRepository, TimelineCardRecord } from './analytics.repository';

// Initialize with default implementation
let repository: IAnalyticsRepository = defaultAnalyticsRepository;

export function setRepositoryForTesting(repo: IAnalyticsRepository) {
    repository = repo;
}

// --- Types ---

export interface DailyActivitySummary {
    date: string;                    // YYYY-MM-DD
    totalActiveSeconds: number;      // Total tracked time
    appUsage: AppUsageEntry[];       // Sorted by seconds descending
    hourlyActivity: number[];        // 24 entries, seconds per hour
}

export interface AppUsageEntry {
    app: string;
    seconds: number;
    percentage: number;
}

export interface ActivityTimelineEvent {
    timestamp: number;               // Unix seconds
    type: 'app_switch' | 'skip' | 'capture';
    appName?: string;
    details?: string;
}

// --- Analytics Functions ---

/**
 * Get daily activity summary for a specific date.
 * @param date Date string in YYYY-MM-DD format
 */
export function getDailyActivitySummary(date: string): DailyActivitySummary {
    // Parse date in local timezone
    const [year, month, day] = date.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0).getTime() / 1000;
    const endOfDay = startOfDay + 86400;

    // Use NEW method to get verified data
    const { cards, switches } = repository.getDailyUsageFromCards(startOfDay, endOfDay);

    // 1. Calculate total active time (Sum of Card Durations) - MATCHES DASHBOARD
    const totalActiveSeconds = cards.reduce((sum, card) => sum + (card.end_ts - card.start_ts), 0);

    // 2. Build app usage from FILTERED switches
    // We need to calculate dwell time from these switches
    // Since switches are now filtered to be inside cards, we can trust them more,
    // but we need to re-calculate durations.
    // However, the simple `getWindowDwellStats` logic was "switch duration = next - current".
    // If we have gaps because we filtered out idle time, that logic holds ONLY if we are careful.
    // actually, `switches` only contains points.
    // If we have Card A [10:00 - 11:00] and Card B [12:00 - 13:00].
    // And switches S1 (10:00), S2 (10:30), S3 (12:00).
    // S1 duration is 10:30 - 10:00 = 30m.
    // S2 duration? If S3 is 12:00, S2->S3 is 1.5h. 
    // BUT we know S2 is in Card A (ends 11:00). So meaningful duration is limited to Card A end?
    // OR, we just use the raw dwell stats from the filtered switches but cap them?

    // Better approach for App Usage:
    // Iterate through cards. For each card, find switches INSIDE it.
    // Calculate dwell times inside that card.

    // Let's call a helper to process this locally
    const appUsage = calculateAppUsageFromCardsAndSwitches(cards, switches);

    // 3. Get hourly activity (distribution of card durations)
    // We distribute the CARD durations, not just switches
    const hourlyActivity = calculateHourlyActivityFromCards(cards);

    return {
        date,
        totalActiveSeconds,
        appUsage,
        hourlyActivity
    };
}

/**
 * Calculate app usage breakdown by intersecting switches with cards.
 */
/**
 * Calculate app usage breakdown by intersecting switches with cards.
 * Handles edge case: if a card has no switches, attributes time to card title.
 */
function calculateAppUsageFromCardsAndSwitches(
    cards: TimelineCardRecord[],
    switches: WindowSwitchRecord[]
): AppUsageEntry[] {
    const appSeconds: Record<string, number> = {};
    let totalSeconds = 0;

    cards.forEach(card => {
        const cardStart = card.start_ts;
        const cardEnd = card.end_ts;
        const cardDuration = cardEnd - cardStart;

        // Find switches relevant to this card
        const relevantSwitches = switches.filter(
            s => s.timestamp >= cardStart && s.timestamp < cardEnd
        );

        // Edge case: No switches recorded inside this card
        // Fallback to card title as the "app" to ensure time is not lost
        if (relevantSwitches.length === 0) {
            const fallbackApp = card.title || card.category || 'Unknown';
            appSeconds[fallbackApp] = (appSeconds[fallbackApp] || 0) + cardDuration;
            totalSeconds += cardDuration;
            return;
        }

        // Calculate durations from switches
        for (let i = 0; i < relevantSwitches.length; i++) {
            const sw = relevantSwitches[i];
            const nextSw = relevantSwitches[i + 1];

            // Duration is from this switch until:
            // 1. The next switch, OR
            // 2. The end of the card
            // whichever comes first.
            const segmentEnd = nextSw ? Math.min(nextSw.timestamp, cardEnd) : cardEnd;
            const duration = Math.max(0, segmentEnd - sw.timestamp);

            const appName = sw.to_app || 'Unknown';
            appSeconds[appName] = (appSeconds[appName] || 0) + duration;
            totalSeconds += duration;
        }
    });

    const result: AppUsageEntry[] = Object.entries(appSeconds).map(([app, seconds]) => ({
        app,
        seconds,
        percentage: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0
    }));

    return result.sort((a, b) => b.seconds - a.seconds);
}

function calculateHourlyActivityFromCards(cards: TimelineCardRecord[]): number[] {
    const hourlySeconds = new Array(24).fill(0);

    cards.forEach(card => {
        let currentTs = card.start_ts;
        let remaining = card.end_ts - card.start_ts;

        while (remaining > 0) {
            const d = new Date(currentTs * 1000);
            const hour = d.getHours();

            // Seconds left in this hour
            const secondsInHour = 3600 - (d.getMinutes() * 60 + d.getSeconds());

            const duration = Math.min(remaining, secondsInHour);

            if (hour >= 0 && hour < 24) {
                hourlySeconds[hour] += duration;
            }

            remaining -= duration;
            currentTs += duration;
        }
    });

    return hourlySeconds;
}

// Legacy getHourlyActivityDistribution removed - replaced by calculateHourlyActivityFromCards

/**
 * Get activity timeline events for a time range.
 * Combines app switches and skip events into a unified timeline.
 */
export function getActivityTimeline(startTs: number, endTs: number, limit = 100): ActivityTimelineEvent[] {
    const events: ActivityTimelineEvent[] = [];

    // Add window switches
    const switches = repository.getWindowSwitches(startTs, endTs, limit);
    for (const sw of switches) {
        events.push({
            timestamp: sw.timestamp,
            type: 'app_switch',
            appName: sw.to_app,
            details: sw.to_title || undefined
        });
    }

    // Add skip events from guard log
    const skipLog = repository.getSkipLog(limit);
    for (const skip of skipLog) {
        if (skip.timestamp >= startTs && skip.timestamp <= endTs) {
            events.push({
                timestamp: skip.timestamp,
                type: 'skip',
                appName: skip.appName,
                details: skip.reason ?? undefined
            });
        }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events.slice(-limit);
}

/**
 * Get capture efficiency stats (ratio of captures to skips).
 */
export function getCaptureEfficiency(): {
    totalCaptures: number;
    totalSkips: number;
    efficiency: number;
    skipBreakdown: Record<string, number>;
} {
    const stats = repository.getGuardStats();

    const total = stats.totalCaptures + stats.totalSkips;
    const efficiency = total > 0 ? (stats.totalCaptures / total) * 100 : 100;

    return {
        totalCaptures: stats.totalCaptures,
        totalSkips: stats.totalSkips,
        efficiency,
        skipBreakdown: { ...stats.skipsByReason }
    };
}

/**
 * Get top apps by usage time for a date range.
 */
export function getTopApps(startTs: number, endTs: number, limit = 10): AppUsageEntry[] {
    const dwellStats = repository.getWindowDwellStats(startTs, endTs);
    const totalSeconds = dwellStats.reduce((sum, stat) => sum + stat.total_seconds, 0);

    return dwellStats
        .slice(0, limit)
        .map(stat => ({
            app: stat.app,
            seconds: stat.total_seconds,
            percentage: totalSeconds > 0 ? (stat.total_seconds / totalSeconds) * 100 : 0
        }));
}

// --- IPC Handlers ---


let analyticsIpcConfigured = false;

/**
 * Setup IPC handlers for analytics service.
 * Call this once during app initialization.
 */
export function setupAnalyticsIPC(): void {
    if (analyticsIpcConfigured) return;
    analyticsIpcConfigured = true;

    // Get daily activity summary
    typedHandle('analytics:getDailySummary', (_event, date: string) => {
        return getDailyActivitySummary(date);
    });

    // Get activity timeline
    typedHandle('analytics:getTimeline', (_event, startTs: number, endTs: number, limit?: number) => {
        return getActivityTimeline(startTs, endTs, limit);
    });

    // Get capture efficiency
    typedHandle('analytics:getEfficiency', () => {
        return getCaptureEfficiency();
    });

    // Get top apps
    typedHandle('analytics:getTopApps', (_event, startTs: number, endTs: number, limit?: number) => {
        return getTopApps(startTs, endTs, limit);
    });

    // Get guard statistics
    typedHandle('guard:getStats', () => {
        return repository.getGuardStats();
    });

    // Get skip log
    typedHandle('guard:getSkipLog', (_event, limit?: number) => {
        return repository.getSkipLog(limit);
    });

    // Reset guard statistics
    typedHandle('guard:resetStats', () => {
        repository.resetGuardStats();
    });

    console.log('[Analytics] IPC handlers registered');
}
