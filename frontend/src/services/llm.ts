import api from './api'

export interface LLMProvider {
  id: string
  tenant_id: string
  name: string
  provider_type: string
  base_url: string
  model: string
  is_active: number
  is_default: number
  created_at: string
  updated_at: string
}

export interface LLMProviderInput {
  name: string
  provider_type: string
  base_url: string
  api_key: string
  model: string
  is_active: boolean
  is_default: boolean
}

export const getLLMProviders = async () => {
  const { data } = await api.get('/llm-providers')
  return data
}

export const getLLMProvider = async (id: string) => {
  const { data } = await api.get(`/llm-providers/${id}`)
  return data
}

export const createLLMProvider = async (payload: LLMProviderInput) => {
  const { data } = await api.post('/llm-providers', payload)
  return data
}

export const updateLLMProvider = async (id: string, payload: Partial<LLMProviderInput>) => {
  const { data } = await api.put(`/llm-providers/${id}`, payload)
  return data
}

export const deleteLLMProvider = async (id: string) => {
  const { data } = await api.delete(`/llm-providers/${id}`)
  return data
}

export const testLLMProvider = async (id: string) => {
  const { data } = await api.post(`/llm-providers/${id}/test`)
  return data
}

export const testChat = async (message: string, providerId?: string) => {
  const { data } = await api.post('/llm-providers/test-chat', { message, providerId })
  return data
}

// ── MCP Settings ──────────────────────────────────────────────────────────────

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
