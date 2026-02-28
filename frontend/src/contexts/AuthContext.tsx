import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import api from '../utils/api'

// Hardcoded master accounts
const MASTER_ACCOUNTS: Record<string, { password: string; tenantId: string; name: string }> = {
  'BB-pillow': { 
    password: 'BB0918033688', 
    tenantId: 'tenant_bb_pillow', 
    name: 'BB Pillow Master' 
  },
  'Kidshosuecafe': { 
    password: 'Kids0834516669', 
    tenantId: 'tenant_kids_house', 
    name: 'Kids House Master' 
  }
}

// DEV MODE: Auto-login as master (remove in production)
const DEV_AUTO_LOGIN = true

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
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>
  logout: () => void
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

  // Init auth state - ใช้ useEffect แทน useState callback
  useEffect(() => {
    const savedUser = localStorage.getItem('crm_user')
    const savedToken = localStorage.getItem('crm_token')
    const savedTenant = localStorage.getItem('crm_tenant')
    
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser))
      setToken(savedToken)
      if (savedTenant) setTenant(JSON.parse(savedTenant))
    } else if (DEV_AUTO_LOGIN) {
      // Auto-login dev mode
      const devUser: User = {
        id: 'master_BB-pillow',
        email: 'BB-pillow',
        name: 'BB Pillow Master',
        role: 'MASTER',
        tenant_id: 'tenant_bb_pillow'
      }
      const devToken = 'dev_token'
      const devTenant: Tenant = { code: 'BB-pillow', name: 'BB Pillow Master' }
      
      localStorage.setItem('crm_user', JSON.stringify(devUser))
      localStorage.setItem('crm_token', devToken)
      localStorage.setItem('crm_tenant', JSON.stringify(devTenant))
      
      setUser(devUser)
      setToken(devToken)
      setTenant(devTenant)
    }
    setIsReady(true)
  }, [])

  const isMaster = user?.role === 'MASTER' || MASTER_ACCOUNTS[user?.email || ''] !== undefined

  // Check if user can edit based on 24h rule
  const canEdit = useCallback((createdAt: string): boolean => {
    if (isMaster) return true
    
    const HOURS_LIMIT = 24
    const recordTime = new Date(createdAt).getTime()
    const currentTime = Date.now()
    const diffHours = (currentTime - recordTime) / (1000 * 60 * 60)
    
    return diffHours <= HOURS_LIMIT
  }, [isMaster])

  // Login handler - checks hardcoded master accounts first, then API
  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    // Check hardcoded master accounts
    const masterAccount = MASTER_ACCOUNTS[email]
    if (masterAccount) {
      if (masterAccount.password === password) {
        const masterUser: User = {
          id: `master_${email}`,
          email,
          name: masterAccount.name,
          role: 'MASTER',
          tenant_id: masterAccount.tenantId,
        }
        
        const masterToken = `master_token_${Date.now()}`
        const masterTenant: Tenant = { code: email, name: masterAccount.name }
        
        setUser(masterUser)
        setToken(masterToken)
        setTenant(masterTenant)
        
        localStorage.setItem('crm_user', JSON.stringify(masterUser))
        localStorage.setItem('crm_token', masterToken)
        localStorage.setItem('crm_tenant', JSON.stringify(masterTenant))
        
        return { success: true }
      }
      return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' }
    }

    // Try API login for regular users
    try {
      const response = await api.post('/auth/login', { email, password })
      
      if (response.data.success) {
        const { user: apiUser, token: apiToken } = response.data.data
        
        setUser(apiUser)
        setToken(apiToken)
        setTenant({ code: apiUser.tenant_id, name: 'องค์กร' })
        
        localStorage.setItem('crm_user', JSON.stringify(apiUser))
        localStorage.setItem('crm_token', apiToken)
        localStorage.setItem('crm_tenant', JSON.stringify({ code: apiUser.tenant_id, name: 'องค์กร' }))
        
        return { success: true }
      }
      
      return { success: false, message: response.data.message || 'เข้าสู่ระบบไม่สำเร็จ' }
    } catch (error: any) {
      return { success: false, message: error.response?.data?.message || 'เข้าสู่ระบบไม่สำเร็จ' }
    }
  }, [])

  // Logout handler
  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    setTenant(null)
    setChildUsers([])
    
    localStorage.removeItem('crm_user')
    localStorage.removeItem('crm_token')
    localStorage.removeItem('crm_tenant')
  }, [])

  // Load child users (master only)
  const loadChildren = useCallback(async () => {
    if (!isMaster || !token) return
    
    try {
      const response = await api.get('/auth/children', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (response.data.success) {
        setChildUsers(response.data.data)
      }
    } catch (error) {
      console.error('Failed to load children:', error)
    }
  }, [isMaster, token])

  // Create child user (master only)
  const createChildUser = useCallback(async (email: string, password: string, name: string, role: string): Promise<{ success: boolean; message?: string }> => {
    if (!isMaster || !token) return { success: false, message: 'เฉพาะ Master เท่านั้น' }
    
    try {
      const response = await api.post('/auth/create-child', {
        email,
        password,
        name,
        role,
        tenant_id: user?.tenant_id
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
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

  // รอให้ token พร้อมก่อน render children
  if (!isReady) {
    return <div className="min-h-screen bg-cyber-dark flex items-center justify-center">
      <div className="text-cyber-primary animate-pulse">Loading...</div>
    </div>
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      tenant,
      isMaster,
      children: childUsers,
      isReady,
      login,
      logout,
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
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

// Hook for checking edit permission on a record
export function useEditPermission() {
  const { canEdit } = useAuth()
  
  return {
    canEditRecord: canEdit,
    getEditStatus: (createdAt: string) => {
      const editable = canEdit(createdAt)
      const recordTime = new Date(createdAt).getTime()
      const currentTime = Date.now()
      const diffHours = (currentTime - recordTime) / (1000 * 60 * 60)
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
