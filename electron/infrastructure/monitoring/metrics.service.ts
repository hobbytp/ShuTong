
export interface MetricTags {
    [key: string]: string | number | boolean; // Simplified tags
}

export interface IMetric {
    name: string;
    value: number;
    timestamp: number;
    tags?: MetricTags;
}

export class MetricsService {
    private static instance: MetricsService;
    private metricsBuffer: IMetric[] = [];
    private readonly MAX_BUFFER_SIZE = 1000;

    private constructor() { }

    public static getInstance(): MetricsService {
        if (!MetricsService.instance) {
            MetricsService.instance = new MetricsService();
        }
        return MetricsService.instance;
    }

    public recordDuration(name: string, durationMs: number, tags?: MetricTags) {
        this.addMetric({ name, value: durationMs, timestamp: Date.now(), tags: { ...tags, type: 'duration' } });
    }

    public incrementCounter(name: string, value: number = 1, tags?: MetricTags) {
        this.addMetric({ name, value, timestamp: Date.now(), tags: { ...tags, type: 'counter' } });
    }

    public gauge(name: string, value: number, tags?: MetricTags) {
        this.addMetric({ name, value, timestamp: Date.now(), tags: { ...tags, type: 'gauge' } });
    }

    private addMetric(metric: IMetric) {
        this.metricsBuffer.push(metric);
        if (this.metricsBuffer.length > this.MAX_BUFFER_SIZE) {
            this.metricsBuffer.shift(); // Simple sliding window
        }

        // In the future, this could flush to a local DB or external service
        // For now, we mainly use it for real-time debugging or "perf" logs
        if (metric.tags?.type === 'duration' && metric.value > 2000) {
            console.warn(`[Perf] Slow Operation: ${metric.name} took ${metric.value}ms`, metric.tags);
        }
    }

    public getMetrics(): IMetric[] {
        return [...this.metricsBuffer];
    }

    public clear() {
        this.metricsBuffer = [];
    }
}

export const metrics = MetricsService.getInstance();

/**
 * Utility to measure execution time of a promise
 */
export async function measure<T>(metricName: string, fn: () => Promise<T>, tags?: MetricTags): Promise<T> {
    const start = Date.now();
    try {
        const result = await fn();
        const duration = Date.now() - start;
        metrics.recordDuration(metricName, duration, { ...tags, success: true });
        return result;
    } catch (error) {
        const duration = Date.now() - start;
        metrics.recordDuration(metricName, duration, { ...tags, success: false, error: (error as Error).message });
        throw error;
    }
}
