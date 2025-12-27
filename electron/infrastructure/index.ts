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
    createRepositoryFactory, SQLiteScreenshotRepository,
    SQLiteTimelineCardRepository
} from './repositories';

export type {
    IBatchRepository, IRepositoryFactory,
    IScreenshotRepository, ISettingsRepository, ITimelineCardRepository
} from './repositories';

// Config (if needed - currently in parent)
// export { getMergedLLMConfig, getLLMConfigForMain } from './config/config_manager';

// Events
export { eventBus } from './events';
export type { EventKey, EventMap } from './events';

