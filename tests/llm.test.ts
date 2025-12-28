import { beforeEach, describe, expect, it, vi } from 'vitest';

// Define expected interfaces (to be implemented)
interface Observation {
    start: number;
    end: number;
    text: string;
}

interface ActivityCard {
    title: string;
    summary: string;
    category: string;
    subcategory?: string;
    confidence: number;
    appContext?: string[];
}

// Mock the dependencies
const mockGenerateContent = vi.fn();

// Mock electron module
vi.mock('electron', () => ({
    app: {
        getAppPath: vi.fn().mockReturnValue('/mock/path'),
        getPath: vi.fn().mockReturnValue('/mock/path')
    },
    ipcMain: {
        handle: vi.fn()
    }
}));

// Mock config_manager
vi.mock('../electron/config_manager', () => ({
    getMergedLLMConfig: vi.fn().mockReturnValue({
        providers: {
            mock: {
                maxScreenshotsPerRequest: 15,
                chunkDelayMs: 0
            }
        },
        roleConfigs: {
            SCREEN_ANALYZE: { provider: 'mock', model: 'test' },
            TEXT_SUMMARY: { provider: 'mock', model: 'test' }
        }
    })
}));

// We will mock the provider factory or service directly
vi.mock('../electron/llm/providers', () => ({
    getLLMProvider: () => ({
        generateContent: mockGenerateContent,
        generateContentStream: null
    }),
    consumeStreamWithIdleTimeout: vi.fn()
}));

import { LLMService } from '../electron/llm/service';

describe('LLMService', () => {
    let service: LLMService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LLMService(); // Should likely take config
    });

    describe('transcribeBatch', () => {
        it('should correctly format prompt and parse response for transcription', async () => {
            // Mock dependency response
            mockGenerateContent.mockResolvedValueOnce(JSON.stringify({
                observations: [
                    { start: 100, end: 200, text: "User is coding in VS Code" }
                ]
            }));

            const result = await service.transcribeBatch([
                { id: 1, captured_at: 100, file_path: '/tmp/1.jpg', file_size: 1000 },
                { id: 2, captured_at: 200, file_path: '/tmp/2.jpg', file_size: 1000 }
            ]);

            expect(result).toHaveLength(1);
            expect(result[0].text).toContain("VS Code");
            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            // Verify we sent images
            // expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({ images: expect.any(Array) }));
        });

        it('should handle invalid JSON response gracefully', async () => {
            mockGenerateContent.mockResolvedValueOnce("Invalid JSON string");

            // Must provide screenshots to bypass early return and trigger provider call
            await expect(service.transcribeBatch([
                { id: 1, captured_at: 100, file_path: 'test.jpg', file_size: 123 }
            ])).rejects.toThrow();
        });
    });

    describe('generateActivityCards', () => {
        it('should uses observations to generate cards', async () => {
            mockGenerateContent.mockResolvedValueOnce(JSON.stringify({
                cards: [
                    { title: "Coding", summary: "VS Code session", category: "Work", confidence: 0.9 }
                ]
            }));

            const observations: Observation[] = [
                { start: 100, end: 200, text: "User is coding" }
            ];

            const result = await service.generateActivityCards(observations);

            expect(result).toHaveLength(1);
            expect(result[0].title).toBe("Coding");
            expect(result[0].category).toBe("Work");
        });
    });
});
