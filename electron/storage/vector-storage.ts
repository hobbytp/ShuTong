import * as lancedb from '@lancedb/lancedb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLLMConfigForMain, LLMGlobalConfig } from '../config_manager';

// Define the schema for Activity Context
// Aligning with OpenContext's structure but simplified for ShuTong's need
export interface ActivityVector {
    id: string; // UUID from ShuTong's timeline_cards id (as string) or generic UUID
    vector: number[];
    text: string; // The text content that was embedded (title + summary)
    start_ts: number;
    end_ts: number;
    category: string;
    title: string;
    summary: string;
    source_type: 'activity'; // For now, mostly 'activity'
    created_at: number;
    [key: string]: unknown; // Allow flexible schema for LanceDB
}

export class VectorStorage {
    private static instance: VectorStorage;
    private db: lancedb.Connection | null = null;
    private embeddings: OpenAIEmbeddings | null = null;
    private activityTable: lancedb.Table | null = null;
    private initialized = false;
    private embeddingsDisabledReason: string | null = null;
    private embeddingsDisableLogged = false;

    private constructor() { }

    public static getInstance(): VectorStorage {
        if (!VectorStorage.instance) {
            VectorStorage.instance = new VectorStorage();
        }
        return VectorStorage.instance;
    }

    /**
     * Initialize LanceDB and Embeddings Client
     */
    public async init() {
        if (this.initialized) return;

        try {
            // 1. Setup DB Path
            const userDataPath = app.getPath('userData');
            const dbPath = path.join(userDataPath, 'lancedb');

            // Ensure directory exists
            if (!fs.existsSync(dbPath)) {
                fs.mkdirSync(dbPath, { recursive: true });
            }

            // 2. Connect to LanceDB
            this.db = await lancedb.connect(dbPath);
            console.log('[VectorStorage] Connected to LanceDB at', dbPath);

            // 3. Initialize Embeddings Client
            this.configureEmbeddingsFromConfig();

            // 4. Open/Create Tables
            if (this.db) {
                const tableName = 'activity_context';
                const existingTables = await this.db.tableNames();

                if (existingTables.includes(tableName)) {
                    this.activityTable = await this.db.openTable(tableName);
                } else {
                    console.log(`[VectorStorage] Table '${tableName}' does not exist yet. Will create on first insert.`);
                }
            }

            this.initialized = true;

        } catch (err) {
            console.error('[VectorStorage] Failed to initialize:', err);
        }
    }

    /**
     * Hot-reload embeddings configuration without restarting the app.
     * Safe to call after the user updates API key / base URL / model.
     */
    public async refreshEmbeddingsConfig() {
        if (!this.initialized) {
            await this.init();
            return;
        }

        this.embeddingsDisabledReason = null;
        this.embeddingsDisableLogged = false;
        this.configureEmbeddingsFromConfig();
    }

    private configureEmbeddingsFromConfig() {
        // We need to find a valid API Key.
        // Strategy: Look for specific 'EMBEDDING' role, or fallback to any OpenAI-compatible provider.
        const config: LLMGlobalConfig = getLLMConfigForMain();

        let apiKey: string | undefined;
        let baseURL: string | undefined;
        let embeddingModel = 'text-embedding-3-small';

        // Check for dedicated EMBEDDING role first
        const embeddingRole = config.roleConfigs?.['EMBEDDING'];
        if (embeddingRole) {
            const roleProvider = config.providers[embeddingRole.provider];
            if (roleProvider?.apiKey) {
                apiKey = roleProvider.apiKey;
                baseURL = roleProvider.apiBaseUrl;
                embeddingModel = embeddingRole.model || embeddingModel;
                console.log(`[VectorStorage] Using EMBEDDING role with provider: ${embeddingRole.provider}`);
            }
        }

        // Fallback: Try 'OpenAI' provider directly
        if (!apiKey && config.providers['OpenAI']?.apiKey) {
            apiKey = config.providers['OpenAI'].apiKey;
            baseURL = config.providers['OpenAI'].apiBaseUrl;
            console.log('[VectorStorage] Using OpenAI provider');
        }

        // Fallback: Try any openaiCompatible provider with a key
        if (!apiKey) {
            for (const [name, provider] of Object.entries(config.providers)) {
                if (provider.openaiCompatible && provider.hasKey && provider.apiKey) {
                    apiKey = provider.apiKey;
                    baseURL = provider.apiBaseUrl;
                    console.log(`[VectorStorage] Using fallback provider: ${name}`);
                    break;
                }
            }
        }

        if (!apiKey) {
            this.embeddings = null;
            this.embeddingsDisabledReason = 'No API key configured for embeddings.';
            this.logEmbeddingsDisabledOnce();
            return;
        }

        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: apiKey,
            configuration: {
                baseURL: baseURL
            },
            modelName: embeddingModel,
        });
    }

    /**
     * Add a timeline card to vector storage
     */
    public async addActivity(card: {
        id: number;
        category: string;
        title: string;
        summary: string;
        start_ts: number;
        end_ts: number;
    }) {
        if (!this.embeddings || !this.db) {
            if (this.embeddingsDisabledReason) {
                this.logEmbeddingsDisabledOnce();
            } else {
                console.warn('[VectorStorage] Not initialized or missing API key. Skipping addActivity.');
            }
            return;
        }

        try {
            const textToEmbed = `${card.title}: ${card.summary}`;
            const vector = await this.embeddings.embedQuery(textToEmbed);

            const record: ActivityVector = {
                id: card.id.toString(),
                vector: vector,
                text: textToEmbed,
                start_ts: card.start_ts,
                end_ts: card.end_ts,
                category: card.category,
                title: card.title,
                summary: card.summary,
                source_type: 'activity',
                created_at: Date.now()
            };

            const tableName = 'activity_context';

            if (!this.activityTable) {
                // Double check if table exists now (async race considerations)
                const existingTables = await this.db.tableNames();
                if (existingTables.includes(tableName)) {
                    this.activityTable = await this.db.openTable(tableName);
                    await this.activityTable.add([record]);
                } else {
                    // Create table
                    this.activityTable = await this.db.createTable(tableName, [record]);
                    console.log(`[VectorStorage] Created table '${tableName}'`);
                }
            } else {
                await this.activityTable.add([record]);
            }

            console.log(`[VectorStorage] Added activity ${card.id} to vector index.`);

        } catch (err) {
            if (this.isAuthError(err)) {
                this.disableEmbeddings('Embedding provider authentication failed (check API key / base URL).', err);
                return;
            }
            console.error('[VectorStorage] Failed to add activity:', err);
        }
    }

    /**
     * Semantic search for activities
     */
    public async search(query: string, limit: number = 10): Promise<ActivityVector[]> {
        if (!this.embeddings || !this.activityTable) {
            if (this.embeddingsDisabledReason) {
                this.logEmbeddingsDisabledOnce();
            } else {
                console.warn('[VectorStorage] Search unavailable (DB/Embeddings not ready).');
            }
            return [];
        }

        try {
            const queryVector = await this.embeddings.embedQuery(query);

            const results = await this.activityTable.vectorSearch(queryVector)
                .limit(limit)
                .toArray();

            return results as ActivityVector[];
        } catch (err) {
            if (this.isAuthError(err)) {
                this.disableEmbeddings('Embedding provider authentication failed (check API key / base URL).', err);
                return [];
            }
            console.error('[VectorStorage] Search failed:', err);
            return [];
        }
    }

    private isAuthError(err: unknown): boolean {
        const anyErr = err as any;
        const status = anyErr?.status;
        const lcCode = anyErr?.lc_error_code;
        const message = String(anyErr?.message || '');
        return status === 401 || lcCode === 'MODEL_AUTHENTICATION' || /MODEL_AUTHENTICATION/i.test(message);
    }

    private disableEmbeddings(reason: string, err?: unknown) {
        this.embeddings = null;
        this.embeddingsDisabledReason = reason;
        if (!this.embeddingsDisableLogged) {
            this.embeddingsDisableLogged = true;
            console.warn(`[VectorStorage] Disabling embeddings: ${reason}`);
            if (err) {
                const anyErr = err as any;
                const status = anyErr?.status;
                const lcCode = anyErr?.lc_error_code;
                const message = String(anyErr?.message || '');
                console.warn('[VectorStorage] Embeddings auth error summary:', { status, lc_error_code: lcCode, message });
            }
        }
    }

    private logEmbeddingsDisabledOnce() {
        if (this.embeddingsDisableLogged) return;
        this.embeddingsDisableLogged = true;
        console.warn(`[VectorStorage] Embeddings disabled: ${this.embeddingsDisabledReason}`);
    }

    /**
     * Hybrid search context for Agent (Time range + Semantic)
     */
    public async retrieveContext(query: string, timeRange?: { start?: number, end?: number }) {
        // This will be implemented for Phase 3 Agent
        // Need to combine vector search with pre-filtering (if LanceDB supports it in JS SDK)
        if (timeRange) {
            console.log('[VectorStorage] Time range filtering not yet implemented:', timeRange);
        }
        return this.search(query);
    }

    /**
     * Reset the vector storage by dropping and recreating the activity table.
     * Call this during database reset.
     */
    public async reset(): Promise<void> {
        if (!this.db) {
            console.warn('[VectorStorage] Cannot reset: not initialized');
            return;
        }

        try {
            const tableName = 'activity_context';
            const existingTables = await this.db.tableNames();

            if (existingTables.includes(tableName)) {
                await this.db.dropTable(tableName);
                this.activityTable = null;
                console.log(`[VectorStorage] Dropped table '${tableName}'`);
            }
        } catch (err) {
            console.error('[VectorStorage] Failed to reset:', err);
            throw err;
        }
    }
}

export const vectorStorage = VectorStorage.getInstance();
