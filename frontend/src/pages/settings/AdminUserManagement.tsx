import { useState, useEffect } from 'react'
import { UserPlus, Pencil, Trash2, Search, X, Eye, EyeOff, Users } from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'

interface TenantUser {
  id: string
  email: string
  name: string
  role: string
  departments: string[]
  status: string
}

const ROLE_OPTIONS = [
  { value: 'MANAGER',   label: 'Manager',   desc: 'อนุมัติ / จัดการแผนก',   color: 'bg-[var(--success-soft)] text-[var(--success)]' },
  { value: 'POWERUSER', label: 'Power User', desc: 'ใช้งานได้ทุกฟีเจอร์',     color: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
  { value: 'USER',      label: 'User',       desc: 'ใช้งานพื้นฐานในแผนก',     color: 'bg-[var(--surface-2)] text-[var(--fg-3)]' },
]

const DEPT_PRESETS = [
  { label: 'พนักงานขาย',      depts: ['SALES'] },
  { label: 'แคชเชียร์',       depts: [] },
  { label: 'นักบัญชี',        depts: ['ACCOUNTING', 'PURCHASE'] },
  { label: 'ผู้จัดการคลัง',   depts: ['STOCK', 'PURCHASE'] },
  { label: 'ผู้จัดการโรงงาน', depts: ['PRODUCTION', 'QC', 'STOCK'] },
  { label: 'CEO / เจ้าของ',   depts: ['CEO'] },
]

const ALL_DEPTS = [
  { value: 'SALES',      label: 'Sales' },
  { value: 'PURCHASE',   label: 'Purchase' },
  { value: 'STOCK',      label: 'Stock' },
  { value: 'ACCOUNTING', label: 'Accounting' },
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'QC',         label: 'QC' },
  { value: 'MARKETING',  label: 'Marketing' },
  { value: 'CEO',        label: 'CEO' },
  { value: 'IT',         label: 'IT' },
]

function RoleBadge({ role }: { role: string }) {
  const r = ROLE_OPTIONS.find(o => o.value === role)
  if (!r) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--warning-soft)] text-[var(--warning)]">
      {role}
    </span>
  )
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.color}`}>
      {r.label}
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="w-9 h-9 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-sm font-semibold shrink-0">
      {initials}
    </div>
  )
}

interface ModalProps {
  user?: TenantUser | null
  onClose: () => void
  onSaved: () => void
}

function UserModal({ user, onClose, onSaved }: ModalProps) {
  const isEdit = !!user
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [role, setRole] = useState(user?.role ?? 'USER')
  const [depts, setDepts] = useState<string[]>(user?.departments ?? [])
  const [loading, setLoading] = useState(false)

  const toggleDept = (d: string) =>
    setDepts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  const applyPreset = (p: typeof DEPT_PRESETS[0]) => setDepts(p.depts)

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) return toast.error('กรุณากรอกชื่อและอีเมล')
    if (!isEdit && !password) return toast.error('กรุณาตั้งรหัสผ่าน')
    setLoading(true)
    try {
      if (isEdit) {
        await api.put(`/users/${user!.id}`, { name, role, departments: depts, ...(password ? { password } : {}) })
        toast.success('อัปเดตผู้ใช้สำเร็จ')
      } else {
        await api.post('/users', { name, email, password, role, departments: depts })
        toast.success('เพิ่มผู้ใช้สำเร็จ')
      }
      onSaved()
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--fg-1)]">{isEdit ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            <X size={18} className="text-[var(--fg-3)]" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">ชื่อ-นามสกุล *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                placeholder="ชื่อพนักงาน" />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">อีเมล *</label>
              <input value={email} onChange={e => setEmail(e.target.value)} disabled={isEdit}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-50"
                placeholder="email@company.com" type="email" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">
              รหัสผ่าน {isEdit && <span className="text-[var(--fg-4)]">(เว้นว่างถ้าไม่เปลี่ยน)</span>}
            </label>
            <div className="relative">
              <input value={password} onChange={e => setPassword(e.target.value)}
                type={showPw ? 'text' : 'password'}
                className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                placeholder={isEdit ? '••••••••' : 'ตั้งรหัสผ่าน'} />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)] cursor-pointer">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-2 block">ระดับสิทธิ์</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map(r => (
                <button key={r.value} onClick={() => setRole(r.value)}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${role === r.value ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--primary)]/50'}`}>
                  <div className="text-xs font-semibold text-[var(--fg-1)]">{r.label}</div>
                  <div className="text-[10px] text-[var(--fg-4)] mt-0.5 leading-tight">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-2 block">ตำแหน่ง (Preset)</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {DEPT_PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p)}
                  className="px-2.5 py-1 rounded-full text-xs border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary-soft)] transition-colors cursor-pointer">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DEPTS.map(d => (
                <button key={d.value} onClick={() => toggleDept(d.value)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${depts.includes(d.value) ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-[var(--border)]">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] text-sm hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            ยกเลิก
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
            {loading ? 'กำลังบันทึก…' : isEdit ? 'บันทึก' : 'เพิ่มผู้ใช้'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminUserManagement() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ open: boolean; user?: TenantUser | null }>({ open: false })

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/users')
      setUsers(res.data.data ?? [])
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (u: TenantUser) => {
    if (u.id === me?.id) return toast.error('ไม่สามารถลบบัญชีตัวเองได้')
    if (u.role === 'ADMIN') return toast.error('ไม่สามารถลบ Admin ได้')
    if (!confirm(`ลบ "${u.name}" ออกจากระบบ?`)) return
    try {
      await api.delete(`/users/${u.id}`)
      toast.success('ลบผู้ใช้สำเร็จ')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    }
  }

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[var(--primary)]" />
          <h3 className="font-semibold text-[var(--fg-1)]">จัดการผู้ใช้งาน</h3>
          <span className="px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--fg-3)] text-xs">{users.length} คน</span>
        </div>
        <button onClick={() => setModal({ open: true, user: null })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer">
          <UserPlus size={15} />
          เพิ่มผู้ใช้
        </button>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อหรืออีเมล…"
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-[var(--fg-4)] text-sm">กำลังโหลด…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[var(--fg-4)] text-sm">ไม่พบผู้ใช้</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(u => {
            const isMe = u.id === me?.id
            const isAdminRole = u.role === 'ADMIN'
            return (
              <div key={u.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--primary)]/30 transition-colors">
                <Avatar name={u.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--fg-1)] text-sm truncate">{u.name}</span>
                    <RoleBadge role={u.role} />
                    {isMe && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--success-soft)] text-[var(--success)]">คุณ</span>}
                  </div>
                  <div className="text-xs text-[var(--fg-4)] truncate">{u.email}</div>
                  {u.departments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {u.departments.map(d => (
                        <span key={d} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)]">{d}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isAdminRole && (
                    <button onClick={() => setModal({ open: true, user: u })}
                      className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--fg-3)] hover:text-[var(--primary)] transition-colors cursor-pointer" title="แก้ไข">
                      <Pencil size={15} />
                    </button>
                  )}
                  {!isMe && !isAdminRole && (
                    <button onClick={() => handleDelete(u)}
                      className="p-2 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-[var(--danger)] transition-colors cursor-pointer" title="ลบ">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal.open && (
        <UserModal user={modal.user} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />
      )}
    </div>
  )
}
