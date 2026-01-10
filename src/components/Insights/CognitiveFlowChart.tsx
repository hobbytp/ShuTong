import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { BrainCircuit } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CognitiveFlowPoint } from '../../lib/ipc';

interface CognitiveFlowChartProps {
    data: CognitiveFlowPoint[];
    comparisonData?: CognitiveFlowPoint[]; // [NEW] Ghost Mode Data
    className?: string;
}

export function CognitiveFlowChart({ data, comparisonData, className }: CognitiveFlowChartProps) {
    const { t } = useTranslation();

    // Merge data for visualization if comparison exists
    // We need to map comparison data to the same "time slots" as current data for chart alignment
    // Assuming hourly buckets 0-23
    const chartData = useMemo(() => {
        return data.map((point, index) => {
            const compPoint = comparisonData?.[index];
            return {
                ...point,
                comparisonScore: compPoint ? compPoint.focusScore : null,
                timeLabel: new Date(point.timestamp).getHours() + ':00'
            };
        });
    }, [data, comparisonData]);

    // Placeholder for CustomTooltip - you'll need to define this component
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-zinc-800/90 p-3 rounded-lg border border-zinc-700 text-xs text-white">
                    <p className="font-medium text-zinc-300 mb-1">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <p key={`item-${index}`} style={{ color: entry.stroke }}>
                            {entry.name}: {entry.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className={cn("bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50 backdrop-blur-sm", className)}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 text-violet-400">
                    <BrainCircuit className="w-5 h-5" />
                    <span className="text-sm font-medium uppercase tracking-wider">{t('insights.cognitive_flow', 'Cognitive Flow')}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>Flow</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500"></div>Focus</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-zinc-600"></div>Distracted</span>
                </div>
            </div>

            <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="focusGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="ghostGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#9ca3af" stopOpacity={0.1} />
                                <stop offset="100%" stopColor="#9ca3af" stopOpacity={0.01} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                        <XAxis
                            dataKey="timeLabel"
                            stroke="#71717a"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#71717a"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 100]}
                        />
                        <Tooltip content={<CustomTooltip />} />

                        {/* Ghost Mode Line (Yesterday) */}
                        {comparisonData && (
                            <Area
                                type="monotone"
                                dataKey="comparisonScore"
                                name="Yesterday"
                                stroke="#52525b"
                                strokeDasharray="5 5"
                                strokeWidth={2}
                                fill="url(#ghostGradient)"
                                activeDot={false}
                            />
                        )}

                        {/* Current Flow Line */}
                        <Area
                            type="monotone"
                            dataKey="focusScore"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorScore)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
