/**
 * MetricsCollector Unit Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics, metricsCollector } from '../infrastructure/monitoring/metrics-collector';

describe('MetricsCollector', () => {
    beforeEach(() => {
        metricsCollector.reset();
    });

    describe('Counter', () => {
        it('should increment counter by 1 by default', () => {
            metrics.incCounter('test.counter');
            const snapshot = metrics.getSnapshot();
            expect(snapshot.counters['test.counter']).toBe(1);
        });

        it('should increment counter by custom value', () => {
            metrics.incCounter('test.counter', undefined, 5);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.counters['test.counter']).toBe(5);
        });

        it('should accumulate counter values', () => {
            metrics.incCounter('test.counter');
            metrics.incCounter('test.counter');
            metrics.incCounter('test.counter', undefined, 3);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.counters['test.counter']).toBe(5);
        });

        it('should separate counters by labels', () => {
            metrics.incCounter('http.requests', { status: 'success' });
            metrics.incCounter('http.requests', { status: 'error' });
            metrics.incCounter('http.requests', { status: 'success' });
            const snapshot = metrics.getSnapshot();
            expect(snapshot.counters['http.requests{status="success"}']).toBe(2);
            expect(snapshot.counters['http.requests{status="error"}']).toBe(1);
        });

        it('should filter out invalid labels', () => {
            // @ts-expect-error - testing invalid label
            metrics.incCounter('test.counter', { invalid_label: 'value', status: 'ok' });
            const snapshot = metrics.getSnapshot();
            // Only 'status' should be kept
            expect(snapshot.counters['test.counter{status="ok"}']).toBe(1);
            expect(snapshot.counters['test.counter{invalid_label="value"}']).toBeUndefined();
        });
    });

    describe('Gauge', () => {
        it('should set gauge value', () => {
            metrics.setGauge('cpu.percent', 45.5);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.gauges['cpu.percent']).toBe(45.5);
        });

        it('should overwrite gauge value', () => {
            metrics.setGauge('memory.used', 100);
            metrics.setGauge('memory.used', 200);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.gauges['memory.used']).toBe(200);
        });

        it('should separate gauges by labels', () => {
            metrics.setGauge('queue.depth', 5, { engine: 'ocr' });
            metrics.setGauge('queue.depth', 10, { engine: 'llm' });
            const snapshot = metrics.getSnapshot();
            expect(snapshot.gauges['queue.depth{engine="ocr"}']).toBe(5);
            expect(snapshot.gauges['queue.depth{engine="llm"}']).toBe(10);
        });
    });

    describe('Histogram', () => {
        it('should record single observation', () => {
            metrics.observeHistogram('request.duration', 0.5);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.histograms['request.duration'].count).toBe(1);
        });

        it('should calculate correct percentiles for uniform distribution', () => {
            // Add values that span multiple buckets
            // Default buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
            for (let i = 0; i < 100; i++) {
                metrics.observeHistogram('latency', 0.3); // All in 0.5 bucket
            }
            const snapshot = metrics.getSnapshot();
            expect(snapshot.histograms['latency'].p50).toBe(0.5); // Bucket containing 0.3
            expect(snapshot.histograms['latency'].p95).toBe(0.5);
            expect(snapshot.histograms['latency'].p99).toBe(0.5);
        });

        it('should calculate average correctly', () => {
            metrics.observeHistogram('test', 1);
            metrics.observeHistogram('test', 2);
            metrics.observeHistogram('test', 3);
            const snapshot = metrics.getSnapshot();
            // Average of 1, 2, 3 = 2s = 2000ms
            expect(snapshot.histograms['test'].avgMs).toBe(2000);
        });

        it('should place values in correct bucket', () => {
            // Add value that goes to +Inf bucket (> 30s)
            metrics.observeHistogram('slow.request', 60);
            const snapshot = metrics.getSnapshot();
            expect(snapshot.histograms['slow.request'].count).toBe(1);
            // P99 should be the last bucket since it's in +Inf
            expect(snapshot.histograms['slow.request'].p99).toBe(30);
        });

        it('should separate histograms by labels', () => {
            metrics.observeHistogram('api.latency', 0.1, { provider: 'openai' });
            metrics.observeHistogram('api.latency', 0.2, { provider: 'anthropic' });
            const snapshot = metrics.getSnapshot();
            expect(snapshot.histograms['api.latency{provider="openai"}'].count).toBe(1);
            expect(snapshot.histograms['api.latency{provider="anthropic"}'].count).toBe(1);
        });
    });

    describe('Timer', () => {
        it('should measure duration with fake timers', () => {
            vi.useFakeTimers();
            const timer = metrics.startTimer('operation.duration');
            vi.advanceTimersByTime(100); // Advance 100ms
            timer.end();
            vi.useRealTimers();

            const snapshot = metrics.getSnapshot();
            expect(snapshot.histograms['operation.duration'].count).toBe(1);
            // avgMs should be ~100ms (0.1s * 1000)
            expect(snapshot.histograms['operation.duration'].avgMs).toBeGreaterThanOrEqual(90);
            expect(snapshot.histograms['operation.duration'].avgMs).toBeLessThanOrEqual(110);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty labels object', () => {
            metrics.incCounter('test.counter', {});
            const snapshot = metrics.getSnapshot();
            expect(snapshot.counters['test.counter']).toBe(1);
        });

        it('should handle all invalid labels', () => {
            // @ts-expect-error - testing all invalid labels
            metrics.incCounter('test.counter', { foo: 'bar', baz: 'qux' });
            const snapshot = metrics.getSnapshot();
            // Should still create counter with no labels
            expect(snapshot.counters['test.counter']).toBe(1);
        });

        it('should handle multiple labels sorted alphabetically', () => {
            metrics.incCounter('test.counter', { status: 'ok', provider: 'openai', mode: 'fast' });
            const snapshot = metrics.getSnapshot();
            // Labels should be sorted: mode, provider, status
            expect(snapshot.counters['test.counter{mode=\"fast\",provider=\"openai\",status=\"ok\"}']).toBe(1);
        });
    });

    describe('System Metrics', () => {
        it('should update system metrics', () => {
            metrics.updateSystemMetrics({
                cpuPercent: 75.5,
                memoryUsedBytes: 1024 * 1024 * 500,
                eventLoopLagMs: 15,
            });

            const snapshot = metrics.getSnapshot();
            expect(snapshot.system.cpuPercent).toBe(75.5);
            expect(snapshot.system.memoryUsedBytes).toBe(1024 * 1024 * 500);
            expect(snapshot.system.eventLoopLagMs).toBe(15);
        });
    });

    describe('Reset', () => {
        it('should clear all metrics on reset', () => {
            metrics.incCounter('counter');
            metrics.setGauge('gauge', 100);
            metrics.observeHistogram('histogram', 1);

            metrics.reset();

            const snapshot = metrics.getSnapshot();
            expect(Object.keys(snapshot.counters)).toHaveLength(0);
            expect(Object.keys(snapshot.gauges)).toHaveLength(0);
            expect(Object.keys(snapshot.histograms)).toHaveLength(0);
            expect(snapshot.system.cpuPercent).toBe(0);
        });
    });

    describe('Snapshot', () => {
        it('should include timestamp', () => {
            const before = Date.now();
            const snapshot = metrics.getSnapshot();
            const after = Date.now();

            expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
            expect(snapshot.timestamp).toBeLessThanOrEqual(after);
        });
    });
});
