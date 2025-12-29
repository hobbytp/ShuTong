/**
 * SQLite Checkpointer for LangGraph - Conversation Persistence
 * 
 * Provides short-term memory (conversation history) persistence using SQLite.
 * Compatible with LangGraph's checkpointer interface.
 * 
 * Features:
 * - Thread-based conversation storage
 * - State serialization/deserialization
 * - Conversation history retrieval
 */

import { RunnableConfig } from '@langchain/core/runnables';
import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple, uuid6 } from '@langchain/langgraph-checkpoint';
import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

interface CheckpointRow {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    parent_checkpoint_id: string | null;
    checkpoint: string;  // JSON serialized
    metadata: string;    // JSON serialized
    created_at: number;
}

export class SQLiteCheckpointer extends BaseCheckpointSaver {
    private db: Database.Database;
    private initialized = false;

    constructor(dbPath?: string) {
        super();

        // Default to userData directory
        const defaultPath = path.join(
            app.getPath('userData'),
            'checkpoints.sqlite'
        );
        const finalPath = dbPath || defaultPath;

        // Ensure directory exists
        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(finalPath);
        this.initTables();
    }

    private initTables(): void {
        if (this.initialized) return;

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                checkpoint TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            );

            CREATE INDEX IF NOT EXISTS idx_checkpoints_thread 
            ON checkpoints(thread_id, checkpoint_ns, created_at DESC);
        `);

        this.initialized = true;
        console.log('[SQLiteCheckpointer] Initialized');
    }

    /**
     * Get a checkpoint tuple by config
     */
    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id as string;
        const checkpointId = config.configurable?.checkpoint_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';

        if (!threadId) return undefined;

        try {
            let row: CheckpointRow | undefined;

            if (checkpointId) {
                // Get specific checkpoint
                row = this.db.prepare(`
                    SELECT * FROM checkpoints 
                    WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
                `).get(threadId, checkpointNs, checkpointId) as CheckpointRow | undefined;
            } else {
                // Get latest checkpoint for thread
                row = this.db.prepare(`
                    SELECT * FROM checkpoints 
                    WHERE thread_id = ? AND checkpoint_ns = ?
                    ORDER BY created_at DESC 
                    LIMIT 1
                `).get(threadId, checkpointNs) as CheckpointRow | undefined;
            }

            if (!row) return undefined;

            const checkpoint = JSON.parse(row.checkpoint) as Checkpoint;
            const metadata = JSON.parse(row.metadata) as CheckpointMetadata;

            return {
                config: {
                    configurable: {
                        thread_id: row.thread_id,
                        checkpoint_ns: row.checkpoint_ns,
                        checkpoint_id: row.checkpoint_id,
                    }
                },
                checkpoint,
                metadata,
                parentConfig: row.parent_checkpoint_id ? {
                    configurable: {
                        thread_id: row.thread_id,
                        checkpoint_ns: row.checkpoint_ns,
                        checkpoint_id: row.parent_checkpoint_id,
                    }
                } : undefined
            };
        } catch (err) {
            console.error('[SQLiteCheckpointer] getTuple error:', err);
            return undefined;
        }
    }

    /**
     * List checkpoints for a thread (generator)
     */
    async *list(
        config: RunnableConfig,
        options?: { limit?: number; before?: RunnableConfig }
    ): AsyncGenerator<CheckpointTuple> {
        const threadId = config.configurable?.thread_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
        const limit = options?.limit || 100;

        if (!threadId) return;

        try {
            let query = `
                SELECT * FROM checkpoints 
                WHERE thread_id = ? AND checkpoint_ns = ?
            `;
            const params: any[] = [threadId, checkpointNs];

            if (options?.before?.configurable?.checkpoint_id) {
                const beforeId = options.before.configurable.checkpoint_id as string;
                query += ` AND checkpoint_id < ?`;
                params.push(beforeId);
            }

            query += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            const rows = this.db.prepare(query).all(...params) as CheckpointRow[];

            for (const row of rows) {
                const checkpoint = JSON.parse(row.checkpoint) as Checkpoint;
                const metadata = JSON.parse(row.metadata) as CheckpointMetadata;

                yield {
                    config: {
                        configurable: {
                            thread_id: row.thread_id,
                            checkpoint_ns: row.checkpoint_ns,
                            checkpoint_id: row.checkpoint_id,
                        }
                    },
                    checkpoint,
                    metadata,
                    parentConfig: row.parent_checkpoint_id ? {
                        configurable: {
                            thread_id: row.thread_id,
                            checkpoint_ns: row.checkpoint_ns,
                            checkpoint_id: row.parent_checkpoint_id,
                        }
                    } : undefined
                };
            }
        } catch (err) {
            console.error('[SQLiteCheckpointer] list error:', err);
        }
    }

    /**
     * Save a checkpoint
     */
    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        const threadId = config.configurable?.thread_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || '';
        const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

        if (!threadId) {
            // LangGraph might call put without thread_id for some internal state or if not properly configured
            // We can't save without a thread_id, so we log and return the config as is or throw
            // But throwing breaks the flow. Let's log a warning and return.
            console.warn('[SQLiteCheckpointer] put called without thread_id in config.configurable. Skipping save.');
            return config;
        }

        const checkpointId = checkpoint.id || uuid6(-3);

        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO checkpoints 
                (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                threadId,
                checkpointNs,
                checkpointId,
                parentCheckpointId || null,
                JSON.stringify(checkpoint),
                JSON.stringify(metadata),
                Date.now()
            );

            return {
                configurable: {
                    thread_id: threadId,
                    checkpoint_ns: checkpointNs,
                    checkpoint_id: checkpointId,
                }
            };
        } catch (err) {
            console.error('[SQLiteCheckpointer] put error:', err);
            throw err;
        }
    }

    /**
     * Save writes (pending writes for a checkpoint)
     * This is required by LangGraph but we use a simplified implementation
     */
    async putWrites(
        _config: RunnableConfig,
        writes: Array<[string, any]>,
        taskId: string
    ): Promise<void> {
        // For now, we don't persist pending writes separately
        // They are included in the checkpoint state
        console.log('[SQLiteCheckpointer] putWrites called (no-op)', { taskId, writeCount: writes.length });
    }

    /**
     * Delete checkpoints for a thread
     */
    async deleteThread(threadId: string): Promise<void> {
        try {
            this.db.prepare(`
                DELETE FROM checkpoints WHERE thread_id = ?
            `).run(threadId);
            console.log(`[SQLiteCheckpointer] Deleted checkpoints for thread: ${threadId}`);
        } catch (err) {
            console.error('[SQLiteCheckpointer] deleteThread error:', err);
        }
    }

    /**
     * Get all thread IDs
     */
    getThreadIds(): string[] {
        try {
            const rows = this.db.prepare(`
                SELECT DISTINCT thread_id FROM checkpoints ORDER BY thread_id
            `).all() as { thread_id: string }[];
            return rows.map(r => r.thread_id);
        } catch (err) {
            console.error('[SQLiteCheckpointer] getThreadIds error:', err);
            return [];
        }
    }

    /**
     * Close the database connection
     */
    close(): void {
        this.db.close();
        console.log('[SQLiteCheckpointer] Closed');
    }
}

// Export factory function for easier instantiation
export function createCheckpointer(dbPath?: string): SQLiteCheckpointer {
    return new SQLiteCheckpointer(dbPath);
}
