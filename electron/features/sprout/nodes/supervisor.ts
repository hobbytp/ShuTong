import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AutoExpertState, AgentPersona } from "../schema";
import { RunnableConfig } from "@langchain/core/runnables";

export class SupervisorNode {
    private model: ChatOpenAI;
    private metadata: any;

    constructor(model: ChatOpenAI, metadata?: any) {
        this.model = model;
        this.metadata = metadata;
    }

    public async run(state: AutoExpertState, _config?: RunnableConfig) {
        const { experts, config: appConfig, current_round, messages } = state;

        console.log('[Supervisor] ------ RUN START ------');
        console.log('[Supervisor] experts count:', experts.length);
        console.log('[Supervisor] messages count:', messages.length);
        console.log('[Supervisor] current_round:', current_round);
        console.log('[Supervisor] max_rounds:', appConfig.max_rounds);

        // If experts are already assigned and we are in sequential mode, we might just be passing through
        const isInitial = experts.length === 0;

        if (isInitial) {
            console.log('[Supervisor] Initial recruitment...');
            return this.initialRecruitment(state);
        }

        let nextRound = current_round;
        if (nextRound === 0) nextRound = 1;

        // Get expert names for filtering
        const expertNames = experts.map(e => e.name);

        // Only count messages from ACTUAL experts, not tool calls or other system messages
        const expertMessages = messages.filter(m => m.name && expertNames.includes(m.name));
        const totalTurns = expertMessages.length;
        const maxTurns = experts.length * (appConfig.max_rounds || 3);

        console.log('[Supervisor] expertNames:', expertNames);
        console.log('[Supervisor] expertMessages count:', totalTurns);
        console.log('[Supervisor] maxTurns:', maxTurns);

        if (totalTurns >= maxTurns) {
            console.log('[Supervisor] Max turns reached, going to Synthesizer');
            return { next_speaker: 'Synthesizer' };
        }

        // Find the last ACTUAL expert speaker (not tool calls like web_search)
        let lastExpertSpeaker: string | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msgName = messages[i]?.name;
            if (msgName && expertNames.includes(msgName)) {
                lastExpertSpeaker = msgName;
                break;
            }
        }
        console.log('[Supervisor] lastExpertSpeaker:', lastExpertSpeaker);

        // --- Dynamic Expansion Logic ---
        // Check if we should consider adding an expert
        // Trigger: End of a round (everyone spoke once) OR specific keywords?
        // Simpler: Every few turns?
        // Let's do it if we are starting a NEW round (i.e. we just cycled through).

        let currentIdx = -1;
        if (lastExpertSpeaker) {
            currentIdx = experts.findIndex(e => e.name === lastExpertSpeaker);
            console.log('[Supervisor] currentIdx (from lastExpertSpeaker):', currentIdx);
        } else {
            // No expert has spoken yet, start with first expert
            console.log('[Supervisor] No expert spoken yet, starting with first expert:', experts[0]?.name);
            return { next_speaker: experts[0].name };
        }

        // Round Robin Next Index
        // If currentIdx is -1 (shouldn't happen if we strictly follow name), fallback 0
        const nextIdx = (currentIdx + 1) % experts.length;

        // Did we wrap around?
        if (nextIdx === 0) {
            nextRound++;

            // Check expansion if enabled
            if (appConfig.expansion_level && appConfig.expansion_level !== 'none') {
                const initialCount = 3; // minimal assumption, ideally tracked in state
                const currentCount = experts.length;
                const limit = appConfig.expansion_level === 'moderate' ? initialCount + 3 : 99;

                if (currentCount < limit) {
                    // Check if we need more expertise
                    console.log('[Supervisor] Checking for dynamic expansion...');
                    const newExpert = await this.dynamicRecruitment(state);
                    if (newExpert) {
                        console.log('[Supervisor] Recruiting new expert:', newExpert.name);
                        return {
                            experts: [newExpert], // Reducer merges this
                            next_speaker: newExpert.name,
                            current_round: nextRound,
                            messages: [new AIMessage({
                                content: `Recruiting new expert: ${newExpert.name} (${newExpert.emoji}) - ${newExpert.role}`,
                                name: 'Supervisor'
                            })]
                        };
                    }
                }
            }
        }

        return {
            next_speaker: experts[nextIdx].name,
            current_round: nextRound
        };
    }

    private async dynamicRecruitment(state: AutoExpertState): Promise<AgentPersona | null> {
        const { messages, experts } = state;
        // Analyze recent conversation
        const recentMsgs = messages.slice(-5).map(m => `${m.name}: ${m.content}`).join('\n');
        const expertNames = experts.map(e => e.name).join(', ');

        const systemPrompt = `You are the AutoExpert Host.
Current Experts: ${expertNames}
Recent Conversation:
${recentMsgs}

Determine if the discussion has stalled or requires a specific NEW perspective that is currently missing.
If yes, generate a NEW expert profile. If no, return null.
Expansion Policy: ${state.config.expansion_level}
User Language: ${state.config.language || 'en'} (Ensure new expert profile is in this language)

Return JSON:
{
  "recruit": boolean,
  "reason": "string",
  "new_expert": { "name": "...", "role": "...", "emoji": "...", "description": "...", "relevance": 80 } | null
}`;

        try {
            const response = await this.model.invoke([new SystemMessage(systemPrompt)], {
                response_format: { type: "json_object" }
            });
            let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

            // Strip markdown code fences if present
            if (content.startsWith('```')) {
                content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            const parsed = JSON.parse(content);

            if (parsed.recruit && parsed.new_expert) {
                return {
                    id: parsed.new_expert.name.toLowerCase().replace(/\s+/g, '_'),
                    ...parsed.new_expert
                };
            }
        } catch (e) {
            console.warn("Dynamic recruitment failed", e);
        }
        return null;
    }

    private async initialRecruitment(state: AutoExpertState) {
        const { seed, context_summary, config } = state;

        const language = config.language || 'en';
        const numExperts = config.dynamism === 'wild' ? 5 : 3;

        const systemPrompt = `You are the AutoExpert Host.
Your goal is to assemble a dynamic panel of ${numExperts} experts to analyze the User's "Seed" topic.
Use the provided Context to tailor the selection (e.g., if context shows user is a developer, pick technical experts).

IMPORTANT: The user's language is "${language}". ensure the experts you recruit are fluent in this language and appropriate for the cultural context if applicable.
Return the "role" and "description" in ${language}.

Return a JSON object with a list of experts:
{
  "experts": [
    {
      "name": "Prof. X",
      "role": "Cognitive Scientist",
      "emoji": "🧠",
      "description": "Focuses on mental models and learning.",
      "relevance": 95
    }
  ]
}
`;

        const userMessage = `Seed: "${seed}"
Context:
${context_summary || "No specific background context."}

Recruit the experts.`;

        try {
            console.warn("Initial recruitment system prompt:", systemPrompt);
            console.warn("Initial recruitment user message:", userMessage);
            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(userMessage)  // User input uses HumanMessage per LangChain best practices
            ], {
                //response_format: { type: "json_object" }
            });

            console.warn("Initial recruitment response:", response);
            let content = response.content as string;
            console.warn("Initial recruitment content:", content);

            // Strip markdown code fences if present (LLMs often wrap JSON in ```json ... ```)
            if (content.startsWith('```')) {
                content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            const parsed = JSON.parse(content);
            console.warn("Initial recruitment parsed:", parsed);
            const experts: AgentPersona[] = parsed.experts.map((e: any) => ({
                id: e.name.toLowerCase().replace(/\s+/g, '_'),
                ...e
            }));
            console.warn("Initial recruitment experts:", experts);

            return {
                experts,
                next_speaker: experts[0].name, // Start with first expert
                messages: [new AIMessage({ content: `Gathering panel: ${experts.map(e => e.name).join(', ')}`, name: 'Supervisor' })]
            };
        } catch (e: any) {
            const metaStr = this.metadata ? ` (Role: ${this.metadata.role || 'Supervisor'}, Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.error(`[Supervisor${metaStr}] Initial recruitment failed:`, e);
            throw new Error(`[Supervisor] LLM Call Failed during recruitment${metaStr}: ${e.message}`);
        }
    }
}
