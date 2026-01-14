import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
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

        console.log('[Synthesizer] ========================================');
        console.log('[Synthesizer] Starting report generation...');
        console.log(`[Synthesizer] Messages count: ${messages.length}, Seed: "${seed.substring(0, 50)}..."`);
        console.log(`[Synthesizer] Metadata:`, this.metadata);

        // DEBUG MODE: Skip LLM call entirely for testing
        if (process.env.SPROUT_DEBUG_MODE === 'true') {
            console.log('[Synthesizer] DEBUG MODE: Returning test report without LLM call');
            return {
                report: {
                    core_essence: "DEBUG: This is a test report - LLM was bypassed",
                    mental_model_lens: "Debug Mode",
                    perspective_shift: "If you see this, the graph is working but LLM calls are failing.",
                    cross_pollination: [{ field: "Testing", insight: "Graph routing works correctly" }],
                    rabbit_holes: [{ type: "deepen" as const, question: "Why is the LLM returning empty responses?" }],
                    experiments: [{ title: "Check API Key", steps: ["Verify DASHSCOPE_API_KEY is set", "Check model name"] }]
                },
                messages: [new AIMessage({ content: "Debug Report Generated.", name: "Synthesizer" })]
            };
        }

        const systemPrompt = `You are the Sprout Cognitive Architect.
Your goal is NOT to summarize the conversation, but to TRANSFORM it into a "Cognitive Sprout Report".
You are a master of First Principles Thinking, Lateral Thinking, and Systems Thinking.

Input Context:
- A seed idea provided by the user.
- A transcript of experts discussing this idea.

Your Mission:
1. **Decode the DNA**: Don't just repeat the idea. Find its "First Principles" definition. What is it *fundamentally*?
2. **Apply a Lens**: Choose ONE powerful mental model (e.g., Entropy, Antifragility, Network Effects, Game Theory, Evolution) that best illuminates this topic.
3. **Shift Perspective**: Use that lens to provide a surprising insight. "You saw X, but through the lens of Y, it is actually Z."
4. **Cross-Pollinate**: Connect this idea to 2 COMPLETELY DIFFERENT fields (e.g., if Topic is Tech, connect to Biology or Architecture).
5. **Dig Rabbit Holes**: Ask 3 questions that don't have easy answers. Questions that force the user to think deeper, invert their assumptions, or expand the scope.
6. **Design Experiments**: Propose 1 concrete, non-obvious "Micro-Experiment" the user can do in 48 hours to test this concept.

Output Format (JSON):
{
  "core_essence": "The First Principles definition.",
  "mental_model_lens": "The name of the mental model used.",
  "perspective_shift": "The surprising insight from applying the lens.",
  "cross_pollination": [
    { "field": "Field Name", "insight": "The connection insight." }
  ],
  "rabbit_holes": [
    { "type": "deepen", "question": "..." },
    { "type": "invert", "question": "..." },
    { "type": "expand", "question": "..." }
  ],
  "experiments": [
    { "title": "Experiment Name", "steps": ["Step 1", "Step 2"] }
  ]
}
IMPORTANT: Generate the content in the language: "${state.config.language || 'en'}".
`;

        // Filter messages - only exclude tool messages, keep all others including expert discussions
        const validMessages = messages.filter(m => {
            const msgType = (m as any).getType?.();
            // Only exclude tool messages (web_search results etc.)
            if (msgType === 'tool') return false;
            // Keep all other messages (human, ai, system)
            return true;
        });

        console.log(`[Synthesizer] Filtered ${messages.length} -> ${validMessages.length} valid messages (excluded tool messages)`);

        const recentMessages = validMessages.slice(-20); // Keep more messages for context
        let conversationText = recentMessages
            .map(m => {
                let content = '';
                if (typeof m.content === 'string') {
                    content = m.content;
                } else if (Array.isArray(m.content)) {
                    // Handle array content (e.g., from some LangChain message types)
                    content = m.content.map((c: any) => typeof c === 'string' ? c : c.text || JSON.stringify(c)).join('\n');
                } else {
                    content = JSON.stringify(m.content);
                }
                return `${m.name || 'User'}: ${content}`;
            })
            .join('\n');

        if (conversationText.length > 6000) { // Reduced limit for safety
            console.warn(`[Synthesizer] Conversation text truncated from ${conversationText.length} to 6000 chars`);
            conversationText = conversationText.substring(0, 6000) + '\n...(truncated)';
        }

        const prompt = `Seed: ${seed}
        
Conversation Transcript:
${conversationText}

Generate the Cognitive Sprout Report. Return ONLY valid JSON.`;

        console.log(`[Synthesizer] Prompt length: ${prompt.length} chars`);

        let report: SproutReport;

        try {
            const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.log(`[Synthesizer] Calling LLM${metaStr}...`);
            const startTime = Date.now();

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(prompt)
            ]);
            // Note: response_format removed as it causes empty responses with some providers

            console.log(`[Synthesizer] LLM response received in ${Date.now() - startTime}ms`);

            // Check for empty response
            if (!response || !response.content) {
                console.error(`[Synthesizer${metaStr}] LLM returned empty response!`);
                throw new Error('LLM returned empty response');
            }

            let content = response.content as string;
            console.log(`[Synthesizer] Raw response length: ${content.length} chars`);
            // Strip markdown code blocks if present
            if (content.startsWith('```')) {
                content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }
            report = JSON.parse(content);
            console.log(`[Synthesizer] Report parsed successfully. Core essence: "${report.core_essence?.substring(0, 50)}..."`);

        } catch (e: any) {
            const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
            console.error(`[Synthesizer${metaStr}] Report generation failed:`, e.message);
            console.error(`[Synthesizer${metaStr}] Full error:`, e);

            // Return fallback report instead of crashing
            console.warn('[Synthesizer] Returning fallback report due to LLM failure');
            report = {
                core_essence: `报告生成失败: ${e.message}`,
                mental_model_lens: "N/A",
                perspective_shift: "LLM 调用出错，请检查模型配置。",
                cross_pollination: [],
                rabbit_holes: [
                    { type: "deepen" as const, question: "检查 SPROUT_REPORTOR 角色的 LLM 配置是否正确？" },
                    { type: "invert" as const, question: "API Key 是否有效？模型名称是否正确？" }
                ],
                experiments: []
            };
        }

        console.log('[Synthesizer] Returning report to graph...');
        return {
            report,
            messages: [new AIMessage({ content: "Report Generated.", name: "Synthesizer" })]
        };
    }
}
