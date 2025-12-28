import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMergedLLMConfig } from '../../electron/config_manager';
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

describe('LLMService Context Chunking', () => {
    let service: LLMService;
    let mockProvider: any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LLMService();
        mockProvider = {
            generateContent: vi.fn(),
            generateContentStream: null // Force non-streaming for simplicity in these tests
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
            }
        });
    });

    it('should process a small batch as a single chunk', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
        ];

        mockProvider.generateContent.mockResolvedValue(JSON.stringify({
            observations: [{ start_index: 0, end_index: 0, text: 'Single observation' }]
        }));

        const result = await service.transcribeBatch(screenshots as any);

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Single observation');
        expect(mockProvider.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should split a large batch into multiple chunks', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
            { id: 2, captured_at: 2000, file_path: 'p2.jpg', file_size: 100 },
            { id: 3, captured_at: 3000, file_path: 'p3.jpg', file_size: 100 },
            { id: 4, captured_at: 4000, file_path: 'p4.jpg', file_size: 100 },
            { id: 5, captured_at: 5000, file_path: 'p5.jpg', file_size: 100 },
        ];

        // maxPerChunk is 2. So 5 images -> 3 chunks (2, 2, 1)
        mockProvider.generateContent
            .mockResolvedValueOnce(JSON.stringify({
                observations: [{ start_index: 0, end_index: 1, text: 'Chunk 1' }]
            }))
            .mockResolvedValueOnce(JSON.stringify({
                observations: [{ start_index: 0, end_index: 1, text: 'Chunk 2' }]
            }))
            .mockResolvedValueOnce(JSON.stringify({
                observations: [{ start_index: 0, end_index: 0, text: 'Chunk 3' }]
            }));

        const result = await service.transcribeBatch(screenshots as any);

        expect(result).toHaveLength(3);
        expect(result[0].text).toBe('Chunk 1');
        expect(result[0].start).toBe(1000);
        expect(result[0].end).toBe(2000);

        expect(result[1].text).toBe('Chunk 2');
        expect(result[1].start).toBe(3000);
        expect(result[1].end).toBe(4000);

        expect(result[2].text).toBe('Chunk 3');
        expect(result[2].start).toBe(5000);
        expect(result[2].end).toBe(5000);

        expect(mockProvider.generateContent).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures and return available observations', async () => {
        const screenshots = [
            { id: 1, captured_at: 1000, file_path: 'p1.jpg', file_size: 100 },
            { id: 2, captured_at: 2000, file_path: 'p2.jpg', file_size: 100 },
            { id: 3, captured_at: 3000, file_path: 'p3.jpg', file_size: 100 },
            { id: 4, captured_at: 4000, file_path: 'p4.jpg', file_size: 100 },
        ];

        // chunk 1 ok, chunk 2 fails
        mockProvider.generateContent
            .mockResolvedValueOnce(JSON.stringify({
                observations: [{ start_index: 0, end_index: 1, text: 'Chunk 1' }]
            }))
            .mockRejectedValueOnce(new Error('API Failure'));

        const result = await service.transcribeBatch(screenshots as any);

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Chunk 1');
        expect(mockProvider.generateContent).toHaveBeenCalledTimes(2);
    });
});
