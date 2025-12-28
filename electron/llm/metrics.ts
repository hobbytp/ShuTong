/**
 * LLM Metrics Collector
 * 
 * Provides observability for LLM requests including:
 * - Request duration tracking (P50, P95, P99 histograms)
 * - Error categorization and counting
 * - Token throughput monitoring
 * - Chunk statistics for batch processing
 */

// Re-export types from shared contract for consistency
export type { LLMErrorCategory, LLMMetricsSummary } from '../../shared/ipc-contract';
import type { LLMErrorCategory, LLMMetricsSummary } from '../../shared/ipc-contract';

export interface LLMRequestMetric {
    timestamp: number;
    durationMs: number;
    provider: string;
    model: string;
    success: boolean;
    errorCategory?: LLMErrorCategory;
    promptTokens?: number;
    completionTokens?: number;
    chunkIndex?: number;
    chunkTotal?: number;
}

export interface ChunkMetrics {
    adjustedSize: number;
    adjustmentReason?: 'slow_performance' | 'fast_performance' | 'initial';
    tokensPerSecondHistory: number[];
}

/**
 * In-memory metrics collector for LLM requests.
 * Implements a sliding window for historical metrics.
 */
export class LLMMetricsCollector {
    private static instance: LLMMetricsCollector;

    // Sliding window of metrics (keep last N requests)
    private readonly maxHistorySize = 100;
    private requestHistory: LLMRequestMetric[] = [];

    // Counters
    private errorCounts: Record<LLMErrorCategory, number> = {
        timeout: 0,
        rate_limit: 0,
        auth: 0,
        server_error: 0,
        network: 0,
        unknown: 0
    };

    // Token counters
    private totalPromptTokens = 0;
    private totalCompletionTokens = 0;

    // Chunk metrics for adaptive chunking
    private chunkMetrics: ChunkMetrics = {
        adjustedSize: 5, // default chunk size
        adjustmentReason: 'initial',
        tokensPerSecondHistory: []
    };

    private constructor() {
        // Singleton
    }

    public static getInstance(): LLMMetricsCollector {
        if (!LLMMetricsCollector.instance) {
            LLMMetricsCollector.instance = new LLMMetricsCollector();
        }
        return LLMMetricsCollector.instance;
    }

    /**
     * Record a completed LLM request
     */
    public recordRequest(metric: LLMRequestMetric): void {
        // Add to history with sliding window
        this.requestHistory.push(metric);
        if (this.requestHistory.length > this.maxHistorySize) {
            this.requestHistory.shift();
        }

        // Update error counts
        if (!metric.success && metric.errorCategory) {
            this.errorCounts[metric.errorCategory]++;
        }

        // Update token counts
        if (metric.promptTokens) {
            this.totalPromptTokens += metric.promptTokens;
        }
        if (metric.completionTokens) {
            this.totalCompletionTokens += metric.completionTokens;
        }

        // Update tokens/second history for adaptive chunking
        if (metric.success && metric.durationMs > 0 && metric.completionTokens) {
            const tokensPerSecond = (metric.completionTokens / metric.durationMs) * 1000;
            this.chunkMetrics.tokensPerSecondHistory.push(tokensPerSecond);
            if (this.chunkMetrics.tokensPerSecondHistory.length > 10) {
                this.chunkMetrics.tokensPerSecondHistory.shift();
            }
        }

        // Log structured metric
        console.log('[LLMMetrics]', {
            provider: metric.provider,
            model: metric.model,
            durationMs: metric.durationMs,
            success: metric.success,
            errorCategory: metric.errorCategory,
            tokens: metric.promptTokens && metric.completionTokens
                ? `${metric.promptTokens}/${metric.completionTokens}`
                : undefined,
            chunk: metric.chunkIndex !== undefined
                ? `${metric.chunkIndex + 1}/${metric.chunkTotal}`
                : undefined
        });
    }

    /**
     * Categorize an error into a standard category
     */
    public categorizeError(error: Error | unknown): LLMErrorCategory {
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

        if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
            return 'timeout';
        }
        if (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('too many')) {
            return 'rate_limit';
        }
        if (errorMessage.includes('auth') || errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('api key')) {
            return 'auth';
        }
        if (errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503') || errorMessage.includes('504')) {
            return 'server_error';
        }
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('econnrefused')) {
            return 'network';
        }
        return 'unknown';
    }

    /**
     * Get summary statistics
     */
    public getSummary(): LLMMetricsSummary {
        const successful = this.requestHistory.filter(r => r.success);
        const failed = this.requestHistory.filter(r => !r.success);
        const durations = this.requestHistory.map(r => r.durationMs).sort((a, b) => a - b);

        const percentile = (arr: number[], p: number): number => {
            if (arr.length === 0) return 0;
            const idx = Math.ceil((p / 100) * arr.length) - 1;
            return arr[Math.max(0, idx)];
        };

        const avgDuration = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;

        // Calculate tokens per second from recent successful requests
        const recentWithTokens = successful
            .filter(r => r.completionTokens && r.durationMs > 0)
            .slice(-10);

        const tokensPerSecond = recentWithTokens.length > 0
            ? recentWithTokens.reduce((sum, r) => sum + (r.completionTokens! / r.durationMs) * 1000, 0) / recentWithTokens.length
            : 0;

        return {
            totalRequests: this.requestHistory.length,
            successfulRequests: successful.length,
            failedRequests: failed.length,
            errorsByCategory: { ...this.errorCounts },
            averageDurationMs: Math.round(avgDuration),
            p50DurationMs: percentile(durations, 50),
            p95DurationMs: percentile(durations, 95),
            p99DurationMs: percentile(durations, 99),
            totalPromptTokens: this.totalPromptTokens,
            totalCompletionTokens: this.totalCompletionTokens,
            tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
            lastUpdated: Date.now()
        };
    }

    /**
     * Get current chunk metrics for adaptive chunking
     */
    public getChunkMetrics(): ChunkMetrics {
        return { ...this.chunkMetrics };
    }

    /**
     * Update chunk size based on performance (called by adaptive chunking logic)
     */
    public updateChunkSize(newSize: number, reason: ChunkMetrics['adjustmentReason']): void {
        this.chunkMetrics.adjustedSize = newSize;
        this.chunkMetrics.adjustmentReason = reason;
        console.log('[LLMMetrics] Chunk size adjusted:', { newSize, reason });
    }

    /**
     * Get average tokens per second from history
     */
    public getAverageTokensPerSecond(): number {
        const history = this.chunkMetrics.tokensPerSecondHistory;
        if (history.length === 0) return 0;
        return history.reduce((a, b) => a + b, 0) / history.length;
    }

    /**
     * Reset all metrics (useful for testing)
     */
    public reset(): void {
        this.requestHistory = [];
        this.errorCounts = {
            timeout: 0,
            rate_limit: 0,
            auth: 0,
            server_error: 0,
            network: 0,
            unknown: 0
        };
        this.totalPromptTokens = 0;
        this.totalCompletionTokens = 0;
        this.chunkMetrics = {
            adjustedSize: 5,
            adjustmentReason: 'initial',
            tokensPerSecondHistory: []
        };
    }
}

// Export singleton instance getter
export const getLLMMetrics = (): LLMMetricsCollector => LLMMetricsCollector.getInstance();
