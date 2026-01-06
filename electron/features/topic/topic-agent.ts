import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CompiledStateGraph, END, START, StateGraph } from "@langchain/langgraph";
import { ipcMain } from 'electron';
import { createCheckpointer, SQLiteCheckpointer } from '../pulse/agent/checkpointer';
import { memoryStore } from '../pulse/agent/memory-store';
import { SharedLLMClient } from '../shared/llm-client';
import { TopicState, topicStateChannels } from './agent/schema';
import { topicDiscoveryService } from './topic-discovery.service';

// Database for saving topics (Option B)
import { getDatabase } from '../../storage';

export class TopicAgent {
    private graph: CompiledStateGraph<TopicState, Partial<TopicState>, string>;
    private checkpointer: SQLiteCheckpointer;

    constructor() {
        this.checkpointer = createCheckpointer(); // Reuse Pulse's checkpointer logic
        this.graph = this.buildGraph();
        this.setupIPC();

        // Initialize MemoryStore lazily or rely on Main process to init it
        // Do NOT call memoryStore.init() here as it may run before DB is ready
        // memoryStore.init();
    }

    private setupIPC() {
        ipcMain.handle('topic:discover', async (_, query: string) => {
            // For now, assume a single user 'local' and default thread 'topic-session'
            // In future, UI can pass thread_id
            return await this.run(query, 'local', 'topic-session');
        });

        ipcMain.handle('topic:save', async (_, topicName: string) => {
            // Trigger SAVE intent manually via graph? 
            // Or just direct save if the UI calls this explicitly?
            // Let's use the graph to keep state consistent.
            return await this.run(`Save this as ${topicName}`, 'local', 'topic-session');
        });
    }

    // ============ Graph Definition ============

    private buildGraph() {
        // Define Graph
        const workflow = new StateGraph<TopicState>({
            channels: topicStateChannels
        })
            .addNode("intent_analysis", this.intentNode.bind(this))
            .addNode("search_tool", this.searchNode.bind(this))
            .addNode("filter_tool", this.filterNode.bind(this))
            .addNode("save_tool", this.saveNode.bind(this))
            .addNode("list_tool", this.listNode.bind(this))
            .addNode("edit_tool", this.editNode.bind(this))
            .addNode("view_tool", this.viewNode.bind(this))
            .addNode("chat_node", this.chatNode.bind(this))
            .addNode("response_generator", this.responseNode.bind(this))

            // Edges
            .addEdge(START, "intent_analysis")

            .addConditionalEdges(
                "intent_analysis",
                (state) => {
                    switch (state.user_intent) {
                        case 'SEARCH': return 'search_tool';
                        case 'FILTER': return 'filter_tool';
                        case 'SAVE': return 'save_tool';
                        case 'LIST': return 'list_tool';
                        case 'EDIT':
                        case 'DELETE': return 'edit_tool';
                        case 'VIEW': return 'view_tool';
                        case 'VIEW_ACTIVITIES': return 'search_tool';
                        case 'CHAT': return 'chat_node';
                        default: return 'chat_node';
                    }
                },
                // Explicit mapping for better graph visualization and validation
                {
                    search_tool: "search_tool",
                    filter_tool: "filter_tool",
                    save_tool: "save_tool",
                    list_tool: "list_tool",
                    edit_tool: "edit_tool",
                    view_tool: "view_tool",
                    chat_node: "chat_node"
                }
            )

            .addEdge("search_tool", "response_generator")
            .addEdge("filter_tool", "response_generator")
            .addEdge("save_tool", END)
            .addEdge("list_tool", END)
            .addEdge("edit_tool", END)
            .addEdge("view_tool", END)
            .addEdge("chat_node", END)
            .addEdge("response_generator", END);

        return workflow.compile({
            checkpointer: this.checkpointer
        });
    }

    // ============ Nodes ============

    /**
     * Node: Intent Analysis
     * Uses LLM to determine if user wants to SEARCH, FILTER, SAVE, or just CHAT.
     */
    private async intentNode(state: TopicState): Promise<Partial<TopicState>> {
        const lastMsg = state.messages[state.messages.length - 1];
        const query = lastMsg.content.toString();

        const llm = await SharedLLMClient.getClient('PULSE_AGENT');

        // Filter out internal metadata messages from history to avoid confusing the LLM
        const history = state.messages.filter(m => !(m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA')));

        // Memory-enhanced context retrieval
        let memoryContext = '';
        if (memoryStore.isReady()) {
            try {
                const [semanticMems, instructions] = await Promise.all([
                    memoryStore.recallSemanticMemories('local', query, 3),
                    memoryStore.getInstructions('local')
                ]);

                if (semanticMems.length > 0) {
                    memoryContext += 'User Preferences:\n' +
                        semanticMems.map(m => `- ${m.content}`).join('\n') + '\n\n';
                }
                if (instructions.length > 0) {
                    memoryContext += 'User Instructions:\n' +
                        instructions.map(i => `- ${i.instruction}`).join('\n') + '\n\n';
                }

                if (memoryContext) {
                    console.log(`[TopicAgent] Recalled ${semanticMems.length} memories, ${instructions.length} instructions`);
                }
            } catch (err) {
                console.warn('[TopicAgent] Memory recall failed:', err);
            }
        }

        // Current time context for temporal queries (placed in user message for KV cache efficiency)
        const now = new Date();
        const timeContext = `Current Time: ${now.toLocaleString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
            weekday: 'long', hour: '2-digit', minute: '2-digit'
        })}`;

        // Static system prompt (cacheable)
        const systemPrompt = `You are a Topic Selection Assistant for "ShuTong".
Your goal is to help users select a "Topic" (specific project(s) or domain(s) or both) from their activity history.

Classify the User's Intent into one of the following categories:
- SEARCH: User is looking for a new topic to CREATE or refine via keywords. (e.g. "Create a topic for my python work", "Find ShuTong stuff and save it")
- VIEW_ACTIVITIES: User wants to VIEW activity history without creating a topic. (e.g. "What did I do yesterday?", "Show me recent VS Code usage", "Search timeline for 'error'")
- FILTER: User wants to EXCLUDE specific items from the current list. (e.g. "Exclude Doubao", "Remove browser tabs", "No PDF files")
- SAVE: User explicitly confirms to save the current selection. (e.g. "Yes save it", "Sounds good", "Confirm")
- LIST: User wants to see all saved topics. (e.g. "Show me the topic list", "What topics do I have?")
- EDIT: User wants to rename a topic. (e.g. "Rename X to Y", "Change the name of topic X")
- DELETE: User wants to delete a topic. (e.g. "Delete topic X", "Remove topic Y")
- VIEW: User wants to view/filter timelapse by a saved TOPIC. (e.g. "Show timelapse of topic X", "Only show topic Y")
- CHAT: User is asking a general question or greeting. (e.g. "Hello", "How does this work?", "What is a Topic?")

Return JSON ONLY:
{
  "intent": "SEARCH" | "VIEW_ACTIVITIES" | "FILTER" | "SAVE" | "LIST" | "EDIT" | "DELETE" | "VIEW" | "CHAT",
  "search_query": string | null, // Extracted search keywords if SEARCH/VIEW_ACTIVITIES
  "exclude_terms": string[] | null, // Extracted terms to exclude if FILTER
  "topic_name": string | null, // Extracted name if SAVE/EDIT/VIEW (e.g. "Save as X", "Rename X", "Show topic X")
  "old_topic_name": string | null, // Target topic for rename/delete
  "new_topic_name": string | null // New name for rename
}`;

        // Dynamic user message (time + memory context)
        const dynamicContext = `${timeContext}
${memoryContext ? `\n${memoryContext}` : ''}
Based on the conversation above, classify the intent of the last message: "${query}". Return JSON ONLY.`;

        try {
            const response = await llm.invoke([
                new SystemMessage(systemPrompt),
                ...history,
                new HumanMessage(dynamicContext)
            ]);

            const text = response.content.toString();
            // Simple cleanup
            const jsonStr = text.replace(/`{3}json/g, '').replace(/`{3}/g, '').trim();
            const parsed = JSON.parse(jsonStr);

            // Store parsed params in a temp way or directly in state?
            // Ideally schema has 'extracted_params' but we can just use the reducer to pass data implicitly via messages?
            // No, better to add to state or handling it here.

            // Hack: Stick extraction results into a hidden system message or special property? 
            // Or just update 'user_intent' string and handle parameter extraction in the next node?
            // Let's pass parameters via a special SystemMessage injection or just re-extract in nodes.
            // BETTER: Add 'intent_params' to Schema. 
            // BUT: I can't change schema easily in this file without editing schema.ts.
            // WORKAROUND: Pass extracted data as a JSON string in 'user_intent' strictly for internal use? 
            // No, user_intent is typed.

            // Let's just return the intent and let nodes extract again? No that's wasteful.
            // Let's modify SEARCH node to look at the LAST message.
            // We can append a "ToolMessage" with the extraction?

            return {
                user_intent: parsed.intent || 'CHAT',
                // We'll attach the parsed structure as an AIMessage for the next node to read? 
                // Or I can update the 'current_draft' directly here? No, better separation of concerns.
                // Let's attach a temporary SystemMessage with the Metadata.
                messages: [new SystemMessage(JSON.stringify({ type: 'INTENT_METADATA', ...parsed }))]
            };

        } catch (e) {
            console.error("[TopicAgent] Intent parsing failed:", e);
            return { user_intent: 'CHAT' }; // Fallback
        }
    }

    /**
     * Node: Search
     * Executes TopicDiscoveryService based on query.
     */
    private async searchNode(state: TopicState): Promise<Partial<TopicState>> {
        // Find the metadata message
        const metaMsg = state.messages.find(m => m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA'));
        let query = "";
        if (metaMsg) {
            try {
                const meta = JSON.parse(metaMsg.content.toString());
                query = meta.search_query;
            } catch { }
        }

        // Fallback to last user message if no query extracted
        if (!query) {
            const lastUser = state.messages.reverse().find(m => m instanceof HumanMessage);
            query = lastUser?.content.toString() || "";
        }

        const contexts = await topicDiscoveryService.findMatchingWindows(query);

        // Handle VIEW_ACTIVITIES (Transient View)
        if (state.user_intent === 'VIEW_ACTIVITIES') {
            return {
                activity_view_list: {
                    items: contexts,
                    summary: `Found ${contexts.length} activities matching "${query}"`,
                    filter_criteria: query
                },
                // Clear draft if just viewing to avoid confusion
                current_draft: null
            };
        }

        // Handle SEARCH (Topic Creation/Refinement)
        const groups = topicDiscoveryService.groupContexts(contexts);
        return {
            current_draft: {
                originalQuery: query,
                groups,
                excludedEntities: []
            },
            activity_view_list: undefined // Clear view list if switching to draft mode
        };
    }

    /**
     * Node: Filter
     * Updates exclusions in current draft.
     */
    private async filterNode(state: TopicState): Promise<Partial<TopicState>> {
        if (!state.current_draft) return {}; // Can't filter nothing

        const metaMsg = state.messages.find(m => m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA'));
        let excludeTerms: string[] = [];

        if (metaMsg) {
            try {
                const meta = JSON.parse(metaMsg.content.toString());
                excludeTerms = meta.exclude_terms || [];
            } catch { }
        }

        // Apply Exclusions (using array to support JSON serialization)
        const existingExclusions = state.current_draft.excludedEntities || [];
        const newTerms = excludeTerms.map(t => t.toLowerCase()).filter(t => !existingExclusions.includes(t));
        const newExclusions = [...existingExclusions, ...newTerms];

        // We assume Groups objects are static entities. 
        // We filter them largely in the Response Generation or here.
        // Let's update the draft.

        return {
            current_draft: {
                ...state.current_draft,
                excludedEntities: newExclusions
            }
        };
    }

    /**
     * Node: Response Generator
     * Formats the available groups into a nice message.
     */
    private async responseNode(state: TopicState): Promise<Partial<TopicState>> {
        // Handle Activity View
        if (state.activity_view_list) {
            const { items, summary, filter_criteria } = state.activity_view_list;
            if (items.length === 0) {
                const msg = `No activities found for "${filter_criteria || 'your query'}".`;
                return {
                    final_response: msg,
                    messages: [new AIMessage(msg)]
                };
            }

            // Format activity list
            let msg = `### 🔍 Activity Results\n**${summary}**\n\n`;

            items.slice(0, 10).forEach(item => {
                // Formatting: [App] Title (Time)
                const dateStr = new Date(item.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' });
                msg += `- **${dateStr}** [${item.app}]: ${item.summary || item.title}\n`;
            });

            if (items.length > 10) msg += `\n*...and ${items.length - 10} more items.*\n`;

            msg += `\n*You can ask me to filter these results, or say "Save this as a topic" to create a saved topic.*`;

            return {
                final_response: msg,
                messages: [new AIMessage(msg)]
            };
        }

        const draft = state.current_draft;
        if (!draft) return { final_response: "No topics found." };

        // Filter Groups based on Exclusions
        const validGroups = draft.groups.filter(g => {
            const lowerEntity = g.entity.toLowerCase();
            for (const excluded of draft.excludedEntities) {
                if (lowerEntity.includes(excluded)) return false;
            }
            return true;
        });

        // Generate Summarized Text (LLM is Overkill here? Maybe, but good for "We found X, Y, Z...")
        // Let's use the code-based generator for speed and deterministic formatting, 
        // but maybe wrap it with a polite opening.

        const count = validGroups.reduce((sum, g) => sum + g.count, 0);

        if (count === 0) {
            return {
                final_response: "I couldn't find any activities matching that criteria.",
                messages: [new AIMessage("I couldn't find any activities matching that criteria.")]
            };
        }

        let msg = `I found **${count}** activities. Should I save this Topic?\n\n`;
        for (const group of validGroups) {
            msg += `**${group.entity}** (${group.count} items)\n`;
            group.contexts.slice(0, 3).forEach(ctx => {
                const display = group.type === 'project' ? ctx.title.split(' - ')[0] : ctx.title;
                msg += `- ${display}\n`;
            });
            if (group.count > 3) msg += `- ...and ${group.count - 3} more\n`;
            msg += "\n";
        }

        return {
            final_response: msg,
            messages: [new AIMessage(msg)]
        };
    }

    /**
     * Node: Save
     * Persists the topic to SQLite.
     */
    private async saveNode(state: TopicState): Promise<Partial<TopicState>> {
        const draft = state.current_draft;
        if (!draft) {
            return {
                final_response: "Nothing to save.",
                messages: [new AIMessage("There is no active topic to save.")]
            };
        }

        // Filter again to be sure (duplication of logic, but safest)
        const validGroups = draft.groups.filter(g => {
            const lowerEntity = g.entity.toLowerCase();
            for (const excluded of draft.excludedEntities) {
                if (lowerEntity.includes(excluded)) return false;
            }
            return true;
        });

        const contexts = validGroups.flatMap(g => g.contexts);
        const metaMsg = state.messages.find(m => m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA'));
        let topicName = `Topic ${new Date().toLocaleDateString()}`;
        if (metaMsg) {
            try { topicName = JSON.parse(metaMsg.content.toString()).topic_name || topicName; } catch { }
        }

        // DB Save Logic
        try {
            const db = getDatabase();
            if (!db) throw new Error("Database not initialized");

            // We assume table 'topics' exists with schema:
            // id (INTEGER PK), name (TEXT), definition (TEXT NOT NULL), color (TEXT), created_at (DATETIME)

            // Note: The previous SQLite error showed 'topics.definition' cannot be null.
            // Also, id is likely AUTOINCREMENT integer based on common schema patterns in this app.

            // Construct Definition JSON
            const definition = JSON.stringify({
                keywords: [topicName], // Simple keyword for now
                contexts: contexts.map(c => c.title) // Save explicit context titles
            });

            const stmt = db.prepare("INSERT INTO topics (name, definition, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
            const result = stmt.run(topicName, definition);

            // Use lastInsertRowid as ID if it's an integer PK, or generate one if needed. 
            // The previous error implies standard SQLite schema.
            const topicId = result.lastInsertRowid.toString();

            // Phase 2: Store episodic memory for future context
            if (memoryStore.isReady()) {
                try {
                    const { v4: uuidv4 } = await import('uuid');
                    await memoryStore.put(['local', 'memories'], uuidv4(), {
                        type: 'episodic',
                        content: `User saved topic "${topicName}" containing ${contexts.length} items from query "${draft.originalQuery}"`,
                        trigger_pattern: draft.originalQuery,
                        context_summary: `Topic: ${topicName}`,
                        created_at: Date.now(),
                        updated_at: Date.now()
                    });
                    console.log(`[TopicAgent] Stored episodic memory for topic "${topicName}"`);
                } catch (memErr) {
                    console.warn('[TopicAgent] Failed to store episodic memory:', memErr);
                }
            }

            const msg = `✅ Saved topic "**${topicName}**" with ${contexts.length} items.`;
            return {
                final_response: msg,
                current_draft: null, // Clear Draft
                messages: [new AIMessage(msg)],
                save_result: JSON.stringify({ success: true, topicId: topicId, message: msg })
            };

        } catch (err: any) {
            console.error("Save failed:", err);
            return {
                final_response: "Failed to save topic.",
                messages: [new AIMessage("Failed to save topic: " + err.message)]
            };
        }
    }

    /**
     * Node: List
     * Lists all saved topics.
     */
    private async listNode(_state: TopicState): Promise<Partial<TopicState>> {
        try {
            const db = getDatabase();
            if (!db) throw new Error("Database not initialized");

            const rows = db.prepare("SELECT name, created_at, definition FROM topics ORDER BY created_at DESC").all() as any[];

            if (rows.length === 0) {
                return {
                    final_response: "You haven't saved any topics yet.",
                    messages: [new AIMessage("You haven't saved any topics yet.")]
                };
            }

            let msg = `Found **${rows.length}** saved topics:\n\n`;
            rows.forEach(r => {
                const def = JSON.parse(r.definition || '{}');
                const count = def.contexts?.length || 0;
                msg += `- **${r.name}** (${count} items) - created ${r.created_at || 'N/A'}\n`;
            });

            return {
                final_response: msg,
                messages: [new AIMessage(msg)]
            };
        } catch (e: any) {
            console.error("List failed:", e);
            return {
                final_response: "Failed to list topics.",
                messages: [new AIMessage("Failed to retrieve topics.")]
            };
        }
    }

    /**
     * Node: Edit
     * Handles Rename and Delete operations.
     */
    private async editNode(state: TopicState): Promise<Partial<TopicState>> {
        const metaMsg = state.messages.find(m => m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA'));
        let params: any = {};
        if (metaMsg) {
            try { params = JSON.parse(metaMsg.content.toString()); } catch { }
        }

        const topicName = params.topic_name || params.old_topic_name;
        if (!topicName) {
            return { final_response: "Please specify which topic you want to change.", messages: [new AIMessage("Which topic?")] };
        }

        const db = getDatabase();
        if (!db) return { final_response: "Database error.", messages: [new AIMessage("Database not available.")] };

        try {
            if (state.user_intent === 'DELETE') {
                const info = db.prepare("DELETE FROM topics WHERE name = ?").run(topicName);
                if (info.changes > 0) {
                    const msg = `Topic "**${topicName}**" has been deleted.`;
                    return { final_response: msg, messages: [new AIMessage(msg)] };
                } else {
                    return { final_response: `Topic "**${topicName}**" not found.`, messages: [new AIMessage(`Topic "${topicName}" not found.`)] };
                }
            } else if (state.user_intent === 'EDIT') {
                const newName = params.new_topic_name;
                if (!newName) return { final_response: "Please provide a new name.", messages: [new AIMessage("What should the new name be?")] };

                const info = db.prepare("UPDATE topics SET name = ? WHERE name = ?").run(newName, topicName);
                if (info.changes > 0) {
                    const msg = `Topic renamed to "**${newName}**".`;
                    return { final_response: msg, messages: [new AIMessage(msg)] };
                } else {
                    return { final_response: `Topic "**${topicName}**" not found.`, messages: [new AIMessage(`Topic "${topicName}" not found.`)] };
                }
            }
        } catch (e: any) {
            return { final_response: "Operation failed.", messages: [new AIMessage(`Error: ${e.message}`)] };
        }

        return { final_response: "Unknown edit action." };
    }

    /**
     * Node: View
     * Loads a saved topic and returns it as active_filter for frontend filtering.
     */
    private async viewNode(state: TopicState): Promise<Partial<TopicState>> {
        const metaMsg = state.messages.find(m => m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA'));
        let params: any = {};
        if (metaMsg) {
            try { params = JSON.parse(metaMsg.content.toString()); } catch { }
        }

        const topicName = params.topic_name;
        if (!topicName) {
            return {
                final_response: "Please specify which topic you want to view.",
                messages: [new AIMessage("Which topic would you like to filter by?")]
            };
        }

        const db = getDatabase();
        if (!db) return { final_response: "Database error.", messages: [new AIMessage("Database not available.")] };

        try {
            const row = db.prepare("SELECT name, definition FROM topics WHERE name = ?").get(topicName) as any;

            if (!row) {
                return {
                    final_response: `Topic "${topicName}" not found. Use "show topic list" to see available topics.`,
                    messages: [new AIMessage(`Topic "${topicName}" not found.`)]
                };
            }

            const definition = JSON.parse(row.definition || '{}');
            const msg = `🔍 Filtering timelapse by topic "**${row.name}**".`;

            return {
                final_response: msg,
                messages: [new AIMessage(msg)],
                active_filter: {
                    name: row.name,
                    definition: definition
                }
            };
        } catch (e: any) {
            console.error("View failed:", e);
            return {
                final_response: "Failed to load topic.",
                messages: [new AIMessage(`Error: ${e.message}`)]
            };
        }
    }

    /**
     * Node: Chat
     * Handles general conversation.
     */
    private async chatNode(state: TopicState): Promise<Partial<TopicState>> {
        const llm = await SharedLLMClient.getClient('PULSE_AGENT');
        const response = await llm.invoke([
            new SystemMessage("You are a helpful assistant for the Topic Selector. Answer the user's question about Topics."),
            ...state.messages.filter(m => !(m instanceof SystemMessage && m.content.toString().includes('INTENT_METADATA')))
        ]);

        return {
            final_response: response.content.toString(),
            messages: [response]
        };
    }

    // ============ Public Runner ============

    public async run(userMessage: string, userId: string = 'local', threadId: string = 'default') {
        const result = await this.graph.invoke(
            {
                messages: [new HumanMessage(userMessage)],
                thread_id: threadId,
                // user_id: userId // Not in schema yet, but checkpointer might need it via config
            },
            {
                configurable: {
                    thread_id: threadId,
                    user_id: userId
                }
            }
        ) as unknown as TopicState;

        // Return format expected by IPC (TopicResponse)
        // Check if there was a save result
        if (result.save_result && result.user_intent === 'SAVE') {
            try {
                const saveRes = JSON.parse(result.save_result);
                return saveRes; // { success, message, topicId }
            } catch { }
        }


        return {
            message: result.final_response,
            contexts: result.current_draft?.groups?.flatMap((g: any) => g.contexts) || [],
            requiresConfirmation: (result.user_intent === 'SEARCH' || result.user_intent === 'FILTER'),
            active_filter: result.active_filter
        };
    }
}

export const topicAgent = new TopicAgent();
