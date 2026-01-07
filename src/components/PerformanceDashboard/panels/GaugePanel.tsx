/**
 * GaugePanel - Circular gauge for percentage values.
 */

import { getThresholdColor } from '../../../hooks/usePerformanceMetrics';
import { BasePanel } from './BasePanel';
import './GaugePanel.css';

export interface GaugePanelProps {
    title: string;
    value: number; // 0-100 percentage
    subtitle?: string;
    thresholds?: { warning: number; critical: number };
    invertThreshold?: boolean;
    loading?: boolean;
    error?: string | null;
}

export function GaugePanel({
    title,
    value,
    subtitle,
    thresholds = { warning: 50, critical: 80 },
    invertThreshold = false,
    loading = false,
    error = null,
}: GaugePanelProps) {
    const safeValue = Math.max(0, Math.min(100, value));
    const color = getThresholdColor(safeValue, thresholds, invertThreshold);

    // SVG arc calculation
    const radius = 40;
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (safeValue / 100) * circumference;

    return (
        <BasePanel title={title} subtitle={subtitle} loading={loading} error={error}>
            <div className="gauge-container">
                <svg className="gauge-svg" viewBox="0 0 100 100">
                    {/* Background arc */}
                    <circle
                        className="gauge-bg"
                        cx="50"
                        cy="50"
                        r={radius}
                        strokeWidth={strokeWidth}
                    />
                    {/* Value arc */}
                    <circle
                        className={`gauge-value gauge-value--${color}`}
                        cx="50"
                        cy="50"
                        r={radius}
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        transform="rotate(-90 50 50)"
                    />
                </svg>
                <div className={`gauge-text gauge-text--${color}`}>
                    {safeValue.toFixed(0)}%
                </div>
            </div>
        </BasePanel>
    );
}
