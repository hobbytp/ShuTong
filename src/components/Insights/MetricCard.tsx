import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MetricCardProps {
    title: string;
    value: string | number;
    description: string;
    icon: LucideIcon;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
    className?: string;
    colorTheme?: 'indigo' | 'emerald' | 'sky' | 'rose' | 'amber';
    isNorthStar?: boolean;
    maxValue?: number; // For progress bar visualization
    isTextValue?: boolean;
}

export function MetricCard({
    title,
    value,
    description,
    icon: Icon,
    className,
    colorTheme = 'sky',
    isNorthStar = false,
    maxValue,
    isTextValue = false
}: MetricCardProps) {
    const themeStyles = {
        indigo: {
            text: 'text-indigo-400',
            bg: 'bg-zinc-900/50',
            border: 'border-zinc-800/50',
            northStarBg: 'bg-gradient-to-br from-indigo-900/30 to-purple-900/20 border-indigo-500/20 shadow-lg shadow-indigo-500/10'
        },
        emerald: {
            text: 'text-emerald-400',
            bg: 'bg-zinc-900/50',
            border: 'border-zinc-800/50',
            northStarBg: 'bg-gradient-to-br from-emerald-900/30 to-teal-900/20 border-emerald-500/20 shadow-lg shadow-emerald-500/10'
        },
        sky: {
            text: 'text-sky-400',
            bg: 'bg-zinc-900/50',
            border: 'border-zinc-800/50',
            northStarBg: 'bg-gradient-to-br from-sky-900/30 to-blue-900/20 border-sky-500/20 shadow-lg shadow-sky-500/10'
        },
        rose: {
            text: 'text-rose-400',
            bg: 'bg-zinc-900/50',
            border: 'border-zinc-800/50',
            northStarBg: 'bg-gradient-to-br from-rose-900/30 to-red-900/20 border-rose-500/20 shadow-lg shadow-rose-500/10'
        },
        amber: {
            text: 'text-amber-400',
            bg: 'bg-zinc-900/50',
            border: 'border-zinc-800/50',
            northStarBg: 'bg-gradient-to-br from-amber-900/30 to-orange-900/20 border-amber-500/20 shadow-lg shadow-amber-500/10'
        }
    };

    const styles = themeStyles[colorTheme];
    const cardBg = isNorthStar ? styles.northStarBg : styles.bg;
    const cardBorder = isNorthStar ? '' : styles.border;

    return (
        <div className={cn(
            "rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm",
            isNorthStar ? "" : "border",
            cardBg,
            cardBorder,
            className
        )}>
            {isNorthStar && (
                <div className={`absolute -right-8 -top-8 w-32 h-32 ${styles.text.replace('text-', 'bg-')}/10 rounded-full blur-2xl`} />
            )}

            <div className="relative z-10">
                <div className={cn("flex items-center gap-2 mb-4", styles.text)}>
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium uppercase tracking-wider">{title}</span>
                </div>

                <div className="flex items-end gap-4">
                    <div className={cn(
                        "font-bold text-white mb-2",
                        isTextValue ? "text-3xl" : "text-5xl"
                    )}>{value}</div>
                    {maxValue !== undefined && (
                        <span className="text-2xl text-zinc-500 pb-3">/{maxValue}</span>
                    )}
                </div>

                {maxValue !== undefined && (
                    <div className="mt-2 mb-4 h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className={cn("h-full rounded-full transition-all duration-500", styles.text.replace('text-', 'bg-').replace('-400', '-500'))}
                            style={{ width: `${Math.min(100, (Number(value) / maxValue) * 100)}%` }}
                        />
                    </div>
                )}

                <p className="text-zinc-400 text-sm mt-1">{description}</p>
            </div>
        </div>
    );
}
