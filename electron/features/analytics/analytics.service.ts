import { ipcMain } from 'electron';
import { defaultAnalyticsRepository, ProductivityStatsRecord } from '../timeline/analytics.repository';
import { ActivityCategorizer } from '../analytics/activity-categorizer';
import type { ProductivitySummary, CognitiveFlowPoint } from '../../../shared/ipc-contract';

export class AnalyticsService {
    constructor() {
        this.registerIPC();
    }

    private registerIPC() {
        ipcMain.handle('get-productivity-summary', async (_, dateStr: string) => {
            return this.getProductivitySummary(dateStr);
        });

        ipcMain.handle('get-app-drilldown', async (_, request: any) => {
            const { appName, startTs, endTs } = request;
            return this.getAppDrillDown(appName, startTs, endTs);
        });
    }

    async getProductivitySummary(dateStr: string): Promise<ProductivitySummary> {
        try {
            const targetDate = new Date(dateStr);
            const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0)).getTime();
            const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999)).getTime();

            const stats = defaultAnalyticsRepository.getProductivityStats(startOfDay, endOfDay);
            const hourlyStats = defaultAnalyticsRepository.getHourlyProductivityStats(startOfDay, endOfDay);

            // Calculate percentage for app usage
            const totalAppDuration = stats.app_usage.reduce((sum, app) => sum + app.duration_minutes, 0);

            const topApps = stats.app_usage.map(app => ({
                appName: app.app_name,
                duration: app.duration_minutes,
                percentage: totalAppDuration > 0 ? Math.round((app.duration_minutes / totalAppDuration) * 1000) / 10 : 0,
                category: app.category as 'productive' | 'neutral' | 'distraction'
            }));

            // Fetch detailed switch history for Smart Penalty
            const useSmartPenalty = true;
            let weightedSwitches = stats.context_switches;

            if (useSmartPenalty) {
                const switchesIter = defaultAnalyticsRepository.getWindowSwitchesIterator(startOfDay, endOfDay);
                weightedSwitches = this.calculateWeightedSwitches(switchesIter);
            }

            // Calculate overall Focus Score
            const focusScore = this.calculateFocusScore(stats, topApps, weightedSwitches);

            // Calculate Cognitive Flow Timeline
            const cognitiveTrend = this.calculateCognitiveFlow(hourlyStats);

            // Calculate Recovery Needs
            const recoveryTimeMinutes = this.calculateRecoveryNeeds(cognitiveTrend);

            return {
                totalActiveMinutes: stats.total_active_minutes,
                deepWorkMinutes: stats.deep_work_minutes,
                topApps: topApps,
                focusScore,
                contextSwitches: stats.context_switches,
                recoveryTimeMinutes,
                cognitiveTrend
            };

        } catch (error) {
            console.error('[AnalyticsService] Error getting summary:', error);
            return {
                totalActiveMinutes: 0,
                deepWorkMinutes: 0,
                topApps: [],
                focusScore: 0,
                contextSwitches: 0,
                recoveryTimeMinutes: 0,
                cognitiveTrend: []
            };
        }
    }

    private calculateWeightedSwitches(switches: Iterable<any>): number {
        let weightedCount = 0;
        let prevApp = '';

        for (const sw of switches) {
            const currApp = sw.app_name;
            if (!prevApp) {
                prevApp = currApp;
                continue; // Skip first one
            }

            const prevGroup = ActivityCategorizer.getAppGroup(prevApp);
            const currGroup = ActivityCategorizer.getAppGroup(currApp);

            if (prevGroup && currGroup && prevGroup === currGroup) {
                // Same workflow group (e.g. Dev -> Dev). No penalty.
                weightedCount += 0;
            } else {
                // Check categories
                const prevCat = ActivityCategorizer.categorize(prevApp);
                const currCat = ActivityCategorizer.categorize(currApp);

                if (prevCat === 'productive' && currCat === 'productive') {
                    // Switching between productive apps but different groups. Low penalty.
                    weightedCount += 0.5;
                } else {
                    // Standard switch
                    weightedCount += 1;
                }
            }
            prevApp = currApp;
        }
        return weightedCount;
    }

    private calculateFocusScore(stats: ProductivityStatsRecord, topApps: any[], weightedSwitches: number): number {
        if (stats.total_active_minutes === 0) return 0;

        // Base Score
        let score = 50;

        // 1. Deep Work Bonus (Max 30)
        const deepWorkRatio = Math.min(1, stats.deep_work_minutes / stats.total_active_minutes);
        score += deepWorkRatio * 30;

        // 2. Productive App Bonus (Max 20)
        const productiveAppRatio = topApps
            .filter(a => a.category === 'productive')
            .reduce((sum, a) => sum + a.percentage, 0) / 100;
        score += productiveAppRatio * 20;

        // 3. Penalty for Distractions (Max -20)
        const distractionRatio = topApps
            .filter(a => a.category === 'distraction')
            .reduce((sum, a) => sum + a.percentage, 0) / 100;
        score -= distractionRatio * 20;

        // 4. Penalty for Context Switching (Fragmentation)
        // Avg switches per hour -> If > 20/hr, penalty.
        // Approx hours = active_minutes / 60
        const activeHours = Math.max(1, stats.total_active_minutes / 60);
        // Use Weighted Switches here!
        const switchesPerHour = weightedSwitches / activeHours;

        // Linear penalty: -1 point for every switch over 15/hr, max -30
        if (switchesPerHour > 15) {
            const penalty = Math.min(30, (switchesPerHour - 15) * 1);
            score -= penalty;
        }

        return Math.round(Math.min(100, Math.max(0, score)));
    }

    private calculateCognitiveFlow(hourlyStats: any[]): CognitiveFlowPoint[] {
        return hourlyStats.map(stat => {
            let score = 50;
            if (stat.active_minutes > 0) {
                const deepRatio = stat.deep_minutes / stat.active_minutes;
                score += deepRatio * 40;

                // Switch penalty for this hour
                if (stat.switch_count > 15) {
                    score -= Math.min(30, (stat.switch_count - 15));
                }
            } else {
                return { timestamp: stat.timestamp, focusScore: 0, state: 'neutral' };
            }

            score = Math.min(100, Math.max(0, score));

            let state: 'flow' | 'neutral' | 'distracted' = 'neutral';
            if (score >= 75) state = 'flow';
            if (score < 40) state = 'distracted';

            return {
                timestamp: stat.timestamp,
                focusScore: Math.round(score),
                state
            };
        });
    }

    private calculateRecoveryNeeds(trend: CognitiveFlowPoint[]): number {
        // Simple Heuristic: If last 90 minutes (1.5h) were in 'flow' or high 'neutral', suggest break.
        if (trend.length < 2) return 0;

        // Check the last few data points (assuming hourly buckets, check last 2 hours)
        const lastTwo = trend.slice(-2);
        const avgScore = lastTwo.reduce((sum, p) => sum + p.focusScore, 0) / lastTwo.length;

        if (avgScore > 75) {
            return 15; // Suggest 15 min break
        }
        return 0;
    }

    async getAppDrillDown(appName: string, startTs: number, endTs: number) {
        return defaultAnalyticsRepository.getAppDrillDown(appName, startTs, endTs);
    }
}

export const analyticsService = new AnalyticsService();
