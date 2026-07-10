import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus, Pencil, Trash2, X, ChevronDown, ChevronUp,
  Shield, ShieldCheck, ShieldAlert, User as UserIcon, Crown
} from 'lucide-react'
import api from '../../services/api'

type Role = 'MASTER' | 'ADMIN' | 'MANAGER' | 'POWERUSER' | 'USER'

interface UserRecord {
  id: string
  email: string
  name: string
  role: Role
  departments: string[]
  custom_permissions: Record<string, boolean> | null
  status: string
  created_at: string
}

const ALL_DEPARTMENTS = ['CEO', 'IT', 'CTO', 'SALES', 'PURCHASE', 'STOCK', 'ACCOUNTING', 'MARKETING', 'QC', 'PRODUCTION']
const ALL_RESOURCES = ['customers', 'suppliers', 'orders', 'purchase', 'stock', 'accounting', 'marketing', 'production', 'qc', 'users', 'settings']
const ALL_ACTIONS = ['read', 'write', 'approve', 'delete']

const ROLE_COLORS: Record<Role, string> = {
  MASTER: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  ADMIN:  'bg-red-500/15 text-red-400 border-red-500/30',
  MANAGER: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  POWERUSER: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  USER:   'bg-[var(--surface-2)] text-[var(--fg-3)] border-[var(--border)]',
}

const ROLE_ICONS: Record<Role, React.ElementType> = {
  MASTER: Crown, ADMIN: ShieldAlert, MANAGER: ShieldCheck, POWERUSER: Shield, USER: UserIcon,
}

function RoleBadge({ role }: { role: Role }) {
  const Icon = ROLE_ICONS[role] ?? UserIcon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[role] ?? ROLE_COLORS.USER}`}>
      <Icon className="w-3 h-3" />
      {role}
    </span>
  )
}

const emptyForm = { name: '', email: '', password: '', role: 'USER' as Role, departments: [] as string[], custom_permissions: {} as Record<string, boolean> }

export default function UserManagement() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/users')
      setUsers(res.data.data)
    } catch (e: any) {
      setError(e.response?.data?.message || t('settings.userManagement.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { loadUsers() }, [loadUsers])

  const openCreate = () => {
    setForm({ ...emptyForm })
    setShowAdvanced(false)
    setModalMode('create')
  }

  const openEdit = (u: UserRecord) => {
    setSelectedUser(u)
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      departments: [...u.departments],
      custom_permissions: u.custom_permissions ? { ...u.custom_permissions } : {},
    })
    setShowAdvanced(Object.keys(u.custom_permissions ?? {}).length > 0)
    setModalMode('edit')
  }

  const closeModal = () => { setModalMode(null); setSelectedUser(null) }

  const toggleDept = (dept: string) => {
    setForm(f => ({
      ...f,
      departments: f.departments.includes(dept)
        ? f.departments.filter(d => d !== dept)
        : [...f.departments, dept],
    }))
  }

  const togglePerm = (resource: string, action: string, value: boolean | null) => {
    const key = `${resource}:${action}`
    setForm(f => {
      const cp = { ...f.custom_permissions }
      if (value === null) delete cp[key]
      else cp[key] = value
      return { ...f, custom_permissions: cp }
    })
  }

  const handleSave = async () => {
    if (!form.name || !form.email || (modalMode === 'create' && !form.password)) {
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        departments: form.departments,
        custom_permissions: Object.keys(form.custom_permissions).length > 0 ? form.custom_permissions : {},
        ...(form.password ? { password: form.password } : {}),
      }
      if (modalMode === 'create') await api.post('/users', payload)
      else await api.put(`/users/${selectedUser!.id}`, payload)
      await loadUsers()
      closeModal()
    } catch (e: any) {
      setError(e.response?.data?.message || t('settings.userManagement.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/users/${deleteTarget.id}`)
      await loadUsers()
      setDeleteTarget(null)
    } catch (e: any) {
      setError(e.response?.data?.message || t('settings.userManagement.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">{t('settings.userManagement.title')}</h1>
          <p className="text-sm text-[var(--fg-3)] mt-1">{t('settings.userManagement.subtitle')}</p>
        </div>
        <button onClick={openCreate} className="phopy-btn-primary flex items-center gap-2 px-4 py-2">
          <UserPlus className="w-4 h-4" />
          {t('settings.userManagement.addUser')}
        </button>
      </motion.div>

      {error && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-lg px-4 py-3 text-sm text-[var(--danger)] flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden"
      >
        {loading ? (
          <div className="p-12 text-center text-[var(--fg-3)]">
            <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
            {t('common.loading')}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">{t('settings.userManagement.userCol')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">{t('settings.userManagement.roleCol')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">{t('settings.userManagement.departmentCol')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users.map((u, i) => (
                <motion.tr
                  key={u.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="hover:bg-[var(--surface-2)]/40 transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[var(--primary-soft)] flex items-center justify-center text-[var(--primary)] font-semibold text-sm flex-none">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-[var(--fg-1)] text-sm">{u.name}</p>
                        <p className="text-xs text-[var(--fg-3)]">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1">
                      {u.departments.length === 0 ? (
                        <span className="text-xs text-[var(--fg-3)]">{t('settings.userManagement.noDepartment')}</span>
                      ) : (
                        u.departments.map(d => (
                          <span key={d} className="px-2 py-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded text-xs text-[var(--fg-2)]">
                            {d}
                          </span>
                        ))
                      )}
                      {u.custom_permissions && Object.keys(u.custom_permissions).length > 0 && (
                        <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-400">
                          {t('settings.userManagement.customBadge')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--fg-3)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {modalMode && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && closeModal()}
          >
            <motion.div
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-lg font-semibold text-[var(--fg-1)]">
                  {modalMode === 'create' ? t('settings.userManagement.modal.titleCreate') : t('settings.userManagement.modal.titleEdit', { name: selectedUser?.name })}
                </h2>
                <button onClick={closeModal} className="p-1 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Basic Info */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.userManagement.modal.nameLabel')}</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                      placeholder={t('settings.userManagement.modal.namePlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.userManagement.modal.emailLabel')}</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      disabled={modalMode === 'edit'}
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-50"
                      placeholder={t('settings.userManagement.modal.emailPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">
                      {t('settings.userManagement.modal.passwordLabel')} {modalMode === 'edit' && <span className="font-normal text-[var(--fg-3)]">{t('settings.userManagement.modal.passwordHintEdit')}</span>}
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                      placeholder={modalMode === 'create' ? t('settings.userManagement.modal.passwordPlaceholderCreate') : t('settings.userManagement.modal.passwordPlaceholderEdit')}
                    />
                  </div>
                </div>

                {/* Role */}
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-3)] mb-2">{t('settings.userManagement.modal.roleLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {(['ADMIN', 'MANAGER', 'POWERUSER', 'USER'] as Role[]).map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, role: r }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          form.role === r
                            ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                            : 'bg-[var(--surface-2)] text-[var(--fg-2)] border-[var(--border)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--fg-3)] mt-1.5">
                    {t(`settings.userManagement.roleDescriptions.${form.role}`)}
                  </p>
                </div>

                {/* Departments */}
                {(form.role === 'MANAGER' || form.role === 'USER') && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-3)] mb-2">{t('settings.userManagement.modal.departmentsLabel')}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {ALL_DEPARTMENTS.map(dept => (
                        <button
                          key={dept}
                          type="button"
                          onClick={() => toggleDept(dept)}
                          className={`px-2 py-1.5 rounded-lg text-xs font-medium border text-left transition-colors ${
                            form.departments.includes(dept)
                              ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]/50'
                              : 'bg-[var(--surface-2)] text-[var(--fg-3)] border-[var(--border)] hover:border-[var(--border-strong)]'
                          }`}
                        >
                          {form.departments.includes(dept) ? '✓ ' : ''}{dept}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advanced Permissions */}
                <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[var(--surface-2)]/50 text-sm font-medium text-[var(--fg-2)] hover:text-[var(--fg-1)] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-400" />
                      {t('settings.userManagement.modal.advancedTitle')}
                      {Object.keys(form.custom_permissions).length > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded text-xs">
                          {t('settings.userManagement.modal.overridesCount', { count: Object.keys(form.custom_permissions).length })}
                        </span>
                      )}
                    </span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4">
                          <p className="text-xs text-[var(--fg-3)] mb-3">
                            {t('settings.userManagement.modal.advancedHint')}
                            <span className="text-green-400 ml-2">{t('settings.userManagement.modal.allowed')}</span>
                            <span className="text-red-400 ml-2">{t('settings.userManagement.modal.denied')}</span>
                            <span className="text-[var(--fg-3)] ml-2">{t('settings.userManagement.modal.default')}</span>
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr>
                                  <th className="text-left pb-2 text-[var(--fg-3)]">{t('settings.userManagement.modal.resourceCol')}</th>
                                  {ALL_ACTIONS.map(a => (
                                    <th key={a} className="text-center pb-2 text-[var(--fg-3)] capitalize w-16">{a}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border)]">
                                {ALL_RESOURCES.map(resource => (
                                  <tr key={resource}>
                                    <td className="py-1.5 font-medium text-[var(--fg-2)]">{resource}</td>
                                    {ALL_ACTIONS.map(action => {
                                      const key = `${resource}:${action}`
                                      const val = form.custom_permissions[key]
                                      return (
                                        <td key={action} className="text-center py-1.5">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (val === undefined) togglePerm(resource, action, true)
                                              else if (val === true) togglePerm(resource, action, false)
                                              else togglePerm(resource, action, null)
                                            }}
                                            className="w-7 h-7 rounded flex items-center justify-center mx-auto hover:bg-[var(--surface-2)] transition-colors text-base"
                                            title={val === undefined ? t('settings.userManagement.modal.overrideNone') : val ? t('settings.userManagement.modal.overrideAllow') : t('settings.userManagement.modal.overrideDeny')}
                                          >
                                            {val === undefined ? '⬜' : val ? '✅' : '❌'}
                                          </button>
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
                <button onClick={closeModal} className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name || !form.email || (modalMode === 'create' && !form.password)}
                  className="phopy-btn-primary px-5 py-2 text-sm disabled:opacity-50"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--fg-1)]">{t('settings.userManagement.deleteConfirm.title')}</h3>
                  <p className="text-xs text-[var(--fg-3)]">{deleteTarget.email}</p>
                </div>
              </div>
              <p className="text-sm text-[var(--fg-2)] mb-5">
                {t('settings.userManagement.deleteConfirm.message', { name: deleteTarget.name })}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {deleting ? t('settings.userManagement.deleteConfirm.deleting') : t('settings.userManagement.deleteConfirm.delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
