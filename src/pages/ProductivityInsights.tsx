/**
 * ProductivityInsights Page - Phase 1: Bento Grid Layout with Basic Metrics
 *
 * Features:
 * - "Deep Work Hours" metric card
 * - App Usage breakdown (Donut Chart)
 * - Placeholder for Cognitive Flow (Phase 2)
 */

import { Brain, TrendingUp, Zap, Clock, Activity } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MetricCard } from '../components/Insights/MetricCard';
import { AppUsageChart } from '../components/Insights/AppUsageChart';
import { CognitiveFlowChart } from '../components/Insights/CognitiveFlowChart';
import { BatteryCharging } from 'lucide-react';
import type { ProductivitySummary } from '../lib/ipc';
import { resolveTimeRangePreset } from '../../shared/time-range';

// Placeholder data for Phase 1
const MOCK_DATA: ProductivitySummary = {
    totalActiveMinutes: 480,
    deepWorkMinutes: 215,
    topApps: [
        { appName: 'VS Code', duration: 180, percentage: 37.5, category: 'productive' },
        { appName: 'Chrome', duration: 120, percentage: 25, category: 'neutral' },
        { appName: 'Notion', duration: 60, percentage: 12.5, category: 'productive' },
        { appName: 'Slack', duration: 45, percentage: 9.4, category: 'neutral' },
        { appName: 'Other', duration: 75, percentage: 15.6, category: 'neutral' },
    ],
    focusScore: 72,
    contextSwitches: 34,
    recoveryTimeMinutes: 0,
    cognitiveTrend: []
};

export function ProductivityInsights() {
    const { t } = useTranslation();
    const [data, setData] = useState<ProductivitySummary>(MOCK_DATA);
    const [yesterdayData, setYesterdayData] = useState<ProductivitySummary | null>(null);
    const [_isLoading, setIsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'last_30_days'>('today');

    // Calculate time range for the current view using shared utility
    const resolvedRange = useMemo(() => resolveTimeRangePreset(timeRange), [timeRange]);
    const startTs = resolvedRange ? resolvedRange.startTs * 1000 : Date.now() - 86400000;
    const endTs = resolvedRange ? resolvedRange.endTs * 1000 : Date.now();

    // Fetch data from backend
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const { invoke } = await import('../lib/ipc');
            // Fetch with time range
            const dateStr = timeRange === 'today'
                ? new Date().toISOString()
                : new Date(startTs).toISOString();
            const summary = await invoke('get-productivity-summary', dateStr);
            setData(summary);

            // Yesterday data for Ghost Mode (only fetch if viewing today)
            if (timeRange === 'today') {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const ySummary = await invoke('get-productivity-summary', yesterday.toISOString());
                setYesterdayData(ySummary);
            } else {
                setYesterdayData(null);
            }

        } catch (e) {
            console.error('[ProductivityInsights] Failed to fetch data:', e);
        } finally {
            setIsLoading(false);
        }
    }, [timeRange, startTs]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const formatDuration = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    return (
        <div className="h-full p-6 overflow-auto bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
            {/* Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Brain className="w-8 h-8 text-indigo-400" />
                        {t('insights.title', 'Productivity Insights')}
                    </h1>
                    <p className="text-zinc-400 mt-1">{t('insights.subtitle', 'Understand your focus and work patterns')}</p>
                </div>

                {/* Time Range Selector */}
                <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-400">{t('pulse.time_range_label', 'Time Range')}:</span>
                    <select
                        value={timeRange}
                        onChange={(e) => setTimeRange(e.target.value as any)}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                        <option value="today">{t('pulse.time_today', 'Today')}</option>
                        <option value="yesterday">{t('pulse.time_yesterday', 'Yesterday')}</option>
                        <option value="this_week">{t('pulse.time_this_week', 'This Week')}</option>
                        <option value="last_7_days">{t('pulse.time_last_7_days', 'Last 7 Days')}</option>
                        <option value="last_30_days">{t('pulse.time_last_30_days', 'Last 30 Days')}</option>
                    </select>
                </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min">
                {/* Card 1: Deep Work Hours (North Star) */}
                <MetricCard
                    title={t('insights.deep_work', 'Deep Work')}
                    value={formatDuration(data.deepWorkMinutes)}
                    description={t('insights.deep_work_desc', 'High focus time today')}
                    icon={Zap}
                    colorTheme="indigo"
                    isNorthStar={true}
                    className="col-span-1 lg:col-span-1"
                />

                {/* Card 2: Focus Score */}
                <MetricCard
                    title={t('insights.focus_score', 'Focus Score')}
                    value={data.focusScore}
                    description="/ 100"
                    icon={TrendingUp}
                    colorTheme="emerald"
                    maxValue={100}
                    className="col-span-1"
                />

                {/* Card 3: Total Active Time */}
                <MetricCard
                    title={t('insights.total_active', 'Total Active')}
                    value={formatDuration(data.totalActiveMinutes)}
                    description={t('insights.today', 'Today')}
                    icon={Clock}
                    colorTheme="sky"
                    className="col-span-1"
                />

                {/* Card 4: App Usage Breakdown (Larger) */}
                <AppUsageChart
                    data={data.topApps}
                    className="col-span-1 md:col-span-2"
                    startTs={startTs}
                    endTs={endTs}
                />

                {/* Card 5: Context Switches */}
                <MetricCard
                    title={t('insights.context_switches', 'Context Switches')}
                    value={data.contextSwitches}
                    description={t('insights.switches_today', 'App switches today')}
                    icon={Activity}
                    colorTheme="rose"
                    className="col-span-1"
                />
            </div>

            {/* Row 2: Cognitive Flow & Recovery */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                <CognitiveFlowChart
                    data={data.cognitiveTrend || []}
                    comparisonData={yesterdayData?.cognitiveTrend || []}
                    className="col-span-1 lg:col-span-2 h-[350px]"
                />

                {/* Recovery / Context Switches Detail */}
                <div className="flex flex-col gap-6">
                    {data.recoveryTimeMinutes > 0 ? (
                        <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-2xl p-6 border border-indigo-500/20 backdrop-blur-sm">
                            <div className="flex items-center gap-2 text-indigo-400 mb-4">
                                <BatteryCharging className="w-5 h-5 animate-pulse" />
                                <span className="text-sm font-medium uppercase tracking-wider">{t('insights.recovery', 'Recovery Needed')}</span>
                            </div>
                            <div className="text-4xl font-bold text-white mb-2">{data.recoveryTimeMinutes}m</div>
                            <p className="text-sm text-zinc-400">
                                {t('insights.recovery_desc', 'You have been in high focus for a while. Take a short break to recharge.')}
                            </p>
                        </div>
                    ) : (
                        <MetricCard
                            title={t('insights.recovery_status', 'Recovery Status')}
                            value={t('insights.ready', 'Ready')}
                            description={t('insights.brain_battery', 'Brain battery is full')}
                            icon={BatteryCharging}
                            colorTheme="emerald" // Green for "Good"
                            isTextValue={true}
                        />
                    )}

                    {/* Move Context Switches here if space allows, or keep in top grid */}
                </div>
            </div>
        </div>
    );
}
