import { beforeEach, describe, expect, it } from 'vitest';
import { LLMMetricsCollector, getLLMMetrics } from '../../electron/llm/metrics';

describe('LLMMetricsCollector', () => {
    let metrics: LLMMetricsCollector;

    beforeEach(() => {
        metrics = getLLMMetrics();
        metrics.reset();
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance', () => {
            const instance1 = getLLMMetrics();
            const instance2 = getLLMMetrics();
            expect(instance1).toBe(instance2);
        });
    });

    describe('Request Recording', () => {
        it('should record successful requests', () => {
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 100,
                provider: 'OpenAI',
                model: 'gpt-4',
                success: true,
                promptTokens: 50,
                completionTokens: 20
            });

            const summary = metrics.getSummary();
            expect(summary.totalRequests).toBe(1);
            expect(summary.successfulRequests).toBe(1);
            expect(summary.failedRequests).toBe(0);
            expect(summary.averageDurationMs).toBe(100);
            expect(summary.totalPromptTokens).toBe(50);
            expect(summary.totalCompletionTokens).toBe(20);
        });

        it('should record failed requests', () => {
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 50,
                provider: 'Gemini',
                model: 'gemini-pro',
                success: false,
                errorCategory: 'timeout'
            });

            const summary = metrics.getSummary();
            expect(summary.totalRequests).toBe(1);
            expect(summary.successfulRequests).toBe(0);
            expect(summary.failedRequests).toBe(1);
            expect(summary.errorsByCategory.timeout).toBe(1);
        });

        it('should maintain sliding window history', () => {
            // Add 105 requests (limit is 100)
            for (let i = 0; i < 105; i++) {
                metrics.recordRequest({
                    timestamp: Date.now(),
                    durationMs: 10,
                    provider: 'OpenAI',
                    model: 'gpt-3.5',
                    success: true
                });
            }

            const summary = metrics.getSummary();
            expect(summary.totalRequests).toBe(100);
        });
    });

    describe('Error Categorization', () => {
        it('should categorize timeout errors', () => {
            expect(metrics.categorizeError(new Error('timeout'))).toBe('timeout');
            expect(metrics.categorizeError(new Error('AbortError: The operation was aborted'))).toBe('timeout');
        });

        it('should categorize rate limit errors', () => {
            expect(metrics.categorizeError(new Error('429 Too Many Requests'))).toBe('rate_limit');
            expect(metrics.categorizeError(new Error('Rate limit exceeded'))).toBe('rate_limit');
        });

        it('should categorize auth errors', () => {
            expect(metrics.categorizeError(new Error('401 Unauthorized'))).toBe('auth');
            expect(metrics.categorizeError(new Error('Invalid API key'))).toBe('auth');
        });

        it('should categorize server errors', () => {
            expect(metrics.categorizeError(new Error('500 Internal Server Error'))).toBe('server_error');
            expect(metrics.categorizeError(new Error('502 Bad Gateway'))).toBe('server_error');
        });

        it('should categorize network errors', () => {
            expect(metrics.categorizeError(new Error('Network Error'))).toBe('network');
            expect(metrics.categorizeError(new Error('fetch failed'))).toBe('network');
        });

        it('should categorize unknown errors', () => {
            expect(metrics.categorizeError(new Error('Something weird happened'))).toBe('unknown');
            expect(metrics.categorizeError('Just a string error')).toBe('unknown');
        });
    });

    describe('Statistics Calculation', () => {
        it('should calculate percentiles correctly', () => {
            // Add durations: 10, 20, ..., 100
            for (let i = 1; i <= 10; i++) {
                metrics.recordRequest({
                    timestamp: Date.now(),
                    durationMs: i * 10,
                    provider: 'OpenAI',
                    model: 'gpt-3.5',
                    success: true
                });
            }

            const summary = metrics.getSummary();
            // p50 of [10, 20...100] is 50
            expect(summary.p50DurationMs).toBe(50);
            // p95 of 10 items is item at index ceil(0.95*10)-1 = 9 -> 100
            expect(summary.p95DurationMs).toBe(100);
            expect(summary.averageDurationMs).toBe(55); // (10+100)/2 * 10 / 10 = 55
        });

        it('should calculate tokens/second', () => {
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 1000, // 1 second
                provider: 'OpenAI',
                model: 'gpt-3.5',
                success: true,
                completionTokens: 10
            });

            const summary = metrics.getSummary();
            expect(summary.tokensPerSecond).toBe(10);
        });
    });

    describe('Chunk Metrics', () => {
        it('should track chunk metrics for adaptive sizing', () => {
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 1000,
                provider: 'OpenAI',
                model: 'gpt-3.5',
                success: true,
                completionTokens: 50
            });

            const chunkMetrics = metrics.getChunkMetrics();
            expect(chunkMetrics.tokensPerSecondHistory).toHaveLength(1);
            expect(chunkMetrics.tokensPerSecondHistory[0]).toBe(50);
            expect(metrics.getAverageTokensPerSecond()).toBe(50);

            // Update chunk size
            metrics.updateChunkSize(8, 'fast_performance');
            const updated = metrics.getChunkMetrics();
            expect(updated.adjustedSize).toBe(8);
            expect(updated.adjustmentReason).toBe('fast_performance');
        });
    });
});
