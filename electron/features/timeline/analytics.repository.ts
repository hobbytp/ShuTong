import {
    getDatabase,
    getWindowDwellStats,
    getWindowSwitches,
    WindowSwitchRecord
} from '../../storage';
import {
    getGuardStats,
    getSkipLog,
    resetGuardStats
} from '../capture/capture-guard';
import { ActivityCategorizer } from '../analytics/activity-categorizer';
import { metrics } from '../../infrastructure/monitoring/metrics-collector';

/**
 * Represents a timeline card from the database.
 */
export interface TimelineCardRecord {
    id: number;
    batch_id: number | null;
    start_ts: number;
    end_ts: number;
    category: string;
    subcategory: string | null;
    title: string;
    summary: string;
    detailed_summary: string | null;
    video_url: string | null;
    is_merged: number; // 0 or 1 in SQLite
}

/**
 * Result of getDailyUsageFromCards: verified cards and filtered switches.
 */
export interface DailyUsageFromCardsResult {
    cards: TimelineCardRecord[];
    switches: WindowSwitchRecord[];
}

export interface ProductivityStatsRecord {
    total_active_minutes: number;
    deep_work_minutes: number;
    app_usage: { app_name: string; duration_minutes: number; category: string }[];
    context_switches: number;
}

export interface IAnalyticsRepository {
    getWindowDwellStats(startTs: number, endTs: number): { app: string; total_seconds: number }[];
    getWindowSwitches(startTs: number, endTs: number, limit?: number): WindowSwitchRecord[];
    getGuardStats(): any;
    getSkipLog(limit?: number): any[];
    resetGuardStats(): void;

    // New method for aligned analytics
    getDailyUsageFromCards(startTs: number, endTs: number): DailyUsageFromCardsResult;
    getProductivityStats(startTs: number, endTs: number): ProductivityStatsRecord;
    getHourlyProductivityStats(startTs: number, endTs: number): { timestamp: number; active_minutes: number; deep_minutes: number; switch_count: number }[];
    getHourlyProductivityStats(startTs: number, endTs: number): { timestamp: number; active_minutes: number; deep_minutes: number; switch_count: number }[];
    getAllWindowSwitches(startTs: number, endTs: number): WindowSwitchRecord[];
    getAppDrillDown(appName: string, startTs: number, endTs: number): { windowTitle: string; duration: number; percentage: number }[];
}


export class DefaultAnalyticsRepository implements IAnalyticsRepository {
    getWindowDwellStats(startTs: number, endTs: number) {
        return getWindowDwellStats(startTs, endTs);
    }

    getWindowSwitches(startTs: number, endTs: number, limit: number = 100) {
        return getWindowSwitches(startTs, endTs, limit);
    }

    getGuardStats() {
        return getGuardStats();
    }

    getSkipLog(limit?: number) {
        return getSkipLog(limit);
    }

    resetGuardStats() {
        resetGuardStats();
    }

    getDailyUsageFromCards(startTs: number, endTs: number) {
        const db = getDatabase();
        if (!db) return { cards: [], switches: [] };

        try {
            // 1. Get Cards (The source of truth for "active time")
            const cards = db.prepare(`
                SELECT * FROM timeline_cards 
                WHERE start_ts >= ? AND end_ts <= ?
                ORDER BY start_ts ASC
            `).all(startTs, endTs) as TimelineCardRecord[];

            // 2. Get Window Switches ONLY during card times (The source for "app usage breakdown")
            // We use DISTINCT because valid cards might overlap slightly (though they shouldn't usually)
            // or the join might produce duplicates if logic is loose. 
            // Actually, simply joining on time range is safe.
            const switches = db.prepare(`
                SELECT DISTINCT ws.* 
                FROM window_switches ws
                JOIN timeline_cards tc ON ws.timestamp >= tc.start_ts AND ws.timestamp <= tc.end_ts
                WHERE tc.start_ts >= ? AND tc.end_ts <= ?
                ORDER BY ws.timestamp ASC
            `).all(startTs, endTs) as WindowSwitchRecord[];

            return { cards, switches };
        } catch (err) {
            console.error('[AnalyticsRepo] Failed to get daily usage from cards:', err);
            return { cards: [], switches: [] };
        }
    }

    getProductivityStats(startTs: number, endTs: number): ProductivityStatsRecord {
        const startTime = performance.now();
        const db = getDatabase();
        if (!db) {
            return {
                total_active_minutes: 0,
                deep_work_minutes: 0,
                app_usage: [],
                context_switches: 0
            };
        }

        try {
            // 1. Calculate Active Minutes & Deep Work (based on Cards)
            const cardStats = db.prepare(`
                SELECT 
                    COALESCE(SUM(end_ts - start_ts), 0) / 60 as total_minutes,
                    COALESCE(SUM(CASE WHEN category IN ('Coding', 'Writing', 'Research') THEN end_ts - start_ts ELSE 0 END), 0) / 60 as deep_minutes
                FROM timeline_cards
                WHERE start_ts >= ? AND end_ts <= ?
            `).get(startTs, endTs) as { total_minutes: number; deep_minutes: number };

            // 2. Calculate App Usage (based on Window Switches during active cards)
            // Note: This is an approximation. A more accurate way would be to align switches with cards.
            // For Phase 1, we aggregate duration of switches that fall within the day.
            // Improve: Filter switches that overlap with 'idle' cards if we had them.
            const appStats = db.prepare(`
                SELECT 
                    to_app as app_name,
                    SUM(duration) / 60 as duration_minutes
                FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
                GROUP BY to_app
                ORDER BY duration_minutes DESC
                LIMIT 10
            `).all(startTs, endTs) as { app_name: string; duration_minutes: number }[];

            // 3. Context Switches
            const switchCount = db.prepare(`
                SELECT COUNT(*) as count
                FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
            `).get(startTs, endTs) as { count: number };

            const totalDuration = (performance.now() - startTime) / 1000;
            metrics.observeHistogram('analytics_report_duration_seconds', totalDuration, { report: 'productivity_stats' });

            return {
                total_active_minutes: Math.round(cardStats.total_minutes),
                deep_work_minutes: Math.round(cardStats.deep_minutes),
                app_usage: appStats.map(s => ({
                    app_name: s.app_name,
                    duration_minutes: Math.round(s.duration_minutes),
                    category: ActivityCategorizer.categorize(s.app_name)
                })),
                context_switches: switchCount.count
            };

        } catch (err) {
            console.error('[AnalyticsRepo] Failed to get productivity stats:', err);
            return {
                total_active_minutes: 0,
                deep_work_minutes: 0,
                app_usage: [],
                context_switches: 0
            };
        }
    }

    getHourlyProductivityStats(startTs: number, endTs: number): { timestamp: number; active_minutes: number; deep_minutes: number; switch_count: number }[] {
        const db = getDatabase();
        if (!db) return [];

        try {
            // Group by Hour using SQLite
            // We align bucket to the start of the hour
            const hourlyStats = db.prepare(`
                SELECT 
                    strftime('%Y-%m-%d %H:00:00', datetime(start_ts / 1000, 'unixepoch', 'localtime')) as hour_str,
                    COALESCE(SUM(end_ts - start_ts), 0) / 60 as active_minutes,
                    COALESCE(SUM(CASE WHEN category IN ('Coding', 'Writing', 'Research') THEN end_ts - start_ts ELSE 0 END), 0) / 60 as deep_minutes
                FROM timeline_cards
                WHERE start_ts >= ? AND end_ts <= ?
                GROUP BY hour_str
                ORDER BY hour_str ASC
            `).all(startTs, endTs) as { hour_str: string; active_minutes: number; deep_minutes: number }[];

            // Get switch counts per hour
            // Note: This is a separate query but could be joined if optimized.
            const hourlySwitches = db.prepare(`
                SELECT 
                    strftime('%Y-%m-%d %H:00:00', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as hour_str,
                    COUNT(*) as count
                FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
                GROUP BY hour_str
            `).all(startTs, endTs) as { hour_str: string; count: number }[];

            // Map to lookup
            const switchMap = new Map(hourlySwitches.map(s => [s.hour_str, s.count]));

            return hourlyStats.map(stat => ({
                timestamp: new Date(stat.hour_str).getTime(),
                active_minutes: Math.round(stat.active_minutes),
                deep_minutes: Math.round(stat.deep_minutes),
                switch_count: switchMap.get(stat.hour_str) || 0
            }));

        } catch (err) {
            console.error('[AnalyticsRepo] Failed to get hourly stats:', err);
            return [];
        }
    }

    getAllWindowSwitches(startTs: number, endTs: number): WindowSwitchRecord[] {
        const db = getDatabase();
        if (!db) return [];
        try {
            return db.prepare(`
                SELECT * FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp ASC
            `).all(startTs, endTs) as WindowSwitchRecord[];
        } catch (err) {
            console.error('[AnalyticsRepo] Failed to get all switches:', err);
            return [];
        }
    }

    *getWindowSwitchesIterator(startTs: number, endTs: number): IterableIterator<WindowSwitchRecord> {
        const db = getDatabase();
        if (!db) return;
        try {
            const stmt = db.prepare(`
                SELECT * FROM window_switches
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp ASC
            `);
            for (const row of stmt.iterate(startTs, endTs)) {
                yield row as WindowSwitchRecord;
            }
        } catch (err) {
            console.error('[AnalyticsRepo] Failed to iterate switches:', err);
        }
    }

    getAppDrillDown(appName: string, startTs: number, endTs: number): { windowTitle: string; duration: number; percentage: number }[] {
        const db = getDatabase();
        if (!db) return [];

        try {
            // 1. Get raw duration per window title
            const rawStats = db.prepare(`
                SELECT 
                    to_title as window_title,
                    SUM(duration) / 60 as duration_minutes
                FROM window_switches
                WHERE to_app = ? AND timestamp >= ? AND timestamp <= ?
                GROUP BY to_title
                ORDER BY duration_minutes DESC
                LIMIT 20
            `).all(appName, startTs, endTs) as { window_title: string; duration_minutes: number }[];

            // 2. Calculate percentages
            const totalDuration = rawStats.reduce((sum, item) => sum + item.duration_minutes, 0);

            return rawStats.map(item => ({
                windowTitle: item.window_title || 'Untitled',
                duration: Math.round(item.duration_minutes * 10) / 10,
                percentage: totalDuration > 0 ? Math.round((item.duration_minutes / totalDuration) * 100) : 0
            }));

        } catch (err) {
            console.error('[AnalyticsRepo] Failed to get app drill down:', err);
            return [];
        }
    }
}

export const defaultAnalyticsRepository = new DefaultAnalyticsRepository();
