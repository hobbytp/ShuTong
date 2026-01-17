// Tools Executor - Manages parallel tool execution

import { ToolCall, ToolResult } from '../models/schemas';
import { webSearchTool } from './web_search';

// Tool registry
const toolRegistry: Record<string, (params: any) => Promise<any>> = {
    web_search: async (params: { query: string }) => {
        return await webSearchTool.invoke(params);
    },
};

/**
 * Execute multiple tool calls in parallel
 */
export async function executeToolCalls(
    toolCalls: ToolCall[]
): Promise<ToolResult[]> {
    const promises = toolCalls.map(async (call): Promise<ToolResult> => {
        const toolFn = toolRegistry[call.toolName];

        if (!toolFn) {
            return {
                toolName: call.toolName,
                success: false,
                result: null,
                error: `Unknown tool: ${call.toolName}`,
            };
        }

        try {
            const result = await toolFn(call.parameters);
            return {
                toolName: call.toolName,
                success: true,
                result,
            };
        } catch (error) {
            return {
                toolName: call.toolName,
                success: false,
                result: null,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });

    return Promise.all(promises);
}

/**
 * Get list of available tools
 */
export function getAvailableTools(): string[] {
    return Object.keys(toolRegistry);
}

/**
 * Register a new tool
 */
export function registerTool(
    name: string,
    fn: (params: any) => Promise<any>
): void {
    toolRegistry[name] = fn;
}
