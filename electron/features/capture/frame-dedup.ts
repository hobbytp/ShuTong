/**
 * Frame Deduplication Module
 * 
 * Provides lightweight similar frame detection using Grid Sampling algorithm.
 * No external dependencies required - uses pure JavaScript Buffer operations.
 */

// --- Types ---

export interface DedupSettings {
    /** Similarity threshold (0-1). If grid distance is below this, frames are similar. Default: 0.05 */
    similarityThreshold: number;
    /** Enable/disable deduplication. Default: true */
    enableSimilarityDedup: boolean;
    /** Grid size for sampling (NxN points). Default: 32 */
    gridSize: number;
}

export interface DedupStats {
    totalCaptures: number;
    dedupSkips: number;
    estimatedBytesSaved: number;
}

// Color sample from a pixel (RGB)
type RGBColor = [number, number, number];

// Grid is a flat array of RGB values sampled at fixed positions
type FrameGrid = RGBColor[];

// --- State ---

let lastFrameGrid: FrameGrid | null = null;
let dedupStats: DedupStats = {
    totalCaptures: 0,
    dedupSkips: 0,
    estimatedBytesSaved: 0
};

let dedupSettings: DedupSettings = {
    similarityThreshold: 0.05,
    enableSimilarityDedup: true,
    gridSize: 32
};

// --- Settings ---

export function updateDedupSettings(settings: Partial<DedupSettings>) {
    dedupSettings = { ...dedupSettings, ...settings };
}

export function getDedupSettings(): DedupSettings {
    return { ...dedupSettings };
}

export function getDedupStats(): DedupStats {
    return { ...dedupStats };
}

export function resetDedupStats() {
    dedupStats = { totalCaptures: 0, dedupSkips: 0, estimatedBytesSaved: 0 };
}

// --- Core Algorithm ---

/**
 * Sample a grid of pixels from a raw JPEG buffer.
 * Note: This works on the raw image data, not compressed JPEG.
 * For JPEG, we need to decode first or use a simpler approach.
 * 
 * For efficiency, we sample from the raw NativeImage buffer before JPEG encoding.
 * 
 * @param buffer - Raw RGBA pixel buffer (4 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param gridSize - Number of sample points per axis (default: 32)
 * @returns Grid of sampled RGB colors
 */
export function sampleFrameGrid(
    buffer: Buffer,
    width: number,
    height: number,
    gridSize: number = 32
): FrameGrid {
    const grid: FrameGrid = [];
    const bytesPerPixel = 4; // RGBA

    const stepX = Math.floor(width / gridSize);
    const stepY = Math.floor(height / gridSize);

    for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
            const x = Math.min(gx * stepX, width - 1);
            const y = Math.min(gy * stepY, height - 1);

            const offset = (y * width + x) * bytesPerPixel;

            // Bounds check
            if (offset + 2 < buffer.length) {
                const r = buffer[offset];
                const g = buffer[offset + 1];
                const b = buffer[offset + 2];
                grid.push([r, g, b]);
            } else {
                // Fallback for edge cases
                grid.push([0, 0, 0]);
            }
        }
    }

    return grid;
}

/**
 * Calculate the normalized distance between two frame grids.
 * Uses mean Euclidean distance of RGB values, normalized to 0-1.
 * 
 * @param grid1 - First frame grid
 * @param grid2 - Second frame grid
 * @returns Normalized distance (0 = identical, 1 = completely different)
 */
export function calculateGridDistance(grid1: FrameGrid, grid2: FrameGrid): number {
    if (grid1.length !== grid2.length || grid1.length === 0) {
        return 1; // Maximum distance if grids don't match
    }

    let totalDistance = 0;
    const maxDistance = Math.sqrt(255 * 255 * 3); // Max RGB Euclidean distance

    for (let i = 0; i < grid1.length; i++) {
        const [r1, g1, b1] = grid1[i];
        const [r2, g2, b2] = grid2[i];

        // Euclidean distance for this pixel
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        const pixelDistance = Math.sqrt(dr * dr + dg * dg + db * db);

        totalDistance += pixelDistance / maxDistance;
    }

    // Return mean normalized distance
    return totalDistance / grid1.length;
}

/**
 * Check if a new frame is similar to the last captured frame.
 * Updates internal state if frame is new (not similar).
 * 
 * @param buffer - Raw RGBA pixel buffer
 * @param width - Image width
 * @param height - Image height
 * @param estimatedBytes - Estimated size of the frame in bytes (for stats)
 * @param updateState - Whether to update the internal lastFrameGrid state (default: true)
 * @returns Object containing isSimilar boolean and distance metric
 */
export function checkFrameSimilarity(
    buffer: Buffer,
    width: number,
    height: number,
    estimatedBytes: number = 0,
    updateState: boolean = true
): { isSimilar: boolean, distance: number } {
    if (!dedupSettings.enableSimilarityDedup) {
        return { isSimilar: false, distance: 1.0 };
    }

    const currentGrid = sampleFrameGrid(buffer, width, height, dedupSettings.gridSize);

    if (updateState) {
        dedupStats.totalCaptures++;
    }

    if (lastFrameGrid === null) {
        // First frame - store and don't skip
        if (updateState) {
            lastFrameGrid = currentGrid;
        }
        return { isSimilar: false, distance: 1.0 };
    }

    const distance = calculateGridDistance(lastFrameGrid, currentGrid);
    const isSimilar = distance < dedupSettings.similarityThreshold;

    if (isSimilar) {
        // Similar frame
        if (updateState) {
            dedupStats.dedupSkips++;
            dedupStats.estimatedBytesSaved += estimatedBytes;
        }
    } else {
        // Different frame
        if (updateState) {
            lastFrameGrid = currentGrid;
        }
    }

    return { isSimilar, distance };
}

/**
 * Legacy wrapper for backward compatibility.
 * @deprecated Use checkFrameSimilarity instead for more control.
 */
export function isFrameSimilar(
    buffer: Buffer,
    width: number,
    height: number,
    estimatedBytes: number = 0
): boolean {
    return checkFrameSimilarity(buffer, width, height, estimatedBytes, true).isSimilar;
}

/**
 * Force update the last frame grid (e.g., after window switch).
 * Call this when you want to ensure the next frame is stored regardless of similarity.
 */
export function resetLastFrame() {
    lastFrameGrid = null;
}

/**
 * Clear all dedup state.
 */
export function clearDedupState() {
    lastFrameGrid = null;
    dedupStats = { totalCaptures: 0, dedupSkips: 0, estimatedBytesSaved: 0 };
}
