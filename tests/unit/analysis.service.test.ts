import { beforeEach, describe, expect, it, vi } from 'vitest';

// 1. Hoist mocks
const mocks = vi.hoisted(() => ({
    mockEmitEvent: vi.fn(),
    mockTranscribeBatch: vi.fn().mockResolvedValue([
        { start: 1000, end: 1010, text: 'Test Observation' }
    ]),
    mockGenerateActivityCards: vi.fn().mockResolvedValue([
        {
            title: 'Test Card',
            summary: 'Test Summary',
            category: 'Work',
            confidence: 0.9,
            start_index: 0,
            end_index: 0
        }
    ]),
    mockFetchUnprocessedScreenshots: vi.fn().mockReturnValue([]),
    mockSaveBatchWithScreenshots: vi.fn().mockReturnValue(123),
    mockUpdateBatchStatus: vi.fn(),
    mockSaveTimelineCard: vi.fn().mockReturnValue(456),
    mockSaveObservation: vi.fn(),
    mockGetMergedLLMConfig: vi.fn().mockReturnValue({
        provider: 'openai',
        model: 'gpt-4o'
    }),
    mockGetSetting: vi.fn().mockReturnValue('1000'),
    mockScreenshotsForBatch: vi.fn().mockReturnValue([]),
    mockGetRepositories: vi.fn().mockReturnValue([])
}));

// 2. Mock dependencies
vi.mock('../../electron/infrastructure/events', () => ({
    eventBus: {
        emitEvent: mocks.mockEmitEvent
    }
}));

vi.mock('../../electron/llm/service', () => ({
    LLMService: vi.fn().mockImplementation(function () {
        return {
            transcribeBatch: mocks.mockTranscribeBatch,
            generateActivityCards: mocks.mockGenerateActivityCards
        };
    })
}));

// Mock the Repository instead of storage
vi.mock('../../electron/features/timeline/analysis.repository', () => ({
    defaultRepository: {
        fetchUnprocessedScreenshots: mocks.mockFetchUnprocessedScreenshots,
        saveBatchWithScreenshots: mocks.mockSaveBatchWithScreenshots,
        updateBatchStatus: mocks.mockUpdateBatchStatus,
        saveTimelineCard: mocks.mockSaveTimelineCard,
        saveObservation: mocks.mockSaveObservation,
        getSetting: mocks.mockGetSetting,
        screenshotsForBatch: mocks.mockScreenshotsForBatch,
        getRepositories: mocks.mockGetRepositories
    }
}));

vi.mock('../../electron/config_manager', () => ({
    getMergedLLMConfig: mocks.mockGetMergedLLMConfig
}));

vi.mock('../../electron/features/timeline/prompts/index', () => ({
    getAnalysisSystemPrompt: vi.fn().mockReturnValue('Mocked System Prompt')
}));

vi.mock('../../electron/features/pulse/agent/pulse-agent', () => ({
    pulseAgent: {
        ingestStructuredEntities: vi.fn().mockResolvedValue(undefined)
    }
}));

// 3. Import SUT
import { processRecordings } from '../../electron/features/timeline/analysis.service';

describe('AnalysisService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset default mock returns that might be overridden in tests
        mocks.mockGetSetting.mockReturnValue('1000');
    });

    it('should skip processing if no screenshots found', async () => {
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce([]);

        await processRecordings();

        expect(mocks.mockTranscribeBatch).not.toHaveBeenCalled();
    });

    it('should process screenshots, create cards, and emit event', async () => {
        // Mock data
        const mockScreenshots = [
            { id: 1, timestamp: 1000, app: 'VSCode' }, // Start
            { id: 2, timestamp: 1150, app: 'VSCode' }, // +150s
            { id: 3, timestamp: 1300, app: 'VSCode' }  // +300s (Total 300s)
        ];
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce(mockScreenshots);

        await processRecordings();
        
        // Verify transcribeBatch called with the result of getPromptForContext
        expect(mocks.mockTranscribeBatch).toHaveBeenCalledWith(
            expect.any(Array),
            'Mocked System Prompt'
        );
    });

    it('should handle LLM failure gracefully', async () => {
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce([
            { id: 1, timestamp: 1000 },
            { id: 2, timestamp: 1300 } // Duration 300s
        ]);
        mocks.mockTranscribeBatch.mockRejectedValueOnce(new Error('LLM Failed'));

        await processRecordings();

        // Should update batch status to failed
        expect(mocks.mockUpdateBatchStatus).toHaveBeenCalledWith(123, 'failed', expect.any(String));

        // Should NOT emit card:created
        expect(mocks.mockEmitEvent).not.toHaveBeenCalledWith('card:created', expect.any(Object));
    });

    it('should handle multiple batches correctly', async () => {
        // Create screenshots with a big gap to force multiple batches
        const mockScreenshots = [
            { id: 1, timestamp: 1000 },
            { id: 2, timestamp: 1300 },
            // Gap > 300s
            { id: 3, timestamp: 2000 },
            { id: 4, timestamp: 2300 }
        ];
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce(mockScreenshots);

        await processRecordings();

        // Should create 2 batches
        expect(mocks.mockSaveBatchWithScreenshots).toHaveBeenCalledTimes(2);
    });

    it('should skip saving cards if LLM returns empty cards', async () => {
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce([
            { id: 1, timestamp: 1000 },
            { id: 2, timestamp: 1300 }
        ]);
        mocks.mockTranscribeBatch.mockResolvedValueOnce([{ start: 1000, end: 1010, text: 'Test' }]);
        mocks.mockGenerateActivityCards.mockResolvedValueOnce([]); // Empty cards

        await processRecordings();

        // Should call generateActivityCards but not save any cards
        expect(mocks.mockGenerateActivityCards).toHaveBeenCalled();
        expect(mocks.mockSaveTimelineCard).not.toHaveBeenCalled();
        expect(mocks.mockEmitEvent).not.toHaveBeenCalled();
    });

    it('should fetch screenshots with a limit to prevent OOM', async () => {
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce([]);
        
        await processRecordings();

        // Expect 2nd argument to be the limit (e.g., 1000 or 500)
        expect(mocks.mockFetchUnprocessedScreenshots).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    });

    it('should ingest structured entities to PulseAgent', async () => {
        mocks.mockFetchUnprocessedScreenshots.mockReturnValueOnce([
            { id: 1, timestamp: 1000 }
        ]);
        mocks.mockTranscribeBatch.mockResolvedValueOnce([
            { 
                start: 1000, 
                end: 1010, 
                text: 'Coding in VSCode', 
                context_type: 'activity_context',
                entities: JSON.stringify([{ name: 'VSCode', type: 'tool' }]) 
            }
        ]);
        
        await processRecordings();
        
        // Use the imported mocked instance
        const { pulseAgent } = await import('../../electron/features/pulse/agent/pulse-agent');
        expect(pulseAgent.ingestStructuredEntities)
            .toHaveBeenCalledWith('local', 'Coding in VSCode', [{ name: 'VSCode', type: 'tool' }]);
    });
});
