import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as storage from '../../electron/storage';
import { generateCardVideo } from '../../electron/video';

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

// Mock ffmpeg
const mockInputOptions = vi.fn().mockReturnThis();
const mockInput = vi.fn().mockReturnThis();
const mockInputFormat = vi.fn().mockReturnThis();
const mockOutputOptions = vi.fn().mockReturnThis();
const mockDuration = vi.fn().mockReturnThis();
const mockSave = vi.fn().mockReturnThis();
const mockOn = vi.fn().mockReturnThis();

const mockFfmpegInstance = {
    input: mockInput,
    inputFormat: mockInputFormat,
    inputOptions: mockInputOptions,
    outputOptions: mockOutputOptions,
    duration: mockDuration,
    save: mockSave,
    on: mockOn
};

vi.mock('fluent-ffmpeg', () => {
    const ffmpegMock = vi.fn(() => mockFfmpegInstance);
    // Use Object.assign to add static methods to the mock function
    Object.assign(ffmpegMock, {
        setFfmpegPath: vi.fn()
    });

    return {
        default: ffmpegMock,
        __esModule: true
    };
});

vi.mock('ffmpeg-static', () => ({
    default: '/path/to/ffmpeg'
}));

describe('Video Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Avoid touching the real filesystem in unit tests.
        vi.spyOn(fs, 'existsSync').mockReturnValue(true as any);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
        vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
        vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined as any);
    });

    it('should return null if no screenshots found', async () => {
        vi.spyOn(storage, 'getScreenshotsForCard').mockReturnValue([]);
        const result = await generateCardVideo(1);
        expect(result).toBeNull();
    });

    it('should configure ffmpeg correctly and handle success', async () => {
        const mockScreenshots = [
            { file_path: '/path/to/1.jpg' },
            { file_path: '/path/to/2.jpg' }
        ];
        vi.spyOn(storage, 'getScreenshotsForCard').mockReturnValue(mockScreenshots as any);

        const videoPromise = generateCardVideo(123);

        // Simulate ffmpeg 'end' event
        const endCallback = (mockOn.mock.calls as any[]).find((call: any[]) => call[0] === 'end')[1];

        // Trigger success
        await endCallback();

        const result = await videoPromise;

        expect(result).toContain('activity_123.mp4');
        expect(storage.updateCardVideoUrl).toHaveBeenCalledWith(123, expect.stringContaining('media://'));
        expect(mockInput).toHaveBeenCalled(); // Should have input file
    });
});
