// Base API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`

  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  try {
    const response = await fetch(url, config)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Request failed')
    }

    return data
  } catch (error) {
    console.error('API request failed:', error)
    throw error
  }
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  put: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
}

export default api
