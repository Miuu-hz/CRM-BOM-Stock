import api from './api'

export interface McpTestStep {
  step: string
  ok: boolean
  ms?: number
  error?: string
}

export const getKimiStatus = async () => {
  const { data } = await api.get('/llm-providers/status')
  return data as { success: boolean; provider: string; version: string }
}

export const kimiChat = async (message: string, imageBase64?: string, imageExt?: string) => {
  const { data } = await api.post('/llm-providers/chat', {
    message,
    ...(imageBase64 ? { imageBase64, imageExt: imageExt || 'jpg' } : {}),
  })
  return data as { success: boolean; reply: string; message?: string }
}

// kept for any existing callers
export const testChat = kimiChat

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
