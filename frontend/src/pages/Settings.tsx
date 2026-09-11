import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useModalClose } from '../hooks/useModalClose'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings,
  Users,
  Shield,
  Clock,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  X,
  RefreshCw,
  Key,
  Building2,
  Store,
  MessageSquare,
  Receipt,
  Percent,
  ToggleLeft,
  ToggleRight,
  Star,
  Gift,
  ArrowLeftRight,
  Tag,
  Info,
  Brain,
  Database,
  Zap,
  UserCog,
  ShieldCheck,
  Hash,
  Coins,
  Landmark,
  FileText,
} from 'lucide-react'
import POSMenuSettings from './settings/POSMenuSettings'
import CurrencySettings from './settings/CurrencySettings'
import BankAccountSettings from './settings/BankAccountSettings'
import LineSettings from './settings/LineSettings'
import UnitConversions from './settings/UnitConversions'
import MaterialCategories from './settings/MaterialCategories'
import LLMSettings from './settings/LLMSettings'
import BackupSettings from './settings/BackupSettings'
import PermissionSettings from './settings/PermissionSettings'
import AdminUserManagement from './settings/AdminUserManagement'
import ApprovalSettings from './settings/ApprovalSettings'
import DocumentNumberSettings from './settings/DocumentNumberSettings'
import DocumentSettings from './settings/DocumentSettings'
import MCPSettings from './settings/MCPSettings'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { stripNonAscii } from '../utils/email'

interface ChildUser {
  id: string
  email: string
  name: string
  role: string
  status: string
  created_at: string
  last_login_at?: string
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const { user, isMaster, children, loadChildren, deleteChildUser } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  type SettingsTab = 'general' | 'users' | 'security' | 'pos' | 'line' | 'billing' | 'loyalty' | 'units' | 'material-categories' | 'llm' | 'backup' | 'permissions' | 'approval' | 'doc-numbering' | 'documents' | 'currency' | 'bank-accounts' | 'mcp'
  const VALID_TABS: SettingsTab[] = ['general', 'users', 'security', 'pos', 'line', 'billing', 'loyalty', 'units', 'material-categories', 'llm', 'backup', 'permissions', 'approval', 'doc-numbering', 'documents', 'currency', 'bank-accounts', 'mcp']
  // รองรับลิงก์ตรงมาแท็บที่ต้องการ เช่น /settings?tab=units (จาก UnitPicker เมื่อเจอหน่วยที่แปลงไม่ถึง)
  const [searchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as SettingsTab | null
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'general'
  )
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localChildren, setLocalChildren] = useState<ChildUser[]>([])

  // Load children when tab changes to users
  useEffect(() => {
    if (activeTab === 'users' && isMaster) {
      loadChildrenData()
    }
  }, [activeTab, isMaster])

  // Update local state when children changes
  useEffect(() => {
    setLocalChildren((children as unknown) as ChildUser[])
  }, [children])

  const loadChildrenData = async () => {
    setLoading(true)
    await loadChildren()
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
            <span className="text-[var(--fg-1)]">{t('settings.settingsPage.title')}</span>
          </h1>
          <p className="text-[var(--fg-3)]">{t('settings.settingsPage.subtitle')}</p>
        </div>
      </div>

      {/* Tabs — grouped */}
      {(() => {
        const groups = [
          {
            id: 'system', label: t('settings.settingsPage.groups.system'), icon: Settings,
            tabs: [
              { id: 'general' as const, icon: Settings, label: t('settings.settingsPage.tabs.general'), show: true },
              { id: 'units' as const, icon: ArrowLeftRight, label: t('settings.settingsPage.tabs.units'), show: true },
              { id: 'material-categories' as const, icon: Tag, label: t('settings.settingsPage.tabs.materialCategories'), show: isAdmin || isMaster },
              { id: 'doc-numbering' as const, icon: Hash, label: t('settings.settingsPage.tabs.docNumbering'), show: isAdmin || isMaster },
              { id: 'documents' as const, icon: FileText, label: t('settings.settingsPage.tabs.documents'), show: isAdmin || isMaster },
              { id: 'currency' as const, icon: Coins, label: t('settings.settingsPage.tabs.currency'), show: isAdmin || isMaster },
            ],
          },
          {
            id: 'people', label: t('settings.settingsPage.groups.people'), icon: Users,
            tabs: [
              { id: 'users' as const, icon: Users, label: t('settings.settingsPage.tabs.users'), show: isAdmin || isMaster, badge: localChildren.length },
              { id: 'permissions' as const, icon: UserCog, label: t('settings.settingsPage.tabs.permissions'), show: isAdmin || isMaster },
              { id: 'approval' as const, icon: ShieldCheck, label: t('settings.settingsPage.tabs.approval'), show: isAdmin || isMaster },
              { id: 'security' as const, icon: Shield, label: t('settings.settingsPage.tabs.security'), show: true },
            ],
          },
          {
            id: 'sales', label: t('settings.settingsPage.groups.sales'), icon: Store,
            tabs: [
              { id: 'pos' as const, icon: Store, label: t('settings.settingsPage.tabs.pos'), show: isAdmin || isMaster },
              { id: 'billing' as const, icon: Receipt, label: t('settings.settingsPage.tabs.billing'), show: isAdmin || isMaster },
              { id: 'loyalty' as const, icon: Star, label: t('settings.settingsPage.tabs.loyalty'), show: isAdmin || isMaster },
              { id: 'line' as const, icon: MessageSquare, label: t('settings.settingsPage.tabs.line'), show: isAdmin || isMaster },
              { id: 'bank-accounts' as const, icon: Landmark, label: t('settings.settingsPage.tabs.bankAccounts'), show: isAdmin || isMaster },
            ],
          },
          {
            id: 'advanced', label: t('settings.settingsPage.groups.advanced'), icon: Database,
            tabs: [
              { id: 'llm' as const, icon: Brain, label: t('settings.settingsPage.tabs.llm'), show: isMaster },
              { id: 'backup' as const, icon: Database, label: t('settings.settingsPage.tabs.backup'), show: isMaster },
              { id: 'mcp' as const, icon: Zap, label: 'MCP / AI Connect', show: true },
            ],
          },
        ]
        const visibleGroups = groups.filter(g => g.tabs.some(tb => tb.show))
        const currentGroup = visibleGroups.find(g => g.tabs.some(tb => tb.show && tb.id === activeTab)) || visibleGroups[0]
        return (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {visibleGroups.map(g => {
                const GIcon = g.icon
                const isActive = currentGroup.id === g.id
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      const first = g.tabs.find(tb => tb.show)
                      if (first) setActiveTab(first.id)
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? 'bg-phopy-indigo text-white shadow-lg'
                        : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:border-phopy-indigo/40'
                    }`}
                  >
                    <GIcon className="w-4 h-4" />
                    {g.label}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2 border-b border-[var(--border)] pb-2 overflow-x-auto no-scrollbar">
              {currentGroup.tabs.filter(tb => tb.show).map(tb => (
                <TabButton
                  key={tb.id}
                  active={activeTab === tb.id}
                  onClick={() => setActiveTab(tb.id)}
                  icon={tb.icon}
                  label={tb.label}
                  badge={(tb as any).badge}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {/* Content */}
      <div className="space-y-6">
        {activeTab === 'general' && <GeneralSettings />}

        {activeTab === 'users' && isAdmin && !isMaster && <AdminUserManagement />}
        {activeTab === 'users' && isMaster && (
          <UserManagement
            children={localChildren}
            loading={loading}
            onRefresh={loadChildrenData}
            onAdd={() => setShowAddModal(true)}
            onDelete={deleteChildUser}
          />
        )}

        {activeTab === 'security' && <SecuritySettings />}

        {activeTab === 'pos' && (isAdmin || isMaster) && <POSMenuSettings />}

        {activeTab === 'line' && (isAdmin || isMaster) && <LineSettings />}

        {activeTab === 'bank-accounts' && (isAdmin || isMaster) && <BankAccountSettings />}

        {activeTab === 'billing' && (isAdmin || isMaster) && <BillingSettings />}

        {activeTab === 'loyalty' && (isAdmin || isMaster) && <LoyaltySettings />}

        {activeTab === 'units' && <UnitConversions />}

        {activeTab === 'material-categories' && (isAdmin || isMaster) && <MaterialCategories />}

        {activeTab === 'llm' && isMaster && <LLMSettings />}

        {activeTab === 'backup' && isMaster && <BackupSettings />}
        {activeTab === 'mcp' && <MCPSettings />}

        {activeTab === 'permissions' && (isAdmin || isMaster) && <PermissionSettings />}

        {activeTab === 'approval' && (isAdmin || isMaster) && <ApprovalSettings />}

        {activeTab === 'doc-numbering' && (isAdmin || isMaster) && <DocumentNumberSettings />}

        {activeTab === 'documents' && (isAdmin || isMaster) && <DocumentSettings />}

        {activeTab === 'currency' && (isAdmin || isMaster) && <CurrencySettings />}
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddChildModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false)
              loadChildrenData()
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// Tab Button Component
function TabButton({ active, onClick, icon: Icon, label, badge }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${active
          ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-b-2 border-phopy-indigo'
          : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)]'
        }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-1 px-2 py-0.5 bg-phopy-indigo/30 text-[var(--primary)] rounded-full text-xs">
          {badge}
        </span>
      )}
    </button>
  )
}

// Shop / Receipt Info
export interface ShopConfig {
  name: string
  address: string
  phone: string
  taxId: string
  footer: string
}
export const DEFAULT_SHOP: ShopConfig = {
  name: '',
  address: '',
  phone: '',
  taxId: '',
  footer: 'ขอบคุณที่ใช้บริการ',
}
export function loadShopConfig(): ShopConfig {
  try {
    const saved = localStorage.getItem('pos_shop_settings')
    return saved ? { ...DEFAULT_SHOP, ...JSON.parse(saved) } : DEFAULT_SHOP
  } catch {
    return DEFAULT_SHOP
  }
}

// Billing Settings — VAT & Service Charge
export interface BillingConfig {
  vatEnabled: boolean
  vatRate: number
  serviceEnabled: boolean
  serviceRate: number
}

export const DEFAULT_BILLING: BillingConfig = {
  vatEnabled: false,
  vatRate: 7,
  serviceEnabled: false,
  serviceRate: 10,
}

export function loadBillingConfig(): BillingConfig {
  try {
    const saved = localStorage.getItem('pos_billing_settings')
    return saved ? { ...DEFAULT_BILLING, ...JSON.parse(saved) } : DEFAULT_BILLING
  } catch {
    return DEFAULT_BILLING
  }
}

function BillingSettings() {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<BillingConfig>(loadBillingConfig)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    localStorage.setItem('pos_billing_settings', JSON.stringify(cfg))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // Sync to backend so POS bill calculations use the same settings
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update({
        pos_vat_enabled: cfg.vatEnabled,
        pos_vat_rate: cfg.vatRate,
        pos_service_enabled: cfg.serviceEnabled,
        pos_service_rate: cfg.serviceRate,
      })
    } catch (e) {
      console.warn('Failed to sync billing config to backend:', e)
    }
  }

  const ToggleSwitch = ({ enabled, onChange, label, sub }: { enabled: boolean; onChange: (v: boolean) => void; label: string; sub: string }) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${enabled ? 'border-phopy-indigo/60 bg-phopy-indigo/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
    >
      <div className="text-left">
        <p className={`font-medium ${enabled ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>{label}</p>
        <p className="text-xs text-[var(--fg-4)] mt-0.5">{sub}</p>
      </div>
      {enabled
        ? <ToggleRight className="w-8 h-8 text-[var(--primary)] flex-shrink-0" />
        : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />
      }
    </button>
  )

  const previewAmount = 1000

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-bold text-[var(--fg-1)] mb-1">{t('settings.settingsPage.billing.title')}</h2>
        <p className="text-sm text-[var(--fg-3)]">{t('settings.settingsPage.billing.subtitle')}</p>
      </div>

      {/* VAT */}
      <div className="space-y-3">
        <ToggleSwitch
          enabled={cfg.vatEnabled}
          onChange={(v) => setCfg({ ...cfg, vatEnabled: v })}
          label={t('settings.settingsPage.billing.vat')}
          sub={t('settings.settingsPage.billing.vatSub')}
        />
        {cfg.vatEnabled && (
          <div className="pl-2">
            <label className="block text-sm text-[var(--fg-3)] mb-2 flex items-center gap-2">
              <Percent className="w-4 h-4" /> {t('settings.settingsPage.billing.vatRate')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.vatRate}
                onChange={(e) => setCfg({ ...cfg, vatRate: parseFloat(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-32 text-center text-lg font-bold"
                min="0"
                max="100"
                step="0.5"
              />
              <span className="text-[var(--fg-3)] text-sm">%</span>
              <div className="flex gap-2">
                {[3, 5, 7, 10].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCfg({ ...cfg, vatRate: r })}
                    className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.vatRate === r ? 'bg-[var(--primary-soft)] border-phopy-indigo text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)] hover:border-[var(--border-strong)]'}`}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Service Charge */}
      <div className="space-y-3">
        <ToggleSwitch
          enabled={cfg.serviceEnabled}
          onChange={(v) => setCfg({ ...cfg, serviceEnabled: v })}
          label={t('settings.settingsPage.billing.service')}
          sub={t('settings.settingsPage.billing.serviceSub')}
        />
        {cfg.serviceEnabled && (
          <div className="pl-2">
            <label className="block text-sm text-[var(--fg-3)] mb-2 flex items-center gap-2">
              <Percent className="w-4 h-4" /> {t('settings.settingsPage.billing.serviceRate')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.serviceRate}
                onChange={(e) => setCfg({ ...cfg, serviceRate: parseFloat(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-32 text-center text-lg font-bold"
                min="0"
                max="100"
                step="0.5"
              />
              <span className="text-[var(--fg-3)] text-sm">%</span>
              <div className="flex gap-2">
                {[5, 10, 12.5, 15].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCfg({ ...cfg, serviceRate: r })}
                    className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.serviceRate === r ? 'bg-[var(--primary-soft)] border-phopy-indigo text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)] hover:border-[var(--border-strong)]'}`}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      {(cfg.vatEnabled || cfg.serviceEnabled) && (
        <div className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-1.5 text-sm">
          <p className="text-[var(--fg-3)] font-medium mb-2">{t('settings.settingsPage.billing.previewTitle', { amount: `฿${previewAmount.toLocaleString()}` })}</p>
          <div className="flex justify-between text-[var(--fg-3)]">
            <span>{t('settings.settingsPage.billing.subtotal')}</span><span>฿{previewAmount.toFixed(2)}</span>
          </div>
          {cfg.serviceEnabled && (
            <div className="flex justify-between text-blue-400">
              <span>{t('settings.settingsPage.billing.serviceCharge', { rate: cfg.serviceRate })}</span>
              <span>+฿{(previewAmount * cfg.serviceRate / 100).toFixed(2)}</span>
            </div>
          )}
          {cfg.vatEnabled && (
            <div className="flex justify-between text-warning">
              <span>{t('settings.settingsPage.billing.vat', { rate: cfg.vatRate })}</span>
              <span>+฿{(previewAmount * cfg.vatRate / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-success font-bold border-t border-[var(--border)] pt-1.5">
            <span>{t('settings.settingsPage.billing.total')}</span>
            <span>฿{(previewAmount + (cfg.serviceEnabled ? previewAmount * cfg.serviceRate / 100 : 0) + (cfg.vatEnabled ? previewAmount * cfg.vatRate / 100 : 0)).toFixed(2)}</span>
          </div>
        </div>
      )}

      <button
        onClick={save}
        className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${saved ? 'bg-[var(--success-soft)] text-success border border-success/50' : 'phopy-btn-primary'}`}
      >
        {saved ? <><CheckCircle className="w-5 h-5" /> {t('common.saved')}</> : t('settings.settingsPage.billing.save')}
      </button>
    </div>
  )
}

// Loyalty Points Config
export interface LoyaltyConfig {
  enabled: boolean
  earnRate: number       // spend X baht → earn 1 point
  redeemRate: number     // X points → 1 baht discount
  minRedeemPoints: number
}

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  enabled: true,
  earnRate: 100,
  redeemRate: 10,
  minRedeemPoints: 100,
}

export function loadLoyaltyConfig(): LoyaltyConfig {
  try {
    const saved = localStorage.getItem('pos_loyalty_settings')
    return saved ? { ...DEFAULT_LOYALTY, ...JSON.parse(saved) } : DEFAULT_LOYALTY
  } catch {
    return DEFAULT_LOYALTY
  }
}

function LoyaltySettings() {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<LoyaltyConfig>(loadLoyaltyConfig)
  const [saved, setSaved] = useState(false)

  const save = () => {
    localStorage.setItem('pos_loyalty_settings', JSON.stringify(cfg))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const ToggleSwitch = ({ enabled, onChange, label, sub }: { enabled: boolean; onChange: (v: boolean) => void; label: string; sub: string }) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${enabled ? 'border-phopy-indigo/60 bg-phopy-indigo/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
    >
      <div className="text-left">
        <p className={`font-medium ${enabled ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>{label}</p>
        <p className="text-xs text-[var(--fg-4)] mt-0.5">{sub}</p>
      </div>
      {enabled
        ? <ToggleRight className="w-8 h-8 text-[var(--primary)] flex-shrink-0" />
        : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />
      }
    </button>
  )

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-bold text-[var(--fg-1)] mb-1 flex items-center gap-2">
          <Star className="w-5 h-5 text-warning" />
          {t('settings.settingsPage.loyalty.title')}
        </h2>
        <p className="text-sm text-[var(--fg-3)]">{t('settings.settingsPage.loyalty.subtitle')}</p>
      </div>

      {/* Enable Toggle */}
      <ToggleSwitch
        enabled={cfg.enabled}
        onChange={(v) => setCfg({ ...cfg, enabled: v })}
        label={t('settings.settingsPage.loyalty.enabled')}
        sub={t('settings.settingsPage.loyalty.enabledSub')}
      />

      {cfg.enabled && (
        <>
          {/* Earn Rate */}
          <div className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-[var(--primary)]" />
              <p className="font-medium text-[var(--fg-2)]">{t('settings.settingsPage.loyalty.earnRateTitle')}</p>
            </div>
            <p className="text-xs text-[var(--fg-4)]">{t('settings.settingsPage.loyalty.earnRateHint')}</p>
            <div className="flex items-center gap-3">
              <span className="text-[var(--fg-3)] text-sm">{t('settings.settingsPage.loyalty.spend')}</span>
              <input
                type="number"
                value={cfg.earnRate}
                onChange={(e) => setCfg({ ...cfg, earnRate: Math.max(1, parseFloat(e.target.value) || 1) })}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-28 text-center text-lg font-bold"
                min="1"
                step="1"
              />
              <span className="text-[var(--fg-3)] text-sm">{t('settings.settingsPage.loyalty.bahtPerPoint')}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[10, 25, 50, 100, 200].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCfg({ ...cfg, earnRate: r })}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.earnRate === r ? 'bg-[var(--primary-soft)] border-phopy-indigo text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)] hover:border-[var(--border-strong)]'}`}
                >
                  {r} {t('settings.settingsPage.loyalty.bahtUnit')}
                </button>
              ))}
            </div>
          </div>

          {/* Redeem Rate */}
          <div className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-warning" />
              <p className="font-medium text-[var(--fg-2)]">{t('settings.settingsPage.loyalty.redeemRateTitle')}</p>
            </div>
            <p className="text-xs text-[var(--fg-4)]">{t('settings.settingsPage.loyalty.redeemRateHint')}</p>
            <div className="flex items-center gap-3">
              <span className="text-[var(--fg-3)] text-sm">{t('settings.settingsPage.loyalty.usePoints')}</span>
              <input
                type="number"
                value={cfg.redeemRate}
                onChange={(e) => setCfg({ ...cfg, redeemRate: Math.max(1, parseFloat(e.target.value) || 1) })}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-28 text-center text-lg font-bold"
                min="1"
                step="1"
              />
              <span className="text-[var(--fg-3)] text-sm">{t('settings.settingsPage.loyalty.pointsPerBaht')}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[1, 5, 10, 20, 50].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCfg({ ...cfg, redeemRate: r })}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.redeemRate === r ? 'bg-yellow-400/20 border-yellow-400 text-warning' : 'border-[var(--border)] text-[var(--fg-3)] hover:border-[var(--border-strong)]'}`}
                >
                  {r} {t('settings.settingsPage.loyalty.pointsUnit')}
                </button>
              ))}
            </div>
          </div>

          {/* Minimum Redeem */}
          <div className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[var(--fg-3)]" />
              <p className="font-medium text-[var(--fg-2)]">{t('settings.settingsPage.loyalty.minRedeemTitle')}</p>
            </div>
            <p className="text-xs text-[var(--fg-4)]">{t('settings.settingsPage.loyalty.minRedeemHint')}</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.minRedeemPoints}
                onChange={(e) => setCfg({ ...cfg, minRedeemPoints: Math.max(0, parseFloat(e.target.value) || 0) })}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-28 text-center text-lg font-bold"
                min="0"
                step="1"
              />
              <span className="text-[var(--fg-3)] text-sm">{t('settings.settingsPage.loyalty.pointsUnit')}</span>
            </div>
          </div>

          {/* Preview */}
          <div className="p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] space-y-2 text-sm">
            <p className="text-[var(--fg-3)] font-medium mb-2">{t('settings.settingsPage.loyalty.previewTitle')}</p>
            <div className="flex justify-between text-[var(--fg-3)]">
              <span>{t('settings.settingsPage.loyalty.previewBuy', { amount: `฿${(cfg.earnRate * 10).toLocaleString()}` })}</span>
              <span className="text-[var(--primary)]">{t('settings.settingsPage.loyalty.previewEarn')}</span>
            </div>
            <div className="flex justify-between text-[var(--fg-3)]">
              <span>{t('settings.settingsPage.loyalty.previewRedeem', { points: cfg.redeemRate * 10 })}</span>
              <span className="text-warning">{t('settings.settingsPage.loyalty.previewDiscount', { amount: '฿10' })}</span>
            </div>
            <div className="flex justify-between text-[var(--fg-4)] text-xs border-t border-[var(--border)] pt-2">
              <span>{t('settings.settingsPage.loyalty.pointValue')}</span>
              <span>≈ ฿{(1 / cfg.redeemRate).toFixed(2)}</span>
            </div>
          </div>
        </>
      )}

      <button
        onClick={save}
        className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${saved ? 'bg-[var(--success-soft)] text-success border border-success/50' : 'phopy-btn-primary'}`}
      >
        {saved ? <><CheckCircle className="w-5 h-5" /> {t('common.saved')}</> : t('settings.settingsPage.loyalty.save')}
      </button>
    </div>
  )
}

// General Settings
function GeneralSettings() {
  const { t } = useTranslation()
  const { tenant, isMaster, user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [co, setCo] = useState({ name: '', address: '', phone: '', email: '', tax_id: '', logo_base64: '' })
  const [qcGateEnabled, setQcGateEnabled] = useState(false)
  const [showSubconStockWidget, setShowSubconStockWidget] = useState(true)
  const [allowNegativeStock, setAllowNegativeStock] = useState(false)
  const [requirePosShift, setRequirePosShift] = useState(false)
  const [subPlanName, setSubPlanName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [qcSaving, setQcSaving] = useState(false)
  const [subconWidgetSaving, setSubconWidgetSaving] = useState(false)
  const [negStockSaving, setNegStockSaving] = useState(false)
  const [requireShiftSaving, setRequireShiftSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    import('../services/companySettings.service').then(m => {
      m.default.get().then(d => {
        setCo({ name: d.name || '', address: d.address || '', phone: d.phone || '', email: d.email || '', tax_id: d.tax_id || '', logo_base64: d.logo_base64 || '' })
        setQcGateEnabled(Number(d.qc_gate_enabled) === 1)
        setShowSubconStockWidget(Number(d.show_subcon_stock_widget) !== 0)
        setAllowNegativeStock(Number(d.allow_negative_stock) === 1)
        setRequirePosShift(Number(d.require_pos_shift) === 1)
        setSubPlanName(d.subscription_plan_name || '')
      }).catch(() => {})
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update(co)
      setSaveSuccess(true)
      setSaveMsg(t('settings.settingsPage.general.savedSuccess'))
      setTimeout(() => { setSaveMsg(''); setSaveSuccess(false) }, 3000)
    } catch {
      setSaveSuccess(false)
      setSaveMsg(t('settings.settingsPage.general.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleQcGate = async () => {
    const next = !qcGateEnabled
    setQcGateEnabled(next)
    setQcSaving(true)
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update({ qc_gate_enabled: next })
    } catch {
      setQcGateEnabled(!next)
    } finally {
      setQcSaving(false)
    }
  }

  const handleToggleSubconStockWidget = async () => {
    const next = !showSubconStockWidget
    setShowSubconStockWidget(next)
    setSubconWidgetSaving(true)
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update({ show_subcon_stock_widget: next })
    } catch {
      setShowSubconStockWidget(!next)
    } finally {
      setSubconWidgetSaving(false)
    }
  }

  const handleToggleAllowNegativeStock = async () => {
    const next = !allowNegativeStock
    setAllowNegativeStock(next)
    setNegStockSaving(true)
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update({ allow_negative_stock: next })
    } catch {
      setAllowNegativeStock(!next)
    } finally {
      setNegStockSaving(false)
    }
  }

  const handleToggleRequirePosShift = async () => {
    const next = !requirePosShift
    setRequirePosShift(next)
    setRequireShiftSaving(true)
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update({ require_pos_shift: next })
    } catch {
      setRequirePosShift(!next)
    } finally {
      setRequireShiftSaving(false)
    }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCo(prev => ({ ...prev, logo_base64: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-6">
      {/* Company Profile — editable */}
      <div className="phopy-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--primary)]" />
            {t('settings.settingsPage.general.companyTitle')}
          </h3>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="phopy-btn-primary flex items-center gap-2 text-sm px-4 py-2"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>

        {saveMsg && (
          <div className={`mb-4 px-3 py-2 rounded text-sm ${saveSuccess ? 'bg-success/10 text-success border border-success/30' : 'bg-[var(--danger-soft)] text-danger border border-danger/30'}`}>
            {saveMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Logo */}
          <div className="md:col-span-2 flex items-center gap-4">
            <div
              className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border)] flex items-center justify-center cursor-pointer hover:border-phopy-indigo/50 transition-colors overflow-hidden bg-[var(--bg)]"
              onClick={() => fileRef.current?.click()}
            >
              {co.logo_base64
                ? <img src={co.logo_base64} alt="logo" className="w-full h-full object-contain" />
                : <Building2 className="w-8 h-8 text-[var(--fg-4)]" />}
            </div>
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-[var(--primary)] hover:underline">
                {t('settings.settingsPage.general.uploadLogo')}
              </button>
              {co.logo_base64 && (
                <button type="button" onClick={() => setCo(p => ({ ...p, logo_base64: '' }))} className="ml-3 text-sm text-danger hover:underline">
                  {t('settings.settingsPage.general.removeLogo')}
                </button>
              )}
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('settings.settingsPage.general.logoHint')}</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.companyName')}</label>
            <input type="text" value={co.name} onChange={e => setCo(p => ({ ...p, name: e.target.value }))} className="phopy-input w-full" placeholder={t('settings.settingsPage.general.companyNamePlaceholder')} />
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.taxId')}</label>
            <input type="text" value={co.tax_id} onChange={e => setCo(p => ({ ...p, tax_id: e.target.value }))} className="phopy-input w-full" placeholder={t('settings.settingsPage.general.taxIdPlaceholder')} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.address')}</label>
            <textarea value={co.address} onChange={e => setCo(p => ({ ...p, address: e.target.value }))} className="phopy-input w-full resize-none" rows={3} placeholder={t('settings.settingsPage.general.addressPlaceholder')} />
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.phone')}</label>
            <input type="text" value={co.phone} onChange={e => setCo(p => ({ ...p, phone: e.target.value }))} className="phopy-input w-full" placeholder={t('settings.settingsPage.general.phonePlaceholder')} />
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.email')}</label>
            <input type="email" value={co.email} onChange={e => setCo(p => ({ ...p, email: e.target.value }))} className="phopy-input w-full" placeholder={t('settings.settingsPage.general.emailPlaceholder')} />
          </div>
        </div>
      </div>

      {/* QC Gate — require QC pass before closing work order */}
      <div className="phopy-card p-6">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.qcGate.title')}
        </h3>
        <button
          type="button"
          onClick={handleToggleQcGate}
          disabled={qcSaving}
          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all disabled:opacity-60 ${qcGateEnabled ? 'border-phopy-indigo/60 bg-phopy-indigo/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
        >
          <div className="text-left">
            <p className={`font-medium ${qcGateEnabled ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>{t('settings.settingsPage.qcGate.toggleLabel')}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('settings.settingsPage.qcGate.toggleSub')}</p>
          </div>
          {qcGateEnabled
            ? <ToggleRight className="w-8 h-8 text-[var(--primary)] flex-shrink-0" />
            : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />}
        </button>

        <button
          type="button"
          onClick={handleToggleSubconStockWidget}
          disabled={subconWidgetSaving}
          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all disabled:opacity-60 mt-3 ${showSubconStockWidget ? 'border-phopy-indigo/60 bg-phopy-indigo/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
        >
          <div className="text-left">
            <p className={`font-medium ${showSubconStockWidget ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>{t('settings.settingsPage.subconStockWidget.toggleLabel')}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('settings.settingsPage.subconStockWidget.toggleSub')}</p>
          </div>
          {showSubconStockWidget
            ? <ToggleRight className="w-8 h-8 text-[var(--primary)] flex-shrink-0" />
            : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />}
        </button>
      </div>

      {/* Allow Negative Stock — risky override, block by default. ADMIN/MASTER only:
          hidden entirely for lower roles rather than shown disabled, since the
          backend now rejects this field from anyone else anyway. */}
      {(isAdmin || isMaster) && (
      <div className="phopy-card p-6 border-l-4 border-danger">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-danger" />
          {t('settings.settingsPage.allowNegativeStock.title')}
        </h3>
        <button
          type="button"
          onClick={() => !negStockSaving && handleToggleAllowNegativeStock()}
          disabled={negStockSaving}
          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all disabled:opacity-60 mt-3 ${allowNegativeStock ? 'border-danger/60 bg-danger/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
        >
          <div className="text-left">
            <p className={`font-medium ${allowNegativeStock ? 'text-danger' : 'text-[var(--fg-2)]'}`}>{t('settings.settingsPage.allowNegativeStock.toggleLabel')}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('settings.settingsPage.allowNegativeStock.toggleSub')}</p>
          </div>
          {negStockSaving
            ? <div className="w-5 h-5 border-2 border-danger border-t-transparent rounded-full animate-spin flex-shrink-0" />
            : allowNegativeStock
              ? <ToggleRight className="w-8 h-8 text-danger flex-shrink-0" />
              : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />}
        </button>

        {/* Scope list always visible — so it's clear what turning this on
            affects before you flip it, not only after. */}
        <div className="mt-3 px-4 py-3 rounded-lg bg-danger/5 border border-danger/20">
          <p className="text-sm font-medium text-danger mb-2">{t('settings.settingsPage.allowNegativeStock.scopeTitle')}</p>
          <ul className="space-y-1 text-sm text-[var(--fg-2)]">
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              {t('settings.settingsPage.allowNegativeStock.scopePos')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              {t('settings.settingsPage.allowNegativeStock.scopeWorkOrder')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              {t('settings.settingsPage.allowNegativeStock.scopeSalesOrder')}
            </li>
          </ul>
        </div>
      </div>
      )}

      {/* Require POS Shift — off by default so existing tenants that never open shifts
          keep selling uninterrupted. ADMIN/MASTER only, same gate as allow_negative_stock. */}
      {(isAdmin || isMaster) && (
      <div className="phopy-card p-6 border-l-4 border-warning">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-1 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-warning" />
          {t('settings.settingsPage.requirePosShift.title')}
        </h3>
        <button
          type="button"
          onClick={() => !requireShiftSaving && handleToggleRequirePosShift()}
          disabled={requireShiftSaving}
          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all disabled:opacity-60 mt-3 ${requirePosShift ? 'border-warning/60 bg-warning/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
        >
          <div className="text-left">
            <p className={`font-medium ${requirePosShift ? 'text-warning' : 'text-[var(--fg-2)]'}`}>{t('settings.settingsPage.requirePosShift.toggleLabel')}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('settings.settingsPage.requirePosShift.toggleSub')}</p>
          </div>
          {requireShiftSaving
            ? <div className="w-5 h-5 border-2 border-warning border-t-transparent rounded-full animate-spin flex-shrink-0" />
            : requirePosShift
              ? <ToggleRight className="w-8 h-8 text-warning flex-shrink-0" />
              : <ToggleLeft className="w-8 h-8 text-[var(--fg-4)] flex-shrink-0" />}
        </button>
      </div>
      )}

      {/* Tenant meta (read-only) */}
      <div className="phopy-card p-6">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.general.accountTitle')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.tenantCode')}</label>
            <p className="text-[var(--fg-2)] font-mono">{tenant?.code || '-'}</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.accountType')}</label>
            <p className={`font-semibold ${isMaster ? 'text-success' : 'text-[var(--primary)]'}`}>
              {isMaster ? t('settings.settingsPage.general.masterAccount') : t('settings.settingsPage.general.standardAccount')}
            </p>
          </div>
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-1">{t('settings.settingsPage.general.subscriptionPlan')}</label>
            <p className="font-semibold text-[var(--primary)]">{subPlanName || '-'}</p>
          </div>
        </div>
      </div>

      {/* Master Account Info */}
      {isMaster && (
        <div className="phopy-card p-6 border-l-4 border-success">
          <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-success" />
            {t('settings.settingsPage.general.masterPrivilegesTitle')}
          </h3>
          <ul className="space-y-2 text-[var(--fg-2)]">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success" />
              {t('settings.settingsPage.general.privilegeUnlimitedUsers')}
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success" />
              {t('settings.settingsPage.general.privilegeNoTimeLock')}
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success" />
              {t('settings.settingsPage.general.privilegeManagePermissions')}
            </li>
          </ul>
        </div>
      )}

      {/* Time Lock Info */}
      <div className="phopy-card p-6">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.general.timeLockTitle')}
        </h3>
        <div className="space-y-3 text-[var(--fg-2)]">
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <span dangerouslySetInnerHTML={{ __html: t('settings.settingsPage.general.timeLockRule1') }} />
          </p>
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
            <span>
              {t('settings.settingsPage.general.timeLockRule2')}
              {isMaster && <strong className="text-success">{t('settings.settingsPage.general.timeLockRule2Master')}</strong>}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
            <span dangerouslySetInnerHTML={{ __html: t('settings.settingsPage.general.timeLockRule3') }} />
          </p>
        </div>
      </div>
    </div>
  )
}

// User Management (Master Only)
function UserManagement({ children, loading, onRefresh, onAdd, onDelete }: any) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.settingsPage.userManagement.deleteConfirm'))) return

    setDeleting(id)
    const result = await onDelete(id)
    setDeleting(null)

    if (!result.success) {
      alert(result.message || t('settings.settingsPage.userManagement.deleteFailed'))
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
          <Users className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.userManagement.title')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-[var(--fg-3)] hover:text-[var(--primary)] rounded-lg hover:bg-phopy-indigo/10 transition-colors"
            title={t('settings.settingsPage.userManagement.refresh')}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onAdd}
            className="phopy-btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('settings.settingsPage.userManagement.addUser')}
          </button>
        </div>
      </div>

      {/* User List */}
      {children.length === 0 ? (
        <div className="phopy-card p-12 text-center">
          <Users className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-[var(--fg-2)] mb-2">{t('settings.settingsPage.userManagement.noUsersTitle')}</h3>
          <p className="text-[var(--fg-4)] mb-4">{t('settings.settingsPage.userManagement.noUsersHint')}</p>
          <button onClick={onAdd} className="phopy-btn-primary">
            <Plus className="w-4 h-4 inline mr-2" />
            {t('settings.settingsPage.userManagement.addUser')}
          </button>
        </div>
      ) : (
        <div className="phopy-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className="text-left py-3 px-4 text-[var(--fg-3)] font-medium">{t('settings.settingsPage.userManagement.name')}</th>
                <th className="text-left py-3 px-4 text-[var(--fg-3)] font-medium">{t('settings.settingsPage.userManagement.email')}</th>
                <th className="text-left py-3 px-4 text-[var(--fg-3)] font-medium">{t('settings.settingsPage.userManagement.role')}</th>
                <th className="text-left py-3 px-4 text-[var(--fg-3)] font-medium">{t('settings.settingsPage.userManagement.createdAt')}</th>
                <th className="text-left py-3 px-4 text-[var(--fg-3)] font-medium">{t('settings.settingsPage.userManagement.lastLogin')}</th>
                <th className="text-center py-3 px-4 text-[var(--fg-3)] font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {children.map((child: ChildUser) => (
                <tr key={child.id} className="hover:bg-[var(--bg)]/30">
                  <td className="py-3 px-4 text-[var(--fg-2)]">{child.name}</td>
                  <td className="py-3 px-4 text-[var(--fg-3)]">{child.email}</td>
                  <td className="py-3 px-4">
                    <RoleBadge role={child.role} />
                  </td>
                  <td className="py-3 px-4 text-[var(--fg-3)] text-sm">
                    {new Date(child.created_at).toLocaleDateString('th-TH')}
                  </td>
                  <td className="py-3 px-4 text-[var(--fg-3)] text-sm">
                    {child.last_login_at
                      ? new Date(child.last_login_at).toLocaleDateString('th-TH')
                      : '-'
                    }
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleDelete(child.id)}
                      disabled={deleting === child.id}
                      className="p-2 text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] rounded-lg transition-colors"
                      title={t('common.delete')}
                    >
                      {deleting === child.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Role Badge
function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation()
  const colors: Record<string, string> = {
    ADMIN: 'bg-[var(--success-soft)] text-success',
    MANAGER: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    USER: 'bg-[var(--info-soft)] text-blue-400',
    VIEWER: 'bg-[var(--surface-sunken)] text-[var(--fg-3)]',
  }

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[role] || colors.USER}`}>
      {t(`settings.settingsPage.userManagement.roles.${role}`)}
    </span>
  )
}

// Add Child Modal
function AddChildModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const { createChildUser } = useAuth()
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'USER',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.email || !form.password || !form.name) {
      setError(t('settings.settingsPage.addChildModal.fillRequired'))
      return
    }

    setSaving(true)
    const result = await createChildUser(form.email, form.password, form.name, form.role)
    setSaving(false)

    if (result.success) {
      onSuccess()
    } else {
      setError(result.message || t('settings.settingsPage.addChildModal.createFailed'))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-md max-h-[80vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--fg-1)]">{t('settings.settingsPage.addChildModal.title')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg">
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-[var(--danger-soft)] border border-danger/30 rounded-lg flex items-center gap-2 text-danger text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">{t('settings.settingsPage.addChildModal.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="phopy-input w-full"
              placeholder={t('settings.settingsPage.addChildModal.namePlaceholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">{t('settings.settingsPage.addChildModal.email')}</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: stripNonAscii(e.target.value) })}
              className="phopy-input w-full"
              placeholder={t('settings.settingsPage.addChildModal.emailPlaceholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">{t('settings.settingsPage.addChildModal.password')}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="phopy-input w-full"
              placeholder={t('settings.settingsPage.addChildModal.passwordPlaceholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">{t('settings.settingsPage.addChildModal.role')}</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="phopy-input w-full"
            >
              <option value="USER">{t('settings.settingsPage.addChildModal.roles.user')}</option>
              <option value="MANAGER">{t('settings.settingsPage.addChildModal.roles.manager')}</option>
              <option value="VIEWER">{t('settings.settingsPage.addChildModal.roles.viewer')}</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:bg-[var(--bg)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="phopy-btn-primary flex items-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? t('settings.settingsPage.addChildModal.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// Security Settings
function SecuritySettings() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isMasterEnv = typeof user?.id === 'string' && user.id.startsWith('master_')

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submitChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (newPw.length < 8) return setMsg({ ok: false, text: t('settings.settingsPage.security.passwordTooShort') })
    if (newPw !== confirmPw) return setMsg({ ok: false, text: t('settings.settingsPage.security.passwordsDoNotMatch') })
    setBusy(true)
    try {
      const res = await api.post('/auth/change-password', { currentPassword: curPw, newPassword: newPw })
      setMsg({ ok: true, text: res.data?.message || t('settings.settingsPage.security.changeSuccess') })
      setCurPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.message || t('settings.settingsPage.security.changeFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="phopy-card p-6">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.security.changePassword')}
        </h3>

        {isMasterEnv ? (
          <p className="text-[var(--fg-3)] text-sm">
            {t('settings.settingsPage.security.masterPasswordNote')}
          </p>
        ) : (
          <form onSubmit={submitChangePw} className="space-y-4 max-w-md">
            {msg && (
              <div className={`p-3 rounded-lg text-sm ${msg.ok ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-danger'}`}>
                {msg.text}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">{t('settings.settingsPage.security.currentPassword')}</label>
              <input type={showPw ? 'text' : 'password'} value={curPw} onChange={e => setCurPw(e.target.value)}
                className="phopy-input w-full" autoComplete="current-password" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">{t('settings.settingsPage.security.newPasswordHint')}</label>
              <input type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                className="phopy-input w-full" autoComplete="new-password" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--fg-2)] mb-1">{t('settings.settingsPage.security.confirmPassword')}</label>
              <input type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                className="phopy-input w-full" autoComplete="new-password" required />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--fg-3)] cursor-pointer">
              <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} className="w-4 h-4" />
              {t('settings.settingsPage.security.showPassword')}
            </label>
            <button type="submit" disabled={busy}
              className="phopy-btn-primary flex items-center gap-2 disabled:opacity-50">
              {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              {busy ? t('settings.settingsPage.security.saving') : t('settings.settingsPage.security.changePasswordButton')}
            </button>
          </form>
        )}
      </div>

      <div className="phopy-card p-6">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--primary)]" />
          {t('settings.settingsPage.security.twoFactor')}
        </h3>
        <p className="text-[var(--fg-3)] text-sm mb-4">
          {t('settings.settingsPage.security.twoFactorDesc')}
        </p>
        <button disabled className="phopy-btn-primary opacity-50 cursor-not-allowed">
          {t('settings.settingsPage.security.enable2FA')}
        </button>
      </div>
    </div>
  )
}
