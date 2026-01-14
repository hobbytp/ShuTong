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
        const nextIdx = (currentIdx + 1) % experts.length;

        // Did we wrap around? (New Round)
        if (nextIdx === 0) {
            nextRound++;

            // --- Supervisor Orchestration (Round Review + Dynamic Recruitment) ---
            console.log('[Supervisor] Round complete. Reviewing round...');
            const roundReview = await this.reviewRound(state);

            if (roundReview) {
                const newMessages: AIMessage[] = [];
                let updatedExperts: AgentPersona[] | undefined;
                let nextSpeaker = experts[nextIdx].name;

                // Handle dynamic recruitment for 'branch' direction
                if (roundReview.direction === 'branch' && roundReview.new_expert) {
                    const newExpert: AgentPersona = {
                        id: roundReview.new_expert.name.toLowerCase().replace(/\s+/g, '_'),
                        ...roundReview.new_expert
                    };
                    console.log('[Supervisor] Recruiting new expert for branch:', newExpert.name);
                    updatedExperts = [newExpert]; // Reducer will merge
                    nextSpeaker = newExpert.name; // Let new expert speak first

                    newMessages.push(new AIMessage({
                        content: `🌿 New branch detected! Recruiting ${newExpert.emoji} ${newExpert.name} (${newExpert.role}) to explore this direction.`,
                        name: 'Supervisor'
                    }));
                }

                // Add instruction message if present
                if (roundReview.instruction) {
                    console.log('[Supervisor] Injecting instruction:', roundReview.instruction);
                    newMessages.push(new AIMessage({
                        content: roundReview.instruction,
                        name: 'Supervisor'
                    }));
                }

                return {
                    experts: updatedExperts,
                    next_speaker: nextSpeaker,
                    current_round: nextRound,
                    messages: newMessages
                };
            }
        }

        return {
            next_speaker: experts[nextIdx].name,
            current_round: nextRound
        };
    }

    private async reviewRound(state: AutoExpertState): Promise<{
        summary: string;
        direction: 'deepen' | 'debate' | 'branch' | 'continue';
        instruction?: string;
        new_expert?: { name: string; role: string; emoji: string; description: string; relevance: number };
    } | null> {
        const { messages, experts, config } = state;
        const language = config.language || 'en';
        const expertNames = experts.map(e => e.name).join(', ');
        const expansionLevel = config.expansion_level || 'none';
        const canRecruit = expansionLevel !== 'none' && (
            expansionLevel === 'unlimited' || experts.length < 6
        );

        // Get messages from the *last* round (approximate by experts.length)
        // IMPORTANT: Only include messages with ACTUAL CONTENT, not empty tool_call-only messages
        const lastRoundMsgs = messages.slice(-(experts.length * 3)) // buffer for multi-turn
            .filter(m => {
                // Must be from an expert
                if (!m.name || !experts.some(e => e.name === m.name)) return false;
                // Must have actual text content (not just tool_calls)
                const content = typeof m.content === 'string' ? m.content : '';
                return content.trim().length > 0;
            })
            .map(m => `${m.name}: ${m.content}`)
            .join('\n');

        console.log('[Supervisor] reviewRound lastRoundMsgs preview:', lastRoundMsgs.substring(0, 500));

        const recruitmentClause = canRecruit ? `
4. If direction is "branch" and a NEW specialist perspective would benefit the discussion:
   - Generate a "new_expert" object with: name, role, emoji, description, relevance (0-100).
   - The new expert should be DIFFERENT from existing experts: ${expertNames}.
   - If not needed, set new_expert to null.` : '';

        const systemPrompt = `You are the Sprouts Cognitive Director.
Current Experts: ${expertNames}
User Language: ${language}
Expansion Policy: ${expansionLevel}

Analyze the recent conversation from the last round:
${lastRoundMsgs}

Your Role:
You are NOT a passive moderator. You are a "Cognitive Director" ensuring the discussion reaches maximum depth and novelty.
You are allergic to platitudes, surface-level agreement, and generic advice.

Your Tasks:
1. **Diagnosis**: What is the current "Cognitive State" of the room?
   - *Groupthink Alert*: Are they agreeing too much?
   - *Abstraction Trap*: Are they stuck in high-level theory without examples?
   - *Weed Weaving*: Are they lost in irrelevant details?

2. **Strategic Pivot (Direction)**:
   - "deepen": Good path, but hit it harder with a mental model (e.g. First Principles, Inversion).
   - "debate": Force a conflict. Assign a "Devil's Advocate" position to one expert.
   - "branch": This path is dead or exhausted. Pivot to a specific adjacent field (e.g. Biology, History).
   - "continue": ONLY if the flow is exceptionally high-quality.

3. **Directing (Instruction)**:
   - Issue a specific, slightly provocative command to the panel or a specific expert.
   - Example directly: "@Prof. X, stop listing features. Analyze this using 'Shannon's Entropy'. Go."
   - Example general: "Everyone is being too polite. I want you to attack the premise that [Seed] is even desirable."

${recruitmentClause}

Return JSON:
{
  "summary": "Brief diagnosis of the cognitive state.",
  "direction": "deepen" | "debate" | "branch" | "continue",
  "instruction": "The provocative directive."${canRecruit ? ',\n  "new_expert": { "name": "...", "role": "...", "emoji": "...", "description": "...", "relevance": 95 } | null' : ''}
}`;

        try {
            const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.log(`[Supervisor] Generating Round Review${metaStr}...`);

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage("Analyze the conversation and return the JSON response.")
            ]);
            // Note: response_format removed as it causes empty responses with some providers

            // Check for empty response
            if (!response || !response.content) {
                console.error(`[Supervisor${metaStr}] LLM returned empty response!`);
                return null;
            }

            let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            console.log(`[Supervisor] Raw response: ${content.substring(0, 200)}...`);

            if (content.startsWith('```')) {
                content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            const parsed = JSON.parse(content);
            console.log("[Supervisor] Review generated:", parsed);
            return parsed;

        } catch (e: any) {
            const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.error(`[Supervisor${metaStr}] Round Review failed:`, e.message);
            console.error(`[Supervisor${metaStr}] Full error stack:`, e.stack);
            return null;
        }
    }

    private async initialRecruitment(state: AutoExpertState) {
        const { seed, context_summary, config } = state;

        const language = config.language || 'en';
        const numExperts = config.dynamism === 'wild' ? 5 : 3;

        const systemPrompt = `You are the Sprouts Cognitive Curator.
Your goal is to assemble a "Cognitive Hit Squad" of ${numExperts} experts to analyze the User's "Seed" topic.
Don't just pick generic roles (like "Writer", "Coder"). Pick experts with **specific lenses/mental models**.

Examples:
- Instead of "Marketing Expert", pick "Evolutionary Psychologist (Viral Dynamics)".
- Instead of "Engineer", pick "Systems Theorist (Gall's Law)".
- Instead of "Designer", pick "Biomimicry Architect".

The user's language is "${language}".
Return the "role" and "description" in ${language}.

Return a JSON object with a list of experts:
{
  "experts": [
    {
      "name": "Prof. X",
      "role": "Cognitive Scientist (Embodied Cognition)",
      "emoji": "🧠",
      "description": "Analyzes how physical constraints shape thought.",
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
            console.log("[Supervisor] Initial recruitment prompt:", systemPrompt.substring(0, 200));
            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(userMessage)  // User input uses HumanMessage per LangChain best practices
            ]);
            // Note: response_format removed as it causes empty responses with some providers

            console.log("[Supervisor] Initial recruitment response received");
            let content = response.content as string;
            console.log("[Supervisor] Parsing recruitment content...");

            // Strip markdown code fences if present (LLMs often wrap JSON in ```json ... ```)
            if (content.startsWith('```')) {
                content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            const parsed = JSON.parse(content);
            const experts: AgentPersona[] = parsed.experts.map((e: any) => ({
                id: e.name.toLowerCase().replace(/\s+/g, '_'),
                ...e
            }));
            console.log("[Supervisor] Recruited experts:", experts.map(e => e.name).join(', '));

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
