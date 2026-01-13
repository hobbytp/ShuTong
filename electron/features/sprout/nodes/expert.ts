import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AutoExpertState } from "../schema";
import { searchDuckDuckGoInstantAnswer, WebSearchResult } from "../../../research/web-search";

export class ExpertNode {
    private model: ChatOpenAI;
    private metadata: any;

    constructor(model: ChatOpenAI, metadata?: any) {
        this.model = model;
        this.metadata = metadata;
    }

    public async run(state: AutoExpertState) {
        const { next_speaker, experts, messages, seed } = state;

        const expertProfile = experts.find(e => e.name === next_speaker);
        if (!expertProfile) {
            return { messages: [] }; // Should not happen
        }

        const systemPrompt = `You are ${expertProfile.emoji} ${expertProfile.name}, a ${expertProfile.role}.
Your description: ${expertProfile.description}

You are participating in a brainstorming session about: "${seed}".
Review the conversation so far. Add your unique perspective, build on others' ideas, or politely disagree.
You have access to a "web_search" tool. Use it if you need to verify facts, look up checking concepts, or find real-world examples to support your points.

IMPORTANT: Respond in the language: "${state.config.language || 'en'}".

Keep your response concise (under 200 words).
Start your response with your emoji.`;

        // Search Tool Definition
        const searchTool = {
            type: "function" as const,
            function: {
                name: "web_search",
                description: "Search the web for information. Use this to verify facts or find current data.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query"
                        }
                    },
                    required: ["query"]
                }
            }
        };

        const modelWithTools = this.model.bindTools([searchTool]);

        // Filter messages to relevant context window
        const recentMessages = messages.slice(-10);
        let currentMessages = [
            new SystemMessage(systemPrompt),
            ...recentMessages
        ];

        // ReAct Loop (Max 3 turns)
        const generatedMessages = [];
        let turns = 0;
        const MAX_TURNS = 3;

        while (turns < MAX_TURNS) {
            let response;
            try {
                response = await modelWithTools.invoke(currentMessages);
            } catch (e: any) {
                const metaStr = this.metadata ? ` (Provider: ${this.metadata.provider}, Model: ${this.metadata.modelName})` : '';
                console.error(`[Expert:${expertProfile.name}${metaStr}] Generation failed:`, e);
                // Throwing here will stop the graph
                throw new Error(`[Expert:${expertProfile.name}] LLM Call Failed${metaStr}: ${e.message}`);
            }

            generatedMessages.push(new AIMessage({
                content: response.content,
                name: expertProfile.name,
                tool_calls: response.tool_calls
            }));
            currentMessages.push(response);

            // Check if tool calls
            if (response.tool_calls && response.tool_calls.length > 0) {
                for (const toolCall of response.tool_calls) {
                    if (toolCall.name === 'web_search') {
                        console.log(`[Expert:${expertProfile.name}] Searching:`, toolCall.args.query);
                        let searchResult = "";
                        try {
                            const results = await searchDuckDuckGoInstantAnswer(toolCall.args.query as string);
                            searchResult = results.slice(0, 3).map((r: WebSearchResult) => `[${r.title}](${r.url}): ${r.snippet}`).join("\n\n");
                            if (!searchResult) searchResult = "No results found.";
                        } catch (err: any) {
                            searchResult = "Error performing search: " + err.message;
                        }

                        const toolMsg = new ToolMessage({
                            tool_call_id: toolCall.id!,
                            content: searchResult,
                            name: "web_search"
                        });
                        generatedMessages.push(toolMsg);
                        currentMessages.push(toolMsg);
                    }
                }
                turns++;
            } else {
                // Final answer provided
                break;
            }
        }

        // We return ALL generated messages so they are appended to history
        // This allows the transcript to show the tool usage if UI supports it,
        // or just the expert's thought process.
        // However, standard UI might just show the text.

        // If the last message is a ToolMessage (rare), we should ensure we get a final response?
        // The loop breaks on NO tool calls. So last message should be AIMessage.

        return {
            messages: generatedMessages,
            // Hand control back to supervisor to decide next step
            next_speaker: 'Supervisor'
        };
    }
}
