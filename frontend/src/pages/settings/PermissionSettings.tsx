import { useState, useEffect, useRef } from 'react'
import { UserCog, ChevronDown, ChevronRight, Save, RefreshCw, Shield, Search, Check } from 'lucide-react'
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

const ROLE_COLOR: Record<string, string> = {
  ADMIN:     'bg-[var(--primary-soft)] text-[var(--primary)]',
  MASTER:    'bg-[var(--warning-soft)] text-[var(--warning)]',
  MANAGER:   'bg-[var(--success-soft)] text-[var(--success)]',
  POWERUSER: 'bg-[var(--surface-2)] text-[var(--fg-2)]',
  USER:      'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

function UserDropdown({
  users, selected, onSelect,
}: { users: TenantUser[]; selected: TenantUser | null; onSelect: (u: TenantUser) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(v => !v); setSearch('') }}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--primary)]/50 transition-colors cursor-pointer text-left"
      >
        {selected ? (
          <>
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-sm font-semibold shrink-0">
              {selected.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--fg-1)] text-sm">{selected.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ROLE_COLOR[selected.role] ?? ROLE_COLOR.USER}`}>
                  {selected.role}
                </span>
              </div>
              <div className="text-xs text-[var(--fg-4)] truncate">{selected.email}</div>
            </div>
          </>
        ) : (
          <span className="text-[var(--fg-4)] text-sm flex-1">เลือกพนักงาน…</span>
        )}
        <ChevronDown size={16} className={`text-[var(--fg-3)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรืออีเมล…"
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--fg-4)]">ไม่พบผู้ใช้</p>
            ) : filtered.map(u => (
              <button
                key={u.id}
                onClick={() => { onSelect(u); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors cursor-pointer text-left ${selected?.id === u.id ? 'bg-[var(--primary-soft)]' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-[var(--primary-soft)] flex items-center justify-center text-xs font-bold text-[var(--primary)] shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-[var(--fg-1)]">{u.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ROLE_COLOR[u.role] ?? ROLE_COLOR.USER}`}>{u.role}</span>
                  </div>
                  <div className="text-xs text-[var(--fg-4)] truncate">{u.email}</div>
                </div>
                {selected?.id === u.id && <Check size={14} className="text-[var(--primary)] shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
    <div className="space-y-5">
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
        <>
          <UserDropdown users={users} selected={selected} onSelect={pick} />

          {selected ? (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">Quick Presets</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p => (
                    <button key={p.label} onClick={() => applyPreset(p)}
                      className="px-3 py-1.5 text-xs font-medium border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-all cursor-pointer">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">บทบาท (Role)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ROLE_OPTIONS.map(r => (
                    <label key={r.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${draftRole === r.value ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}>
                      <input type="radio" name="role" value={r.value} checked={draftRole === r.value}
                        onChange={() => setDraftRole(r.value)} className="mt-0.5 accent-[var(--primary)]" />
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
                    <label key={d.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${draftDepts.includes(d.value) ? 'border-[var(--success)] bg-[var(--success-soft)]' : 'border-[var(--border)] hover:border-[var(--success)]'}`}>
                      <input type="checkbox" checked={draftDepts.includes(d.value)}
                        onChange={() => toggleDept(d.value)} className="mt-0.5 accent-[var(--primary)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{d.label}</p>
                        <p className="text-xs text-[var(--fg-3)]">{d.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <button onClick={() => setShowCustom(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide hover:text-[var(--fg-1)] transition-colors cursor-pointer">
                  {showCustom ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <Shield className="w-3.5 h-3.5" />
                  Custom Overrides (ขั้นสูง)
                </button>
                {showCustom && (
                  <div className="mt-3 space-y-2 pl-4 border-l border-[var(--border)]">
                    {CUSTOM_PERMS.map(cp => (
                      <label key={cp.key} className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={!!draftCustom[cp.key]}
                          onChange={() => toggleCustom(cp.key)} className="accent-[var(--primary)]" />
                        <span className="text-sm text-[var(--fg-1)]">{cp.label}</span>
                        <span className="text-xs text-[var(--fg-4)]">({cp.key})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  บันทึก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--fg-4)] gap-2">
              <UserCog className="w-10 h-10 opacity-30" />
              <p className="text-sm">เลือกพนักงานด้านบนเพื่อจัดการสิทธิ์</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
