
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsService, measure } from './metrics.service';

describe('MetricsService', () => {
    let metrics: MetricsService;

    beforeEach(() => {
        // Access singleton
        metrics = MetricsService.getInstance();
        metrics.clear();
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should be a singleton', () => {
        const m1 = MetricsService.getInstance();
        const m2 = MetricsService.getInstance();
        expect(m1).toBe(m2);
    });

    it('should record duration', () => {
        metrics.recordDuration('test.duration', 100, { foo: 'bar' });
        const all = metrics.getMetrics();
        expect(all).toHaveLength(1);
        expect(all[0]).toEqual(expect.objectContaining({
            name: 'test.duration',
            value: 100,
            tags: { foo: 'bar', type: 'duration' }
        }));
    });

    it('should increment counter', () => {
        metrics.incrementCounter('test.count', 1);
        metrics.incrementCounter('test.count', 2);

        const all = metrics.getMetrics();
        expect(all).toHaveLength(2);
        expect(all[1].value).toBe(2);
        expect(all[1].tags?.type).toBe('counter');
    });

    it('should log warning for slow duration', () => {
        const spy = vi.spyOn(console, 'warn');
        metrics.recordDuration('slow.op', 2500);

        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining('[Perf] Slow Operation: slow.op took 2500ms'),
            expect.anything()
        );
    });

    it('should maintain buffer size limit', () => {
        const limit = 1000; // From implementation
        for (let i = 0; i < limit + 50; i++) {
            metrics.incrementCounter('test', i);
        }
        expect(metrics.getMetrics()).toHaveLength(limit);
        // Should have shifted out the first 50
        expect(metrics.getMetrics()[0].value).toBe(50);
    });
});

describe('measure() utility', () => {
    beforeEach(() => {
        MetricsService.getInstance().clear();
    });

    it('should measure execution time of successful promise', async () => {
        const fn = async () => {
            await new Promise(r => setTimeout(r, 100));
            return 'success';
        };

        const result = await measure('test.fn', fn, { tag: '1' });
        expect(result).toBe('success');

        const m = MetricsService.getInstance().getMetrics();
        expect(m).toHaveLength(1);
        expect(m[0].name).toBe('test.fn');
        expect(m[0].value).toBeGreaterThanOrEqual(100);
        expect(m[0].tags?.success).toBe(true);
    });

    it('should measure execution time of failed promise and rethrow', async () => {
        const fn = async () => {
            await new Promise(r => setTimeout(r, 50));
            throw new Error('boom');
        };

        await expect(measure('test.fail', fn)).rejects.toThrow('boom');

        const m = MetricsService.getInstance().getMetrics();
        expect(m).toHaveLength(1);
        expect(m[0].name).toBe('test.fail');
        expect(m[0].tags?.success).toBe(false);
        expect(m[0].tags?.error).toBe('boom');
    });
});
