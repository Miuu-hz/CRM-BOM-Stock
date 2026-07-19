import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('crm_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle auth errors — try a token refresh before logging the user out.
function clearAuthAndRedirect() {
  localStorage.removeItem('crm_user')
  localStorage.removeItem('crm_token')
  localStorage.removeItem('crm_refresh_token')
  localStorage.removeItem('crm_tenant')
  localStorage.removeItem('crm_original_tenant')
  window.location.href = '/login'
}

let isRefreshing = false
let refreshWaiters: Array<(token: string | null) => void> = []

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original: any = error.config
    if (error.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error)
    }
    const refreshToken = localStorage.getItem('crm_refresh_token')
    if (!refreshToken) {
      clearAuthAndRedirect()
      return Promise.reject(error)
    }
    original._retry = true
    original.headers = original.headers || {}

    // Coalesce concurrent 401s into a single refresh request.
    if (isRefreshing) {
      const t = await new Promise<string | null>((resolve) => refreshWaiters.push(resolve))
      if (!t) return Promise.reject(error)
      original.headers.Authorization = `Bearer ${t}`
      return api(original)
    }

    isRefreshing = true
    try {
      const resp = await axios.post('/api/auth/refresh', { refreshToken })
      const newToken = resp.data?.data?.token as string
      localStorage.setItem('crm_token', newToken)
      refreshWaiters.forEach((w) => w(newToken)); refreshWaiters = []
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch (refreshErr) {
      refreshWaiters.forEach((w) => w(null)); refreshWaiters = []
      clearAuthAndRedirect()
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  }
)

export default api
