
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphStoreConfig } from '../../electron/config_manager';
import { GraphMemoryStore } from '../../electron/features/pulse/agent/graph-memory-store';

// Mock Neo4j Driver
const mockSession = {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
};

const mockDriver = {
    session: vi.fn(() => mockSession),
    close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('neo4j-driver', () => ({
    driver: vi.fn(() => mockDriver),
    auth: { basic: vi.fn() },
    Driver: class { },
}));

// Mock LLM
class MockLLM extends BaseChatModel {
    _llmType() { return "mock"; }
    async _generate(_messages: BaseMessage[], _options: any) {
        return {
            generations: [{
                text: "Mock response",
                message: new AIMessageChunk({ content: "Mock response" })
            }]
        };
    }
    bindTools(_tools: any[]) {
        return this as any;
    }
    async invoke(input: any, _options?: any) {
        const inputStr = JSON.stringify(input);

        // Mock entity extraction (search & add phase 1)
        if (inputStr.includes("Extract all the entities")) {
            return new AIMessageChunk({
                content: "",
                tool_calls: [{
                    name: "extract_entities",
                    args: { entities: [{ entity: "TestEntity", entity_type: "TestType" }] }
                }]
            });
        }

        // Mock relation extraction (add phase 2)
        if (inputStr.includes("List of known entities") || inputStr.includes("establish_relationships")) {
            return new AIMessageChunk({
                content: "",
                tool_calls: [{
                    name: "establish_relationships",
                    args: { entities: [{ source: "TestEntity", destination: "OtherEntity", relationship: "TEST_REL" }] }
                }]
            });
        }

        // Mock delete (search phase check)
        if (inputStr.includes("delete_graph_memory")) {
            return new AIMessageChunk({
                content: "",
                tool_calls: []
            });
        }

        return new AIMessageChunk({ content: "Mock response" });
    }
}

// Mock Embeddings
class MockEmbeddings extends Embeddings {
    async embedDocuments(documents: string[]) {
        return documents.map(() => [0.1, 0.2, 0.3]);
    }
    async embedQuery(_document: string) {
        return [0.1, 0.2, 0.3];
    }
}

describe('GraphMemoryStore', () => {
    let config: GraphStoreConfig;
    let llm: MockLLM;
    let embeddings: MockEmbeddings;

    beforeEach(() => {
        vi.clearAllMocks();
        config = {
            enabled: true,
            url: "bolt://localhost:7687",
            username: "neo4j",
            password: "password"
        };
        llm = new MockLLM({});
        embeddings = new MockEmbeddings({});
    });

    it('should initialize correctly when enabled', () => {
        const store = new GraphMemoryStore(config, llm, embeddings);
        expect(store.isEnabled()).toBe(true);
    });

    it('should not initialize driver when disabled', () => {
        config.enabled = false;
        const store = new GraphMemoryStore(config, llm, embeddings);
        expect(store.isEnabled()).toBe(false);
    });

    it('should call Neo4j session on search', async () => {
        const store = new GraphMemoryStore(config, llm, embeddings);

        // Mock db search result
        mockSession.run.mockResolvedValue({
            records: [
                {
                    get: (key: string) => {
                        const data: any = {
                            source: "TestEntity",
                            source_id: "1",
                            relationship: "RELATED_TO",
                            relation_id: "2",
                            destination: "OtherEntity",
                            destination_id: "3",
                            similarity: 0.9
                        };
                        return data[key];
                    }
                }
            ]
        });

        const results = await store.search("user1", "query");

        expect(results.length).toBeGreaterThan(0);
        expect(mockSession.run).toHaveBeenCalled();
    });

    it('should add entities and relations', async () => {
        const store = new GraphMemoryStore(config, llm, embeddings);

        // Mock node search (check existence) - returns empty to force creation
        mockSession.run.mockResolvedValueOnce({ records: [] }); // source search
        mockSession.run.mockResolvedValueOnce({ records: [] }); // dest search
        // Mock creation run
        mockSession.run.mockResolvedValue({ records: [] });

        await store.add("user1", "TestEntity is related to OtherEntity");

        expect(mockSession.run).toHaveBeenCalled();
    });
});
