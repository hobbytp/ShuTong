import { describe, expect, it, vi } from 'vitest';

// Mock storage BEFORE importing analysis to prevent side-effects from storage.ts
vi.mock('../electron/storage', () => ({
    fetchUnprocessedScreenshots: vi.fn(),
    saveBatchWithScreenshots: vi.fn(),
    updateBatchStatus: vi.fn(),
    saveObservation: vi.fn(),
    saveTimelineCard: vi.fn(),
    getSettings: vi.fn(() => ({})), // Mock Settings for LLM Provider
    getSetting: vi.fn(() => null)
}));

import { createScreenshotBatches } from '../electron/features/timeline';

// Mock Screenshot interface
interface Screenshot {
    id: number;
    captured_at: number;
    file_path: string;
    file_size: number;
}

function createMockScreenshot(id: number, offsetSeconds: number): Screenshot {
    return {
        id,
        captured_at: 10000 + offsetSeconds,
        file_path: `/tmp/shot_${id}.jpg`,
        file_size: 1024
    };
}

describe('Batching Logic', () => {
    it('should handle empty input', () => {
        const batches = createScreenshotBatches([]);
        expect(batches).toHaveLength(0);
    });

    it('should group continuous screenshots into one batch', () => {
        // 3 shots within 1 minute
        const inputs = [
            createMockScreenshot(1, 0),
            createMockScreenshot(2, 30),
            createMockScreenshot(3, 60)
        ];

        // Let's create a sequence longer than minBatchDuration (5 mins).
        // 0s, 300s (5m). Duration = 300s.
        const inputsLong = [
            createMockScreenshot(1, 0),
            createMockScreenshot(2, 300)
        ];

        const batches = createScreenshotBatches(inputsLong);
        expect(batches).toHaveLength(1);
        expect(batches[0].screenshots).toHaveLength(2);
    });

    it('should split batches on large gaps', () => {
        // Batch 1: 0s, 60s
        // Gap: 10 mins (600s) > maxGap (300s)
        // Batch 2: 700s, 760s
        const inputs = [
            // Batch 1
            createMockScreenshot(1, 0),
            createMockScreenshot(2, 60),

            // Large Gap (640s gap)
            createMockScreenshot(3, 700),
            createMockScreenshot(4, 760),

            // Use a final shot far in the future to force Batch 2 to close
            createMockScreenshot(5, 760 + 300) // +5m
        ];

        const batches = createScreenshotBatches(inputs);
        expect(batches).toHaveLength(2);

        expect(batches[0].screenshots.map(s => s.id)).toEqual([1, 2]);
        expect(batches[1].screenshots.map(s => s.id)).toEqual([3, 4, 5]);
    });

    it('should split batches on target duration limits', () => {
        // Target duration = 15 mins (900s)
        // Max gap = 5 mins (300s)
        const inputs = [
            createMockScreenshot(1, 0),
            createMockScreenshot(2, 250), // Gap 250 < 300. Duration 250 < 900. OK.
            createMockScreenshot(3, 500), // Gap 250 < 300. Duration 500 < 900. OK.
            createMockScreenshot(4, 750), // Gap 250 < 300. Duration 750 < 900. OK.
            createMockScreenshot(5, 1000) // Gap 250 < 300. But Duration 1000 > 900. BURST!
        ];

        const batches = createScreenshotBatches(inputs);
        expect(batches.length).toBeGreaterThanOrEqual(1);
        // Should have [1, 2, 3, 4] in batch 1. [5] starts new batch.
        expect(batches[0].screenshots.map(s => s.id)).toEqual([1, 2, 3, 4]);
    });
});
