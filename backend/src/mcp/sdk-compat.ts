// Runtime require of MCP SDK — Node 20 resolves package exports correctly,
// but TypeScript moduleResolution:node does not understand exports fields.
// We require() at runtime and manually declare the types we use.

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IMcpServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, description: string, inputSchema: any, handler: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }>): void
  connect(transport: ISSETransport | IStreamableHTTPTransport): Promise<void>
  close(): Promise<void>
}

export interface ISSETransport {
  sessionId: string
  start(): Promise<void>
  handlePostMessage(req: unknown, res: unknown, body?: unknown): Promise<void>
  close(): Promise<void>
  onclose?: () => void
  onerror?: (err: Error) => void
}

export interface IStreamableHTTPTransport {
  sessionId: string | undefined
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>
  close(): Promise<void>
  onclose?: () => void
  onerror?: (err: Error) => void
}

type McpServerConstructor = new (info: { name: string; version: string }) => IMcpServer
type SSETransportConstructor = new (endpoint: string, res: unknown) => ISSETransport
type StreamableHTTPConstructor = new (options?: { sessionIdGenerator?: () => string }) => IStreamableHTTPTransport

const mcpMod = require('@modelcontextprotocol/sdk/server/mcp.js') as { McpServer: McpServerConstructor }
const sseMod = require('@modelcontextprotocol/sdk/server/sse.js') as { SSEServerTransport: SSETransportConstructor }
const streamableMod = require('@modelcontextprotocol/sdk/server/streamableHttp.js') as { StreamableHTTPServerTransport: StreamableHTTPConstructor }

export const McpServer: McpServerConstructor = mcpMod.McpServer
export const SSEServerTransport: SSETransportConstructor = sseMod.SSEServerTransport
export const StreamableHTTPServerTransport: StreamableHTTPConstructor = streamableMod.StreamableHTTPServerTransport
