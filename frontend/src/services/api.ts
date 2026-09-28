import axios from 'axios'
import toast from 'react-hot-toast'

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

// Subscription error codes from the backend — toast ข้อความจาก server ทันที
// (ใช้ id เดียวกันกัน toast ซ้ำเมื่อ component แสดง error เดิมอยู่แล้ว)
const SUBSCRIPTION_ERROR_CODES = new Set([
  'SUBSCRIPTION_EXPIRED', 'FEATURE_LOCKED', 'USER_LIMIT', 'PRODUCT_LIMIT', 'POS_SHIFT_LIMIT',
])

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const code = error.response?.data?.code
    if (code && SUBSCRIPTION_ERROR_CODES.has(code)) {
      toast.error(error.response.data.message || 'เกิดข้อผิดพลาดเกี่ยวกับแพ็กเกจ', { id: `sub-${code}` })
    }
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

/**
 * สร้างสินค้าใหม่ที่ชื่อชนกับ "ชื่อรอง" (ยี่ห้อ B ที่ผูกเข้า SKU ยี่ห้อ A ไว้ตอนรับของ)
 * backend ตอบ 409 ALIAS_CONFLICT → ถามผู้ใช้: OK = แยกเป็นสินค้าใหม่ (ส่งซ้ำพร้อม aliasOverride) · Cancel = ใช้เป็นชื่อรองต่อ ไม่สร้าง
 */
export async function postWithAliasCheck(url: string, body: any) {
  try {
    return await api.post<any>(url, body)
  } catch (e: any) {
    if (e?.response?.data?.code !== 'ALIAS_CONFLICT') throw e
    if (!window.confirm(e.response.data.message)) throw new Error('ไม่ได้สร้างสินค้า — ชื่อนี้ยังเป็นชื่อรองของสินค้าเดิม')
    return api.post<any>(url, { ...body, aliasOverride: true })
  }
}
