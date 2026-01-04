import {
    getWindowDwellStats,
    getWindowSwitches
} from '../../storage';
import {
    getGuardStats,
    getSkipLog,
    resetGuardStats
} from '../capture/capture-guard';

export interface IAnalyticsRepository {
    getWindowDwellStats(startTs: number, endTs: number): { app: string; total_seconds: number }[];
    getWindowSwitches(startTs: number, endTs: number, limit?: number): any[];
    getGuardStats(): any;
    getSkipLog(limit?: number): any[];
    resetGuardStats(): void;
}

export class DefaultAnalyticsRepository implements IAnalyticsRepository {
    getWindowDwellStats(startTs: number, endTs: number) {
        return getWindowDwellStats(startTs, endTs);
    }

    getWindowSwitches(startTs: number, endTs: number, limit: number = 100) {
        return getWindowSwitches(startTs, endTs, limit);
    }

    getGuardStats() {
        return getGuardStats();
    }

    getSkipLog(limit?: number) {
        return getSkipLog(limit);
    }

    resetGuardStats() {
        resetGuardStats();
    }
}

export const defaultAnalyticsRepository = new DefaultAnalyticsRepository();
