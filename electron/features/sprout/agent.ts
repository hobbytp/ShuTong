import { StateGraph, END, START, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage } from "@langchain/core/messages";
import { AgentPersona, SproutReport, AutoExpertConfig, DEFAULT_AUTO_EXPERT_STATE } from "./schema";
import { SupervisorNode } from "./nodes/supervisor";
import { ExpertNode } from "./nodes/expert";
import { SynthesizerNode } from "./nodes/synthesizer";
import { contextRetrievalNode } from "./nodes/context";
import { createCheckpointer } from "../pulse/agent/checkpointer"; // Reuse checkpointer
import { getLLMConfigForMain } from "../../config_manager";

// Define State using Annotation API (LangGraph v1.0+)
const SproutStateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    seed: Annotation<string>({
        reducer: (_, y) => y ?? _,
        default: () => '',
    }),
    context_summary: Annotation<string>({
        reducer: (_, y) => y ?? _,
        default: () => '',
    }),
    experts: Annotation<AgentPersona[]>({
        reducer: (x, y) => {
            const combined = [...(x || []), ...(y || [])];
            const unique = new Map();
            combined.forEach((e: AgentPersona) => unique.set(e.id, e));
            return Array.from(unique.values());
        },
        default: () => [],
    }),
    next_speaker: Annotation<string | undefined>({
        reducer: (_, y) => y ?? _,
        default: () => undefined,
    }),
    report: Annotation<SproutReport | undefined>({
        reducer: (_, y) => y ?? _,
        default: () => undefined,
    }),
    config: Annotation<AutoExpertConfig>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({ dynamism: 'default', execution_mode: 'sequential', max_rounds: 3, expansion_level: 'none', language: 'en' }),
    }),
    current_round: Annotation<number>({
        reducer: (_, y) => y ?? _,
        default: () => 0,
    }),
    thread_id: Annotation<string>({
        reducer: (_, y) => y ?? _,
        default: () => 'default',
    }),
    user_id: Annotation<string>({
        reducer: (_, y) => y ?? _,
        default: () => 'local',
    }),
});

// Infer State type from Annotation
type SproutState = typeof SproutStateAnnotation.State;

export class AutoExpertAgent {
    // Checkpointer can be shared or per-session, but for now we keep it shared for simplicity
    private checkpointer: any;

    constructor() {
        this.checkpointer = createCheckpointer();
    }

    private getLLMClient(targetRole: string) {
        const config = getLLMConfigForMain();

        // Use requested role, or fallback to 'OpenAI' ONLY if default exists? 
        // User requested REMOVING fallback to gpt-4o.
        const roleConfig = config.roleConfigs?.[targetRole];

        if (!roleConfig) {
            // Throw error so UI knows
            throw new Error(`[Sprout] Configuration missing for Role: "${targetRole}". Please check your LLM settings.`);
        }

        const providerName = roleConfig.provider;
        const providerConfig = config.providers[providerName];

        if (!providerConfig) {
            throw new Error(`[Sprout] Provider "${providerName}" (for Role "${targetRole}") not found in configuration.`);
        }

        let apiKey = providerConfig.apiKey || process.env[providerConfig.apiKeyEnv];
        let baseURL = providerConfig.apiBaseUrl;

        // Clean Inputs
        if (baseURL && baseURL.endsWith('/')) {
            baseURL = baseURL.slice(0, -1);
        }
        if (apiKey) {
            apiKey = apiKey.trim();
        }

        console.log(`[Sprouts] Role: ${targetRole}`);
        console.log(`[Sprouts] Provider: ${providerName}`);
        console.log(`[Sprouts] Model: ${roleConfig.model}`);
        console.log(`[Sprouts] BaseURL: ${baseURL || '(default)'}`);
        console.log(`[Sprouts] API Key: ${apiKey ? `${apiKey.substring(0, 8)}***` : '⚠️ NOT SET!'}`);

        // Validate API key
        if (!apiKey) {
            console.error(`[Sprouts] ⚠️ WARNING: No API key for provider "${providerName}"!`);
            console.error(`[Sprouts] Set environment variable: ${providerConfig.apiKeyEnv}`);
        }

        const client = new ChatOpenAI({
            configuration: {
                apiKey: apiKey,
                baseURL: baseURL,
            },
            model: roleConfig.model,
            temperature: roleConfig.temperature || 0.7
        });

        return {
            client,
            metadata: {
                role: targetRole,
                provider: providerName,
                modelName: roleConfig.model
            }
        };
    }

    private buildGraph() {
        const mgr = this.getLLMClient('SPROUT_MGR_AGENT');
        const expert = this.getLLMClient('SPROUT_AGENT');
        const reporter = this.getLLMClient('SPROUT_REPORTOR');

        const supervisor = new SupervisorNode(mgr.client, mgr.metadata);
        const expertNode = new ExpertNode(expert.client, expert.metadata);
        const synthesizer = new SynthesizerNode(reporter.client, reporter.metadata);

        const workflow = new StateGraph(SproutStateAnnotation)
            .addNode("context", contextRetrievalNode)
            .addNode("supervisor", supervisor.run.bind(supervisor))
            .addNode("expert", expertNode.run.bind(expertNode))
            .addNode("synthesizer", synthesizer.run.bind(synthesizer))

            // Edges
            .addEdge(START, "context")
            .addEdge("context", "supervisor")

            // Conditional Edge from Supervisor
            .addConditionalEdges(
                "supervisor",
                (state: SproutState) => {
                    if (state.next_speaker === 'Synthesizer') return 'synthesizer';
                    return 'expert';
                },
                {
                    expert: "expert",
                    synthesizer: "synthesizer"
                }
            )

            // Edge from Expert back to Supervisor
            .addEdge("expert", "supervisor")

            .addEdge("synthesizer", END);

        return workflow.compile({ checkpointer: this.checkpointer });
    }

    public async startSession(seed: string, threadId: string = 'new', config?: Partial<AutoExpertConfig>) {
        // Build graph specifically for this session to capture latest config
        const graph = this.buildGraph();

        const defaultConfig = DEFAULT_AUTO_EXPERT_STATE.config!;
        const mergedConfig: AutoExpertConfig = {
            ...defaultConfig,
            ...config
        } as AutoExpertConfig;

        const initialState = {
            ...DEFAULT_AUTO_EXPERT_STATE,
            seed,
            thread_id: threadId,
            config: mergedConfig
        };

        return await graph.invoke(initialState, { configurable: { thread_id: threadId } });
    }

    public async *streamSession(seed: string, threadId: string = 'new', config?: Partial<AutoExpertConfig>) {
        // Build graph specifically for this session to capture latest config
        const graph = this.buildGraph();

        const defaultConfig = DEFAULT_AUTO_EXPERT_STATE.config!;
        const mergedConfig: AutoExpertConfig = {
            ...defaultConfig,
            ...config
        } as AutoExpertConfig;

        const initialState = {
            ...DEFAULT_AUTO_EXPERT_STATE,
            seed,
            thread_id: threadId,
            config: mergedConfig
        };

        const stream = await graph.stream(initialState, { configurable: { thread_id: threadId } });

        for await (const chunk of stream) {
            yield chunk;
        }
    }
}

export const autoExpertAgent = new AutoExpertAgent();

