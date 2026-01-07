/**
 * BasePanel - Grafana-style panel container.
 */

import React from 'react';
import './BasePanel.css';

export interface BasePanelProps {
    title: string;
    subtitle?: string;
    loading?: boolean;
    error?: string | null;
    className?: string;
    children: React.ReactNode;
}

export function BasePanel({
    title,
    subtitle,
    loading = false,
    error = null,
    className = '',
    children,
}: BasePanelProps) {
    return (
        <div className={`base-panel ${className}`}>
            <div className="base-panel-header">
                <span className="base-panel-title">{title}</span>
                {subtitle && <span className="base-panel-subtitle">{subtitle}</span>}
            </div>
            <div className="base-panel-content">
                {loading && <div className="base-panel-loading">Loading...</div>}
                {error && <div className="base-panel-error">{error}</div>}
                {!loading && !error && children}
            </div>
        </div>
    );
}
