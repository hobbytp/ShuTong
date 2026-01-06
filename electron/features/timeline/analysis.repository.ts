import {
    fetchUnprocessedScreenshots,
    getRepositories,
    getSetting,
    saveBatchWithScreenshots,
    saveObservation,
    saveTimelineCard,
    screenshotsForBatch,
    deleteCards as storageDeleteCards,
    getRecentCards as storageGetRecentCards,
    updateBatchStatus
} from '../../storage';

export interface IAnalysisRepository {
    fetchUnprocessedScreenshots(sinceTimestamp: number, limit?: number): any[];
    saveBatchWithScreenshots(start: number, end: number, screenshotIds: number[]): number | bigint | null;
    updateBatchStatus(batchId: number, status: string, error?: string): void;
    saveTimelineCard(card: any): number | bigint | null;
    saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string, contextType?: string, entities?: string): number | bigint | undefined;
    screenshotsForBatch(batchId: number): any[];
    getRecentCards(limit: number, sinceTs: number): any[];
    deleteCards(cardIds: number[]): void;
    getSetting(key: string): string | null;
    getRepositories(): any;
}

export class SqliteAnalysisRepository implements IAnalysisRepository {
    fetchUnprocessedScreenshots(sinceTimestamp: number, limit: number = 1000): any[] {
        return fetchUnprocessedScreenshots(sinceTimestamp, limit);
    }

    saveBatchWithScreenshots(start: number, end: number, screenshotIds: number[]): number | bigint | null {
        return saveBatchWithScreenshots(start, end, screenshotIds);
    }

    updateBatchStatus(batchId: number, status: string, error?: string): void {
        updateBatchStatus(batchId, status, error);
    }

    saveTimelineCard(card: any): number | bigint | null {
        return saveTimelineCard(card) ?? null;
    }

    saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string, contextType?: string, entities?: string): number | bigint | undefined {
        return saveObservation(batchId, startTs, endTs, observation, model, contextType, entities);
    }

    screenshotsForBatch(batchId: number): any[] {
        return screenshotsForBatch(batchId);
    }

    getSetting(key: string): string | null {
        return getSetting(key);
    }

    getRecentCards(limit: number, sinceTs: number): any[] {
        return storageGetRecentCards(limit, sinceTs);
    }

    deleteCards(cardIds: number[]): void {
        storageDeleteCards(cardIds);
    }

    getRepositories(): any {
        return getRepositories();
    }
}

export const defaultRepository = new SqliteAnalysisRepository();
