/**
 * Activity Analytics Service
 * 
 * Provides aggregated analytics data for the Activity Dashboard (Smart Capture Guard v2).
 * Builds on existing storage functions to provide daily summaries, app usage patterns,
 * and timeline data.
 */

import { getGuardStats, getSkipLog, resetGuardStats } from './capture-guard';
import { typedHandle } from './infrastructure/ipc/typed-ipc';
import { getWindowDwellStats, getWindowSwitches } from './storage';

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

    // Get dwell stats for the day
    const dwellStats = getWindowDwellStats(startOfDay, endOfDay);

    // Calculate total active time
    const totalActiveSeconds = dwellStats.reduce((sum, stat) => sum + stat.total_seconds, 0);

    // Build app usage with percentages
    const appUsage: AppUsageEntry[] = dwellStats.map(stat => ({
        app: stat.app,
        seconds: stat.total_seconds,
        percentage: totalActiveSeconds > 0 ? (stat.total_seconds / totalActiveSeconds) * 100 : 0
    }));

    // Get hourly activity distribution
    const hourlyActivity = getHourlyActivityDistribution(startOfDay, endOfDay);

    return {
        date,
        totalActiveSeconds,
        appUsage,
        hourlyActivity
    };
}

/**
 * Get hourly activity distribution for a time range.
 * Returns array of 24 values (seconds active per hour).
 */
function getHourlyActivityDistribution(startTs: number, endTs: number): number[] {
    const hourlySeconds = new Array(24).fill(0);
    const switches = getWindowSwitches(startTs, endTs, 10000);

    for (let i = 0; i < switches.length; i++) {
        const current = switches[i];
        const next = switches[i + 1];

        if (next) {
            let remainingDuration = next.timestamp - current.timestamp;
            let currentTs = current.timestamp;

            // Distribute duration across hours if it spans multiple hours
            while (remainingDuration > 0) {
                const currentDate = new Date(currentTs * 1000);
                const hour = currentDate.getHours();

                // Calculate seconds until next hour
                const secondsUntilNextHour = 3600 - (currentDate.getMinutes() * 60 + currentDate.getSeconds());
                const durationThisHour = Math.min(remainingDuration, secondsUntilNextHour);

                if (hour >= 0 && hour < 24) {
                    hourlySeconds[hour] += durationThisHour;
                }

                remainingDuration -= durationThisHour;
                currentTs += durationThisHour;
            }
        }
    }

    return hourlySeconds;
}

/**
 * Get activity timeline events for a time range.
 * Combines app switches and skip events into a unified timeline.
 */
export function getActivityTimeline(startTs: number, endTs: number, limit = 100): ActivityTimelineEvent[] {
    const events: ActivityTimelineEvent[] = [];

    // Add window switches
    const switches = getWindowSwitches(startTs, endTs, limit);
    for (const sw of switches) {
        events.push({
            timestamp: sw.timestamp,
            type: 'app_switch',
            appName: sw.to_app,
            details: sw.to_title || undefined
        });
    }

    // Add skip events from guard log
    const skipLog = getSkipLog(limit);
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
    const stats = getGuardStats();

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
    const dwellStats = getWindowDwellStats(startTs, endTs);
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
        return getGuardStats();
    });

    // Get skip log
    typedHandle('guard:getSkipLog', (_event, limit?: number) => {
        return getSkipLog(limit);
    });

    // Reset guard statistics
    typedHandle('guard:resetStats', () => {
        resetGuardStats();
    });

    console.log('[Analytics] IPC handlers registered');
}
