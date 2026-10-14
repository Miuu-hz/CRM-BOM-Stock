import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
import api from '../services/api'
import { useAuth } from './AuthContext'

export interface SubscriptionInfo {
  tenantId: string
  planCode: string
  planName: string
  status: 'FREE' | 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE'
  currentPeriodEnd: string | null
  features: string[]
  packs: string[]
  addons: Record<string, number>
  limits: {
    maxUsers: number | null
    maxProducts: number | null
    maxPosShifts: number | null
  }
}

interface SubscriptionContextType {
  subscription: SubscriptionInfo | null
  loading: boolean
  hasFeature: (feature: string) => boolean
  isFeatureLocked: (feature: string) => boolean
  reloadSubscription: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined)

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { isMaster, token, tenant } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const reloadSubscription = useCallback(async () => {
    if (!token) {
      setSubscription(null)
      setLoading(false)
      return
    }
    try {
      const res = await api.get('/subscription/me')
      if (res.data?.success) {
        setSubscription(res.data.data)
      }
    } catch (err) {
      console.error('Failed to load subscription info:', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    reloadSubscription()
  }, [reloadSubscription, tenant?.code])

  const hasFeature = useCallback((feature: string): boolean => {
    if (isMaster) return true
    if (!subscription) return false
    if (subscription.status === 'NONE') return true
    return subscription.features.includes(feature)
  }, [isMaster, subscription])

  const isFeatureLocked = useCallback((feature: string): boolean => {
    return !hasFeature(feature)
  }, [hasFeature])

  const value = useMemo(() => ({
    subscription,
    loading,
    hasFeature,
    isFeatureLocked,
    reloadSubscription,
  }), [subscription, loading, hasFeature, isFeatureLocked, reloadSubscription])

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider')
  return ctx
}