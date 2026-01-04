import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Driver, auth, driver as createDriver } from "neo4j-driver";
import { GraphStoreConfig } from "../../../config_manager";
import { BM25 } from "./graph-bm25";
import {
    DELETE_MEMORY_TOOL_GRAPH,
    EXTRACT_ENTITIES_TOOL,
    EXTRACT_RELATIONS_PROMPT,
    RELATIONS_TOOL,
    getDeleteMessages
} from "./graph-prompts";

// Simple logger interface to match usage or just use console
const logger = {
    info: (msg: string) => console.log(`[GraphMemory] ${msg} `),
    error: (msg: string) => console.error(`[GraphMemory] ${msg} `),
    debug: (msg: string) => console.debug(`[GraphMemory] ${msg} `),
};

interface SearchOutput {
    source: string;
    source_id: string;
    relationship: string;
    relation_id: string;
    destination: string;
    destination_id: string;
    similarity: number;
}

interface GraphMemoryResult {
    deleted_entities: any[];
    added_entities: any[];
    relations?: any[];
}

export class GraphMemoryStore {
    private driver: Driver | null = null;
    private config: GraphStoreConfig;
    private llm: BaseChatModel;
    private embeddings: Embeddings;
    private threshold: number = 0.7;

    constructor(
        config: GraphStoreConfig,
        llm: BaseChatModel,
        embeddings: Embeddings
    ) {
        this.config = config;
        this.llm = llm;
        this.embeddings = embeddings;

        if (this.config.enabled) {
            this.initializeDriver();
        }
    }

    private initializeDriver() {
        if (!this.config.url || !this.config.username || !this.config.password) {
            logger.error("Neo4j configuration is incomplete. Graph memory disabled.");
            return;
        }

        try {
            this.driver = createDriver(
                this.config.url,
                auth.basic(this.config.username, this.config.password)
            );
            logger.info("Neo4j driver initialized.");
        } catch (e) {
            logger.error(`Failed to initialize Neo4j driver: ${e} `);
        }
    }

    public async close() {
        if (this.driver) {
            await this.driver.close();
            this.driver = null;
        }
    }

    public isEnabled(): boolean {
        return this.config.enabled && this.driver !== null;
    }

    async add(userId: string, data: string): Promise<GraphMemoryResult> {
        if (!this.isEnabled()) {
            return { deleted_entities: [], added_entities: [] };
        }

        const filters = { userId };
        const entityTypeMap = await this._retrieveNodesFromData(data, filters);

        return this._processGraphInsertion(userId, data, entityTypeMap, filters);
    }

    async addStructured(userId: string, data: string, entities: { name: string; type: string }[]): Promise<GraphMemoryResult> {
        if (!this.isEnabled()) {
            return { deleted_entities: [], added_entities: [] };
        }

        const filters = { userId };
        
        // Construct entityTypeMap from pre-extracted entities
        let entityTypeMap: Record<string, string> = {};
        for (const ent of entities) {
             entityTypeMap[ent.name] = ent.type;
        }
        
        // Normalize keys
        entityTypeMap = Object.fromEntries(
            Object.entries(entityTypeMap).map(([k, v]) => [
                k.toLowerCase().replace(/ /g, "_"),
                v.toLowerCase().replace(/ /g, "_"),
            ])
        );

        return this._processGraphInsertion(userId, data, entityTypeMap, filters);
    }

    private async _processGraphInsertion(
        userId: string,
        data: string,
        entityTypeMap: Record<string, string>,
        filters: Record<string, any>
    ): Promise<GraphMemoryResult> {
        const toBeAdded = await this._establishNodesRelationsFromData(
            data,
            filters,
            entityTypeMap
        );

        if (toBeAdded.length === 0) {
            return { deleted_entities: [], added_entities: [] };
        }

        // Search for existing related sub-graphs to check for contradictions
        const searchOutput = await this._searchGraphDb(
            Object.keys(entityTypeMap),
            filters
        );

        const toBeDeleted = await this._getDeleteEntitiesFromSearchOutput(
            searchOutput,
            data,
            filters
        );

        const deletedEntities = await this._deleteEntities(
            toBeDeleted,
            userId
        );

        const addedEntities = await this._addEntities(
            toBeAdded,
            userId,
            entityTypeMap
        );

        return {
            deleted_entities: deletedEntities,
            added_entities: addedEntities,
            relations: toBeAdded,
        };
    }

    async search(userId: string, query: string, limit = 100): Promise<any[]> {
        if (!this.isEnabled()) {
            return [];
        }

        const filters = { userId };
        const entityTypeMap = await this._retrieveNodesFromData(query, filters);

        // If no entities found in query, fallback to generic search or return empty?
        // mem0 returns empty if searchOutput is empty.
        const searchOutput = await this._searchGraphDb(
            Object.keys(entityTypeMap),
            filters
        );

        if (!searchOutput.length) {
            return [];
        }

        const searchOutputsSequence = searchOutput.map((item) => [
            item.source,
            item.relationship,
            item.destination,
        ]);

        const bm25 = new BM25(searchOutputsSequence);
        const tokenizedQuery = query.split(" ");
        const safeLimit = Math.max(0, Math.floor(limit));
        const rerankedResults = bm25.search(tokenizedQuery).slice(0, safeLimit);

        const searchResults = rerankedResults.map((item) => ({
            source: item[0],
            relationship: item[1],
            destination: item[2],
        }));

        logger.info(`Returned ${searchResults.length} search results`);
        return searchResults;
    }

    async deleteAll(userId: string) {
        if (!this.isEnabled() || !this.driver) return;
        const session = this.driver.session();
        try {
            await session.run("MATCH (n {user_id: $user_id}) DETACH DELETE n", {
                user_id: userId,
            });
        } finally {
            await session.close();
        }
    }

    // --- Internal Logic ---

    private async _retrieveNodesFromData(
        data: string,
        filters: Record<string, any>
    ): Promise<Record<string, string>> {
        const tools = [EXTRACT_ENTITIES_TOOL];
        const sysMsg = `You are a smart assistant who understands entities and their types in a given text.If user message contains self reference such as 'I', 'me', 'my' etc.then use ${filters["userId"]} as the source entity.Extract all the entities from the text. *** DO NOT *** answer the question itself if the given text is a question.`;

        const modelWithTools = (this.llm as any).bindTools(tools);
        const response = await modelWithTools.invoke([
            { role: "system", content: sysMsg },
            { role: "user", content: data }
        ]);

        let entityTypeMap: Record<string, string> = {};

        if (response.tool_calls) {
            for (const call of response.tool_calls) {
                if (call.name === "extract_entities") {
                    const args = call.args as any; // LangChain parses args automatically
                    // args should be { entities: [...] }
                    if (args.entities) {
                        for (const item of args.entities) {
                            entityTypeMap[item.entity] = item.entity_type;
                        }
                    }
                }
            }
        }

        // Normalize keys
        entityTypeMap = Object.fromEntries(
            Object.entries(entityTypeMap).map(([k, v]) => [
                k.toLowerCase().replace(/ /g, "_"),
                v.toLowerCase().replace(/ /g, "_"),
            ])
        );

        return entityTypeMap;
    }

    private async _establishNodesRelationsFromData(
        data: string,
        filters: Record<string, any>,
        entityTypeMap: Record<string, string>
    ): Promise<any[]> {
        let systemContent = EXTRACT_RELATIONS_PROMPT.replace("USER_ID", filters["userId"]);
        if (this.config.customPrompt) {
            systemContent = systemContent.replace("CUSTOM_PROMPT", `4. ${this.config.customPrompt} `);
        } else {
            systemContent = systemContent.replace("CUSTOM_PROMPT", "");
        }

        systemContent += "\nPlease provide your response using the establish_relationships tool.";

        const userContent = `List of known entities: ${Object.keys(entityTypeMap).join(", ")}.\n\nText: ${data} `;

        const tools = [RELATIONS_TOOL];
        const modelWithTools = (this.llm as any).bindTools(tools);

        const response = await modelWithTools.invoke([
            { role: "system", content: systemContent },
            { role: "user", content: userContent }
        ]);

        let entities: any[] = [];
        if (response.tool_calls && response.tool_calls.length > 0) {
            // Usually expects one call but loop just in case
            const call = response.tool_calls.find((c: any) => c.name === "establish_relationships");
            if (call) {
                const args = call.args as any;
                if (args.entities) {
                    entities = args.entities;
                }
            }
        }

        return this._removeSpacesFromEntities(entities);
    }

    private async _searchGraphDb(
        nodeList: string[],
        filters: Record<string, any>,
        limit = 100
    ): Promise<SearchOutput[]> {
        if (!this.driver) return [];

        const resultRelations: SearchOutput[] = [];
        const session = this.driver.session();

        try {
            for (const node of nodeList) {
                const nEmbedding = await this.embeddings.embedQuery(node);

                const cypher = `
MATCH(n)
          WHERE n.embedding IS NOT NULL AND n.user_id = $user_id
          WITH n,
    round(reduce(dot = 0.0, i IN range(0, size(n.embedding) - 1) | dot + n.embedding[i] * $n_embedding[i]) /
        (sqrt(reduce(l2 = 0.0, i IN range(0, size(n.embedding) - 1) | l2 + n.embedding[i] * n.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($n_embedding) - 1) | l2 + $n_embedding[i] * $n_embedding[i]))), 4) AS similarity
          WHERE similarity >= $threshold
MATCH(n) - [r] -> (m)
          RETURN n.name AS source, elementId(n) AS source_id, type(r) AS relationship, elementId(r) AS relation_id, m.name AS destination, elementId(m) AS destination_id, similarity
UNION
MATCH(n)
          WHERE n.embedding IS NOT NULL AND n.user_id = $user_id
          WITH n,
    round(reduce(dot = 0.0, i IN range(0, size(n.embedding) - 1) | dot + n.embedding[i] * $n_embedding[i]) /
        (sqrt(reduce(l2 = 0.0, i IN range(0, size(n.embedding) - 1) | l2 + n.embedding[i] * n.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($n_embedding) - 1) | l2 + $n_embedding[i] * $n_embedding[i]))), 4) AS similarity
          WHERE similarity >= $threshold
MATCH(m) - [r] -> (n)
          RETURN m.name AS source, elementId(m) AS source_id, type(r) AS relationship, elementId(r) AS relation_id, n.name AS destination, elementId(n) AS destination_id, similarity
          ORDER BY similarity DESC
          LIMIT toInteger($limit)
        `;

                const result = await session.run(cypher, {
                    n_embedding: nEmbedding,
                    threshold: this.threshold,
                    user_id: filters["userId"],
                    limit: Math.floor(Number(limit)),
                });

                resultRelations.push(
                    ...result.records.map((record) => ({
                        source: record.get("source"),
                        source_id: record.get("source_id").toString(),
                        relationship: record.get("relationship"),
                        relation_id: record.get("relation_id").toString(),
                        destination: record.get("destination"),
                        destination_id: record.get("destination_id").toString(),
                        similarity: record.get("similarity"),
                    }))
                );
            }
        } catch (e) {
            logger.error(`Error searching graph DB: ${e} `);
        } finally {
            await session.close();
        }

        return resultRelations;
    }

    private async _getDeleteEntitiesFromSearchOutput(
        searchOutput: SearchOutput[],
        data: string,
        filters: Record<string, any>
    ) {
        if (searchOutput.length === 0) return [];

        const searchOutputString = searchOutput
            .map(
                (item) =>
                    `${item.source} --${item.relationship} --${item.destination} `
            )
            .join("\n");

        const [systemPrompt, userPrompt] = getDeleteMessages(
            searchOutputString,
            data,
            filters["userId"]
        );

        const tools = [DELETE_MEMORY_TOOL_GRAPH];
        const modelWithTools = (this.llm as any).bindTools(tools);

        const response = await modelWithTools.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt + "\nUse delete_graph_memory tool to specify deletions." }
        ]);

        const toBeDeleted: any[] = [];
        if (response.tool_calls) {
            for (const item of response.tool_calls) {
                if (item.name === "delete_graph_memory") {
                    toBeDeleted.push(item.args);
                }
            }
        }

        return this._removeSpacesFromEntities(toBeDeleted);
    }

    private async _deleteEntities(toBeDeleted: any[], userId: string) {
        if (!this.driver || toBeDeleted.length === 0) return [];

        const results: any[] = [];
        const session = this.driver.session();

        try {
            for (const item of toBeDeleted) {
                const { source, destination, relationship } = item;
                // Be safe with names
                // NOTE: Dynamic relationship types in Cypher require apoc or careful handling.
                // Standard Cypher doesn't allow parameter for relationship type :$rel.
                // WE MUST BE CAREFUL. The original code interpolated it: -[r:${relationship}]->
                // This is a potential injection risk if LLM output is unchecked.
                // "relationship" comes from LLM.
                // We should validate it's simple chars.
                const safeRel = relationship.replace(/[^a-zA-Z0-9_]/g, "");

                const safeCypher = `
MATCH(n { name: $source_name, user_id: $user_id })
    - [r: ${safeRel}] ->
    (m { name: $dest_name, user_id: $user_id })
          DELETE r
RETURN
n.name AS source,
    m.name AS target,
        type(r) AS relationship
        `;

                const result = await session.run(safeCypher, {
                    source_name: source,
                    dest_name: destination,
                    user_id: userId,
                });

                results.push(result.records);
            }
        } catch (e) {
            logger.error(`Error deleting entities: ${e} `);
        } finally {
            await session.close();
        }

        return results;
    }

    private async _addEntities(
        toBeAdded: any[],
        userId: string,
        entityTypeMap: Record<string, string>
    ) {
        if (!this.driver || toBeAdded.length === 0) return [];
        const results: any[] = [];
        const session = this.driver.session();

        try {
            for (const item of toBeAdded) {
                const { source, destination, relationship } = item;
                const safeRel = relationship.replace(/[^a-zA-Z0-9_]/g, "");

                const sourceType = (entityTypeMap[source] || "unknown").replace(/[^a-zA-Z0-9_]/g, "");
                const destinationType = (entityTypeMap[destination] || "unknown").replace(/[^a-zA-Z0-9_]/g, "");

                const sourceEmbedding = await this.embeddings.embedQuery(source);
                const destEmbedding = await this.embeddings.embedQuery(destination);

                const sourceNodeSearchResult = await this._searchSourceNode(
                    sourceEmbedding,
                    userId
                );
                const destinationNodeSearchResult = await this._searchDestinationNode(
                    destEmbedding,
                    userId
                );

                let cypher: string;
                let params: Record<string, any>;

                if (
                    destinationNodeSearchResult.length === 0 &&
                    sourceNodeSearchResult.length > 0
                ) {
                    cypher = `
MATCH(source)
            WHERE elementId(source) = $source_id
MERGE(destination: ${destinationType} { name: $destination_name, user_id: $user_id })
            ON CREATE SET
destination.created = timestamp(),
    destination.embedding = $destination_embedding
MERGE(source) - [r: ${safeRel}] -> (destination)
            ON CREATE SET
r.created = timestamp()
            RETURN source.name AS source, type(r) AS relationship, destination.name AS target
    `;

                    params = {
                        source_id: sourceNodeSearchResult[0].elementId,
                        destination_name: destination,
                        destination_embedding: destEmbedding,
                        user_id: userId,
                    };
                } else if (
                    destinationNodeSearchResult.length > 0 &&
                    sourceNodeSearchResult.length === 0
                ) {
                    cypher = `
MATCH(destination)
            WHERE elementId(destination) = $destination_id
MERGE(source: ${sourceType} { name: $source_name, user_id: $user_id })
            ON CREATE SET
source.created = timestamp(),
    source.embedding = $source_embedding
MERGE(source) - [r: ${safeRel}] -> (destination)
            ON CREATE SET
r.created = timestamp()
            RETURN source.name AS source, type(r) AS relationship, destination.name AS target
    `;

                    params = {
                        destination_id: destinationNodeSearchResult[0].elementId,
                        source_name: source,
                        source_embedding: sourceEmbedding,
                        user_id: userId,
                    };
                } else if (
                    sourceNodeSearchResult.length > 0 &&
                    destinationNodeSearchResult.length > 0
                ) {
                    cypher = `
MATCH(source)
            WHERE elementId(source) = $source_id
MATCH(destination)
            WHERE elementId(destination) = $destination_id
MERGE(source) - [r: ${safeRel}] -> (destination)
            ON CREATE SET
r.created_at = timestamp(),
    r.updated_at = timestamp()
            RETURN source.name AS source, type(r) AS relationship, destination.name AS target
    `;

                    params = {
                        source_id: sourceNodeSearchResult[0]?.elementId,
                        destination_id: destinationNodeSearchResult[0]?.elementId,
                        user_id: userId,
                    };
                } else {
                    cypher = `
MERGE(n: ${sourceType} { name: $source_name, user_id: $user_id })
            ON CREATE SET n.created = timestamp(), n.embedding = $source_embedding
            ON MATCH SET n.embedding = $source_embedding
MERGE(m: ${destinationType} { name: $dest_name, user_id: $user_id })
            ON CREATE SET m.created = timestamp(), m.embedding = $dest_embedding
            ON MATCH SET m.embedding = $dest_embedding
MERGE(n) - [rel: ${safeRel}] -> (m)
            ON CREATE SET rel.created = timestamp()
            RETURN n.name AS source, type(rel) AS relationship, m.name AS target
          `;

                    params = {
                        source_name: source,
                        dest_name: destination,
                        source_embedding: sourceEmbedding,
                        dest_embedding: destEmbedding,
                        user_id: userId,
                    };
                }

                try {
                    const result = await session.run(cypher, params);
                    results.push(result.records);
                } catch (e) {
                    logger.error(`Error adding entity: ${e} `);
                }
            }
        } finally {
            await session.close();
        }

        return results;
    }

    private _removeSpacesFromEntities(entityList: any[]) {
        return entityList.map((item) => ({
            ...item,
            source: item.source.toLowerCase().replace(/ /g, "_"),
            relationship: item.relationship.toLowerCase().replace(/ /g, "_"),
            destination: item.destination.toLowerCase().replace(/ /g, "_"),
        }));
    }

    private async _searchSourceNode(
        sourceEmbedding: number[],
        userId: string,
        threshold = 0.9
    ) {
        if (!this.driver) return [];
        const session = this.driver.session();
        try {
            const cypher = `
MATCH(source_candidate)
        WHERE source_candidate.embedding IS NOT NULL 
        AND source_candidate.user_id = $user_id

        WITH source_candidate,
    round(
        reduce(dot = 0.0, i IN range(0, size(source_candidate.embedding) - 1) |
            dot + source_candidate.embedding[i] * $source_embedding[i]) /
        (sqrt(reduce(l2 = 0.0, i IN range(0, size(source_candidate.embedding) - 1) |
            l2 + source_candidate.embedding[i] * source_candidate.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($source_embedding) - 1) |
                l2 + $source_embedding[i] * $source_embedding[i])))
        , 4) AS source_similarity
        WHERE source_similarity >= $threshold

        WITH source_candidate, source_similarity
        ORDER BY source_similarity DESC
        LIMIT 1

        RETURN elementId(source_candidate) as element_id
`;

            const params = {
                source_embedding: sourceEmbedding,
                user_id: userId,
                threshold,
            };

            const result = await session.run(cypher, params);

            return result.records.map((record) => ({
                elementId: record.get("element_id").toString(),
            }));
        } finally {
            await session.close();
        }
    }

    private async _searchDestinationNode(
        destinationEmbedding: number[],
        userId: string,
        threshold = 0.9
    ) {
        if (!this.driver) return [];
        const session = this.driver.session();
        try {
            const cypher = `
MATCH(destination_candidate)
        WHERE destination_candidate.embedding IS NOT NULL 
        AND destination_candidate.user_id = $user_id

        WITH destination_candidate,
    round(
        reduce(dot = 0.0, i IN range(0, size(destination_candidate.embedding) - 1) |
            dot + destination_candidate.embedding[i] * $destination_embedding[i]) /
        (sqrt(reduce(l2 = 0.0, i IN range(0, size(destination_candidate.embedding) - 1) |
            l2 + destination_candidate.embedding[i] * destination_candidate.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($destination_embedding) - 1) |
                l2 + $destination_embedding[i] * $destination_embedding[i])))
        , 4) AS destination_similarity
        WHERE destination_similarity >= $threshold

        WITH destination_candidate, destination_similarity
        ORDER BY destination_similarity DESC
        LIMIT 1

        RETURN elementId(destination_candidate) as element_id
`;

            const params = {
                destination_embedding: destinationEmbedding,
                user_id: userId,
                threshold,
            };

            const result = await session.run(cypher, params);

            return result.records.map((record) => ({
                elementId: record.get("element_id").toString(),
            }));
        } finally {
            await session.close();
        }
    }
}
