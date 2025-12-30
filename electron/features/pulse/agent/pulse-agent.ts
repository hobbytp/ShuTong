/**
 * PulseAgent - Memory-Enhanced LangGraph Agent
 * 
 * A stateful conversational agent with:
 * - Long-term memory (semantic, episodic, procedural)
 * - Activity context from VectorStorage
 * - Conversation persistence via Checkpointer
 * - Background memory extraction (Option B)
 */

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getLLMConfigForMain } from "../../../config_manager";
import { vectorStorage } from "../../../storage/vector-storage";
import { createCheckpointer, SQLiteCheckpointer } from "./checkpointer";
import { MemoryProcessor } from "./memory-processor";
import { BaseStore, EpisodicMemory, Memory, memoryStore, ProceduralMemory, SemanticMemory } from "./memory-store";
import { graphStateChannels, PulseState } from "./schema";

// ============ PulseAgent Class ============

export class PulseAgent {
    private graph: any;
    private checkpointer: SQLiteCheckpointer;
    private memoryExtractionQueue: Array<{ userId: string; messages: BaseMessage[] }> = [];
    private extractionInterval: ReturnType<typeof setInterval> | null = null;
    private memoryProcessor: MemoryProcessor;

    constructor() {
        this.checkpointer = createCheckpointer();
        this.memoryProcessor = new MemoryProcessor({
            store: memoryStore,
            model: this.getLLMClient()
        });
        this.graph = this.buildGraph();
        this.startBackgroundMemoryExtraction();
    }

    public getCheckpointer(): SQLiteCheckpointer {
        return this.checkpointer;
    }

    public stop(): void {
        if (this.extractionInterval) {
            clearInterval(this.extractionInterval);
            this.extractionInterval = null;
        }
        if (this.checkpointer) {
            this.checkpointer.close();
        }
    }

    private buildGraph() {
        const workflow = new StateGraph<PulseState>({
            channels: graphStateChannels
        })
            .addNode("context_retrieval", this.contextRetrievalNode.bind(this))
            .addNode("agent_reasoning", this.agentReasoningNode.bind(this))
            .addEdge(START, "context_retrieval")
            .addEdge("context_retrieval", "agent_reasoning")
            .addEdge("agent_reasoning", END);

        // Compile with checkpointer for conversation persistence
        return workflow.compile({
            checkpointer: this.checkpointer,
            store: memoryStore as any
        });
    }

    // ============ Graph Nodes ============

    /**
     * Node 1: Context Retrieval
     * Retrieves relevant activity context from VectorStorage
     */
    private async contextRetrievalNode(state: PulseState) {
        const lastMessage = state.messages[state.messages.length - 1];
        const query = lastMessage?.content?.toString() || '';

        console.log(`[PulseAgent] Retrieving context for: "${query.substring(0, 50)}..."`);

        // Semantic search using the VectorStorage singleton
        const activities = await vectorStorage.search(query, 10);

        return {
            relevant_activities: activities
        };
    }

    /**
     * Node 3: Agent Reasoning
     * Uses memories and context to generate a response
     */
    private async agentReasoningNode(state: PulseState, config?: RunnableConfig) {
        const { messages, relevant_activities, target_card_type, user_id } = state;
        const userId = user_id || 'local';
        const store = (config as any)?.store as BaseStore;

        // Memory Recall Logic
        let recalled_memories: Memory[] = [];
        if (store) {
            const lastMessage = messages[messages.length - 1];
            const query = lastMessage?.content?.toString() || '';
            console.log(`[PulseAgent] Recalling memories for: "${query.substring(0, 50)}..."`);

            try {
                // 1. Instructions (Procedural)
                const instructionItems = await store.search([userId, 'instructions'], {
                    filter: { type: 'procedural' }
                });
                const instructions = (instructionItems || [])
                    .map(item => item.value as any as ProceduralMemory)
                    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

                // 2. Semantic Memories
                const semanticItems = query
                    ? await store.search([userId, 'memories'], {
                        query,
                        limit: 5,
                        filter: { type: 'semantic' }
                    })
                    : [];
                const semanticMemories = (semanticItems || []).map(item => item.value as any as SemanticMemory);

                // 3. Episodic Memories
                const episodicItems = query
                    ? await store.search([userId, 'memories'], {
                        query,
                        limit: 3,
                        filter: { type: 'episodic' }
                    })
                    : [];
                const episodicMemories = (episodicItems || []).map(item => item.value as any as EpisodicMemory);

                recalled_memories = [...instructions, ...semanticMemories, ...episodicMemories];
                console.log(`[PulseAgent] Recalled ${recalled_memories.length} memories`);
            } catch (err) {
                console.error('[PulseAgent] Memory recall failed:', err);
            }
        }

        // Trim messages to keep within context window (e.g. last 20)
        // But always keep the system message or first message if possible
        const MAX_MESSAGES = 20;
        let activeMessages = messages;
        if (messages.length > MAX_MESSAGES) {
            activeMessages = [
                messages[0], // Keep first message (likely system or first user query)
                ...messages.slice(-(MAX_MESSAGES - 1))
            ];
        }

        const llm = this.getLLMClient();

        // Build memory context string
        const memoryContext = this.buildMemoryContext(recalled_memories);

        // Build activity context string
        const activityContext = relevant_activities.map(a =>
            `- [${new Date(a.start_ts * 1000).toLocaleTimeString()}] ${a.title}: ${a.summary}`
        ).join("\n");

        // BRANCH: Card Generation Mode
        if (target_card_type) {
            const cardPrompts: Record<string, string> = {
                'briefing': "Generate a Daily Briefing summarizing the key activities and main focus of today.",
                'action': "Identify incomplete tasks or 'action items' from the context and list them.",
                'sprouting': "Connect these activities to broader topics or long-term goals. Generate a 'Sprouting' insight.",
                'challenge': "Identify potential distractions or inefficient patterns in the activities. Create a gentle 'Challenge'."
            };

            const systemPrompt = `You are ShuTong Pulse.

${memoryContext ? `User Preferences & Knowledge:\n${memoryContext}\n` : ''}
Current Activity Context:
${activityContext || "No relevant recent activities found."}

Task: ${cardPrompts[target_card_type] || "Analyze the activities."}

Return your response in strict JSON format:
{
  "title": "Short title for the card",
  "content": "Main text content (markdown allowed)",
  "suggested_actions": ["action 1", "action 2"]
}`;

            const response = await llm.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage("Generate the card.")
            ]);

            return {
                messages: [response],
                recalled_memories
            };
        }

        // DEFAULT: Chat Mode
        const systemPrompt = `You are ShuTong Pulse, an intelligent assistant that helps users reflect on their activities.

${memoryContext ? `User Preferences & Knowledge:\n${memoryContext}\n` : ''}
Recent Activity Context:
${activityContext || "No relevant recent activities found."}

Your goal is to answer the user's question based on the activity history provided above.
If the user asks for a summary, synthesize the information.
If the user asks specific questions, use the timestamps and details to answer accurately.
If the user expresses preferences or shares personal information, acknowledge it naturally.`;

        const response = await llm.invoke([
            new SystemMessage(systemPrompt),
            ...activeMessages
        ]);

        // Queue memory extraction in background (Option B)
        // Include the new AI response in the extraction context
        this.queueMemoryExtraction(user_id || 'local', [...activeMessages, response]);

        return {
            messages: [response],
            recalled_memories
        };
    }

    // ============ Memory Helpers ============

    private buildMemoryContext(memories: Memory[]): string {
        if (!memories || memories.length === 0) return '';

        const lines: string[] = [];

        // Group by type
        const procedural = memories.filter(m => m.type === 'procedural');
        const semantic = memories.filter(m => m.type === 'semantic');
        const episodic = memories.filter(m => m.type === 'episodic');

        if (procedural.length > 0) {
            lines.push('Instructions:');
            procedural.forEach(m => lines.push(`- ${m.content}`));
        }

        if (semantic.length > 0) {
            lines.push('Known Facts & Preferences:');
            semantic.forEach(m => lines.push(`- ${m.content}`));
        }

        if (episodic.length > 0) {
            lines.push('Past Interactions:');
            episodic.forEach(m => lines.push(`- ${m.content}`));
        }

        return lines.join('\n');
    }

    // ============ Background Memory Extraction (Option B) ============

    private queueMemoryExtraction(userId: string, messages: BaseMessage[]) {
        // Only queue if we have enough context (at least 2 messages)
        if (messages.length < 2) return;

        this.memoryExtractionQueue.push({
            userId,
            messages: [...messages] // Clone to avoid mutation
        });
        console.log(`[PulseAgent] Queued memory extraction, queue size: ${this.memoryExtractionQueue.length}`);
    }

    private startBackgroundMemoryExtraction() {
        // Process extraction queue every 30 seconds
        this.extractionInterval = setInterval(() => {
            this.processMemoryExtractionQueue();
        }, 30000);
    }

    private async processMemoryExtractionQueue() {
        if (this.memoryExtractionQueue.length === 0) return;

        const item = this.memoryExtractionQueue.shift();
        if (!item) return;

        try {
            await this.extractAndStoreMemories(item.userId, item.messages);
        } catch (err) {
            console.error('[PulseAgent] Memory extraction failed:', err);
        }
    }



    // ... existing methods ...

    private async extractAndStoreMemories(_userId: string, messages: BaseMessage[]) {
        if (!memoryStore.isReady()) {
            await memoryStore.init();
        }

        const conversationText = messages
            .map(m => {
                if (m instanceof HumanMessage) return `User: ${m.content}`;
                if (m instanceof AIMessage) return `Assistant: ${m.content}`;
                return '';
            })
            .filter(Boolean)
            .join('\n');

        console.log('[PulseAgent] Background extraction starting (Mem0 Style)...');

        try {
            // Stage 1: Atomic Fact Extraction
            const facts = await this.memoryProcessor.extractFacts(conversationText);

            if (facts.length === 0) {
                console.log('[PulseAgent] No new facts extracted.');
                return;
            }
            console.log(`[PulseAgent] Extracted ${facts.length} atomic facts:`, facts);

            // Stage 2: Conflict Resolution & Storage
            await this.memoryProcessor.processFacts(_userId, facts);

            console.log(`[PulseAgent] Mem0 processing complete.`);

        } catch (err) {
            console.error('[PulseAgent] Memory extraction failed:', err);
        }
    }

    // ============ LLM Client ============

    /**
     * Helper to get an initialized ChatOpenAI client
     * Uses 'PULSE_AGENT' role if available, or falls back to OpenAI default
     */
    private getLLMClient() {
        const config = getLLMConfigForMain();

        type ChatModel = {
            invoke(messages: BaseMessage[]): Promise<BaseMessage>;
        };

        const toTextContent = (content: any) => {
            if (typeof content === 'string') return content;
            try {
                return JSON.stringify(content);
            } catch {
                return String(content);
            }
        };

        const toPrompt = (messages: BaseMessage[]) => {
            return messages
                .map(m => {
                    const content = toTextContent((m as any).content);
                    if (m instanceof SystemMessage) return `System: ${content}`;
                    if (m instanceof HumanMessage) return `User: ${content}`;
                    return `Assistant: ${content}`;
                })
                .join('\n\n');
        };

        const createGeminiNativeModel = (opts: { apiKey: string; model: string; temperature: number }): ChatModel => {
            const apiKey = opts.apiKey;
            const model = opts.model;
            const temperature = opts.temperature;

            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            const parseRetryAfterMs = (errText: string) => {
                try {
                    const parsed = JSON.parse(errText);
                    const delay = parsed?.error?.details?.find((d: any) => typeof d?.retryDelay === 'string')?.retryDelay;
                    if (typeof delay === 'string') {
                        const m = delay.match(/(\d+(?:\.\d+)?)s/);
                        if (m) return Math.ceil(Number(m[1]) * 1000);
                    }
                } catch {
                    // ignore
                }

                const m1 = errText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
                if (m1) return Math.ceil(Number(m1[1]) * 1000);

                const m2 = errText.match(/Please retry in\s+(\d+(?:\.\d+)?)s/i);
                if (m2) return Math.ceil(Number(m2[1]) * 1000);

                return null;
            };

            return {
                async invoke(messages: BaseMessage[]) {
                    const prompt = toPrompt(messages);
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

                    const payload = {
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature }
                    };

                    let lastError: any;
                    const MAX_RETRIES = 3;

                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 60000);

                            const response = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload),
                                signal: controller.signal
                            });

                            clearTimeout(timeoutId);

                            if (!response.ok) {
                                const errText = await response.text();

                                if (response.status === 429) {
                                    const retryAfterHeader = response.headers.get('retry-after');
                                    const retryAfterHeaderMs = retryAfterHeader ? Math.ceil(Number(retryAfterHeader) * 1000) : null;
                                    const retryAfterMs = retryAfterHeaderMs ?? parseRetryAfterMs(errText) ?? (1000 * (attempt + 1));
                                    await sleep(retryAfterMs);
                                    continue;
                                }

                                throw new Error(`Gemini API Error ${response.status}: ${errText}`);
                            }

                            const data = await response.json();
                            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (typeof text !== 'string') {
                                throw new Error('Unexpected Gemini response format');
                            }

                            return new AIMessage(text);
                        } catch (err: any) {
                            lastError = err;
                            const msg = String(err?.message || err);
                            if (msg.startsWith('Gemini API Error')) throw err;
                            await sleep(1000 * (attempt + 1));
                        }
                    }

                    throw lastError;
                }
            };
        };

        const pickFirstModel = (provider: any): string | undefined => {
            const models = provider?.models ? Object.keys(provider.models) : [];
            return models.length > 0 ? models[0] : undefined;
        };

        const resolveModel = (providerName: string, requested: string | undefined): string => {
            const provider = (config.providers as any)?.[providerName];
            const fallback = pickFirstModel(provider) || 'gpt-4o';
            if (!requested) return fallback;
            if (provider?.models && !provider.models[requested]) {
                console.warn(
                    `[PulseAgent] Model "${requested}" not found in provider "${providerName}". Falling back to "${fallback}".`
                );
                return fallback;
            }
            return requested;
        };

        let selectedProviderName: string | undefined;
        let apiKey: string | undefined;
        let baseURL: string | undefined;
        let modelName: string | undefined;
        let temperature = 0.5;

        let geminiNative: ChatModel | undefined;

        const tryRole = (roleName: string): boolean => {
            const role = (config.roleConfigs as any)?.[roleName];
            if (!role) return false;
            const provider = (config.providers as any)?.[role.provider];
            if (!provider?.apiKey) {
                if (roleName === 'PULSE_AGENT') {
                    throw new Error(`LLM_API_KEY_MISSING:PULSE_AGENT:${role.provider}`);
                }
                return false;
            }

            if (role.provider === 'Google') {
                selectedProviderName = role.provider;
                console.log(
                    `[PulseAgent] Using provider=Google (native) model=${role.model} env=${provider.apiKeyEnv} envPresent=${Boolean(process.env[provider.apiKeyEnv])}`
                );
                geminiNative = createGeminiNativeModel({
                    apiKey: provider.apiKey,
                    model: role.model,
                    temperature: typeof role.temperature === 'number' ? role.temperature : temperature
                });
                return true;
            }

            if (!provider.openaiCompatible) {
                if (roleName === 'PULSE_AGENT') {
                    throw new Error(`LLM_PROVIDER_UNSUPPORTED:PULSE_AGENT:${role.provider}`);
                }
                console.warn(`[PulseAgent] Provider "${role.provider}" for role "${roleName}" is not supported; skipping.`);
                return false;
            }

            selectedProviderName = role.provider;
            apiKey = provider.apiKey;
            baseURL = provider.apiBaseUrl;
            modelName = resolveModel(role.provider, role.model);
            temperature = typeof role.temperature === 'number' ? role.temperature : temperature;

            let host = '';
            try {
                host = baseURL ? new URL(baseURL).host : '';
            } catch {
                host = '';
            }
            console.log(
                `[PulseAgent] Using provider=${selectedProviderName} model=${modelName} baseURLHost=${host} env=${provider.apiKeyEnv} envPresent=${Boolean(process.env[provider.apiKeyEnv])}`
            );
            return true;
        };

        const hasPulseRole = Boolean((config.roleConfigs as any)?.PULSE_AGENT);
        if (hasPulseRole) {
            tryRole('PULSE_AGENT');
        } else {
            tryRole('DEEP_THINKING');
        }

        if (geminiNative) {
            return geminiNative;
        }

        // Fallback to OpenAI provider
        if (!apiKey) {
            const providerName = 'OpenAI';
            const provider = (config.providers as any)?.[providerName];
            if (provider?.apiKey && provider.openaiCompatible) {
                selectedProviderName = providerName;
                apiKey = provider.apiKey;
                baseURL = provider.apiBaseUrl;
                modelName = provider.models?.['gpt-4o'] ? 'gpt-4o' : resolveModel(providerName, undefined);
            }
        }

        // Fallback to any openaiCompatible provider
        if (!apiKey) {
            for (const [name, provider] of Object.entries(config.providers || {})) {
                const anyProvider: any = provider;
                if (anyProvider.openaiCompatible && anyProvider.apiKey) {
                    selectedProviderName = name;
                    apiKey = anyProvider.apiKey;
                    baseURL = anyProvider.apiBaseUrl;
                    modelName = resolveModel(name, undefined);
                    break;
                }
            }
        }

        if (!apiKey) {
            throw new Error('LLM_API_KEY_MISSING');
        }

        if (!selectedProviderName) {
            selectedProviderName = 'Unknown';
        }

        if (!modelName) {
            modelName = 'gpt-4o';
        }

        return new ChatOpenAI({
            apiKey,
            configuration: { baseURL },
            modelName,
            temperature
        });
    }

    // ============ Public API ============

    /**
     * Run the agent conversationally with memory support
     */
    public async run(userMessage: string, options?: { thread_id?: string; user_id?: string }) {
        try {
            const threadId = options?.thread_id || 'default';
            const userId = options?.user_id || 'local';

            const result = await this.graph.invoke(
                {
                    messages: [new HumanMessage(userMessage)],
                    current_time: new Date().toISOString(),
                    thread_id: threadId,
                    user_id: userId
                },
                {
                    configurable: {
                        thread_id: threadId,
                        user_id: userId
                    }
                }
            );

            const lastMsg = result.messages[result.messages.length - 1];
            return lastMsg.content;
        } catch (err: any) {
            if (err?.message === 'LLM_API_KEY_MISSING') {
                return 'LLM is not configured. Please set an API key in Settings.';
            }
            throw err;
        }
    }

    /**
     * Generate a specific Pulse card type
     */
    public async generateCard(
        type: 'briefing' | 'action' | 'sprouting' | 'challenge',
        options?: { user_id?: string }
    ) {
        const implicitQuery = type === 'briefing' ? "summary of today's activities" :
            type === 'action' ? "tasks and action items" :
                type === 'challenge' ? "distractions and inefficiencies" :
                    "recent important work and topics";

        const userId = options?.user_id || 'local';
        // Use a dedicated thread for card generation to avoid polluting conversation history
        // or use a random one if we don't want persistence at all.
        // For now, let's use a fixed one per card type to allow some continuity if needed,
        // or just 'card-generation' to keep it simple.
        const threadId = `card-gen-${type}-${new Date().toISOString().split('T')[0]}`;

        const result = await this.graph.invoke(
            {
                messages: [new HumanMessage(implicitQuery)],
                target_card_type: type,
                current_time: new Date().toISOString(),
                user_id: userId
            },
            {
                configurable: {
                    thread_id: threadId,
                    user_id: userId
                }
            }
        );

        const lastMsg = result.messages[result.messages.length - 1];
        try {
            const content = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
            const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("[PulseAgent] Failed to parse card JSON:", e);
            return { title: "Generation Result", content: lastMsg.content, suggested_actions: [] };
        }
    }

    /**
     * Get conversation threads
     */
    public getThreads(): string[] {
        return this.checkpointer.getThreadIds();
    }

    /**
     * Delete a conversation thread
     */
    public async deleteThread(threadId: string): Promise<void> {
        await this.checkpointer.deleteThread(threadId);
    }

    /**
     * Reset the agent state:
     * 1. Clear conversation history (checkpoints)
     * 2. Clear pending memory extraction queue
     */
    public reset(): void {
        this.checkpointer.reset();
        this.memoryExtractionQueue = [];
        console.log('[PulseAgent] Reset agent state and cleared memory queue');
    }

    /**
     * Cleanup resources
     */
    public cleanup() {
        if (this.extractionInterval) {
            clearInterval(this.extractionInterval);
            this.extractionInterval = null;
        }
        this.checkpointer.close();
    }
}

export const pulseAgent = new PulseAgent();
