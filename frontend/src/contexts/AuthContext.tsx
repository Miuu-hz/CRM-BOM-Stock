import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import api from '../utils/api'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes idle → logout
const WARN_BEFORE_MS  = 60 * 1000        // show warning 1 minute before logout

interface User {
  id: string
  email: string
  name: string
  role: string
  tenant_id: string
  parent_id?: string
}

interface Tenant {
  code: string
  name: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  tenant: Tenant | null
  isMaster: boolean
  children: User[]
  isReady: boolean
  showTimeoutWarning: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>
  logout: () => void
  extendSession: () => void
  canEdit: (createdAt: string) => boolean
  loadChildren: () => Promise<void>
  createChildUser: (email: string, password: string, name: string, role: string) => Promise<{ success: boolean; message?: string }>
  deleteChildUser: (id: string) => Promise<{ success: boolean; message?: string }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [childUsers, setChildUsers] = useState<User[]>([])
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false)

  const lastActivityRef = useRef<number>(Date.now())
  const timeoutCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Restore session from localStorage
  useEffect(() => {
    const savedUser  = localStorage.getItem('crm_user')
    const savedToken = localStorage.getItem('crm_token')
    const savedTenant = localStorage.getItem('crm_tenant')

    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser))
      setToken(savedToken)
      if (savedTenant) setTenant(JSON.parse(savedTenant))
    }
    setIsReady(true)
  }, [])

  // ── Session timeout ───────────────────────────────────────────────────────
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setShowTimeoutWarning(false)
  }, [])

  // Attach activity listeners when logged in
  useEffect(() => {
    if (!user) return

    const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }))

    timeoutCheckRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current
      if (idle >= IDLE_TIMEOUT_MS) {
        // Force logout
        doLogout()
      } else if (idle >= IDLE_TIMEOUT_MS - WARN_BEFORE_MS) {
        setShowTimeoutWarning(true)
      }
    }, 10_000) // check every 10 seconds

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      if (timeoutCheckRef.current) clearInterval(timeoutCheckRef.current)
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const doLogout = useCallback(() => {
    setUser(null)
    setToken(null)
    setTenant(null)
    setChildUsers([])
    setShowTimeoutWarning(false)
    localStorage.removeItem('crm_user')
    localStorage.removeItem('crm_token')
    localStorage.removeItem('crm_tenant')
    if (timeoutCheckRef.current) clearInterval(timeoutCheckRef.current)
  }, [])

  const extendSession = useCallback(() => {
    resetActivity()
  }, [resetActivity])
  // ─────────────────────────────────────────────────────────────────────────

  const isMaster = user?.role === 'MASTER'

  const canEdit = useCallback((createdAt: string): boolean => {
    if (isMaster) return true
    const HOURS_LIMIT = 24
    const diffHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
    return diffHours <= HOURS_LIMIT
  }, [isMaster])

  // Login — all accounts (master + sub-users) go through API
  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await api.post('/auth/login', { email, password })

      if (response.data.success) {
        const { user: apiUser, token: apiToken } = response.data.data
        const tenantObj = { code: apiUser.tenant_id, name: apiUser.name || apiUser.tenant_id }

        setUser(apiUser)
        setToken(apiToken)
        setTenant(tenantObj)
        lastActivityRef.current = Date.now()

        localStorage.setItem('crm_user', JSON.stringify(apiUser))
        localStorage.setItem('crm_token', apiToken)
        localStorage.setItem('crm_tenant', JSON.stringify(tenantObj))

        return { success: true }
      }

      return { success: false, message: response.data.message || 'เข้าสู่ระบบไม่สำเร็จ' }
    } catch (error: any) {
      return { success: false, message: error.response?.data?.message || 'เข้าสู่ระบบไม่สำเร็จ' }
    }
  }, [])

  const logout = useCallback(() => doLogout(), [doLogout])

  // Load child users (master only)
  const loadChildren = useCallback(async () => {
    if (!isMaster || !token) return
    try {
      const response = await api.get('/auth/children', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.data.success) setChildUsers(response.data.data)
    } catch (error) {
      console.error('Failed to load children:', error)
    }
  }, [isMaster, token])

  // Create child user (master only)
  const createChildUser = useCallback(async (email: string, password: string, name: string, role: string): Promise<{ success: boolean; message?: string }> => {
    if (!isMaster || !token) return { success: false, message: 'เฉพาะ Master เท่านั้น' }
    try {
      const response = await api.post('/auth/create-child', {
        email, password, name, role, tenant_id: user?.tenant_id
      }, { headers: { Authorization: `Bearer ${token}` } })

      if (response.data.success) {
        await loadChildren()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error: any) {
      return { success: false, message: error.response?.data?.message || 'สร้างไม่สำเร็จ' }
    }
  }, [isMaster, token, user?.tenant_id, loadChildren])

  // Delete child user (master only)
  const deleteChildUser = useCallback(async (id: string): Promise<{ success: boolean; message?: string }> => {
    if (!isMaster || !token) return { success: false, message: 'เฉพาะ Master เท่านั้น' }
    try {
      const response = await api.delete(`/auth/children/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.data.success) {
        await loadChildren()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error: any) {
      return { success: false, message: error.response?.data?.message || 'ลบไม่สำเร็จ' }
    }
  }, [isMaster, token, loadChildren])

  if (!isReady) {
    return (
      <div className="min-h-screen bg-cyber-dark flex items-center justify-center">
        <div className="text-cyber-primary animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      tenant,
      isMaster,
      children: childUsers,
      isReady,
      showTimeoutWarning,
      login,
      logout,
      extendSession,
      canEdit,
      loadChildren,
      createChildUser,
      deleteChildUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export function useEditPermission() {
  const { canEdit } = useAuth()
  return {
    canEditRecord: canEdit,
    getEditStatus: (createdAt: string) => {
      const editable = canEdit(createdAt)
      const diffHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
      const hoursLeft = Math.max(0, 24 - diffHours)
      return {
        editable,
        hoursLeft: Math.floor(hoursLeft),
        timeLeft: hoursLeft > 0 ? `${Math.floor(hoursLeft)}h ${Math.floor((hoursLeft % 1) * 60)}m` : 'หมดเวลา',
        message: editable
          ? `เหลือเวลาแก้ไข ${Math.floor(hoursLeft)} ชั่วโมง`
          : 'เกิน 24 ชั่วโมง - ไม่สามารถแก้ไขได้'
      }
    }
  }
}
