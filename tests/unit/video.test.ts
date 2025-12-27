import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCardVideo } from '../../electron/features/video';
import * as storage from '../../electron/storage';

// Mock dependencies
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/mock/user/data')
    }
}));

vi.mock('../../electron/storage', () => ({
    getScreenshotsForCard: vi.fn(),
    updateCardVideoUrl: vi.fn()
}));

// Mock video_service
vi.mock('../../electron/features/video/video.service', () => ({
    generateVideo: vi.fn().mockResolvedValue('/mock/user/data/videos/activity_123.mp4')
}));

describe('Video Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(fs, 'existsSync').mockReturnValue(true as any);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    });

    it('should return null if no screenshots found', async () => {
        vi.spyOn(storage, 'getScreenshotsForCard').mockReturnValue([]);
        const result = await generateCardVideo(1);
        expect(result).toBeNull();
    });

    it('should call generateVideo and handle success', async () => {
        const mockScreenshots = [
            { file_path: '/path/to/1.jpg' },
            { file_path: '/path/to/2.jpg' }
        ];
        vi.spyOn(storage, 'getScreenshotsForCard').mockReturnValue(mockScreenshots as any);

        const result = await generateCardVideo(123);

        expect(result).toContain('activity_123.mp4');
        expect(storage.updateCardVideoUrl).toHaveBeenCalledWith(123, expect.stringContaining('media://'));
    });
});
