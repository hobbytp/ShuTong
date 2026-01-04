import { RunnableConfig } from "@langchain/core/runnables";
import { safeParseJSON } from '../../../utils/json';
import { v4 as uuidv4 } from "uuid";
import { GraphMemoryStore } from "./graph-memory-store";
import { BaseStore } from "./memory-store";
import {
    FactRetrievalSchema,
    getFactRetrievalMessages,
    getUpdateMemoryMessages,
    MemoryUpdateAction,
    MemoryUpdateSchema,
} from "./prompts";

type LLMModel = any; // Supports ChatOpenAI, custom ChatModel, etc.

interface MemoryProcessorConfig {
    store: BaseStore;
    model: LLMModel;
    graphStore?: GraphMemoryStore;
}

export class MemoryProcessor {
    private store: BaseStore;
    private model: LLMModel;
    private graphStore?: GraphMemoryStore;

    constructor(config: MemoryProcessorConfig) {
        this.store = config.store;
        this.model = config.model;
        this.graphStore = config.graphStore;
    }

    public setModel(model: LLMModel) {
        this.model = model;
    }

    public setGraphStore(store: GraphMemoryStore) {
        this.graphStore = store;
    }

    /**
     * Stage 1: Atomic Fact Extraction
     * Extracts atomic facts from the conversation history.
     */
    public async extractFacts(
        messages: string,
        config?: RunnableConfig,
    ): Promise<string[]> {
        if (!this.model) {
             // console.warn('[MemoryProcessor] Skipping extraction: LLM model not initialized');
             return [];
        }

        const [systemPrompt, userPrompt] = getFactRetrievalMessages(messages);

        try {
            // Check if model supports withStructuredOutput (ChatOpenAI does, custom models may not)
            if ('withStructuredOutput' in this.model && typeof this.model.withStructuredOutput === 'function') {
                const structuredLLM = this.model.withStructuredOutput(FactRetrievalSchema);
                const result = await structuredLLM.invoke(
                    [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    config,
                );
                return result.facts || [];
            } else {
                // Fallback: manual JSON parsing for custom models
                const response = await this.model.invoke(
                    [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    config,
                );
                const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

                // Extract JSON from response (handle code blocks) using safeParseJSON
                const parsed = safeParseJSON(content);
                if (!parsed || !parsed.facts) {
                    console.warn('[MemoryProcessor] Failed to parse JSON from LLM response');
                    return [];
                }

                return parsed.facts || [];
            }
        } catch (error) {
            console.error("Error extracting facts:", error);
            return [];
        }
    }

    /**
   * Stage 2: Conflict Resolution and Storage
   * Compares new facts with existing memories and applies updates.
   * @param userId - User identifier for namespacing memories
   * @param facts - Extracted atomic facts
   * @param config - Optional runnable configuration
   */
    public async processFacts(
        userId: string,
        facts: string[],
        config?: RunnableConfig,
    ): Promise<void> {
        if (!this.model) return;

        // 1. Retrieve relevant existing memories for these facts.
        // We search for each fact and deduplicate results.
        const relevantMemoriesMap = new Map<string, { id: string; text: string }>();



        // Parallelize search requests for performance
        const searchPromises = facts.map(fact =>
            this.store.search([userId, 'memories'], {
                query: fact,
                limit: 3, // Top 3 per fact
                filter: { type: 'semantic' } // Only semantic memories
            })
        );

        const searchResults = await Promise.all(searchPromises);

        // Aggregate results
        for (const results of searchResults) {
            for (const item of results) {
                if (item.value && typeof item.value.content === 'string') {
                    relevantMemoriesMap.set(item.key, {
                        id: item.key,
                        text: item.value.content,
                    });
                }
            }
        }

        const retrievedOldMemories = Array.from(relevantMemoriesMap.values());
        const existingIds = new Set(retrievedOldMemories.map(m => m.id));

        // 2. Decide on updates (The "Review" step)
        const updatePrompt = getUpdateMemoryMessages(retrievedOldMemories, facts);

        try {
            let instructions: MemoryUpdateAction[];

            // Check if model supports withStructuredOutput
            if ('withStructuredOutput' in this.model && typeof this.model.withStructuredOutput === 'function') {
                const structuredUpdater = this.model.withStructuredOutput(MemoryUpdateSchema);
                const result = await structuredUpdater.invoke(
                    [{ role: "user", content: updatePrompt }],
                    config
                );
                instructions = result.memory as MemoryUpdateAction[];
            } else {
                // Fallback: manual JSON parsing
                const response = await this.model.invoke(
                    [{ role: "user", content: updatePrompt }],
                    config
                );
                const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

                // Extract JSON from response using safeParseJSON
                const parsed = safeParseJSON(content);
                if (!parsed || !parsed.memory) {
                    console.warn('[MemoryProcessor] Failed to parse update instructions from LLM');
                    return;
                }

                instructions = parsed.memory as MemoryUpdateAction[];
            }

            await this.applyUpdates(userId, instructions, existingIds);

        } catch (error) {
            console.error("Error resolving memory conflicts:", error);
        }
    }

    /**
     * Stage 3: Graph Memory Extraction (Parallel)
     * Extracts entities and relationships from the text and updates the graph.
     */
    public async processGraphMemory(userId: string, data: string): Promise<void> {
        if (!this.graphStore || !this.graphStore.isEnabled()) {
            return;
        }

        try {
            await this.graphStore.add(userId, data);
        } catch (error) {
            console.error("Error processing graph memory:", error);
        }
    }

    /**
   * Applies the decided actions to the store.
   * @param userId - User identifier for namespacing
   * @param actions - Memory update actions from LLM
   * @param existingIds - Set of existing memory IDs for accurate checking
   */
    private async applyUpdates(
        userId: string,
        actions: MemoryUpdateAction[],
        existingIds: Set<string>
    ) {
        for (const action of actions) {
            const { id, text, event } = action;

            switch (event) {
                case "ADD":
                    // Check if ID exists in our retrieved set
                    // LLM might generate sequential IDs like "0", "1", "2" for new items
                    // We generate a fresh UUID for genuinely new memories
                    if (existingIds.has(id)) {
                        // This is actually an existing ID, treat as UPDATE
                        await this.store.put([userId, 'memories'], id, {
                            content: text,
                            category: "general", // TODO: Infer category from fact content
                            type: "semantic",
                            updated_at: new Date().toISOString()
                        });
                    } else {
                        // New memory - generate UUID
                        const newKey = uuidv4();
                        await this.store.put([userId, 'memories'], newKey, {
                            content: text,
                            category: "general",
                            type: "semantic",
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                    }
                    break;

                case "UPDATE":
                    // Only update if ID exists in our set
                    if (existingIds.has(id)) {
                        await this.store.put([userId, 'memories'], id, {
                            content: text,
                            category: "general",
                            type: "semantic",
                            updated_at: new Date().toISOString()
                        });
                    } else {
                        console.warn(`[MemoryProcessor] Cannot UPDATE non - existent memory ID: ${id} `);
                    }
                    break;

                case "DELETE":
                    // Only delete if ID exists
                    if (existingIds.has(id)) {
                        await this.store.delete([userId, 'memories'], id);
                    } else {
                        console.warn(`[MemoryProcessor] Cannot DELETE non-existent memory ID: ${id}`);
                    }
                    break;

                case "NONE":
                    // Do nothing
                    break;
            }
        }
    }
}
