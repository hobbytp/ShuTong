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
import type { AdaptiveChunkingConfig } from '../config_manager';

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
    adjustmentReason?: 'slow_performance' | 'fast_performance' | 'timeout_shrink' | 'initial';
    consecutiveSlowCount: number;
    consecutiveFastCount: number;
    cooldownRemaining: number;
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
        adjustedSize: 15, // default chunk size (matches maxSize default)
        adjustmentReason: 'initial',
        consecutiveSlowCount: 0,
        consecutiveFastCount: 0,
        cooldownRemaining: 0
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

        // (Note: tokensPerSecond tracking removed - now using duration-based adaptive logic)

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
     * Get average tokens per second from recent requests (deprecated, kept for summary API).
     */
    public getAverageTokensPerSecond(): number {
        // Calculate from recent successful requests with token info
        const recentWithTokens = this.requestHistory
            .filter(r => r.success && r.completionTokens && r.durationMs > 0)
            .slice(-10);

        if (recentWithTokens.length === 0) return 0;

        const totalTps = recentWithTokens.reduce(
            (sum, r) => sum + (r.completionTokens! / r.durationMs) * 1000,
            0
        );
        return totalTps / recentWithTokens.length;
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
            adjustedSize: 15,
            adjustmentReason: 'initial',
            consecutiveSlowCount: 0,
            consecutiveFastCount: 0,
            cooldownRemaining: 0
        };
    }

    /**
     * Evaluate and adjust chunk size based on performance.
     * Uses hysteresis and cooldown to prevent oscillation.
     */
    public evaluateAdaptiveChunking(config: AdaptiveChunkingConfig): void {
        if (!config.enabled) return;

        // Apply defaults
        const minSize = config.minSize ?? 2;
        const maxSize = config.maxSize ?? 15;
        const slowThreshold = config.slowSecsPerShot ?? 8;
        const fastThreshold = config.fastSecsPerShot ?? 2;
        const hysteresisCount = config.hysteresisCount ?? 3;
        const cooldownRequests = config.cooldownRequests ?? 5;

        // Check cooldown
        if (this.chunkMetrics.cooldownRemaining > 0) {
            this.chunkMetrics.cooldownRemaining--;
            return;
        }

        // Check for timeout-triggered shrink (bypass normal evaluation)
        const recent5 = this.requestHistory.slice(-5);
        const timeoutCount = recent5.filter(r => !r.success && r.errorCategory === 'timeout').length;
        if (timeoutCount >= 2) {
            const newSize = Math.max(minSize, this.chunkMetrics.adjustedSize - 2);
            if (newSize !== this.chunkMetrics.adjustedSize) {
                this.updateChunkSize(newSize, 'timeout_shrink');
                this.chunkMetrics.cooldownRemaining = cooldownRequests;
                this.chunkMetrics.consecutiveSlowCount = 0;
                this.chunkMetrics.consecutiveFastCount = 0;
            }
            return;
        }

        // Normal evaluation using secsPerShot
        const avgSecsPerShot = this.getAverageSecsPerShot();
        if (avgSecsPerShot === 0) return; // Not enough data

        // Hysteresis tracking
        if (avgSecsPerShot > slowThreshold) {
            this.chunkMetrics.consecutiveSlowCount++;
            this.chunkMetrics.consecutiveFastCount = 0;
        } else if (avgSecsPerShot < fastThreshold) {
            this.chunkMetrics.consecutiveFastCount++;
            this.chunkMetrics.consecutiveSlowCount = 0;
        } else {
            // In normal range, reset both counters
            this.chunkMetrics.consecutiveSlowCount = 0;
            this.chunkMetrics.consecutiveFastCount = 0;
        }

        // Apply adjustment if hysteresis threshold reached
        if (this.chunkMetrics.consecutiveSlowCount >= hysteresisCount) {
            const newSize = Math.max(minSize, this.chunkMetrics.adjustedSize - 2);
            if (newSize !== this.chunkMetrics.adjustedSize) {
                this.updateChunkSize(newSize, 'slow_performance');
                this.chunkMetrics.cooldownRemaining = cooldownRequests;
            }
            this.chunkMetrics.consecutiveSlowCount = 0;
        } else if (this.chunkMetrics.consecutiveFastCount >= hysteresisCount) {
            const newSize = Math.min(maxSize, this.chunkMetrics.adjustedSize + 1);
            if (newSize !== this.chunkMetrics.adjustedSize) {
                this.updateChunkSize(newSize, 'fast_performance');
                this.chunkMetrics.cooldownRemaining = cooldownRequests;
            }
            this.chunkMetrics.consecutiveFastCount = 0;
        }
    }

    /**
     * Calculate average seconds per screenshot from recent successful requests.
     */
    private getAverageSecsPerShot(): number {
        // Get recent successful requests that have chunk info
        const recent = this.requestHistory
            .filter(r => r.success && r.chunkTotal !== undefined)
            .slice(-10);

        if (recent.length === 0) return 0;

        // Use adjustedSize as estimate for screenshots per request
        const totalSecs = recent.reduce((sum, r) => sum + r.durationMs / 1000, 0);
        return totalSecs / recent.length / this.chunkMetrics.adjustedSize;
    }
}

// Export singleton instance getter
export const getLLMMetrics = (): LLMMetricsCollector => LLMMetricsCollector.getInstance();
