import { useState, useEffect } from 'react'
import {
  UserCog, ChevronDown, ChevronRight, Save, RefreshCw, Shield,
} from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'

interface TenantUser {
  id: string
  email: string
  name: string
  role: string
  departments: string[]
  custom_permissions: Record<string, boolean> | null
  status: string
}

const DEPT_OPTIONS = [
  { value: 'SALES',      label: 'Sales — ขาย',         desc: 'ลูกค้า, คำสั่งซื้อ, การตลาด' },
  { value: 'PURCHASE',   label: 'Purchase — จัดซื้อ',  desc: 'จัดซื้อ, ซัพพลายเออร์' },
  { value: 'STOCK',      label: 'Stock — คลัง',        desc: 'คลังสินค้า' },
  { value: 'ACCOUNTING', label: 'Accounting — บัญชี',  desc: 'บัญชี, รายงานการเงิน' },
  { value: 'PRODUCTION', label: 'Production — ผลิต',   desc: 'การผลิต, BOM, Work Orders' },
  { value: 'QC',         label: 'QC — ควบคุมคุณภาพ',  desc: 'ตรวจสอบคุณภาพ' },
  { value: 'MARKETING',  label: 'Marketing — การตลาด', desc: 'การตลาด' },
  { value: 'CEO',        label: 'CEO / เจ้าของ',       desc: 'เข้าถึงทุกส่วน' },
  { value: 'IT',         label: 'IT / Admin',           desc: 'เข้าถึงทุกส่วนรวมถึง Settings' },
]

const ROLE_OPTIONS = [
  { value: 'MANAGER',   label: 'Manager — ผู้จัดการ',     desc: 'อ่าน/เขียน/อนุมัติ/ลบ ในแผนกของตน' },
  { value: 'POWERUSER', label: 'Power User — ผู้ใช้หลัก', desc: 'อ่าน/เขียน/อนุมัติ ทุกแผนก' },
  { value: 'USER',      label: 'User — ผู้ใช้ทั่วไป',     desc: 'อ่าน/เขียน ในแผนกของตน' },
]

const CUSTOM_PERMS = [
  { key: 'accounting:delete', label: 'ลบข้อมูลบัญชี' },
  { key: 'stock:delete',      label: 'ลบรายการคลัง' },
  { key: 'orders:delete',     label: 'ลบคำสั่งซื้อ' },
  { key: 'users:write',       label: 'จัดการผู้ใช้งาน' },
]

const PRESETS: { label: string; departments: string[]; customPermissions: Record<string, boolean> }[] = [
  { label: 'พนักงานขาย',      departments: ['SALES'],                       customPermissions: {} },
  { label: 'แคชเชียร์',       departments: [],                              customPermissions: { 'cashier:read': true, 'cashier:write': true } },
  { label: 'นักบัญชี',        departments: ['ACCOUNTING', 'PURCHASE'],      customPermissions: {} },
  { label: 'ผู้จัดการคลัง',   departments: ['STOCK', 'PURCHASE'],           customPermissions: {} },
  { label: 'ผู้จัดการโรงงาน', departments: ['PRODUCTION', 'QC', 'STOCK'],  customPermissions: {} },
  { label: 'CEO / เจ้าของ',   departments: ['CEO'],                         customPermissions: {} },
]

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    ADMIN:     'bg-[var(--primary-soft)] text-[var(--primary)]',
    MASTER:    'bg-[var(--warning-soft)] text-[var(--warning)]',
    MANAGER:   'bg-[var(--success-soft)] text-[var(--success)]',
    POWERUSER: 'bg-[var(--surface-2)] text-[var(--fg-2)]',
    USER:      'bg-[var(--surface-2)] text-[var(--fg-3)]',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[role] ?? map.USER}`}>
      {role}
    </span>
  )
}

export default function PermissionSettings() {
  const [users, setUsers]             = useState<TenantUser[]>([])
  const [selected, setSelected]       = useState<TenantUser | null>(null)
  const [draftRole, setDraftRole]     = useState('')
  const [draftDepts, setDraftDepts]   = useState<string[]>([])
  const [draftCustom, setDraftCustom] = useState<Record<string, boolean>>({})
  const [showCustom, setShowCustom]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [loading, setLoading]         = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/users')
      const list: TenantUser[] = (res.data.data ?? []).filter((u: TenantUser) => u.role !== 'MASTER')
      setUsers(list)
      if (list.length > 0 && !selected) pick(list[0])
    } catch {
      toast.error('โหลดรายชื่อผู้ใช้ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(u: TenantUser) {
    setSelected(u)
    setDraftRole(u.role === 'ADMIN' ? 'MANAGER' : u.role)
    setDraftDepts(u.departments ?? [])
    setDraftCustom(u.custom_permissions ?? {})
    setShowCustom(false)
  }

  function toggleDept(dept: string) {
    setDraftDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  function toggleCustom(key: string) {
    setDraftCustom(prev => {
      const next = { ...prev }
      if (key in next) { delete next[key] } else { next[key] = true }
      return next
    })
  }

  function applyPreset(preset: typeof PRESETS[0]) {
    setDraftDepts(preset.departments)
    setDraftCustom(preset.customPermissions)
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      await api.put(`/users/${selected.id}`, { role: draftRole })
      await api.patch(`/users/${selected.id}/permissions`, {
        departments: draftDepts,
        customPermissions: draftCustom,
      })
      toast.success('บันทึกสิทธิ์สำเร็จ')
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <UserCog className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">จัดการสิทธิ์ผู้ใช้</h2>
          <p className="text-sm text-[var(--fg-3)]">กำหนดบทบาทและการเข้าถึงสำหรับพนักงานแต่ละคน</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 text-[var(--primary)] animate-spin" />
        </div>
      ) : (
        <div className="flex gap-4 min-h-[500px]">
          {/* User list */}
          <div className="w-56 flex-shrink-0 space-y-1">
            <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide px-2 mb-2">
              ผู้ใช้ ({users.length})
            </p>
            {users.length === 0 && (
              <p className="text-sm text-[var(--fg-4)] px-2">ยังไม่มีผู้ใช้</p>
            )}
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => pick(u)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                  selected?.id === u.id
                    ? 'bg-[var(--primary-soft)] border border-[var(--primary)]'
                    : 'hover:bg-[var(--surface-2)] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 rounded-full bg-[var(--primary-soft)] flex items-center justify-center flex-shrink-0">
                    <span className="text-[var(--primary)] text-xs font-bold">
                      {u.name?.charAt(0).toUpperCase() ?? 'U'}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-[var(--fg-1)] truncate">{u.name}</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap pl-9">
                  <RoleBadge role={u.role} />
                  {(u.departments ?? []).slice(0, 2).map(d => (
                    <span key={d} className="text-[10px] text-[var(--fg-4)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">
                      {d}
                    </span>
                  ))}
                  {(u.departments?.length ?? 0) > 2 && (
                    <span className="text-[10px] text-[var(--fg-4)]">+{u.departments.length - 2}</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Editor */}
          {selected ? (
            <div className="flex-1 bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5 space-y-5 overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="font-semibold text-[var(--fg-1)]">{selected.name}</h3>
                  <p className="text-sm text-[var(--fg-3)]">{selected.email}</p>
                </div>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  บันทึก
                </button>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">Quick Presets</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => applyPreset(p)}
                      className="px-3 py-1.5 text-xs font-medium border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-all"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">บทบาท (Role)</p>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map(r => (
                    <label
                      key={r.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        draftRole === r.value
                          ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                          : 'border-[var(--border)] hover:border-[var(--primary)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={draftRole === r.value}
                        onChange={() => setDraftRole(r.value)}
                        className="mt-0.5 accent-[var(--primary)]"
                      />
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{r.label}</p>
                        <p className="text-xs text-[var(--fg-3)]">{r.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">แผนก / สิทธิ์เข้าถึง</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DEPT_OPTIONS.map(d => (
                    <label
                      key={d.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        draftDepts.includes(d.value)
                          ? 'border-[var(--success)] bg-[var(--success-soft)]'
                          : 'border-[var(--border)] hover:border-[var(--success)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={draftDepts.includes(d.value)}
                        onChange={() => toggleDept(d.value)}
                        className="mt-0.5 accent-[var(--primary)]"
                      />
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{d.label}</p>
                        <p className="text-xs text-[var(--fg-3)]">{d.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowCustom(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide hover:text-[var(--fg-1)] transition-colors"
                >
                  {showCustom ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <Shield className="w-3.5 h-3.5" />
                  Custom Overrides (ขั้นสูง)
                </button>
                {showCustom && (
                  <div className="mt-3 space-y-2 pl-4 border-l border-[var(--border)]">
                    {CUSTOM_PERMS.map(cp => (
                      <label key={cp.key} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!draftCustom[cp.key]}
                          onChange={() => toggleCustom(cp.key)}
                          className="accent-[var(--primary)]"
                        />
                        <span className="text-sm text-[var(--fg-1)]">{cp.label}</span>
                        <span className="text-xs text-[var(--fg-4)]">({cp.key})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--fg-3)]">
              <p>เลือกผู้ใช้เพื่อจัดการสิทธิ์</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
