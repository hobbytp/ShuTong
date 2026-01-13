import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AutoExpertState, SproutReport } from "../schema";

export class SynthesizerNode {
    private model: ChatOpenAI;
    private metadata: any;

    constructor(model: ChatOpenAI, metadata?: any) {
        this.model = model;
        this.metadata = metadata;
    }

    public async run(state: AutoExpertState) {
        const { seed, messages, config: _config } = state;

        const systemPrompt = `You are the Sprout Synthesizer.
Your goal is to synthesize the brainstorming session into a "Sprouting Report".
IMPORTANT: Generate the report content in the language: "${state.config.language || 'en'}".

Output Format (JSON):
{
  "core_meaning": "Deep decoding of the seed's essence.",
  "connections": ["Link 1 to existing concept", "Link 2 to user context"],
  "pathways": {
    "theory": "Book/Paper recommendation",
    "practice": "Actionable experiment",
    "inversion": "Counter-argument or flip side"
  }
}
`;

        const conversationText = messages
            .map(m => `${m.name || 'User'}: ${m.content}`)
            .join('\n');

        const prompt = `Seed: ${seed}
        
Conversation Transcript:
${conversationText}

Generate the Sprouting Report.`;

        let response;
        try {
            response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new AIMessage(prompt)
            ], {
                response_format: { type: "json_object" }
            });
        } catch (e: any) {
            const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.error(`[Synthesizer${metaStr}] Report generation failed:`, e);
            throw new Error(`[Synthesizer] LLM Call Failed${metaStr}: ${e.message}`);
        }

        let report: SproutReport;
        try {
            report = JSON.parse(response.content as string);
        } catch {
            report = {
                core_meaning: "Failed to generate structured report.",
                connections: [],
                pathways: { theory: "", practice: "", inversion: "" }
            };
        }

        return {
            report,
            messages: [new AIMessage({ content: "Report Generated.", name: "Synthesizer" })]
        };
    }
}
