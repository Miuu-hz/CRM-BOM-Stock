import { useState, useEffect } from 'react'
import { UserPlus, Pencil, Trash2, Search, X, Eye, EyeOff, Users, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

const ROLE_VALUES = ['ADMIN', 'MANAGER', 'POWERUSER', 'USER'] as const

const DEPT_VALUES = ['SALES', 'PURCHASE', 'STOCK', 'ACCOUNTING', 'PRODUCTION', 'QC', 'MARKETING', 'CEO', 'IT'] as const

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation()
  const colorClass =
    role === 'MANAGER' ? 'bg-[var(--success-soft)] text-[var(--success)]' :
    role === 'POWERUSER' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' :
    role === 'USER' ? 'bg-[var(--surface-2)] text-[var(--fg-3)]' :
    'bg-[var(--warning-soft)] text-[var(--warning)]'
  const label = role === 'MANAGER' ? t('settings.adminUserManagement.modal.role.manager')
    : role === 'POWERUSER' ? t('settings.adminUserManagement.modal.role.powerUser')
    : role === 'USER' ? t('settings.adminUserManagement.modal.role.user')
    : role
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
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
  const { t } = useTranslation()
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

  const presets = [
    { key: 'sales', depts: ['SALES'] },
    { key: 'cashier', depts: [] },
    { key: 'accountant', depts: ['ACCOUNTING', 'PURCHASE'] },
    { key: 'warehouseManager', depts: ['STOCK', 'PURCHASE'] },
    { key: 'factoryManager', depts: ['PRODUCTION', 'QC', 'STOCK'] },
    { key: 'ceo', depts: ['CEO'] },
  ]

  const applyPreset = (deptList: string[]) => setDepts(deptList)

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) return toast.error(t('settings.adminUserManagement.toast.nameEmailRequired'))
    if (!isEdit && !password) return toast.error(t('settings.adminUserManagement.toast.passwordRequired'))
    setLoading(true)
    try {
      if (isEdit) {
        await api.put(`/users/${user!.id}`, { name, role, departments: depts, ...(password ? { password } : {}) })
        toast.success(t('settings.adminUserManagement.toast.updateSuccess'))
      } else {
        await api.post('/users', { name, email, password, role, departments: depts })
        toast.success(t('settings.adminUserManagement.toast.createSuccess'))
      }
      onSaved()
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? t('settings.adminUserManagement.toast.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--fg-1)]">{isEdit ? t('settings.adminUserManagement.modal.titleEdit') : t('settings.adminUserManagement.modal.titleCreate')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            <X size={18} className="text-[var(--fg-3)]" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">{t('settings.adminUserManagement.modal.nameLabel')}</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                placeholder={t('settings.adminUserManagement.modal.nameLabel').replace(' *', '')} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">{t('settings.adminUserManagement.modal.emailLabel')}</label>
              <input value={email} onChange={e => setEmail(e.target.value)} disabled={isEdit}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-50"
                placeholder="email@company.com" type="email" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-1 block">
              {t('settings.adminUserManagement.modal.passwordLabel')} {isEdit && <span className="text-[var(--fg-4)]">{t('settings.adminUserManagement.modal.passwordHintEdit')}</span>}
            </label>
            <div className="relative">
              <input value={password} onChange={e => setPassword(e.target.value)}
                type={showPw ? 'text' : 'password'}
                className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                placeholder={isEdit ? t('settings.adminUserManagement.modal.passwordPlaceholderEdit') : t('settings.adminUserManagement.modal.passwordPlaceholderCreate')} />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)] cursor-pointer">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-2 block">{t('settings.adminUserManagement.modal.roleLabel')}</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_VALUES.map(r => (
                <button key={r} onClick={() => setRole(r)}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${role === r ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--primary)]/50'}`}>
                  <div className="text-xs font-semibold text-[var(--fg-1)]">
                    {r === 'ADMIN' ? t('settings.adminUserManagement.modal.role.admin', 'ผู้ดูแลระบบ (Admin)')
                      : r === 'MANAGER' ? t('settings.adminUserManagement.modal.role.manager')
                      : r === 'POWERUSER' ? t('settings.adminUserManagement.modal.role.powerUser')
                      : t('settings.adminUserManagement.modal.role.user')}
                  </div>
                  <div className="text-[10px] text-[var(--fg-4)] mt-0.5 leading-tight">
                    {r === 'ADMIN' ? t('settings.adminUserManagement.modal.role.adminDesc', 'จัดการผู้ใช้ ทีม และตั้งค่าบริษัทของคุณ')
                      : r === 'MANAGER' ? t('settings.adminUserManagement.modal.role.managerDesc')
                      : r === 'POWERUSER' ? t('settings.adminUserManagement.modal.role.powerUserDesc')
                      : t('settings.adminUserManagement.modal.role.userDesc')}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-2 block">{t('settings.adminUserManagement.modal.presetLabel')}</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {presets.map(p => (
                <button key={p.key} onClick={() => applyPreset(p.depts)}
                  className="px-2.5 py-1 rounded-full text-xs border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary-soft)] transition-colors cursor-pointer">
                  {t(`settings.adminUserManagement.presets.${p.key}`)}
                </button>
              ))}
            </div>
            <label className="text-xs font-medium text-[var(--fg-3)] mb-2 block">{t('settings.adminUserManagement.modal.departmentsLabel')}</label>
            <div className="flex flex-wrap gap-1.5">
              {DEPT_VALUES.map(d => (
                <button key={d} onClick={() => toggleDept(d)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${depts.includes(d) ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>
                  {t(`settings.adminUserManagement.departments.${d.toLowerCase()}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-[var(--border)]">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--fg-2)] text-sm hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            {t('common.cancel')}
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
            {loading ? t('settings.adminUserManagement.modal.saving') : isEdit ? t('common.save') : t('settings.adminUserManagement.modal.saveAndCreate')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminUserManagement() {
  const { t } = useTranslation()
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
      toast.error(t('settings.adminUserManagement.toast.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (u: TenantUser) => {
    if (u.id === me?.id) return toast.error(t('settings.adminUserManagement.toast.cannotDeleteSelf'))
    if (u.role === 'ADMIN') return toast.error(t('settings.adminUserManagement.toast.cannotDeleteAdmin'))
    if (!confirm(t('settings.adminUserManagement.toast.deleteConfirm', { name: u.name }))) return
    try {
      await api.delete(`/users/${u.id}`)
      toast.success(t('settings.adminUserManagement.toast.deleteSuccess'))
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? t('settings.adminUserManagement.toast.error'))
    }
  }

  const genResetCode = async (u: TenantUser) => {
    try {
      const res = await api.post('/auth/admin/reset-token', { userId: u.id })
      const tk = res.data?.data?.token as string
      try { await navigator.clipboard.writeText(tk) } catch { /* clipboard may be blocked */ }
      toast.success(`คัดลอกรหัสรีเซ็ตของ ${u.name} แล้ว (หมดอายุ 30 นาที) — ส่งให้สมาชิก: ${tk}`, { duration: 12000 })
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? t('settings.adminUserManagement.toast.error'))
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
          <h3 className="font-semibold text-[var(--fg-1)]">{t('settings.adminUserManagement.title')}</h3>
          <span className="px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--fg-3)] text-xs">{t('settings.adminUserManagement.userCount', { count: users.length })}</span>
        </div>
        <button onClick={() => setModal({ open: true, user: null })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer">
          <UserPlus size={15} />
          {t('settings.adminUserManagement.addUser')}
        </button>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('settings.adminUserManagement.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-sm focus:outline-none focus:border-[var(--primary)] transition-colors" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-[var(--fg-4)] text-sm">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[var(--fg-4)] text-sm">{t('settings.adminUserManagement.noUsers')}</div>
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
                    {isMe && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--success-soft)] text-[var(--success)]">{t('settings.adminUserManagement.youBadge')}</span>}
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
                  <button onClick={() => setModal({ open: true, user: u })}
                    className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--fg-3)] hover:text-[var(--primary)] transition-colors cursor-pointer" title={t('settings.adminUserManagement.edit')}>
                    <Pencil size={15} />
                  </button>
                  {!isMe && !isAdminRole && (
                    <button onClick={() => genResetCode(u)}
                      className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--fg-3)] hover:text-[var(--primary)] transition-colors cursor-pointer" title="สร้างรหัสรีเซ็ตรหัสผ่าน">
                      <KeyRound size={15} />
                    </button>
                  )}
                  {!isMe && !isAdminRole && (
                    <button onClick={() => handleDelete(u)}
                      className="p-2 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-[var(--danger)] transition-colors cursor-pointer" title={t('settings.adminUserManagement.delete')}>
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
