/**
 * Unit tests for Analytics Service (Smart Capture Guard v2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock repository instead of direct storage dependencies
const mockWindowSwitches: any[] = [];
const mockDwellStats: any[] = [];
const mockSkipLog: any[] = [];
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
        resetGuardStats: vi.fn()
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

        it('should calculate app usage percentages', () => {
            mockDwellStats.push(
                { app: 'VSCode', total_seconds: 3600 },  // 50%
                { app: 'Chrome', total_seconds: 3600 }   // 50%
            );

            const summary = getDailyActivitySummary('2024-01-15');

            expect(summary.totalActiveSeconds).toBe(7200);
            expect(summary.appUsage.length).toBe(2);
            expect(summary.appUsage[0].percentage).toBeCloseTo(50, 0);
            expect(summary.appUsage[1].percentage).toBeCloseTo(50, 0);
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
