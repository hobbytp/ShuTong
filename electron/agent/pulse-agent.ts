import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getMergedLLMConfig } from "../config_manager";
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
        const config = getMergedLLMConfig();

        // Try to find a suitable configuration
        // Priority: PULSE_AGENT -> DEEP_THINKING -> OpenAI Provider
        let apiKey: string | undefined;
        let baseURL: string | undefined;
        let modelName = "gpt-4o";

        // Check for role config
        const role = config.roleConfigs?.['PULSE_AGENT'] || config.roleConfigs?.['DEEP_THINKING'];
        if (role) {
            const provider = config.providers[role.provider];
            if (provider?.apiKey) {
                apiKey = provider.apiKey;
                baseURL = provider.apiBaseUrl;
                modelName = role.model || modelName;
            }
        }

        // Fallback to OpenAI direct
        if (!apiKey && config.providers['OpenAI']?.apiKey) {
            apiKey = config.providers['OpenAI'].apiKey;
            baseURL = config.providers['OpenAI'].apiBaseUrl;
            modelName = "gpt-4o";
        }

        // Fallback to any compatible provider
        if (!apiKey) {
            for (const [, provider] of Object.entries(config.providers)) {
                if (provider.openaiCompatible && provider.hasKey && provider.apiKey) {
                    apiKey = provider.apiKey;
                    baseURL = provider.apiBaseUrl;
                    break;
                }
            }
        }

        if (!apiKey) {
            // Avoid triggering noisy 401s with a dummy key.
            throw new Error('LLM_API_KEY_MISSING');
        }

        return new ChatOpenAI({
            openAIApiKey: apiKey,
            configuration: { baseURL },
            modelName: modelName,
            temperature: 0.5
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

