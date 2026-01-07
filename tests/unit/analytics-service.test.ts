/**
 * Unit tests for Analytics Service (Smart Capture Guard v2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock data stores
const mockWindowSwitches: any[] = [];
const mockDwellStats: any[] = [];
const mockSkipLog: any[] = [];
const mockCards: any[] = [];
const mockCardSwitches: any[] = [];
const mockGuardStats = {
    totalCaptures: 0,
    totalSkips: 0,
    skipsByReason: {},
    lastSkipTime: null,
    lastSkipReason: null
};

vi.mock('../../electron/features/timeline/analytics.repository', () => ({
    defaultAnalyticsRepository: {
        getWindowSwitches: vi.fn(() => mockWindowSwitches),
        getWindowDwellStats: vi.fn(() => mockDwellStats),
        getGuardStats: vi.fn(() => ({ ...mockGuardStats })),
        getSkipLog: vi.fn((limit?: number) => limit ? mockSkipLog.slice(-limit) : [...mockSkipLog]),
        resetGuardStats: vi.fn(),
        getDailyUsageFromCards: vi.fn(() => ({ cards: [...mockCards], switches: [...mockCardSwitches] }))
    }
}));

import {
    getActivityTimeline,
    getCaptureEfficiency,
    getDailyActivitySummary,
    getTopApps
} from '../../electron/features/timeline';

describe('Analytics Service', () => {
    beforeEach(() => {
        // Reset mocks
        mockWindowSwitches.length = 0;
        mockDwellStats.length = 0;
        mockSkipLog.length = 0;
        mockCards.length = 0;
        mockCardSwitches.length = 0;
        mockGuardStats.totalCaptures = 0;
        mockGuardStats.totalSkips = 0;
        mockGuardStats.skipsByReason = {};
    });

    describe('getDailyActivitySummary', () => {
        it('should return summary with empty data', () => {
            const summary = getDailyActivitySummary('2024-01-15');

            expect(summary.date).toBe('2024-01-15');
            expect(summary.totalActiveSeconds).toBe(0);
            expect(summary.appUsage).toEqual([]);
            expect(summary.hourlyActivity.length).toBe(24);
        });

        it('should calculate total active time from card durations', () => {
            // Card from 10:00 to 11:00 (1 hour = 3600 seconds)
            mockCards.push({
                id: 1,
                start_ts: 1705312800, // 2024-01-15 10:00:00
                end_ts: 1705316400,   // 2024-01-15 11:00:00
                category: 'Work',
                title: 'Coding Session'
            });
            // Card from 14:00 to 15:30 (1.5 hours = 5400 seconds)
            mockCards.push({
                id: 2,
                start_ts: 1705327200, // 2024-01-15 14:00:00
                end_ts: 1705332600,   // 2024-01-15 15:30:00
                category: 'Work',
                title: 'Meeting'
            });

            const summary = getDailyActivitySummary('2024-01-15');

            expect(summary.totalActiveSeconds).toBe(3600 + 5400); // 9000 seconds = 2.5 hours
        });

        it('should calculate app usage from switches inside cards', () => {
            mockCards.push({
                id: 1,
                start_ts: 1705312800, // 10:00:00
                end_ts: 1705316400,   // 11:00:00
                category: 'Work',
                title: 'Coding'
            });
            // Switch at 10:00 to VSCode, then at 10:30 to Chrome
            mockCardSwitches.push({
                timestamp: 1705312800,
                to_app: 'VSCode',
                to_title: 'index.ts'
            });
            mockCardSwitches.push({
                timestamp: 1705314600, // 10:30
                to_app: 'Chrome',
                to_title: 'Google'
            });

            const summary = getDailyActivitySummary('2024-01-15');

            // VSCode: 10:00 - 10:30 = 1800s
            // Chrome: 10:30 - 11:00 = 1800s
            expect(summary.appUsage.length).toBe(2);
            expect(summary.appUsage.find(a => a.app === 'VSCode')?.seconds).toBe(1800);
            expect(summary.appUsage.find(a => a.app === 'Chrome')?.seconds).toBe(1800);
        });

        it('should fallback to card title when no switches present', () => {
            mockCards.push({
                id: 1,
                start_ts: 1705312800,
                end_ts: 1705316400,
                category: 'Work',
                title: 'Deep Focus Session'
            });
            // No switches added

            const summary = getDailyActivitySummary('2024-01-15');

            // Should attribute time to the card title
            expect(summary.appUsage.length).toBe(1);
            expect(summary.appUsage[0].app).toBe('Deep Focus Session');
            expect(summary.appUsage[0].seconds).toBe(3600);
        });

        it('should distribute hourly activity correctly', () => {
            // Use today's date with specific hours to avoid timezone issues
            const today = new Date();
            today.setHours(9, 30, 0, 0); // 9:30 AM local time
            const start = Math.floor(today.getTime() / 1000);
            today.setHours(10, 30, 0, 0); // 10:30 AM local time
            const end = Math.floor(today.getTime() / 1000);

            mockCards.push({
                id: 1,
                start_ts: start,
                end_ts: end,
                category: 'Work',
                title: 'Cross-hour session'
            });

            const summary = getDailyActivitySummary(today.toISOString().split('T')[0]);

            // Hour 9 should have 30 minutes (1800s)
            // Hour 10 should have 30 minutes (1800s)
            expect(summary.hourlyActivity[9]).toBe(1800);
            expect(summary.hourlyActivity[10]).toBe(1800);
        });
    });

    describe('getActivityTimeline', () => {
        it('should combine window switches and skip events', () => {
            const now = Math.floor(Date.now() / 1000);
            mockWindowSwitches.push({
                timestamp: now,
                to_app: 'VSCode',
                to_title: 'index.ts'
            });
            mockSkipLog.push({
                timestamp: now + 10,
                reason: 'idle',
                appName: 'VSCode'
            });

            const timeline = getActivityTimeline(now - 100, now + 100);

            expect(timeline.length).toBe(2);
            expect(timeline[0].type).toBe('app_switch');
            expect(timeline[1].type).toBe('skip');
        });

        it('should filter by time range', () => {
            const now = Math.floor(Date.now() / 1000);
            mockSkipLog.push({
                timestamp: now - 1000,  // Outside range
                reason: 'idle'
            });

            const timeline = getActivityTimeline(now - 100, now + 100);

            expect(timeline.length).toBe(0);
        });

        it('should respect limit parameter', () => {
            const now = Math.floor(Date.now() / 1000);
            for (let i = 0; i < 10; i++) {
                mockWindowSwitches.push({
                    timestamp: now + i,
                    to_app: `App${i}`,
                    to_title: ''
                });
            }

            const timeline = getActivityTimeline(now - 100, now + 100, 5);

            expect(timeline.length).toBe(5);
        });
    });

    describe('getCaptureEfficiency', () => {
        it('should calculate 100% efficiency when no skips', () => {
            mockGuardStats.totalCaptures = 100;
            mockGuardStats.totalSkips = 0;

            const result = getCaptureEfficiency();

            expect(result.efficiency).toBe(100);
        });

        it('should calculate correct efficiency ratio', () => {
            mockGuardStats.totalCaptures = 80;
            mockGuardStats.totalSkips = 20;

            const result = getCaptureEfficiency();

            expect(result.efficiency).toBe(80);
            expect(result.totalCaptures).toBe(80);
            expect(result.totalSkips).toBe(20);
        });

        it('should include skip breakdown', () => {
            mockGuardStats.totalCaptures = 50;
            mockGuardStats.totalSkips = 50;
            mockGuardStats.skipsByReason = { idle: 30, similar_frame: 20 };

            const result = getCaptureEfficiency();

            expect(result.skipBreakdown.idle).toBe(30);
            expect(result.skipBreakdown.similar_frame).toBe(20);
        });
    });

    describe('getTopApps', () => {
        it('should return apps sorted by usage', () => {
            mockDwellStats.push(
                { app: 'VSCode', total_seconds: 7200 },
                { app: 'Chrome', total_seconds: 3600 },
                { app: 'Slack', total_seconds: 1800 }
            );

            const topApps = getTopApps(0, Date.now() / 1000);

            expect(topApps[0].app).toBe('VSCode');
            expect(topApps[1].app).toBe('Chrome');
            expect(topApps[2].app).toBe('Slack');
        });

        it('should respect limit parameter', () => {
            mockDwellStats.push(
                { app: 'App1', total_seconds: 100 },
                { app: 'App2', total_seconds: 90 },
                { app: 'App3', total_seconds: 80 }
            );

            const topApps = getTopApps(0, Date.now() / 1000, 2);

            expect(topApps.length).toBe(2);
        });

        it('should calculate percentages correctly', () => {
            mockDwellStats.push(
                { app: 'VSCode', total_seconds: 600 },  // 60%
                { app: 'Chrome', total_seconds: 400 }   // 40%
            );

            const topApps = getTopApps(0, Date.now() / 1000);

            expect(topApps[0].percentage).toBeCloseTo(60, 0);
            expect(topApps[1].percentage).toBeCloseTo(40, 0);
        });
    });
});

