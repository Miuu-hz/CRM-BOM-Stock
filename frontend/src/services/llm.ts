import api from './api'

export interface McpTestStep {
  step: string
  ok: boolean
  ms?: number
  error?: string
}

export const getMcpSettings = async () => {
  const { data } = await api.get('/mcp-settings')
  return data as { success: boolean; data: { key: string | null } }
}

export const regenerateMcpKey = async () => {
  const { data } = await api.post('/mcp-settings/regenerate-key')
  return data as { success: boolean; data: { key: string } }
}

export const testMcpServer = async () => {
  const { data } = await api.post('/mcp-settings/test')
  return data as { success: boolean; steps: McpTestStep[] }
}
