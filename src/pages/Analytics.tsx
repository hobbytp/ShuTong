import { ArrowLeft, ArrowRight, BarChart2, Calendar, Clock, LayoutGrid, Monitor, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

interface AppUsageEntry {
    app: string;
    seconds: number;
    percentage: number;
}

interface DailyActivitySummary {
    date: string;
    totalActiveSeconds: number;
    appUsage: AppUsageEntry[];
    hourlyActivity: number[];
}

interface ActivityTimelineEvent {
    timestamp: number;
    type: 'app_switch' | 'skip' | 'capture';
    appName?: string;
    details?: string;
}

export function Analytics() {
    const [date, setDate] = useState(new Date());
    const [summary, setSummary] = useState<DailyActivitySummary | null>(null);
    const [timeline, setTimeline] = useState<ActivityTimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    // Format date as YYYY-MM-DD in local time
    const getDateString = (d: Date) => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };

    useEffect(() => {
        fetchData();
    }, [date]);

    const fetchData = async () => {
        if (!window.ipcRenderer) return;
        setLoading(true);
        try {
            const dateStr = getDateString(date);
            const summaryData = await window.ipcRenderer.invoke('analytics:getDailySummary', dateStr);
            setSummary(summaryData);

            // Get timeline for the whole day
            const startOfDay = new Date(dateStr + 'T00:00:00').getTime() / 1000;
            const endOfDay = startOfDay + 86400;
            const timelineData = await window.ipcRenderer.invoke('analytics:getTimeline', startOfDay, endOfDay, 200);
            setTimeline(timelineData.reverse()); // Newest first
        } catch (err) {
            console.error('Failed to load analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    const changeDate = (days: number) => {
        const newDate = new Date(date);
        newDate.setDate(newDate.getDate() + days);
        setDate(newDate);
    };

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h === 0) return `${m}m`;
        return `${h}h ${m}m`;
    };

    const maxHourlyActivity = summary ? Math.max(...summary.hourlyActivity, 1) : 1;

    return (
        <div className="h-full flex flex-col p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header / Date Picker */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
                        <BarChart2 className="text-indigo-400" />
                        Activity Analytics
                    </h1>
                    <p className="text-zinc-500 text-sm mt-1">Daily overview of your digital activity</p>
                </div>

                <div className="flex items-center gap-4 bg-zinc-900/50 p-1.5 rounded-lg border border-zinc-800">
                    <button onClick={() => changeDate(-1)} className="p-2 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="flex items-center gap-2 px-2">
                        <Calendar size={16} className="text-indigo-400" />
                        <span className="text-zinc-200 font-mono font-medium min-w-[100px] text-center">
                            {getDateString(date)}
                        </span>
                    </div>
                    <button onClick={() => changeDate(1)} className="p-2 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors">
                        <ArrowRight size={18} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0 overflow-y-auto pr-2">

                    {/* Left Column: Stats & Charts */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Active Time</div>
                                <div className="text-2xl font-bold text-zinc-100">{formatDuration(summary?.totalActiveSeconds || 0)}</div>
                            </div>
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Top App</div>
                                <div className="text-xl font-bold text-zinc-100 truncate" title={summary?.appUsage[0]?.app}>
                                    {summary?.appUsage[0]?.app || '-'}
                                </div>
                            </div>
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 hidden sm:block">
                                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Productive Hours</div>
                                <div className="text-xl font-bold text-emerald-400">
                                    {/* Placeholder for future productivity metric */}
                                    -
                                </div>
                            </div>
                        </div>

                        {/* Hourly Activity Chart */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <h3 className="text-sm font-medium text-zinc-300 mb-6 flex items-center gap-2">
                                <Clock size={16} className="text-indigo-400" />
                                Hourly Activity
                            </h3>
                            <div className="h-48 flex items-end gap-1.5 sm:gap-3">
                                {summary?.hourlyActivity.map((seconds, hour) => {
                                    const heightPercent = (seconds / maxHourlyActivity) * 100;
                                    const intensity = Math.min(seconds / 3600, 1); // Opacity based on full hour
                                    return (
                                        <div key={hour} className="flex-1 flex flex-col items-center gap-2 group">
                                            <div
                                                className="w-full bg-indigo-500 rounded-t-sm transition-all duration-500 relative min-h-[4px]"
                                                style={{
                                                    height: `${Math.max(heightPercent, 2)}%`,
                                                    opacity: 0.3 + (intensity * 0.7)
                                                }}
                                            >
                                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-800 px-2 py-1 rounded text-xs text-zinc-200 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10 border border-zinc-700">
                                                    {formatDuration(seconds)}
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-zinc-600 font-mono">{hour}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Top Apps List */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                                <LayoutGrid size={16} className="text-emerald-400" />
                                Top Applications
                            </h3>
                            <div className="space-y-4">
                                {summary?.appUsage.length === 0 ? (
                                    <div className="text-zinc-600 italic text-sm">No app activity recorded.</div>
                                ) : (
                                    summary?.appUsage.slice(0, 8).map((app, i) => (
                                        <div key={i} className="group">
                                            <div className="flex items-center justify-between text-sm mb-1.5">
                                                <div className="flex items-center gap-2 truncate">
                                                    <span className="w-5 text-center text-xs text-zinc-600 font-mono">{i + 1}</span>
                                                    <span className="text-zinc-300 truncate font-medium">{app.app}</span>
                                                </div>
                                                <span className="text-zinc-400 font-mono text-xs">{formatDuration(app.seconds)}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-zinc-800/50 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500/50 rounded-full group-hover:bg-emerald-500 transition-colors"
                                                    style={{ width: `${app.percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Timeline Feed */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-0 flex flex-col overflow-hidden max-h-[800px]">
                        <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
                            <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                <Monitor size={16} className="text-amber-400" />
                                Activity Feed
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                            {timeline.length === 0 ? (
                                <div className="text-zinc-600 italic text-center text-sm py-10">No events found.</div>
                            ) : (
                                timeline.map((event, i) => (
                                    <div key={i} className="flex gap-3 relative">
                                        {/* Timeline Line */}
                                        {i !== timeline.length - 1 && (
                                            <div className="absolute left-[19px] top-8 bottom-[-16px] w-[1px] bg-zinc-800" />
                                        )}

                                        {/* Icon */}
                                        <div className={cn(
                                            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 z-10 border",
                                            event.type === 'skip' ? "bg-amber-500/10 border-amber-500/20 text-amber-500" :
                                                event.type === 'capture' ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-500" :
                                                    "bg-zinc-800 border-zinc-700 text-zinc-400"
                                        )}>
                                            {event.type === 'skip' ? <ShieldAlert size={16} /> :
                                                event.type === 'capture' ? <Monitor size={16} /> :
                                                    <LayoutGrid size={16} />}
                                        </div>

                                        <div className="flex-1 min-w-0 pt-0.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-mono text-zinc-500">
                                                    {new Date(event.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div className="text-sm font-medium text-zinc-200 truncate mt-0.5">
                                                {event.appName || 'System'}
                                            </div>
                                            {event.details && (
                                                <div className="text-xs text-zinc-500 mt-0.5 truncate bg-zinc-950/50 rounded px-1.5 py-0.5 inline-block max-w-full">
                                                    {event.details}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
