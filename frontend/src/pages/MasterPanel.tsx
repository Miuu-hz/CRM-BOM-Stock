import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Users, Database, Star, ArrowRight, Home, RefreshCw, Zap, Plus, Trash2, X } from 'lucide-react'
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

interface McpQuota { used: number; limit: number }

interface ProvisionForm {
  businessName: string
  adminEmail: string
  adminPassword: string
  adminName: string
  customTenantId: string
}

function McpQuotaBar({ tenantId, quota, token, onRefresh }: {
  tenantId: string; quota: McpQuota; token: string | null; onRefresh: () => void
}) {
  const { used, limit } = quota
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const barColor = ratio >= 1 ? 'var(--danger)' : ratio >= 0.8 ? 'var(--warning)' : 'var(--success)'
  const handleEdit = async () => {
    const input = window.prompt(`MCP user limit ใหม่สำหรับ ${tenantId} (ปัจจุบัน: ${limit})`, String(limit))
    if (input === null) return
    const n = parseInt(input, 10)
    if (isNaN(n) || n < 0) { toast.error('กรุณาใส่ตัวเลข'); return }
    try {
      await api.patch(`/master/tenant/${tenantId}/quota`, { mcpUserLimit: n }, { headers: { Authorization: `Bearer ${token}` } })
      toast.success(`MCP limit → ${n} แล้ว`)
      onRefresh()
    } catch { toast.error('อัปเดตไม่สำเร็จ') }
  }
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[var(--primary)]" />
          <span className="text-xs font-medium text-[var(--fg-2)]">MCP</span>
          <span className="text-xs text-[var(--fg-4)]">{used}/{limit} users</span>
        </div>
        <button onClick={handleEdit} className="text-xs text-[var(--primary)] hover:underline px-1">⚙ แก้ไข</button>
      </div>
      <div className="h-1 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ratio * 100}%`, backgroundColor: barColor }} />
      </div>
    </div>
  )
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

const EMPTY_FORM: ProvisionForm = { businessName: '', adminEmail: '', adminPassword: '', adminName: '', customTenantId: '' }

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
  const [deactivating, setDeactivating] = useState<string | null>(null)

  useEffect(() => {
    if (!isMaster) { navigate('/'); return }
    loadStats()
  }, [isMaster])

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
          } catch { quotas[t.tenantId] = { used: 0, limit: 1 } }
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
        toast.success(`สร้าง ${d.companyName} สำเร็จ! (${d.tenantId})`)
        setShowProvisionModal(false)
        setProvisionForm(EMPTY_FORM)
        loadStats()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'สร้างไม่สำเร็จ')
    } finally {
      setProvisioning(false)
    }
  }

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

  const totalUsers = stats.reduce((s, t) => s + t.userCount, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-phopy-mango to-phopy-mango-600 flex items-center justify-center">
            <Star className="w-5 h-5 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--fg-1)]">Master Panel</h1>
            <p className="text-sm text-[var(--fg-3)]">จัดการทุก tenant ในระบบ</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProvisionModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            เพิ่มลูกค้าใหม่
          </button>
          <button
            onClick={loadStats}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
          >
            <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
            รีเฟรช
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'ทั้งหมด', value: stats.length + ' tenants', icon: Building2 },
          { label: 'ผู้ใช้งานรวม', value: totalUsers + ' คน', icon: Users },
          { label: 'Backup ล่าสุด', value: fmtDate(stats.find(t => t.lastBackup)?.lastBackup ?? null), icon: Database },
          { label: 'MCP รวม', value: `${Object.values(mcpQuotas).reduce((s,q)=>s+q.used,0)}/${Object.values(mcpQuotas).reduce((s,q)=>s+q.limit,0)} users`, icon: Zap },
        ].map(item => (
          <div key={item.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3">
            <item.icon className="w-5 h-5 text-[var(--primary)]" />
            <div>
              <p className="text-xs text-[var(--fg-3)]">{item.label}</p>
              <p className="text-sm font-semibold text-[var(--fg-1)]">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tenant cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="h-48 bg-[var(--surface-2)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.map((t, i) => (
            <motion.div
              key={t.tenantId}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={'bg-[var(--surface)] rounded-xl border-2 transition-all ' + (t.isCurrentTenant ? 'border-[var(--primary)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}
            >
              <div className="p-5">
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-[var(--primary)]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[var(--fg-1)]">{t.name}</p>
                        {t.tenantId === originalTenantId && (
                          <span className="flex items-center gap-1 text-xs bg-[var(--warning-soft)] text-[var(--warning)] px-2 py-0.5 rounded-full font-medium">
                            <Home className="w-3 h-3" /> Home
                          </span>
                        )}
                        {t.isCurrentTenant && (
                          <span className="text-xs bg-[var(--primary-soft)] text-[var(--primary)] px-2 py-0.5 rounded-full font-medium">Active</span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--fg-4)] font-mono">{t.tenantId}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeactivate(t.tenantId, t.name)}
                    disabled={deactivating === t.tenantId || t.isCurrentTenant}
                    title="Deactivate tenant"
                    className="p-1.5 rounded-lg text-[var(--fg-4)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {deactivating === t.tenantId
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />
                    }
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-lg font-bold text-[var(--fg-1)]">{t.userCount}</p>
                    <p className="text-xs text-[var(--fg-3)]">Users</p>
                  </div>
                  <div className="text-center p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-lg font-bold text-[var(--fg-1)]">{t.backupCount}</p>
                    <p className="text-xs text-[var(--fg-3)]">Backups</p>
                  </div>
                  <div className="text-center p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-xs font-semibold text-[var(--fg-1)] leading-tight">{fmtDate(t.lastBackup)}</p>
                    <p className="text-xs text-[var(--fg-3)]">Last backup</p>
                  </div>
                </div>

                <p className="text-xs text-[var(--fg-4)] mb-3">Login ล่าสุด: {fmtDate(t.lastLogin)}</p>

                <McpQuotaBar tenantId={t.tenantId} quota={mcpQuotas[t.tenantId] ?? { used: 0, limit: 1 }} token={token} onRefresh={loadStats} />

                <button
                  onClick={() => handleSwitch(t.tenantId)}
                  disabled={t.isCurrentTenant || switching === t.tenantId}
                  className={'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ' + (t.isCurrentTenant ? 'bg-[var(--primary-soft)] text-[var(--primary)] cursor-default' : 'bg-[var(--primary)] text-white hover:opacity-90 active:scale-95')}
                >
                  {switching === t.tenantId ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : t.isCurrentTenant ? (
                    'กำลังใช้งาน'
                  ) : (
                    <><ArrowRight className="w-4 h-4" /> เข้าใช้งาน</>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Provision Modal */}
      <AnimatePresence>
        {showProvisionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowProvisionModal(false) }}
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
                  <div className="w-8 h-8 rounded-lg bg-[var(--primary-soft)] flex items-center justify-center">
                    <Plus className="w-4 h-4 text-[var(--primary)]" />
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--fg-1)]">เพิ่มลูกค้าใหม่</h2>
                </div>
                <button onClick={() => setShowProvisionModal(false)} className="p-1.5 rounded-lg text-[var(--fg-3)] hover:bg-[var(--surface-2)] transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleProvision} className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">ชื่อธุรกิจ *</label>
                  <input
                    type="text"
                    required
                    value={provisionForm.businessName}
                    onChange={e => setProvisionForm(f => ({ ...f, businessName: e.target.value }))}
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

                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">Email Admin *</label>
                  <input
                    type="email"
                    required
                    value={provisionForm.adminEmail}
                    onChange={e => setProvisionForm(f => ({ ...f, adminEmail: e.target.value }))}
                    placeholder="admin@example.com"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">รหัสผ่าน Admin * <span className="text-[var(--fg-4)] font-normal">(อย่างน้อย 8 ตัว)</span></label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={provisionForm.adminPassword}
                    onChange={e => setProvisionForm(f => ({ ...f, adminPassword: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
                  />
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
                    onClick={() => { setShowProvisionModal(false); setProvisionForm(EMPTY_FORM) }}
                    className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-all text-sm"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={provisioning}
                    className="flex-1 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {provisioning ? <><RefreshCw className="w-4 h-4 animate-spin" /> กำลังสร้าง...</> : 'สร้าง Tenant'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
