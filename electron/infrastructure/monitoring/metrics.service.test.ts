
import { beforeEach, describe, expect, it } from 'vitest';
import { MetricsService, metrics } from './metrics.service';

describe('MetricsService', () => {
    beforeEach(() => {
        metrics.clear();
    });

    it('should be a singleton', () => {
        const instance1 = MetricsService.getInstance();
        const instance2 = MetricsService.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should record duration metrics', () => {
        const name = 'test.duration';
        const value = 100;
        metrics.recordDuration(name, value, { test: true });

        const recorded = metrics.getRecent(name);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
            name,
            value,
            tags: { test: true, type: 'duration' }
        });
        expect(recorded[0].timestamp).toBeDefined();
    });

    it('should record counter metrics', () => {
        const name = 'test.counter';
        metrics.incrementCounter(name, 5);

        const recorded = metrics.getRecent(name);
        expect(recorded).toHaveLength(1);
        expect(recorded[0].value).toBe(5);
        expect(recorded[0].tags?.type).toBe('counter');
    });

    it('should record gauge metrics', () => {
        const name = 'test.gauge';
        metrics.gauge(name, 42);

        const recorded = metrics.getRecent(name);
        expect(recorded).toHaveLength(1);
        expect(recorded[0].value).toBe(42);
        expect(recorded[0].tags?.type).toBe('gauge');
    });

    it('should respect max buffer size (circular buffer)', () => {
        const name = 'test.overflow';
        const MAX_SIZE = 1000; // From implementation
        const OVERFLOW = 10;

        for (let i = 0; i < MAX_SIZE + OVERFLOW; i++) {
            metrics.incrementCounter(name, i);
        }

        const allMetrics = metrics.getMetrics();
        expect(allMetrics).toHaveLength(MAX_SIZE);

        // Should have shifted out the first 10, so first item should be index 10
        expect(allMetrics[0].value).toBe(OVERFLOW);
        expect(allMetrics[MAX_SIZE - 1].value).toBe(MAX_SIZE + OVERFLOW - 1);
    });

    it('getRecent should return limited number of items', () => {
        const name = 'test.recent';
        for (let i = 0; i < 20; i++) {
            metrics.incrementCounter(name, i);
        }

        const recent = metrics.getRecent(name, 5);
        expect(recent).toHaveLength(5);
        // Should be the last 5
        expect(recent[0].value).toBe(15);
        expect(recent[4].value).toBe(19);
    });

    it('getRecent should return empty array if name not found', () => {
        const recent = metrics.getRecent('non.existent');
        expect(recent).toEqual([]);
    });

    it('getRecent should filter by name correctly', () => {
        metrics.incrementCounter('metric.a', 1);
        metrics.incrementCounter('metric.b', 2);
        metrics.incrementCounter('metric.a', 3);

        const recentA = metrics.getRecent('metric.a');
        expect(recentA).toHaveLength(2);
        expect(recentA.map(m => m.value)).toEqual([1, 3]);

        const recentB = metrics.getRecent('metric.b');
        expect(recentB).toHaveLength(1);
        expect(recentB[0].value).toBe(2);
    });
});
