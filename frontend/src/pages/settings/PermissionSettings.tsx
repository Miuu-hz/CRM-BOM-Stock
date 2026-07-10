import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { UserCog, ChevronDown, ChevronRight, Save, RefreshCw, Shield, Search, Check, AlertTriangle, X } from 'lucide-react'
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

const DEPT_VALUES = ['SALES', 'PURCHASE', 'STOCK', 'ACCOUNTING', 'PRODUCTION', 'QC', 'MARKETING', 'CEO', 'IT'] as const

const ROLE_VALUES = ['MANAGER', 'POWERUSER', 'USER'] as const

const CUSTOM_PERM_KEYS = ['accounting:delete', 'stock:delete', 'orders:delete', 'users:write'] as const

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  MASTER: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  MANAGER: 'bg-[var(--success-soft)] text-[var(--success)]',
  POWERUSER: 'bg-[var(--surface-2)] text-[var(--fg-2)]',
  USER: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

function UserDropdown({
  users, selected, onSelect,
}: { users: TenantUser[]; selected: TenantUser | null; onSelect: (u: TenantUser) => void }) {
  const { t } = useTranslation()
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
          <span className="text-[var(--fg-4)] text-sm flex-1">{t('settings.permission.selectUser')}</span>
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
                placeholder={t('settings.adminUserManagement.searchPlaceholder')}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--fg-4)]">{t('settings.permission.noUsers')}</p>
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
  const { t } = useTranslation()
  const [users, setUsers]             = useState<TenantUser[]>([])
  const [selected, setSelected]       = useState<TenantUser | null>(null)
  const [draftRole, setDraftRole]     = useState('')
  const [draftDepts, setDraftDepts]   = useState<string[]>([])
  const [draftCustom, setDraftCustom] = useState<Record<string, boolean>>({})
  const [showCustom, setShowCustom]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [loading, setLoading]         = useState(true)
  const [showCeoConfirm, setShowCeoConfirm] = useState(false)
  const [pendingCeoDept, setPendingCeoDept] = useState<string | null>(null)

  const presets: { key: string; departments: string[]; customPermissions: Record<string, boolean> }[] = [
    { key: 'sales', departments: ['SALES'], customPermissions: {} },
    { key: 'cashier', departments: [], customPermissions: { 'cashier:read': true, 'cashier:write': true } },
    { key: 'accountant', departments: ['ACCOUNTING', 'PURCHASE'], customPermissions: {} },
    { key: 'warehouseManager', departments: ['STOCK', 'PURCHASE'], customPermissions: {} },
    { key: 'factoryManager', departments: ['PRODUCTION', 'QC', 'STOCK'], customPermissions: {} },
    { key: 'ceo', departments: ['CEO'], customPermissions: {} },
  ]

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/users')
      const list: TenantUser[] = (res.data.data ?? []).filter((u: TenantUser) => u.role !== 'MASTER')
      setUsers(list)
    } catch {
      toast.error(t('settings.permission.loadFailed'))
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
    const isEnabled = draftDepts.includes(dept)
    if (!isEnabled && (dept === 'CEO' || dept === 'IT')) {
      setPendingCeoDept(dept)
      setShowCeoConfirm(true)
      return
    }
    setDraftDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  function confirmCeoDept() {
    if (pendingCeoDept) {
      setDraftDepts(prev => [...prev, pendingCeoDept])
    }
    setShowCeoConfirm(false)
    setPendingCeoDept(null)
  }

  function toggleCustom(key: string) {
    setDraftCustom(prev => {
      const next = { ...prev }
      if (key in next) { delete next[key] } else { next[key] = true }
      return next
    })
  }

  function applyPreset(preset: typeof presets[0]) {
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
      toast.success(t('settings.permission.saveSuccess'))
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t('settings.permission.saveFailed'))
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
          <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('settings.permission.title')}</h2>
          <p className="text-sm text-[var(--fg-3)]">{t('settings.permission.subtitle')}</p>
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
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">{t('settings.permission.presets')}</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map(p => (
                    <button key={p.key} onClick={() => applyPreset(p)}
                      className="px-3 py-1.5 text-xs font-medium border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] transition-all cursor-pointer">
                      {t(`settings.permission.presetsList.${p.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">{t('settings.permission.roleSection')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ROLE_VALUES.map(r => (
                    <label key={r}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${draftRole === r ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}>
                      <input type="radio" name="role" value={r} checked={draftRole === r}
                        onChange={() => setDraftRole(r)} className="mt-0.5 accent-[var(--primary)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{t(`settings.permission.roles.${r.toLowerCase()}`)}</p>
                        <p className="text-xs text-[var(--fg-3)]">{t(`settings.permission.roles.${r.toLowerCase()}Desc`)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">{t('settings.permission.departmentSection')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DEPT_VALUES.map(d => (
                    <label key={d}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${draftDepts.includes(d) ? 'border-[var(--success)] bg-[var(--success-soft)]' : 'border-[var(--border)] hover:border-[var(--success)]'}`}>
                      <input type="checkbox" checked={draftDepts.includes(d)}
                        onChange={() => toggleDept(d)} className="mt-0.5 accent-[var(--primary)]" />
                      <div>
                        <p className="text-sm font-medium text-[var(--fg-1)]">{t(`settings.permission.departments.${d.toLowerCase()}`)}</p>
                        <p className="text-xs text-[var(--fg-3)]">{t(`settings.permission.departments.${d.toLowerCase()}Desc`)}</p>
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
                  {t('settings.permission.customOverrides')}
                </button>
                {showCustom && (
                  <div className="mt-3 space-y-2 pl-4 border-l border-[var(--border)]">
                    {CUSTOM_PERM_KEYS.map(cp => (
                      <label key={cp} className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={!!draftCustom[cp]}
                          onChange={() => toggleCustom(cp)} className="accent-[var(--primary)]" />
                        <span className="text-sm text-[var(--fg-1)]">{t(`settings.permission.customPermissions.${cp.replace(/:/g, '')}`)}</span>
                        <span className="text-xs text-[var(--fg-4)]">({cp})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--fg-4)] gap-2">
              <UserCog className="w-10 h-10 opacity-30" />
              <p className="text-sm">{t('settings.permission.emptyHint')}</p>
            </div>
          )}
        </>
      )}

      {/* CEO / IT Confirmation Modal */}
      {showCeoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowCeoConfirm(false); setPendingCeoDept(null) }} />
          <div className="relative bg-[var(--surface)] border border-[var(--warning)]/40 rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-[var(--warning)]/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-[var(--warning)]" />
              </div>
              <div>
                <h3 className="font-bold text-[var(--fg-1)] text-base mb-1">
                  {t('settings.permission.ceoModal.title', { dept: pendingCeoDept ?? '' })}
                </h3>
                <p
                  className="text-sm text-[var(--fg-2)] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: t('settings.permission.ceoModal.warning', { dept: pendingCeoDept ?? '' }) }}
                />
              </div>
              <button
                onClick={() => { setShowCeoConfirm(false); setPendingCeoDept(null) }}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-[var(--warning)]/8 border border-[var(--warning)]/20 rounded-xl p-3 mb-5 text-xs text-[var(--fg-2)] space-y-1">
              <p dangerouslySetInnerHTML={{ __html: t('settings.permission.ceoModal.bullet1') }} />
              <p dangerouslySetInnerHTML={{ __html: t('settings.permission.ceoModal.bullet2') }} />
              <p dangerouslySetInnerHTML={{ __html: t('settings.permission.ceoModal.bullet3', { dept: pendingCeoDept ?? '' }) }} />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowCeoConfirm(false); setPendingCeoDept(null) }}
                className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmCeoDept}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-[var(--warning)] text-white hover:opacity-90 transition-opacity"
              >
                <AlertTriangle className="w-4 h-4" />
                {t('settings.permission.ceoModal.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}