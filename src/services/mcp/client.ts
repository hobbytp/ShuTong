/**
 * MCP (Model Context Protocol) Client Service
 * 
 * This service manages connections to MCP servers and provides
 * an interface for listing and calling tools.
 * 
 * MCP enables ShuTong to connect to external tools like:
 * - File system access
 * - Web search
 * - Database queries
 * - Custom tools
 */

export interface MCPTool {
    name: string
    description: string
    inputSchema?: object
}

export interface MCPToolResult {
    content: Array<{ type: string; text?: string }>
}

export class MCPService {
    private client: any = null
    private connected = false

    /**
     * Connect to an MCP server via stdio transport
     * @param command - The command to spawn the MCP server (e.g., 'npx', 'python')
     * @param args - Arguments for the command
     */
    async connect(command: string, args: string[] = []): Promise<void> {
        try {
            // Dynamic import to handle ESM/CJS compatibility
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
            const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

            const transport = new StdioClientTransport({
                command,
                args
            })

            this.client = new Client({
                name: 'shutong',
                version: '0.0.1'
            })

            await this.client.connect(transport)
            this.connected = true
            console.log('[MCP] Connected to server:', command)
        } catch (error) {
            console.error('[MCP] Connection failed:', error)
            throw error
        }
    }

    /**
     * Disconnect from the MCP server
     */
    async disconnect(): Promise<void> {
        if (this.client && this.connected) {
            await this.client.close()
            this.connected = false
            console.log('[MCP] Disconnected')
        }
    }

    /**
     * List available tools from the connected MCP server
     */
    async listTools(): Promise<MCPTool[]> {
        if (!this.connected || !this.client) {
            return []
        }

        try {
            const response = await this.client.listTools()
            return response.tools || []
        } catch (error) {
            console.error('[MCP] Failed to list tools:', error)
            return []
        }
    }

    /**
     * Call a tool on the MCP server
     * @param name - Tool name
     * @param args - Tool arguments
     */
    async callTool(name: string, args: object = {}): Promise<MCPToolResult | null> {
        if (!this.connected || !this.client) {
            throw new Error('MCP client not connected')
        }

        try {
            const result = await this.client.callTool({
                name,
                arguments: args
            })
            return result
        } catch (error) {
            console.error('[MCP] Tool call failed:', error)
            throw error
        }
    }

    /**
     * Check if connected to an MCP server
     */
    isConnected(): boolean {
        return this.connected
    }
}

export const mcpService = new MCPService()
