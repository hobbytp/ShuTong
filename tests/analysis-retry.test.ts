import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processRecordings, setRepositoryForTesting } from '../electron/features/timeline/analysis.service';
import { IAnalysisRepository } from '../electron/features/timeline/analysis.repository';

describe('Analysis Retry Logic', () => {
    let mockRepo: any;

    beforeEach(() => {
        vi.useFakeTimers();

        mockRepo = {
            fetchUnprocessedScreenshots: vi.fn().mockReturnValue([]),
            getFailedBatches: vi.fn().mockReturnValue([]),
            saveBatchWithScreenshots: vi.fn(),
            updateBatchStatus: vi.fn(),
            saveTimelineCard: vi.fn(),
            saveObservation: vi.fn(),
            screenshotsForBatch: vi.fn().mockReturnValue([]),
            getRecentCards: vi.fn(),
            deleteCards: vi.fn(),
            getSetting: vi.fn(),
            getRepositories: vi.fn().mockReturnValue({}),
        };

        setRepositoryForTesting(mockRepo);
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('should retry failed batches', async () => {
        // Arrange
        const failedBatch = { id: 123, batch_start_ts: 1000, batch_end_ts: 2000, status: 'failed' };
        mockRepo.getFailedBatches.mockReturnValue([failedBatch]);

        // Mock screenshots so it doesn't fail immediately with "No screenshots"
        mockRepo.screenshotsForBatch.mockReturnValue([
            { id: 1, captured_at: 1000, file_path: 'test.png' }
        ]);

        // Act
        await processRecordings();

        // Assert
        expect(mockRepo.getFailedBatches).toHaveBeenCalled();
        // It should try to update status to processing
        expect(mockRepo.updateBatchStatus).toHaveBeenCalledWith(123, 'processing');
    });

    it('should fallback to normal processing if no failed batches', async () => {
        // Arrange
        mockRepo.getFailedBatches.mockReturnValue([]);
        mockRepo.fetchUnprocessedScreenshots.mockReturnValue([
            { id: 2, captured_at: 3000, file_path: 'new.png' }
        ]);
        mockRepo.saveBatchWithScreenshots.mockReturnValue(456);

        // Act
        await processRecordings();

        // Assert
        expect(mockRepo.getFailedBatches).toHaveBeenCalled();
        expect(mockRepo.fetchUnprocessedScreenshots).toHaveBeenCalled();
        expect(mockRepo.saveBatchWithScreenshots).toHaveBeenCalled();
    });
});
