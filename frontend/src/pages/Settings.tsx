import { useState, useEffect, useRef } from 'react'
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
  Info,
} from 'lucide-react'
import POSMenuSettings from './settings/POSMenuSettings'
import LineSettings from './settings/LineSettings'
import { useAuth } from '../contexts/AuthContext'

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
  const { isMaster, children, loadChildren, deleteChildUser } = useAuth()
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'security' | 'pos' | 'line' | 'billing' | 'loyalty'>('general')
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
          <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
            <span className="neon-text">Settings</span>
          </h1>
          <p className="text-gray-400">ตั้งค่าระบบและจัดการผู้ใช้งาน</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-cyber-border pb-2">
        <TabButton
          active={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
          icon={Settings}
          label="ทั่วไป"
        />
        {isMaster && (
          <TabButton
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            icon={Users}
            label="ผู้ใช้งาน"
            badge={localChildren.length}
          />
        )}
        <TabButton
          active={activeTab === 'security'}
          onClick={() => setActiveTab('security')}
          icon={Shield}
          label="ความปลอดภัย"
        />
        <TabButton
          active={activeTab === 'pos'}
          onClick={() => setActiveTab('pos')}
          icon={Store}
          label="POS Menu"
        />
        <TabButton
          active={activeTab === 'line'}
          onClick={() => setActiveTab('line')}
          icon={MessageSquare}
          label="LINE Bot"
        />
        <TabButton
          active={activeTab === 'billing'}
          onClick={() => setActiveTab('billing')}
          icon={Receipt}
          label="การชำระเงิน"
        />
        <TabButton
          active={activeTab === 'loyalty'}
          onClick={() => setActiveTab('loyalty')}
          icon={Star}
          label="สะสมแต้ม"
        />
      </div>

      {/* Content */}
      <div className="space-y-6">
        {activeTab === 'general' && <GeneralSettings />}

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

        {activeTab === 'pos' && <POSMenuSettings />}

        {activeTab === 'line' && <LineSettings />}

        {activeTab === 'billing' && <BillingSettings />}

        {activeTab === 'loyalty' && <LoyaltySettings />}
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
          ? 'bg-cyber-primary/20 text-cyber-primary border-b-2 border-cyber-primary'
          : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark'
        }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-1 px-2 py-0.5 bg-cyber-primary/30 text-cyber-primary rounded-full text-xs">
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
  const [cfg, setCfg] = useState<BillingConfig>(loadBillingConfig)
  const [saved, setSaved] = useState(false)

  const save = () => {
    localStorage.setItem('pos_billing_settings', JSON.stringify(cfg))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const ToggleSwitch = ({ enabled, onChange, label, sub }: { enabled: boolean; onChange: (v: boolean) => void; label: string; sub: string }) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${enabled ? 'border-cyber-primary/60 bg-cyber-primary/5' : 'border-cyber-border bg-cyber-darker'}`}
    >
      <div className="text-left">
        <p className={`font-medium ${enabled ? 'text-cyber-primary' : 'text-gray-300'}`}>{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
      {enabled
        ? <ToggleRight className="w-8 h-8 text-cyber-primary flex-shrink-0" />
        : <ToggleLeft className="w-8 h-8 text-gray-500 flex-shrink-0" />
      }
    </button>
  )

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">การชำระเงิน POS</h2>
        <p className="text-sm text-gray-400">ตั้งค่า VAT และค่าบริการที่คิดเพิ่มในบิล</p>
      </div>

      {/* VAT */}
      <div className="space-y-3">
        <ToggleSwitch
          enabled={cfg.vatEnabled}
          onChange={(v) => setCfg({ ...cfg, vatEnabled: v })}
          label="VAT (ภาษีมูลค่าเพิ่ม)"
          sub="คิด VAT จากยอดรวมสินค้า"
        />
        {cfg.vatEnabled && (
          <div className="pl-2">
            <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
              <Percent className="w-4 h-4" /> อัตรา VAT (%)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.vatRate}
                onChange={(e) => setCfg({ ...cfg, vatRate: parseFloat(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                className="cyber-input w-32 text-center text-lg font-bold"
                min="0"
                max="100"
                step="0.5"
              />
              <span className="text-gray-400 text-sm">%</span>
              <div className="flex gap-2">
                {[3, 5, 7, 10].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCfg({ ...cfg, vatRate: r })}
                    className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.vatRate === r ? 'bg-cyber-primary/20 border-cyber-primary text-cyber-primary' : 'border-cyber-border text-gray-400 hover:border-gray-500'}`}
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
          label="Service Charge (ค่าบริการ)"
          sub="คิดค่าบริการจากยอดรวมสินค้า"
        />
        {cfg.serviceEnabled && (
          <div className="pl-2">
            <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
              <Percent className="w-4 h-4" /> อัตราค่าบริการ (%)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.serviceRate}
                onChange={(e) => setCfg({ ...cfg, serviceRate: parseFloat(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                className="cyber-input w-32 text-center text-lg font-bold"
                min="0"
                max="100"
                step="0.5"
              />
              <span className="text-gray-400 text-sm">%</span>
              <div className="flex gap-2">
                {[5, 10, 12.5, 15].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCfg({ ...cfg, serviceRate: r })}
                    className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.serviceRate === r ? 'bg-cyber-primary/20 border-cyber-primary text-cyber-primary' : 'border-cyber-border text-gray-400 hover:border-gray-500'}`}
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
        <div className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-1.5 text-sm">
          <p className="text-gray-400 font-medium mb-2">ตัวอย่าง (ยอดสินค้า ฿1,000)</p>
          <div className="flex justify-between text-gray-400">
            <span>ยอดสินค้า</span><span>฿1,000.00</span>
          </div>
          {cfg.serviceEnabled && (
            <div className="flex justify-between text-blue-400">
              <span>Service Charge ({cfg.serviceRate}%)</span>
              <span>+฿{(1000 * cfg.serviceRate / 100).toFixed(2)}</span>
            </div>
          )}
          {cfg.vatEnabled && (
            <div className="flex justify-between text-yellow-400">
              <span>VAT ({cfg.vatRate}%)</span>
              <span>+฿{(1000 * cfg.vatRate / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-cyber-green font-bold border-t border-cyber-border pt-1.5">
            <span>ยอดสุทธิ</span>
            <span>฿{(1000 + (cfg.serviceEnabled ? 1000 * cfg.serviceRate / 100 : 0) + (cfg.vatEnabled ? 1000 * cfg.vatRate / 100 : 0)).toFixed(2)}</span>
          </div>
        </div>
      )}

      <button
        onClick={save}
        className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${saved ? 'bg-cyber-green/20 text-cyber-green border border-cyber-green/50' : 'cyber-btn-primary'}`}
      >
        {saved ? <><CheckCircle className="w-5 h-5" /> บันทึกแล้ว</> : 'บันทึกการตั้งค่า'}
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
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${enabled ? 'border-cyber-primary/60 bg-cyber-primary/5' : 'border-cyber-border bg-cyber-darker'}`}
    >
      <div className="text-left">
        <p className={`font-medium ${enabled ? 'text-cyber-primary' : 'text-gray-300'}`}>{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
      {enabled
        ? <ToggleRight className="w-8 h-8 text-cyber-primary flex-shrink-0" />
        : <ToggleLeft className="w-8 h-8 text-gray-500 flex-shrink-0" />
      }
    </button>
  )

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1 flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-400" />
          ระบบสะสมแต้มสมาชิก (CRM)
        </h2>
        <p className="text-sm text-gray-400">ตั้งค่าการคิดและแลกแต้มสำหรับลูกค้า CRM ที่ผูกกับบิล POS</p>
      </div>

      {/* Enable Toggle */}
      <ToggleSwitch
        enabled={cfg.enabled}
        onChange={(v) => setCfg({ ...cfg, enabled: v })}
        label="เปิดใช้ระบบสะสมแต้ม"
        sub="เมื่อเปิด ลูกค้าที่ผูกบิลจะได้รับแต้มทุกครั้งที่ชำระเงิน"
      />

      {cfg.enabled && (
        <>
          {/* Earn Rate */}
          <div className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-cyber-primary" />
              <p className="font-medium text-gray-200">อัตราสะสมแต้ม</p>
            </div>
            <p className="text-xs text-gray-500">ซื้อสินค้าครบ X บาท ได้ 1 แต้ม</p>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">ใช้จ่าย</span>
              <input
                type="number"
                value={cfg.earnRate}
                onChange={(e) => setCfg({ ...cfg, earnRate: Math.max(1, parseFloat(e.target.value) || 1) })}
                onFocus={(e) => e.target.select()}
                className="cyber-input w-28 text-center text-lg font-bold"
                min="1"
                step="1"
              />
              <span className="text-gray-400 text-sm">บาท = 1 แต้ม</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[10, 25, 50, 100, 200].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCfg({ ...cfg, earnRate: r })}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.earnRate === r ? 'bg-cyber-primary/20 border-cyber-primary text-cyber-primary' : 'border-cyber-border text-gray-400 hover:border-gray-500'}`}
                >
                  {r} บาท
                </button>
              ))}
            </div>
          </div>

          {/* Redeem Rate */}
          <div className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-yellow-400" />
              <p className="font-medium text-gray-200">อัตราแลกแต้ม</p>
            </div>
            <p className="text-xs text-gray-500">ใช้ X แต้ม แลกส่วนลด 1 บาท</p>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">ใช้</span>
              <input
                type="number"
                value={cfg.redeemRate}
                onChange={(e) => setCfg({ ...cfg, redeemRate: Math.max(1, parseFloat(e.target.value) || 1) })}
                onFocus={(e) => e.target.select()}
                className="cyber-input w-28 text-center text-lg font-bold"
                min="1"
                step="1"
              />
              <span className="text-gray-400 text-sm">แต้ม = ส่วนลด 1 บาท</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[1, 5, 10, 20, 50].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCfg({ ...cfg, redeemRate: r })}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${cfg.redeemRate === r ? 'bg-yellow-400/20 border-yellow-400 text-yellow-400' : 'border-cyber-border text-gray-400 hover:border-gray-500'}`}
                >
                  {r} แต้ม
                </button>
              ))}
            </div>
          </div>

          {/* Minimum Redeem */}
          <div className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-gray-400" />
              <p className="font-medium text-gray-200">แต้มขั้นต่ำในการแลก</p>
            </div>
            <p className="text-xs text-gray-500">ลูกค้าต้องมีแต้มอย่างน้อยเท่านี้จึงจะแลกได้</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={cfg.minRedeemPoints}
                onChange={(e) => setCfg({ ...cfg, minRedeemPoints: Math.max(0, parseFloat(e.target.value) || 0) })}
                onFocus={(e) => e.target.select()}
                className="cyber-input w-28 text-center text-lg font-bold"
                min="0"
                step="1"
              />
              <span className="text-gray-400 text-sm">แต้ม</span>
            </div>
          </div>

          {/* Preview */}
          <div className="p-4 bg-cyber-darker rounded-xl border border-cyber-border space-y-2 text-sm">
            <p className="text-gray-400 font-medium mb-2">ตัวอย่างการคำนวณ</p>
            <div className="flex justify-between text-gray-400">
              <span>ซื้อ ฿{(cfg.earnRate * 10).toLocaleString()}</span>
              <span className="text-cyber-primary">ได้ 10 แต้ม</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>แลก {cfg.redeemRate * 10} แต้ม</span>
              <span className="text-yellow-400">ลด ฿10</span>
            </div>
            <div className="flex justify-between text-gray-500 text-xs border-t border-cyber-border pt-2">
              <span>ค่าแต้มสะสม 1 แต้ม</span>
              <span>≈ ฿{(1 / cfg.redeemRate).toFixed(2)}</span>
            </div>
          </div>
        </>
      )}

      <button
        onClick={save}
        className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${saved ? 'bg-cyber-green/20 text-cyber-green border border-cyber-green/50' : 'cyber-btn-primary'}`}
      >
        {saved ? <><CheckCircle className="w-5 h-5" /> บันทึกแล้ว</> : 'บันทึกการตั้งค่า'}
      </button>
    </div>
  )
}

// General Settings
function GeneralSettings() {
  const { tenant, isMaster } = useAuth()
  const [co, setCo] = useState({ name: '', address: '', phone: '', email: '', tax_id: '', logo_base64: '' })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    import('../services/companySettings.service').then(m => {
      m.default.get().then(d => {
        setCo({ name: d.name || '', address: d.address || '', phone: d.phone || '', email: d.email || '', tax_id: d.tax_id || '', logo_base64: d.logo_base64 || '' })
      }).catch(() => {})
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const m = await import('../services/companySettings.service')
      await m.default.update(co)
      setSaveMsg('บันทึกสำเร็จ')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch {
      setSaveMsg('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
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
      <div className="cyber-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-cyber-primary" />
            ข้อมูลบริษัท (สำหรับใบบิล)
          </h3>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="cyber-btn-primary flex items-center gap-2 text-sm px-4 py-2"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>

        {saveMsg && (
          <div className={`mb-4 px-3 py-2 rounded text-sm ${saveMsg.includes('สำเร็จ') ? 'bg-cyber-green/10 text-cyber-green border border-cyber-green/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
            {saveMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Logo */}
          <div className="md:col-span-2 flex items-center gap-4">
            <div
              className="w-20 h-20 rounded-lg border-2 border-dashed border-cyber-border flex items-center justify-center cursor-pointer hover:border-cyber-primary/50 transition-colors overflow-hidden bg-cyber-dark"
              onClick={() => fileRef.current?.click()}
            >
              {co.logo_base64
                ? <img src={co.logo_base64} alt="logo" className="w-full h-full object-contain" />
                : <Building2 className="w-8 h-8 text-gray-600" />}
            </div>
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-cyber-primary hover:underline">
                อัปโหลดโลโก้
              </button>
              {co.logo_base64 && (
                <button type="button" onClick={() => setCo(p => ({ ...p, logo_base64: '' }))} className="ml-3 text-sm text-red-400 hover:underline">
                  ลบ
                </button>
              )}
              <p className="text-xs text-gray-500 mt-1">PNG/JPG, แสดงบนหัวใบบิล</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">ชื่อบริษัท / ร้าน</label>
            <input type="text" value={co.name} onChange={e => setCo(p => ({ ...p, name: e.target.value }))} className="cyber-input w-full" placeholder="บริษัท ตัวอย่าง จำกัด" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">เลขผู้เสียภาษี (Tax ID)</label>
            <input type="text" value={co.tax_id} onChange={e => setCo(p => ({ ...p, tax_id: e.target.value }))} className="cyber-input w-full" placeholder="0-0000-00000-00-0" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-400 mb-1">ที่อยู่</label>
            <textarea value={co.address} onChange={e => setCo(p => ({ ...p, address: e.target.value }))} className="cyber-input w-full resize-none" rows={3} placeholder="เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">โทรศัพท์</label>
            <input type="text" value={co.phone} onChange={e => setCo(p => ({ ...p, phone: e.target.value }))} className="cyber-input w-full" placeholder="02-xxx-xxxx" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">อีเมล</label>
            <input type="email" value={co.email} onChange={e => setCo(p => ({ ...p, email: e.target.value }))} className="cyber-input w-full" placeholder="info@company.com" />
          </div>
        </div>
      </div>

      {/* Tenant meta (read-only) */}
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyber-primary" />
          ข้อมูลบัญชี
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">รหัสองค์กร</label>
            <p className="text-gray-200 font-mono">{tenant?.code || '-'}</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">ประเภทบัญชี</label>
            <p className={`font-semibold ${isMaster ? 'text-cyber-green' : 'text-cyber-primary'}`}>
              {isMaster ? 'Master Account' : 'Standard Account'}
            </p>
          </div>
        </div>
      </div>

      {/* Master Account Info */}
      {isMaster && (
        <div className="cyber-card p-6 border-l-4 border-cyber-green">
          <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyber-green" />
            สิทธิ์ Master Account
          </h3>
          <ul className="space-y-2 text-gray-300">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              สามารถสร้างผู้ใช้งานลูกได้ไม่จำกัด
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              แก้ไขข้อมูลได้ไม่จำกัดเวลา (ไม่ติด 24hr rule)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyber-green" />
              จัดการสิทธิ์ผู้ใช้งานได้
            </li>
          </ul>
        </div>
      )}

      {/* Time Lock Info */}
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyber-primary" />
          กฎการแก้ไขข้อมูล (24 Hour Rule)
        </h3>
        <div className="space-y-3 text-gray-300">
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <span>
              ข้อมูลทุกรายการที่สร้างขึ้น <strong className="text-cyber-primary">สามารถแก้ไขได้ภายใน 24 ชั่วโมง</strong> หลังจากสร้าง
            </span>
          </p>
          <p className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <span>
              หากเกิน 24 ชั่วโมง จะไม่สามารถแก้ไขหรือลบได้
              {isMaster && <strong className="text-cyber-green"> (ยกเว้น Master Account)</strong>}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle className="w-5 h-5 text-cyber-green flex-shrink-0 mt-0.5" />
            <span>
              ระบบจะคำนวณเวลาจาก <strong>เวลาปัจจุบัน - เวลาสร้าง</strong> โดยอัตโนมัติ
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

// User Management (Master Only)
function UserManagement({ children, loading, onRefresh, onAdd, onDelete }: any) {
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('ต้องการลบผู้ใช้งานนี้?')) return

    setDeleting(id)
    const result = await onDelete(id)
    setDeleting(null)

    if (!result.success) {
      alert(result.message || 'ลบไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-cyber-primary" />
          รายชื่อผู้ใช้งานในสายงาน
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-cyber-primary rounded-lg hover:bg-cyber-primary/10 transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onAdd}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            เพิ่มผู้ใช้งาน
          </button>
        </div>
      </div>

      {/* User List */}
      {children.length === 0 ? (
        <div className="cyber-card p-12 text-center">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">ยังไม่มีผู้ใช้งานลูก</h3>
          <p className="text-gray-500 mb-4">เริ่มต้นสร้างผู้ใช้งานในสายงานของคุณ</p>
          <button onClick={onAdd} className="cyber-btn-primary">
            <Plus className="w-4 h-4 inline mr-2" />
            เพิ่มผู้ใช้งาน
          </button>
        </div>
      ) : (
        <div className="cyber-card overflow-hidden">
          <table className="w-full">
            <thead className="bg-cyber-dark/50">
              <tr>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">ชื่อ</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">อีเมล</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">สิทธิ์</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">สร้างเมื่อ</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">เข้าสู่ระบบล่าสุด</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-border">
              {children.map((child: ChildUser) => (
                <tr key={child.id} className="hover:bg-cyber-dark/30">
                  <td className="py-3 px-4 text-gray-200">{child.name}</td>
                  <td className="py-3 px-4 text-gray-400">{child.email}</td>
                  <td className="py-3 px-4">
                    <RoleBadge role={child.role} />
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(child.created_at).toLocaleDateString('th-TH')}
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {child.last_login_at
                      ? new Date(child.last_login_at).toLocaleDateString('th-TH')
                      : '-'
                    }
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleDelete(child.id)}
                      disabled={deleting === child.id}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="ลบ"
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
      )}
    </div>
  )
}

// Role Badge
function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    ADMIN: 'bg-cyber-green/20 text-cyber-green',
    MANAGER: 'bg-cyber-primary/20 text-cyber-primary',
    USER: 'bg-blue-500/20 text-blue-400',
    VIEWER: 'bg-gray-500/20 text-gray-400',
  }

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[role] || colors.USER}`}>
      {role}
    </span>
  )
}

// Add Child Modal
function AddChildModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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
      setError('กรุณากรอกข้อมูลให้ครบ')
      return
    }

    setSaving(true)
    const result = await createChildUser(form.email, form.password, form.name, form.role)
    setSaving(false)

    if (result.success) {
      onSuccess()
    } else {
      setError(result.message || 'สร้างไม่สำเร็จ')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-md"
      >
        <div className="p-6 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-100">เพิ่มผู้ใช้งานลูก</h2>
          <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-2">ชื่อ</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="cyber-input w-full"
              placeholder="ชื่อผู้ใช้งาน"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">อีเมล</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="cyber-input w-full"
              placeholder="email@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">รหัสผ่าน</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="cyber-input w-full"
              placeholder="รหัสผ่าน"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">สิทธิ์</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="cyber-input w-full"
            >
              <option value="USER">User - ผู้ใช้งานทั่วไป</option>
              <option value="MANAGER">Manager - ผู้จัดการ</option>
              <option value="VIEWER">Viewer - ดูอย่างเดียว</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:bg-cyber-dark"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="cyber-btn-primary flex items-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              สร้างผู้ใช้งาน
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// Security Settings
function SecuritySettings() {
  return (
    <div className="space-y-6">
      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-cyber-primary" />
          เปลี่ยนรหัสผ่าน
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          ฟีเจอร์นี้จะพร้อมใช้งานในเร็วๆ นี้
        </p>
        <button disabled className="cyber-btn-primary opacity-50 cursor-not-allowed">
          เปลี่ยนรหัสผ่าน
        </button>
      </div>

      <div className="cyber-card p-6">
        <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyber-primary" />
          การยืนยันตัวตนแบบ 2 ชั้น (2FA)
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          เพิ่มความปลอดภัยด้วยการยืนยันตัวตนแบบ 2 ชั้น
        </p>
        <button disabled className="cyber-btn-primary opacity-50 cursor-not-allowed">
          เปิดใช้งาน 2FA
        </button>
      </div>
    </div>
  )
}
