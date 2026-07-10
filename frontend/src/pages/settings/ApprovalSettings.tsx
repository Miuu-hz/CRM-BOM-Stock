import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShieldCheck, Plus, Trash2, X, ChevronDown, ChevronUp,
  Save, RefreshCw, AlertTriangle, User, Settings2
} from 'lucide-react'
import api from '../../services/api'
import toast from 'react-hot-toast'

// Types
interface ApprovalSetting {
  id: string
  role: string
  module_type: string
  approval_required: number
  auto_approve_threshold: number
}

interface UserPermission {
  id: string
  user_id: string
  user_name: string
  user_email: string
  module_type: string
  can_approve: number
  can_approve_unlimited: number
  approval_limit: number
  is_master_approver: number
}

interface TenantUser {
  id: string
  name: string
  email: string
  role: string
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `฿${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `฿${(n / 1_000).toFixed(1)}K`     :
  `฿${n.toLocaleString()}`

export default function ApprovalSettings() {
  const { t } = useTranslation()
  const [settings, setSettings]   = useState<ApprovalSetting[]>([])
  const [userPerms, setUserPerms] = useState<UserPermission[]>([])
  const [users, setUsers]         = useState<TenantUser[]>([])
  const [loading, setLoading]     = useState(true)

  const [showSettingForm, setShowSettingForm] = useState(false)
  const [showPermForm, setShowPermForm]       = useState(false)
  const [expandedModule, setExpandedModule]   = useState<string | null>('purchase_request')

  const [settingForm, setSettingForm] = useState({
    role: 'MANAGER',
    module_type: 'purchase_request',
    approval_required: true,
    auto_approve_threshold: 0,
  })
  const [permForm, setPermForm] = useState({
    user_id: '',
    module_type: 'purchase_request',
    can_approve: true,
    can_approve_unlimited: false,
    approval_limit: 0,
    is_master_approver: false,
  })

  const [savingSetting, setSavingSetting] = useState(false)
  const [savingPerm, setSavingPerm]       = useState(false)

  const MODULE_TYPES = [
    { value: 'purchase_request',  label: t('settings.approval.modules.purchaseRequest') },
    { value: 'purchase_order',    label: t('settings.approval.modules.purchaseOrder') },
    { value: 'sales_order',       label: t('settings.approval.modules.salesOrder') },
    { value: 'work_orders',       label: t('settings.approval.modules.workOrder') },
    { value: 'stock_adjustments', label: t('settings.approval.modules.stockAdjustment') },
  ]

  const ROLES = [
    { value: 'MANAGER',   label: t('settings.approval.roles.manager'),   color: 'bg-green-500/15 text-green-400' },
    { value: 'POWERUSER', label: t('settings.approval.roles.powerUser'), color: 'bg-blue-500/15 text-blue-400' },
    { value: 'USER',      label: t('settings.approval.roles.user'),      color: 'bg-[var(--surface-2)] text-[var(--fg-3)]' },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, u] = await Promise.all([
        api.get('/approval/settings'),
        api.get('/approval/permissions'),
        api.get('/users'),
      ])
      setSettings(s.data.data || [])
      setUserPerms(p.data.data || [])
      setUsers(
        (u.data.data || []).filter(
          (usr: TenantUser) => !['MASTER', 'ADMIN'].includes(usr.role)
        )
      )
    } catch {
      toast.error(t('settings.approval.toasts.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveSetting = async () => {
    setSavingSetting(true)
    try {
      await api.post('/approval/settings', {
        role: settingForm.role,
        moduleType: settingForm.module_type,
        approvalRequired: settingForm.approval_required,
        autoApproveThreshold: settingForm.auto_approve_threshold,
      })
      toast.success(t('settings.approval.toasts.saveSettingSuccess'))
      setShowSettingForm(false)
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('settings.approval.toasts.saveFailed'))
    } finally {
      setSavingSetting(false)
    }
  }

  const deleteSetting = async (id: string) => {
    try {
      await api.delete(`/approval/settings/${id}`)
      toast.success(t('settings.approval.toasts.deleteSettingSuccess'))
      await load()
    } catch {
      toast.error(t('settings.approval.toasts.deleteFailed'))
    }
  }

  const savePerm = async () => {
    if (!permForm.user_id) return toast.error(t('settings.approval.toasts.selectUserError'))
    setSavingPerm(true)
    try {
      await api.post('/approval/permissions', {
        userId: permForm.user_id,
        moduleType: permForm.module_type,
        canApprove: permForm.can_approve,
        canApproveUnlimited: permForm.can_approve_unlimited,
        approvalLimit: permForm.approval_limit,
        isMasterApprover: permForm.is_master_approver,
      })
      toast.success(t('settings.approval.toasts.savePermSuccess'))
      setShowPermForm(false)
      setPermForm({
        user_id: '',
        module_type: 'purchase_request',
        can_approve: true,
        can_approve_unlimited: false,
        approval_limit: 0,
        is_master_approver: false,
      })
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('settings.approval.toasts.saveFailed'))
    } finally {
      setSavingPerm(false)
    }
  }

  const revokePerm = async (id: string) => {
    try {
      await api.delete(`/approval/permissions/${id}`)
      toast.success(t('settings.approval.toasts.revokeSuccess'))
      await load()
    } catch {
      toast.error(t('settings.approval.toasts.revokeFailed'))
    }
  }

  const getModuleLabel = (v: string) => MODULE_TYPES.find(m => m.value === v)?.label || v
  const getRoleBadge   = (v: string) => ROLES.find(r => r.value === v)

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-8 max-w-4xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('settings.approval.title')}</h2>
          <p className="text-sm text-[var(--fg-3)]">{t('settings.approval.subtitle')}</p>
        </div>
        <button
          onClick={load}
          className="ml-auto p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Info banner */}
      <div className="flex gap-3 bg-[var(--warning)]/8 border border-[var(--warning)]/25 rounded-xl p-4">
        <AlertTriangle className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[var(--fg-2)]">
          <p className="font-semibold text-[var(--fg-1)] mb-1">{t('settings.approval.info.masterAdminAuto')}</p>
          <p>{t('settings.approval.info.roleScope')}</p>
        </div>
      </div>

      {/* ═══════════════════════════════════
          Section 1 – Approval Settings
         ═══════════════════════════════════ */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-semibold text-[var(--fg-1)]">{t('settings.approval.section.approvalConditions')}</h3>
          </div>
          <button
            onClick={() => setShowSettingForm(v => !v)}
            className="phopy-btn-primary flex items-center gap-2 px-3 py-1.5 text-sm"
          >
            <Plus className="w-3.5 h-3.5" /> {t('settings.approval.actions.addCondition')}
          </button>
        </div>

        {/* Add-setting form */}
        {showSettingForm && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/40 px-5 py-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.role')}</label>
                <select
                  value={settingForm.role}
                  onChange={e => setSettingForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.module')}</label>
                <select
                  value={settingForm.module_type}
                  onChange={e => setSettingForm(f => ({ ...f, module_type: e.target.value }))}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                >
                  {MODULE_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.approvalRequired')}</label>
                <div className="flex gap-2">
                  {([true, false] as const).map(v => (
                    <button
                      key={String(v)} type="button"
                      onClick={() => setSettingForm(f => ({ ...f, approval_required: v }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                        settingForm.approval_required === v
                          ? v
                            ? 'bg-green-500/15 border-green-500/50 text-green-400'
                            : 'bg-red-500/15 border-red-500/50 text-red-400'
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg-3)]'
                      }`}
                    >
                      {v ? t('settings.approval.options.required') : t('settings.approval.options.notRequired')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">
                  {t('settings.approval.labels.autoApproveThreshold')}
                  <span className="text-[var(--fg-4)] font-normal ml-1">{t('settings.approval.labels.thresholdHint')}</span>
                </label>
                <input
                  type="number" min={0}
                  value={settingForm.auto_approve_threshold}
                  onChange={e => setSettingForm(f => ({ ...f, auto_approve_threshold: Number(e.target.value) }))}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                  placeholder={t('settings.approval.placeholders.thresholdCheckEveryTime')}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowSettingForm(false)}
                className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveSetting}
                disabled={savingSetting}
                className="phopy-btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingSetting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* Settings list grouped by module */}
        {settings.length === 0 ? (
          <div className="py-10 text-center text-[var(--fg-3)] text-sm">
            {t('settings.approval.empty.noConditions')}
          </div>
        ) : (
          <div>
            {MODULE_TYPES.map(mod => {
              const modSettings = settings.filter(s => s.module_type === mod.value)
              if (modSettings.length === 0) return null
              const isOpen = expandedModule === mod.value
              return (
                <div key={mod.value} className="border-b border-[var(--border)] last:border-b-0">
                  <button
                    onClick={() => setExpandedModule(isOpen ? null : mod.value)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-[var(--surface-2)]/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm text-[var(--fg-1)]">{mod.label}</span>
                      <span className="px-2 py-0.5 bg-[var(--surface-2)] rounded text-xs text-[var(--fg-3)]">
                        {t('settings.approval.rolesCount', { count: modSettings.length })}
                      </span>
                    </div>
                    {isOpen
                      ? <ChevronUp className="w-4 h-4 text-[var(--fg-3)]" />
                      : <ChevronDown className="w-4 h-4 text-[var(--fg-3)]" />}
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-[var(--fg-3)] border-b border-[var(--border)]">
                            <th className="text-left py-2 font-medium">{t('settings.approval.labels.role')}</th>
                            <th className="text-center py-2 font-medium">{t('settings.approval.labels.approvalRequired')}</th>
                            <th className="text-right py-2 font-medium">{t('settings.approval.labels.autoApproveIfBelow')}</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {modSettings.map(s => {
                            const rb = getRoleBadge(s.role)
                            return (
                              <tr key={s.id} className="hover:bg-[var(--surface-2)]/20">
                                <td className="py-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rb?.color || ''}`}>
                                    {rb?.label || s.role}
                                  </span>
                                </td>
                                <td className="py-2.5 text-center">
                                  {s.approval_required ? (
                                    <span className="text-xs px-2 py-0.5 bg-green-500/15 text-green-400 rounded-full">{t('settings.approval.badge.required')}</span>
                                  ) : (
                                    <span className="text-xs px-2 py-0.5 bg-[var(--surface-2)] text-[var(--fg-3)] rounded-full">{t('settings.approval.badge.notRequired')}</span>
                                  )}
                                </td>
                                <td className="py-2.5 text-right text-[var(--fg-2)]">
                                  {s.auto_approve_threshold > 0
                                    ? fmt(s.auto_approve_threshold)
                                    : <span className="text-[var(--fg-4)]">—</span>}
                                </td>
                                <td className="py-2.5 text-right">
                                  <button
                                    onClick={() => deleteSetting(s.id)}
                                    className="p-1 rounded hover:bg-red-500/10 text-[var(--fg-3)] hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════
          Section 2 – User Permissions
         ═══════════════════════════════════ */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-semibold text-[var(--fg-1)]">{t('settings.approval.section.userPermissions')}</h3>
          </div>
          <button
            onClick={() => setShowPermForm(v => !v)}
            className="phopy-btn-primary flex items-center gap-2 px-3 py-1.5 text-sm"
          >
            <Plus className="w-3.5 h-3.5" /> {t('settings.approval.actions.grantPermission')}
          </button>
        </div>

        {/* Grant-permission form */}
        {showPermForm && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/40 px-5 py-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.user')}</label>
                <select
                  value={permForm.user_id}
                  onChange={e => setPermForm(f => ({ ...f, user_id: e.target.value }))}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">{t('settings.approval.placeholders.selectUser')}</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.module')}</label>
                <select
                  value={permForm.module_type}
                  onChange={e => setPermForm(f => ({ ...f, module_type: e.target.value }))}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                >
                  {MODULE_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1.5">{t('settings.approval.labels.maxApprovalLimit')}</label>
                <input
                  type="number" min={0}
                  value={permForm.approval_limit}
                  onChange={e => setPermForm(f => ({ ...f, approval_limit: Number(e.target.value) }))}
                  disabled={permForm.can_approve_unlimited}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
                  placeholder={t('settings.approval.placeholders.limitDefault')}
                />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permForm.can_approve_unlimited}
                    onChange={e => setPermForm(f => ({ ...f, can_approve_unlimited: e.target.checked }))}
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--fg-2)]">{t('settings.approval.labels.unlimited')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permForm.is_master_approver}
                    onChange={e => setPermForm(f => ({ ...f, is_master_approver: e.target.checked }))}
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--fg-2)]">{t('settings.approval.labels.masterApprover')}</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowPermForm(false)}
                className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={savePerm}
                disabled={savingPerm || !permForm.user_id}
                className="phopy-btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingPerm ? t('common.saving') : t('settings.approval.actions.grantPermission')}
              </button>
            </div>
          </div>
        )}

        {/* Permissions grouped by module */}
        {userPerms.length === 0 ? (
          <div className="py-10 text-center text-[var(--fg-3)] text-sm">
            {t('settings.approval.empty.noApprovers')}
          </div>
        ) : (
          <div>
            {MODULE_TYPES.map(mod => {
              const modPerms = userPerms.filter(p => p.module_type === mod.value)
              if (modPerms.length === 0) return null
              return (
                <div key={mod.value} className="border-b border-[var(--border)] last:border-b-0">
                  <div className="px-5 py-2 bg-[var(--surface-2)]/30">
                    <span className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">
                      {mod.label}
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {modPerms.map(p => (
                      <div
                        key={p.id}
                        className="flex items-center gap-4 px-5 py-3 hover:bg-[var(--surface-2)]/20 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-[var(--primary-soft)] flex items-center justify-center text-[var(--primary)] text-xs font-bold flex-shrink-0">
                          {(p.user_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--fg-1)] truncate">{p.user_name}</p>
                          <p className="text-xs text-[var(--fg-3)] truncate">{p.user_email}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {p.is_master_approver === 1 && (
                            <span className="px-2 py-0.5 bg-purple-500/15 text-purple-400 text-xs rounded-full font-medium">
                              Level 2
                            </span>
                          )}
                          {p.can_approve_unlimited === 1 ? (
                            <span className="px-2 py-0.5 bg-[var(--primary-soft)] text-[var(--primary)] text-xs rounded-full">
                              {t('settings.approval.badge.unlimited')}
                            </span>
                          ) : p.approval_limit > 0 ? (
                            <span className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--fg-2)] text-xs rounded-full">
                              {t('settings.approval.badge.maxLimit', { amount: fmt(p.approval_limit) })}
                            </span>
                          ) : null}
                        </div>
                        <button
                          onClick={() => revokePerm(p.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--fg-3)] hover:text-red-400 transition-colors flex-shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
