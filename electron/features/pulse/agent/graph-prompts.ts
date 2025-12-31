import { z } from "zod";

// --- Tool Definitions (JSON Schema) ---

// Note: These definitions align with OpenAI's function calling format
export const UPDATE_MEMORY_TOOL_GRAPH = {
    type: "function",
    function: {
        name: "update_graph_memory",
        description: "Update the relationship key of an existing graph memory based on new information.",
        parameters: {
            type: "object",
            properties: {
                source: {
                    type: "string",
                    description: "The identifier of the source node in the relationship to be updated.",
                },
                destination: {
                    type: "string",
                    description: "The identifier of the destination node in the relationship to be updated.",
                },
                relationship: {
                    type: "string",
                    description: "The new or updated relationship between the source and destination nodes.",
                },
            },
            required: ["source", "destination", "relationship"],
            additionalProperties: false,
        },
    },
};

export const ADD_MEMORY_TOOL_GRAPH = {
    type: "function",
    function: {
        name: "add_graph_memory",
        description: "Add a new graph memory to the knowledge graph.",
        parameters: {
            type: "object",
            properties: {
                source: {
                    type: "string",
                    description: "The identifier of the source node in the new relationship.",
                },
                destination: {
                    type: "string",
                    description: "The identifier of the destination node in the new relationship.",
                },
                relationship: {
                    type: "string",
                    description: "The type of relationship between the source and destination nodes.",
                },
                source_type: {
                    type: "string",
                    description: "The type or category of the source node.",
                },
                destination_type: {
                    type: "string",
                    description: "The type or category of the destination node.",
                },
            },
            required: [
                "source",
                "destination",
                "relationship",
                "source_type",
                "destination_type",
            ],
            additionalProperties: false,
        },
    },
};

export const RELATIONS_TOOL = {
    type: "function",
    function: {
        name: "establish_relationships",
        description: "Establish relationships among the entities based on the provided text.",
        parameters: {
            type: "object",
            properties: {
                entities: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            source: {
                                type: "string",
                                description: "The source entity of the relationship.",
                            },
                            relationship: {
                                type: "string",
                                description: "The relationship between the source and destination entities.",
                            },
                            destination: {
                                type: "string",
                                description: "The destination entity of the relationship.",
                            },
                        },
                        required: ["source", "relationship", "destination"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["entities"],
            additionalProperties: false,
        },
    },
};

export const EXTRACT_ENTITIES_TOOL = {
    type: "function",
    function: {
        name: "extract_entities",
        description: "Extract entities and their types from the text.",
        parameters: {
            type: "object",
            properties: {
                entities: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            entity: {
                                type: "string",
                                description: "The name or identifier of the entity.",
                            },
                            entity_type: {
                                type: "string",
                                description: "The type or category of the entity.",
                            },
                        },
                        required: ["entity", "entity_type"],
                        additionalProperties: false,
                    },
                    description: "An array of entities with their types.",
                },
            },
            required: ["entities"],
            additionalProperties: false,
        },
    },
};

export const DELETE_MEMORY_TOOL_GRAPH = {
    type: "function",
    function: {
        name: "delete_graph_memory",
        description: "Delete the relationship between two nodes.",
        parameters: {
            type: "object",
            properties: {
                source: {
                    type: "string",
                    description: "The identifier of the source node in the relationship.",
                },
                relationship: {
                    type: "string",
                    description: "The existing relationship between the source and destination nodes that needs to be deleted.",
                },
                destination: {
                    type: "string",
                    description: "The identifier of the destination node in the relationship.",
                },
            },
            required: ["source", "relationship", "destination"],
            additionalProperties: false,
        },
    },
};

// --- Zod Schemas for structured output parsing ---

export const ExtractEntitiesSchema = z.object({
    entities: z.array(z.object({
        entity: z.string(),
        entity_type: z.string()
    }))
});

export const EstablishRelationshipsSchema = z.object({
    entities: z.array(z.object({
        source: z.string(),
        relationship: z.string(),
        destination: z.string()
    }))
});

export const DeleteGraphMemoryArgsSchema = z.object({
    source: z.string(),
    relationship: z.string(),
    destination: z.string()
});

// --- Prompts ---

export const UPDATE_GRAPH_PROMPT = `
You are an AI expert specializing in graph memory management and optimization. Your task is to analyze existing graph memories alongside new information, and update the relationshions in the memory list to ensure the most accurate, current, and coherent representation of knowledge.

Input:
1. Existing Graph Memories: A list of current graph memories, each containing source, target, and relationship information.
2. New Graph Memory: Fresh information to be integrated into the existing graph structure.

Guidelines:
1. Identification: Use the source and target as primary identifiers when matching existing memories with new information.
2. Conflict Resolution:
   - If new information contradicts an existing memory:
     a) For matching source and target but differing content, update the relationship of the existing memory.
     b) If the new memory provides more recent or accurate information, update the existing memory accordingly.
3. Comprehensive Review: Thoroughly examine each existing graph memory against the new information, updating relationships as necessary. Multiple updates may be required.
4. Consistency: Maintain a uniform and clear style across all memories. Each entry should be concise yet comprehensive.
5. Semantic Coherence: Ensure that updates maintain or improve the overall semantic structure of the graph.
6. Temporal Awareness: If timestamps are available, consider the recency of information when making updates.
7. Relationship Refinement: Look for opportunities to refine relationship descriptions for greater precision or clarity.
8. Redundancy Elimination: Identify and merge any redundant or highly similar relationships that may result from the update.

Memory Format:
source -- RELATIONSHIP -- destination

Task Details:
======= Existing Graph Memories:=======
{existing_memories}

======= New Graph Memory:=======
{new_memories}

Output:
Provide a list of update instructions, each specifying the source, target, and the new relationship to be set. Only include memories that require updates.
`;

export const EXTRACT_RELATIONS_PROMPT = `
You are an advanced algorithm designed to extract structured information from text to construct knowledge graphs. Your goal is to capture comprehensive and accurate information. Follow these key principles:

1. Extract only explicitly stated information from the text.
2. Establish relationships among the entities provided.
3. Use "USER_ID" as the source entity for any self-references (e.g., "I," "me," "my," etc.) in user messages.
CUSTOM_PROMPT

Relationships:
    - Use consistent, general, and timeless relationship types.
    - Example: Prefer "professor" over "became_professor."
    - Relationships should only be established among the entities explicitly mentioned in the user message.

Entity Consistency:
    - Ensure that relationships are coherent and logically align with the context of the message.
    - Maintain consistent naming for entities across the extracted data.

Strive to construct a coherent and easily understandable knowledge graph by establishing all the relationships among the entities and adherence to the user's context.

Adhere strictly to these guidelines to ensure high-quality knowledge graph extraction.
`;

export const DELETE_RELATIONS_SYSTEM_PROMPT = `
You are a graph memory manager specializing in identifying, managing, and optimizing relationships within graph-based memories. Your primary task is to analyze a list of existing relationships and determine which ones should be deleted based on the new information provided.
Input:
1. Existing Graph Memories: A list of current graph memories, each containing source, relationship, and destination information.
2. New Text: The new information to be integrated into the existing graph structure.
3. Use "USER_ID" as node for any self-references (e.g., "I," "me," "my," etc.) in user messages.

Guidelines:
1. Identification: Use the new information to evaluate existing relationships in the memory graph.
2. Deletion Criteria: Delete a relationship only if it meets at least one of these conditions:
   - Outdated or Inaccurate: The new information is more recent or accurate.
   - Contradictory: The new information conflicts with or negates the existing information.
3. DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes.
4. Comprehensive Analysis:
   - Thoroughly examine each existing relationship against the new information and delete as necessary.
   - Multiple deletions may be required based on the new information.
5. Semantic Integrity:
   - Ensure that deletions maintain or improve the overall semantic structure of the graph.
   - Avoid deleting relationships that are NOT contradictory/outdated to the new information.
6. Temporal Awareness: Prioritize recency when timestamps are available.
7. Necessity Principle: Only DELETE relationships that must be deleted and are contradictory/outdated to the new information to maintain an accurate and coherent memory graph.

Note: DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes. 

For example: 
Existing Memory: alice -- loves_to_eat -- pizza
New Information: Alice also loves to eat burger.

Do not delete in the above example because there is a possibility that Alice loves to eat both pizza and burger.

Memory Format:
source -- relationship -- destination

Provide a list of deletion instructions, each specifying the relationship to be deleted.
`;

export function getDeleteMessages(
    existingMemoriesString: string,
    data: string,
    userId: string,
): [string, string] {
    return [
        DELETE_RELATIONS_SYSTEM_PROMPT.replace("USER_ID", userId),
        `Here are the existing memories: ${existingMemoriesString} \n\n New Information: ${data}`,
    ];
}

export function formatEntities(
    entities: Array<{
        source: string;
        relationship: string;
        destination: string;
    }>,
): string {
    return entities
        .map((e) => `${e.source} -- ${e.relationship} -- ${e.destination}`)
        .join("\n");
}
