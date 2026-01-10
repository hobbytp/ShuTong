import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { AppUsageStat } from '../../lib/ipc';
import { DrillDownModal } from './DrillDownModal';
import { useState } from 'react';

interface AppUsageChartProps {
    data: AppUsageStat[];
    className?: string;
    startTs?: number; // Optional, defaults to today if missing (handled by parent ideally)
    endTs?: number;
}

export function AppUsageChart({ data, className, startTs, endTs }: AppUsageChartProps) {
    const { t } = useTranslation();
    const [selectedApp, setSelectedApp] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Default to today if not provided (though parent should provide for accuracy)
    const effectiveStartTs = startTs || new Date().setHours(0, 0, 0, 0);
    const effectiveEndTs = endTs || new Date().setHours(23, 59, 59, 999);

    const handleBarClick = (appName: string) => {
        setSelectedApp(appName);
        setIsModalOpen(true);
    };

    const formatDuration = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const categoryColors: Record<string, string> = {
        productive: 'bg-emerald-500',
        neutral: 'bg-sky-500',
        distraction: 'bg-amber-500',
    };

    return (
        <div className={cn("bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50 backdrop-blur-sm", className)}>
            <div className="flex items-center gap-2 text-amber-400 mb-6">
                <BarChart3 className="w-5 h-5" />
                <span className="text-sm font-medium uppercase tracking-wider">{t('insights.app_usage', 'App Usage')}</span>
            </div>
            <div className="space-y-4">
                {data.map((app) => (
                    <div
                        key={app.appName}
                        className="flex items-center gap-4 group cursor-pointer hover:bg-zinc-800/30 p-2 rounded-lg transition-colors"
                        onClick={() => handleBarClick(app.appName)}
                    >
                        <div className="w-24 text-sm text-zinc-300 truncate group-hover:text-white transition-colors" title={app.appName}>{app.appName}</div>
                        <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full ${categoryColors[app.category]} rounded-full transition-all duration-500 group-hover:brightness-110`}
                                style={{ width: `${app.percentage}%` }}
                            />
                        </div>
                        <div className="w-16 text-right text-sm text-zinc-400 group-hover:text-zinc-300">{formatDuration(app.duration)}</div>
                    </div>
                ))}
            </div>

            <DrillDownModal
                appName={selectedApp}
                startTs={effectiveStartTs}
                endTs={effectiveEndTs}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
}
