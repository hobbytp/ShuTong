/**
 * Performance Dashboard Hook - Subscribes to real-time performance metrics.
 * Enhanced with history buffer for rate calculations and sparklines.
 */

import type { PerformanceSnapshot } from '@shared/ipc-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Configuration
const HISTORY_SIZE = 60; // Keep 60 snapshots (~1 minute at 1s refresh)

// Initial empty snapshot
const EMPTY_SNAPSHOT: PerformanceSnapshot = {
    timestamp: 0,
    system: {
        cpuPercent: 0,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        heapUsedBytes: 0,
        appMemoryUsedBytes: 0,
        eventLoopLagMs: 0,
    },
    histograms: {},
    counters: {},
    gauges: {},
};

// ============================================================================
// Rate Calculation Utilities (P0)
// ============================================================================

/**
 * Calculate rate (per second) from counter history.
 * Uses the last two snapshots to compute instantaneous rate.
 */
export function calculateRate(
    history: PerformanceSnapshot[],
    counterName: string
): number {
    if (history.length < 2) return 0;

    const curr = history[history.length - 1];
    const prev = history[history.length - 2];

    const timeDeltaSec = (curr.timestamp - prev.timestamp) / 1000;
    if (timeDeltaSec <= 0) return 0;

    const currVal = curr.counters[counterName] ?? 0;
    const prevVal = prev.counters[counterName] ?? 0;

    // Counter reset detection (e.g., app restart)
    if (currVal < prevVal) return 0;

    return (currVal - prevVal) / timeDeltaSec;
}

/**
 * Calculate error percentage from two counters.
 * Returns 0-100 scale.
 */
export function calculateErrorPercentage(
    snapshot: PerformanceSnapshot,
    errorCounterName: string,
    totalCounterName: string
): number {
    const errors = snapshot.counters[errorCounterName] ?? 0;
    const total = snapshot.counters[totalCounterName] ?? 0;

    if (total === 0) return 0;
    return Math.min(100, (errors / total) * 100);
}

/**
 * Extract sparkline data (last N values) for a counter's rate.
 */
export function getSparklineData(
    history: PerformanceSnapshot[],
    counterName: string,
    points: number = 20
): number[] {
    if (history.length < 2) return [];

    const rates: number[] = [];
    const startIdx = Math.max(1, history.length - points);

    for (let i = startIdx; i < history.length; i++) {
        const curr = history[i];
        const prev = history[i - 1];
        const timeDelta = (curr.timestamp - prev.timestamp) / 1000;

        if (timeDelta > 0) {
            const currVal = curr.counters[counterName] ?? 0;
            const prevVal = prev.counters[counterName] ?? 0;
            const rate = currVal >= prevVal ? (currVal - prevVal) / timeDelta : 0;
            rates.push(rate);
        }
    }

    return rates;
}

/**
 * Get threshold color based on value.
 */
export function getThresholdColor(
    value: number,
    thresholds: { warning: number; critical: number },
    invert: boolean = false
): 'green' | 'yellow' | 'red' {
    if (invert) {
        // Lower is worse (e.g., success rate)
        if (value < thresholds.critical) return 'red';
        if (value < thresholds.warning) return 'yellow';
        return 'green';
    } else {
        // Higher is worse (e.g., error rate, latency)
        if (value > thresholds.critical) return 'red';
        if (value > thresholds.warning) return 'yellow';
        return 'green';
    }
}

// ============================================================================
// Main Hook
// ============================================================================

export function usePerformanceMetrics() {
    const [snapshot, setSnapshot] = useState<PerformanceSnapshot>(EMPTY_SNAPSHOT);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // History buffer using ref to avoid re-renders on every push
    const historyRef = useRef<PerformanceSnapshot[]>([]);
    const [historyVersion, setHistoryVersion] = useState(0);

    // Update history when snapshot changes
    useEffect(() => {
        if (snapshot.timestamp > 0) {
            const newHistory = [...historyRef.current, snapshot].slice(-HISTORY_SIZE);
            historyRef.current = newHistory;
            setHistoryVersion(v => v + 1); // Trigger re-render for consumers
        }
    }, [snapshot]);

    // Memoized history accessor (stable reference unless version changes)
    const history = useMemo(() => historyRef.current, [historyVersion]);

    // Subscribe to push updates
    const subscribe = useCallback(async () => {
        try {
            await window.ipcRenderer?.invoke('performance:subscribe');
            setIsSubscribed(true);
            setError(null);
        } catch (err) {
            setError('Failed to subscribe to performance updates');
            console.error('[usePerformanceMetrics] Subscribe error:', err);
        }
    }, []);

    // Unsubscribe from push updates
    const unsubscribe = useCallback(async () => {
        try {
            await window.ipcRenderer?.invoke('performance:unsubscribe');
            setIsSubscribed(false);
        } catch (err) {
            console.error('[usePerformanceMetrics] Unsubscribe error:', err);
        }
    }, []);

    // Fetch initial snapshot
    const refresh = useCallback(async () => {
        try {
            const data = await window.ipcRenderer?.invoke('performance:getSnapshot');
            if (data) setSnapshot(data);
            setError(null);
        } catch (err) {
            setError('Failed to fetch performance snapshot');
            console.error('[usePerformanceMetrics] Refresh error:', err);
        }
    }, []);

    // Listen for push updates
    useEffect(() => {
        const cleanup = window.ipcRenderer?.on('performance:update', (_event: unknown, data: PerformanceSnapshot) => {
            setSnapshot(data);
        });

        return () => {
            cleanup?.();
        };
    }, []);

    // Auto-subscribe when component mounts, auto-pause when hidden
    useEffect(() => {
        // Subscribe on mount (sequential to avoid race condition)
        const init = async () => {
            await subscribe();
            await refresh();
        };
        init();

        // Pause when tab is hidden
        const handleVisibilityChange = async () => {
            if (document.hidden) {
                await unsubscribe();
            } else {
                await subscribe();
                await refresh();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            unsubscribe();
        };
    }, [subscribe, unsubscribe, refresh]);

    return {
        snapshot,
        history,
        isSubscribed,
        error,
        refresh,
        subscribe,
        unsubscribe,
    };
}

// Helper to format bytes to human-readable
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (!Number.isFinite(bytes) || bytes < 0) return '-- B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper to format ms to human-readable
export function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '-- ms';
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
