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

export interface IAnalyticsRepository {
    getWindowDwellStats(startTs: number, endTs: number): { app: string; total_seconds: number }[];
    getWindowSwitches(startTs: number, endTs: number, limit?: number): WindowSwitchRecord[];
    getGuardStats(): any;
    getSkipLog(limit?: number): any[];
    resetGuardStats(): void;

    // New method for aligned analytics
    getDailyUsageFromCards(startTs: number, endTs: number): DailyUsageFromCardsResult;
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
}

export const defaultAnalyticsRepository = new DefaultAnalyticsRepository();
