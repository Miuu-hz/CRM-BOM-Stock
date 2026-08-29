import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, Users, Database, Star, ArrowRight, Home, RefreshCw, Zap, Plus, Trash2, X,
  CreditCard, Package, CalendarClock, Save, Search, Check, LayoutGrid, SlidersHorizontal,
  Inbox, Phone, UserPlus,
  Copy, Eye, EyeOff, KeyRound, Wand2, Mail, CheckCircle2, ExternalLink,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'

interface TenantStats {
  tenantId: string
  name: string
  isCurrentTenant: boolean
  userCount: number
  backupCount: number
  lastBackup: string | null
  lastLogin: string | null
}

interface McpQuota {
  used: number
  limit: number | null        // effective: override ?? max_users ตามแพ็กเกจ · null = ไม่จำกัด
  planLimit: number | null    // max_users ของแพ็กเกจปัจจุบัน
  override: number | null      // ค่าที่ override ไว้ (null = ยึดตามแพ็กเกจ)
  source: 'plan' | 'override'
}

const EMPTY_QUOTA: McpQuota = { used: 0, limit: 1, planLimit: 1, override: null, source: 'plan' }

interface ProvisionForm {
  businessName: string
  adminEmail: string
  adminPassword: string
  adminName: string
  customTenantId: string
}

// ==================== SUBSCRIPTIONS ====================

interface Usage { used: number; max: number | null }

interface TenantSubscription {
  tenantId: string
  name: string
  isCurrentTenant: boolean
  plan: string | null
  planName: string | null
  status: 'FREE' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE'
  currentPeriodEnd: string | null
  daysRemaining: number | null
  usage: { users: Usage; products: Usage }
}

interface Plan {
  code: string
  name: string
  description: string | null
  price_monthly: number
  price_yearly: number
  max_users: number | null
  max_products: number | null
  max_pos_shifts: number | null
  features: string[]
  is_active: number
}

interface PlanDraft { planCode: string; billingCycle: 'monthly' | 'yearly' }

// ค่าที่แก้ไขในฟอร์ม Plans — เก็บเป็น string, '' = ไม่จำกัด (null)
interface PlanEdit {
  price_monthly: string
  price_yearly: string
  max_users: string
  max_products: string
  max_pos_shifts: string
}

const initPlanEdit = (p: Plan): PlanEdit => ({
  price_monthly: String(p.price_monthly),
  price_yearly: String(p.price_yearly),
  max_users: p.max_users === null ? '' : String(p.max_users),
  max_products: p.max_products === null ? '' : String(p.max_products),
  max_pos_shifts: p.max_pos_shifts === null ? '' : String(p.max_pos_shifts),
})

const fmtMax = (n: number | null) => (n === null ? '∞' : n)

function StatusChip({ status, daysRemaining }: { status: TenantSubscription['status']; daysRemaining: number | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    FREE:      { label: 'FREE', cls: 'bg-[var(--surface-2)] text-[var(--fg-2)]' },
    ACTIVE:    { label: 'ACTIVE', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
    EXPIRED:   { label: 'EXPIRED', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
    CANCELLED: { label: 'CANCELLED', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
    NONE:      { label: 'ไม่มี subscription', cls: 'bg-[var(--surface-2)] text-[var(--fg-4)]' },
  }
  const s = map[status] ?? map.NONE
  return (
    <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + s.cls}>
      {s.label}{status === 'ACTIVE' && daysRemaining !== null ? ` · เหลือ ${daysRemaining} วัน` : ''}
    </span>
  )
}

// สีจุดสถานะบนรายชื่อ tenant ฝั่งซ้าย
const STATUS_DOT: Record<string, string> = {
  ACTIVE: 'var(--success)',
  FREE: 'var(--fg-4)',
  EXPIRED: 'var(--danger)',
  CANCELLED: 'var(--danger)',
  NONE: 'var(--fg-4)',
}

const PLAN_BADGE_CLS: Record<string, string> = {
  free: 'bg-[var(--surface-2)] text-[var(--fg-2)]',
  starter: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  business: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  enterprise: 'bg-[var(--success-soft)] text-[var(--success)]',
}

function QuotaBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    // ไม่จำกัด — แสดงแถบเต็มแบบจาง
    return (
      <div className="h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
        <div className="h-full w-full rounded-full opacity-40" style={{ backgroundColor: 'var(--success)' }} />
      </div>
    )
  }
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const barColor = ratio >= 1 ? 'var(--danger)' : ratio >= 0.8 ? 'var(--warning)' : 'var(--success)'
  return (
    <div className="h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ratio * 100}%`, backgroundColor: barColor }} />
    </div>
  )
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

const EMPTY_FORM: ProvisionForm = { businessName: '', adminEmail: '', adminPassword: '', adminName: '', customTenantId: '' }

// URL ที่ลูกค้าใช้เข้าระบบ (จาก APP_URL ฝั่ง backend)
const APP_URL = 'https://erp.phopy.net'
const GEN_EMAIL_DOMAIN = 'phopy.app'

// slug สำหรับ local-part ของอีเมล — ตัดอักขระที่ไม่ใช่ a-z0-9, กันภาษาไทยได้ (fallback 'shop')
function emailSlug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16)
  return s || 'shop'
}

function randToken(len: number): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789' // ตัด 0/o/1/l/i กันสับสน
  let out = ''
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length]
  return out
}

// อีเมลอัตโนมัติ — <slug>-<rand4>@phopy.app (ยูนีคพอจนแทบไม่ชนกัน)
function genEmail(businessName: string): string {
  return `${emailSlug(businessName)}-${randToken(4)}@${GEN_EMAIL_DOMAIN}`
}

// รหัสผ่านอ่านง่าย: 3 กลุ่ม กลุ่มละ 4 ตัว คั่นด้วย - (เช่น k7m2-rp9q-ta4x) ยาว 14 ≥ 8
function genPassword(): string {
  return `${randToken(4)}-${randToken(4)}-${randToken(4)}`
}

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(okMsg)
  } catch {
    toast.error('คัดลอกไม่สำเร็จ — คัดลอกด้วยมือได้เลย')
  }
}

type TopTab = 'tenants' | 'system' | 'signups'

interface SignupRequest {
  id: string
  business_name: string
  admin_name: string
  email: string
  phone: string | null
  status: string
  created_at: string
}
type DetailTab = 'overview' | 'subscription' | 'quota'

export default function MasterPanel() {
  const { isMaster, originalTenantId, token, switchTenant, loadTenants } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<TenantStats[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [mcpQuotas, setMcpQuotas] = useState<Record<string, McpQuota>>({})
  const [showProvisionModal, setShowProvisionModal] = useState(false)
  const [provisionForm, setProvisionForm] = useState<ProvisionForm>(EMPTY_FORM)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionStep, setProvisionStep] = useState<'form' | 'done'>('form')
  const [emailMode, setEmailMode] = useState<'manual' | 'auto'>('manual')
  const [showPw, setShowPw] = useState(true)
  // เก็บ credential ณ ตอนสร้าง (password ดึงย้อนหลังไม่ได้เพราะ hash แล้ว)
  const [createdCreds, setCreatedCreds] = useState<{ business: string; email: string; password: string; tenantId: string } | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [subscriptions, setSubscriptions] = useState<TenantSubscription[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [subLoading, setSubLoading] = useState(true)
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({})
  const [planEdits, setPlanEdits] = useState<Record<string, PlanEdit>>({})
  const [savingSub, setSavingSub] = useState<string | null>(null)
  const [extending, setExtending] = useState<string | null>(null)
  const [savingPlan, setSavingPlan] = useState<string | null>(null)

  // ---- UI state (master–detail) ----
  const [topTab, setTopTab] = useState<TopTab>('tenants')
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mcpDraft, setMcpDraft] = useState('')
  const [savingMcp, setSavingMcp] = useState(false)

  // ---- Signup requests (self-service, Master-approved) ----
  const [signupReqs, setSignupReqs] = useState<SignupRequest[]>([])
  const [signupLoading, setSignupLoading] = useState(true)
  const [actingSignup, setActingSignup] = useState<string | null>(null)

  useEffect(() => {
    if (!isMaster) { navigate('/'); return }
    loadStats()
    loadSubscriptionData()
    loadSignupRequests()
  }, [isMaster])

  const loadSignupRequests = async () => {
    setSignupLoading(true)
    try {
      const res = await api.get('/master/signup-requests?status=pending', { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) setSignupReqs(res.data.data)
    } catch { /* silent — tab just shows empty */ }
    finally { setSignupLoading(false) }
  }

  const handleApproveSignup = async (r: SignupRequest) => {
    setActingSignup(r.id)
    try {
      const res = await api.post(`/master/signup-requests/${r.id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success(`อนุมัติ ${r.business_name} แล้ว — ${r.admin_name} เข้าใช้งานได้ทันที`)
        loadSignupRequests()
        loadStats()
        loadSubscriptionData()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'อนุมัติไม่สำเร็จ')
    } finally {
      setActingSignup(null)
    }
  }

  const handleRejectSignup = async (r: SignupRequest) => {
    const reason = window.prompt(`ปฏิเสธคำขอของ "${r.business_name}"?\nระบุเหตุผล (ถ้ามี):`, '')
    if (reason === null) return
    setActingSignup(r.id)
    try {
      const res = await api.post(`/master/signup-requests/${r.id}/reject`, { reason }, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success(`ปฏิเสธคำขอของ ${r.business_name} แล้ว`)
        loadSignupRequests()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ไม่สำเร็จ')
    } finally {
      setActingSignup(null)
    }
  }

  // เลือก tenant เริ่มต้น = tenant ปัจจุบัน (ถ้าไม่มีค่อยเอาตัวแรก)
  useEffect(() => {
    if (stats.length === 0) return
    if (selectedId && stats.some(t => t.tenantId === selectedId)) return
    const current = stats.find(t => t.isCurrentTenant)
    setSelectedId((current ?? stats[0]).tenantId)
  }, [stats])

  const loadSubscriptionData = async () => {
    setSubLoading(true)
    try {
      const [subsRes, plansRes] = await Promise.all([
        api.get('/master/subscriptions', { headers: { Authorization: `Bearer ${token}` } }),
        api.get('/master/plans', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (subsRes.data.success) {
        const subs: TenantSubscription[] = subsRes.data.data
        setSubscriptions(subs)
        const drafts: Record<string, PlanDraft> = {}
        subs.forEach(s => { drafts[s.tenantId] = { planCode: s.plan ?? 'free', billingCycle: 'monthly' } })
        setPlanDrafts(drafts)
      }
      if (plansRes.data.success) {
        const ps: Plan[] = plansRes.data.data
        setPlans(ps)
        const edits: Record<string, PlanEdit> = {}
        ps.forEach(p => { edits[p.code] = initPlanEdit(p) })
        setPlanEdits(edits)
      }
    } catch { toast.error('โหลดข้อมูล subscription ไม่สำเร็จ') }
    finally { setSubLoading(false) }
  }

  const handleChangePlan = async (tenantId: string) => {
    const draft = planDrafts[tenantId]
    if (!draft) return
    setSavingSub(tenantId)
    try {
      const res = await api.put(`/master/tenant/${tenantId}/subscription`, {
        planCode: draft.planCode,
        billingCycle: draft.billingCycle,
      }, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success('อัปเดตแพ็กเกจแล้ว')
        loadSubscriptionData()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'อัปเดตแพ็กเกจไม่สำเร็จ')
    } finally {
      setSavingSub(null)
    }
  }

  const handleExtend = async (tenantId: string) => {
    setExtending(tenantId)
    try {
      const res = await api.post(`/master/tenant/${tenantId}/extend`, { days: 30 }, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success('ต่ออายุ +30 วันแล้ว')
        loadSubscriptionData()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ต่ออายุไม่สำเร็จ')
    } finally {
      setExtending(null)
    }
  }

  const handleSavePlan = async (code: string) => {
    const edit = planEdits[code]
    if (!edit) return
    const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
    for (const v of [edit.price_monthly, edit.price_yearly]) {
      if (v.trim() === '' || isNaN(Number(v)) || Number(v) < 0) { toast.error('ราคาต้องเป็นตัวเลขบวก'); return }
    }
    setSavingPlan(code)
    try {
      const res = await api.patch(`/master/plans/${code}`, {
        price_monthly: Number(edit.price_monthly),
        price_yearly: Number(edit.price_yearly),
        max_users: numOrNull(edit.max_users),
        max_products: numOrNull(edit.max_products),
        max_pos_shifts: numOrNull(edit.max_pos_shifts),
      }, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success('บันทึกแพ็กเกจแล้ว')
        loadSubscriptionData()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingPlan(null)
    }
  }

  const loadStats = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/master/stats`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        const tenants: TenantStats[] = res.data.data
        setStats(tenants)
        const quotas: Record<string, McpQuota> = {}
        await Promise.all(tenants.map(async (t) => {
          try {
            const r = await api.get(`/master/mcp-quota/${t.tenantId}`, { headers: { Authorization: `Bearer ${token}` } })
            quotas[t.tenantId] = r.data.data
          } catch { quotas[t.tenantId] = { ...EMPTY_QUOTA } }
        }))
        setMcpQuotas(quotas)
      }
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ') }
    finally { setLoading(false) }
  }

  const handleSwitch = async (tenantId: string) => {
    setSwitching(tenantId)
    const result = await switchTenant(tenantId)
    setSwitching(null)
    if (result.success) {
      await loadTenants()
      toast.success('เข้าใช้งาน ' + result.tenantName + ' แล้ว')
      navigate('/')
    } else {
      toast.error(result.message || 'สลับ tenant ไม่สำเร็จ')
    }
  }

  // เปิด modal พร้อม reset + gen password ให้อัตโนมัติ
  const openProvision = () => {
    setProvisionForm({ ...EMPTY_FORM, adminPassword: genPassword() })
    setEmailMode('manual')
    setShowPw(true)
    setProvisionStep('form')
    setCreatedCreds(null)
    setShowProvisionModal(true)
  }

  const closeProvision = () => {
    setShowProvisionModal(false)
    setProvisionForm(EMPTY_FORM)
    setCreatedCreds(null)
    setProvisionStep('form')
  }

  // สลับโหมดอีเมล: auto = gen ให้, manual = กรอกเอง
  const setEmailAuto = (auto: boolean) => {
    setEmailMode(auto ? 'auto' : 'manual')
    setProvisionForm(f => ({ ...f, adminEmail: auto ? genEmail(f.businessName) : '' }))
  }

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault()
    setProvisioning(true)
    try {
      const res = await api.post('/master/tenants', {
        businessName: provisionForm.businessName,
        adminEmail: provisionForm.adminEmail,
        adminPassword: provisionForm.adminPassword,
        adminName: provisionForm.adminName,
        customTenantId: provisionForm.customTenantId || undefined,
      }, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        const d = res.data.data
        toast.success(`สร้าง ${d.companyName} สำเร็จ!`)
        // เก็บ credential ไว้โชว์ในสเต็ป handoff (password โชว์ได้ครั้งเดียว)
        setCreatedCreds({
          business: d.companyName,
          email: provisionForm.adminEmail,
          password: provisionForm.adminPassword,
          tenantId: d.tenantId,
        })
        setProvisionStep('done')
        setSelectedId(d.tenantId)
        loadStats()
        loadSubscriptionData()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'สร้างไม่สำเร็จ')
    } finally {
      setProvisioning(false)
    }
  }

  // ข้อความ handoff สำหรับคัดลอกส่งลูกค้า
  const handoffText = (c: { business: string; email: string; password: string }) =>
    `ยินดีต้อนรับสู่ ${c.business} 🎉\n` +
    `เข้าใช้งานระบบที่: ${APP_URL}\n` +
    `อีเมล (ชื่อผู้ใช้): ${c.email}\n` +
    `รหัสผ่าน: ${c.password}\n\n` +
    `แนะนำให้เปลี่ยนรหัสผ่านหลังเข้าใช้ครั้งแรก`

  const handleDeactivate = async (tenantId: string, tenantName: string) => {
    if (!window.confirm(`ปิดการใช้งาน "${tenantName}" ใช่ไหม?\nผู้ใช้ทั้งหมดใน tenant นี้จะถูก deactivate`)) return
    setDeactivating(tenantId)
    try {
      const res = await api.delete(`/master/tenant/${tenantId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success(`ปิดการใช้งาน ${tenantName} แล้ว (${res.data.data.deactivated} users)`)
        loadStats()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ไม่สำเร็จ')
    } finally {
      setDeactivating(null)
    }
  }

  const handlePurge = async (tenantId: string, tenantName: string) => {
    if (!window.confirm(`ลบ "${tenantName}" ถาวรใช่ไหม?
ลบได้เฉพาะธุรกิจที่ไม่มีผู้ใช้และไม่มีข้อมูล — กู้คืนไม่ได้`)) return
    setDeactivating(tenantId)
    try {
      const res = await api.delete(`/master/tenant/${tenantId}/purge`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.data.success) {
        toast.success(`ลบ ${tenantName} ถาวรแล้ว`)
        setSelectedId(null)
        loadStats()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "ลบไม่สำเร็จ")
    } finally {
      setDeactivating(null)
    }
  }

  // value = number (override) หรือ null (เคลียร์ override → ยึดตามแพ็กเกจ)
  const handleSaveMcp = async (tenantId: string, value: number | null) => {
    setSavingMcp(true)
    try {
      await api.patch(`/master/tenant/${tenantId}/quota`, { mcpUserLimit: value }, { headers: { Authorization: `Bearer ${token}` } })
      toast.success(value === null ? 'กลับไปใช้ลิมิตตามแพ็กเกจแล้ว' : `override MCP limit → ${value} แล้ว`)
      setMcpDraft('')
      loadStats()
    } catch { toast.error('อัปเดตไม่สำเร็จ') }
    finally { setSavingMcp(false) }
  }

  // แปลงค่าในช่องกรอก: ว่าง = null (ตามแพ็กเกจ), มีเลข = override
  const submitMcp = (tenantId: string) => {
    const t = mcpDraft.trim()
    if (t === '') { handleSaveMcp(tenantId, null); return }
    const n = parseInt(t, 10)
    if (isNaN(n) || n < 0) { toast.error('กรุณาใส่ตัวเลข หรือเว้นว่างเพื่อใช้ตามแพ็กเกจ'); return }
    handleSaveMcp(tenantId, n)
  }

  const subByTenant = useMemo(() => {
    const m: Record<string, TenantSubscription> = {}
    subscriptions.forEach(s => { m[s.tenantId] = s })
    return m
  }, [subscriptions])

  const totalUsers = stats.reduce((s, t) => s + t.userCount, 0)
  const mcpUsedTotal = Object.values(mcpQuotas).reduce((s, q) => s + q.used, 0)
  const mcpHasUnlimited = Object.values(mcpQuotas).some(q => q.limit === null)
  const mcpLimitTotal = Object.values(mcpQuotas).reduce((s, q) => s + (q.limit ?? 0), 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return stats
    return stats.filter(t => t.name.toLowerCase().includes(q) || t.tenantId.toLowerCase().includes(q))
  }, [stats, search])

  const selStat = stats.find(t => t.tenantId === selectedId) ?? null
  const selSub = selectedId ? subByTenant[selectedId] : undefined
  const selQuota = selectedId ? (mcpQuotas[selectedId] ?? EMPTY_QUOTA) : EMPTY_QUOTA
  const selDraft = selectedId ? (planDrafts[selectedId] ?? { planCode: 'free', billingCycle: 'monthly' as const }) : { planCode: 'free', billingCycle: 'monthly' as const }

  const SUMMARY = [
    { label: 'ทั้งหมด', value: stats.length + ' tenants', icon: Building2 },
    { label: 'ผู้ใช้งานรวม', value: totalUsers + ' คน', icon: Users },
    { label: 'Backup ล่าสุด', value: fmtDate(stats.find(t => t.lastBackup)?.lastBackup ?? null), icon: Database },
    { label: 'MCP รวม', value: `${mcpUsedTotal}/${mcpHasUnlimited ? '∞' : mcpLimitTotal} users`, icon: Zap },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-phopy-mango to-phopy-mango-600 flex items-center justify-center">
            <Star className="w-5 h-5 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--fg-1)]">Master Panel</h1>
            <p className="text-sm text-[var(--fg-3)]">จัดการทุก tenant ในระบบจากที่เดียว</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
        >
          <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          รีเฟรช
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {SUMMARY.map(item => (
          <div key={item.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
            <item.icon className="w-5 h-5 text-[var(--primary)] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-[var(--fg-3)]">{item.label}</p>
              <p className="text-sm font-semibold text-[var(--fg-1)] truncate">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Top tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-[var(--border)]">
        {([
          { id: 'tenants' as const, label: 'Tenants', icon: LayoutGrid, badge: 0 },
          { id: 'signups' as const, label: 'คำขอสมัคร', icon: Inbox, badge: signupReqs.length },
          { id: 'system' as const, label: 'Plans & ตั้งค่าระบบ', icon: SlidersHorizontal, badge: 0 },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setTopTab(tab.id)}
            className={'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ' +
              (topTab === tab.id
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.badge > 0 && (
              <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-white text-[11px] font-semibold flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== TENANTS TAB (master–detail) ==================== */}
      {topTab === 'tenants' && (
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
          {/* ---- Master list ---- */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl flex flex-col overflow-hidden">
            <div className="p-3 border-b border-[var(--border)]">
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--fg-4)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="ค้นหาชื่อร้าน / tenant id"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[60vh] p-2 space-y-1">
              {loading ? (
                [1, 2, 3].map(i => <div key={i} className="h-14 bg-[var(--surface-2)] rounded-lg animate-pulse" />)
              ) : filtered.length === 0 ? (
                <p className="text-sm text-[var(--fg-4)] text-center py-8">ไม่พบ tenant</p>
              ) : (
                filtered.map(t => {
                  const sub = subByTenant[t.tenantId]
                  const dot = STATUS_DOT[sub?.status ?? 'NONE'] ?? 'var(--fg-4)'
                  const active = t.tenantId === selectedId
                  return (
                    <button
                      key={t.tenantId}
                      onClick={() => { setSelectedId(t.tenantId); setDetailTab('overview'); setMcpDraft('') }}
                      className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ' +
                        (active ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--surface-2)]')}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={'text-sm font-medium truncate ' + (active ? 'text-[var(--primary)]' : 'text-[var(--fg-1)]')}>{t.name}</p>
                          {t.tenantId === originalTenantId && <Home className="w-3 h-3 text-[var(--warning)] shrink-0" />}
                        </div>
                        <p className="text-xs text-[var(--fg-4)] font-mono truncate">{t.tenantId}</p>
                      </div>
                      {t.isCurrentTenant && <Check className="w-4 h-4 text-[var(--primary)] shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>

            <div className="p-2 border-t border-[var(--border)]">
              <button
                onClick={openProvision}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                เพิ่มลูกค้าใหม่
              </button>
            </div>
          </div>

          {/* ---- Detail panel ---- */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            {!selStat ? (
              <div className="flex items-center justify-center h-full min-h-[300px] text-sm text-[var(--fg-4)]">
                เลือก tenant จากรายการทางซ้าย
              </div>
            ) : (
              <div className="flex flex-col h-full">
                {/* Detail header */}
                <div className="p-5 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-[var(--primary)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-lg text-[var(--fg-1)]">{selStat.name}</p>
                        {selStat.tenantId === originalTenantId && (
                          <span className="flex items-center gap-1 text-xs bg-[var(--warning-soft)] text-[var(--warning)] px-2 py-0.5 rounded-full font-medium">
                            <Home className="w-3 h-3" /> Home
                          </span>
                        )}
                        {selStat.isCurrentTenant && (
                          <span className="text-xs bg-[var(--primary-soft)] text-[var(--primary)] px-2 py-0.5 rounded-full font-medium">Active</span>
                        )}
                        {selSub && <StatusChip status={selSub.status} daysRemaining={selSub.daysRemaining} />}
                      </div>
                      <p className="text-xs text-[var(--fg-4)] font-mono mt-0.5">{selStat.tenantId}</p>
                    </div>
                  </div>

                  {/* Detail sub-tabs */}
                  <div className="flex items-center gap-1 mt-4">
                    {([
                      { id: 'overview' as const, label: 'ภาพรวม' },
                      { id: 'subscription' as const, label: 'Subscription' },
                      { id: 'quota' as const, label: 'Quota' },
                    ]).map(st => (
                      <button
                        key={st.id}
                        onClick={() => setDetailTab(st.id)}
                        className={'px-3 py-1.5 rounded-lg text-sm font-medium transition-all ' +
                          (detailTab === st.id
                            ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                            : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)]')}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detail body */}
                <div className="p-5 flex-1">
                  {/* --- Overview --- */}
                  {detailTab === 'overview' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Users', value: selStat.userCount },
                          { label: 'สินค้า', value: selSub ? `${selSub.usage.products.used}/${fmtMax(selSub.usage.products.max)}` : '-' },
                          { label: 'Backups', value: selStat.backupCount },
                          { label: 'MCP', value: `${selQuota.used}/${fmtMax(selQuota.limit)}` },
                        ].map(box => (
                          <div key={box.label} className="text-center p-3 bg-[var(--surface-2)] rounded-lg">
                            <p className="text-lg font-bold text-[var(--fg-1)]">{box.value}</p>
                            <p className="text-xs text-[var(--fg-3)]">{box.label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg">
                          <span className="text-[var(--fg-3)]">Backup ล่าสุด</span>
                          <span className="text-[var(--fg-1)] font-medium">{fmtDate(selStat.lastBackup)}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg">
                          <span className="text-[var(--fg-3)]">Login ล่าสุด</span>
                          <span className="text-[var(--fg-1)] font-medium">{fmtDate(selStat.lastLogin)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* --- Subscription --- */}
                  {detailTab === 'subscription' && (
                    <div className="space-y-4">
                      {!selSub ? (
                        <p className="text-sm text-[var(--fg-4)]">ไม่มีข้อมูล subscription</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            {selSub.plan && (
                              <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + (PLAN_BADGE_CLS[selSub.plan] ?? PLAN_BADGE_CLS.free)}>
                                {selSub.planName}
                              </span>
                            )}
                            <StatusChip status={selSub.status} daysRemaining={selSub.daysRemaining} />
                            <span className="text-xs text-[var(--fg-3)]">
                              {selSub.status === 'FREE' && 'ไม่มีวันหมดอายุ'}
                              {selSub.status === 'ACTIVE' && `หมดอายุ ${fmtDate(selSub.currentPeriodEnd)}`}
                              {selSub.status === 'EXPIRED' && `หมดอายุแล้ว (${fmtDate(selSub.currentPeriodEnd)})`}
                              {(selSub.status === 'NONE' || selSub.status === 'CANCELLED') && '-'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="text-center p-3 bg-[var(--surface-2)] rounded-lg">
                              <p className="text-sm font-bold text-[var(--fg-1)]">{selSub.usage.users.used}/{fmtMax(selSub.usage.users.max)}</p>
                              <p className="text-xs text-[var(--fg-3)]">Users</p>
                            </div>
                            <div className="text-center p-3 bg-[var(--surface-2)] rounded-lg">
                              <p className="text-sm font-bold text-[var(--fg-1)]">{selSub.usage.products.used}/{fmtMax(selSub.usage.products.max)}</p>
                              <p className="text-xs text-[var(--fg-3)]">สินค้า</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs text-[var(--fg-3)]">เปลี่ยนแพ็กเกจ</label>
                            <div className="flex items-center gap-2 flex-wrap">
                              <select
                                value={selDraft.planCode}
                                onChange={e => setPlanDrafts(prev => ({ ...prev, [selSub.tenantId]: { ...selDraft, planCode: e.target.value } }))}
                                className="flex-1 min-w-[120px] px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                              >
                                {plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                              </select>
                              <select
                                value={selDraft.billingCycle}
                                onChange={e => setPlanDrafts(prev => ({ ...prev, [selSub.tenantId]: { ...selDraft, billingCycle: e.target.value as 'monthly' | 'yearly' } }))}
                                className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                              >
                                <option value="monthly">รายเดือน</option>
                                <option value="yearly">รายปี</option>
                              </select>
                              <button
                                onClick={() => handleChangePlan(selSub.tenantId)}
                                disabled={savingSub === selSub.tenantId}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60"
                              >
                                {savingSub === selSub.tenantId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                บันทึก
                              </button>
                            </div>
                            <button
                              onClick={() => handleExtend(selSub.tenantId)}
                              disabled={!((selSub.status === 'ACTIVE' || selSub.status === 'EXPIRED') && !!selSub.currentPeriodEnd) || extending === selSub.tenantId}
                              title={(selSub.status === 'ACTIVE' || selSub.status === 'EXPIRED') ? 'ต่ออายุอีก 30 วัน' : 'แพ็กเกจ Free ไม่มีวันหมดอายุ'}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {extending === selSub.tenantId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                              ต่ออายุ +30 วัน
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* --- Quota --- */}
                  {detailTab === 'quota' && (
                    <div className="space-y-5">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-4 h-4 text-[var(--primary)]" />
                            <span className="text-sm font-medium text-[var(--fg-1)]">MCP users</span>
                            {selQuota.source === 'override'
                              ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--warning-soft)] text-[var(--warning)]">override</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--primary-soft)] text-[var(--primary)]">ตามแพ็กเกจ</span>}
                          </div>
                          <span className="text-sm text-[var(--fg-3)]">{selQuota.used}/{fmtMax(selQuota.limit)} users</span>
                        </div>
                        <QuotaBar used={selQuota.used} limit={selQuota.limit} />

                        {/* ที่มาของลิมิต */}
                        <p className="text-xs text-[var(--fg-4)] mt-2">
                          {selQuota.source === 'override'
                            ? <>override เป็น <b className="text-[var(--fg-2)]">{fmtMax(selQuota.override)}</b> · แพ็กเกจ{selSub?.planName ? ` ${selSub.planName}` : ''} กำหนด {fmtMax(selQuota.planLimit)}</>
                            : <>ยึดตามแพ็กเกจ{selSub?.planName ? ` ${selSub.planName}` : ''} — max_users = <b className="text-[var(--fg-2)]">{fmtMax(selQuota.planLimit)}</b></>}
                        </p>

                        <div className="flex items-end gap-2 mt-3">
                          <div className="flex-1">
                            <label className="block text-xs text-[var(--fg-3)] mb-1">override <span className="text-[var(--fg-4)]">(เว้นว่าง = ตามแพ็กเกจ)</span></label>
                            <input
                              type="number"
                              min={0}
                              value={mcpDraft}
                              placeholder={`ตามแพ็กเกจ: ${fmtMax(selQuota.planLimit)}`}
                              onChange={e => setMcpDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && selStat) submitMcp(selStat.tenantId) }}
                              className="w-full px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                            />
                          </div>
                          <button
                            onClick={() => selStat && submitMcp(selStat.tenantId)}
                            disabled={savingMcp}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60"
                          >
                            {savingMcp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            บันทึก
                          </button>
                        </div>
                        {selQuota.source === 'override' && (
                          <button
                            onClick={() => selStat && handleSaveMcp(selStat.tenantId, null)}
                            disabled={savingMcp}
                            className="mt-2 text-xs text-[var(--primary)] hover:underline disabled:opacity-60"
                          >
                            ← ล้าง override · ใช้ลิมิตตามแพ็กเกจ
                          </button>
                        )}
                      </div>

                      {selSub && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 bg-[var(--surface-2)] rounded-lg">
                            <div className="flex items-center justify-between mb-1.5 text-xs">
                              <span className="text-[var(--fg-3)]">Users</span>
                              <span className="text-[var(--fg-1)] font-medium">{selSub.usage.users.used}/{fmtMax(selSub.usage.users.max)}</span>
                            </div>
                            {selSub.usage.users.max !== null && <QuotaBar used={selSub.usage.users.used} limit={selSub.usage.users.max} />}
                          </div>
                          <div className="p-3 bg-[var(--surface-2)] rounded-lg">
                            <div className="flex items-center justify-between mb-1.5 text-xs">
                              <span className="text-[var(--fg-3)]">สินค้า</span>
                              <span className="text-[var(--fg-1)] font-medium">{selSub.usage.products.used}/{fmtMax(selSub.usage.products.max)}</span>
                            </div>
                            {selSub.usage.products.max !== null && <QuotaBar used={selSub.usage.products.used} limit={selSub.usage.products.max} />}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Detail footer actions */}
                <div className="p-4 border-t border-[var(--border)] flex items-center gap-3">
                  <button
                    onClick={() => handleSwitch(selStat.tenantId)}
                    disabled={selStat.isCurrentTenant || switching === selStat.tenantId}
                    className={'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ' +
                      (selStat.isCurrentTenant ? 'bg-[var(--primary-soft)] text-[var(--primary)] cursor-default' : 'bg-[var(--primary)] text-white hover:opacity-90 active:scale-95')}
                  >
                    {switching === selStat.tenantId ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : selStat.isCurrentTenant ? 'กำลังใช้งาน'
                      : <><ArrowRight className="w-4 h-4" /> เข้าใช้งาน</>}
                  </button>
                  <button
                    onClick={() => handleDeactivate(selStat.tenantId, selStat.name)}
                    disabled={deactivating === selStat.tenantId || selStat.isCurrentTenant}
                    title="ปิดการใช้งาน tenant"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {deactivating === selStat.tenantId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    ปิดใช้งาน
                  </button>
                  {selStat.userCount === 0 && !selStat.isCurrentTenant && (
                    <button
                      onClick={() => handlePurge(selStat.tenantId, selStat.name)}
                      disabled={deactivating === selStat.tenantId}
                      title="ลบถาวร (เฉพาะธุรกิจว่าง)"
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                      ลบถาวร
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SIGNUP REQUESTS TAB ==================== */}
      {topTab === 'signups' && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Inbox className="w-5 h-5 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold text-[var(--fg-1)]">คำขอสมัครใช้งาน</h2>
            <span className="text-sm text-[var(--fg-4)]">— รออนุมัติ {signupReqs.length} รายการ</span>
            <button
              onClick={loadSignupRequests}
              disabled={signupLoading}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
            >
              <RefreshCw className={'w-4 h-4 ' + (signupLoading ? 'animate-spin' : '')} />
              รีเฟรช
            </button>
          </div>

          {signupLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <div key={i} className="h-40 bg-[var(--surface-2)] rounded-xl animate-pulse" />)}
            </div>
          ) : signupReqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center mb-3">
                <Inbox className="w-6 h-6 text-[var(--fg-4)]" />
              </div>
              <p className="text-sm text-[var(--fg-3)]">ยังไม่มีคำขอสมัครที่รออนุมัติ</p>
              <p className="text-xs text-[var(--fg-4)] mt-1">คำขอจากหน้าสมัครใช้งานจะมาแสดงที่นี่</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {signupReqs.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--warning-soft)] flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-[var(--warning)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--fg-1)] truncate">{r.business_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">ส่งคำขอ {fmtDate(r.created_at)}</p>
                    </div>
                    <span className="text-xs bg-[var(--warning-soft)] text-[var(--warning)] px-2 py-0.5 rounded-full font-medium">รออนุมัติ</span>
                  </div>

                  <div className="space-y-1.5 text-sm mb-4">
                    <div className="flex items-center gap-2 text-[var(--fg-2)]">
                      <UserPlus className="w-4 h-4 text-[var(--fg-4)] shrink-0" /> <span className="truncate">{r.admin_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--fg-2)]">
                      <Mail className="w-4 h-4 text-[var(--fg-4)] shrink-0" /> <span className="truncate font-mono text-xs">{r.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--fg-2)]">
                      <Phone className="w-4 h-4 text-[var(--fg-4)] shrink-0" />
                      {r.phone
                        ? <a href={`tel:${r.phone}`} className="text-[var(--primary)] hover:underline">{r.phone}</a>
                        : <span className="text-[var(--fg-4)]">ไม่ระบุ</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproveSignup(r)}
                      disabled={actingSignup === r.id}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60"
                    >
                      {actingSignup === r.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      อนุมัติ
                    </button>
                    <button
                      onClick={() => handleRejectSignup(r)}
                      disabled={actingSignup === r.id}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all text-sm disabled:opacity-40"
                    >
                      <X className="w-4 h-4" /> ปฏิเสธ
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== SYSTEM TAB (Plans) ==================== */}
      {topTab === 'system' && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-[var(--primary)]" />
            <h2 className="text-lg font-semibold text-[var(--fg-1)]">แพ็กเกจ (Plans)</h2>
            <span className="text-sm text-[var(--fg-4)]">— ตั้งค่าราคา/ลิมิตกลางของทุกแพ็กเกจ</span>
          </div>
          {subLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <div key={i} className="h-56 bg-[var(--surface-2)] rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans.map(p => {
                const edit = planEdits[p.code] ?? initPlanEdit(p)
                const upd = (k: keyof PlanEdit, v: string) =>
                  setPlanEdits(prev => ({ ...prev, [p.code]: { ...(prev[p.code] ?? initPlanEdit(p)), [k]: v } }))
                const numInput = (key: keyof PlanEdit, label: string, placeholder = '') => (
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">{label}</label>
                    <input
                      type="number"
                      min={0}
                      value={edit[key]}
                      placeholder={placeholder}
                      onChange={e => upd(key, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                )
                return (
                  <div key={p.code} className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + (PLAN_BADGE_CLS[p.code] ?? PLAN_BADGE_CLS.free)}>
                          {p.name}
                        </span>
                        {!p.is_active && <span className="text-xs text-[var(--danger)]">ปิดใช้งาน</span>}
                      </div>
                      <span className="text-xs font-mono text-[var(--fg-4)]">{p.code}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {numInput('price_monthly', 'ราคา/เดือน (฿)')}
                      {numInput('price_yearly', 'ราคา/ปี (฿)')}
                      {numInput('max_users', 'Users สูงสุด', '∞')}
                      {numInput('max_products', 'สินค้าสูงสุด', '∞')}
                      {numInput('max_pos_shifts', 'กะ POS พร้อมกัน', '∞')}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {p.features.map(f => (
                        <span key={f} className="text-xs bg-[var(--surface-2)] text-[var(--fg-3)] px-2 py-0.5 rounded-full">{f}</span>
                      ))}
                    </div>
                    <button
                      onClick={() => handleSavePlan(p.code)}
                      disabled={savingPlan === p.code}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60"
                    >
                      {savingPlan === p.code ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      บันทึก
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Provision Modal — 2 สเต็ป: form → handoff */}
      <AnimatePresence>
        {showProvisionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget && provisionStep === 'form') closeProvision() }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-md"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <div className={'w-8 h-8 rounded-lg flex items-center justify-center ' + (provisionStep === 'done' ? 'bg-[var(--success-soft)]' : 'bg-[var(--primary-soft)]')}>
                    {provisionStep === 'done'
                      ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />
                      : <Plus className="w-4 h-4 text-[var(--primary)]" />}
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--fg-1)]">
                    {provisionStep === 'done' ? 'สร้างลูกค้าสำเร็จ' : 'เพิ่มลูกค้าใหม่'}
                  </h2>
                </div>
                <button onClick={closeProvision} className="p-1.5 rounded-lg text-[var(--fg-3)] hover:bg-[var(--surface-2)] transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* ---------- STEP: FORM ---------- */}
              {provisionStep === 'form' && (
                <form onSubmit={handleProvision} className="p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">ชื่อธุรกิจ *</label>
                    <input
                      type="text"
                      required
                      value={provisionForm.businessName}
                      onChange={e => {
                        const businessName = e.target.value
                        setProvisionForm(f => ({ ...f, businessName, adminEmail: emailMode === 'auto' ? genEmail(businessName) : f.adminEmail }))
                      }}
                      placeholder="เช่น ร้านกาแฟ ABC"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">ชื่อ Admin *</label>
                    <input
                      type="text"
                      required
                      value={provisionForm.adminName}
                      onChange={e => setProvisionForm(f => ({ ...f, adminName: e.target.value }))}
                      placeholder="ชื่อ-นามสกุล Admin"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
                    />
                  </div>

                  {/* Email + toggle กรอกเอง / gen ให้ */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-[var(--fg-2)]">อีเมล (ชื่อผู้ใช้) *</label>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                        <button type="button" onClick={() => setEmailAuto(false)}
                          className={'px-2 py-0.5 rounded-md text-xs font-medium transition-all ' + (emailMode === 'manual' ? 'bg-[var(--surface)] text-[var(--fg-1)] shadow-sm' : 'text-[var(--fg-3)]')}>
                          กรอกเอง
                        </button>
                        <button type="button" onClick={() => setEmailAuto(true)}
                          className={'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all ' + (emailMode === 'auto' ? 'bg-[var(--surface)] text-[var(--fg-1)] shadow-sm' : 'text-[var(--fg-3)]')}>
                          <Wand2 className="w-3 h-3" /> gen ให้
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[var(--fg-4)] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={emailMode === 'auto' ? 'text' : 'email'}
                        required
                        readOnly={emailMode === 'auto'}
                        value={provisionForm.adminEmail}
                        onChange={e => setProvisionForm(f => ({ ...f, adminEmail: e.target.value }))}
                        placeholder="admin@example.com"
                        className={'w-full pl-9 pr-10 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm ' + (emailMode === 'auto' ? 'font-mono' : '')}
                      />
                      {emailMode === 'auto' && (
                        <button type="button" title="สุ่มอีเมลใหม่"
                          onClick={() => setProvisionForm(f => ({ ...f, adminEmail: genEmail(f.businessName) }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-all">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {emailMode === 'auto' && (
                      <p className="text-xs text-[var(--fg-4)] mt-1">อีเมลอัตโนมัติ (ใช้เป็นชื่อผู้ใช้เข้าระบบ ไม่ต้องส่งอีเมลจริง)</p>
                    )}
                  </div>

                  {/* Password — gen อัตโนมัติ, ดู/สุ่มใหม่/คัดลอกได้ */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">
                      รหัสผ่าน * <span className="text-[var(--fg-4)] font-normal">(ระบบสุ่มให้ · แก้ได้)</span>
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[var(--fg-4)] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPw ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={provisionForm.adminPassword}
                        onChange={e => setProvisionForm(f => ({ ...f, adminPassword: e.target.value }))}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-24 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm font-mono"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        <button type="button" title={showPw ? 'ซ่อน' : 'แสดง'} onClick={() => setShowPw(v => !v)}
                          className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-all">
                          {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button type="button" title="คัดลอก" onClick={() => copyText(provisionForm.adminPassword, 'คัดลอกรหัสผ่านแล้ว')}
                          className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-all">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" title="สุ่มใหม่" onClick={() => setProvisionForm(f => ({ ...f, adminPassword: genPassword() }))}
                          className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-all">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">
                      Tenant ID <span className="text-[var(--fg-4)] font-normal">(เว้นว่างให้ระบบสร้างอัตโนมัติ)</span>
                    </label>
                    <input
                      type="text"
                      value={provisionForm.customTenantId}
                      onChange={e => setProvisionForm(f => ({ ...f, customTenantId: e.target.value }))}
                      placeholder="tenant_my_shop (optional)"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm font-mono"
                    />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={closeProvision}
                      className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={provisioning}
                      className="flex-1 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {provisioning ? <><RefreshCw className="w-4 h-4 animate-spin" /> กำลังสร้าง...</> : <>สร้าง & แสดงข้อมูลเข้าใช้ <ArrowRight className="w-4 h-4" /></>}
                    </button>
                  </div>
                </form>
              )}

              {/* ---------- STEP: HANDOFF ---------- */}
              {provisionStep === 'done' && createdCreds && (
                <div className="p-5 space-y-4">
                  <p className="text-sm text-[var(--fg-2)]">
                    สร้าง <b className="text-[var(--fg-1)]">{createdCreds.business}</b> เรียบร้อย —
                    คัดลอกข้อมูลด้านล่างส่งให้ลูกค้าเข้าใช้งานได้เลย
                  </p>

                  {/* การ์ด credential */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] divide-y divide-[var(--border)]">
                    {[
                      { icon: ExternalLink, label: 'เว็บไซต์', value: APP_URL, ok: 'คัดลอกลิงก์แล้ว', mono: false },
                      { icon: Mail, label: 'อีเมล (ชื่อผู้ใช้)', value: createdCreds.email, ok: 'คัดลอกอีเมลแล้ว', mono: true },
                      { icon: KeyRound, label: 'รหัสผ่าน', value: createdCreds.password, ok: 'คัดลอกรหัสผ่านแล้ว', mono: true },
                    ].map(row => (
                      <div key={row.label} className="flex items-center gap-3 p-3">
                        <row.icon className="w-4 h-4 text-[var(--fg-4)] shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-[var(--fg-3)]">{row.label}</p>
                          <p className={'text-sm text-[var(--fg-1)] truncate ' + (row.mono ? 'font-mono' : '')}>{row.value}</p>
                        </div>
                        <button onClick={() => copyText(row.value, row.ok)} title="คัดลอก"
                          className="p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-all shrink-0">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-start gap-2 text-xs text-[var(--warning)] bg-[var(--warning-soft)] rounded-lg p-2.5">
                    <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>บันทึกรหัสผ่านนี้ไว้ตอนนี้ — ระบบเก็บแบบเข้ารหัส ไม่สามารถเปิดดูย้อนหลังได้ (รีเซ็ตใหม่ได้เท่านั้น)</span>
                  </div>

                  <button
                    onClick={() => copyText(handoffText(createdCreds), 'คัดลอกข้อความส่งลูกค้าแล้ว')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium"
                  >
                    <Copy className="w-4 h-4" /> คัดลอกทั้งหมด (ข้อความส่งลูกค้า)
                  </button>

                  <div className="flex gap-3">
                    <button
                      onClick={openProvision}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
                    >
                      <Plus className="w-4 h-4" /> เพิ่มอีกราย
                    </button>
                    <button
                      onClick={closeProvision}
                      className="flex-1 py-2.5 rounded-lg bg-[var(--surface-2)] text-[var(--fg-1)] hover:bg-[var(--border)] transition-all text-sm font-medium"
                    >
                      เสร็จสิ้น
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
