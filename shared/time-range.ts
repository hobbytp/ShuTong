/**
 * Time Range Types for VectorStorage filtering
 * 
 * Note: All timestamps use local time (matching how analysis.service.ts stores data).
 * startTs/endTs are Unix timestamps in SECONDS.
 */

export type TimeRangePreset =
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'last_7_days'
    | 'last_30_days'
    | 'all';

export interface TimeRange {
    /** Start timestamp in Unix seconds (inclusive) */
    startTs: number;
    /** End timestamp in Unix seconds (exclusive) */
    endTs: number;
}

export interface TimeRangeOptions {
    /**
     * Day to consider as week start.
     * 0 = Sunday (US default), 1 = Monday (ISO/China), etc.
     * @default 1 (Monday)
     */
    weekStartDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

const SECONDS_PER_DAY = 86400;

/**
 * Resolves a preset name into actual start/end timestamps.
 * Returns undefined for 'all' (no filtering).
 * 
 * @param preset - The time range preset to resolve
 * @param options - Configuration options (e.g., weekStartDay)
 * @returns TimeRange object or undefined for 'all'
 */
export function resolveTimeRangePreset(
    preset: TimeRangePreset,
    options?: TimeRangeOptions
): TimeRange | undefined {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const weekStartDay = options?.weekStartDay ?? 1; // Default to Monday

    switch (preset) {
        case 'today':
            return { startTs: startOfToday, endTs: startOfToday + SECONDS_PER_DAY };

        case 'yesterday':
            return { startTs: startOfToday - SECONDS_PER_DAY, endTs: startOfToday };

        case 'this_week': {
            const currentDay = now.getDay(); // 0 = Sunday
            // Calculate days since week start (handles case where weekStartDay > currentDay)
            const daysSinceWeekStart = (currentDay - weekStartDay + 7) % 7;
            const startOfWeek = startOfToday - daysSinceWeekStart * SECONDS_PER_DAY;
            return { startTs: startOfWeek, endTs: startOfToday + SECONDS_PER_DAY };
        }

        case 'last_7_days':
            return { startTs: startOfToday - 7 * SECONDS_PER_DAY, endTs: startOfToday + SECONDS_PER_DAY };

        case 'last_30_days':
            return { startTs: startOfToday - 30 * SECONDS_PER_DAY, endTs: startOfToday + SECONDS_PER_DAY };

        case 'all':
        default:
            return undefined;
    }
}

/**
 * Formats a TimeRange as a human-readable string.
 * Useful for tooltips and debugging.
 */
export function formatTimeRange(range: TimeRange | undefined): string {
    if (!range) return 'All Time';

    const start = new Date(range.startTs * 1000);
    const end = new Date(range.endTs * 1000 - 1); // -1 to show last second of range

    const formatDate = (d: Date) => d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined
    });

    if (start.toDateString() === end.toDateString()) {
        return formatDate(start);
    }
    return `${formatDate(start)} - ${formatDate(end)}`;
}

