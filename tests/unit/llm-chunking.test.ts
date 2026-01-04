import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMergedLLMConfig } from '../../electron/config_manager';
import { getLLMProvider } from '../../electron/llm/providers';
import { LLMService } from '../../electron/llm/service';

// Mock dependencies
vi.mock('../../electron/llm/providers', () => ({
    getLLMProvider: vi.fn(),
    consumeStreamWithIdleTimeout: vi.fn().mockImplementation(async (stream, callback) => {
        // Just return the stream content directly for testing
        return stream;
    })
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

// Mock Jimp
const mockJimpImage = vi.hoisted(() => ({
    width: 3000,
    height: 2000,
    getWidth: vi.fn().mockReturnValue(3000),
    getHeight: vi.fn().mockReturnValue(2000),
    scaleToFit: vi.fn(),
    getBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image-data')),
    getBufferAsync: vi.fn().mockResolvedValue(Buffer.from('resized-image-data')),
}));

vi.mock('jimp', () => ({
    Jimp: {
        read: vi.fn().mockResolvedValue(mockJimpImage),
        MIME_PNG: 'image/png'
    },
    default: {
        read: vi.fn().mockResolvedValue(mockJimpImage),
        MIME_PNG: 'image/png'
    }
}));

describe('LLMService', () => {
    let service: LLMService;
    let mockProvider: any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LLMService();
        mockProvider = {
            generateContent: vi.fn()
        };
        (getLLMProvider as any).mockReturnValue(mockProvider);
        (getMergedLLMConfig as any).mockReturnValue({
            providers: {
                mock: {
                    maxScreenshotsPerRequest: 2,
                    chunkDelayMs: 0
                }
            },
            roleConfigs: {
                SCREEN_ANALYZE: { provider: 'mock', model: 'test-model' }
            },
            adaptiveChunking: { enabled: false }
        });
    });

    it('should process images (resize and base64) before sending to provider', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
        ];

        // Mock provider response
        const expectedObs = { observations: [{ start_index: 0, end_index: 0, text: 'Observation' }] };
        mockProvider.generateContent.mockResolvedValue(JSON.stringify(expectedObs));

        await service.transcribeBatch(screenshots as any);

        // Verify Jimp usage
        // Note: We use the hoisted mockJimpImage for verification as it's the one returned by the mock
        expect(mockJimpImage.scaleToFit).toHaveBeenCalledWith({ w: 2048, h: 2048 });

        // Verify provider called with base64 data
        const expectedBase64 = Buffer.from('resized-image-data').toString('base64');
        expect(mockProvider.generateContent).toHaveBeenCalledWith(expect.objectContaining({
            images: expect.arrayContaining([
                expect.objectContaining({
                    data: expectedBase64,
                    mimeType: 'image/png'
                })
            ])
        }));
    });

    it('should pass custom prompt to provider', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
        ];
        const customPrompt = 'Custom Prompt';

        mockProvider.generateContent.mockResolvedValue(JSON.stringify({ observations: [] }));

        await service.transcribeBatch(screenshots as any, customPrompt);

        expect(mockProvider.generateContent).toHaveBeenCalledWith(expect.objectContaining({
            prompt: customPrompt
        }));
    });

    it('should split a large batch into multiple chunks', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
            { id: 2, captured_at: 2000, file_path: 'p2.jpg', file_size: 100 },
            { id: 3, captured_at: 3000, file_path: 'p3.jpg', file_size: 100 },
        ];

        // maxPerChunk is 2. So 3 images -> 2 chunks (2, 1)
        mockProvider.generateContent
            .mockResolvedValueOnce(JSON.stringify({ observations: [{ start_index: 0, end_index: 1, text: 'Chunk 1' }] }))
            .mockResolvedValueOnce(JSON.stringify({ observations: [{ start_index: 0, end_index: 0, text: 'Chunk 2' }] }));

        const result = await service.transcribeBatch(screenshots as any);

        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Chunk 1');
        expect(result[1].text).toBe('Chunk 2');

        expect(mockProvider.generateContent).toHaveBeenCalledTimes(2);
    });
});
