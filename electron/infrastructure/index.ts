/**
 * Infrastructure Module Exports
 * 
 * Database, IPC, repositories, LLM, and config management.
 */

// Database
export { closeDatabase, getDatabase, getDbPath, initDatabase } from './database';

// IPC
export { typedHandle } from './ipc/typed-ipc';

// Repositories
export {
    SQLiteScreenshotRepository,
    SQLiteTimelineCardRepository, createRepositoryFactory
} from './repositories';

export type {
    IBatchRepository, IRepositoryFactory,
    IScreenshotRepository, ISettingsRepository, ITimelineCardRepository
} from './repositories';

// Config (if needed - currently in parent)
// export { getMergedLLMConfig, getLLMConfigForMain } from './config/config_manager';
