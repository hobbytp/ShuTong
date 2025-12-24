import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getLLMConfigForMain } from "../config_manager";
import { vectorStorage } from "../storage/vector-storage";
import { PulseState } from "./schema";

// Define how state updates are handled (Reducers)
const graphStateChannels = {
    messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
    },
    relevant_activities: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => [],
    },
    target_card_type: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
    },
    user_intent: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
    },
    current_time: {
        reducer: (x: any, y: any) => y ?? x,
        default: () => new Date().toISOString(),
    }
};

export class PulseAgent {
    private graph: any;

    constructor() {
        this.graph = this.buildGraph();
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

        return workflow.compile();
    }

    /**
     * Node 1: Context Retrieval
     * Analyzes the latest user message and retrieves relevant context from VectorStorage
     */
    private async contextRetrievalNode(state: PulseState) {
        const lastMessage = state.messages[state.messages.length - 1];
        const query = lastMessage.content.toString();

        console.log(`[PulseAgent] Retrieving context for: "${query.substring(0, 50)}..."`);

        // Semantic search using the VectorStorage singleton
        const activities = await vectorStorage.search(query, 10);

        return {
            relevant_activities: activities
        };
    }

    /**
     * Node 2: Agent Reasoning
     * Uses the context to generate a response (or Pulse card)
     */
    private async agentReasoningNode(state: PulseState) {
        const { messages, relevant_activities, target_card_type } = state;

        // Construct the LLM client dynamically based on config
        const llm = this.getLLMClient();

        // Prepare context string
        const contextStr = relevant_activities.map(a =>
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
Current Context:
${contextStr || "No relevant recent activities found."}

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

            return { messages: [response] };
        }

        // DEFAULT: Chat Mode
        const systemPrompt = `You are ShuTong Pulse, an intelligent assistant that helps users reflect on their activities.
        
Current Context:
${contextStr || "No relevant recent activities found."}

Your goal is to answer the user's question based on the activity history provided above.
If the user asks for a summary, synthesize the information.
If the user asks specific questions, use the timestamps and details to answer accurately.
`;

        const response = await llm.invoke([
            new SystemMessage(systemPrompt),
            ...messages
        ]);

        return {
            messages: [response]
        };
    }

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

        // Pulse is expected to use the user-selected PULSE_AGENT role.
        // We only fall back to other roles/providers when PULSE_AGENT is not configured at all.
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
            // Strict: if user configured PULSE_AGENT, do not silently fall back.
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

    /**
     * Public API to run the agent conversationally
     */
    public async run(userMessage: string) {
        try {
            const result = await this.graph.invoke({
                messages: [new HumanMessage(userMessage)],
                current_time: new Date().toISOString()
            });

            // Return the last AI message content
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
     * Public API to generate a specific Pulse card type
     */
    public async generateCard(type: 'briefing' | 'action' | 'sprouting' | 'challenge') {
        // For card generation, we use an implicit query to pull relevant context
        const implicitQuery = type === 'briefing' ? "summary of today's activities" :
            type === 'action' ? "tasks and action items" :
                type === 'challenge' ? "distractions and inefficiencies" :
                    "recent important work and topics";

        const result = await this.graph.invoke({
            messages: [new HumanMessage(implicitQuery)],
            target_card_type: type,
            current_time: new Date().toISOString()
        });

        const lastMsg = result.messages[result.messages.length - 1];
        try {
            // Attempt to parse JSON content
            const content = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
            // Handle markdown code block wrapping
            const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("[PulseAgent] Failed to parse card JSON:", e);
            return { title: "Generation Result", content: lastMsg.content, suggested_actions: [] };
        }
    }
}

export const pulseAgent = new PulseAgent();

