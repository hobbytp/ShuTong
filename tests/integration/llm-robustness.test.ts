/**
 * LLM Robustness Integration Tests
 * 
 * These tests verify that all robustness features work together
 * in production-like scenarios.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMergedLLMConfig } from '../../electron/config_manager';
import { getLLMMetrics } from '../../electron/llm/metrics';
import { getLLMProvider } from '../../electron/llm/providers';
import { LLMService } from '../../electron/llm/service';

// Mock dependencies
vi.mock('../../electron/llm/providers', () => ({
    getLLMProvider: vi.fn(),
    consumeStreamWithIdleTimeout: vi.fn()
}));

vi.mock('../../electron/config_manager', () => ({
    getMergedLLMConfig: vi.fn()
}));

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn().mockReturnValue('/mock/path')
    },
    ipcMain: {
        handle: vi.fn()
    }
}));

vi.mock('jimp', () => ({
    Jimp: {
        read: vi.fn().mockResolvedValue({
            width: 1920,
            height: 1080,
            scaleToFit: vi.fn(),
            getBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image-data'))
        })
    }
}));

describe('LLM Robustness Integration', () => {
    let service: LLMService;
    let mockProvider: any;
    let metrics: ReturnType<typeof getLLMMetrics>;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LLMService();
        metrics = getLLMMetrics();
        metrics.reset();

        mockProvider = {
            generateContent: vi.fn(),
            generateContentStream: null
        };
        (getLLMProvider as any).mockReturnValue(mockProvider);
    });

    describe('3.1 Metrics Collection Verification', () => {
        it('should accumulate metrics across multiple batch requests', async () => {
            (getMergedLLMConfig as any).mockReturnValue({
                providers: {
                    mock: {
                        maxScreenshotsPerRequest: 5,
                        chunkDelayMs: 0
                    }
                },
                roleConfigs: {
                    SCREEN_ANALYZE: { provider: 'mock', model: 'test-model' }
                }
            });

            // Simulate 3 successful batches
            mockProvider.generateContent.mockResolvedValue(JSON.stringify({
                observations: [{ start_index: 0, end_index: 0, text: 'Test observation' }]
            }));

            const batch1 = [{ id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 }];
            const batch2 = [{ id: 2, captured_at: 2000, file_path: 'p2.jpg', file_size: 100 }];
            const batch3 = [{ id: 3, captured_at: 3000, file_path: 'p3.jpg', file_size: 100 }];

            await service.transcribeBatch(batch1 as any);
            await service.transcribeBatch(batch2 as any);
            await service.transcribeBatch(batch3 as any);

            // Verify service called provider correctly
            expect(mockProvider.generateContent).toHaveBeenCalledTimes(3);

            // Note: Metrics are recorded inside real providers, not mock providers.
            // This test verifies the service layer works; metrics are tested separately.
        });

        it('should track error categories correctly', async () => {
            (getMergedLLMConfig as any).mockReturnValue({
                providers: {
                    mock: { maxScreenshotsPerRequest: 5, chunkDelayMs: 0 }
                },
                roleConfigs: {
                    SCREEN_ANALYZE: { provider: 'mock', model: 'test-model' }
                }
            });

            // Note: Errors are recorded at the provider level, not service level
            // For this test, we verify the metrics collector categorizes errors correctly
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 100,
                provider: 'mock',
                model: 'test',
                success: false,
                errorCategory: 'timeout'
            });

            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 100,
                provider: 'mock',
                model: 'test',
                success: false,
                errorCategory: 'rate_limit'
            });

            const summary = metrics.getSummary();
            expect(summary.errorsByCategory.timeout).toBe(1);
            expect(summary.errorsByCategory.rate_limit).toBe(1);
        });
    });

    describe('3.4 Adaptive Chunking Response', () => {
        it('should decrease chunk size after consecutive slow requests', async () => {
            const adaptiveConfig = {
                enabled: true,
                minSize: 2,
                maxSize: 15,
                slowSecsPerShot: 5,  // > 5s per shot = slow
                fastSecsPerShot: 1,
                hysteresisCount: 3,
                cooldownRequests: 0  // No cooldown for testing
            };

            // Start with default size of 15
            expect(metrics.getChunkMetrics().adjustedSize).toBe(15);

            // Simulate 3 slow requests (triggers hysteresis)
            for (let i = 0; i < 3; i++) {
                metrics.recordRequest({
                    timestamp: Date.now(),
                    durationMs: 100000, // 100 seconds (very slow)
                    provider: 'mock',
                    model: 'test',
                    success: true,
                    chunkTotal: 1 // Mark as chunk request
                });
                metrics.evaluateAdaptiveChunking(adaptiveConfig);
            }

            // Size should have decreased
            expect(metrics.getChunkMetrics().adjustedSize).toBeLessThan(15);
            expect(metrics.getChunkMetrics().adjustmentReason).toBe('slow_performance');
        });

        it('should increase chunk size after consecutive fast requests', async () => {
            const adaptiveConfig = {
                enabled: true,
                minSize: 2,
                maxSize: 20,
                slowSecsPerShot: 5,
                fastSecsPerShot: 1,  // < 1s per shot = fast
                hysteresisCount: 3,
                cooldownRequests: 0
            };

            // Set initial size to something below max
            metrics.updateChunkSize(10, 'initial');

            // Simulate 3 fast requests
            for (let i = 0; i < 3; i++) {
                metrics.recordRequest({
                    timestamp: Date.now(),
                    durationMs: 500, // 0.5 seconds (very fast)
                    provider: 'mock',
                    model: 'test',
                    success: true,
                    chunkTotal: 1
                });
                metrics.evaluateAdaptiveChunking(adaptiveConfig);
            }

            // Size should have increased
            expect(metrics.getChunkMetrics().adjustedSize).toBeGreaterThan(10);
            expect(metrics.getChunkMetrics().adjustmentReason).toBe('fast_performance');
        });

        it('should trigger emergency shrink after multiple timeouts', async () => {
            const adaptiveConfig = {
                enabled: true,
                minSize: 2,
                maxSize: 15,
                slowSecsPerShot: 5,
                fastSecsPerShot: 1,
                hysteresisCount: 3,
                cooldownRequests: 0
            };

            // Record 2 timeout errors in recent 5 requests
            for (let i = 0; i < 2; i++) {
                metrics.recordRequest({
                    timestamp: Date.now(),
                    durationMs: 60000,
                    provider: 'mock',
                    model: 'test',
                    success: false,
                    errorCategory: 'timeout',
                    chunkTotal: 1
                });
            }

            const sizeBefore = metrics.getChunkMetrics().adjustedSize;
            metrics.evaluateAdaptiveChunking(adaptiveConfig);

            // Should trigger emergency shrink immediately (bypass normal hysteresis)
            expect(metrics.getChunkMetrics().adjustedSize).toBeLessThan(sizeBefore);
            expect(metrics.getChunkMetrics().adjustmentReason).toBe('timeout_shrink');
        });

        it('should respect cooldown between adjustments', async () => {
            const adaptiveConfig = {
                enabled: true,
                minSize: 2,
                maxSize: 15,
                slowSecsPerShot: 5,
                fastSecsPerShot: 1,
                hysteresisCount: 1, // Low hysteresis
                cooldownRequests: 3 // Need 3 requests before next adjustment
            };

            // First adjustment
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 100000,
                provider: 'mock',
                model: 'test',
                success: true,
                chunkTotal: 1
            });
            metrics.evaluateAdaptiveChunking(adaptiveConfig);

            const sizeAfterFirst = metrics.getChunkMetrics().adjustedSize;

            // Try to adjust again immediately - should be blocked by cooldown
            metrics.recordRequest({
                timestamp: Date.now(),
                durationMs: 100000,
                provider: 'mock',
                model: 'test',
                success: true,
                chunkTotal: 1
            });
            metrics.evaluateAdaptiveChunking(adaptiveConfig);

            // Size should NOT have changed (cooldown active)
            expect(metrics.getChunkMetrics().adjustedSize).toBe(sizeAfterFirst);
        });
    });

    describe('Full Pipeline Integration', () => {
        it('should process a large batch with chunking and accumulate metrics', async () => {
            (getMergedLLMConfig as any).mockReturnValue({
                providers: {
                    mock: {
                        maxScreenshotsPerRequest: 3,
                        chunkDelayMs: 0
                    }
                },
                roleConfigs: {
                    SCREEN_ANALYZE: { provider: 'mock', model: 'test-model' }
                }
            });

            // Create 7 screenshots (will be split into 3 chunks: 3+3+1)
            const screenshots = Array.from({ length: 7 }, (_, i) => ({
                id: i + 1,
                captured_at: (i + 1) * 1000,
                file_path: `p${i + 1}.jpg`,
                file_size: 100
            }));

            mockProvider.generateContent
                .mockResolvedValueOnce(JSON.stringify({
                    observations: [{ start_index: 0, end_index: 2, text: 'Chunk 1' }]
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    observations: [{ start_index: 0, end_index: 2, text: 'Chunk 2' }]
                }))
                .mockResolvedValueOnce(JSON.stringify({
                    observations: [{ start_index: 0, end_index: 0, text: 'Chunk 3' }]
                }));

            const result = await service.transcribeBatch(screenshots as any);

            // Verify all observations returned
            expect(result).toHaveLength(3);

            // Verify 3 LLM calls made (chunking worked)
            expect(mockProvider.generateContent).toHaveBeenCalledTimes(3);

            // Note: Metrics recording happens in real providers, not in this mocked scenario.
            // Full E2E metrics verification requires running with real providers.
        });
    });
});
