/**
 * SingleStatPanel - Big number display with optional sparkline and threshold coloring.
 */

import { getThresholdColor } from '../../../hooks/usePerformanceMetrics';
import { BasePanel } from './BasePanel';
import './SingleStatPanel.css';

export interface SingleStatPanelProps {
    title: string;
    value: number | string;
    unit?: string;
    subtitle?: string;
    sparklineData?: number[];
    thresholds?: { warning: number; critical: number };
    invertThreshold?: boolean; // True if lower is worse
    loading?: boolean;
    error?: string | null;
}

export function SingleStatPanel({
    title,
    value,
    unit = '',
    subtitle,
    sparklineData,
    thresholds,
    invertThreshold = false,
    loading = false,
    error = null,
}: SingleStatPanelProps) {
    // Determine color based on thresholds
    const numericValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    const colorClass = thresholds
        ? `stat-value--${getThresholdColor(numericValue, thresholds, invertThreshold)}`
        : '';

    return (
        <BasePanel title={title} subtitle={subtitle} loading={loading} error={error}>
            <div className="single-stat-container">
                <div className={`single-stat-value ${colorClass}`}>
                    {typeof value === 'number' ? formatValue(value) : value}
                    {unit && <span className="single-stat-unit">{unit}</span>}
                </div>

                {sparklineData && sparklineData.length > 1 && (
                    <Sparkline data={sparklineData} />
                )}
            </div>
        </BasePanel>
    );
}

// Simple sparkline SVG component
function Sparkline({ data }: { data: number[] }) {
    if (data.length < 2) return null;

    const width = 80;
    const height = 24;
    const padding = 2;

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const points = data.map((v, i) => {
        const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
        const y = height - padding - ((v - min) / range) * (height - 2 * padding);
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <polyline
                fill="none"
                stroke="var(--color-blue, #5794f2)"
                strokeWidth="1.5"
                points={points}
            />
        </svg>
    );
}

// Smart value formatting
function formatValue(value: number): string {
    if (!Number.isFinite(value)) return '--';
    if (value === 0) return '0';

    // For very large numbers, use compact notation
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }

    // For decimals, limit precision
    if (value < 10) {
        return value.toFixed(2);
    }
    if (value < 100) {
        return value.toFixed(1);
    }

    return Math.round(value).toString();
}
