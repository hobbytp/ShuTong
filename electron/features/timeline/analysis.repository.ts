import {
    fetchUnprocessedScreenshots,
    getRepositories,
    getSetting,
    saveBatchWithScreenshots,
    saveObservation,
    saveTimelineCard,
    screenshotsForBatch,
    updateBatchStatus
} from '../../storage';

export interface IAnalysisRepository {
    fetchUnprocessedScreenshots(sinceTimestamp: number, limit?: number): any[];
    saveBatchWithScreenshots(start: number, end: number, screenshotIds: number[]): number | bigint | null;
    updateBatchStatus(batchId: number, status: string, error?: string): void;
    saveTimelineCard(card: any): number | bigint | null;
    saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string): void;
    screenshotsForBatch(batchId: number): any[];
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

    saveObservation(batchId: number, startTs: number, endTs: number, observation: string, model?: string): void {
        saveObservation(batchId, startTs, endTs, observation, model);
    }

    screenshotsForBatch(batchId: number): any[] {
        return screenshotsForBatch(batchId);
    }

    getSetting(key: string): string | null {
        return getSetting(key);
    }

    getRepositories(): any {
        return getRepositories();
    }
}

export const defaultRepository = new SqliteAnalysisRepository();
