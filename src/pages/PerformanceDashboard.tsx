/**
 * Performance Dashboard Page (Grafana Style)
 * 
 * Displays real-time system metrics organized by service domain (RED/USE methodology).
 */

import {
    calculateErrorPercentage,
    calculateRate,
    formatBytes,
    getSparklineData,
    usePerformanceMetrics
} from '@/hooks/usePerformanceMetrics';
import { useTranslation } from 'react-i18next';
import {
    GaugePanel,
    ServiceHealthRow,
    SingleStatPanel,
    type ServiceHealth,
    type ServiceStatus,
} from '../components/PerformanceDashboard/panels';
import './PerformanceDashboard.css';

export function PerformanceDashboard() {
    const { t } = useTranslation();
    const { snapshot, history, isSubscribed, error, refresh } = usePerformanceMetrics();

    const { system, histograms } = snapshot;

    // Calculate derived metrics
    const memoryPercent = system.memoryTotalBytes > 0
        ? (system.memoryUsedBytes / system.memoryTotalBytes * 100)
        : 0;

    // Rate calculations (requires history)
    const dbQps = calculateRate(history, 'db.queries_total');
    const dbErrorRate = calculateErrorPercentage(snapshot, 'db.errors_total', 'db.queries_total');
    const ocrRps = calculateRate(history, 'ocr.requests_total');
    const ocrErrorRate = calculateErrorPercentage(snapshot, 'ocr.errors_total', 'ocr.requests_total');
    const captureRate = calculateRate(history, 'capture.frames_total');

    // LLM metrics
    const llmRps = calculateRate(history, 'llm.requests_total');
    const llmErrorRate = calculateErrorPercentage(snapshot, 'llm.errors_total', 'llm.requests_total');
    const llmTokensTotal = snapshot.gauges['llm.tokens_total'] ?? 0;
    const llmSparkline = getSparklineData(history, 'llm.requests_total', 20);

    // Sparkline data
    const dbQpsSparkline = getSparklineData(history, 'db.queries_total', 20);

    // Service health summary
    const serviceHealth: ServiceHealth[] = [
        {
            name: t('performance.database', 'DB'),
            status: getServiceStatus(dbErrorRate, { warning: 1, critical: 5 }),
            tooltip: `${t('performance.panels.error_rate', 'Error Rate')}: ${dbErrorRate.toFixed(2)}%`,
        },
        {
            name: t('performance.ocr', 'OCR'),
            status: getServiceStatus(ocrErrorRate, { warning: 5, critical: 20 }),
            tooltip: `${t('performance.panels.error_rate', 'Error Rate')}: ${ocrErrorRate.toFixed(2)}%`,
        },
        {
            name: t('performance.llm', 'LLM'),
            status: getServiceStatus(llmErrorRate, { warning: 5, critical: 20 }),
            tooltip: `${t('performance.panels.error_rate', 'Error Rate')}: ${llmErrorRate.toFixed(2)}%`,
        },
        {
            name: t('performance.capture', 'Capture'),
            status: captureRate > 0 ? 'green' : 'unknown',
            tooltip: `${t('performance.panels.frame_rate', 'Frame Rate')}: ${captureRate.toFixed(1)} fps`,
        },
        {
            name: t('performance.panels.system', 'System'),
            status: getServiceStatus(system.cpuPercent, { warning: 50, critical: 80 }),
            tooltip: `${t('performance.panels.cpu', 'CPU')}: ${system.cpuPercent.toFixed(1)}%`,
        },
    ];

    return (
        <div className="performance-dashboard grafana-style">
            <header className="performance-header">
                <h1>⚡ {t('performance.title', 'Performance Monitor')}</h1>
                <div className="status-badge">
                    {isSubscribed ? (
                        <span className="status-live">🟢 {t('performance.live', 'Live')}</span>
                    ) : (
                        <span className="status-paused">⏸ {t('performance.paused', 'Paused')}</span>
                    )}
                    <button onClick={refresh} className="refresh-btn">🔄</button>
                </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            {/* Service Health Summary */}
            <ServiceHealthRow services={serviceHealth} />

            {/* Row 1: System Overview (USE) */}
            <section className="metrics-section">
                <h2>🖥️ {t('performance.systemHealth', 'System Overview')}</h2>
                <div className="panel-row">
                    <GaugePanel
                        title={t('performance.panels.cpu', 'CPU')}
                        value={system.cpuPercent}
                        thresholds={{ warning: 50, critical: 80 }}
                    />
                    <GaugePanel
                        title={t('performance.panels.memory', 'Memory')}
                        value={memoryPercent}
                        subtitle={`${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}`}
                        thresholds={{ warning: 60, critical: 80 }}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.app_memory', 'App Memory (RSS)')}
                        value={formatBytes(system.appMemoryUsedBytes || system.heapUsedBytes)}
                        tooltip={`Heap: ${formatBytes(system.heapUsedBytes)}`}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.event_loop_lag', 'Event Loop Lag')}
                        value={system.eventLoopLagMs}
                        unit="ms"
                        thresholds={{ warning: 50, critical: 100 }}
                    />
                </div>
            </section>

            {/* Row 2: Database Health (RED) */}
            <section className="metrics-section">
                <h2>🗄️ {t('performance.database', 'Database')}</h2>
                <div className="panel-row">
                    <SingleStatPanel
                        title={t('performance.panels.qps', 'QPS')}
                        value={dbQps}
                        unit="/s"
                        sparklineData={dbQpsSparkline}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.latency_p95', 'Latency (P95)')}
                        value={histograms['db.query_duration_seconds']?.p95 * 1000 || 0}
                        unit="ms"
                        thresholds={{ warning: 50, critical: 200 }}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.error_rate', 'Error Rate')}
                        value={dbErrorRate}
                        unit="%"
                        thresholds={{ warning: 0.5, critical: 2 }}
                    />
                </div>
            </section>

            {/* Row 3: OCR Service */}
            <section className="metrics-section">
                <h2>👁️ {t('performance.ocr', 'OCR Service')}</h2>
                <div className="panel-row">
                    <SingleStatPanel
                        title={t('performance.panels.throughput', 'Throughput')}
                        value={ocrRps}
                        unit="/s"
                    />
                    <SingleStatPanel
                        title={t('performance.panels.latency_p95', 'Latency (P95)')}
                        value={histograms['ocr.duration_seconds']?.p95 * 1000 || 0}
                        unit="ms"
                        thresholds={{ warning: 1000, critical: 5000 }}
                    />
                    <GaugePanel
                        title={t('performance.panels.success_rate', 'Success Rate')}
                        value={100 - ocrErrorRate}
                        thresholds={{ warning: 95, critical: 80 }}
                        invertThreshold={true}
                    />
                </div>
            </section>

            {/* Row 4: LLM Service */}
            <section className="metrics-section">
                <h2>🤖 {t('performance.llm', 'LLM Service')}</h2>
                <div className="panel-row">
                    <SingleStatPanel
                        title={t('performance.panels.throughput', 'Throughput')}
                        value={llmRps}
                        unit="/s"
                        sparklineData={llmSparkline}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.latency_p95', 'Latency (P95)')}
                        value={histograms['llm.request_duration_seconds']?.p95 * 1000 || 0}
                        unit="ms"
                        thresholds={{ warning: 3000, critical: 15000 }}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.total_tokens', 'Total Tokens')}
                        value={llmTokensTotal}
                    />
                    <SingleStatPanel
                        title={t('performance.panels.error_rate', 'Error Rate')}
                        value={llmErrorRate}
                        unit="%"
                        thresholds={{ warning: 5, critical: 20 }}
                    />
                </div>
            </section>

            {/* Row 5: Capture Service */}
            <section className="metrics-section">
                <h2>📸 {t('performance.capture', 'Capture')}</h2>
                <div className="panel-row">
                    <SingleStatPanel
                        title={t('performance.panels.frame_rate', 'Frame Rate')}
                        value={captureRate}
                        unit="fps"
                    />
                    <SingleStatPanel
                        title={t('performance.panels.latency_avg', 'Latency (Total Avg)')}
                        value={histograms['capture.duration_seconds']?.avgMs || 0}
                        unit="ms"
                        sparklineData={getSparklineData(history, 'capture.duration_seconds', 20)}
                    />
                    <SingleStatPanel
                        title="Source Latency (OS)"
                        value={histograms['capture.get_sources_duration_seconds']?.avgMs || 0}
                        unit="ms"
                        thresholds={{ warning: 500, critical: 2000 }} // Windows Graphics Capture can be slow
                    />
                    <SingleStatPanel
                        title="Bitmap Process (CPU)"
                        value={histograms['capture.bitmap_processing_duration_seconds']?.avgMs || 0}
                        unit="ms"
                        thresholds={{ warning: 200, critical: 1000 }} // Heavy CPU use
                    />
                    <SingleStatPanel
                        title="Disk I/O"
                        value={histograms['capture.io_duration_seconds']?.avgMs || 0}
                        unit="ms"
                        thresholds={{ warning: 100, critical: 500 }}
                    />
                    <SingleStatPanel
                        title="Watchdog Resets"
                        value={snapshot.counters['capture.watchdog_reset_total'] || 0}
                        unit=""
                        thresholds={{ warning: 1, critical: 5 }}
                    />
                </div>
            </section>

            <footer className="performance-footer">
                <span>
                    {t('performance.lastUpdated', 'Last updated')}: {snapshot.timestamp === 0 ? '--:--:--' : new Date(snapshot.timestamp).toLocaleTimeString()}
                </span>
                <span className="history-count">
                    {t('performance.history', { count: history.length, defaultValue: `History: ${history.length} snapshots` })}
                </span>
            </footer>
        </div>
    );
}

// Helper to determine service status from error rate
function getServiceStatus(
    value: number,
    thresholds: { warning: number; critical: number }
): ServiceStatus {
    if (value >= thresholds.critical) return 'red';
    if (value >= thresholds.warning) return 'yellow';
    return 'green';
}

export default PerformanceDashboard;
