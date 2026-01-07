/**
 * MetricsCollector - Central metrics aggregation following OpenTelemetry principles.
 * 
 * Features:
 * - Counter, Gauge, Histogram metric types
 * - Label cardinality control (whitelist)
 * - Ring buffer for time-series data
 * - P50/P95/P99 percentile calculation
 */

// Allowed labels to prevent cardinality explosion
const ALLOWED_LABELS = ['status', 'provider', 'mode', 'engine', 'error_category', 'source', 'operation', 'table', 'model'] as const;
type AllowedLabel = typeof ALLOWED_LABELS[number];
export type Labels = Partial<Record<AllowedLabel, string>>;

// Default histogram buckets (seconds) - aligned with Prometheus conventions
const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// --- Interfaces ---

interface CounterData {
    value: number;
    labels: Labels;
}

interface GaugeData {
    value: number;
    timestamp: number;
    labels: Labels;
}

interface HistogramData {
    buckets: number[];
    counts: number[];
    sum: number;
    count: number;
    labels: Labels;
}

export interface PerformanceSnapshot {
    timestamp: number;
    system: {
        cpuPercent: number;
        memoryUsedBytes: number;
        memoryTotalBytes: number;
        heapUsedBytes: number;
        eventLoopLagMs: number;
    };
    histograms: {
        [name: string]: {
            p50: number;
            p95: number;
            p99: number;
            count: number;
            avgMs: number;
        };
    };
    counters: {
        [name: string]: number;
    };
    gauges: {
        [name: string]: number;
    };
}

// --- Ring Buffer for time-series ---

class RingBuffer<T> {
    private buffer: T[];
    private head = 0;
    private size = 0;

    constructor(private capacity: number) {
        this.buffer = new Array(capacity);
    }

    push(item: T): void {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    getAll(): T[] {
        if (this.size < this.capacity) {
            return this.buffer.slice(0, this.size);
        }
        // Wrap around: tail to head
        return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
    }

    clear(): void {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.size = 0;
    }

    get length(): number {
        return this.size;
    }
}

// --- MetricsCollector ---

class MetricsCollector {
    private static instance: MetricsCollector;

    // Counters: name -> CounterData
    private counters = new Map<string, CounterData>();

    // Gauges: name -> GaugeData
    private gauges = new Map<string, GaugeData>();

    // Histograms: name -> HistogramData
    private histograms = new Map<string, HistogramData>();

    // Time-series buffer for recent gauge samples (for sparklines)
    private gaugeHistory = new Map<string, RingBuffer<{ ts: number; value: number }>>();
    private readonly HISTORY_SIZE = 60; // 5 min @ 5s interval

    // System metrics (updated by SystemMonitor)
    private systemMetrics = {
        cpuPercent: 0,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        heapUsedBytes: 0,
        eventLoopLagMs: 0,
    };

    private constructor() { }

    public static getInstance(): MetricsCollector {
        if (!MetricsCollector.instance) {
            MetricsCollector.instance = new MetricsCollector();
        }
        return MetricsCollector.instance;
    }

    // --- Label Validation ---
    private validateLabels(labels?: Labels): Labels {
        if (!labels) return {};
        const validated: Labels = {};
        for (const key of Object.keys(labels) as AllowedLabel[]) {
            if (ALLOWED_LABELS.includes(key)) {
                validated[key] = labels[key];
            }
        }
        return validated;
    }

    private makeKey(name: string, labels?: Labels): string {
        if (!labels || Object.keys(labels).length === 0) {
            return name;
        }
        const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
        return `${name}{${sorted.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
    }

    // --- Counter ---
    public incCounter(name: string, labels?: Labels, value: number = 1): void {
        const validLabels = this.validateLabels(labels);
        const key = this.makeKey(name, validLabels);
        const existing = this.counters.get(key);
        if (existing) {
            existing.value += value;
        } else {
            this.counters.set(key, { value, labels: validLabels });
        }
    }

    // --- Gauge ---
    public setGauge(name: string, value: number, labels?: Labels): void {
        const validLabels = this.validateLabels(labels);
        const key = this.makeKey(name, validLabels);
        const ts = Date.now();
        this.gauges.set(key, { value, timestamp: ts, labels: validLabels });

        // Track history
        if (!this.gaugeHistory.has(key)) {
            this.gaugeHistory.set(key, new RingBuffer(this.HISTORY_SIZE));
        }
        this.gaugeHistory.get(key)!.push({ ts, value });
    }

    // --- Histogram ---
    public observeHistogram(name: string, value: number, labels?: Labels, buckets: number[] = DEFAULT_BUCKETS): void {
        const validLabels = this.validateLabels(labels);
        const key = this.makeKey(name, validLabels);

        let hist = this.histograms.get(key);
        if (!hist) {
            hist = {
                buckets: [...buckets],
                counts: new Array(buckets.length + 1).fill(0), // Per-bucket counts (not cumulative)
                sum: 0,
                count: 0,
                labels: validLabels,
            };
            this.histograms.set(key, hist);
        }

        hist.sum += value;
        hist.count++;

        // Find the correct bucket and increment only that one
        let bucketFound = false;
        for (let i = 0; i < hist.buckets.length; i++) {
            if (value <= hist.buckets[i]) {
                hist.counts[i]++;
                bucketFound = true;
                break; // FIX: Only increment the first matching bucket
            }
        }
        // If no bucket matched, it goes to +Inf
        if (!bucketFound) {
            hist.counts[hist.buckets.length]++;
        }
    }

    // --- Timer Helper ---
    public startTimer(name: string, labels?: Labels): { end: () => void } {
        const start = performance.now();
        return {
            end: () => {
                const durationSec = (performance.now() - start) / 1000;
                this.observeHistogram(name, durationSec, labels);
            },
        };
    }

    // --- System Metrics (called by SystemMonitor) ---
    public updateSystemMetrics(metrics: Partial<typeof this.systemMetrics>): void {
        Object.assign(this.systemMetrics, metrics);
    }

    // --- Percentile Calculation ---
    private calculatePercentiles(hist: HistogramData): { p50: number; p95: number; p99: number } {
        const { buckets, counts, count } = hist;
        if (count === 0) return { p50: 0, p95: 0, p99: 0 };

        const getPercentile = (p: number): number => {
            const target = count * p;
            let cumulative = 0;
            for (let i = 0; i < buckets.length; i++) {
                cumulative += counts[i]; // FIX: counts[i] is now per-bucket, so just add it
                if (cumulative >= target) {
                    return buckets[i];
                }
            }
            // If we get here, it's in the +Inf bucket
            return buckets[buckets.length - 1];
        };

        return {
            p50: getPercentile(0.5),
            p95: getPercentile(0.95),
            p99: getPercentile(0.99),
        };
    }

    // --- Snapshot for IPC ---
    public getSnapshot(): PerformanceSnapshot {
        const countersObj: Record<string, number> = {};
        for (const [key, data] of this.counters) {
            countersObj[key] = data.value;
        }

        const gaugesObj: Record<string, number> = {};
        for (const [key, data] of this.gauges) {
            gaugesObj[key] = data.value;
        }

        const histogramsObj: Record<string, { p50: number; p95: number; p99: number; count: number; avgMs: number }> = {};
        for (const [key, data] of this.histograms) {
            const percentiles = this.calculatePercentiles(data);
            histogramsObj[key] = {
                ...percentiles,
                count: data.count,
                avgMs: data.count > 0 ? (data.sum / data.count) * 1000 : 0, // Convert to ms
            };
        }

        return {
            timestamp: Date.now(),
            system: { ...this.systemMetrics },
            counters: countersObj,
            gauges: gaugesObj,
            histograms: histogramsObj,
        };
    }

    // --- Reset (for testing) ---
    public reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.gaugeHistory.clear();
        this.systemMetrics = {
            cpuPercent: 0,
            memoryUsedBytes: 0,
            memoryTotalBytes: 0,
            heapUsedBytes: 0,
            eventLoopLagMs: 0,
        };
    }
}

// --- Exports ---

export const metricsCollector = MetricsCollector.getInstance();

// Convenience re-export for services
export const metrics = {
    incCounter: (name: string, labels?: Labels, value?: number) =>
        metricsCollector.incCounter(name, labels, value),
    setGauge: (name: string, value: number, labels?: Labels) =>
        metricsCollector.setGauge(name, value, labels),
    observeHistogram: (name: string, value: number, labels?: Labels) =>
        metricsCollector.observeHistogram(name, value, labels),
    startTimer: (name: string, labels?: Labels) =>
        metricsCollector.startTimer(name, labels),
    updateSystemMetrics: (m: Parameters<typeof metricsCollector.updateSystemMetrics>[0]) =>
        metricsCollector.updateSystemMetrics(m),
    getSnapshot: () => metricsCollector.getSnapshot(),
    reset: () => metricsCollector.reset(),
};
