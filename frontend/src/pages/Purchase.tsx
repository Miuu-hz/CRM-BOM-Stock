import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  LayoutList,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { accountsApi, type Account } from '../services/accounting'
import { stockService } from '../services/stock'
import { printBill } from '../utils/printBill'
import toast from 'react-hot-toast'
import { useApprovalGate } from '../components/common/ApprovalGate'
import { PaymentAttachments } from '../components/common/PaymentAttachments'
import { useModalClose } from '../hooks/useModalClose'
import { UnitPicker } from '../components/common/UnitPicker'
import { normalizeUnit } from '../utils/unitNormalize'
import { unitLabel as unitLabelFor, invalidateUnitsCache } from '../hooks/useUnits'

// Types
interface Supplier {
  id: string
  code: string
  name: string
  tax_id?: string
  phone?: string
  email?: string
}

interface Material {
  id: string
  code: string
  name: string
  unit: string
  baseUnit?: string
  currentStock?: number
  stockStatus?: string
  unitCost?: number
}

// รายการเดียวในฟีด "ความเคลื่อนไหวล่าสุด" — มาจากคิวรี UNION ฝั่ง backend
// party ของใบขอซื้อคือแผนก ไม่ใช่ผู้ขาย (ใบขอซื้อยังไม่มีผู้ขาย) · amount เป็น null ได้ (ใบรับของ)
interface PurchaseActivity {
  kind: 'PR' | 'PO' | 'GR' | 'INV' | 'PAY'
  id: string
  doc: string
  party: string | null
  amount: number | null
  status: string
  updated_at: string
}

interface PurchaseSummary {
  recentActivity?: PurchaseActivity[]
  purchaseRequests: { total: number; draft: number; pending: number; approved: number; totalAmount: number }
  purchaseOrders: { total: number; draft: number; pending: number; received: number; partial: number; totalAmount: number }
  goodsReceipts: { confirmed: number }
  invoices: { total: number; unpaid: number; partial: number; paid: number; totalInvoiced: number; outstanding: number }
  payments: { total: number; totalPaid: number; totalWHT: number }
  returns: { total: number; totalAmount: number }
}

interface PurchaseRequest {
  id: string
  pr_number: string
  requester_name: string
  department: string
  request_date: string
  required_date: string
  total_amount: number
  status: string
  priority: string
  notes: string
  item_count?: number
  items?: any[]
  source?: string
  supplier_name?: string
}

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  order_date: string
  expected_date: string
  received_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  status: string
  notes: string
  linked_pr_id?: string
  item_count?: number
  items?: any[]
}

interface GoodsReceipt {
  id: string
  gr_number: string
  purchase_order_id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  receipt_date: string
  received_by: string
  status: string
  notes: string
  item_count?: number
  items?: any[]
  journal_entry_id?: string
  journal_entry_number?: string
  invoiced_at?: string | null
}

interface PurchaseInvoice {
  id: string
  pi_number: string
  supplier_invoice_number: string
  purchase_order_id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  invoice_date: string
  due_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: string
  payment_status: string
  notes: string
  goods_receipt_id?: string
  // ใบสั่งซื้อทุกใบที่รวมอยู่ในบิลนี้ เก็บเป็น JSON array — purchase_order_id เป็นใบแรกในลิสต์
  purchase_order_ids?: string | null
  goods_receipt_ids?: string
  journal_entry_id?: string
  journal_entry_number?: string
}

interface SupplierPayment {
  id: string
  payment_number: string
  supplier_id: string
  supplier_name: string
  purchase_invoice_id: string
  pi_number: string
  payment_date: string
  payment_method: string
  payment_reference: string
  amount: number
  withholding_tax: number
  net_amount: number
  notes: string
  journal_entry_id?: string
  journal_entry_number?: string
}

interface PurchaseReturn {
  id: string
  pr_number: string
  purchase_order_id: string
  po_number: string
  goods_receipt_id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  return_date: string
  reason: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  status: string
  notes: string
}

interface RequestItem {
  id?: string
  material_id: string
  description: string
  quantity: number
  unit: string
  estimated_unit_price: number
  estimated_total_price: number
  notes: string
}

interface OrderItem {
  id?: string
  material_id: string
  description: string
  quantity: number
  unit: string
  unit_price: number
  total_price: number
  received_qty?: number
  notes: string
}

interface ReceiptItem {
  id?: string
  purchase_order_item_id: string
  material_id: string
  description: string
  material_name?: string
  unit: string
  unit_price: number
  ordered_qty: number
  already_received_qty: number  // sum from previous GRs
  pending_qty: number           // ordered - already received
  received_qty: number          // this GR
  accepted_qty: number          // accepted into stock
  rejected_qty: number          // rejected / damaged
  lot_number: string            // * batch/lot tracking
  location: string              // storage location
  notes: string
}

interface ReturnItem {
  id?: string
  material_id: string
  quantity: number
  unit: string
  unit_price: number
  total_price: number
  reason: string
}

// ─── Module-level helpers (stable refs — no re-creation on parent re-render) ──

const formatCurrency = (amount: number) => `฿${(amount || 0).toLocaleString('th-TH')}`

function ModalShell({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode
}) {
  useModalClose(onClose)
  return (
  <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      onClick={e => e.stopPropagation()}
      className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] w-full max-w-4xl max-h-[90vh] flex flex-col">
      <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold text-[var(--fg-1)]">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto modal-scroll p-5 space-y-4 flex-1">{children}</div>
      <div className="p-5 border-t border-[var(--border)] shrink-0">{footer}</div>
    </motion.div>
  </div>
  )
}

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">
      {label}{required && <span className="text-danger ml-1">*</span>}
    </label>
    {children}
  </div>
)

const inputCls = (disabled?: boolean) =>
  `w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

// ปุ่มชุดมาตรฐานของทุกโมดัลสร้างเอกสาร: "บันทึกร่าง" + "ส่งขออนุมัติ ▾" โดยทางลัด
// "ส่งและอนุมัติเลย" อยู่ในเมนูย่อย — เทาพร้อมเหตุผลเสมอเมื่อกดไม่ได้ (ไม่ซ่อนหาย)
const SubmitSplitButton = ({
  primaryLabel, primaryDisabled, loading, onPrimary,
  approveLabel, approveEnabled, approveReason, onApprove,
  menuOpen, onToggleMenu, moreOptionsLabel,
}: {
  primaryLabel: string; primaryDisabled: boolean; loading: boolean; onPrimary: () => void
  approveLabel: string; approveEnabled: boolean; approveReason: string; onApprove: () => void
  menuOpen: boolean; onToggleMenu: () => void; moreOptionsLabel: string
}) => (
  <div className="relative flex items-stretch">
    <button onClick={onPrimary} disabled={primaryDisabled}
      className="relative z-30 flex items-center gap-2 pl-5 pr-4 min-h-[44px] bg-phopy-indigo text-white font-semibold rounded-l-xl hover:bg-phopy-indigo/80 disabled:opacity-50 text-sm">
      {loading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {primaryLabel}
    </button>
    <button type="button" onClick={onToggleMenu} disabled={primaryDisabled}
      aria-label={moreOptionsLabel} aria-expanded={menuOpen}
      className="relative z-30 flex items-center justify-center w-11 min-h-[44px] bg-phopy-indigo text-white rounded-r-xl border-l border-white/25 hover:bg-phopy-indigo/80 disabled:opacity-50">
      <ChevronDown className="w-4 h-4" />
    </button>
    {menuOpen && (
      <>
        <div className="fixed inset-0 z-20" onClick={onToggleMenu} />
        <div role="menu" className="absolute bottom-full right-0 mb-2 w-72 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden z-30">
          <button role="menuitem" type="button" onClick={onApprove} disabled={!approveEnabled}
            className={`block w-full text-left px-4 py-3 transition-colors ${approveEnabled ? 'text-success hover:bg-[var(--success-soft)]' : 'text-[var(--fg-4)] cursor-not-allowed'}`}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Check className="w-3.5 h-3.5" /> {approveLabel}
            </span>
            <p className="mt-1 ml-5 text-xs leading-snug opacity-90">{approveReason}</p>
          </button>
        </div>
      </>
    )}
  </div>
)

const MaterialSearchInput = ({ materials, value, onChange, disabled = false, onAddNew }: {
  materials: Material[]; value: string; onChange: (id: string, mat?: Material) => void; disabled?: boolean
  onAddNew?: (query: string) => void
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = materials.find(m => m.id === value)
  const filtered = materials.filter(m =>
    !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.code.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.code} · ${selected.name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          disabled={disabled}
          placeholder={t('purchase.search.materialPlaceholder')}
          className={`w-full pl-8 pr-7 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-[var(--fg-4)] mb-2">{t('purchase.search.noMaterialFound', { query })}</p>
              {onAddNew && (
                <button onMouseDown={() => { onAddNew(query); setOpen(false) }}
                  className="flex items-center gap-1.5 mx-auto px-3 py-1.5 text-xs bg-success/15 text-success border border-success/30 rounded-lg hover:bg-success/25 transition-colors">
                  <Plus className="w-3 h-3" /> {t('purchase.search.createMaterial')}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border)]/50 text-xs text-[var(--fg-4)] flex items-center justify-between">
                <span>{t('purchase.common.countItems', { count: filtered.length })}</span>
                {onAddNew && (
                  <button onMouseDown={() => { onAddNew(query); setOpen(false) }}
                    className="flex items-center gap-1 text-success hover:text-success/80 transition-colors">
                    <Plus className="w-3 h-3" /> {t('purchase.search.newMaterial')}
                  </button>
                )}
              </div>
              {filtered.map(m => (
                <button key={m.id} onMouseDown={() => { onChange(m.id, m); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg)] text-left transition-colors ${value === m.id ? 'bg-phopy-indigo/10' : ''}`}>
                  <span className="text-xs font-mono text-[var(--primary)] w-20 shrink-0">{m.code}</span>
                  <span className="text-sm text-[var(--fg-1)] flex-1 truncate">{m.name}</span>
                  <span className="text-xs text-[var(--fg-4)] shrink-0">{unitLabelFor(m.unit)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                    m.stockStatus === 'ADEQUATE' ? 'text-success bg-[var(--success-soft)]' :
                    m.stockStatus === 'OVERSTOCK' ? 'text-blue-400 bg-blue-400/10' :
                    m.stockStatus === 'LOW' ? 'text-warning bg-[var(--warning-soft)]' :
                    m.stockStatus === 'CRITICAL' ? 'text-danger bg-[var(--danger-soft)]' :
                    'text-[var(--fg-4)] bg-gray-500/10'
                  }`}>
                    {m.currentStock ?? 0} {unitLabelFor(m.unit)}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const SupplierSearchInput = ({ suppliers, value, onChange, disabled = false, placeholder }: {
  suppliers: Supplier[]; value: string; onChange: (id: string) => void; disabled?: boolean; placeholder?: string
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = suppliers.find(s => s.id === value)
  const filtered = suppliers.filter(s =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.code.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.code} · ${selected.name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={placeholder ?? t('purchase.search.supplierPlaceholder')}
          className={`w-full pl-8 pr-7 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--fg-4)] text-center">{t('purchase.search.noSupplierFound')}</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border)]/50 text-xs text-[var(--fg-4)]">{t('purchase.search.supplierCount', { count: filtered.length })}</div>
              {filtered.map(s => (
                <button key={s.id} onMouseDown={() => { onChange(s.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg)] text-left transition-colors ${value === s.id ? 'bg-phopy-indigo/10' : ''}`}>
                  <span className="text-xs font-mono text-[var(--primary)] w-24 shrink-0">{s.code}</span>
                  <span className="text-sm text-[var(--fg-1)] flex-1 truncate">{s.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const POSearchInput = ({ orders, value, onChange, disabled = false, emptyMessage }: {
  orders: PurchaseOrder[]; value: string; onChange: (id: string) => void; disabled?: boolean; emptyMessage?: string
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = orders.find(o => o.id === value)
  const filtered = orders.filter(o =>
    !query || o.po_number.toLowerCase().includes(query.toLowerCase()) ||
    (o.supplier_name || '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.po_number} — ${selected.supplier_name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={t('purchase.search.poPlaceholder')}
          className={`w-full pl-8 pr-7 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--fg-4)] text-center">{emptyMessage ?? t('purchase.search.noOrderFound')}</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border)]/50 text-xs text-[var(--fg-4)]">{t('purchase.common.countItems', { count: filtered.length })}</div>
              {filtered.map(o => (
                <button key={o.id} onMouseDown={() => { onChange(o.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg)] text-left transition-colors ${value === o.id ? 'bg-phopy-indigo/10' : ''}`}>
                  <span className="text-xs font-mono text-[var(--primary)] w-28 shrink-0">{o.po_number}</span>
                  <span className="text-sm text-[var(--fg-1)] flex-1 truncate">{o.supplier_name}</span>
                  <span className="text-xs text-[var(--fg-4)] shrink-0">{o.status === 'RECEIVED' ? t('purchase.poStatus.received') : o.status === 'PARTIAL' ? t('purchase.poStatus.partial') : t('purchase.poStatus.pending')}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const GRSearchInput = ({ receipts, values, onChange, disabled = false }: {
  receipts: GoodsReceipt[]; values: string[]; onChange: (ids: string[]) => void; disabled?: boolean
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selectedItems = values.map(id => receipts.find(r => r.id === id)).filter(Boolean) as GoodsReceipt[]
  const filtered = receipts.filter(r =>
    !values.includes(r.id) && (
      !query || r.gr_number.toLowerCase().includes(query.toLowerCase()) ||
      (r.supplier_name || '').toLowerCase().includes(query.toLowerCase()) ||
      (r.po_number || '').toLowerCase().includes(query.toLowerCase())
    )
  ).slice(0, 30)
  const removeItem = (id: string) => onChange(values.filter(v => v !== id))
  return (
    <div className="relative space-y-2">
      {/* Selected GR tags */}
      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedItems.map(r => (
            <span key={r.id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-success/15 border border-success/30 rounded-lg text-xs text-success">
              <span className="font-mono">{r.gr_number}</span>
              {!disabled && (
                <button onMouseDown={() => removeItem(r.id)} className="hover:text-[var(--fg-1)]">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {/* Search input */}
      {!disabled && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
          <input type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={t('purchase.search.grPlaceholder')}
            className="w-full pl-8 pr-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo"
          />
        </div>
      )}
      {disabled && selectedItems.length === 0 && (
        <p className="text-xs text-[var(--fg-4)] py-2">{t('purchase.search.selectPOFirst')}</p>
      )}
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--fg-4)] text-center">
              {values.length > 0 ? t('purchase.search.allGRsAdded') : t('purchase.search.noReceiptFound')}
            </p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border)]/50 text-xs text-[var(--fg-4)]">{t('purchase.search.grCountHint', { count: filtered.length })}</div>
              {filtered.map(r => (
                <button key={r.id} onMouseDown={() => { onChange([...values, r.id]); setQuery(''); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg)] text-left transition-colors">
                  <span className="text-xs font-mono text-success w-32 shrink-0">{r.gr_number}</span>
                  <span className="text-xs text-[var(--fg-3)] flex-1 truncate">PO: {r.po_number}</span>
                  <span className={`text-xs shrink-0 ${r.status === 'CONFIRMED' ? 'text-success' : 'text-warning'}`}>
                    {r.status === 'CONFIRMED' ? t('purchase.grStatus.confirmed') : t('purchase.grStatus.draft')}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const PRSearchInput = ({ requests, value, onChange, disabled = false }: {
  requests: PurchaseRequest[]; value: string; onChange: (id: string, pr?: PurchaseRequest) => void; disabled?: boolean
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = requests.find(r => r.id === value)
  const filtered = requests.filter(r =>
    !query || r.pr_number.toLowerCase().includes(query.toLowerCase()) ||
    (r.requester_name || '').toLowerCase().includes(query.toLowerCase()) ||
    (r.department || '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.pr_number} · ${selected.requester_name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={t('purchase.search.prPlaceholder')}
          className={`w-full pl-8 pr-7 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('', undefined)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--fg-4)] text-center">{t('purchase.search.noRequestFound')}</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border)]/50 text-xs text-[var(--fg-4)]">{t('purchase.common.countItems', { count: filtered.length })}</div>
              {filtered.map(r => (
                <button key={r.id} onMouseDown={() => { onChange(r.id, r); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg)] text-left transition-colors ${value === r.id ? 'bg-phopy-indigo/10' : ''}`}>
                  <span className="text-xs font-mono text-[var(--primary)] w-28 shrink-0">{r.pr_number}</span>
                  <span className="text-sm text-[var(--fg-1)] flex-1 truncate">{r.requester_name}</span>
                  <span className={`text-xs shrink-0 px-1.5 py-0.5 rounded-full ${
                    r.status === 'APPROVED' ? 'text-success bg-[var(--success-soft)]' :
                    r.status === 'PENDING' ? 'text-blue-400 bg-blue-500/10' :
                    'text-[var(--fg-4)] bg-gray-500/10'
                  }`}>{
                    r.status === 'APPROVED' ? t('purchase.prStatus.approved') :
                    r.status === 'PENDING' ? t('purchase.prStatus.pending') : t('purchase.prStatus.draft')
                  }</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// หัวข้อบอกขั้นตอนในโมดัล — เดิมทุกช่องกองรวมกันจนไม่รู้ว่าต้องกรอกอะไรก่อนหลัง
const StepHead = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
  <div className="flex items-baseline gap-2.5 pt-1">
    <span className="shrink-0 w-5 h-5 rounded-full bg-phopy-indigo/15 text-[var(--primary)] text-[11px] font-bold flex items-center justify-center">{n}</span>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-[var(--fg-1)] leading-tight">{title}</h3>
      {hint && <p className="text-xs text-[var(--fg-4)] mt-0.5">{hint}</p>}
    </div>
  </div>
)

const JournalPreview = ({ entries }: { entries: { dr?: boolean; account: string; label: string; amount?: number }[] }) => {
  const { t } = useTranslation()
  return (
  <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-1">
    <p className="text-xs text-warning font-medium mb-2">{t('purchase.journal.title')}</p>
    {entries.map((e, i) => (
      <div key={i} className={`flex items-center gap-2 text-xs ${e.dr ? '' : 'pl-6'}`}>
        <span className={`font-mono w-14 shrink-0 ${e.dr ? 'text-blue-400' : 'text-danger'}`}>{e.dr ? t('purchase.journal.debit') : t('purchase.journal.credit')}</span>
        <span className="text-[var(--fg-2)] flex-1">{e.account}</span>
        <span className="text-[var(--fg-3)]">{e.label}</span>
        {e.amount !== undefined && <span className="text-[var(--fg-1)] font-medium">{formatCurrency(e.amount)}</span>}
      </div>
    ))}
  </div>
  )
}

// Quick-add supplier mini-modal (module level — stable reference)
const QuickAddSupplierModal = ({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (supplier: { id: string; code: string; name: string }) => void
}) => {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [form, setForm] = useState({ code: `SUP-${Date.now().toString().slice(-4)}`, name: '', contactName: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!form.name.trim() || !form.contactName.trim()) { setErr(t('purchase.quickAddSupplier.validation')); return }
    setSaving(true); setErr('')
    try {
      const { data } = await api.post('/suppliers', { code: form.code, name: form.name, contactName: form.contactName, phone: form.phone, email: form.email })
      if (data.success) { onCreated(data.data); onClose() }
      else setErr(data.message || t('purchase.error.generic'))
    } catch (e: any) { setErr(e.response?.data?.message || t('purchase.error.generic')) }
    setSaving(false)
  }
  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-[var(--fg-1)] font-semibold text-sm">{t('purchase.quickAddSupplier.title')}</h3>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <p className="text-xs text-danger bg-[var(--danger-soft)] rounded-lg px-3 py-2">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddSupplier.code')}</label>
              <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddSupplier.companyName')} <span className="text-danger">*</span></label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder={t('purchase.quickAddSupplier.companyPlaceholder')}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddSupplier.contactName')} <span className="text-danger">*</span></label>
            <input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))}
              placeholder={t('purchase.quickAddSupplier.contactPlaceholder')}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddSupplier.phone')}</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder={t('purchase.quickAddSupplier.phonePlaceholder')}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddSupplier.email')}</label>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder={t('purchase.quickAddSupplier.emailPlaceholder')}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
            </div>
          </div>
          <p className="text-xs text-[var(--fg-4)]">{t('purchase.quickAddSupplier.hint')}</p>
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]">{t('purchase.common.cancel')}</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2">
            {saving && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {t('purchase.common.save')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

const QuickAddStockItemModal = ({ onClose, onCreated, prefill }: {
  onClose: () => void
  onCreated: (item: { id: string; code: string; name: string; unit: string; unitCost: number }) => void
  prefill?: { name?: string; unitCost?: number }
}) => {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [form, setForm] = useState({
    sku: `SKU-${Date.now().toString().slice(-5)}`,
    name: prefill?.name || '',
    category: 'raw',
    unit: 'pcs',
    unitCost: prefill?.unitCost || 0,
    unitPrice: 0,
    minStock: 10,
    maxStock: 100,
    location: '',
    quantity: 0,
    // Packaging: opt-in, so an item bought loose keeps the original payload.
    hasPackaging: false,
    displayUnit: '',
    baseUnit: '',
    packFactor: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [suggestedFactor, setSuggestedFactor] = useState<number | null>(null)

  const unitLabel = (u: string) => unitLabelFor(u)

  // Offer the international rate (1 kg = 1000 g) so the common case is one
  // click, while still letting a pack of eggs override it with 30.
  useEffect(() => {
    if (!form.hasPackaging || !form.displayUnit || !form.baseUnit) return
    if (normalizeUnit(form.displayUnit) === normalizeUnit(form.baseUnit)) return
    let cancelled = false
    api.post('/materials/unit-conversions/check-path', { from_unit: form.displayUnit, to_unit: form.baseUnit })
      .then(res => {
        const d = res.data?.data ?? res.data
        if (cancelled || !d?.found || !(d.factor > 0)) { if (!cancelled) setSuggestedFactor(null); return }
        setSuggestedFactor(d.factor)
        setForm(p => (p.packFactor === '' ? { ...p, packFactor: String(d.factor) } : p))
      })
      .catch(() => { if (!cancelled) setSuggestedFactor(null) })
    return () => { cancelled = true }
  }, [form.hasPackaging, form.displayUnit, form.baseUnit])

  const save = async () => {
    if (!form.sku.trim() || !form.name.trim()) { setErr(t('purchase.quickAddStock.validation')); return }
    if (form.hasPackaging) {
      const f = Number(form.packFactor)
      if (!form.displayUnit || !form.baseUnit) { setErr(t('purchase.quickAddStock.packaging.needUnits')); return }
      if (normalizeUnit(form.displayUnit) === normalizeUnit(form.baseUnit)) { setErr(t('purchase.quickAddStock.packaging.sameUnit')); return }
      if (!Number.isFinite(f) || f <= 0) { setErr(t('purchase.quickAddStock.packaging.needFactor')); return }
    }
    setSaving(true); setErr('')
    try {
      const packFactor = Number(form.packFactor)
      const created = await stockService.create({
        sku: form.sku,
        name: form.name,
        category: form.category,
        unit: form.unit,
        // With packaging on, stock is held in the smallest unit and received in
        // the pack unit — that pairing is what lets the system unpack later.
        ...(form.hasPackaging ? { baseUnit: form.baseUnit, saleUnit: form.baseUnit, displayUnit: form.displayUnit } : {}),
        unitCost: form.unitCost || undefined,
        unitPrice: form.unitPrice || undefined,
        minStock: form.minStock,
        maxStock: form.maxStock,
        location: form.location || 'Main Warehouse',
        quantity: form.quantity,
      })

      if (form.hasPackaging) {
        // The item exists at this point. If the rate fails to save, say so loudly
        // rather than leaving an item that silently cannot be unpacked.
        try {
          await api.post('/materials/unit-conversions', {
            material_id: created.id,
            from_unit: form.displayUnit,
            to_unit: form.baseUnit,
            conversion_factor: packFactor,
            notes: `1 ${unitLabel(form.displayUnit)} = ${packFactor} ${unitLabel(form.baseUnit)}`,
          })
          invalidateUnitsCache()
        } catch (convErr: any) {
          toast.error(
            `สร้างสินค้าแล้ว แต่บันทึกหน่วยย่อยไม่สำเร็จ — ตั้งค่าเองได้ที่ ตั้งค่า > การแปลงหน่วย (${convErr?.response?.data?.message || convErr?.message || ""})`,
            { duration: 8000 }
          )
        }
      }

      onCreated({ id: created.id, code: created.sku, name: created.name, unit: created.unit, unitCost: created.unitCost || form.unitCost || 0 })
      onClose()
    } catch (e: any) {
      setErr(e.response?.data?.message || t('purchase.quickAddStock.error'))
    }
    setSaving(false)
  }

  const inp = 'w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo'

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="text-[var(--fg-1)] font-semibold text-sm flex items-center gap-2">
              <Package className="w-4 h-4 text-success" />
              {t('purchase.quickAddStock.title')}
            </h3>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('purchase.quickAddStock.subtitle')}</p>
          </div>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {err && <p className="text-xs text-danger bg-[var(--danger-soft)] rounded-lg px-3 py-2">{err}</p>}

          {/* SKU + ชื่อสินค้า */}
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.sku')} <span className="text-danger">*</span></label>
              <input value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))}
                placeholder={t('purchase.quickAddStock.skuPlaceholder')} className={inp} />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.name')} <span className="text-danger">*</span></label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder={t('purchase.quickAddStock.namePlaceholder')} className={inp} />
            </div>
          </div>

          {/* ประเภท + หน่วย */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.category')}</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                <option value="raw">{t('purchase.quickAddStock.categoryRaw')}</option>
                <option value="wip">{t('purchase.quickAddStock.categoryWip')}</option>
                <option value="finished">{t('purchase.quickAddStock.categoryFinished')}</option>
                <option value="material">{t('purchase.quickAddStock.categoryMaterial')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.common.unit')}</label>
              <UnitPicker
                value={form.unit}
                onChange={u => setForm(p => ({ ...p, unit: u }))}
                materialId={null}
              />
            </div>
          </div>

          {/* หน่วยย่อย — ปิดไว้เป็นค่าเริ่มต้น ฟอร์มจึงเหมือนเดิมถ้าไม่ต้องการ */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)]/40 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hasPackaging}
                onChange={e => setForm(p => ({ ...p, hasPackaging: e.target.checked }))}
                className="w-4 h-4 accent-[var(--primary)]"
              />
              <span className="text-xs text-[var(--fg-2)] font-medium">{t('purchase.quickAddStock.packaging.toggle')}</span>
            </label>

            {form.hasPackaging && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-3 space-y-3 overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.packaging.displayUnit')}</label>
                    <UnitPicker value={form.displayUnit} onChange={u => setForm(p => ({ ...p, displayUnit: u, packFactor: '' }))} materialId={null} />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.packaging.baseUnit')}</label>
                    <UnitPicker value={form.baseUnit} onChange={u => setForm(p => ({ ...p, baseUnit: u, packFactor: '' }))} materialId={null} />
                  </div>
                </div>

                {form.displayUnit && form.baseUnit && (
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">
                      1 {unitLabel(form.displayUnit)} = ? {unitLabel(form.baseUnit)}
                    </label>
                    <input
                      type="number" min="0" step="any" value={form.packFactor}
                      onChange={e => setForm(p => ({ ...p, packFactor: e.target.value }))}
                      onFocus={e => e.target.select()} className={inp} placeholder="30" />
                    {suggestedFactor !== null && (
                      <p className="text-[11px] text-[var(--fg-4)] mt-1">
                        {t('purchase.quickAddStock.packaging.suggested', { factor: suggestedFactor })}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--fg-4)] mt-1">
                      {t('purchase.quickAddStock.packaging.effect', { base: unitLabel(form.baseUnit), display: unitLabel(form.displayUnit) })}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* ราคาต้นทุน + ราคาขาย */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.unitCost')} <span className="text-amber-400/70">{t('purchase.quickAddStock.costLabel')}</span></label>
              <input type="number" min="0" step="0.01" value={form.unitCost}
                onChange={e => setForm(p => ({ ...p, unitCost: parseFloat(e.target.value) || 0 }))}
                onFocus={e => e.target.select()} className={inp} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.unitPrice')} <span className="text-success/70">{t('purchase.quickAddStock.saleLabel')}</span></label>
              <input type="number" min="0" step="0.01" value={form.unitPrice}
                onChange={e => setForm(p => ({ ...p, unitPrice: parseFloat(e.target.value) || 0 }))}
                onFocus={e => e.target.select()} className={inp} placeholder="0.00" />
            </div>
          </div>

          {/* Min/Max + จำนวนเริ่มต้น */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.minStock')}</label>
              <input type="number" min="0" value={form.minStock}
                onChange={e => setForm(p => ({ ...p, minStock: parseInt(e.target.value) || 0 }))}
                onFocus={e => e.target.select()} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.maxStock')}</label>
              <input type="number" min="0" value={form.maxStock}
                onChange={e => setForm(p => ({ ...p, maxStock: parseInt(e.target.value) || 0 }))}
                onFocus={e => e.target.select()} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.initialQty')}</label>
              <input type="number" min="0" value={form.quantity}
                onChange={e => setForm(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))}
                onFocus={e => e.target.select()} className={inp} />
            </div>
          </div>

          {/* สถานที่เก็บ */}
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">{t('purchase.quickAddStock.location')}</label>
            <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
              placeholder={t('purchase.quickAddStock.locationPlaceholder')} className={inp} />
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]">{t('purchase.common.cancel')}</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 text-sm bg-success text-white font-semibold rounded-lg hover:bg-success/80 disabled:opacity-50 flex items-center gap-2">
            {saving && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {t('purchase.quickAddStock.save')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── แถบสถานะใบสั่งซื้อ ───────────────────────────────────────────────────────
// เห็นทีเดียวว่าใบนี้เดินมาถึงไหน แบบเดียวกับ Status Flow ของใบสั่งขาย
// ป้ายและปลายทางของแต่ละชนิดเอกสารในฟีดความเคลื่อนไหว
const ACTIVITY_TARGET: Record<string, { tab: string; modal: string; labelKey: string; tone: string }> = {
  PR:  { tab: 'requests', modal: 'request', labelKey: 'purchase.tabs.requests', tone: 'bg-phopy-indigo/10 text-[var(--primary)] border-phopy-indigo/30' },
  PO:  { tab: 'orders',   modal: 'order',   labelKey: 'purchase.tabs.orders',   tone: 'bg-purple-500/10 text-purple-500 border-purple-500/30' },
  GR:  { tab: 'receipts', modal: 'receipt', labelKey: 'purchase.tabs.receipts', tone: 'bg-[var(--success-soft)] text-success border-success/30' },
  INV: { tab: 'invoices', modal: 'invoice', labelKey: 'purchase.tabs.invoices', tone: 'bg-[var(--warning-soft)] text-warning border-warning/30' },
  PAY: { tab: 'payments', modal: 'payment', labelKey: 'purchase.tabs.payments', tone: 'bg-[var(--info-soft)] text-info border-info/30' },
}

const PO_FLOW = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIAL', 'RECEIVED'] as const

const POStatusFlow = ({ status }: { status: string }) => {
  const { t } = useTranslation()
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--danger-soft)] border border-danger/30">
        <Ban className="w-4 h-4 text-danger shrink-0" />
        <span className="text-sm font-medium text-danger">{t('purchase.trail.cancelled')}</span>
      </div>
    )
  }
  // รับครบโดยไม่เคยผ่านรับบางส่วน = ข้ามขั้นนั้นไป ไม่ใช่ค้าง
  const currentIdx = PO_FLOW.indexOf(status as any)
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {PO_FLOW.map((step, i) => {
        const isPast = currentIdx >= 0 && i < currentIdx
        const isCurrent = i === currentIdx
        const skipped = step === 'PARTIAL' && status === 'RECEIVED'
        return (
          <div key={step} className="flex items-center gap-1 shrink-0">
            <div className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isCurrent ? 'bg-phopy-indigo text-white' : skipped ? 'bg-[var(--surface-2)] text-[var(--fg-4)] line-through' : isPast ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'}`}>
              {t(`purchase.trail.step.${step}`)}
            </div>
            {i < PO_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

// ─── เส้นทางเอกสารของใบสั่งซื้อใบนี้ ───────────────────────────────────────────
// ใบขอซื้อ → ใบสั่งซื้อ → รับสินค้า → ใบแจ้งหนี้ → จ่ายเงิน (+ คืนสินค้าถ้ามี)
// ใช้ซ้ำได้ทุกโมดัลย่อย จะได้รู้ตลอดว่ากำลังยืนอยู่ตรงไหนของสาย
// "เมื่อ 2 ชม.ที่แล้ว" — ใช้ Intl.RelativeTimeFormat ที่มีในเบราว์เซอร์อยู่แล้ว ไม่ต้องลง lib
const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86400000], ['hour', 3600000], ['minute', 60000],
  ]
  const rtf = new Intl.RelativeTimeFormat('th-TH', { numeric: 'auto', style: 'narrow' })
  for (const [unit, size] of units) {
    if (Math.abs(ms) >= size) return rtf.format(-Math.round(ms / size), unit)
  }
  return rtf.format(0, 'minute')
}

const PurchaseTrail = ({ poId }: { poId: string }) => {
  const { t } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!poId) { setLoading(false); return }
    let alive = true
    setLoading(true)
    api.get(`/purchase/doc-trail/${poId}`)
      .then(r => { if (alive) setData(r.data.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [poId])

  if (!poId) return null
  if (loading) return <div className="h-24 rounded-xl bg-[var(--surface-2)] animate-pulse" />
  if (!data) return null

  const fmtB = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`

  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold text-[var(--fg-2)]">{t('purchase.trail.title')}</p>
        {data.summary?.outstanding > 0.01 && (
          <p className="text-[11px] text-warning">{t('purchase.trail.outstanding', { amount: fmtB(data.summary.outstanding) })}</p>
        )}
      </div>
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {data.stages.map((stage: any, i: number) => {
          const tone = stage.done
            ? 'border-success/30 bg-[var(--success-soft)]'
            : stage.partial
              ? 'border-warning/30 bg-[var(--warning-soft)]'
              : stage.skipped
                ? 'border-dashed border-[var(--border)] bg-transparent'
                : 'border-[var(--border)] bg-[var(--surface-2)]'
          const labelTone = stage.done ? 'text-success' : stage.partial ? 'text-warning' : 'text-[var(--fg-4)]'
          return (
            <div key={stage.key} className="flex items-center gap-1 shrink-0">
              <div className={`min-w-[104px] rounded-lg px-2.5 py-2 border ${tone}`}>
                <div className="flex items-center gap-1">
                  <p className={`text-[10px] font-medium ${labelTone}`}>{t(`purchase.trail.${stage.key}`)}</p>
                  {stage.count > 1 && (
                    <span className="text-[9px] px-1 rounded bg-[var(--surface)] text-[var(--fg-3)] tabular-nums">×{stage.count}</span>
                  )}
                </div>
                <p className="text-[11px] font-mono text-[var(--fg-2)] truncate">
                  {stage.docNumber || (stage.skipped ? t('purchase.trail.skipped') : '—')}
                </p>
                {stage.amount != null && (
                  <p className="text-[11px] font-semibold text-[var(--fg-1)] tabular-nums">{fmtB(stage.amount)}</p>
                )}
              </div>
              {i < data.stages.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// เมนู "..." ท้ายแถว — เก็บปุ่มรอง (พิมพ์/แก้/ลบ/ยกเลิก) ไม่ให้แย่งสายตากับปุ่มขั้นต่อไป
// เงื่อนไขสิทธิ์/สถานะยังเป็นของเดิมทุกข้อ แค่ย้ายที่อยู่ — ไม่ได้เปิดสิทธิ์ให้ใครเพิ่ม
type RowMenuItem = { label: string; onClick: () => void; danger?: boolean }

const RowMenu = ({ items, label }: { items: RowMenuItem[]; label: string }) => {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div className="relative flex justify-end">
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }} aria-label={label} aria-expanded={open}
        className="p-2 rounded-lg text-[var(--fg-4)] hover:text-[var(--fg-1)] hover:bg-[var(--bg)] transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOpen(false) }} />
        <div className="absolute right-0 top-9 z-50 min-w-[168px] py-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xl">
          {items.map(it => (
            <button key={it.label} onClick={e => { e.stopPropagation(); setOpen(false); it.onClick() }}
              className={`w-full text-left px-3 py-2.5 text-xs transition-colors hover:bg-[var(--bg)] ${it.danger ? 'text-danger' : 'text-[var(--fg-2)]'}`}>
              {it.label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  )
}

// แถบ "ไปถึงไหนแล้ว" — ขีดสั้น ๆ บอกว่าใบนี้เดินมาถึงขั้นไหนของสาย
//   เขียว = ผ่านแล้ว · น้ำเงิน = อยู่ตรงนี้ · เทา = ยังไม่ถึง · เทาจาง = ข้ามขั้นนั้นไป
// ใบที่ถูกยกเลิก/ปฏิเสธไม่วาดขีด เพราะมันไม่ได้อยู่บนสายแล้ว — ขึ้นป้ายแดงแทน
type StageView = { stages: string[]; idx: number; skipped?: number[]; dead?: string }
type TrailKind = 'pr' | 'po' | 'gr' | 'inv' | 'pay' | 'ret'

const StagePips = ({ view }: { view: StageView }) => {
  if (view.dead) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--danger-soft)] text-danger text-[11px] font-medium">
        <Ban className="w-3 h-3 shrink-0" />{view.dead}
      </span>
    )
  }
  const last = view.stages.length - 1
  return (
    <div>
      <div className="flex items-center gap-[3px] mb-1">
        {view.stages.map((_, i) => (
          <span key={i} className={`w-[15px] h-1 rounded-sm shrink-0 ${
            view.skipped?.includes(i) ? 'bg-[var(--border)] opacity-40'
              : i < view.idx ? 'bg-success'
                : i === view.idx ? 'bg-phopy-indigo' : 'bg-[var(--border)]'}`} />
        ))}
      </div>
      <span className={`text-[11px] font-medium ${view.idx >= last ? 'text-success' : 'text-[var(--primary)]'}`}>
        {view.stages[view.idx] ?? view.stages[last]}
      </span>
    </div>
  )
}

// ช่อง "ขั้นต่อไป" ของแต่ละแถว — มี 3 หน้าตาเท่านั้น
//   ปุ่ม    = ยังทำได้ กดแล้วเปิดโมดัลสร้างเอกสารใบถัดไป (กรอกให้แล้ว แก้ได้ก่อนยืนยัน)
//   ข้อความ = ทำไปแล้ว บอกว่าไปเป็นใบไหน กดไปดูใบนั้นได้
//   กล่องเทา = ยังทำไม่ได้ พร้อมเหตุผล — ไม่ซ่อนให้ต้องเดา
type NextStep =
  | { kind: 'action'; label: string; onClick: () => void }
  | { kind: 'done'; label: string; docNumber?: string; onClick?: () => void }
  | { kind: 'locked'; label: string }

const NextStepCell = ({ step }: { step: NextStep }) => {
  if (step.kind === 'action') {
    return (
      <button onClick={step.onClick} aria-label={step.label}
        className="flex items-center justify-center gap-1.5 w-full min-h-[40px] px-3 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] border border-phopy-indigo/30 text-xs font-semibold hover:bg-phopy-indigo/15 transition-colors">
        {step.label}
        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
      </button>
    )
  }
  if (step.kind === 'done') {
    const body = (
      <span className="flex items-center justify-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
        <span className="text-xs text-[var(--fg-3)]">{step.label}</span>
        {step.docNumber && <span className="text-xs font-mono text-[var(--primary)]">{step.docNumber}</span>}
      </span>
    )
    return step.onClick
      ? <button onClick={step.onClick} aria-label={`${step.label} ${step.docNumber ?? ''}`}
          className="w-full min-h-[40px] px-3 rounded-lg hover:bg-[var(--bg)] transition-colors">{body}</button>
      : <div className="w-full min-h-[40px] px-3 flex items-center justify-center">{body}</div>
  }
  return (
    <div className="flex items-center justify-center gap-1.5 w-full min-h-[40px] px-3 rounded-lg bg-[var(--surface-2)] border border-dashed border-[var(--border-strong)]">
      <Lock className="w-3 h-3 text-[var(--fg-4)] shrink-0" />
      <span className="text-xs text-[var(--fg-3)] leading-tight">{step.label}</span>
    </div>
  )
}

const Purchase = () => {
  const { t } = useTranslation()
  const { user } = useAuth()
  // Cancel/void of posted documents (GR, PI, supplier payment) reverses journal + stock —
  // gate behind ADMIN/MANAGER/MASTER same as other irreversible accounting actions.
  const canCancelDoc = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'MASTER' || user?.role === 'POWERUSER'
  // เปิดใบสั่งซื้อจากใบขอซื้อ = ผูกพันเงินกับผู้ขาย ใช้เกณฑ์เดียวกับงานที่ย้อนยากอื่น ๆ
  const canMakePO = canCancelDoc
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'orders' | 'receipts' | 'invoices' | 'payments' | 'returns'>('overview')
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  // กางได้ทีละใบ — เก็บ id ใบเดียว จึงยิง doc-trail ครั้งละคำขอเดียว ไม่ถล่ม backend
  const [openRow, setOpenRow] = useState<string | null>(null)
  // ชิปกรองบนแถบค้นหา: ทั้งหมด / รอคุณจัดการ / ค้างจ่าย
  const [rowFilter, setRowFilter] = useState<'all' | 'mine' | 'due'>('all')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [summary, setSummary] = useState<PurchaseSummary | null>(null)
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [returns, setReturns] = useState<PurchaseReturn[]>([])
  // Whole-category badge numbers from GET /purchase/badge-counts — fetched once on
  // mount (not gated behind opening a tab) and refreshed after any mutation via the
  // fetchXxx() helpers below, so every tab shows its pending count immediately.
  const [badgeCounts, setBadgeCounts] = useState({ requests: 0, orders: 0, receipts: 0, invoices: 0, payments: 0, returns: 0, total: 0 })
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false)
  const [quickAddSupplierCallback, setQuickAddSupplierCallback] = useState<((id: string) => void) | null>(null)
  const [showQuickAddStock, setShowQuickAddStock] = useState(false)
  const [quickAddStockPrefill, setQuickAddStockPrefill] = useState<{ name?: string; unitCost?: number } | undefined>()
  const [quickAddStockCallback, setQuickAddStockCallback] = useState<((item: { id: string; code: string; name: string; unit: string; unitCost: number }) => void) | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [drAccounts, setDrAccounts] = useState<Account[]>([])
  // บัญชีหนี้สิน สำหรับเลือกปลายทางของหนี้ (เดิมยึดเจ้าหนี้การค้าตายตัว ปรับไม่ได้)
  const [crAccounts, setCrAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Modal states
  const [modalOpen, setModalOpen] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view'>('create')
  const [modalData, setModalData] = useState<any>(null)
  const approvalGate = useApprovalGate()
  const [formLoading, setFormLoading] = useState(false)

  // Convert PR → PO modal
  const [convertPRId, setConvertPRId] = useState<string | null>(null)
  const [convertForm, setConvertForm] = useState({ supplier_id: '', expected_date: '', notes: '' })
  const [converting, setConverting] = useState(false)

  // Form states
  const [requestForm, setRequestForm] = useState({
    department: '',
    required_date: '',
    priority: 'NORMAL',
    preferred_supplier_id: '',
    notes: '',
    items: [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] as RequestItem[]
  })

  const [orderForm, setOrderForm] = useState({
    supplier_id: '',
    expected_date: '',
    payment_terms: 30,
    discount: 0,
    tax_rate: 7,
    notes: '',
    linked_pr_id: '',
    items: [{ material_id: '', description: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, notes: '' }] as OrderItem[]
  })

  const [receiptForm, setReceiptForm] = useState({
    purchase_order_id: '',
    receipt_date: new Date().toISOString().split('T')[0],
    received_by: user?.email || '',
    delivery_note_no: '',
    notes: '',
    items: [] as ReceiptItem[]
  })

  const [invoiceForm, setInvoiceForm] = useState({
    purchase_order_id: '',
    // ใบสั่งซื้อใบอื่นที่รวมเข้าบิลเดียวกัน — backend บังคับว่าต้องผู้ขายรายเดียวกัน
    extra_po_ids: [] as string[],
    goods_receipt_ids: [] as string[],
    supplier_invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    tax_rate: 7,
    notes: '',
    dr_account_id: '',   // '' = default 1107 สต็อกวัตถุดิบ
    cr_account_id: '',   // '' = default 2101 เจ้าหนี้การค้า
    // view-mode snapshot (populated from invoice data, not from orders state)
    _subtotal: 0,
    _tax_amount: 0,
    _total_amount: 0,
    _supplier_name: '',
    _po_number: '',
    _pi_number: '',
    _paid_amount: 0,
    _balance_amount: 0,
    _payment_status: '',
  })

  const [paymentForm, setPaymentForm] = useState({
    supplier_id: '',
    purchase_invoice_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'TRANSFER',
    payment_reference: '',
    amount: 0,
    withholding_tax: 0,
    notes: ''
  })

  const [returnForm, setReturnForm] = useState({
    purchase_order_id: '',
    goods_receipt_id: '',
    return_date: new Date().toISOString().split('T')[0],
    reason: '',
    tax_rate: 7,
    notes: '',
    items: [{ material_id: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, reason: '' }] as ReturnItem[]
  })

  // Fetch shared reference data once on mount (needed across modals regardless of active tab)
  useEffect(() => {
    fetchSuppliers()
    fetchMaterials()
    fetchOrders()
    fetchReceipts()
    fetchInvoices()
    fetchRequests()
    fetchBadgeCounts()
    // Load ASSET + EXPENSE accounts for DR dropdown in invoice form
    accountsApi.getAll({ active: true }).then(res => {
      if (res.data.success) {
        const list: Account[] = res.data.data.list.filter((a: Account) => a.level >= 2)
        setDrAccounts(list.filter(a => a.type === 'ASSET' || a.type === 'EXPENSE'))
        setCrAccounts(list.filter(a => a.type === 'LIABILITY'))
      }
    }).catch(() => {})
  }, [])

  // Fetch tab-specific list data when switching tabs
  useEffect(() => {
    if (activeTab === 'overview') fetchSummary()
    else if (activeTab === 'requests') fetchRequests()
    else if (activeTab === 'orders') fetchOrders()
    else if (activeTab === 'receipts') fetchReceipts()
    else if (activeTab === 'invoices') fetchInvoices()
    // ต้องโหลดใบแจ้งหนี้ด้วย เพราะใบจ่ายเงินชี้ไปที่ใบแจ้งหนี้ ไม่ได้ชี้ใบสั่งซื้อตรง ๆ
    else if (activeTab === 'payments') { fetchPayments(); fetchInvoices() }
    else if (activeTab === 'returns') fetchReturns()
  }, [activeTab])

  // ปุ่ม "ส่งและอนุมัติเลย" (split button ในโมดัลสร้างเอกสาร) ต้องเทาพร้อมบอกเหตุผลถ้าไม่มีสิทธิ์
  // หรือยอดเกินวงเงิน — เช็คแบบ proactive ก่อนกด ไม่ใช่ปล่อยกดแล้วพังทีหลัง
  // ADMIN/MASTER อนุมัติได้เสมอ (มิเรอร์ APPROVER_ROLES ใน backend/services/approvalGate.service.ts)
  // role อื่นถาม GET /approval/check-required ด้วยยอดจริง เพราะมี auto_approve_threshold ที่ผูกกับยอด
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false)
  const [selfApprove, setSelfApprove] = useState<{ allowed: boolean; loading: boolean; reason: string }>({ allowed: false, loading: false, reason: '' })

  useEffect(() => {
    const isReqCreate = modalOpen === 'request' && modalMode === 'create'
    const isOrdCreate = modalOpen === 'order' && modalMode === 'create'
    if (!isReqCreate && !isOrdCreate) return

    if (user?.role === 'ADMIN' || user?.role === 'MASTER') {
      setSelfApprove({ allowed: true, loading: false, reason: '' })
      return
    }

    const moduleType = isReqCreate ? 'purchase_request' : 'purchase_order'
    const amount = isReqCreate
      ? requestForm.items.reduce((s, i) => s + (i.estimated_total_price || 0), 0)
      : (() => {
          const subtotal = orderForm.items.reduce((s, i) => s + i.total_price, 0)
          const afterDisc = subtotal - (orderForm.discount || 0)
          return afterDisc + afterDisc * (orderForm.tax_rate / 100)
        })()

    let cancelled = false
    setSelfApprove(s => ({ ...s, loading: true }))
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/approval/check-required', { params: { moduleType, amount } })
        if (cancelled) return
        const d = data?.data
        if (!d) { setSelfApprove({ allowed: false, loading: false, reason: t('purchase.selfApprove.checkFailed') }); return }
        if (d.required === false) { setSelfApprove({ allowed: true, loading: false, reason: '' }); return }
        if (!d.userCanApprove) { setSelfApprove({ allowed: false, loading: false, reason: t('purchase.selfApprove.noPermission') }); return }
        if (!d.userWithinLimit) { setSelfApprove({ allowed: false, loading: false, reason: t('purchase.selfApprove.overLimit', { limit: formatCurrency(d.userApprovalLimit || 0) }) }); return }
        setSelfApprove({ allowed: true, loading: false, reason: '' })
      } catch {
        if (!cancelled) setSelfApprove({ allowed: false, loading: false, reason: t('purchase.selfApprove.checkFailed') })
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [modalOpen, modalMode, requestForm.items, orderForm.items, orderForm.discount, orderForm.tax_rate, user?.role])

  const handleApiError = (error: any, defaultMsg: string) => {
    console.error('API Error:', error)
    if (error.status === 401) {
      toast.error('Session expired. Please login again.')
    } else {
      toast.error(defaultMsg)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const { data } = await api.get('/suppliers')
      if (data.success) setSuppliers(data.data)
    } catch (error) { console.error('Fetch suppliers error:', error) }
  }

  const openQuickAddSupplier = (onSelect: (id: string) => void) => {
    setQuickAddSupplierCallback(() => onSelect)
    setShowQuickAddSupplier(true)
  }
  const handleQuickAddSupplierCreated = async (s: { id: string; code: string; name: string }) => {
    await fetchSuppliers()
    setSuppliers(prev => prev.some(x => x.id === s.id) ? prev : [...prev, s])
    if (quickAddSupplierCallback) quickAddSupplierCallback(s.id)
    setShowQuickAddSupplier(false)
    setQuickAddSupplierCallback(null)
  }

  const openQuickAddStock = (
    onSelect: (item: { id: string; code: string; name: string; unit: string; unitCost: number }) => void,
    prefill?: { name?: string; unitCost?: number }
  ) => {
    setQuickAddStockPrefill(prefill)
    setQuickAddStockCallback(() => onSelect)
    setShowQuickAddStock(true)
  }

  const handleQuickAddStockCreated = async (item: { id: string; code: string; name: string; unit: string; unitCost: number }) => {
    await fetchMaterials()
    if (quickAddStockCallback) quickAddStockCallback(item)
    setShowQuickAddStock(false)
    setQuickAddStockCallback(null)
    setQuickAddStockPrefill(undefined)
    toast.success(t('purchase.toast.stockItemAdded', { name: item.name }))
  }

  const fetchMaterials = async () => {
    try {
      const stockItems = await stockService.getAll()
      const mapped = stockItems.map(s => {
        const qty = s.quantity ?? 0
        const min = s.minStock ?? 0
        const max = s.maxStock ?? 0
        let stockStatus = 'NO_STOCK'
        if (qty > 0) {
          if (qty <= min * 0.3) stockStatus = 'CRITICAL'
          else if (qty <= min) stockStatus = 'LOW'
          else if (max > 0 && qty >= max) stockStatus = 'OVERSTOCK'
          else stockStatus = 'ADEQUATE'
        }
        return {
          id: s.id,
          code: s.sku || s.id?.slice(0, 8) || '',
          name: s.name,
          unit: s.unit,
          baseUnit: s.baseUnit ?? s.unit,
          currentStock: qty,
          stockStatus,
          unitCost: s.unitCost ?? 0,
        }
      })
      setMaterials(mapped)
    } catch (error) { console.error('Fetch materials error:', error) }
  }

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/summary')
      if (data.success) setSummary(data.data)
    } catch (error) { console.error('Fetch summary error:', error) }
    finally { setLoading(false) }
  }

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/requests')
      if (data.success) { setRequests(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadRequests')) }
    finally { setLoading(false) }
  }

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase-orders')
      if (data.success) { setOrders(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadOrders')) }
    finally { setLoading(false) }
  }

  const fetchReceipts = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/goods-receipts')
      if (data.success) { setReceipts(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadReceipts')) }
    finally { setLoading(false) }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/invoices')
      if (data.success) { setInvoices(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadInvoices')) }
    finally { setLoading(false) }
  }

  const fetchPayments = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/payments')
      if (data.success) { setPayments(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadPayments')) }
    finally { setLoading(false) }
  }

  const fetchReturns = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/returns')
      if (data.success) { setReturns(data.data); fetchBadgeCounts() }
    } catch (error: any) { handleApiError(error, t('purchase.error.loadReturns')) }
    finally { setLoading(false) }
  }

  // Single call covering all 6 tab badges + the category total (see backend
  // purchase.routes.ts GET /purchase/badge-counts for the counting criteria).
  // Deliberately silent on failure — a missing badge number is not worth a
  // toast interrupting the user, same reasoning as fetchSuppliers/fetchMaterials.
  const fetchBadgeCounts = async () => {
    try {
      const { data } = await api.get('/purchase/badge-counts')
      if (data.success) setBadgeCounts(data.data)
    } catch (error) { console.error('Fetch purchase badge counts error:', error) }
  }

  // CRUD
  // สร้างร่างแล้วเดินสถานะต่อในคลิกเดียว — ไม่ต้อง POST DRAFT ก่อนแล้วไปกดปุ่มแยกอีกที
  // toStatus ไม่ใส่ = บันทึกร่างเฉย ๆ (พฤติกรรมเดิมของ handleCreateRequest ที่ฟังก์ชันนี้แทนที่)
  const submitRequestFlow = async (toStatus?: 'PENDING' | 'APPROVED') => {
    setFormLoading(true)
    try {
      const items = requestForm.items.filter(i => i.material_id || i.description).map(item => ({
        ...item,
        estimated_total_price: item.quantity * item.estimated_unit_price
      }))
      const { data } = await api.post('/purchase/requests', { ...requestForm, items })
      if (!data.success) { toast.error(data.message || t('purchase.toast.requestCreateFailed')); return }
      if (toStatus) {
        try {
          await api.put(`/purchase/requests/${data.data.id}/status`, { status: toStatus })
        } catch (err: any) {
          // ร่างสร้างสำเร็จแล้ว แค่เดินสถานะต่อไม่ได้ (เช่น ไม่มีสิทธิ์อนุมัติ) — ปิดโมดัลแล้วรีเฟรชให้เห็น
          // ร่างที่สร้างไว้ แทนที่จะขึ้น error ทับจนดูเหมือนไม่สำเร็จเลยทั้งที่จริงสร้างไปแล้ว
          toast.error(err?.response?.data?.message || t('purchase.error.generic'))
          closeModal(); fetchRequests(); return
        }
      }
      toast.success(toStatus === 'APPROVED' ? t('purchase.toast.approved') : toStatus === 'PENDING' ? t('purchase.toast.submitted') : t('purchase.toast.requestCreated'))
      closeModal()
      fetchRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('purchase.toast.requestCreateError'))
    } finally { setFormLoading(false) }
  }

  const handleUpdateRequest = async () => {
    if (!modalData?.id) return
    setFormLoading(true)
    try {
      const items = requestForm.items.filter(i => i.material_id || i.description).map(item => ({
        materialId: item.material_id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        estimatedUnitPrice: item.estimated_unit_price,
        estimatedTotalPrice: item.estimated_total_price,
        notes: item.notes,
      }))
      const { data } = await api.put(`/purchase/requests/${modalData.id}`, {
        department: requestForm.department,
        requiredDate: requestForm.required_date,
        priority: requestForm.priority,
        notes: requestForm.notes,
        items,
      })
      if (data.success) {
        toast.success(t('purchase.toast.requestUpdated'))
        closeModal()
        fetchRequests()
      } else { toast.error(data.message || t('purchase.toast.requestUpdateFailed')) }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || t('purchase.error.generic'))
    } finally { setFormLoading(false) }
  }

  const handleDeleteRequest = async (id: string) => {
    if (!confirm(t('purchase.confirm.deleteRequest'))) return
    try {
      await api.delete(`/purchase/requests/${id}`)
      toast.success(t('purchase.toast.requestDeleted'))
      fetchRequests()
    } catch (error) { toast.error(t('purchase.toast.requestDeleteFailed')) }
  }

  const handleSubmitRequestDirect = async (id: string, toStatus: 'PENDING' | 'APPROVED') => {
    try {
      const { data } = await api.put(`/purchase/requests/${id}/status`, { status: toStatus })
      if (data.success) {
        toast.success(toStatus === 'PENDING' ? t('purchase.toast.submitted') : t('purchase.toast.approved'))
        fetchRequests()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('purchase.error.generic'))
    }
  }

  // Fixed: replaced prompt() with modal
  const handleConvertRequestToOrder = (requestId: string) => {
    setConvertPRId(requestId)
    setConvertForm({ supplier_id: '', expected_date: '', notes: '' })
  }

  const handleDoConvert = async () => {
    if (!convertForm.supplier_id) { toast.error(t('purchase.validation.selectSupplier')); return }
    setConverting(true)
    try {
      const { data } = await api.post(`/purchase/requests/${convertPRId}/convert-to-po`, {
        supplierId: convertForm.supplier_id
      })
      if (data.success) {
        toast.success(t('purchase.toast.convertedToOrder'))
        setConvertPRId(null)
        fetchRequests()
        fetchOrders()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('purchase.toast.convertFailed'))
    } finally { setConverting(false) }
  }

  const handleSelectPR = async (prId: string) => {
    if (!prId) {
      setOrderForm(p => ({ ...p, linked_pr_id: '' }))
      return
    }
    try {
      const { data } = await api.get(`/purchase/requests/${prId}`)
      if (!data.success) return
      const pr: PurchaseRequest = data.data
      const mappedItems = (pr.items || []).map((item: any) => ({
        material_id: item.material_id || '',
        description: item.description || '',
        quantity: item.quantity || 1,
        unit: item.unit || '',
        unit_price: item.estimated_unit_price || 0,
        total_price: (item.quantity || 1) * (item.estimated_unit_price || 0),
        notes: item.notes || '',
      }))
      setOrderForm(p => ({
        ...p,
        linked_pr_id: prId,
        expected_date: pr.required_date?.split('T')[0] || p.expected_date,
        notes: pr.notes ? `${t('purchase.common.reference')} ${pr.pr_number}${p.notes ? '\n' + p.notes : ''}` : p.notes,
        items: mappedItems.length > 0 ? mappedItems : p.items,
      }))
      toast.success(t('purchase.toast.requestItemsLoaded', { prNumber: pr.pr_number, count: mappedItems.length }))
    } catch { toast.error(t('purchase.toast.loadRequestFailed')) }
  }

  // เหมือน submitRequestFlow แต่สำหรับใบสั่งซื้อ — PO ใช้สถานะ SUBMITTED ไม่ใช่ PENDING
  // (แทนที่ handleCreateOrder เดิม — เรียกไม่ใส่ toStatus = พฤติกรรมเดิมของมันทุกอย่าง)
  const submitOrderFlow = async (toStatus?: 'SUBMITTED' | 'APPROVED') => {
    setFormLoading(true)
    try {
      const items = orderForm.items.filter(i => i.material_id || i.description).map(item => ({
        materialId: item.material_id,
        description: item.description,
        quantity: item.quantity,
        unit: normalizeUnit(item.unit),
        unitPrice: item.unit_price,
        notes: item.notes,
      }))
      const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
      const taxRate  = orderForm.tax_rate
      const taxAmount = subtotal * (taxRate / 100)
      const totalAmount = subtotal + taxAmount
      const { data } = await api.post('/purchase-orders', {
        supplierId:   orderForm.supplier_id,
        expectedDate: orderForm.expected_date,
        taxRate,
        notes:        orderForm.notes,
        linkedPrId:   orderForm.linked_pr_id || undefined,
        items,
        subtotal,
        taxAmount,
        totalAmount,
      })
      if (!data.success) { toast.error(data.message || t('purchase.toast.orderCreateFailed')); return }
      if (toStatus) {
        try {
          await api.put(`/purchase-orders/${data.data.id}/status`, { status: toStatus })
        } catch (err: any) {
          toast.error(err?.response?.data?.message || t('purchase.error.generic'))
          closeModal(); fetchOrders(); return
        }
      }
      toast.success(toStatus === 'APPROVED' ? t('purchase.status.approved') : toStatus === 'SUBMITTED' ? t('purchase.status.submitted') : t('purchase.toast.orderCreated'))
      closeModal()
      fetchOrders()
    } catch (error: any) {
      toast.error(error?.response?.data?.message || t('purchase.error.generic'))
    } finally { setFormLoading(false) }
  }

  const handleUpdateOrder = async () => {
    if (!modalData?.id) return
    setFormLoading(true)
    try {
      const items = orderForm.items.filter(i => i.material_id || i.description).map(item => ({
        materialId: item.material_id,
        description: item.description,
        quantity: item.quantity,
        unit: normalizeUnit(item.unit),
        unitPrice: item.unit_price,
        notes: item.notes,
      }))
      const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
      const taxRate = orderForm.tax_rate
      const taxAmount = subtotal * (taxRate / 100)
      const totalAmount = subtotal + taxAmount
      const { data } = await api.put(`/purchase-orders/${modalData.id}`, {
        supplierId: orderForm.supplier_id,
        expectedDate: orderForm.expected_date,
        taxRate,
        notes: orderForm.notes,
        items,
        subtotal,
        taxAmount,
        totalAmount,
      })
      // ติดด่านอนุมัติ: PO ยังไม่ถูกแก้จริง จึงไม่ปิดโมดัลและไม่ขึ้นข้อความว่าสำเร็จ (เหมือน Cashier.tsx/Sales.tsx)
      if (approvalGate.handleResponse(data)) return
      if (data.success) {
        toast.success(t('purchase.toast.orderUpdated'))
        closeModal()
        fetchOrders()
      } else { toast.error(data.message || t('purchase.toast.requestUpdateFailed')) }
    } catch (err: any) {
      // ติดด่าน "แก้เอกสารที่ออกไปแล้ว" → popup ขออนุมัติ ไม่ใช่ข้อความ error
      if (!approvalGate.handleError(err)) toast.error(t('purchase.error.generic'))
    }
    finally { setFormLoading(false) }
  }

  const handleUpdateOrderStatus = async (id: string, status: string) => {
    try {
      const { data } = await api.put(`/purchase-orders/${id}/status`, { status })
      if (data.success) {
        const labels: Record<string, string> = {
          SUBMITTED: t('purchase.status.submitted'), APPROVED: t('purchase.status.approved'), CANCELLED: t('purchase.status.cancelled')
        }
        toast.success(labels[status] || t('purchase.toast.statusUpdated'))
        fetchOrders()
      } else { toast.error(data.message || t('purchase.toast.statusUpdateFailed')) }
    } catch (error: any) {
      // ฝั่ง server บล็อกการยกเลิกไว้เมื่อมีใบรับของที่ยืนยันแล้ว หรือมีใบแจ้งหนี้อ้างอิงอยู่
      // ข้อความพวกนั้นบอกวิธีแก้ชัดเจน จึงต้องเอามาโชว์ ไม่ใช่กลืนแล้วขึ้นว่า error ทั่วไป
      toast.error(error?.response?.data?.message || t('purchase.error.generic'))
    }
  }

  const handleDeleteOrder = async (id: string) => {
    if (!confirm(t('purchase.confirm.deleteOrder'))) return
    try {
      await api.delete(`/purchase-orders/${id}`)
      toast.success(t('purchase.toast.orderDeleted'))
      fetchOrders()
    } catch (error) { toast.error(t('purchase.toast.orderDeleteFailed')) }
  }

  const handleCreateReceipt = async () => {
    if (!receiptForm.purchase_order_id) {
      toast.error(t('purchase.validation.selectPO'))
      return
    }
    if (!receiptForm.items.length) {
      toast.error(t('purchase.validation.addReceiptItems'))
      return
    }
    const invalidItem = receiptForm.items.find(i => !i.purchase_order_item_id)
    if (invalidItem) {
      toast.error(t('purchase.error.missingPOItemId'))
      return
    }
    setFormLoading(true)
    try {
      const payload = {
        purchaseOrderId: receiptForm.purchase_order_id,
        receiptDate: receiptForm.receipt_date,
        receivedBy: receiptForm.received_by,
        deliveryNoteNo: receiptForm.delivery_note_no || undefined,
        notes: receiptForm.notes,
        items: receiptForm.items.map(item => ({
          poItemId: item.purchase_order_item_id,
          materialId: item.material_id || null,
          unit: normalizeUnit(item.unit),
          orderedQty: item.ordered_qty,
          receivedQty: item.received_qty,
          acceptedQty: item.accepted_qty,
          rejectedQty: item.rejected_qty,
          lotNumber: item.lot_number || undefined,
          location: item.location || undefined,
          notes: item.notes,
        })),
      }
      const { data } = await api.post('/purchase/goods-receipts', payload)
      if (data.success) {
        toast.success(t('purchase.toast.receiptCreated'))
        closeModal()
        fetchReceipts()
      } else {
        toast.error(data.message || t('purchase.toast.receiptCreateFailed'))
      }
    } catch (error: any) {
      console.error('Create GR error:', error)
      const msg = error.response?.data?.message || error.message || t('purchase.error.generic')
      toast.error(msg)
    } finally {
      setFormLoading(false)
    }
  }

  const handleConfirmReceipt = async (id: string) => {
    try {
      const { data } = await api.put(`/purchase/goods-receipts/${id}/confirm`)
      if (data.success) {
        // รายการที่ไม่ได้ผูกกับสินค้าในคลัง (ของที่ไม่ต้องนับสต็อก เช่น ปากกา) จะไม่ถูกเพิ่มสต็อก
        // รับของได้ตามปกติ แต่ต้องเตือนให้เห็นชัด ไม่ใช่เงียบ ๆ แล้วให้ไปงงตอนนับของ
        const skipped: string[] = data.skippedLines || []
        if (skipped.length > 0) {
          toast(data.message, { icon: '⚠️', duration: 8000 })
        } else {
          toast.success(t('purchase.toast.receiptConfirmed'))
        }
        fetchReceipts()
        fetchOrders()
      } else { toast.error(data.message || t('purchase.toast.receiptConfirmFailed')) }
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.receiptConfirmFailed')) }
  }

  const handleDeleteReceipt = async (id: string) => {
    if (!confirm(t('purchase.confirm.deleteReceipt'))) return
    try {
      await api.delete(`/purchase/goods-receipts/${id}`)
      toast.success(t('purchase.toast.receiptDeleted'))
      fetchReceipts()
    } catch { toast.error(t('purchase.toast.receiptDeleteFailed')) }
  }

  // Cancel a CONFIRMED goods receipt — backend reverses stock automatically and
  // blocks the call if an active purchase invoice already references this GR.
  const handleCancelReceipt = async (id: string) => {
    if (!confirm(t('purchase.confirm.cancelReceipt'))) return
    try {
      const { data } = await api.put(`/purchase/goods-receipts/${id}/status`, { status: 'CANCELLED' })
      if (data.success) {
        toast.success(data.message || t('purchase.toast.receiptCancelled'))
        fetchReceipts()
        fetchOrders()
      } else { toast.error(data.message || t('purchase.toast.receiptCancelFailed')) }
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.receiptCancelFailed')) }
  }

  const handleCreateInvoice = async () => {
    setFormLoading(true)
    try {
      const { data } = await api.post('/purchase/invoices', {
        purchaseOrderId: invoiceForm.purchase_order_id,
        purchaseOrderIds: [invoiceForm.purchase_order_id, ...invoiceForm.extra_po_ids],
        goodsReceiptIds: invoiceForm.goods_receipt_ids,
        supplierInvoiceNumber: invoiceForm.supplier_invoice_number,
        invoiceDate: invoiceForm.invoice_date,
        dueDate: invoiceForm.due_date,
        taxRate: invoiceForm.tax_rate,
        notes: invoiceForm.notes,
        drAccountId: invoiceForm.dr_account_id || undefined,
        crAccountId: invoiceForm.cr_account_id || undefined,
      })
      if (data.success) {
        toast.success(t('purchase.toast.invoiceCreated'))
        closeModal()
        // ต้องดึงใบรับสินค้ากับใบสั่งซื้อใหม่ด้วย ไม่งั้น invoiced_at/สถานะยังเป็นของเก่า
        // แล้วใบสั่งซื้อที่เพิ่งออกบิลไปจะยังค้างอยู่ใน dropdown จนกว่าจะสลับแท็บ
        fetchInvoices(); fetchReceipts(); fetchOrders()
      } else { toast.error(data.message || t('purchase.toast.invoiceCreateFailed')) }
    } catch (error: any) { toast.error(error?.response?.data?.message || t('purchase.error.generic')) }
    finally { setFormLoading(false) }
  }

  // Cancel a purchase invoice — backend reverses linked supplier payments first,
  // then reverses the AP/inventory journal and input VAT entry.
  // ยกเลิกใบขอซื้อ — server ตรวจเงื่อนไขให้ (สิทธิ์, สถานะ, และต้องไม่มีใบสั่งซื้อค้างอยู่)
  const handleCancelRequest = async (id: string, prNumber: string) => {
    if (!confirm(`ยืนยันยกเลิกใบขอซื้อ ${prNumber}?`)) return
    try {
      const { data } = await api.post(`/purchase-requests/${id}/cancel`, {})
      if (data.success) {
        toast.success(data.message || 'ยกเลิกใบขอซื้อเรียบร้อย')
        fetchRequests()
      } else { toast.error(data.message || 'ยกเลิกใบขอซื้อไม่สำเร็จ') }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'ยกเลิกใบขอซื้อไม่สำเร็จ')
    }
  }

  // ยกเลิกใบสั่งซื้อ — ใช้ endpoint เดิมที่มีเงื่อนไขฝั่ง server อยู่แล้ว
  const handleCancelOrder = async (id: string, poNumber: string) => {
    if (!confirm(`ยืนยันยกเลิกใบสั่งซื้อ ${poNumber}?`)) return
    await handleUpdateOrderStatus(id, 'CANCELLED')
  }

  const handleCancelInvoice = async (id: string) => {
    if (!confirm(t('purchase.confirm.cancelInvoice'))) return
    try {
      const { data } = await api.put(`/purchase/invoices/${id}/status`, { status: 'CANCELLED' })
      if (data.success) {
        toast.success(data.message || t('purchase.toast.invoiceCancelled'))
        fetchInvoices()
        fetchPayments()
      } else { toast.error(data.message || t('purchase.toast.invoiceCancelFailed')) }
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.invoiceCancelFailed')) }
  }

  const handleCreatePayment = async () => {
    const selInv = invoices.find(i => i.id === paymentForm.purchase_invoice_id)
    if (selInv && paymentForm.amount > selInv.balance_amount) { toast.error('จำนวนเงินเกินยอดคงเหลือ'); return }
    setFormLoading(true)
    try {
      const { data } = await api.post('/purchase/payments', {
        supplierId: paymentForm.supplier_id,
        purchaseInvoiceId: paymentForm.purchase_invoice_id || undefined,
        paymentDate: paymentForm.payment_date,
        paymentMethod: paymentForm.payment_method,
        paymentReference: paymentForm.payment_reference,
        amount: paymentForm.amount,
        withholdingTax: paymentForm.withholding_tax,
        notes: paymentForm.notes,
      })
      if (data.success) {
        toast.success(t('purchase.toast.paymentRecorded'))
        closeModal()
        fetchPayments()
        fetchInvoices()
      } else { toast.error(data.message || t('purchase.toast.paymentRecordFailed')) }
    } catch (error: any) { toast.error(error?.response?.data?.message || t('purchase.error.generic')) }
    finally { setFormLoading(false) }
  }

  // Void a supplier payment — backend reverses its journal and restores the
  // linked purchase invoice's paid/balance/payment_status. Hard-deletes the payment row.
  const handleVoidPayment = async (id: string) => {
    if (!confirm(t('purchase.confirm.voidPayment'))) return
    try {
      const { data } = await api.delete(`/purchase/payments/${id}`)
      if (data.success) {
        toast.success(data.message || t('purchase.toast.paymentVoided'))
        fetchPayments()
        fetchInvoices()
      } else { toast.error(data.message || t('purchase.toast.paymentVoidFailed')) }
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.paymentVoidFailed')) }
  }

  const handleCreateReturn = async () => {
    setFormLoading(true)
    try {
      const items = returnForm.items.filter(i => i.material_id && i.quantity > 0).map(item => ({
        ...item,
        total_price: item.quantity * item.unit_price
      }))
      const subtotal = items.reduce((sum, i) => sum + i.total_price, 0)
      const taxAmount = subtotal * (returnForm.tax_rate / 100)
      const totalAmount = subtotal + taxAmount
      const { data } = await api.post('/purchase/returns', { ...returnForm, items, subtotal, taxAmount, totalAmount })
      if (data.success) {
        toast.success(t('purchase.toast.returnCreated'))
        closeModal()
        fetchReturns()
      } else { toast.error(data.message || t('purchase.toast.returnCreateFailed')) }
    } catch (error: any) { toast.error(error?.response?.data?.message || t('purchase.error.generic')) }
    finally { setFormLoading(false) }
  }

  const handleUpdateReturnStatus = async (id: string, status: string) => {
    try {
      const { data } = await api.put(`/purchase/returns/${id}/status`, { status })
      if (data.success) {
        const labels: Record<string, string> = { SUBMITTED: t('purchase.status.submitted'), APPROVED: t('purchase.status.approved'), CANCELLED: t('purchase.status.cancelled') }
        toast.success(labels[status] || t('purchase.toast.statusUpdated'))
        fetchReturns()
      } else { toast.error(data.message || t('purchase.toast.statusUpdateFailed')) }
    } catch (error: any) { toast.error(error?.response?.data?.message || t('purchase.error.generic')) }
  }

  const handleDeleteReturn = async (id: string) => {
    if (!confirm(t('purchase.confirm.deleteReturn'))) return
    try {
      await api.delete(`/purchase/returns/${id}`)
      toast.success(t('purchase.toast.returnDeleted'))
      fetchReturns()
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.returnDeleteFailed')) }
  }

  const handleConfirmReturn = async (id: string) => {
    try {
      const { data } = await api.put(`/purchase/returns/${id}/confirm`)
      if (data.success) {
        toast.success(t('purchase.toast.returnConfirmed'))
        fetchReturns()
      } else { toast.error(data.message || t('purchase.toast.returnConfirmFailed')) }
    } catch (error: any) { toast.error(error.response?.data?.message || t('purchase.toast.returnConfirmFailed')) }
  }

  // กฎเดียวที่ใช้ตัดสินว่า PO ใบนี้ยังออกใบแจ้งหนี้ได้อยู่ไหม
  // เคยมี 2 ชุดแยกกัน (ตาราง PO กับ dropdown ในโมดัล) แล้วไม่ตรงกัน —
  // PO ที่ออกใบไปแล้วยังโผล่ให้เลือก พอกดก็ถูกเด้งว่าซ้ำ
  // ขั้นต่อไปของใบขอซื้อ — กฎเดียว ใช้ได้ทั้งมุมมองตารางและการ์ด
  const prNextStep = (req: PurchaseRequest): NextStep => {
    if (req.status === 'CANCELLED') return { kind: 'locked', label: t('purchase.nextStep.prCancelled') }
    if (req.status === 'REJECTED') return { kind: 'locked', label: t('purchase.nextStep.prRejected') }
    // แปลงเป็นใบสั่งซื้อไปแล้วหรือยัง — ดูจาก PO ที่ผูกกลับมาที่ใบนี้
    const madePO = orders.find(o => o.linked_pr_id === req.id && o.status !== 'CANCELLED')
    if (madePO) {
      return {
        kind: 'done', label: t('purchase.nextStep.poCreated'), docNumber: madePO.po_number,
        onClick: () => { setActiveTab('orders'); openModalWithDetail('order', 'view', madePO.id, madePO) },
      }
    }
    if (req.status === 'APPROVED') {
      if (!canMakePO) return { kind: 'locked', label: t('purchase.nextStep.noPermissionPO') }
      return { kind: 'action', label: t('purchase.nextStep.createPO'), onClick: () => handleConvertRequestToOrder(req.id) }
    }
    if (req.status === 'DRAFT') {
      return { kind: 'action', label: t('purchase.actions.submitForApproval'), onClick: () => handleSubmitRequestDirect(req.id, 'PENDING') }
    }
    if (req.status === 'PENDING') {
      if (!canMakePO) return { kind: 'locked', label: t('purchase.nextStep.waitApproval') }
      return { kind: 'action', label: t('purchase.actions.approve'), onClick: () => handleSubmitRequestDirect(req.id, 'APPROVED') }
    }
    return { kind: 'locked', label: t('purchase.nextStep.waitApproval') }
  }

  // บิลใบนี้ครอบคลุมใบสั่งซื้อใบนั้นหรือเปล่า — ต้องดูลิสต์ที่รวมเข้ามาด้วย
  // ไม่ใช่แค่ purchase_order_id ตัวเดียว ไม่งั้นใบที่เอามารวมจะโผล่ให้เลือกซ้ำตลอดไป
  const invoiceCoversPO = (inv: PurchaseInvoice, poId: string) => {
    if (inv.purchase_order_id === poId) return true
    try { return (JSON.parse(inv.purchase_order_ids || '[]') as string[]).includes(poId) } catch { return false }
  }

  const poHasInvoiceableTarget = (order: PurchaseOrder) => {
    // ถูกรวมเข้าบิลใบอื่นไปแล้ว = จบ ไม่ต้องดูใบรับสินค้าต่อ
    if (invoices.some(i => i.status !== 'CANCELLED' && invoiceCoversPO(i, order.id))) return false
    const confirmedGRs = receipts.filter(r => r.purchase_order_id === order.id && r.status === 'CONFIRMED')
    if (confirmedGRs.length > 0) return confirmedGRs.some(r => !r.invoiced_at)
    return true
  }

  // ใบแจ้งหนี้ของ PO ใบนี้ที่ยังค้างจ่าย — ใช้ตัดสินว่าจะโชว์ปุ่ม "จ่ายเงิน" ในแถวไหม
  const poUnpaidInvoice = (order: PurchaseOrder) =>
    invoices.find(i => i.purchase_order_id === order.id && i.status !== 'CANCELLED' && i.payment_status !== 'PAID')

  // ── ขั้นต่อไป: กฎชุดเดียวใช้ทั้งมุมมองตารางและการ์ด ─────────────
  // เดิมกฎเดียวกันถูกเขียนซ้ำคนละที่แล้วไม่ตรงกัน จึงเกิดเคส PO-2026-00029
  // ที่ออกบิลไปแล้วแต่ยังโผล่ใน dropdown ให้เลือกซ้ำได้
  const poNextStep = (order: PurchaseOrder): NextStep => {
    if (order.status === 'CANCELLED') return { kind: 'locked', label: t('purchase.nextStep.cancelled') }
    if (order.status === 'DRAFT') {
      return { kind: 'action', label: t('purchase.actions.submitForApproval'), onClick: () => handleUpdateOrderStatus(order.id, 'SUBMITTED') }
    }
    if (order.status === 'SUBMITTED') {
      if (!canMakePO) return { kind: 'locked', label: t('purchase.nextStep.noPermissionApprove') }
      return { kind: 'action', label: t('purchase.actions.approve'), onClick: () => handleUpdateOrderStatus(order.id, 'APPROVED') }
    }
    if (order.status === 'APPROVED' || order.status === 'PARTIAL') {
      return {
        kind: 'action', label: t('purchase.actions.receiveGoods'),
        onClick: () => {
          setReceiptForm(p => ({ ...p, purchase_order_id: order.id, items: [] }))
          loadPendingItems(order.id)
          openModal('receipt', 'create')
        },
      }
    }
    // รับของครบแล้ว — ถ้ายังมีของที่ยังไม่ได้วางบิล ให้ออกใบแจ้งหนี้
    if (poHasInvoiceableTarget(order)) {
      return {
        kind: 'action', label: t('purchase.actions.createInvoice'),
        onClick: () => {
          setInvoiceForm(p => ({
            ...p,
            purchase_order_id: order.id,
            extra_po_ids: [],
            goods_receipt_ids: [],
            tax_rate: order.tax_rate ?? 7,
            due_date: order.expected_date?.split('T')[0] || '',
          }))
          openModal('invoice', 'create')
        },
      }
    }
    // วางบิลแล้วแต่ยังค้างจ่าย — เดินต่อไปจ่ายเงินได้จากตรงนี้เลย
    const unpaid = poUnpaidInvoice(order)
    if (unpaid) {
      return {
        kind: 'action', label: t('purchase.actions.payNow'),
        onClick: () => {
          setPaymentForm(p => ({ ...p, supplier_id: order.supplier_id, purchase_invoice_id: unpaid.id, amount: unpaid.balance_amount || 0 }))
          openModal('payment', 'create')
        },
      }
    }
    // ไม่มีอะไรให้ทำต่อ = ปิดครบวงจรแล้ว บอกไปเลยว่าจบที่ใบไหน
    const paid = invoices.find(i => i.purchase_order_id === order.id && i.status !== 'CANCELLED')
    if (paid) {
      return {
        kind: 'done', label: t('purchase.nextStep.cycleClosed'), docNumber: paid.pi_number,
        onClick: () => { setActiveTab('invoices'); openModalWithDetail('invoice', 'view', paid.id, paid) },
      }
    }
    return { kind: 'done', label: t('purchase.nextStep.cycleClosed') }
  }

  const grNextStep = (receipt: GoodsReceipt): NextStep => {
    if (receipt.status === 'CANCELLED') return { kind: 'locked', label: t('purchase.nextStep.cancelled') }
    // สิทธิ์ยืนยันรับของฝั่ง backend ดูถึงระดับแผนก (can(purchase|stock,'write'))
    // ซึ่งฝั่งหน้าเว็บไม่มีข้อมูลพอจะคำนวณ จึงไม่ล็อกปุ่มที่นี่ ปล่อยให้ backend ตัดสิน
    if (receipt.status === 'DRAFT') {
      return { kind: 'action', label: t('purchase.nextStep.confirmReceipt'), onClick: () => handleConfirmReceipt(receipt.id) }
    }
    return { kind: 'done', label: t('purchase.nextStep.stockedIn') }
  }

  const invNextStep = (invoice: PurchaseInvoice): NextStep => {
    if (invoice.status === 'CANCELLED') return { kind: 'locked', label: t('purchase.nextStep.cancelled') }
    if (invoice.payment_status === 'PAID') return { kind: 'done', label: t('purchase.nextStep.fullyPaid') }
    return {
      kind: 'action', label: t('purchase.actions.payNow'),
      onClick: () => openModal('payment', 'create', { purchase_invoice_id: invoice.id, supplier_id: invoice.supplier_id, amount: invoice.balance_amount }),
    }
  }

  // ── แถบ "ไปถึงไหนแล้ว" ของแต่ละชนิดเอกสาร ─────────────────────
  const prStageView = (req: PurchaseRequest): StageView => {
    const stages = [t('purchase.stage.pr.draft'), t('purchase.stage.pr.pending'), t('purchase.stage.pr.approved'), t('purchase.stage.pr.converted')]
    if (req.status === 'CANCELLED') return { stages, idx: 0, dead: t('purchase.status.cancelled') }
    if (req.status === 'REJECTED') return { stages, idx: 0, dead: t('purchase.status.rejected') }
    if (orders.some(o => o.linked_pr_id === req.id && o.status !== 'CANCELLED')) return { stages, idx: 3 }
    return { stages, idx: req.status === 'APPROVED' ? 2 : req.status === 'DRAFT' ? 0 : 1 }
  }

  const poStageView = (order: PurchaseOrder): StageView => {
    const stages = PO_FLOW.map(k => t(`purchase.trail.step.${k}`))
    if (order.status === 'CANCELLED') return { stages, idx: 0, dead: t('purchase.status.cancelled') }
    const idx = PO_FLOW.indexOf(order.status as any)
    // รับครบโดยไม่เคยผ่าน "รับบางส่วน" = ข้ามขั้นนั้นไป ไม่ใช่ค้างอยู่
    return { stages, idx: idx < 0 ? 0 : idx, skipped: order.status === 'RECEIVED' ? [3] : undefined }
  }

  const grStageView = (receipt: GoodsReceipt): StageView => {
    const stages = [t('purchase.stage.gr.draft'), t('purchase.stage.gr.confirmed')]
    if (receipt.status === 'CANCELLED') return { stages, idx: 0, dead: t('purchase.status.cancelled') }
    return { stages, idx: receipt.status === 'CONFIRMED' ? 1 : 0 }
  }

  const invStageView = (invoice: PurchaseInvoice): StageView => {
    const stages = [t('purchase.stage.inv.draft'), t('purchase.stage.inv.billed'), t('purchase.stage.inv.paid')]
    if (invoice.status === 'CANCELLED') return { stages, idx: 0, dead: t('purchase.status.cancelled') }
    if (invoice.status === 'DRAFT') return { stages, idx: 0 }
    return { stages, idx: invoice.payment_status === 'PAID' ? 2 : 1 }
  }

  // ชิปกรองบนแถบค้นหา — "ค้างจ่าย" โผล่เฉพาะแท็บที่มีความหมายจริง (PO/ใบแจ้งหนี้)
  // แท็บใบขอซื้อกับใบรับของไม่มีหนี้ให้ค้าง จึงซ่อนไปเลย ดีกว่าโชว์แล้วกดได้ 0 รายการ
  const rowFilterChips = (showDue: boolean) => {
    const chips: Array<['all' | 'mine' | 'due', string]> = [
      ['all', t('purchase.filter.all')],
      ['mine', t('purchase.filter.mine')],
    ]
    if (showDue) chips.push(['due', t('purchase.filter.due')])
    return (
      <div className="flex items-center gap-2">
        {chips.map(([key, label]) => (
          <button key={key} onClick={() => { setRowFilter(key); setCurrentPage(1) }} aria-pressed={rowFilter === key}
            className={`h-9 px-3.5 rounded-lg text-xs font-semibold border whitespace-nowrap transition-colors ${
              rowFilter === key
                ? 'bg-phopy-indigo/10 text-[var(--primary)] border-phopy-indigo/40'
                : 'bg-[var(--bg)] text-[var(--fg-3)] border-[var(--border)] hover:text-[var(--fg-1)]'}`}>
            {label}
          </button>
        ))}
      </div>
    )
  }

  // ผ่านตัวกรองไหม — 'mine' = ยังมีอะไรให้ทำ · 'due' = ยังค้างจ่าย
  const passesRowFilter = (step: NextStep, due: boolean) =>
    rowFilter === 'all' ? true : rowFilter === 'mine' ? step.kind === 'action' : due

  // กล่องเส้นทางเอกสารที่กางออกมาใต้แถว — เรียกเป็นฟังก์ชัน ไม่ใช่ <Component/>
  // เพราะถ้าเป็นคอมโพเนนต์ที่ประกาศในนี้ มันจะ remount ทุกครั้งที่ re-render
  // แล้ว PurchaseTrail จะยิง API ซ้ำไม่หยุด
  const expandedTrail = (kind: TrailKind, row: any) => {
    const poId = trailPoId(kind, row)
    return (
      <div className="px-4 pb-4 pt-1 bg-[var(--surface-2)]/40 border-b border-[var(--border)]/20" onClick={e => e.stopPropagation()}>
        {poId ? <PurchaseTrail poId={poId} /> : (
          <div className="flex items-center gap-2 px-3 py-3 rounded-xl border border-dashed border-[var(--border-strong)]">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--fg-4)] shrink-0" />
            <span className="text-xs text-[var(--fg-3)]">{t(kind === 'pr' ? 'purchase.trail.noOrderYet' : 'purchase.trail.noTrail')}</span>
          </div>
        )}
      </div>
    )
  }

  // ใบจ่ายเงินเป็นปลายทาง ไม่มีขั้นต่อไป — แต่ยังต้องบอกได้ว่าลงบัญชีแล้วหรือยัง
  // (เคยมีเคสใบแจ้งหนี้ไม่ post journal แล้วเงินหายจากงบไปเฉย ๆ ช่องนี้จะจับได้ตั้งแต่ตาราง)
  const payNextStep = (p: SupplierPayment): NextStep =>
    p.journal_entry_number
      ? { kind: 'done', label: t('purchase.nextStep.posted'), docNumber: p.journal_entry_number }
      : { kind: 'locked', label: t('purchase.nextStep.notPosted') }

  const payStageView = (p: SupplierPayment): StageView => ({
    stages: [t('purchase.stage.pay.paid'), t('purchase.stage.pay.posted')],
    idx: p.journal_entry_number ? 1 : 0,
  })

  // ใบคืนสินค้าเดินทีละขั้นเหมือนใบสั่งซื้อ: ร่าง -> ส่งอนุมัติ -> อนุมัติ -> ยืนยันคืนของ
  // (ยืนยันคืนของคือขั้นที่ตัดสต็อกจริง จึงแยกออกจากการอนุมัติ)
  const retNextStep = (r: PurchaseReturn): NextStep => {
    if (r.status === 'CANCELLED') return { kind: 'locked', label: t('purchase.nextStep.cancelled') }
    if (r.status === 'DRAFT') return { kind: 'action', label: t('purchase.actions.submitForApproval'), onClick: () => handleUpdateReturnStatus(r.id, 'SUBMITTED') }
    if (r.status === 'SUBMITTED') return { kind: 'action', label: t('purchase.actions.approve'), onClick: () => handleUpdateReturnStatus(r.id, 'APPROVED') }
    if (r.status === 'APPROVED') return { kind: 'action', label: t('purchase.nextStep.confirmReturn'), onClick: () => handleConfirmReturn(r.id) }
    return { kind: 'done', label: t('purchase.nextStep.returned') }
  }

  const RET_FLOW = ['DRAFT', 'SUBMITTED', 'APPROVED', 'CONFIRMED']
  const retStageView = (r: PurchaseReturn): StageView => {
    const stages = [t('purchase.stage.ret.draft'), t('purchase.stage.ret.submitted'), t('purchase.stage.ret.approved'), t('purchase.stage.ret.confirmed')]
    if (r.status === 'CANCELLED') return { stages, idx: 0, dead: t('purchase.status.cancelled') }
    const idx = RET_FLOW.indexOf(r.status)
    return { stages, idx: idx < 0 ? 0 : idx }
  }

  // ใบสั่งซื้อที่เป็นต้นสายของเอกสารใบนี้ — ใช้เปิดกล่องเส้นทางเอกสาร
  // ใบขอซื้อที่ยังไม่ได้แปลงเป็น PO จะไม่มีต้นสาย → คืน null แล้วไม่ยิง API เปล่า
  const trailPoId = (kind: TrailKind, row: any): string | null => {
    if (kind === 'po') return row.id
    if (kind === 'gr' || kind === 'inv' || kind === 'ret') return row.purchase_order_id || null
    // ใบจ่ายเงินชี้ใบแจ้งหนี้ ต้องเด้งอีกทอดถึงจะถึงใบสั่งซื้อ
    if (kind === 'pay') return invoices.find(i => i.id === row.purchase_invoice_id)?.purchase_order_id || null
    return orders.find(o => o.linked_pr_id === row.id && o.status !== 'CANCELLED')?.id || null
  }

  // Modal handlers
  const openModal = (type: string, mode: 'create' | 'edit' | 'view', data?: any) => {
    setModalOpen(type)
    setModalMode(mode)
    setModalData(data)
    if (data) {
      if (type === 'request') {
        setRequestForm({
          department: data.department || '',
          required_date: data.required_date?.split('T')[0] || '',
          priority: data.priority || 'NORMAL',
          preferred_supplier_id: data.preferred_supplier_id || '',
          notes: data.notes || '',
          items: data.items || [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }]
        })
      } else if (type === 'order') {
        setOrderForm({
          supplier_id: data.supplier_id || '',
          expected_date: data.expected_date?.split('T')[0] || '',
          payment_terms: data.payment_terms || 30,
          discount: data.discount || 0,
          tax_rate: data.tax_rate || 7,
          notes: data.notes || '',
          linked_pr_id: data.linked_pr_id || '',
          items: (data.items || [{ material_id: '', description: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, notes: '' }]).map((item: any) => ({
            ...item,
            unit: normalizeUnit(item.unit || ''),
          }))
        })
      } else if (type === 'receipt') {
        setReceiptForm({
          purchase_order_id: data.purchase_order_id || '',
          receipt_date: data.receipt_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          received_by: data.received_by || user?.email || '',
          delivery_note_no: data.delivery_note_no || '',
          notes: data.notes || '',
          items: data.items || []
        })
      } else if (type === 'invoice') {
        let grIds: string[] = []
        try { grIds = JSON.parse(data.goods_receipt_ids || '[]') } catch { grIds = data.goods_receipt_id ? [data.goods_receipt_id] : [] }
        let poIds: string[] = []
        try { poIds = JSON.parse(data.purchase_order_ids || '[]') } catch { /* แถวเก่าก่อนมีคอลัมน์นี้ */ }
        setInvoiceForm({
          purchase_order_id: data.purchase_order_id || '',
          extra_po_ids: poIds.filter((x: string) => x && x !== data.purchase_order_id),
          goods_receipt_ids: grIds,
          supplier_invoice_number: data.supplier_invoice_number || '',
          invoice_date: data.invoice_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          due_date: data.due_date?.split('T')[0] || '',
          tax_rate: data.tax_rate ?? 7,
          notes: data.notes || '',
          dr_account_id: '',
          cr_account_id: '',
          _subtotal: data.subtotal || 0,
          _tax_amount: data.tax_amount || 0,
          _total_amount: data.total_amount || 0,
          _supplier_name: data.supplier_name || '',
          _po_number: data.po_number || '',
          _pi_number: data.pi_number || '',
          _paid_amount: data.paid_amount || 0,
          _balance_amount: data.balance_amount || 0,
          _payment_status: data.payment_status || '',
        })
      } else if (type === 'payment') {
        setPaymentForm({
          supplier_id: data.supplier_id || '',
          purchase_invoice_id: data.purchase_invoice_id || '',
          payment_date: data.payment_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          payment_method: data.payment_method || 'TRANSFER',
          payment_reference: data.payment_reference || '',
          amount: data.amount || 0,
          withholding_tax: data.withholding_tax || 0,
          notes: data.notes || ''
        })
      } else if (type === 'return') {
        setReturnForm({
          purchase_order_id: data.purchase_order_id || '',
          goods_receipt_id: data.goods_receipt_id || '',
          return_date: data.return_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          reason: data.reason || '',
          tax_rate: data.tax_rate || 7,
          notes: data.notes || '',
          items: data.items || [{ material_id: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, reason: '' }]
        })
      }
    } else {
      setRequestForm({ department: '', required_date: '', priority: 'NORMAL', preferred_supplier_id: '', notes: '', items: [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] })
      setOrderForm({ supplier_id: '', expected_date: '', payment_terms: 30, discount: 0, tax_rate: 7, notes: '', linked_pr_id: '', items: [{ material_id: '', description: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, notes: '' }] })
      setReceiptForm({ purchase_order_id: '', receipt_date: new Date().toISOString().split('T')[0], received_by: user?.email || '', delivery_note_no: '', notes: '', items: [] })
      setInvoiceForm({ purchase_order_id: '', extra_po_ids: [], goods_receipt_ids: [], supplier_invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', tax_rate: 7, notes: '', dr_account_id: '', cr_account_id: '', _subtotal: 0, _tax_amount: 0, _total_amount: 0, _supplier_name: '', _po_number: '', _pi_number: '', _paid_amount: 0, _balance_amount: 0, _payment_status: '' })
      setPaymentForm({ supplier_id: '', purchase_invoice_id: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'TRANSFER', payment_reference: '', amount: 0, withholding_tax: 0, notes: '' })
      setReturnForm({ purchase_order_id: '', goods_receipt_id: '', return_date: new Date().toISOString().split('T')[0], reason: '', tax_rate: 7, notes: '', items: [{ material_id: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, reason: '' }] })
    }
  }

  const closeModal = () => {
    setModalOpen(null)
    setModalMode('create')
    setModalData(null)
    setSubmitMenuOpen(false)
  }

  // ── print helper: adds company info then delegates to the shared bill template
  const handlePrint = async (type: 'pr' | 'po' | 'gr' | 'pi' | 'payment' | 'return', id: string, format: 'a4' | 'thermal' = 'a4') => {
    const endpointMap: Record<string, string> = {
      pr: `/purchase/requests/${id}`,
      po: `/purchase-orders/${id}`,
      gr: `/purchase/goods-receipts/${id}`,
      pi: `/purchase/invoices/${id}`,
      payment: `/purchase/payments/${id}`,
      return: `/purchase/returns/${id}`,
    }
    try {
      const { data } = await api.get(endpointMap[type])
      const doc = data?.data || data
      printBill(type, { ...doc, _company: user?.name || t('purchase.common.companyFallback') }, format)
    } catch { toast.error(t('purchase.error.loadPrintData')) }
  }

  // Fetch full detail (with items) then open modal — avoids empty form on edit/view
  const detailEndpoint: Record<string, string> = {
    request: '/purchase/requests',
    order:   '/purchase-orders',
    receipt: '/purchase/goods-receipts',
    invoice: '/purchase/invoices',
    return:  '/purchase/returns',
  }
  const openModalWithDetail = async (type: string, mode: 'edit' | 'view', id: string, fallback?: any) => {
    const endpoint = detailEndpoint[type]
    if (!endpoint) { openModal(type, mode, fallback); return }
    try {
      const { data } = await api.get(`${endpoint}/${id}`)
      if (data.success) openModal(type, mode, data.data)
      else openModal(type, mode, fallback)
    } catch { openModal(type, mode, fallback) }
  }

  // Multi-field update helpers (for auto-fill on material select)
  const updateRequestItemFields = (index: number, fields: Partial<RequestItem>) => {
    setRequestForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], ...fields }
      items[index].estimated_total_price = items[index].quantity * items[index].estimated_unit_price
      return { ...prev, items }
    })
  }
  const updateOrderItemFields = (index: number, fields: Partial<OrderItem>) => {
    setOrderForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], ...fields }
      items[index].total_price = items[index].quantity * items[index].unit_price
      return { ...prev, items }
    })
  }
  const updateReturnItemFields = (index: number, fields: Partial<ReturnItem>) => {
    setReturnForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], ...fields }
      items[index].total_price = items[index].quantity * items[index].unit_price
      return { ...prev, items }
    })
  }

  const addRequestItem = () => setRequestForm(prev => ({ ...prev, items: [...prev.items, { material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] }))
  const updateRequestItem = (index: number, field: keyof RequestItem, value: any) => {
    setRequestForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'estimated_unit_price') {
        items[index].estimated_total_price = items[index].quantity * items[index].estimated_unit_price
      }
      return { ...prev, items }
    })
  }
  const removeRequestItem = (index: number) => setRequestForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))

  const addOrderItem = () => setOrderForm(prev => ({ ...prev, items: [...prev.items, { material_id: '', description: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, notes: '' }] }))
  const updateOrderItem = (index: number, field: keyof OrderItem, value: any) => {
    setOrderForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        items[index].total_price = items[index].quantity * items[index].unit_price
      }
      return { ...prev, items }
    })
  }
  const removeOrderItem = (index: number) => setOrderForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))

  const addReturnItem = () => setReturnForm(prev => ({ ...prev, items: [...prev.items, { material_id: '', quantity: 1, unit: '', unit_price: 0, total_price: 0, reason: '' }] }))
  const updateReturnItem = (index: number, field: keyof ReturnItem, value: any) => {
    setReturnForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        items[index].total_price = items[index].quantity * items[index].unit_price
      }
      return { ...prev, items }
    })
  }
  const removeReturnItem = (index: number) => setReturnForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))

  const loadPendingItems = async (poId: string) => {
    try {
      const { data } = await api.get(`/purchase/goods-receipts/pending-items/${poId}`)
      if (data.success) {
        setReceiptForm(prev => {
          // Bug: a PO switch fires a new request but the old one can still resolve
          // later (network jitter) and land AFTER the newer pick — its closure captures
          // the OLD poId, so it used to overwrite purchase_order_id back to the old PO
          // and repopulate its items, silently reverting the user's newer selection
          // ("old PO won't go away"). Guard: only apply a response if the form still
          // points at the PO that request was for.
          if (prev.purchase_order_id !== poId) return prev
          return {
            ...prev,
            items: data.data.map((item: any) => ({
              purchase_order_item_id: item.id,
              material_id: item.material_id || '',
              description: item.description || item.material_name || '',
              material_name: item.material_name || '',
              unit: normalizeUnit(item.unit) || t('purchase.common.unitFallback'),
              unit_price: item.unit_price || 0,
              ordered_qty: item.quantity || 0,
              already_received_qty: item.received_qty || 0,
              pending_qty: item.pending_qty || item.quantity || 0,
              received_qty: item.pending_qty || item.quantity || 0, // default = รับทั้งหมด
              accepted_qty: item.pending_qty || item.quantity || 0,
              rejected_qty: 0,
              lot_number: '',
              location: '',
              notes: '',
            }))
          }
        })
      }
    } catch (error) { toast.error(t('purchase.error.loadPendingReceipts')) }
  }

  // Helpers
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  }

  // ─── UI Components ───────────────────────────────────────────────

  const StatusBadge = ({ status }: { status: string }) => {
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      DRAFT:     { bg: 'bg-gray-500/15',   text: 'text-[var(--fg-3)]',   label: t('purchase.status.draft') },
      PENDING:   { bg: 'bg-yellow-500/15', text: 'text-warning', label: t('purchase.status.pendingApproval') },
      SUBMITTED: { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: t('purchase.actions.submit') },
      APPROVED:  { bg: 'bg-[var(--success-soft)]',  text: 'text-success',  label: t('purchase.status.approved') },
      REJECTED:  { bg: 'bg-[var(--danger-soft)]',    text: 'text-danger',    label: t('purchase.actions.reject') },
      CONVERTED: { bg: 'bg-[var(--success-soft)]',  text: 'text-success',  label: t('purchase.status.converted') },
      CONFIRMED: { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   label: t('purchase.actions.confirm') },
      PARTIAL:   { bg: 'bg-orange-500/15', text: 'text-warning', label: t('purchase.status.partial') },
      RECEIVED:  { bg: 'bg-green-600/15',  text: 'text-success',  label: t('purchase.status.fullyReceived') },
      UNPAID:    { bg: 'bg-[var(--danger-soft)]',    text: 'text-danger',    label: t('purchase.status.unpaid') },
      PAID:      { bg: 'bg-[var(--success-soft)]',  text: 'text-success',  label: t('purchase.status.paid') },
      OVERDUE:   { bg: 'bg-red-600/15',    text: 'text-danger',    label: t('purchase.status.overdue') },
      CANCELLED: { bg: 'bg-gray-500/15',   text: 'text-[var(--fg-4)]',   label: t('purchase.actions.cancel') },
      ISSUED:    { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: t('purchase.status.issued') },
    }
    const c = cfg[status] || { bg: 'bg-gray-500/15', text: 'text-[var(--fg-3)]', label: status }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>
  }

  // Convert PR → PO Modal
  const ConvertToPOModal = () => (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('purchase.convertToPO.title')}</h2>
            <p className="text-sm text-[var(--fg-3)] mt-0.5">{t('purchase.convertToPO.subtitle')}</p>
          </div>
          <button onClick={() => setConvertPRId(null)} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">
              {t('purchase.common.supplier')} <span className="text-danger">*</span>
            </label>
            <select value={convertForm.supplier_id} onChange={e => setConvertForm(p => ({ ...p, supplier_id: e.target.value }))}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo">
              <option value="">{t('purchase.convertToPO.selectSupplier')}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">{t('purchase.convertToPO.expectedDelivery')}</label>
            <input type="date" value={convertForm.expected_date} onChange={e => setConvertForm(p => ({ ...p, expected_date: e.target.value }))}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">{t('purchase.common.notes')}</label>
            <textarea value={convertForm.notes} onChange={e => setConvertForm(p => ({ ...p, notes: e.target.value }))} rows={2}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo resize-none" />
          </div>
        </div>
        <div className="p-5 border-t border-[var(--border)] flex gap-3">
          <button onClick={() => setConvertPRId(null)} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm transition-colors">{t('purchase.common.cancel')}</button>
          <button onClick={handleDoConvert} disabled={converting || !convertForm.supplier_id}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 transition-colors">
            {converting
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <ArrowRight className="w-4 h-4" />}
            {t('purchase.actions.createOrder')}
          </button>
        </div>
      </motion.div>
    </div>
  )

  // ─── Overview ────────────────────────────────────────────────────
  const OverviewContent = () => {
    const pendingActions = [
      {
        icon: FileText,
        label: t('purchase.overview.pendingRequestsLabel'),
        count: summary?.purchaseRequests.pending || 0,
        color: 'text-warning',
        tab: 'requests' as const,
      },
      {
        icon: ShoppingCart,
        label: t('purchase.overview.pendingOrdersLabel'),
        count: (summary?.purchaseOrders.pending || 0) + (summary?.purchaseOrders.partial || 0),
        color: 'text-blue-400',
        tab: 'orders' as const,
      },
      {
        icon: Receipt,
        label: t('purchase.overview.unpaidInvoicesLabel'),
        count: summary?.invoices.unpaid || 0,
        color: 'text-danger',
        tab: 'invoices' as const,
      },
    ].filter(a => a.count > 0)

    return (
      <div className="space-y-6">
        {/* Metric cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-phopy-indigo/20 to-phopy-indigo-600/20 rounded-xl p-5 border border-phopy-indigo/30">
            <p className="text-sm text-[var(--fg-3)]">{t('purchase.overview.totalOrderAmount')}</p>
            <p className="text-2xl font-bold text-[var(--primary)] mt-1">{formatCurrency(summary?.purchaseOrders.totalAmount || 0)}</p>
            <p className="text-xs text-[var(--fg-4)] mt-1">{t('purchase.overview.orderCount', { count: summary?.purchaseOrders.total || 0 })}</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-5 border border-purple-500/30">
            <p className="text-sm text-[var(--fg-3)]">{t('purchase.overview.pendingRequests')}</p>
            <p className="text-2xl font-bold text-purple-500 mt-1">{summary?.purchaseRequests.pending || 0}</p>
            <p className="text-xs text-[var(--fg-4)] mt-1">{t('purchase.overview.fromTotalRequests', { count: summary?.purchaseRequests.total || 0 })}</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-success/20 to-success/20 rounded-xl p-5 border border-success/30">
            <p className="text-sm text-[var(--fg-3)]">{t('purchase.overview.paidAmount')}</p>
            <p className="text-2xl font-bold text-success mt-1">{formatCurrency(summary?.payments.totalPaid || 0)}</p>
            <p className="text-xs text-[var(--fg-4)] mt-1">{t('purchase.overview.paymentCount', { count: summary?.payments.total || 0 })}</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-5 border border-warning/30">
            <p className="text-sm text-[var(--fg-3)]">{t('purchase.overview.outstandingAmount')}</p>
            <p className="text-2xl font-bold text-warning mt-1">{formatCurrency(summary?.invoices.outstanding || 0)}</p>
            <p className="text-xs text-[var(--fg-4)] mt-1">{t('purchase.overview.unpaidInvoiceCount', { count: summary?.invoices.unpaid || 0 })}</p>
          </motion.div>
        </div>

        {/* Pending actions */}
        {pendingActions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--surface)] border border-warning/30 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-warning mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {t('purchase.overview.pendingActionsTitle')}
            </h3>
            <div className="space-y-2">
              {pendingActions.map(item => (
                <button key={item.label} onClick={() => setActiveTab(item.tab)}
                  className="w-full flex items-center justify-between p-3 bg-[var(--bg)] rounded-xl hover:bg-[var(--bg)]/60 transition-colors group">
                  <div className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-[var(--fg-4)] group-hover:text-[var(--fg-2)] transition-colors" />
                    <span className="text-sm text-[var(--fg-2)] group-hover:text-[var(--fg-1)] transition-colors">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${item.color}`}>{item.count}</span>
                    <ChevronRight className="w-4 h-4 text-[var(--fg-4)] group-hover:text-[var(--fg-3)] transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ความเคลื่อนไหวล่าสุด — แทนแถบ "ขั้นตอนการทำงาน" เดิมที่เป็นตัวเลขเฉย ๆ
            และซ้ำกับตารางสถานะที่อยู่ถัดลงไปอยู่แล้ว */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--primary)]" /> {t('purchase.overview.recentTitle')}
          </h3>
          {(summary?.recentActivity?.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--fg-4)] py-6 text-center">{t('purchase.overview.recentEmpty')}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]/30">
              {summary!.recentActivity!.map(a => {
                const go = ACTIVITY_TARGET[a.kind]
                return (
                  <button key={`${a.kind}-${a.id}`} onClick={() => { setActiveTab(go.tab as any); openModalWithDetail(go.modal, 'view', a.id) }}
                    className="w-full flex items-center gap-3 py-2.5 px-1 text-left rounded-lg hover:bg-[var(--bg)] transition-colors">
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border ${go.tone}`}>{t(go.labelKey)}</span>
                    <span className="font-mono text-xs text-[var(--primary)] shrink-0">{a.doc}</span>
                    <span className="text-sm text-[var(--fg-2)] truncate flex-1 min-w-0">{a.party || '-'}</span>
                    {a.amount != null && (
                      <span className="text-xs font-semibold text-[var(--fg-1)] tabular-nums shrink-0">{formatCurrency(a.amount)}</span>
                    )}
                    <span className="text-[11px] text-[var(--fg-4)] shrink-0 w-20 text-right">{timeAgo(a.updated_at)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </motion.div>
        {/* Status grids */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-[var(--primary)]" /> {t('purchase.overview.orderStatusTitle')}
            </h3>
            <div className="space-y-2">
              {[
                { label: t('purchase.status.draft'), value: summary?.purchaseOrders.draft || 0, color: 'text-[var(--fg-3)]' },
                { label: t('purchase.status.pending'), value: summary?.purchaseOrders.pending || 0, color: 'text-warning' },
                { label: t('purchase.status.partialReceived'), value: summary?.purchaseOrders.partial || 0, color: 'text-warning' },
                { label: t('purchase.status.fullyReceived'), value: summary?.purchaseOrders.received || 0, color: 'text-success' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center p-3 bg-[var(--bg)] rounded-lg">
                  <span className="text-sm text-[var(--fg-3)]">{item.label}</span>
                  <span className={`text-lg font-semibold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-success" /> {t('purchase.overview.paymentStatusTitle')}
            </h3>
            <div className="space-y-2">
              {[
                { label: t('purchase.status.unpaid'), value: summary?.invoices.unpaid || 0, color: 'text-danger' },
                { label: t('purchase.status.partialPaid'), value: summary?.invoices.partial || 0, color: 'text-warning' },
                { label: t('purchase.status.paid'), value: summary?.invoices.paid || 0, color: 'text-success' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center p-3 bg-[var(--bg)] rounded-lg">
                  <span className="text-sm text-[var(--fg-3)]">{item.label}</span>
                  <span className={`text-lg font-semibold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Shared card list helpers ─────────────────────────────────────
  const SearchBar = ({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) => (
    <div className="relative flex-1 max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-3)]" />
      <input type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        className="w-full pl-9 pr-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] placeholder-gray-500 focus:outline-none focus:border-phopy-indigo text-sm" />
    </div>
  )

  const EmptyState = ({ text }: { text: string }) => (
    <div className="text-center py-16 text-[var(--fg-4)] bg-[var(--surface)] border border-[var(--border)] rounded-xl">{text}</div>
  )

  const ViewToggle = () => (
    <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-0.5 shrink-0">
      <button onClick={() => setViewMode('card')}
        className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-phopy-indigo text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-1)]'}`}
        title={t('purchase.view.card')}><LayoutGrid className="w-3.5 h-3.5" /></button>
      <button onClick={() => setViewMode('list')}
        className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-phopy-indigo text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-1)]'}`}
        title={t('purchase.view.list')}><LayoutList className="w-3.5 h-3.5" /></button>
    </div>
  )

  const PageSizeSelect = () => (
    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value) as 25|50|100); setCurrentPage(1) }}
      className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-2)] focus:outline-none focus:border-phopy-indigo">
      <option value={25}>{t('purchase.pagination.perPage', { count: 25 })}</option>
      <option value={50}>{t('purchase.pagination.perPage', { count: 50 })}</option>
      <option value={100}>{t('purchase.pagination.perPage', { count: 100 })}</option>
    </select>
  )

  const Pagination = ({ total }: { total: number }) => {
    const totalPages = Math.ceil(total / pageSize)
    if (totalPages <= 1) return null
    const pages: (number | '...')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('...')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i)
      if (currentPage < totalPages - 2) pages.push('...')
      pages.push(totalPages)
    }
    return (
      <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]/40">
        <p className="text-xs text-[var(--fg-4)]">
          {t('purchase.pagination.showing', { start: Math.min((currentPage - 1) * pageSize + 1, total), end: Math.min(currentPage * pageSize, total), total })}
        </p>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
            className="px-2 py-1 text-xs text-[var(--fg-3)] bg-[var(--bg)] rounded-lg disabled:opacity-30 hover:text-[var(--fg-1)] transition-colors">‹</button>
          {pages.map((p, i) => p === '...'
            ? <span key={`e${i}`} className="px-2 py-1 text-xs text-[var(--fg-4)]">…</span>
            : <button key={p} onClick={() => setCurrentPage(p as number)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${currentPage === p ? 'bg-phopy-indigo text-white font-bold' : 'text-[var(--fg-3)] bg-[var(--bg)] hover:text-[var(--fg-1)]'}`}>
                {p}
              </button>
          )}
          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
            className="px-2 py-1 text-xs text-[var(--fg-3)] bg-[var(--bg)] rounded-lg disabled:opacity-30 hover:text-[var(--fg-1)] transition-colors">›</button>
        </div>
      </div>
    )
  }

  // ─── Document list content components ────────────────────────────
  const RequestsContent = () => {
    const filtered = requests.filter(r =>
      (r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.requester_name?.toLowerCase().includes(searchQuery.toLowerCase()))
      && passesRowFilter(prNextStep(r), false)
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    return (
      <div className="space-y-4">
        {/* ปุ่มสร้างย้ายไปอยู่หัวหน้าเพียงที่เดียว (เปลี่ยนตามแท็บให้เอง) */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.requestsPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          {rowFilterChips(false)}
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.requests')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.requests.headers.number')}</span><span className="col-span-3">{t('purchase.requests.headers.requester')}</span>
              <span className="col-span-1">{t('purchase.requests.headers.requestDate')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-1 text-right">{t('purchase.common.total')}</span><span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((req, i) => (
              <div key={req.id}>
                {/* คลิกแถว = กางเส้นทางเอกสาร · คลิกเลขที่ = เปิดใบนั้น */}
                <div onClick={() => setOpenRow(openRow === req.id ? null : req.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === req.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === req.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModalWithDetail('request', 'view', req.id, req) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{req.pr_number}</button>
                    {req.source === 'LINE' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--success-soft)] text-success border border-green-500/30 leading-none shrink-0">LINE</span>}
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{req.requester_name || req.supplier_name || '-'}</p>
                    <p className="text-[11px] text-[var(--fg-4)] truncate">{req.department || '-'}</p>
                  </div>
                  <p className="col-span-1 text-[var(--fg-3)] text-xs">{formatDate(req.request_date)}</p>
                  <div className="col-span-2"><StagePips view={prStageView(req)} /></div>
                  <p className="col-span-1 text-right text-[var(--fg-1)] font-medium text-xs tabular-nums">{formatCurrency(req.total_amount)}</p>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={prNextStep(req)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('request', 'view', req.id, req) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('pr', req.id) },
                      ...(req.status === 'DRAFT' ? [
                        { label: t('purchase.actions.edit'), onClick: () => openModalWithDetail('request', 'edit', req.id, req) },
                        { label: t('purchase.actions.delete'), onClick: () => handleDeleteRequest(req.id), danger: true },
                      ] : []),
                      ...(canCancelDoc && !['CANCELLED', 'REJECTED'].includes(req.status)
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelRequest(req.id, req.pr_number), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === req.id && expandedTrail('pr', req)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(req => (
              <div key={req.id} className="bg-[var(--surface)] border border-[var(--border)] hover:border-phopy-indigo/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-[var(--fg-4)] font-mono">{req.pr_number}</p>
                      {req.source === 'LINE' && <span className="px-1.5 py-0.5 rounded text-xs bg-[var(--success-soft)] text-success border border-green-500/30 leading-none">LINE</span>}
                    </div>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{req.requester_name || req.supplier_name || '-'}</p>
                    <p className="text-sm text-[var(--fg-3)]">{req.department || req.supplier_name || '-'}</p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-[var(--fg-4)]">
                  <span>{t('purchase.requests.card.requestedOn', { date: formatDate(req.request_date) })}</span>
                  <span>{t('purchase.requests.card.requiredBy', { date: formatDate(req.required_date) })}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div>
                    {req.priority === 'URGENT' && <span className="text-xs text-danger font-semibold"><Zap className="w-4 h-4" /> {t('purchase.priority.urgent')}</span>}
                    {req.priority === 'HIGH' && <span className="text-xs text-warning font-semibold">↑ {t('purchase.priority.high')}</span>}
                  </div>
                  <p className="font-bold text-[var(--fg-1)] text-sm">{formatCurrency(req.total_amount)}</p>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={prStageView(req)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={prNextStep(req)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('request', 'view', req.id, req) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('pr', req.id) },
                      ...(req.status === 'DRAFT' ? [
                        { label: t('purchase.actions.edit'), onClick: () => openModalWithDetail('request', 'edit', req.id, req) },
                        { label: t('purchase.actions.delete'), onClick: () => handleDeleteRequest(req.id), danger: true },
                      ] : []),
                      ...(canCancelDoc && !['CANCELLED', 'REJECTED'].includes(req.status)
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelRequest(req.id, req.pr_number), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  const OrdersContent = () => {
    const filtered = orders.filter(o =>
      (o.po_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))
      && passesRowFilter(poNextStep(o), !!poUnpaidInvoice(o))
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    return (
      <div className="space-y-4">
        {/* ปุ่มสร้างย้ายไปอยู่หัวหน้าเพียงที่เดียว (เปลี่ยนตามแท็บให้เอง) */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.ordersPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          {rowFilterChips(true)}
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.orders')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.orders.headers.poNumber')}</span><span className="col-span-3">{t('purchase.common.supplier')}</span>
              <span className="col-span-1">{t('purchase.orders.headers.orderDate')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-1 text-right">{t('purchase.common.total')}</span><span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((order, i) => (
              <div key={order.id}>
                <div onClick={() => setOpenRow(openRow === order.id ? null : order.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === order.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === order.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModalWithDetail('order', 'view', order.id, order) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{order.po_number}</button>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{order.supplier_name}</p>
                    <p className="text-[11px] text-[var(--fg-4)] truncate">
                      {order.expected_date ? t('purchase.orders.expectedOn', { date: formatDate(order.expected_date) }) : order.supplier_code || '-'}
                    </p>
                  </div>
                  <p className="col-span-1 text-[var(--fg-3)] text-xs">{formatDate(order.order_date)}</p>
                  <div className="col-span-2"><StagePips view={poStageView(order)} /></div>
                  <p className="col-span-1 text-right text-[var(--fg-1)] font-medium text-xs tabular-nums">{formatCurrency(order.total_amount)}</p>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={poNextStep(order)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('order', 'view', order.id, order) },
                      { label: t('purchase.actions.printOrderA4'), onClick: () => handlePrint('po', order.id) },
                      ...(order.status === 'DRAFT' ? [
                        { label: t('purchase.actions.edit'), onClick: () => openModalWithDetail('order', 'edit', order.id, order) },
                        { label: t('purchase.actions.delete'), onClick: () => handleDeleteOrder(order.id), danger: true },
                      ] : []),
                      /* รับของแล้วยกเลิกไม่ได้ — ต้องไปยกเลิกใบรับของก่อน (กฎเดิม ไม่ได้เปลี่ยน) */
                      ...(canCancelDoc && !['CANCELLED', 'RECEIVED', 'PARTIAL'].includes(order.status)
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelOrder(order.id, order.po_number), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === order.id && expandedTrail('po', order)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(order => (
              <div key={order.id} className="bg-[var(--surface)] border border-[var(--border)] hover:border-phopy-indigo/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--fg-4)] font-mono">{order.po_number}</p>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{order.supplier_name}</p>
                    <p className="text-sm text-[var(--fg-3)]">{order.supplier_code}</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-[var(--fg-4)]">
                  <span>{t('purchase.orders.card.orderedOn', { date: formatDate(order.order_date) })}</span>
                  <span>{t('purchase.orders.card.expectedBy', { date: formatDate(order.expected_date) })}</span>
                </div>
                {/* Option A: Procurement chain badges */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {order.linked_pr_id && (() => { const pr = requests.find(r => r.id === order.linked_pr_id); return pr ? (
                    <span className="text-xs font-mono text-[var(--fg-3)] bg-gray-500/10 px-1.5 py-0.5 rounded">
                      {pr.pr_number}
                    </span>
                  ) : null })()}
                  {(() => {
                    const grAll = receipts.filter(r => r.purchase_order_id === order.id)
                    const grDraft = grAll.filter(r => r.status === 'DRAFT')
                    const grConfirmed = grAll.filter(r => r.status === 'CONFIRMED')
                    return (<>
                      {grConfirmed.length > 0 && (
                        <span className="text-xs text-success bg-success/10 px-1.5 py-0.5 rounded">
                          {t('purchase.orders.card.grConfirmed', { count: grConfirmed.length })}
                        </span>
                      )}
                      {grDraft.length > 0 && (
                        <span className="text-xs text-warning bg-[var(--warning-soft)] px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <AlertCircle className="w-2.5 h-2.5" /> {t('purchase.orders.card.grDraft', { count: grDraft.length })}
                        </span>
                      )}
                    </>)
                  })()}
                  {(() => { const invCount = invoices.filter(i => i.purchase_order_id === order.id).length; return invCount > 0 ? (
                    <span className="text-xs text-warning bg-[var(--warning-soft)] px-1.5 py-0.5 rounded">
                      {t('purchase.orders.card.invCount', { count: invCount })}
                    </span>
                  ) : null })()}
                </div>
                <p className="font-bold text-[var(--fg-1)] text-sm mt-2 text-right">{formatCurrency(order.total_amount)}</p>
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={poStageView(order)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={poNextStep(order)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('order', 'view', order.id, order) },
                      { label: t('purchase.actions.printOrderA4'), onClick: () => handlePrint('po', order.id) },
                      ...(order.status === 'DRAFT' ? [
                        { label: t('purchase.actions.edit'), onClick: () => openModalWithDetail('order', 'edit', order.id, order) },
                        { label: t('purchase.actions.delete'), onClick: () => handleDeleteOrder(order.id), danger: true },
                      ] : []),
                      ...(canCancelDoc && !['CANCELLED', 'RECEIVED', 'PARTIAL'].includes(order.status)
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelOrder(order.id, order.po_number), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  const ReceiptsContent = () => {
    const filtered = receipts.filter(r =>
      (r.gr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.po_number?.toLowerCase().includes(searchQuery.toLowerCase()))
      && passesRowFilter(grNextStep(r), false)
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    return (
      <div className="space-y-4">
        {/* ปุ่มสร้างย้ายไปอยู่หัวหน้าเพียงที่เดียว (เปลี่ยนตามแท็บให้เอง) */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.receiptsPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          {rowFilterChips(false)}
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.receipts')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.receipts.headers.grNumber')}</span><span className="col-span-3">{t('purchase.common.supplier')}</span>
              <span className="col-span-2">{t('purchase.receipts.headers.receiptDate')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((receipt, i) => (
              <div key={receipt.id}>
                <div onClick={() => setOpenRow(openRow === receipt.id ? null : receipt.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === receipt.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === receipt.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModalWithDetail('receipt', 'view', receipt.id, receipt) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{receipt.gr_number}</button>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{receipt.supplier_name}</p>
                    <p className="text-[11px] text-[var(--fg-4)] font-mono truncate">{receipt.po_number}</p>
                  </div>
                  <p className="col-span-2 text-[var(--fg-3)] text-xs">{formatDate(receipt.receipt_date)}</p>
                  <div className="col-span-2"><StagePips view={grStageView(receipt)} /></div>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={grNextStep(receipt)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('receipt', 'view', receipt.id, receipt) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('gr', receipt.id, 'a4') },
                      { label: t('purchase.actions.printThermal'), onClick: () => handlePrint('gr', receipt.id, 'thermal') },
                      ...(receipt.status === 'DRAFT'
                        ? [{ label: t('purchase.actions.delete'), onClick: () => handleDeleteReceipt(receipt.id), danger: true }] : []),
                      ...(receipt.status === 'CONFIRMED' && canCancelDoc
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelReceipt(receipt.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === receipt.id && expandedTrail('gr', receipt)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(receipt => (
              <div key={receipt.id} className="bg-[var(--surface)] border border-[var(--border)] hover:border-phopy-indigo/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--fg-4)] font-mono">{receipt.gr_number}</p>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{receipt.supplier_name}</p>
                    <p className="text-sm text-[var(--fg-3)]">PO: {receipt.po_number}</p>
                  </div>
                  <StatusBadge status={receipt.status} />
                </div>
                <p className="text-xs text-[var(--fg-4)] mt-2">{t('purchase.receipts.card.receivedOn', { date: formatDate(receipt.receipt_date) })}</p>
                {receipt.journal_entry_number && (
                  <p className="text-xs text-[var(--primary)]/70 mt-1">{t('purchase.common.journalEntry', { number: receipt.journal_entry_number })}</p>
                )}
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={grStageView(receipt)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={grNextStep(receipt)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('receipt', 'view', receipt.id, receipt) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('gr', receipt.id, 'a4') },
                      { label: t('purchase.actions.printThermal'), onClick: () => handlePrint('gr', receipt.id, 'thermal') },
                      ...(receipt.status === 'DRAFT'
                        ? [{ label: t('purchase.actions.delete'), onClick: () => handleDeleteReceipt(receipt.id), danger: true }] : []),
                      ...(receipt.status === 'CONFIRMED' && canCancelDoc
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelReceipt(receipt.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  const InvoicesContent = () => {
    const filtered = invoices.filter(i =>
      (i.pi_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()))
      && passesRowFilter(invNextStep(i), i.balance_amount > 0 && i.status !== 'CANCELLED')
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    return (
      <div className="space-y-4">
        {/* ปุ่มสร้างย้ายไปอยู่หัวหน้าเพียงที่เดียว (เปลี่ยนตามแท็บให้เอง) */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.invoicesPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          {rowFilterChips(true)}
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.invoices')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.invoices.headers.piNumber')}</span><span className="col-span-2">{t('purchase.common.supplier')}</span>
              <span className="col-span-2">{t('purchase.invoices.headers.dueDate')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-1 text-right">{t('purchase.invoices.headers.balance')}</span><span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((invoice, i) => (
              <div key={invoice.id}>
                <div onClick={() => setOpenRow(openRow === invoice.id ? null : invoice.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === invoice.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === invoice.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModalWithDetail('invoice', 'view', invoice.id, invoice) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{invoice.pi_number}</button>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{invoice.supplier_name}</p>
                    <p className="text-[11px] text-[var(--fg-4)] font-mono truncate">{invoice.po_number}</p>
                  </div>
                  <p className={`col-span-2 text-xs ${invoice.payment_status === 'UNPAID' ? 'text-danger' : 'text-[var(--fg-3)]'}`}>{formatDate(invoice.due_date)}</p>
                  <div className="col-span-2"><StagePips view={invStageView(invoice)} /></div>
                  <p className={`col-span-1 text-right text-xs font-bold tabular-nums ${invoice.balance_amount > 0 ? 'text-danger' : 'text-[var(--fg-4)]'}`}>
                    {invoice.balance_amount > 0 ? formatCurrency(invoice.balance_amount) : '-'}
                  </p>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={invNextStep(invoice)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('invoice', 'view', invoice.id, invoice) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('pi', invoice.id) },
                      ...(invoice.status !== 'CANCELLED' && canCancelDoc
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelInvoice(invoice.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === invoice.id && expandedTrail('inv', invoice)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(invoice => (
              <div key={invoice.id} className={`bg-[var(--surface)] border rounded-xl p-4 transition-colors flex flex-col ${invoice.payment_status === 'UNPAID' ? 'border-danger/30 hover:border-red-400/50' : 'border-[var(--border)] hover:border-phopy-indigo/40'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--fg-4)] font-mono">{invoice.pi_number}</p>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{invoice.supplier_name}</p>
                    <p className="text-sm text-[var(--fg-3)]">PO: {invoice.po_number}</p>
                  </div>
                  <StatusBadge status={invoice.status === 'CANCELLED' ? 'CANCELLED' : invoice.payment_status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-[var(--fg-4)]">
                  <span>{t('purchase.invoices.card.issuedOn', { date: formatDate(invoice.invoice_date) })}</span>
                  <span>{t('purchase.invoices.card.dueOn', { date: formatDate(invoice.due_date) })}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-[var(--fg-4)]">{t('purchase.invoices.card.totalAmount', { amount: formatCurrency(invoice.total_amount) })}</span>
                  {invoice.balance_amount > 0 && (
                    <span className="text-sm font-bold text-danger">{t('purchase.invoices.card.balanceAmount', { amount: formatCurrency(invoice.balance_amount) })}</span>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={invStageView(invoice)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={invNextStep(invoice)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModalWithDetail('invoice', 'view', invoice.id, invoice) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('pi', invoice.id) },
                      ...(invoice.status !== 'CANCELLED' && canCancelDoc
                        ? [{ label: t('purchase.actions.cancel'), onClick: () => handleCancelInvoice(invoice.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  const PaymentsContent = () => {
    const filtered = payments.filter(p =>
      p.payment_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const methodLabel: Record<string, string> = { CASH: t('purchase.paymentMethod.cash'), TRANSFER: t('purchase.paymentMethod.transfer'), CHEQUE: t('purchase.paymentMethod.cheque'), CREDIT_CARD: t('purchase.paymentMethod.creditCard') }
    return (
      <div className="space-y-4">
        {/* ใบจ่ายเงินเป็นปลายทาง ไม่มีอะไรค้างให้ทำ จึงไม่มีชิปกรอง — โครงแถบเหมือนแท็บอื่น */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.paymentsPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.payments')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.payments.headers.number')}</span><span className="col-span-3">{t('purchase.common.supplier')}</span>
              <span className="col-span-1">{t('purchase.payments.headers.date')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-1 text-right">{t('purchase.payments.headers.amount')}</span>
              <span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((payment, i) => (
              <div key={payment.id}>
                <div onClick={() => setOpenRow(openRow === payment.id ? null : payment.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === payment.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === payment.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModal('payment', 'view', payment) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{payment.payment_number}</button>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{payment.supplier_name}</p>
                    <p className="text-[11px] text-[var(--fg-4)] truncate">
                      {methodLabel[payment.payment_method] || payment.payment_method}
                      {payment.pi_number ? ` · ${payment.pi_number}` : ''}
                    </p>
                  </div>
                  <p className="col-span-1 text-[var(--fg-3)] text-xs">{formatDate(payment.payment_date)}</p>
                  <div className="col-span-2"><StagePips view={payStageView(payment)} /></div>
                  <p className="col-span-1 text-right text-success font-bold text-xs tabular-nums">{formatCurrency(payment.amount)}</p>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={payNextStep(payment)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModal('payment', 'view', payment) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('payment', payment.id) },
                      ...(canCancelDoc ? [{ label: t('purchase.actions.void'), onClick: () => handleVoidPayment(payment.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === payment.id && expandedTrail('pay', payment)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(payment => (
              <div key={payment.id} className="bg-[var(--surface)] border border-[var(--border)] hover:border-phopy-indigo/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--fg-4)] font-mono">{payment.payment_number}</p>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{payment.supplier_name}</p>
                    <p className="text-sm text-[var(--fg-3)]">{methodLabel[payment.payment_method] || payment.payment_method}</p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--success-soft)] text-success">{t('purchase.status.paid')}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-[var(--fg-4)]">{formatDate(payment.payment_date)}</span>
                  <span className="font-bold text-success text-sm">{formatCurrency(payment.amount)}</span>
                </div>
                {payment.journal_entry_number && (
                  <p className="text-xs text-[var(--primary)]/70 mt-1">{t('purchase.common.journalEntry', { number: payment.journal_entry_number })}</p>
                )}
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={payStageView(payment)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={payNextStep(payment)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModal('payment', 'view', payment) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('payment', payment.id) },
                      ...(canCancelDoc ? [{ label: t('purchase.actions.void'), onClick: () => handleVoidPayment(payment.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  const ReturnsContent = () => {
    const filtered = returns.filter(r => passesRowFilter(retNextStep(r), false) &&
      r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const reasonLabel: Record<string, string> = {
      DEFECTIVE: t('purchase.returnReason.defective'), WRONG_ITEM: t('purchase.returnReason.wrongItem'),
      WRONG_QUANTITY: t('purchase.returnReason.wrongQuantity'), QUALITY_ISSUE: t('purchase.returnReason.qualityIssue'),
      EXPIRED: t('purchase.returnReason.expired'), OTHER: t('purchase.returnReason.other')
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBar placeholder={t('purchase.search.returnsPlaceholder')} value={searchQuery} onChange={setSearchQuery} />
          {rowFilterChips(false)}
          <div className="flex items-center gap-2 ml-auto">
            <PageSizeSelect />
            <ViewToggle />
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState text={t('purchase.empty.returns')} /> : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
              <span className="col-span-2">{t('purchase.returns.headers.number')}</span><span className="col-span-3">{t('purchase.common.supplier')}</span>
              <span className="col-span-1">{t('purchase.returns.headers.date')}</span><span className="col-span-2">{t('purchase.common.progress')}</span>
              <span className="col-span-1 text-right">{t('purchase.returns.headers.amount')}</span>
              <span className="col-span-2">{t('purchase.common.nextStep')}</span><span className="col-span-1"></span>
            </div>
            {paginated.map((ret, i) => (
              <div key={ret.id}>
                <div onClick={() => setOpenRow(openRow === ret.id ? null : ret.id)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-[var(--border)]/20 cursor-pointer transition-colors ${openRow === ret.id ? 'bg-[var(--surface-2)]' : i % 2 === 1 ? 'bg-[var(--surface-2)]/20 hover:bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <ChevronRight className={`w-3 h-3 shrink-0 text-[var(--fg-4)] transition-transform ${openRow === ret.id ? 'rotate-90' : ''}`} />
                    <button onClick={e => { e.stopPropagation(); openModal('return', 'view', ret) }}
                      className="font-mono text-xs text-[var(--primary)] hover:underline text-left truncate">{ret.pr_number}</button>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-[var(--fg-1)] font-medium truncate">{ret.supplier_name}</p>
                    <p className="text-[11px] text-[var(--fg-4)] truncate">
                      <span className="font-mono">{ret.po_number}</span>
                      {ret.reason ? ` · ${reasonLabel[ret.reason] || ret.reason}` : ''}
                    </p>
                  </div>
                  <p className="col-span-1 text-[var(--fg-3)] text-xs">{formatDate(ret.return_date)}</p>
                  <div className="col-span-2"><StagePips view={retStageView(ret)} /></div>
                  <p className="col-span-1 text-right text-danger font-bold text-xs tabular-nums">{formatCurrency(ret.total_amount)}</p>
                  <div className="col-span-2" onClick={e => e.stopPropagation()}><NextStepCell step={retNextStep(ret)} /></div>
                  <div className="col-span-1" onClick={e => e.stopPropagation()}>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModal('return', 'view', ret) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('return', ret.id) },
                      ...(ret.status === 'DRAFT' ? [{ label: t('purchase.actions.delete'), onClick: () => handleDeleteReturn(ret.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
                {openRow === ret.id && expandedTrail('ret', ret)}
              </div>
            ))}          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(ret => (
              <div key={ret.id} className="bg-[var(--surface)] border border-[var(--border)] hover:border-danger/30 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--fg-4)] font-mono">{ret.pr_number}</p>
                    <p className="font-semibold text-[var(--fg-1)] mt-0.5 truncate">{ret.supplier_name}</p>
                    <p className="text-sm text-[var(--fg-3)]">PO: {ret.po_number}</p>
                  </div>
                  <StatusBadge status={ret.status} />
                </div>
                <p className="text-xs text-warning/80 mt-1">{reasonLabel[ret.reason] || ret.reason}</p>
                <p className="font-bold text-danger text-sm mt-2 text-right">{formatCurrency(ret.total_amount)}</p>
                <div className="mt-3 pt-3 border-t border-[var(--border)]/40 space-y-2">
                  <StagePips view={retStageView(ret)} />
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><NextStepCell step={retNextStep(ret)} /></div>
                    <RowMenu label={t('purchase.rowMenu.more')} items={[
                      { label: t('purchase.actions.viewDetails'), onClick: () => openModal('return', 'view', ret) },
                      { label: t('purchase.actions.printA4'), onClick: () => handlePrint('return', ret.id) },
                      ...(ret.status === 'DRAFT' ? [{ label: t('purchase.actions.delete'), onClick: () => handleDeleteReturn(ret.id), danger: true }] : []),
                    ]} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination total={filtered.length} />
      </div>
    )
  }

  // ─── 1. Request Modal ────────────────────────────────────────────────────────
  const RequestModal = () => (
    <ModalShell
      title={modalMode === 'create' ? t('purchase.requestModal.titleCreate') : modalMode === 'edit' ? t('purchase.requestModal.titleEdit') : t('purchase.requestModal.titleView')}
      onClose={closeModal}
      footer={
        modalMode === 'create' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            <button onClick={() => submitRequestFlow()} disabled={formLoading}
              className="px-4 py-2.5 text-[var(--fg-2)] hover:text-[var(--fg-1)] bg-[var(--bg)] rounded-xl disabled:opacity-50 text-sm font-medium min-h-[44px]">
              {t('purchase.actions.saveDraft')}
            </button>
            <SubmitSplitButton
              primaryLabel={t('purchase.actions.submitForApproval')}
              primaryDisabled={formLoading}
              loading={formLoading}
              onPrimary={() => submitRequestFlow('PENDING')}
              approveLabel={t('purchase.actions.submitAndApprove')}
              approveEnabled={selfApprove.allowed && !formLoading}
              approveReason={selfApprove.allowed ? t('purchase.selfApprove.readyNote') : (selfApprove.reason || t('purchase.selfApprove.checking'))}
              onApprove={() => { setSubmitMenuOpen(false); submitRequestFlow('APPROVED') }}
              menuOpen={submitMenuOpen}
              onToggleMenu={() => setSubmitMenuOpen(o => !o)}
              moreOptionsLabel={t('purchase.actions.moreSubmitOptions')}
            />
          </div>
        ) : modalMode === 'edit' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            <button onClick={handleUpdateRequest} disabled={formLoading}
              className="px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {t('purchase.common.save')}
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.close')}</button>
      }
    >
      {/* Header info row */}
{/* แนบรูป — ใช้คอมโพเนนต์ตัวเดียวกับสลิปจ่ายเงิน รับเฉพาะไฟล์ภาพสามัญ */}
      {modalMode === 'view' && modalData?.id && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">{t('purchase.attachments.title')}</h3>
            <span className="text-xs text-[var(--fg-4)]">{t('purchase.attachments.hint')}</span>
          </div>
          <PaymentAttachments dense refType="PURCHASE_REQUEST" refId={modalData?.id} />
        </div>
      )}

      {modalMode === 'view' && modalData?.pr_number && (
        <div className="flex items-center gap-2 p-3 bg-phopy-indigo/10 border border-phopy-indigo-50 rounded-xl">
          <FileText className="w-4 h-4 text-[var(--primary)] shrink-0" />
          <span className="text-sm font-mono text-[var(--primary)] font-semibold">{modalData.pr_number}</span>
          <span className="text-xs text-[var(--fg-3)] ml-auto">{t('purchase.requestModal.createdBy', { name: modalData.requester_name })}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('purchase.requestModal.department')}>
          <input type="text" value={requestForm.department} onChange={e => setRequestForm(p => ({ ...p, department: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} placeholder={t('purchase.requestModal.departmentPlaceholder')} />
        </Field>
        <Field label={t('purchase.requestModal.requiredDate')} required>
          <input type="date" value={requestForm.required_date} onChange={e => setRequestForm(p => ({ ...p, required_date: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} />
        </Field>
        <Field label={t('purchase.requestModal.priority')}>
          <select value={requestForm.priority} onChange={e => setRequestForm(p => ({ ...p, priority: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')}>
            <option value="LOW">{t('purchase.priority.low')}</option>
            <option value="NORMAL">{t('purchase.priority.normal')}</option>
            <option value="HIGH">{t('purchase.priority.high')}</option>
            <option value="URGENT">{t('purchase.priority.urgent')}</option>
          </select>
        </Field>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-[var(--fg-2)]">{t('purchase.requestModal.preferredSupplier')}</label>
            {modalMode !== 'view' && (
              <button onClick={() => openQuickAddSupplier(id => setRequestForm(p => ({ ...p, preferred_supplier_id: id })))}
                className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1 px-2 py-0.5 border border-phopy-indigo/30 rounded-lg hover:bg-phopy-indigo/10 transition-colors">
                <Plus className="w-3 h-3" /> {t('purchase.actions.addNew')}
              </button>
            )}
          </div>
          <SupplierSearchInput suppliers={suppliers}
            value={requestForm.preferred_supplier_id}
            onChange={id => setRequestForm(p => ({ ...p, preferred_supplier_id: id }))}
            disabled={modalMode === 'view'}
            placeholder={t('purchase.requestModal.supplierPlaceholder')}
          />
        </div>
      </div>

      <Field label={t('purchase.requestModal.notes')}>
        <textarea value={requestForm.notes} onChange={e => setRequestForm(p => ({ ...p, notes: e.target.value }))}
          disabled={modalMode === 'view'} rows={2} className={`${inputCls(modalMode === 'view')} resize-none`}
          placeholder={t('purchase.requestModal.notesPlaceholder')} />
      </Field>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-[var(--fg-2)]">{t('purchase.requestModal.itemsTitle')}
            <span className="ml-2 text-xs text-[var(--fg-4)]">{t('purchase.common.itemCount', { count: requestForm.items.length })}</span>
          </span>
          {modalMode !== 'view' && (
            <button onClick={addRequestItem}
              className="flex items-center gap-1 px-2.5 py-1 bg-phopy-indigo/10 text-[var(--primary)] text-xs rounded-lg hover:bg-[var(--primary-soft)] transition-colors">
              <Plus className="w-3 h-3" /> {t('purchase.actions.addItem')}
            </button>
          )}
        </div>
        <div className="space-y-3">
          {requestForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-[var(--bg)] rounded-xl space-y-2 border border-[var(--border)]/40">
              {/* Row 1: material + description */}
              <div className="grid grid-cols-2 gap-2">
                <MaterialSearchInput materials={materials}
                  value={item.material_id}
                  disabled={modalMode === 'view'}
                  onChange={(id, mat) => updateRequestItemFields(index, {
                    material_id: id,
                    unit: item.unit || mat?.unit,
                    description: mat ? mat.name : ''
                  })}
                  onAddNew={modalMode !== 'view' ? (q) => openQuickAddStock(
                    (newItem) => updateRequestItemFields(index, {
                      material_id: newItem.id,
                      description: newItem.name,
                      unit: newItem.unit,
                      estimated_unit_price: newItem.unitCost || item.estimated_unit_price,
                    }),
                    { name: q }
                  ) : undefined}
                />
                <input type="text" placeholder={t('purchase.requestModal.itemDescriptionPlaceholder')} value={item.description}
                  onChange={e => updateRequestItem(index, 'description', e.target.value)}
                  disabled={modalMode === 'view'}
                  className="w-full px-2.5 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
              </div>
              {/* Row 2: qty + unit + price + total + delete */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.quantity')}</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateRequestItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    disabled={modalMode === 'view'}
                    className="w-full px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] text-center focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.unit')}</label>
                  <UnitPicker
                    value={item.unit || ''}
                    onChange={u => updateRequestItem(index, 'unit', u)}
                    materialId={item.material_id || null}
                    disabled={modalMode === 'view'}
                    size="sm"
                    placeholder={t('purchase.common.selectUnit')}
                    baseUnit={materials.find(m => m.id === item.material_id)?.baseUnit}
                    restrict="strict"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.requestModal.estimatedUnitPrice')}</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.estimated_unit_price}
                      onChange={e => updateRequestItem(index, 'estimated_unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full pl-5 pr-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
                  </div>
                </div>
                <div className="col-span-4 flex items-end justify-between">
                  <div>
                    <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.lineTotal')}</label>
                    <span className="text-sm font-semibold text-[var(--primary)]">{formatCurrency(item.estimated_total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <button onClick={() => removeRequestItem(index)}
                      className="p-1.5 hover:bg-[var(--danger-soft)] rounded-lg text-danger transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {requestForm.items.length === 0 && (
            <div className="text-center py-6 text-[var(--fg-4)] text-sm border border-dashed border-[var(--border)] rounded-xl">
              {t('purchase.common.noItemsYet')}
            </div>
          )}
        </div>
        {requestForm.items.length > 0 && (
          <div className="flex justify-end mt-3 p-3 bg-phopy-indigo/5 rounded-xl">
            <div className="text-right">
              <p className="text-xs text-[var(--fg-3)]">{t('purchase.requestModal.totalEstimate')}</p>
              <p className="text-lg font-bold text-[var(--primary)]">
                {formatCurrency(requestForm.items.reduce((s, i) => s + i.estimated_total_price, 0))}
              </p>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )

  const OrderModal = () => {
    const subtotal   = orderForm.items.reduce((s, i) => s + i.total_price, 0)
    const afterDisc  = subtotal - (orderForm.discount || 0)
    const taxAmount  = afterDisc * (orderForm.tax_rate / 100)
    const grandTotal = afterDisc + taxAmount
    return (
    <ModalShell
      title={modalMode === 'create' ? t('purchase.orderModal.titleCreate') : modalMode === 'edit' ? t('purchase.orderModal.titleEdit') : t('purchase.orderModal.titleView')}
      onClose={closeModal}
      footer={
        modalMode === 'create' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            <button onClick={() => submitOrderFlow()} disabled={formLoading || !orderForm.supplier_id || orderForm.items.length === 0}
              className="px-4 py-2.5 text-[var(--fg-2)] hover:text-[var(--fg-1)] bg-[var(--bg)] rounded-xl disabled:opacity-50 text-sm font-medium min-h-[44px]">
              {t('purchase.actions.saveDraft')}
            </button>
            <SubmitSplitButton
              primaryLabel={t('purchase.actions.submitForApproval')}
              primaryDisabled={formLoading || !orderForm.supplier_id || orderForm.items.length === 0}
              loading={formLoading}
              onPrimary={() => submitOrderFlow('SUBMITTED')}
              approveLabel={t('purchase.actions.submitAndApprove')}
              approveEnabled={selfApprove.allowed && !formLoading && !!orderForm.supplier_id && orderForm.items.length > 0}
              approveReason={selfApprove.allowed ? t('purchase.selfApprove.readyNote') : (selfApprove.reason || t('purchase.selfApprove.checking'))}
              onApprove={() => { setSubmitMenuOpen(false); submitOrderFlow('APPROVED') }}
              menuOpen={submitMenuOpen}
              onToggleMenu={() => setSubmitMenuOpen(o => !o)}
              moreOptionsLabel={t('purchase.actions.moreSubmitOptions')}
            />
          </div>
        ) : modalMode === 'edit' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            <button onClick={handleUpdateOrder} disabled={formLoading || !orderForm.supplier_id || orderForm.items.length === 0}
              className="px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {t('purchase.orderModal.saveEdit')}
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.close')}</button>
      }
    >
      {/* PO header display when viewing */}
{/* แนบรูป — ใช้คอมโพเนนต์ตัวเดียวกับสลิปจ่ายเงิน รับเฉพาะไฟล์ภาพสามัญ */}
      {modalMode === 'view' && modalData?.id && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">{t('purchase.attachments.title')}</h3>
            <span className="text-xs text-[var(--fg-4)]">{t('purchase.attachments.hint')}</span>
          </div>
          <PaymentAttachments dense refType="PURCHASE_ORDER" refId={modalData?.id} />
        </div>
      )}

      {modalMode === 'view' && modalData?.po_number && (
        <>
          <div className="flex items-center gap-2 p-3 bg-phopy-indigo/10 border border-phopy-indigo-50 rounded-xl">
            <ShoppingCart className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <span className="text-sm font-mono text-[var(--primary)] font-semibold">{modalData.po_number}</span>
            <span className="text-xs text-[var(--fg-3)] ml-auto">{modalData.supplier_name}</span>
          </div>
          {/* อยู่ขั้นไหนแล้ว + ข้ามอะไรไป — แพทเทิร์นเดียวกับหน้าใบสั่งขาย */}
          <POStatusFlow status={modalData.status} />
          <PurchaseTrail poId={modalData.id} />
        </>
      )}

      {/* PR Reference — create mode only */}
      {modalMode === 'create' && (
        <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-1.5">
          <label className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> {t('purchase.orderModal.prReference')}
          </label>
          <PRSearchInput
            requests={requests.filter(r => r.status !== 'REJECTED' && r.status !== 'CANCELLED')}
            value={orderForm.linked_pr_id}
            onChange={(id) => handleSelectPR(id)}
          />
          {orderForm.linked_pr_id && (
            <p className="text-xs text-blue-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {t('purchase.orderModal.prLoaded')}
            </p>
          )}
        </div>
      )}

      {/* Supplier + delivery */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-[var(--fg-2)]">{t('purchase.common.supplier')} <span className="text-danger">*</span></label>
            {modalMode !== 'view' && (
              <button onClick={() => openQuickAddSupplier(id => setOrderForm(p => ({ ...p, supplier_id: id })))}
                className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1 px-2 py-0.5 border border-phopy-indigo/30 rounded-lg hover:bg-phopy-indigo/10 transition-colors">
                <Plus className="w-3 h-3" /> {t('purchase.actions.addSupplier')}
              </button>
            )}
          </div>
          <SupplierSearchInput suppliers={suppliers} value={orderForm.supplier_id}
            onChange={id => setOrderForm(p => ({ ...p, supplier_id: id }))}
            disabled={modalMode === 'view'}
            placeholder={t('purchase.orderModal.supplierPlaceholder')} />
        </div>
        <Field label={t('purchase.orderModal.expectedDelivery')}>
          <input type="date" value={orderForm.expected_date}
            onChange={e => setOrderForm(p => ({ ...p, expected_date: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} />
        </Field>
        <Field label={t('purchase.orderModal.paymentTerms')}>
          <select value={orderForm.payment_terms}
            onChange={e => setOrderForm(p => ({ ...p, payment_terms: parseInt(e.target.value) }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')}>
            <option value={0}>{t('purchase.orderModal.paymentTermsCod')}</option>
            <option value={15}>{t('purchase.orderModal.paymentTermsNet15')}</option>
            <option value={30}>{t('purchase.orderModal.paymentTermsNet30')}</option>
            <option value={45}>{t('purchase.orderModal.paymentTermsNet45')}</option>
            <option value={60}>{t('purchase.orderModal.paymentTermsNet60')}</option>
          </select>
        </Field>
      </div>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-[var(--fg-2)]">{t('purchase.orderModal.itemsTitle')}
            <span className="ml-2 text-xs text-[var(--fg-4)]">{t('purchase.common.itemCount', { count: orderForm.items.length })}</span>
          </span>
          {modalMode !== 'view' && (
            <button onClick={addOrderItem}
              className="flex items-center gap-1 px-2.5 py-1 bg-phopy-indigo/10 text-[var(--primary)] text-xs rounded-lg hover:bg-[var(--primary-soft)]">
              <Plus className="w-3 h-3" /> {t('purchase.actions.addItem')}
            </button>
          )}
        </div>
        <div className="space-y-3">
          {orderForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-[var(--bg)] rounded-xl space-y-2 border border-[var(--border)]/40">
              <div className="grid grid-cols-2 gap-2">
                <MaterialSearchInput materials={materials} value={item.material_id} disabled={modalMode === 'view'}
                  onChange={(id, mat) => updateOrderItemFields(index, {
                    material_id: id,
                    description: mat ? mat.name : '',
                    unit: item.unit || mat?.unit,
                    unit_price: mat?.unitCost && item.unit_price === 0 ? mat.unitCost : item.unit_price,
                  })}
                  onAddNew={modalMode !== 'view' ? (q) => openQuickAddStock(
                    (newItem) => {
                      updateOrderItemFields(index, {
                        material_id: newItem.id,
                        description: newItem.name,
                        unit: newItem.unit,
                        unit_price: newItem.unitCost && item.unit_price === 0 ? newItem.unitCost : item.unit_price,
                      })
                    },
                    { name: q }
                  ) : undefined}
                />
                <input type="text" placeholder={t('purchase.orderModal.itemDescriptionPlaceholder')} value={item.description}
                  onChange={e => updateOrderItem(index, 'description', e.target.value)}
                  disabled={modalMode === 'view'}
                  className="w-full px-2.5 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
              </div>
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.quantity')}</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateOrderItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    disabled={modalMode === 'view'}
                    className="w-full px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] text-center focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.unit')}</label>
                  <UnitPicker
                    value={item.unit || ''}
                    onChange={u => updateOrderItem(index, 'unit', u)}
                    materialId={item.material_id || null}
                    disabled={modalMode === 'view'}
                    size="sm"
                    placeholder={t('purchase.common.selectUnit')}
                    baseUnit={materials.find(m => m.id === item.material_id)?.baseUnit}
                    restrict="strict"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.orderModal.unitPrice')}</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.unit_price}
                      onChange={e => updateOrderItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full pl-5 pr-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo disabled:opacity-50" />
                  </div>
                </div>
                <div className="col-span-5 flex items-end justify-between">
                  <div>
                    <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.lineTotal')}</label>
                    <span className="text-sm font-semibold text-[var(--primary)]">{formatCurrency(item.total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <button onClick={() => removeOrderItem(index)}
                      className="p-1.5 hover:bg-[var(--danger-soft)] rounded-lg text-danger transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {orderForm.items.length === 0 && (
            <div className="text-center py-6 text-[var(--fg-4)] text-sm border border-dashed border-[var(--border)] rounded-xl">
              {t('purchase.common.noItemsYet')}
            </div>
          )}
        </div>
      </div>

      {/* Amounts breakdown */}
      {orderForm.items.length > 0 && (
        <div className="p-4 bg-[var(--bg)] rounded-xl space-y-2 text-sm">
          <div className="flex justify-between text-[var(--fg-3)]">
            <span>{t('purchase.orderModal.subtotal')}</span><span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between gap-2 items-center">
            <span className="text-[var(--fg-3)]">{t('purchase.orderModal.discount')}</span>
            {modalMode !== 'view' ? (
              <div className="relative w-32">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-xs">฿</span>
                <input type="number" min="0" value={orderForm.discount}
                  onChange={e => setOrderForm(p => ({ ...p, discount: parseFloat(e.target.value) || 0 }))}
                  className="w-full pl-5 pr-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo text-right" />
              </div>
            ) : <span className="text-warning">-{formatCurrency(orderForm.discount)}</span>}
          </div>
          <div className="flex justify-between gap-2 items-center">
            <span className="text-[var(--fg-3)]">{t('purchase.orderModal.tax')}</span>
            {modalMode !== 'view' ? (
              <div className="relative w-32">
                <input type="number" min="0" max="30" value={orderForm.tax_rate}
                  onChange={e => setOrderForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo text-right" />
              </div>
            ) : <span className="text-[var(--fg-2)]">VAT {orderForm.tax_rate}% = {formatCurrency(taxAmount)}</span>}
          </div>
          <div className="flex justify-between font-bold text-[var(--fg-1)] border-t border-[var(--border)] pt-2">
            <span>{t('purchase.common.grandTotal')}</span>
            <span className="text-lg text-[var(--primary)]">{formatCurrency(grandTotal)}</span>
          </div>
        </div>
      )}

      <Field label={t('purchase.common.notes')}>
        <textarea value={orderForm.notes} onChange={e => setOrderForm(p => ({ ...p, notes: e.target.value }))}
          disabled={modalMode === 'view'} rows={2} className={`${inputCls(modalMode === 'view')} resize-none`} />
      </Field>
    </ModalShell>
    )
  }

  // ─── 3. Receipt Modal ────────────────────────────────────────────────────────
  const ReceiptModal = () => {
    const selectedPO = orders.find(o => o.id === receiptForm.purchase_order_id)
    const updateItem = (index: number, field: keyof ReceiptItem, value: any) =>
      setReceiptForm(p => ({ ...p, items: p.items.map((it, i) => i === index ? { ...it, [field]: value } : it) }))

    return (
    <ModalShell
      title={t('purchase.receiptModal.title')}
      onClose={closeModal}
      footer={
        <div className="flex justify-between items-center w-full">
          <span className="text-xs text-[var(--fg-4)]">
            {receiptForm.items.length > 0
              ? t('purchase.receiptModal.footerSummary', { count: receiptForm.items.length, qty: receiptForm.items.reduce((s, i) => s + i.accepted_qty, 0).toFixed(2) })
              : t('purchase.receiptModal.footerSelectPO')}
          </span>
          <div className="flex gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            {modalMode === 'view' && modalData?.status === 'DRAFT' ? (
              <button onClick={() => handleConfirmReceipt(modalData.id)}
                disabled={formLoading}
                className="px-6 py-2.5 bg-success text-white font-semibold rounded-xl hover:bg-success/80 disabled:opacity-50 flex items-center gap-2 text-sm">
                {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                <Check className="w-4 h-4" /> {t('purchase.receiptModal.confirmReceipt')}
              </button>
            ) : modalMode === 'create' ? (
              <button onClick={handleCreateReceipt}
                disabled={formLoading || !receiptForm.purchase_order_id || receiptForm.items.length === 0}
                className="px-6 py-2.5 bg-success text-white font-semibold rounded-xl hover:bg-success/80 disabled:opacity-50 flex items-center gap-2 text-sm">
                {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                <Check className="w-4 h-4" /> {t('purchase.receiptModal.confirmReceipt')}
              </button>
            ) : (
              <button onClick={closeModal}
                className="px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 flex items-center gap-2 text-sm">
                {t('purchase.common.close')}
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* เส้นทางเอกสารชุดเดียวกับโมดัลอื่น — เห็นทันทีว่าใบนี้เดินมาถึงไหน */}
      {receiptForm.purchase_order_id && <PurchaseTrail poId={receiptForm.purchase_order_id} />}

      {/* แนบรูป — คอมโพเนนต์เดียวกับสลิปจ่ายเงิน รับเฉพาะไฟล์ภาพสามัญ */}
      {modalMode === 'view' && modalData?.id && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">{t('purchase.attachments.title')}</h3>
            <span className="text-xs text-[var(--fg-4)]">{t('purchase.attachments.hint')}</span>
          </div>
          <PaymentAttachments dense refType="GOODS_RECEIPT" refId={modalData.id} />
        </div>
      )}


      {/* ── Section 1: เลือก PO ── */}
      <div className="space-y-3">
        <Field label={t('purchase.receiptModal.selectPO')} required>
          <POSearchInput
            // Bug: a PO that already has a pending DRAFT GR stayed in this list forever —
            // picking it again looked fine (items loaded) but the backend rejects a 2nd
            // DRAFT GR for the same PO on submit ("มีใบรับสินค้าร่าง ... รออยู่"), so the
            // create button looked dead. The card-view "รับสินค้า" button already swaps
            // to "ยืนยันใบรับ" for such POs (see draftReceipt check above) — mirror that
            // rule here so the dropdown can't offer the same dead end.
            orders={orders.filter(o => ['SUBMITTED', 'APPROVED', 'PARTIAL'].includes(o.status)
              && !receipts.some(r => r.purchase_order_id === o.id && r.status === 'DRAFT'))}
            value={receiptForm.purchase_order_id}
            onChange={id => { setReceiptForm(p => ({ ...p, purchase_order_id: id, items: [] })); if (id) loadPendingItems(id) }}
            emptyMessage={t('purchase.receiptModal.noEligiblePO')}
          />
        </Field>

        {/* PO summary */}
        {selectedPO && (
          <div className="grid grid-cols-4 gap-3 p-3 bg-success/5 border border-success-soft rounded-xl text-sm">
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.common.supplier')}</p>
              <p className="text-[var(--fg-1)] font-medium truncate">{selectedPO.supplier_name}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.receiptModal.poValue')}</p>
              <p className="text-[var(--primary)] font-semibold">{formatCurrency(selectedPO.total_amount)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.receiptModal.poDeliveryDate')}</p>
              <p className="text-[var(--fg-1)]">{selectedPO.expected_date ? new Date(selectedPO.expected_date).toLocaleDateString('th-TH') : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.common.status')}</p>
              <p className={`text-xs font-medium ${selectedPO.status === 'PARTIAL' ? 'text-warning' : 'text-success'}`}>
                {selectedPO.status === 'PARTIAL' ? t('purchase.receiptModal.partialReceived') : t('purchase.receiptModal.waitingForReceipt')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: ข้อมูลการรับ ── */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('purchase.receiptModal.receiptDate')}>
          <input type="date" value={receiptForm.receipt_date}
            onChange={e => setReceiptForm(p => ({ ...p, receipt_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label={t('purchase.receiptModal.receivedBy')}>
          <input type="text" value={receiptForm.received_by}
            onChange={e => setReceiptForm(p => ({ ...p, received_by: e.target.value }))}
            placeholder={t('purchase.receiptModal.receivedByPlaceholder')} className={inputCls()} />
        </Field>
        <Field label={t('purchase.receiptModal.doNo')}>
          <input type="text" value={receiptForm.delivery_note_no}
            onChange={e => setReceiptForm(p => ({ ...p, delivery_note_no: e.target.value }))}
            placeholder={t('purchase.receiptModal.doNoPlaceholder')} className={inputCls()} />
        </Field>
        <Field label={t('purchase.common.notes')}>
          <input type="text" value={receiptForm.notes}
            onChange={e => setReceiptForm(p => ({ ...p, notes: e.target.value }))}
            placeholder={t('purchase.receiptModal.notesPlaceholder')} className={inputCls()} />
        </Field>
      </div>

      {/* ── Section 3: รายการสินค้า ── */}
      {receiptForm.items.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
            {t('purchase.receiptModal.itemsTitle')}
            <span className="text-xs font-normal text-[var(--fg-4)]">{t('purchase.common.itemCount', { count: receiptForm.items.length })}</span>
          </p>
          <div className="space-y-4">
            {receiptForm.items.map((item, index) => {
              const pendingPct = item.ordered_qty > 0 ? (item.pending_qty / item.ordered_qty) * 100 : 0
              return (
                <div key={index} className="p-4 bg-[var(--bg)] rounded-xl border border-[var(--border)]/40 space-y-3">

                  {/* ── Item header ── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--fg-1)] truncate">{item.description || item.material_name || item.material_id}</p>
                      <p className="text-xs text-[var(--fg-4)] mt-0.5">
                        {t('purchase.receiptModal.unitPriceLabel')} <span className="text-[var(--primary)] font-medium">{formatCurrency(item.unit_price)}</span>
                        {item.unit && <span className="ml-2 text-[var(--fg-4)]">· {unitLabelFor(item.unit)}</span>}
                      </p>
                    </div>
                    {/* Progress bar: already received vs ordered */}
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[var(--fg-4)] mb-1">
                        {t('purchase.receiptModal.receivedSoFar', { already: item.already_received_qty, ordered: item.ordered_qty, unit: item.unit })}
                      </p>
                      <div className="w-32 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                        <div className="h-full bg-success rounded-full transition-all"
                          style={{ width: `${Math.min(100 - pendingPct, 100)}%` }} />
                      </div>
                      <p className="text-xs text-warning mt-0.5">{t('purchase.receiptModal.pendingQty', { pending: item.pending_qty, unit: item.unit })}</p>
                    </div>
                  </div>

                  {/* ── Qty inputs ── */}
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { label: t('purchase.receiptModal.receivedQty'), icon: null, key: 'received_qty' as const, color: 'border-blue-500/50 focus:border-blue-400' },
                      { label: t('purchase.receiptModal.acceptedQty'), icon: Check, key: 'accepted_qty' as const, color: 'border-success/50 focus:border-success' },
                      { label: t('purchase.receiptModal.rejectedQty'), icon: X, key: 'rejected_qty' as const, color: 'border-danger/50 focus:border-red-400' },
                    ]).map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-[var(--fg-4)] mb-1 flex items-center gap-1">{f.label} {f.icon && <f.icon className="w-3.5 h-3.5" />}</label>
                        <input type="number" min="0" step="0.01" value={item[f.key]}
                          onChange={e => updateItem(index, f.key, parseFloat(e.target.value) || 0)}
                          className={`w-full px-2 py-2 bg-[var(--surface)] border ${f.color} rounded-lg text-sm text-[var(--fg-1)] text-center focus:outline-none`} />
                      </div>
                    ))}
                  </div>

                  {/* ── Warnings ── */}
                  {item.received_qty > item.pending_qty && item.pending_qty > 0 && (
                    <p className="text-xs text-warning flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {t('purchase.receiptModal.overReceiveWarning', { qty: (item.received_qty - item.pending_qty).toFixed(2), unit: item.unit })}
                    </p>
                  )}
                  {(item.received_qty !== item.accepted_qty + item.rejected_qty) && item.received_qty > 0 && (
                    <p className="text-xs text-warning flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {t('purchase.receiptModal.imbalanceWarning')}
                    </p>
                  )}

                  {/* ── Lot + Location + Rejection notes ── */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 flex items-center gap-1 block">
                        <span className="text-warning">*</span> {t('purchase.receiptModal.lotLabel')}
                      </label>
                      <input type="text" value={item.lot_number} placeholder={t('purchase.receiptModal.lotPlaceholder')}
                        onChange={e => updateItem(index, 'lot_number', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[var(--surface)] border border-warning/30 rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-yellow-400" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('purchase.receiptModal.location')}</label>
                      <input type="text" value={item.location} placeholder={t('purchase.receiptModal.locationPlaceholder')}
                        onChange={e => updateItem(index, 'location', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo" />
                    </div>
                  </div>
                  {item.rejected_qty > 0 && (
                    <input type="text" value={item.notes} placeholder={t('purchase.receiptModal.rejectionNotesPlaceholder')}
                      onChange={e => updateItem(index, 'notes', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[var(--surface)] border border-danger/30 rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-red-400" />
                  )}

                  {/* ── Line total ── */}
                  <div className="flex justify-end pt-1 border-t border-[var(--border)]/30">
                    <span className="text-xs text-[var(--fg-4)] mr-2">{t('purchase.receiptModal.lineValue')}</span>
                    <span className="text-sm font-semibold text-[var(--primary)]">
                      {formatCurrency(item.accepted_qty * item.unit_price)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total summary */}
          <div className="mt-3 p-3 bg-phopy-indigo/5 border border-phopy-indigo-50 rounded-xl flex justify-between items-center">
            <span className="text-sm text-[var(--fg-3)]">{t('purchase.receiptModal.totalReceivedValue')}</span>
            <span className="text-lg font-bold text-[var(--primary)]">
              {formatCurrency(receiptForm.items.reduce((s, i) => s + i.accepted_qty * i.unit_price, 0))}
            </span>
          </div>
        </div>
      ) : receiptForm.purchase_order_id ? (
        <div className="text-center py-8 text-[var(--fg-4)] text-sm">
          <div className="w-5 h-5 border-2 border-phopy-indigo border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          {t('purchase.receiptModal.loadingItems')}
        </div>
      ) : (
        <div className="text-center py-8 text-[var(--fg-4)] text-sm border border-dashed border-[var(--border)]/40 rounded-xl">
          {t('purchase.receiptModal.selectPOHint')}
        </div>
      )}
    </ModalShell>
    )
  }

  // ─── 4. Invoice Modal ────────────────────────────────────────────────────────
  const InvoiceModal = () => {
    const isView         = modalMode === 'view'
    const selectedPO     = orders.find(o => o.id === invoiceForm.purchase_order_id)
    const selectedGRs    = invoiceForm.goods_receipt_ids.map(id => receipts.find(r => r.id === id)).filter(Boolean) as GoodsReceipt[]
    const poGRs          = receipts.filter(r => r.purchase_order_id === invoiceForm.purchase_order_id && r.status === 'CONFIRMED' && !r.invoiced_at)
    const supplierDetail = selectedPO ? suppliers.find(s => s.id === selectedPO.supplier_id) : null
    // โหมดดู = ใช้ยอดที่บันทึกไว้ในบิล · โหมดสร้าง = คิดจากใบสั่งซื้อที่เลือก
    // ต้องรวมใบที่ติ๊กเพิ่มด้วย เดิมโชว์แค่ใบหลัก ยอดในจอจึงไม่ตรงกับบิลที่ออกจริง
    const extraPOs = invoiceForm.extra_po_ids.map(id => orders.find(o => o.id === id)).filter(Boolean) as PurchaseOrder[]
    const subtotal = isView ? invoiceForm._subtotal
      : (selectedPO?.subtotal ?? 0) + extraPOs.reduce((sum, o) => sum + (o.subtotal || 0), 0)
    const taxAmt   = isView ? invoiceForm._tax_amount : subtotal * (invoiceForm.tax_rate / 100)
    const total    = isView ? invoiceForm._total_amount : subtotal + taxAmt
    // supplier/po labels for view mode when PO may not be in orders state
    const displaySupplier = isView ? (selectedPO?.supplier_name || invoiceForm._supplier_name) : selectedPO?.supplier_name
    const displayPO       = isView ? (selectedPO?.po_number || invoiceForm._po_number) : selectedPO?.po_number
    return (
    <ModalShell
      title={modalMode === 'view' ? t('purchase.invoiceModal.titleView') : t('purchase.invoiceModal.titleCreate')}
      onClose={closeModal}
      footer={
        modalMode !== 'view' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
            <button onClick={handleCreateInvoice} disabled={formLoading || !invoiceForm.purchase_order_id}
              className="px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {t('purchase.actions.createInvoice')}
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.close')}</button>
      }
    >
      {/* เส้นทางเอกสารกับช่องแนบรูปย้ายไปท้ายโมดัลแล้ว — ของพวกนั้นเอาไว้ดู
          ไม่ใช่ของที่ต้องกรอก เอามาขวางหัวโมดัลทำให้ไม่รู้ว่าต้องเริ่มตรงไหน */}
      <StepHead n={1} title={t('purchase.invoiceModal.step1')} hint={t('purchase.invoiceModal.step1Hint')} />
      <div className="space-y-3">
        {isView ? (
          <div className="p-3 bg-[var(--bg)] rounded-xl text-sm">
            <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.invoiceModal.po')}</p>
            <p className="text-[var(--primary)] font-mono font-semibold">{displayPO || '-'}</p>
          </div>
        ) : (
        <Field label={t('purchase.invoiceModal.po')} required>
          <POSearchInput
            orders={orders.filter(o => !['CANCELLED', 'DRAFT'].includes(o.status) && (o.id === invoiceForm.purchase_order_id || poHasInvoiceableTarget(o)))}
            value={invoiceForm.purchase_order_id}
            emptyMessage={t('purchase.invoiceModal.noEligiblePO')}
            onChange={id => {
              const po = orders.find(o => o.id === id)
              setInvoiceForm(p => ({
                ...p,
                purchase_order_id: id,
                extra_po_ids: [],   // เปลี่ยนใบหลัก = ผู้ขายอาจเปลี่ยน ใบที่ติ๊กไว้ต้องล้าง
                goods_receipt_ids: [],
                tax_rate: po?.tax_rate ?? 7,
                due_date: po?.expected_date?.split('T')[0] || '',
              }))
            }}
          />
        </Field>
        )}

        {/* รวมใบสั่งซื้อใบอื่นของผู้ขายรายเดียวกัน
            กรองอัตโนมัติจากผู้ขายของใบหลัก — ใบของเจ้าอื่นจะไม่โผล่ให้เลือกเลย
            เทียบด้วยเลขผู้เสียภาษีก่อน (นิติบุคคลเดียวกันแม้ชื่อร้านพิมพ์ต่างกัน) */}
        {!isView && selectedPO && (() => {
          const baseSup = suppliers.find(x => x.id === selectedPO.supplier_id)
          const baseTax = (baseSup?.tax_id || '').trim()
          const sameParty = (o: PurchaseOrder) => {
            if (o.id === selectedPO.id) return false
            const sup = suppliers.find(x => x.id === o.supplier_id)
            const tax = (sup?.tax_id || '').trim()
            return baseTax && tax ? tax === baseTax : o.supplier_id === selectedPO.supplier_id
          }
          const mergeable = orders.filter(o => !['CANCELLED', 'DRAFT'].includes(o.status) && sameParty(o) && poHasInvoiceableTarget(o))
          if (mergeable.length === 0) return null
          return (
            <Field label={t('purchase.invoiceModal.mergeMore')}>
              <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)]">
                {mergeable.map(o => {
                  const on = invoiceForm.extra_po_ids.includes(o.id)
                  return (
                    <button key={o.id} type="button" aria-pressed={on}
                      onClick={() => setInvoiceForm(p => ({
                        ...p,
                        extra_po_ids: on ? p.extra_po_ids.filter(x => x !== o.id) : [...p.extra_po_ids, o.id],
                      }))}
                      className={`flex items-center justify-between gap-3 w-full min-h-[44px] px-3 py-2 border-b border-[var(--border)] last:border-b-0 text-left transition-colors ${on ? 'bg-phopy-indigo/10' : 'hover:bg-[var(--bg)]'}`}>
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-[18px] h-[18px] rounded-md flex items-center justify-center shrink-0 border ${on ? 'bg-phopy-indigo border-phopy-indigo' : 'bg-[var(--surface)] border-[var(--border-strong)]'}`}>
                          {on && <Check className="w-3 h-3 text-white" />}
                        </span>
                        {/* เดิมโชว์แค่เลขที่กับยอด ตัดสินใจไม่ได้ว่าควรรวมใบไหน */}
                        <span className="min-w-0">
                          <span className="flex items-baseline gap-2">
                            <span className="text-xs font-mono font-semibold text-[var(--fg-1)]">{o.po_number}</span>
                            <span className="text-[11px] text-[var(--fg-4)] whitespace-nowrap">{formatDate(o.order_date)}</span>
                          </span>
                          <span className="block text-[11px] text-[var(--fg-4)] truncate">
                            {(() => {
                              const grs = receipts.filter(r => r.purchase_order_id === o.id && r.status === 'CONFIRMED')
                              const parts = [t('purchase.invoiceModal.itemCount', { count: o.item_count ?? 0 })]
                              parts.push(grs.length > 0
                                ? t('purchase.invoiceModal.receivedVia', { docs: grs.map(g => g.gr_number).join(', ') })
                                : t('purchase.invoiceModal.noReceiptYet'))
                              return parts.join(' · ')
                            })()}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-mono font-semibold text-[var(--fg-1)]">{formatCurrency(o.total_amount)}</span>
                        <span className="block text-[10px] text-[var(--fg-4)] font-mono">{t('purchase.invoiceModal.beforeVat', { amount: formatCurrency(o.subtotal) })}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <p className="text-xs text-[var(--fg-4)]">
                  {t('purchase.invoiceModal.mergeHint', { name: selectedPO.supplier_name })}
                </p>
                {/* ยอดต้องขยับให้เห็นตั้งแต่ตอนติ๊ก ไม่ใช่ไปรู้เอาตอนบิลออกแล้ว */}
                {invoiceForm.extra_po_ids.length > 0 && (
                  <span className="text-xs font-semibold text-[var(--primary)] whitespace-nowrap tabular-nums">
                    {t('purchase.invoiceModal.mergeTotal', {
                      count: invoiceForm.extra_po_ids.length + 1,
                      amount: formatCurrency(
                        (selectedPO.total_amount || 0) +
                        invoiceForm.extra_po_ids.reduce((sum, id) =>
                          sum + (orders.find(o => o.id === id)?.total_amount || 0), 0)
                      ),
                    })}
                  </span>
                )}
              </div>
            </Field>
          )
        })()}

        {!isView && (
        <Field label={t('purchase.invoiceModal.grReference')}>
          <GRSearchInput
            receipts={poGRs}
            values={invoiceForm.goods_receipt_ids}
            onChange={(ids) => setInvoiceForm(p => ({ ...p, goods_receipt_ids: ids }))}
            disabled={!invoiceForm.purchase_order_id}
          />
        </Field>
        )}

        {/* PO + Supplier summary */}
        {(selectedPO || (isView && displaySupplier)) && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-phopy-indigo/5 border border-phopy-indigo-50 rounded-xl text-sm">
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('purchase.common.supplier')}</p>
              <p className="text-[var(--fg-1)] font-medium truncate">{displaySupplier}</p>
              {supplierDetail?.tax_id && (
                <p className="text-xs text-[var(--fg-3)] font-mono mt-0.5">{t('purchase.invoiceModal.taxId', { id: supplierDetail.tax_id })}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)] mb-0.5">{isView ? t('purchase.invoiceModal.invoiceValue') : t('purchase.invoiceModal.poValue')}</p>
              <p className="text-[var(--primary)] font-semibold">{formatCurrency(isView ? invoiceForm._total_amount : (selectedPO?.total_amount ?? 0))}</p>
              {!isView && <p className="text-xs text-success mt-0.5">{t('purchase.invoiceModal.grSelected', { confirmed: poGRs.length, selected: selectedGRs.length })}</p>}
              {isView && invoiceForm._payment_status && (
                <p className={`text-xs mt-0.5 ${invoiceForm._payment_status === 'PAID' ? 'text-success' : invoiceForm._payment_status === 'PARTIAL' ? 'text-warning' : 'text-danger'}`}>
                  {invoiceForm._payment_status === 'PAID' ? t('purchase.paymentStatus.paid') : invoiceForm._payment_status === 'PARTIAL' ? t('purchase.paymentStatus.partial', { paid: formatCurrency(invoiceForm._paid_amount), balance: formatCurrency(invoiceForm._balance_amount) }) : t('purchase.paymentStatus.unpaid', { balance: formatCurrency(invoiceForm._balance_amount) })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <StepHead n={2} title={t('purchase.invoiceModal.step2')} hint={t('purchase.invoiceModal.step2Hint')} />
      <Field label={`${t('purchase.invoiceModal.supplierInvoiceNumber')} *`}>
        <input type="text" value={invoiceForm.supplier_invoice_number}
          placeholder={t('purchase.invoiceModal.supplierInvoicePlaceholder')}
          onChange={e => setInvoiceForm(p => ({ ...p, supplier_invoice_number: e.target.value }))}
          className={inputCls()} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('purchase.invoiceModal.invoiceDate')}>
          <input type="date" value={invoiceForm.invoice_date}
            onChange={e => setInvoiceForm(p => ({ ...p, invoice_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label={t('purchase.invoiceModal.dueDate')}>
          <input type="date" value={invoiceForm.due_date}
            onChange={e => setInvoiceForm(p => ({ ...p, due_date: e.target.value }))} className={inputCls()} />
        </Field>
      </div>

      <StepHead n={3} title={t('purchase.invoiceModal.step3')} />
      {selectedPO && (
        <div className="p-4 bg-[var(--bg)] rounded-xl space-y-2.5 text-sm">
          <div className="flex justify-between text-[var(--fg-3)]">
            <span>{t('purchase.invoiceModal.goodsValue')}</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[var(--fg-3)]">{t('purchase.invoiceModal.vat')}</span>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="30" value={invoiceForm.tax_rate}
                onChange={e => setInvoiceForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                className="w-20 px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] text-right focus:outline-none focus:border-phopy-indigo" />
              <span className="text-[var(--fg-4)] text-xs">= {formatCurrency(taxAmt)}</span>
            </div>
          </div>
          <div className="flex justify-between font-bold text-[var(--fg-1)] border-t border-[var(--border)]/50 pt-2.5">
            <span>{t('purchase.common.grandTotal')}</span>
            <span className="text-xl text-[var(--primary)]">{formatCurrency(total)}</span>
          </div>
        </div>
      )}


      {/* ── ขั้นที่ 4: เงินก้อนนี้ไปอยู่บัญชีไหน ──
          เดิมมี dropdown ฝั่งเดบิตอันเดียวอยู่ท้ายโมดัล ส่วนฝั่งเครดิตถูกยึดเป็น
          เจ้าหนี้การค้าตายตัว แล้วตัวอย่างการลงบัญชีอยู่แยกอีกกล่อง อ่านไม่ออกว่าอะไรคู่กับอะไร
          ตอนนี้รวมเป็นตารางเดียว เห็นคู่เดบิต-เครดิตพร้อมยอด และแก้ได้ทั้งสองฝั่ง */}
      {(selectedPO || isView) && (
        <div className="space-y-2">
          <StepHead n={4} title={t('purchase.invoiceModal.step4')} hint={t('purchase.invoiceModal.step4Hint')} />
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            {/* มูลค่าสินค้า — เลือกปลายทางได้ */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
              <span className="shrink-0 w-[68px] text-[10px] font-bold text-center py-1 rounded-md bg-[var(--success-soft)] text-success">{t('purchase.invoiceModal.debitSide')}</span>
              {isView ? (
                <span className="flex-1 text-xs text-[var(--fg-2)] truncate">{t('purchase.journal.rawStockAccount')}</span>
              ) : (
                <select value={invoiceForm.dr_account_id}
                  onChange={e => setInvoiceForm(p => ({ ...p, dr_account_id: e.target.value }))}
                  className="flex-1 min-w-0 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo">
                  <option value="">{t('purchase.invoiceModal.defaultDrAccount')}</option>
                  {['ASSET', 'EXPENSE'].map(type => {
                    const group = drAccounts.filter(acc => acc.type === type)
                    if (!group.length) return null
                    return (
                      <optgroup key={type} label={type === 'ASSET' ? t('purchase.accountType.asset') : t('purchase.accountType.expense')}>
                        {group.map(acc => <option key={acc.id} value={acc.id}>{acc.code} – {acc.name}</option>)}
                      </optgroup>
                    )
                  })}
                </select>
              )}
              <span className="shrink-0 text-xs font-mono font-semibold text-[var(--fg-1)] tabular-nums">{formatCurrency(subtotal)}</span>
            </div>

            {/* ภาษีซื้อ — ผังบัญชีบังคับ แก้ไม่ได้ บอกไปตรง ๆ ดีกว่าให้เดา */}
            {taxAmt > 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
                <span className="shrink-0 w-[68px] text-[10px] font-bold text-center py-1 rounded-md bg-[var(--success-soft)] text-success">{t('purchase.invoiceModal.debitSide')}</span>
                <span className="flex-1 min-w-0 text-xs text-[var(--fg-3)] truncate">
                  {t('purchase.journal.inputVatAccount')}
                  <span className="text-[var(--fg-4)]"> · {t('purchase.invoiceModal.fixedByChart')}</span>
                </span>
                <span className="shrink-0 text-xs font-mono text-[var(--fg-2)] tabular-nums">{formatCurrency(taxAmt)}</span>
              </div>
            )}

            {/* หนี้ไปค้างที่บัญชีไหน — เดิมยึดเจ้าหนี้การค้าตายตัว ตอนนี้เลือกได้ */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--surface)]">
              <span className="shrink-0 w-[68px] text-[10px] font-bold text-center py-1 rounded-md bg-[var(--warning-soft)] text-warning">{t('purchase.invoiceModal.creditSide')}</span>
              {isView || crAccounts.length === 0 ? (
                <span className="flex-1 text-xs text-[var(--fg-2)] truncate">{t('purchase.journal.accountsPayable')}</span>
              ) : (
                <select value={invoiceForm.cr_account_id}
                  onChange={e => setInvoiceForm(p => ({ ...p, cr_account_id: e.target.value }))}
                  className="flex-1 min-w-0 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo">
                  <option value="">{t('purchase.invoiceModal.defaultCrAccount')}</option>
                  {crAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.code} – {acc.name}</option>)}
                </select>
              )}
              <span className="shrink-0 text-xs font-mono font-semibold text-warning tabular-nums">{formatCurrency(total)}</span>
            </div>
          </div>
          <p className="text-xs text-[var(--fg-4)]">{t('purchase.invoiceModal.balanceHint', { amount: formatCurrency(total) })}</p>
        </div>
      )}

      <Field label={t('purchase.common.notes')}>
        <textarea value={invoiceForm.notes} onChange={e => setInvoiceForm(p => ({ ...p, notes: e.target.value }))}
          rows={2} className={`${inputCls()} resize-none`} placeholder={t('purchase.common.notes')} />
      </Field>
      {/* ── ของไว้ดู ไม่ใช่ของต้องกรอก จึงอยู่ท้ายสุด ── */}
      {invoiceForm.purchase_order_id && <PurchaseTrail poId={invoiceForm.purchase_order_id} />}

      {modalMode === 'view' && modalData?.id && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">{t('purchase.attachments.title')}</h3>
            <span className="text-xs text-[var(--fg-4)]">{t('purchase.attachments.hint')}</span>
          </div>
          <PaymentAttachments dense refType="PURCHASE_INVOICE" refId={modalData.id} />
        </div>
      )}
    </ModalShell>
    )
  }

  // ─── 5. Payment Modal ────────────────────────────────────────────────────────
  const PaymentModal = () => {
    const selectedInv = invoices.find(i => i.id === paymentForm.purchase_invoice_id)
    const netPay      = paymentForm.amount - paymentForm.withholding_tax
    return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-success" /> {t('purchase.paymentModal.title')}
          </h2>
          <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4 flex-1">

          {/* เส้นทางเอกสาร — ไล่กลับจากใบแจ้งหนี้ที่เลือกไปหาใบสั่งซื้อต้นทาง */}
          {(() => {
            const inv = invoices.find(i => i.id === paymentForm.purchase_invoice_id)
            return inv?.purchase_order_id ? <PurchaseTrail poId={inv.purchase_order_id} /> : null
          })()}

          {/* Slip attachments — only meaningful once the payment row exists (view mode) */}
          {modalMode === 'view' && modalData?.id && (
            <PaymentAttachments dense refType="SUPPLIER_PAYMENT" refId={modalData.id} />
          )}

          {/* Supplier */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[var(--fg-2)]">{t('purchase.common.supplier')} <span className="text-danger">*</span></label>
              <button onClick={() => openQuickAddSupplier(id => setPaymentForm(p => ({ ...p, supplier_id: id, purchase_invoice_id: '', amount: 0, withholding_tax: 0 })))}
                className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1 px-2 py-0.5 border border-phopy-indigo/30 rounded-lg hover:bg-phopy-indigo/10 transition-colors">
                <Plus className="w-3 h-3" /> {t('purchase.actions.addSupplier')}
              </button>
            </div>
            <SupplierSearchInput suppliers={suppliers} value={paymentForm.supplier_id}
              onChange={id => setPaymentForm(p => ({ ...p, supplier_id: id, purchase_invoice_id: '', amount: 0, withholding_tax: 0 }))}
              placeholder={t('purchase.paymentModal.supplierPlaceholder')} />
          </div>

          {/* Invoice selector — filtered by supplier */}
          <Field label={t('purchase.paymentModal.selectInvoice')}>
            <select value={paymentForm.purchase_invoice_id}
              onChange={e => {
                const id  = e.target.value
                const inv = invoices.find(i => i.id === id)
                setPaymentForm(p => ({ ...p, purchase_invoice_id: id, amount: inv?.balance_amount || 0 }))
              }}
              className={inputCls()}>
              <option value="">{t('purchase.paymentModal.invoicePlaceholder')}</option>
              {invoices
                .filter(i => i.payment_status !== 'PAID' && (!paymentForm.supplier_id || i.supplier_id === paymentForm.supplier_id))
                .map(i => (
                  <option key={i.id} value={i.id}>{t('purchase.paymentModal.invoiceOption', { piNumber: i.pi_number, amount: formatCurrency(i.balance_amount) })}</option>
                ))}
            </select>
          </Field>

          {/* Invoice summary */}
          {selectedInv && (
            <div className="p-3 bg-red-500/5 border border-danger/20 rounded-xl grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-[var(--fg-4)]">{t('purchase.common.total')}</p>
                <p className="text-[var(--fg-1)] font-medium">{formatCurrency(selectedInv.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--fg-4)]">{t('purchase.paymentModal.paidAmount')}</p>
                <p className="text-success font-medium">{formatCurrency(selectedInv.paid_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--fg-4)]">{t('purchase.common.balance')}</p>
                <p className="text-danger font-bold">{formatCurrency(selectedInv.balance_amount)}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('purchase.paymentModal.paymentDate')}>
              <input type="date" value={paymentForm.payment_date}
                onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} className={inputCls()} />
            </Field>
            <Field label={t('purchase.paymentModal.paymentMethod')}>
              <select value={paymentForm.payment_method}
                onChange={e => setPaymentForm(p => ({ ...p, payment_method: e.target.value }))} className={inputCls()}>
                <option value="CASH">{t('purchase.paymentMethod.cash')}</option>
                <option value="TRANSFER">{t('purchase.paymentMethod.transfer')}</option>
                <option value="CHEQUE">{t('purchase.paymentMethod.cheque')}</option>
                <option value="CREDIT_CARD">{t('purchase.paymentMethod.creditCard')}</option>
              </select>
            </Field>
          </div>

          {/* Amount + WHT */}
          <div className="p-4 bg-[var(--bg)] rounded-xl space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-[var(--fg-3)] mb-1 block">{t('purchase.paymentModal.amountPaid')}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-sm">฿</span>
                  <input type="number" min="0" step="0.01" value={paymentForm.amount}
                    onChange={e => setPaymentForm(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full pl-7 pr-3 py-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] text-lg font-bold focus:outline-none focus:border-phopy-indigo" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <label className="text-xs text-[var(--fg-3)] mb-1 block">{t('purchase.paymentModal.whtRate')}</label>
                <select
                  onChange={e => setPaymentForm(p => ({ ...p, withholding_tax: p.amount * (parseFloat(e.target.value) / 100) }))}
                  className="w-full px-2.5 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo">
                  <option value="0">{t('purchase.paymentModal.whtNone')}</option>
                  <option value="1">{t('purchase.paymentModal.wht1')}</option>
                  <option value="3">{t('purchase.paymentModal.wht3')}</option>
                  <option value="5">{t('purchase.paymentModal.wht5')}</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-[var(--fg-3)] mb-1 block">{t('purchase.paymentModal.withholdingTax')}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-sm">฿</span>
                  <input type="number" min="0" step="0.01" value={paymentForm.withholding_tax}
                    onChange={e => setPaymentForm(p => ({ ...p, withholding_tax: parseFloat(e.target.value) || 0 }))}
                    className="w-full pl-7 pr-3 py-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
                </div>
              </div>
            </div>
            <div className={`flex justify-between items-center p-3 rounded-xl font-semibold ${netPay > 0 ? 'bg-success/10 border border-success/30' : 'bg-[var(--bg)]'}`}>
              <span className="text-sm text-[var(--fg-2)]">{t('purchase.paymentModal.netPay')}</span>
              <span className="text-xl text-success">{formatCurrency(netPay)}</span>
            </div>
          </div>

          <Field label={t('purchase.paymentModal.reference')}>
            <input type="text" value={paymentForm.payment_reference} placeholder={t('purchase.paymentModal.referencePlaceholder')}
              onChange={e => setPaymentForm(p => ({ ...p, payment_reference: e.target.value }))} className={inputCls()} />
          </Field>

          {/* Journal preview */}
          {paymentForm.amount > 0 && (
            <JournalPreview entries={[
              { dr: true,  account: t('purchase.journal.accountsPayable'),   label: t('purchase.journal.reducePayable'), amount: paymentForm.amount },
              { dr: false, account: paymentForm.payment_method === 'CASH' ? t('purchase.journal.cash') : t('purchase.journal.bankDeposit'), label: t('purchase.journal.actualTransfer'),    amount: netPay },
              ...(paymentForm.withholding_tax > 0 ? [
                { dr: false as const, account: t('purchase.journal.withholdingTaxPayable'), label: t('purchase.journal.whtRemitted'), amount: paymentForm.withholding_tax }
              ] : [])
            ]} />
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-3 shrink-0">
          <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
          <button onClick={handleCreatePayment} disabled={formLoading || !paymentForm.supplier_id || !paymentForm.amount}
            className="px-6 py-2.5 bg-success text-white font-semibold rounded-xl hover:bg-success/80 disabled:opacity-50 flex items-center gap-2 text-sm">
            {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            <Check className="w-4 h-4" /> {t('purchase.paymentModal.confirmPayment')}
          </button>
        </div>
      </motion.div>
    </div>
    )
  }

  // ─── 6. Return Modal ────────────────────────────────────────────────────────
  const ReturnModal = () => {
    const subtotal = returnForm.items.reduce((s, i) => s + i.total_price, 0)
    const taxAmt   = subtotal * (returnForm.tax_rate / 100)
    const total    = subtotal + taxAmt
    return (
    <ModalShell
      title={t('purchase.returnModal.title')}
      onClose={closeModal}
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={closeModal} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">{t('purchase.common.cancel')}</button>
          <button onClick={handleCreateReturn}
            disabled={formLoading || !returnForm.reason || returnForm.items.length === 0}
            className="px-6 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center gap-2 text-sm">
            {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            <RotateCcw className="w-4 h-4" /> {t('purchase.returnModal.createReturn')}
          </button>
        </div>
      }
    >
      {/* References */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('purchase.returnModal.po')}>
          <select value={returnForm.purchase_order_id}
            onChange={e => setReturnForm(p => ({ ...p, purchase_order_id: e.target.value }))} className={inputCls()}>
            <option value="">{t('purchase.returnModal.selectPO')}</option>
            {orders.filter(o => o.status === 'RECEIVED' || o.status === 'PARTIAL').map(o => (
              <option key={o.id} value={o.id}>{o.po_number} — {o.supplier_name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('purchase.returnModal.gr')}>
          <select value={returnForm.goods_receipt_id}
            onChange={e => setReturnForm(p => ({ ...p, goods_receipt_id: e.target.value }))} className={inputCls()}>
            <option value="">{t('purchase.returnModal.selectGR')}</option>
            {receipts
              .filter(r => r.status === 'CONFIRMED' && (!returnForm.purchase_order_id || r.purchase_order_id === returnForm.purchase_order_id))
              .map(r => <option key={r.id} value={r.id}>{r.gr_number} ({r.po_number})</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('purchase.returnModal.returnDate')}>
          <input type="date" value={returnForm.return_date}
            onChange={e => setReturnForm(p => ({ ...p, return_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label={t('purchase.returnModal.returnReason')} required>
          <select value={returnForm.reason}
            onChange={e => setReturnForm(p => ({ ...p, reason: e.target.value }))} className={inputCls()}>
            <option value="">{t('purchase.returnModal.selectReason')}</option>
            <option value="DEFECTIVE">{t('purchase.returnReason.defective')}</option>
            <option value="WRONG_ITEM">{t('purchase.returnReason.wrongItem')}</option>
            <option value="WRONG_QUANTITY">{t('purchase.returnReason.wrongQuantity')}</option>
            <option value="QUALITY_ISSUE">{t('purchase.returnReason.qualityIssue')}</option>
            <option value="EXPIRED">{t('purchase.returnReason.expired')}</option>
            <option value="OTHER">{t('purchase.returnReason.other')}</option>
          </select>
        </Field>
      </div>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-[var(--fg-2)]">{t('purchase.returnModal.itemsTitle')}</span>
          <button onClick={addReturnItem}
            className="flex items-center gap-1 px-2.5 py-1 bg-[var(--danger-soft)] text-danger text-xs rounded-lg hover:bg-[var(--danger-soft)]">
            <Plus className="w-3 h-3" /> {t('purchase.actions.addItem')}
          </button>
        </div>
        <div className="space-y-3">
          {returnForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-[var(--bg)] rounded-xl space-y-2 border border-danger/20">
              <MaterialSearchInput materials={materials} value={item.material_id}
                onChange={(id) => {
                  const mat = materials.find(m => m.id === id)
                  updateReturnItemFields(index, { material_id: id, unit: item.unit || mat?.unit || '' })
                }} />
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.returnModal.returnQty')}</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateReturnItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 bg-[var(--surface)] border border-danger/30 rounded-lg text-sm text-[var(--fg-1)] text-center focus:outline-none focus:border-red-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.unit')}</label>
                  <UnitPicker
                    value={item.unit || ''}
                    onChange={u => updateReturnItem(index, 'unit', u)}
                    materialId={item.material_id || null}
                    size="sm"
                    placeholder={t('purchase.common.selectUnit')}
                    baseUnit={materials.find(m => m.id === item.material_id)?.baseUnit}
                    restrict="strict"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.unitPrice')}</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)] text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.unit_price}
                      onChange={e => updateReturnItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full pl-5 pr-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.returnModal.itemNote')}</label>
                  <input type="text" value={item.reason} placeholder={t('purchase.returnModal.itemNotePlaceholder')}
                    onChange={e => updateReturnItem(index, 'reason', e.target.value)}
                    className="w-full px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo" />
                </div>
                <div className="col-span-2 text-right">
                  <label className="text-xs text-[var(--fg-4)] mb-0.5 block">{t('purchase.common.lineTotal')}</label>
                  <span className="text-sm font-semibold text-danger">{formatCurrency(item.total_price)}</span>
                </div>
                <div className="col-span-1 flex items-end justify-center pb-0.5">
                  <button onClick={() => removeReturnItem(index)}
                    className="p-1.5 hover:bg-[var(--danger-soft)] rounded-lg text-danger transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {returnForm.items.length === 0 && (
            <div className="text-center py-6 text-[var(--fg-4)] text-sm border border-dashed border-danger/30 rounded-xl">
              {t('purchase.common.noItemsYet')}
            </div>
          )}
        </div>
      </div>

      {/* Amount breakdown */}
      {returnForm.items.length > 0 && (
        <div className="p-4 bg-[var(--bg)] rounded-xl space-y-2 text-sm">
          <div className="flex justify-between text-[var(--fg-3)]">
            <span>{t('purchase.returnModal.beforeTax')}</span><span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[var(--fg-3)]">{t('purchase.returnModal.tax')}</span>
            <div className="w-24">
              <input type="number" min="0" max="30" value={returnForm.tax_rate}
                onChange={e => setReturnForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] text-right focus:outline-none focus:border-phopy-indigo" />
            </div>
          </div>
          <div className="flex justify-between font-bold text-[var(--fg-1)] border-t border-[var(--border)] pt-2">
            <span>{t('purchase.returnModal.totalReturn')}</span>
            <span className="text-lg text-danger">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <Field label={t('purchase.common.notes')}>
        <textarea value={returnForm.notes} onChange={e => setReturnForm(p => ({ ...p, notes: e.target.value }))}
          rows={2} className={`${inputCls()} resize-none`}
          placeholder={t('purchase.returnModal.notesPlaceholder')} />
      </Field>

      {/* Journal preview */}
      {returnForm.items.length > 0 && (
        <JournalPreview entries={[
          { dr: true,  account: t('purchase.journal.accountsPayable'),  label: t('purchase.journal.reduceDebt'),       amount: total },
          { dr: false, account: t('purchase.journal.inventory'),    label: t('purchase.journal.returnedGoodsValue'), amount: subtotal },
          { dr: false, account: t('purchase.journal.inputVat'),        label: t('purchase.journal.vatReversed'),   amount: taxAmt },
        ]} />
      )}
    </ModalShell>
    )
  }

  // ─── Main render ──────────────────────────────────────────────────
  // Tab badge numbers now come from the server (GET /purchase/badge-counts,
  // fetched on mount + refreshed after mutations — see fetchBadgeCounts above),
  // replacing the old client-only `pendingCounts` derivation. That version only
  // covered 3 of the 6 tabs and its orders criteria (status === 'CONFIRMED' ||
  // 'PARTIAL') didn't match any status purchase_orders actually uses in this DB
  // (real values are DRAFT/SUBMITTED/APPROVED/PARTIAL/RECEIVED/CANCELLED), so
  // the Orders badge was silently stuck at 0.
  // ปุ่มสร้างในหัวหน้าเปลี่ยนตามแท็บที่เปิดอยู่ — จะได้ไม่ต้องมีปุ่มสร้างซ้ำในทุกแถบเครื่องมือ
  const CREATE_BY_TAB: Record<string, { type: string; labelKey: string }> = {
    overview: { type: 'request', labelKey: 'purchase.actions.createRequest' },
    requests: { type: 'request', labelKey: 'purchase.actions.createRequest' },
    orders:   { type: 'order',   labelKey: 'purchase.actions.createOrder' },
    receipts: { type: 'receipt', labelKey: 'purchase.actions.createReceipt' },
    invoices: { type: 'invoice', labelKey: 'purchase.actions.createInvoice' },
    payments: { type: 'payment', labelKey: 'purchase.actions.createPayment' },
    returns:  { type: 'return',  labelKey: 'purchase.actions.createReturn' },
  }
  const createAction = CREATE_BY_TAB[activeTab] ?? CREATE_BY_TAB.requests

  // จำนวนใบในแท็บนี้ที่ยังมีขั้นต่อไปให้กดได้จริง
  const waitingCount =
    activeTab === 'requests' ? requests.filter(r => prNextStep(r).kind === 'action').length
      : activeTab === 'orders' ? orders.filter(o => poNextStep(o).kind === 'action').length
        : activeTab === 'receipts' ? receipts.filter(r => grNextStep(r).kind === 'action').length
          : activeTab === 'invoices' ? invoices.filter(i => invNextStep(i).kind === 'action').length
            : 0

  const tabs = [
    { id: 'overview',  label: t('purchase.tabs.overview'),    icon: TrendingUp, badge: 0 },
    { id: 'requests',  label: t('purchase.tabs.requests'),  icon: FileText,   badge: badgeCounts.requests },
    { id: 'orders',    label: t('purchase.tabs.orders'), icon: ShoppingCart, badge: badgeCounts.orders },
    { id: 'receipts',  label: t('purchase.tabs.receipts'),  icon: Package,    badge: badgeCounts.receipts },
    { id: 'invoices',  label: t('purchase.tabs.invoices'),   icon: Receipt,    badge: badgeCounts.invoices },
    { id: 'payments',  label: t('purchase.tabs.payments'),   icon: CreditCard, badge: badgeCounts.payments },
    { id: 'returns',   label: t('purchase.tabs.returns'),  icon: RotateCcw,  badge: badgeCounts.returns },
  ]

  return (
    <div className="p-6 space-y-6">
      {approvalGate.modal}

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-[var(--fg-1)] flex items-center gap-3">
            <ShoppingCart className="w-8 h-8 text-[var(--primary)]" /> {t('purchase.title')}
          </h1>
          <p className="text-[var(--fg-3)] mt-1">{t('purchase.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {/* นับเฉพาะแท็บที่เห็นอยู่ จะได้ตรงกับที่ตาเห็นในตาราง ไม่ใช่ตัวเลขลอย ๆ */}
          {waitingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--warning-soft)] border border-warning/40">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span className="text-xs font-semibold text-warning whitespace-nowrap">{t('purchase.header.waiting', { count: waitingCount })}</span>
            </div>
          )}
          <button onClick={() => openModal(createAction.type, 'create')}
            className="flex items-center gap-2 px-5 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 transition-colors whitespace-nowrap">
            <Plus className="w-4 h-4" /> {t(createAction.labelKey)}
          </button>
        </div>
      </motion.div>

      {/* Tab navigation */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-1.5 bg-[var(--surface)] p-2 rounded-2xl border border-[var(--border)]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); setSearchQuery(''); setCurrentPage(1); setRowFilter('all'); setOpenRow(null) }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all relative ${
              activeTab === tab.id ? 'bg-phopy-indigo text-white shadow-lg' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--bg)]'
            }`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
            {tab.badge > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                activeTab === tab.id ? 'bg-[var(--bg)]/30 text-[var(--fg-1)]' : 'bg-yellow-500 text-black'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-phopy-indigo" />
        </div>
      ) : (
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {activeTab === 'overview'  && <OverviewContent />}
          {activeTab === 'requests'  && <RequestsContent />}
          {activeTab === 'orders'    && <OrdersContent />}
          {activeTab === 'receipts'  && <ReceiptsContent />}
          {activeTab === 'invoices'  && <InvoicesContent />}
          {activeTab === 'payments'  && <PaymentsContent />}
          {activeTab === 'returns'   && <ReturnsContent />}
        </motion.div>
      )}

      {/* Modals — called as functions (not JSX components) to avoid remount-on-rerender flicker */}
      <AnimatePresence>
        {modalOpen === 'request' && RequestModal()}
        {modalOpen === 'order'   && OrderModal()}
        {modalOpen === 'receipt' && ReceiptModal()}
        {modalOpen === 'invoice' && InvoiceModal()}
        {modalOpen === 'payment' && PaymentModal()}
        {modalOpen === 'return'  && ReturnModal()}
        {convertPRId && ConvertToPOModal()}
      </AnimatePresence>

      {/* Quick add supplier — sits above other modals (z-50) */}
      {showQuickAddSupplier && (
        <QuickAddSupplierModal
          onClose={() => { setShowQuickAddSupplier(false); setQuickAddSupplierCallback(null) }}
          onCreated={handleQuickAddSupplierCreated}
        />
      )}

      {/* Quick add stock item from PO */}
      {showQuickAddStock && (
        <QuickAddStockItemModal
          onClose={() => { setShowQuickAddStock(false); setQuickAddStockCallback(null); setQuickAddStockPrefill(undefined) }}
          onCreated={handleQuickAddStockCreated}
          prefill={quickAddStockPrefill}
        />
      )}
    </div>
  )
}

export default Purchase
