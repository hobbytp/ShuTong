/**
 * SystemMonitor - Polls system metrics and pushes to MetricsCollector.
 * 
 * Metrics collected:
 * - CPU usage (via os.cpus() differential)
 * - Memory usage
 * - Heap usage
 * - Event loop lag
 * - Electron process metrics
 */

import { app } from 'electron';
import os from 'os';
import { IntervalHistogram, monitorEventLoopDelay } from 'perf_hooks';
import { metricsCollector } from './metrics-collector';

class SystemMonitor {
    private static instance: SystemMonitor;
    private intervalId: NodeJS.Timeout | null = null;
    private lastCpuInfo: { idle: number; total: number } | null = null;
    private eventLoopMonitor: IntervalHistogram | null = null;

    private readonly POLL_INTERVAL_MS = 5000; // 5 seconds

    private constructor() { }

    public static getInstance(): SystemMonitor {
        if (!SystemMonitor.instance) {
            SystemMonitor.instance = new SystemMonitor();
        }
        return SystemMonitor.instance;
    }

    /**
     * Start collecting system metrics
     */
    public start(): void {
        if (this.intervalId) return; // Already running

        // Initialize event loop monitor
        this.eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
        this.eventLoopMonitor.enable();

        // Initialize CPU baseline
        this.lastCpuInfo = this.getCpuInfo();

        // Start polling
        this.intervalId = setInterval(() => this.collect(), this.POLL_INTERVAL_MS);

        // Collect immediately
        this.collect();

        console.log('[SystemMonitor] Started');
    }

    /**
     * Stop collecting
     */
    public stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.eventLoopMonitor) {
            this.eventLoopMonitor.disable();
            this.eventLoopMonitor = null;
        }
        console.log('[SystemMonitor] Stopped');
    }

    /**
     * Collect all system metrics
     */
    private collect(): void {
        try {
            // CPU
            const cpuPercent = this.calculateCpuPercent();

            // Memory
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            // Heap (Node.js process)
            const memUsage = process.memoryUsage();

            // Event Loop Lag
            let eventLoopLagMs = 0;
            if (this.eventLoopMonitor) {
                // Mean is in nanoseconds
                eventLoopLagMs = this.eventLoopMonitor.mean / 1e6;
                // Reset to get fresh readings for next interval
                this.eventLoopMonitor.reset();
            }

            // Update MetricsCollector
            metricsCollector.updateSystemMetrics({
                cpuPercent,
                memoryUsedBytes: usedMem,
                memoryTotalBytes: totalMem,
                heapUsedBytes: memUsage.heapUsed,
                eventLoopLagMs,
            });

            // Also emit as gauges for consistency
            metricsCollector.setGauge('system.cpu_percent', cpuPercent);
            metricsCollector.setGauge('system.memory_used_bytes', usedMem);
            metricsCollector.setGauge('system.memory_total_bytes', totalMem);
            metricsCollector.setGauge('electron.heap_used_bytes', memUsage.heapUsed);
            metricsCollector.setGauge('electron.rss_bytes', memUsage.rss);
            metricsCollector.setGauge('electron.event_loop_lag_ms', eventLoopLagMs);

            // Electron-specific: Process memory by type
            try {
                const appMetrics = app.getAppMetrics();
                let rendererMemory = 0;
                for (const proc of appMetrics) {
                    if (proc.type === 'GPU') {
                        metricsCollector.setGauge('electron.gpu_memory_bytes', proc.memory.workingSetSize * 1024);
                    }
                    // Handle renderer processes - type can be 'Tab' or 'Browser' depending on Electron version
                    // Note: In newer Electron, type is Utility/Browser/GPU etc.
                    if (proc.type === 'Tab' || proc.type === 'Browser') {
                        rendererMemory += proc.memory.workingSetSize * 1024;
                    }
                }
                if (rendererMemory > 0) {
                    metricsCollector.setGauge('electron.renderer_memory_bytes', rendererMemory);
                }
            } catch (e) {
                // app.getAppMetrics() may not be available in all contexts
            }

        } catch (err) {
            console.error('[SystemMonitor] Collection error:', err);
        }
    }

    /**
     * Calculate CPU percentage using differential of os.cpus()
     */
    private getCpuInfo(): { idle: number; total: number } {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;

        for (const cpu of cpus) {
            idle += cpu.times.idle;
            total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
        }

        return { idle, total };
    }

    private calculateCpuPercent(): number {
        const current = this.getCpuInfo();

        if (!this.lastCpuInfo) {
            this.lastCpuInfo = current;
            return 0;
        }

        const idleDiff = current.idle - this.lastCpuInfo.idle;
        const totalDiff = current.total - this.lastCpuInfo.total;

        this.lastCpuInfo = current;

        if (totalDiff === 0) return 0;

        const cpuPercent = 100 - (idleDiff / totalDiff) * 100;
        return Math.round(cpuPercent * 100) / 100; // 2 decimal places
    }
}

// Export singleton
export const systemMonitor = SystemMonitor.getInstance();
