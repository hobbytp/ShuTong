/**
 * Central Metrics Interface
 * 
 * Shared type definition for metrics collector to avoid circular dependencies
 * while maintaining type safety across LLM modules.
 */

export interface CentralMetricsInterface {
    incCounter(name: string, value: number, labels?: Record<string, string>): void;
    setGauge(name: string, value: number, labels?: Record<string, string>): void;
    observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

// Lazy-loaded metrics instance (cached)
let _metricsInstance: CentralMetricsInterface | null = null;
let _metricsChecked = false;

/**
 * Get the central metrics collector instance.
 * Uses lazy loading to avoid circular dependencies and for test compatibility.
 */
export function getCentralMetrics(): CentralMetricsInterface | null {
    if (!_metricsChecked) {
        _metricsChecked = true;
        try {
            _metricsInstance = require('./metrics-collector').metrics;
        } catch {
            // Not available (e.g., in tests)
        }
    }
    return _metricsInstance;
}
