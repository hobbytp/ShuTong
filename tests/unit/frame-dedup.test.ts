/**
 * Unit tests for Frame Deduplication Module (Smart Capture Guard v2)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    calculateGridDistance,
    clearDedupState,
    getDedupSettings,
    getDedupStats,
    isFrameSimilar,
    resetDedupStats,
    resetLastFrame,
    sampleFrameGrid,
    updateDedupSettings
} from '../../electron/features/capture/frame-dedup';

describe('Frame Deduplication Module', () => {
    beforeEach(() => {
        // Reset state before each test
        clearDedupState();
        updateDedupSettings({
            similarityThreshold: 0.05,
            enableSimilarityDedup: true,
            gridSize: 32
        });
    });

    describe('sampleFrameGrid', () => {
        it('should sample correct number of points from buffer', () => {
            // Create a 100x100 RGBA buffer (40000 bytes)
            const width = 100;
            const height = 100;
            const buffer = Buffer.alloc(width * height * 4, 128); // Gray pixels

            const grid = sampleFrameGrid(buffer, width, height, 32);

            expect(grid.length).toBe(32 * 32); // 1024 points
        });

        it('should extract RGB values correctly', () => {
            // Create a small buffer with known colors
            const width = 4;
            const height = 4;
            const buffer = Buffer.alloc(width * height * 4);

            // Set first pixel to red (255, 0, 0)
            buffer[0] = 255; // R
            buffer[1] = 0;   // G
            buffer[2] = 0;   // B
            buffer[3] = 255; // A

            const grid = sampleFrameGrid(buffer, width, height, 2);

            // First sampled point should be red
            expect(grid[0]).toEqual([255, 0, 0]);
        });

        it('should handle edge cases with small buffers', () => {
            const width = 2;
            const height = 2;
            const buffer = Buffer.alloc(width * height * 4, 100);

            const grid = sampleFrameGrid(buffer, width, height, 4);

            // Should still return grid without crashing
            expect(grid.length).toBe(16);
        });
    });

    describe('calculateGridDistance', () => {
        it('should return 0 for identical grids', () => {
            const grid1: [number, number, number][] = [
                [100, 100, 100],
                [200, 200, 200]
            ];
            const grid2 = [...grid1];

            const distance = calculateGridDistance(grid1, grid2);

            expect(distance).toBe(0);
        });

        it('should return 1 for maximum different grids (black vs white)', () => {
            const black: [number, number, number][] = [[0, 0, 0]];
            const white: [number, number, number][] = [[255, 255, 255]];

            const distance = calculateGridDistance(black, white);

            expect(distance).toBeCloseTo(1, 1);
        });

        it('should return value between 0 and 1 for partial differences', () => {
            const grid1: [number, number, number][] = [[100, 100, 100]];
            const grid2: [number, number, number][] = [[150, 100, 100]];

            const distance = calculateGridDistance(grid1, grid2);

            expect(distance).toBeGreaterThan(0);
            expect(distance).toBeLessThan(1);
        });

        it('should return 1 for mismatched grid lengths', () => {
            const grid1: [number, number, number][] = [[0, 0, 0]];
            const grid2: [number, number, number][] = [[0, 0, 0], [0, 0, 0]];

            const distance = calculateGridDistance(grid1, grid2);

            expect(distance).toBe(1);
        });
    });

    describe('isFrameSimilar', () => {
        it('should return false for first frame (no previous frame)', () => {
            const buffer = Buffer.alloc(100 * 100 * 4, 128);

            const isSimilar = isFrameSimilar(buffer, 100, 100, 1000);

            expect(isSimilar).toBe(false);
        });

        it('should return true for identical consecutive frames', () => {
            const buffer = Buffer.alloc(100 * 100 * 4, 128);

            // First frame - always stored
            isFrameSimilar(buffer, 100, 100, 1000);

            // Second identical frame - should be similar
            const isSimilar = isFrameSimilar(buffer, 100, 100, 1000);

            expect(isSimilar).toBe(true);
        });

        it('should return false for significantly different frames', () => {
            const buffer1 = Buffer.alloc(100 * 100 * 4, 0); // Black
            const buffer2 = Buffer.alloc(100 * 100 * 4, 255); // White

            // First frame
            isFrameSimilar(buffer1, 100, 100, 1000);

            // Different frame
            const isSimilar = isFrameSimilar(buffer2, 100, 100, 1000);

            expect(isSimilar).toBe(false);
        });

        it('should respect enableSimilarityDedup setting', () => {
            updateDedupSettings({ enableSimilarityDedup: false });

            const buffer = Buffer.alloc(100 * 100 * 4, 128);

            // First frame
            isFrameSimilar(buffer, 100, 100, 1000);

            // Second frame - should NOT be similar because dedup is disabled
            const isSimilar = isFrameSimilar(buffer, 100, 100, 1000);

            expect(isSimilar).toBe(false);
        });

        it('should track statistics correctly', () => {
            const buffer = Buffer.alloc(100 * 100 * 4, 128);

            resetDedupStats();

            isFrameSimilar(buffer, 100, 100, 1000); // First frame
            isFrameSimilar(buffer, 100, 100, 2000); // Similar - skipped
            isFrameSimilar(buffer, 100, 100, 3000); // Similar - skipped

            const stats = getDedupStats();

            expect(stats.totalCaptures).toBe(3);
            expect(stats.dedupSkips).toBe(2);
            expect(stats.estimatedBytesSaved).toBe(5000); // 2000 + 3000
        });
    });

    describe('resetLastFrame', () => {
        it('should cause next frame to be stored', () => {
            const buffer = Buffer.alloc(100 * 100 * 4, 128);

            // Store first frame
            isFrameSimilar(buffer, 100, 100, 1000);

            // Reset
            resetLastFrame();

            // Next frame should not be considered similar
            const isSimilar = isFrameSimilar(buffer, 100, 100, 1000);

            expect(isSimilar).toBe(false);
        });
    });

    describe('Settings', () => {
        it('should update and get settings correctly', () => {
            updateDedupSettings({ similarityThreshold: 0.1 });

            const settings = getDedupSettings();

            expect(settings.similarityThreshold).toBe(0.1);
        });

        it('should use threshold for similarity decision', () => {
            // Very low threshold - almost nothing is similar
            updateDedupSettings({ similarityThreshold: 0.001 });

            const buffer1 = Buffer.alloc(100 * 100 * 4, 128);
            const buffer2 = Buffer.alloc(100 * 100 * 4, 130); // Slightly different

            isFrameSimilar(buffer1, 100, 100, 1000);
            const isSimilar = isFrameSimilar(buffer2, 100, 100, 1000);

            // With very low threshold, slightly different frames should NOT be similar
            expect(isSimilar).toBe(false);
        });
    });
});
