/**
 * MemoryStore - LangGraph-compatible memory storage for PulseAgent
 * 
 * Implements LangGraph's BaseStore interface for long-term memory:
 * - Semantic Memory: Facts and user preferences
 * - Episodic Memory: Past interaction patterns
 * - Procedural Memory: Behavior rules and instructions
 * 
 * Uses LanceDB for persistent storage with vector search support.
 */

import * as lancedb from '@lancedb/lancedb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getLLMConfigForMain } from '../../../config_manager';

// LangGraph store types
export interface Item {
    value: Record<string, any>;
    key: string;
    namespace: string[];
    created_at: string;
    updated_at: string;
}

export interface GetOperation {
    namespace: string[];
    key: string;
}

export interface PutOperation {
    namespace: string[];
    key: string;
    value: Record<string, any>;
    index?: false | string[];
}

export interface SearchOperation {
    namespace: string[];
    query?: string;
    filter?: Record<string, any>;
    limit?: number;
}

export interface DeleteOperation {
    namespace: string[];
    key: string;
}

export type StoreOperation =
    | { get: GetOperation }
    | { put: PutOperation }
    | { search: SearchOperation }
    | { delete: DeleteOperation };

// Placeholder for BaseStore - we'll implement the interface
export abstract class BaseStore {
    abstract get(namespace: string[], key: string): Promise<Item | null>;
    abstract put(namespace: string[], key: string, value: Record<string, any>, index?: false | string[]): Promise<void>;
    abstract delete(namespace: string[], key: string): Promise<void>;
    abstract search(namespace: string[], options?: { query?: string; limit?: number; filter?: Record<string, any> }): Promise<Item[]>;
    abstract batch(operations: StoreOperation[]): Promise<any[]>;
    abstract listNamespaces(options?: { prefix?: string[]; limit?: number; offset?: number }): Promise<string[][]>;
}

// ============ Memory Types ============

export type MemoryType = 'semantic' | 'episodic' | 'procedural';

export interface BaseMemory {
    id: string;
    type: MemoryType;
    content: string;
    vector?: number[];
    created_at: number;
    updated_at: number;
    namespace: string;  // e.g., "local:memories" or "local:instructions"
    [key: string]: unknown;
}

export interface SemanticMemory extends BaseMemory {
    type: 'semantic';
    category: 'preference' | 'fact' | 'context';
    confidence: number;  // 0-1
}

export interface EpisodicMemory extends BaseMemory {
    type: 'episodic';
    trigger_pattern: string;  // When to recall this memory
    context_summary: string;  // Brief summary of the episode
}

export interface ProceduralMemory extends BaseMemory {
    type: 'procedural';
    instruction: string;
    priority: number;  // Higher = more important
}

export type Memory = SemanticMemory | EpisodicMemory | ProceduralMemory;

export interface MemorySearchResult {
    memory: Memory;
    score: number;
}

// ============ MemoryStore Class ============

export class MemoryStore extends BaseStore {
    private static instance: MemoryStore;
    private db: lancedb.Connection | null = null;
    private embeddings: OpenAIEmbeddings | null = null;
    private memoryTable: lancedb.Table | null = null;
    private initialized = false;
    private embeddingsDisabledReason: string | null = null;
    private embeddingsDisableLogged = false;

    public getEmbeddings(): OpenAIEmbeddings | null {
        return this.embeddings;
    }

    private readonly TABLE_NAME = 'pulse_memories';

    private constructor() {
        super();
    }

    public static getInstance(): MemoryStore {
        if (!MemoryStore.instance) {
            MemoryStore.instance = new MemoryStore();
        }
        return MemoryStore.instance;
    }

    /**
     * Initialize LanceDB and Embeddings Client
     */
    public async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // 1. Setup DB Path (same location as VectorStorage)
            const userDataPath = app.getPath('userData');
            const dbPath = path.join(userDataPath, 'lancedb');

            if (!fs.existsSync(dbPath)) {
                fs.mkdirSync(dbPath, { recursive: true });
            }

            // 2. Connect to LanceDB
            this.db = await lancedb.connect(dbPath);
            console.log('[MemoryStore] Connected to LanceDB at', dbPath);

            // 3. Initialize Embeddings Client (reuse VectorStorage pattern)
            this.configureEmbeddings();

            // 4. Open/Create Memory Table
            if (this.db) {
                const existingTables = await this.db.tableNames();
                if (existingTables.includes(this.TABLE_NAME)) {
                    this.memoryTable = await this.db.openTable(this.TABLE_NAME);
                    console.log(`[MemoryStore] Opened existing table '${this.TABLE_NAME}'`);
                } else {
                    console.log(`[MemoryStore] Table '${this.TABLE_NAME}' will be created on first insert.`);
                }
            }

            this.initialized = true;
        } catch (err) {
            console.error('[MemoryStore] Failed to initialize:', err);
        }
    }

    /**
     * Hot-reload embeddings configuration
     */
    public async refreshEmbeddingsConfig(): Promise<void> {
        if (!this.initialized) {
            await this.init();
            return;
        }
        this.embeddingsDisabledReason = null;
        this.embeddingsDisableLogged = false;
        this.configureEmbeddings();
    }

    private configureEmbeddings(): void {
        const config = getLLMConfigForMain();

        let apiKey: string | undefined;
        let baseURL: string | undefined;
        let embeddingModel = 'text-embedding-3-small';

        console.log('[MemoryStore] Configuring embeddings...');
        console.log('[MemoryStore] Available Roles:', Object.keys(config.roleConfigs || {}));

        // Check for dedicated EMBEDDING role first
        const embeddingRole = config.roleConfigs?.['EMBEDDING'];
        if (embeddingRole) {
            console.log('[MemoryStore] Found EMBEDDING role:', embeddingRole);
            const roleProvider = config.providers[embeddingRole.provider];
            if (roleProvider) {
                console.log(`[MemoryStore] Provider for role is ${embeddingRole.provider}. Has Key? ${!!roleProvider.apiKey}`);
                if (roleProvider.apiKey) {
                    apiKey = roleProvider.apiKey;
                    baseURL = roleProvider.apiBaseUrl;
                    embeddingModel = embeddingRole.model || embeddingModel;
                } else {
                    console.warn(`[MemoryStore] Provider ${embeddingRole.provider} has no API key configured.`);
                }
            } else {
                console.warn(`[MemoryStore] Provider ${embeddingRole.provider} not found in providers list.`);
            }
        } else {
            console.log('[MemoryStore] No EMBEDDING role configured.');
        }

        // Fallback: Try 'OpenAI' provider
        if (!apiKey && config.providers['OpenAI']?.apiKey) {
            console.log('[MemoryStore] Falling back to OpenAI provider.');
            apiKey = config.providers['OpenAI'].apiKey;
            baseURL = config.providers['OpenAI'].apiBaseUrl;
        }

        // Fallback: Try any openaiCompatible provider
        if (!apiKey) {
            console.log('[MemoryStore] Falling back to any OpenAI-compatible provider.');
            for (const [name, provider] of Object.entries(config.providers)) {
                if (provider.openaiCompatible && provider.hasKey && provider.apiKey) {
                    console.log(`[MemoryStore] Selected fallback provider: ${name}`);
                    apiKey = provider.apiKey;
                    baseURL = provider.apiBaseUrl;
                    break;
                }
            }
        }

        if (!apiKey) {
            this.embeddings = null;
            this.embeddingsDisabledReason = 'No API key configured for embeddings.';
            this.logDisabledOnce();
            return;
        }

        console.log(`[MemoryStore] Final Config - Model: ${embeddingModel}, BaseURL: ${baseURL}`);

        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: apiKey,
            configuration: { baseURL },
            modelName: embeddingModel,
        });
        console.log('[MemoryStore] Embeddings configured successfully.');
    }

    private logDisabledOnce(): void {
        if (this.embeddingsDisableLogged) return;
        this.embeddingsDisableLogged = true;
        console.warn(`[MemoryStore] Embeddings disabled: ${this.embeddingsDisabledReason}`);
    }

    // ============ Type Conversion Helpers ============

    /**
     * Convert Memory to Item (for BaseStore interface)
     */
    private memoryToItem(memory: Memory): Item {
        return {
            value: memory,
            key: memory.id,
            namespace: memory.namespace.split(':'),
            created_at: new Date(memory.created_at).toISOString(),
            updated_at: new Date(memory.updated_at).toISOString()
        };
    }

    /**
     * Convert Item to Memory (from BaseStore interface)
     */
    private itemToMemory(item: Item): Memory {
        return item.value as Memory;
    }

    // ============ Core Memory Operations ============
    // Note: These now implement BaseStore interface

    /**
     * Store a memory with optional vector embedding
     */
    public async put(
        namespace: string[],
        key: string,
        value: Record<string, any>,
        _index?: false | string[]
    ): Promise<void> {
        if (!this.initialized) await this.init();
        if (!this.db) {
            console.warn('[MemoryStore] Not initialized. Skipping put.');
            return;
        }

        try {
            const namespaceStr = namespace.join(':');
            const now = Date.now();

            // Generate embedding for the content
            let vector: number[] | undefined;
            if (this.embeddings && value.content) {
                try {
                    vector = await this.embeddings.embedQuery(String(value.content));
                } catch (err) {
                    console.warn('[MemoryStore] Failed to generate embedding:', err);
                }
            }

            const record: Memory = {
                ...value,
                id: key,
                namespace: namespaceStr,
                vector,
                created_at: (value.created_at as number) || now,
                updated_at: now,
            } as Memory;

            // Check if memory with this key already exists
            const existingItem = await this.get(namespace, key);

            if (!this.memoryTable) {
                const existingTables = await this.db.tableNames();
                if (existingTables.includes(this.TABLE_NAME)) {
                    this.memoryTable = await this.db.openTable(this.TABLE_NAME);
                } else {
                    this.memoryTable = await this.db.createTable(this.TABLE_NAME, [record]);
                    console.log(`[MemoryStore] Created table '${this.TABLE_NAME}'`);
                    return;
                }
            }

            if (existingItem) {
                // LanceDB doesn't have a direct update API - we delete and re-add
                const existingMemory = this.itemToMemory(existingItem);
                record.created_at = existingMemory.created_at;
                await this.delete(namespace, key);
                await this.memoryTable.add([record]);
                console.log(`[MemoryStore] Updated memory: ${key}`);
            } else {
                await this.memoryTable.add([record]);
                console.log(`[MemoryStore] Added memory: ${key}`);
            }
        } catch (err) {
            console.error('[MemoryStore] Failed to put memory:', err);
        }
    }

    /**
     * Retrieve a specific memory by key
     * Works with or without embeddings (has fallback)
     */
    public async get(namespace: string[], key: string): Promise<Item | null> {
        if (!this.initialized) await this.init();
        if (!this.memoryTable) return null;

        try {
            const namespaceStr = namespace.join(':');

            // Try vector search if embeddings available
            if (this.embeddings) {
                try {
                    const searchVector = await this.embeddings.embedQuery(key);
                    const results = await this.memoryTable
                        .vectorSearch(searchVector)
                        .limit(100)
                        .toArray();

                    const match = results.find((r: any) =>
                        r.id === key && r.namespace === namespaceStr
                    );

                    if (match) return this.memoryToItem(match as Memory);
                } catch (err) {
                    console.warn('[MemoryStore] Vector search failed, trying fallback:', err);
                }
            }

            // Fallback: Use filter/scan (slower but works without embeddings)
            // Note: This requires a full table scan, should be optimized with indexes
            const safeKey = key.replace(/'/g, "''");
            const safeNamespace = namespaceStr.replace(/'/g, "''");

            const results = await this.memoryTable
                .query()
                .where(`id = '${safeKey}' AND namespace = '${safeNamespace}'`)
                .limit(1)
                .toArray();

            return results.length > 0 ? this.memoryToItem(results[0] as Memory) : null;
        } catch (err) {
            console.error('[MemoryStore] Failed to get memory:', err);
            return null;
        }
    }

    /**
     * Search memories semantically within a namespace (BaseStore interface)
     */
    public async search(
        namespace: string[],
        options: {
            query?: string;
            limit?: number;
            filter?: Record<string, any>;
        } = {}
    ): Promise<Item[]> {
        if (!this.initialized) await this.init();
        if (!this.memoryTable || !this.embeddings) return [];

        const { query, limit = 10, filter } = options;
        const namespaceStr = namespace.join(':');

        try {
            // Generate a search vector
            const searchQuery = query || 'memory';
            const queryVector = await this.embeddings.embedQuery(searchQuery);

            // Build filter string for LanceDB
            const filterParts = [`namespace = '${namespaceStr.replace(/'/g, "''")}'`];

            // Perform vector search with pre-filtering
            const results = await this.memoryTable
                .vectorSearch(queryVector)
                .where(filterParts.join(' AND '))
                .limit(limit)
                .toArray();

            return results.map((r: any) => this.memoryToItem(r as Memory));
            return results.map((r: any) => this.memoryToItem(r as Memory));
        } catch (err: any) {
            // Circuit Breaker: specific handling for Auth errors to stop log spam
            if (err?.status === 401 || err?.error?.code === 'invalid_api_key' || err?.message?.includes('401')) {
                console.warn('[MemoryStore] Authentication failed (401). Disabling embeddings for this session to prevent further errors.');
                this.embeddings = null; // Disable future calls
                this.embeddingsDisabledReason = `Authentication failed: ${err.message}`;
                return [];
            }

            console.error('[MemoryStore] Search failed:', err);
            return [];
        }
    }

    /**
     * Delete a specific memory (BaseStore interface)
     */
    public async delete(namespace: string[], key: string): Promise<void> {
        if (!this.initialized) await this.init();
        if (!this.memoryTable) return;

        try {
            const namespaceStr = namespace.join(':');
            // Fix SQL injection: escape single quotes in key and namespace
            const safeKey = key.replace(/'/g, "''");
            const safeNamespace = namespaceStr.replace(/'/g, "''");

            await this.memoryTable.delete(`id = '${safeKey}' AND namespace = '${safeNamespace}'`);
            console.log(`[MemoryStore] Deleted memory: ${key}`);
        } catch (err) {
            console.error('[MemoryStore] Failed to delete memory:', err);
        }
    }

    async batch(operations: StoreOperation[]): Promise<any[]> {
        const results = [];
        for (const op of operations) {
            if ('get' in op) {
                results.push(await this.get(op.get.namespace, op.get.key));
            } else if ('put' in op) {
                await this.put(op.put.namespace, op.put.key, op.put.value, op.put.index);
                results.push(undefined);
            } else if ('search' in op) {
                results.push(await this.search(op.search.namespace, {
                    query: op.search.query,
                    filter: op.search.filter,
                    limit: op.search.limit
                }));
            } else if ('delete' in op) {
                await this.delete(op.delete.namespace, op.delete.key);
                results.push(undefined);
            }
        }
        return results;
    }

    async listNamespaces(_options?: { prefix?: string[]; limit?: number; offset?: number }): Promise<string[][]> {
        if (!this.initialized) await this.init();
        if (!this.memoryTable) return [];

        try {
            // LanceDB doesn't have a direct 'distinct' API in JS yet that is efficient.
            // For now, we'll do a simple query to get unique namespaces.
            // In a real production app with millions of records, this should be optimized.
            const results = await this.memoryTable.query().select(['namespace']).toArray();
            const namespaces = new Set<string>();
            results.forEach((r: any) => namespaces.add(r.namespace));

            return Array.from(namespaces).map(ns => ns.split(':'));
        } catch (err) {
            console.error('[MemoryStore] Failed to list namespaces:', err);
            return [];
        }
    }

    async start(): Promise<void> {
        await this.init();
    }

    async stop(): Promise<void> {
        this.db = null;
        this.memoryTable = null;
        this.initialized = false;
    }

    /**
     * List all memories in a namespace (uses vector search with post-filtering)
     */
    public async list(namespace: string[], limit = 100): Promise<Memory[]> {
        if (!this.memoryTable || !this.embeddings) return [];

        try {
            const namespaceStr = namespace.join(':');

            // Use a generic query to get all records
            const queryVector = await this.embeddings.embedQuery('memory recall');
            const results = await this.memoryTable
                .vectorSearch(queryVector)
                .limit(limit * 2)
                .toArray();

            return results
                .filter((r: any) => r.namespace === namespaceStr)
                .slice(0, limit) as Memory[];
        } catch (err) {
            console.error('[MemoryStore] Failed to list memories:', err);
            return [];
        }
    }

    // ============ Internal Helper: Get Memory (non-BaseStore) ============

    /**
     * Internal helper to search and return MemorySearchResult[]
     */
    private async searchMemories(
        namespace: string[],
        options: {
            query?: string;
            limit?: number;
            filter?: Record<string, any>;
        } = {}
    ): Promise<MemorySearchResult[]> {
        const items = await this.search(namespace, options);
        return items.map(item => ({
            memory: this.itemToMemory(item),
            score: 0  // Distance not preserved in Item
        }));
    }

    // ============ Convenience Methods ============

    /**
     * Get all procedural memories (instructions) for a user
     */
    public async getInstructions(userId: string): Promise<ProceduralMemory[]> {
        const results = await this.searchMemories([userId, 'instructions'], {
            filter: { type: 'procedural' }
        });
        return results
            .map(r => r.memory as ProceduralMemory)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    /**
     * Get relevant semantic memories for a query
     */
    public async recallSemanticMemories(
        userId: string,
        query: string,
        limit = 5
    ): Promise<SemanticMemory[]> {
        const results = await this.searchMemories([userId, 'memories'], {
            query,
            limit,
            filter: { type: 'semantic' }
        });
        return results.map(r => r.memory as SemanticMemory);
    }

    /**
     * Get relevant episodic memories for a query
     */
    public async recallEpisodicMemories(
        userId: string,
        query: string,
        limit = 3
    ): Promise<EpisodicMemory[]> {
        const results = await this.searchMemories([userId, 'memories'], {
            query,
            limit,
            filter: { type: 'episodic' }
        });
        return results.map(r => r.memory as EpisodicMemory);
    }

    /**
     * Find a similar memory (for duplicate detection)
     * Returns the most similar memory if similarity > threshold, otherwise null
     */
    public async findSimilarMemory(
        userId: string,
        content: string,
        similarityThreshold = 0.85
    ): Promise<{ memory: Memory; score: number } | null> {
        const results = await this.searchMemories([userId, 'memories'], {
            query: content,
            limit: 3
        });

        if (results.length === 0) return null;

        // LanceDB returns _distance (lower is more similar)
        // Convert to similarity score (1 - normalized_distance)
        const bestMatch = results[0];
        const distance = bestMatch.score;

        // For cosine distance, convert to similarity
        // distance of 0 = identical, distance of 2 = opposite
        const similarity = 1 - (distance / 2);

        if (similarity >= similarityThreshold) {
            console.log(`[MemoryStore] Found similar memory (similarity=${similarity.toFixed(3)}): ${bestMatch.memory.content.substring(0, 50)}...`);
            return { memory: bestMatch.memory, score: similarity };
        }

        return null;
    }

    /**
     * Get the count of memories in a namespace
     */
    public async getMemoryCount(namespace: string[]): Promise<number> {
        const memories = await this.list(namespace, 1000);
        return memories.length;
    }

    /**
     * Prune old memories if count exceeds limit
     * Removes oldest memories first
     */
    public async pruneOldMemories(
        namespace: string[],
        maxCount = 100
    ): Promise<number> {
        const memories = await this.list(namespace, maxCount * 2);

        if (memories.length <= maxCount) return 0;

        // Sort by created_at ascending (oldest first)
        const sorted = memories.sort((a, b) => a.created_at - b.created_at);
        const toDelete = sorted.slice(0, memories.length - maxCount);

        let deleted = 0;
        for (const memory of toDelete) {
            await this.delete(namespace, memory.id);
            deleted++;
        }

        console.log(`[MemoryStore] Pruned ${deleted} old memories`);
        return deleted;
    }

    /**
     * Reset the memory store by dropping the memories table.
     * Used during database reset.
     */
    public async reset(): Promise<void> {
        if (!this.db) {
            console.warn('[MemoryStore] Cannot reset: not initialized');
            return;
        }

        try {
            const existingTables = await this.db.tableNames();
            if (existingTables.includes(this.TABLE_NAME)) {
                await this.db.dropTable(this.TABLE_NAME);
                this.memoryTable = null;
                console.log(`[MemoryStore] Dropped table '${this.TABLE_NAME}'`);
            }
        } catch (err) {
            console.error('[MemoryStore] Failed to reset:', err);
            throw err;
        }
    }

    /**
     * Check if the store is ready for use
     */
    public isReady(): boolean {
        return this.initialized && this.db !== null;
    }

    public async close(): Promise<void> {
        if (this.db) {
            // LanceDB connection close? currently it doesn't have an explicit close in my wrapper.
            // But we should set initialized to false at least.
            this.db = null;
            this.initialized = false;
            console.log('[MemoryStore] Closed');
        }
    }
}

// Export singleton instance
export const memoryStore = MemoryStore.getInstance();
