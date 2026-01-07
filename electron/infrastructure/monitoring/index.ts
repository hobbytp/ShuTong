/**
 * Monitoring Infrastructure - Barrel Export
 * 
 * Provides unified access to metrics collection and system monitoring.
 */

export { metrics, metricsCollector, type Labels, type PerformanceSnapshot } from './metrics-collector';
export { setupPerformanceIPC, shutdownPerformanceMonitoring } from './performance-ipc';
export { systemMonitor } from './system-monitor';

// Re-export legacy metrics service for backward compatibility
export { metrics as legacyMetrics, measure, MetricsService } from './metrics.service';

