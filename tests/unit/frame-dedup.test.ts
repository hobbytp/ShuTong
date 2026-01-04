import { describe, expect, it } from 'vitest';
import { calculateGridDistance, sampleFrameGrid } from '../../electron/features/capture/frame-dedup';

describe('frame-dedup', () => {
    it('should calculate lower distance for identical frames', () => {
        const buffer = Buffer.alloc(100 * 100 * 4, 255); // White frame
        const grid1 = sampleFrameGrid(buffer, 100, 100);
        const grid2 = sampleFrameGrid(buffer, 100, 100);
        
        const distance = calculateGridDistance(grid1, grid2, 100, 100, 32);
        expect(distance).toBe(0);
    });

    it('should calculate higher distance for different frames', () => {
        const buffer1 = Buffer.alloc(100 * 100 * 4, 0); // Black
        const buffer2 = Buffer.alloc(100 * 100 * 4, 255); // White
        
        const grid1 = sampleFrameGrid(buffer1, 100, 100);
        const grid2 = sampleFrameGrid(buffer2, 100, 100);
        
        const distance = calculateGridDistance(grid1, grid2, 100, 100, 32);
        expect(distance).toBeGreaterThan(0.5);
    });

    it('should respect ROI weighting', () => {
        // Create two frames:
        // Frame 1: Background White, ROI Black
        // Frame 2: Background White, ROI White (Changed inside ROI)
        // Frame 3: Background Black, ROI Black (Changed outside ROI)
        
        // We expect Frame 1 vs Frame 2 (ROI change) to have HIGHER weighted distance 
        // than Frame 1 vs Frame 3 (Background change), even if pixel count changed is similar.
        
        // Setup: 1000x1000 image. ROI 500x500. Grid 32.
        const width = 1000;
        const height = 1000;
        const roi = { x: 250, y: 250, w: 500, h: 500 }; // Centered 25% area
        
        // Helper to fill buffer
        const createFrame = (bgColor: number, roiColor: number) => {
            const buf = Buffer.alloc(width * height * 4);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const offset = (y * width + x) * 4;
                    const inRoi = x >= roi.x && x < roi.x + roi.w && y >= roi.y && y < roi.y + roi.h;
                    const val = inRoi ? roiColor : bgColor;
                    buf[offset] = val;     // R
                    buf[offset+1] = val;   // G
                    buf[offset+2] = val;   // B
                    buf[offset+3] = 255;   // A
                }
            }
            return buf;
        };

        const frameBase = createFrame(255, 0); // White BG, Black ROI
        const frameRoiChanged = createFrame(255, 255); // White BG, White ROI (ROI changed)
        const frameBgChanged = createFrame(0, 0); // Black BG, Black ROI (BG changed)
        
        const gridBase = sampleFrameGrid(frameBase, width, height, 32);
        const gridRoiChanged = sampleFrameGrid(frameRoiChanged, width, height, 32);
        const gridBgChanged = sampleFrameGrid(frameBgChanged, width, height, 32);
        
        // Calculate distances WITHOUT ROI (should be proportional to area changed)
        // ROI area = 2500 pixels (25%). BG area = 7500 pixels (75%).
        // ROI change (25% pixels changed max dist). BG change (75% pixels changed max dist).
        // So raw distance of BG change should be ~3x ROI change.
        const distRoiRaw = calculateGridDistance(gridBase, gridRoiChanged);
        const distBgRaw = calculateGridDistance(gridBase, gridBgChanged);
        
        expect(distBgRaw).toBeGreaterThan(distRoiRaw); // Sanity check for unweighted
        
        // Calculate distances WITH ROI
        // ROI Weight = 3.0. BG Weight = 0.5.
        // ROI change score ~= 0.25 * 3.0 = 0.75
        // BG change score ~= 0.75 * 0.5 = 0.375
        // So Weighted ROI change should be HIGHER than Weighted BG change.
        
        const distRoiWeighted = calculateGridDistance(gridBase, gridRoiChanged, width, height, 32, roi);
        const distBgWeighted = calculateGridDistance(gridBase, gridBgChanged, width, height, 32, roi);
        
        expect(distRoiWeighted).toBeGreaterThan(distBgWeighted);
    });
});
