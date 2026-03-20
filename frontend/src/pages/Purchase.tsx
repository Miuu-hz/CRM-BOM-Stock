import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingCart,
  FileText,
  Package,
  Receipt,
  CreditCard,
  RotateCcw,
  Plus,
  Search,
  AlertCircle,
  DollarSign,
  TrendingUp,
  X,
  Check,
  CheckCircle2,
  Trash2,
  ChevronRight,
  ArrowRight,
  Printer,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { stockService } from '../services/stock'
import { printDocument } from '../utils/purchasePrint'
import toast from 'react-hot-toast'

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
  currentStock?: number
  stockStatus?: string
  unitCost?: number
}

interface PurchaseSummary {
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
  unit_price: number
  total_price: number
  reason: string
}

// ─── Module-level helpers (stable refs — no re-creation on parent re-render) ──

const formatCurrency = (amount: number) => `฿${(amount || 0).toLocaleString('th-TH')}`

const ModalShell = ({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode
}) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="bg-cyber-card rounded-2xl border border-cyber-border w-full max-w-4xl max-h-[90vh] flex flex-col">
      <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-5 space-y-4 flex-1">{children}</div>
      <div className="p-5 border-t border-cyber-border shrink-0">{footer}</div>
    </motion.div>
  </div>
)

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1.5">
      {label}{required && <span className="text-red-400 ml-1">*</span>}
    </label>
    {children}
  </div>
)

const inputCls = (disabled?: boolean) =>
  `w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-white text-sm focus:outline-none focus:border-cyber-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

const MaterialSearchInput = ({ materials, value, onChange, disabled = false }: {
  materials: Material[]; value: string; onChange: (id: string, mat?: Material) => void; disabled?: boolean
}) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = materials.find(m => m.id === value)
  const filtered = materials.filter(m =>
    !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.code.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.code} · ${selected.name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder="ค้นหา รหัส / ชื่อวัสดุ..."
          className={`w-full pl-8 pr-7 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-[70] left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 text-center">ไม่พบวัสดุ</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-cyber-border/50 text-xs text-gray-500">{filtered.length} รายการ</div>
              {filtered.map(m => (
                <button key={m.id} onMouseDown={() => { onChange(m.id, m); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-cyber-dark text-left transition-colors ${value === m.id ? 'bg-cyber-primary/10' : ''}`}>
                  <span className="text-xs font-mono text-cyber-primary w-20 shrink-0">{m.code}</span>
                  <span className="text-sm text-white flex-1 truncate">{m.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">{m.unit}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                    m.stockStatus === 'ADEQUATE' ? 'text-green-400 bg-green-400/10' :
                    m.stockStatus === 'OVERSTOCK' ? 'text-blue-400 bg-blue-400/10' :
                    m.stockStatus === 'LOW' ? 'text-yellow-400 bg-yellow-400/10' :
                    m.stockStatus === 'CRITICAL' ? 'text-red-400 bg-red-400/10' :
                    'text-gray-500 bg-gray-500/10'
                  }`}>
                    {m.currentStock ?? 0} {m.unit}
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

const SupplierSearchInput = ({ suppliers, value, onChange, disabled = false, placeholder = 'ค้นหาผู้ขาย...' }: {
  suppliers: Supplier[]; value: string; onChange: (id: string) => void; disabled?: boolean; placeholder?: string
}) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = suppliers.find(s => s.id === value)
  const filtered = suppliers.filter(s =>
    !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.code.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.code} · ${selected.name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full pl-8 pr-7 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-[70] left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 text-center">ไม่พบผู้ขาย</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-cyber-border/50 text-xs text-gray-500">{filtered.length} ราย</div>
              {filtered.map(s => (
                <button key={s.id} onMouseDown={() => { onChange(s.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-cyber-dark text-left transition-colors ${value === s.id ? 'bg-cyber-primary/10' : ''}`}>
                  <span className="text-xs font-mono text-cyber-primary w-24 shrink-0">{s.code}</span>
                  <span className="text-sm text-white flex-1 truncate">{s.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const POSearchInput = ({ orders, value, onChange, disabled = false }: {
  orders: PurchaseOrder[]; value: string; onChange: (id: string) => void; disabled?: boolean
}) => {
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
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.po_number} — ${selected.supplier_name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder="ค้นหาเลขที่ใบสั่งซื้อ / ผู้ขาย..."
          className={`w-full pl-8 pr-7 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-[70] left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 text-center">ไม่พบใบสั่งซื้อที่รอรับสินค้า</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-cyber-border/50 text-xs text-gray-500">{filtered.length} รายการ</div>
              {filtered.map(o => (
                <button key={o.id} onMouseDown={() => { onChange(o.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-cyber-dark text-left transition-colors ${value === o.id ? 'bg-cyber-primary/10' : ''}`}>
                  <span className="text-xs font-mono text-cyber-primary w-28 shrink-0">{o.po_number}</span>
                  <span className="text-sm text-white flex-1 truncate">{o.supplier_name}</span>
                  <span className="text-xs text-gray-500 shrink-0">{o.status === 'PARTIAL' ? 'รับบางส่วน' : 'รออับ'}</span>
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
            <span key={r.id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-cyber-green/15 border border-cyber-green/30 rounded-lg text-xs text-cyber-green">
              <span className="font-mono">{r.gr_number}</span>
              {!disabled && (
                <button onMouseDown={() => removeItem(r.id)} className="hover:text-white">
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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          <input type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="+ เพิ่มใบรับสินค้า GR..."
            className="w-full pl-8 pr-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary"
          />
        </div>
      )}
      {disabled && selectedItems.length === 0 && (
        <p className="text-xs text-gray-600 py-2">— เลือก PO ก่อน —</p>
      )}
      {open && (
        <div className="absolute z-[70] left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 text-center">
              {values.length > 0 ? 'เพิ่มทุก GR แล้ว' : 'ไม่พบใบรับสินค้า'}
            </p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-cyber-border/50 text-xs text-gray-500">{filtered.length} รายการ (คลิกเพื่อเพิ่ม)</div>
              {filtered.map(r => (
                <button key={r.id} onMouseDown={() => { onChange([...values, r.id]); setQuery(''); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-cyber-dark text-left transition-colors">
                  <span className="text-xs font-mono text-cyber-green w-32 shrink-0">{r.gr_number}</span>
                  <span className="text-xs text-gray-400 flex-1 truncate">PO: {r.po_number}</span>
                  <span className={`text-xs shrink-0 ${r.status === 'CONFIRMED' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {r.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}
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
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input type="text"
          value={open ? query : (selected ? `${selected.pr_number} · ${selected.requester_name}` : '')}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder="ค้นหาเลขที่ใบขอซื้อ / ผู้ขอ..."
          className={`w-full pl-8 pr-7 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {selected && !disabled && (
          <button onMouseDown={() => onChange('', undefined)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-[70] left-0 right-0 mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-2xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 text-center">ไม่พบใบขอซื้อ</p>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-cyber-border/50 text-xs text-gray-500">{filtered.length} รายการ</div>
              {filtered.map(r => (
                <button key={r.id} onMouseDown={() => { onChange(r.id, r); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-cyber-dark text-left transition-colors ${value === r.id ? 'bg-cyber-primary/10' : ''}`}>
                  <span className="text-xs font-mono text-cyber-primary w-28 shrink-0">{r.pr_number}</span>
                  <span className="text-sm text-white flex-1 truncate">{r.requester_name}</span>
                  <span className="text-xs text-gray-500 shrink-0">{r.item_count ?? 0} รายการ</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const JournalPreview = ({ entries }: { entries: { dr?: boolean; account: string; label: string; amount?: number }[] }) => (
  <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-1">
    <p className="text-xs text-yellow-400 font-medium mb-2">สมุดรายวัน (ระบบบันทึกอัตโนมัติ)</p>
    {entries.map((e, i) => (
      <div key={i} className={`flex items-center gap-2 text-xs ${e.dr ? '' : 'pl-6'}`}>
        <span className={`font-mono w-14 shrink-0 ${e.dr ? 'text-blue-400' : 'text-red-400'}`}>{e.dr ? 'Dr.' : 'Cr.'}</span>
        <span className="text-gray-300 flex-1">{e.account}</span>
        <span className="text-gray-400">{e.label}</span>
        {e.amount !== undefined && <span className="text-white font-medium">{formatCurrency(e.amount)}</span>}
      </div>
    ))}
  </div>
)

// Quick-add supplier mini-modal (module level — stable reference)
const QuickAddSupplierModal = ({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (supplier: { id: string; code: string; name: string }) => void
}) => {
  const [form, setForm] = useState({ code: `SUP-${Date.now().toString().slice(-4)}`, name: '', contactName: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!form.name.trim() || !form.contactName.trim()) { setErr('กรุณากรอกชื่อบริษัทและชื่อผู้ติดต่อ'); return }
    setSaving(true); setErr('')
    try {
      const { data } = await api.post('/suppliers', { code: form.code, name: form.name, contactName: form.contactName, phone: form.phone, email: form.email })
      if (data.success) { onCreated(data.data); onClose() }
      else setErr(data.message || 'เกิดข้อผิดพลาด')
    } catch (e: any) { setErr(e.response?.data?.message || 'เกิดข้อผิดพลาด') }
    setSaving(false)
  }
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-4 border-b border-cyber-border flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">เพิ่มผู้ขายใหม่ (Quick Add)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">รหัสผู้ขาย</label>
              <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">ชื่อบริษัท <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="ชื่อบริษัท / ร้านค้า"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">ชื่อผู้ติดต่อ <span className="text-red-400">*</span></label>
            <input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))}
              placeholder="ชื่อ-นามสกุล"
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">เบอร์โทร</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="0xx-xxx-xxxx"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">อีเมล</label>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="email@example.com"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary" />
            </div>
          </div>
          <p className="text-xs text-gray-500">สามารถแก้ไขข้อมูลเพิ่มเติมได้ที่เมนู CRM → Suppliers</p>
        </div>
        <div className="p-4 border-t border-cyber-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2">
            {saving && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

const Purchase = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'orders' | 'receipts' | 'invoices' | 'payments' | 'returns'>('overview')
  const [summary, setSummary] = useState<PurchaseSummary | null>(null)
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [returns, setReturns] = useState<PurchaseReturn[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false)
  const [quickAddSupplierCallback, setQuickAddSupplierCallback] = useState<((id: string) => void) | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Modal states
  const [modalOpen, setModalOpen] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view'>('create')
  const [modalData, setModalData] = useState<any>(null)
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
    items: [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }] as OrderItem[]
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
    goods_receipt_ids: [] as string[],
    supplier_invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    tax_rate: 7,
    notes: ''
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
    items: [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }] as ReturnItem[]
  })

  // Fetch shared reference data once on mount (needed across modals regardless of active tab)
  useEffect(() => {
    fetchSuppliers()
    fetchMaterials()
    fetchOrders()
    fetchReceipts()
    fetchInvoices()
    fetchRequests()
  }, [])

  // Fetch tab-specific list data when switching tabs
  useEffect(() => {
    if (activeTab === 'overview') fetchSummary()
    else if (activeTab === 'requests') fetchRequests()
    else if (activeTab === 'orders') fetchOrders()
    else if (activeTab === 'receipts') fetchReceipts()
    else if (activeTab === 'invoices') fetchInvoices()
    else if (activeTab === 'payments') fetchPayments()
    else if (activeTab === 'returns') fetchReturns()
  }, [activeTab])

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
          code: s.sku || s.id.slice(0, 8),
          name: s.name,
          unit: s.unit,
          currentStock: qty,
          stockStatus,
          unitCost: s.unitCost ?? s.unit_cost ?? 0,
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
      if (data.success) setRequests(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบขอซื้อได้') }
    finally { setLoading(false) }
  }

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase-orders')
      if (data.success) setOrders(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบสั่งซื้อได้') }
    finally { setLoading(false) }
  }

  const fetchReceipts = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/goods-receipts')
      if (data.success) setReceipts(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบรับสินค้าได้') }
    finally { setLoading(false) }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/invoices')
      if (data.success) setInvoices(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลใบแจ้งหนี้ได้') }
    finally { setLoading(false) }
  }

  const fetchPayments = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/payments')
      if (data.success) setPayments(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลการจ่ายเงินได้') }
    finally { setLoading(false) }
  }

  const fetchReturns = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/purchase/returns')
      if (data.success) setReturns(data.data)
    } catch (error: any) { handleApiError(error, 'ไม่สามารถดึงข้อมูลการคืนสินค้าได้') }
    finally { setLoading(false) }
  }

  // CRUD
  const handleCreateRequest = async () => {
    setFormLoading(true)
    try {
      const items = requestForm.items.filter(i => i.material_id || i.description).map(item => ({
        ...item,
        estimated_total_price: item.quantity * item.estimated_unit_price
      }))
      const { data } = await api.post('/purchase/requests', { ...requestForm, items })
      if (data.success) {
        toast.success('สร้างใบขอซื้อสำเร็จ')
        closeModal()
        fetchRequests()
      } else {
        toast.error(data.message || 'ไม่สามารถสร้างใบขอซื้อได้')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'เกิดข้อผิดพลาดในการสร้างใบขอซื้อ')
    } finally { setFormLoading(false) }
  }

  const handleUpdateRequest = async () => {
    if (!modalData?.id) return
    setFormLoading(true)
    try {
      const { data } = await api.put(`/purchase/requests/${modalData.id}/status`, { status: (requestForm as any).status || modalData.status })
      if (data.success) {
        toast.success('อัปเดตสถานะสำเร็จ')
        closeModal()
        fetchRequests()
      }
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด')
    } finally { setFormLoading(false) }
  }

  const handleDeleteRequest = async (id: string) => {
    if (!confirm('ต้องการลบใบขอซื้อนี้?')) return
    try {
      await api.delete(`/purchase/requests/${id}`)
      toast.success('ลบใบขอซื้อสำเร็จ')
      fetchRequests()
    } catch (error) { toast.error('ไม่สามารถลบใบขอซื้อได้') }
  }

  // Fixed: replaced prompt() with modal
  const handleConvertRequestToOrder = (requestId: string) => {
    setConvertPRId(requestId)
    setConvertForm({ supplier_id: '', expected_date: '', notes: '' })
  }

  const handleDoConvert = async () => {
    if (!convertForm.supplier_id) { toast.error('กรุณาเลือกผู้ขาย'); return }
    setConverting(true)
    try {
      const { data } = await api.post(`/purchase/requests/${convertPRId}/convert-to-po`, {
        supplierId: convertForm.supplier_id
      })
      if (data.success) {
        toast.success('แปลงเป็นใบสั่งซื้อสำเร็จ')
        setConvertPRId(null)
        fetchRequests()
        fetchOrders()
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'ไม่สามารถแปลงใบขอซื้อได้')
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
        unit_price: item.estimated_unit_price || 0,
        total_price: (item.quantity || 1) * (item.estimated_unit_price || 0),
        notes: item.notes || '',
      }))
      setOrderForm(p => ({
        ...p,
        linked_pr_id: prId,
        expected_date: pr.required_date?.split('T')[0] || p.expected_date,
        notes: pr.notes ? `อ้างอิง: ${pr.pr_number}${p.notes ? '\n' + p.notes : ''}` : p.notes,
        items: mappedItems.length > 0 ? mappedItems : p.items,
      }))
      toast.success(`โหลดรายการจาก ${pr.pr_number} แล้ว (${mappedItems.length} รายการ)`)
    } catch { toast.error('ไม่สามารถโหลดใบขอซื้อได้') }
  }

  const handleCreateOrder = async () => {
    setFormLoading(true)
    try {
      const items = orderForm.items.filter(i => i.material_id || i.description).map(item => ({
        materialId: item.material_id,
        description: item.description,
        quantity: item.quantity,
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
      if (data.success) {
        toast.success('สร้างใบสั่งซื้อสำเร็จ')
        closeModal()
        fetchOrders()
      } else { toast.error(data.message || 'ไม่สามารถสร้างใบสั่งซื้อได้') }
    } catch (error) { toast.error('เกิดข้อผิดพลาด') }
    finally { setFormLoading(false) }
  }

  const handleUpdateOrderStatus = async (id: string, status: string) => {
    try {
      const { data } = await api.put(`/purchase-orders/${id}/status`, { status })
      if (data.success) {
        const labels: Record<string, string> = {
          SUBMITTED: 'ส่งอนุมัติแล้ว', APPROVED: 'อนุมัติแล้ว', CANCELLED: 'ยกเลิกแล้ว'
        }
        toast.success(labels[status] || 'อัพเดทสถานะแล้ว')
        fetchOrders()
      } else { toast.error(data.message || 'ไม่สามารถอัพเดทสถานะได้') }
    } catch { toast.error('เกิดข้อผิดพลาด') }
  }

  const handleDeleteOrder = async (id: string) => {
    if (!confirm('ต้องการลบใบสั่งซื้อนี้?')) return
    try {
      await api.delete(`/purchase-orders/${id}`)
      toast.success('ลบใบสั่งซื้อสำเร็จ')
      fetchOrders()
    } catch (error) { toast.error('ไม่สามารถลบใบสั่งซื้อได้') }
  }

  const handleCreateReceipt = async () => {
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
          materialId: item.material_id,
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
        toast.success('สร้างใบรับสินค้าสำเร็จ')
        closeModal()
        fetchReceipts()
      } else { toast.error(data.message || 'ไม่สามารถสร้างใบรับสินค้าได้') }
    } catch (error) { toast.error('เกิดข้อผิดพลาด') }
    finally { setFormLoading(false) }
  }

  const handleConfirmReceipt = async (id: string) => {
    try {
      const { data } = await api.put(`/purchase/goods-receipts/${id}/confirm`)
      if (data.success) {
        toast.success('ยืนยันรับสินค้าสำเร็จ — อัพเดทสต็อกแล้ว')
        fetchReceipts()
        fetchOrders()
      } else { toast.error(data.message || 'ไม่สามารถยืนยันการรับสินค้าได้') }
    } catch (error: any) { toast.error(error.response?.data?.message || 'ไม่สามารถยืนยันการรับสินค้าได้') }
  }

  const handleDeleteReceipt = async (id: string) => {
    if (!confirm('ลบใบรับสินค้าร่างนี้?')) return
    try {
      await api.delete(`/purchase/goods-receipts/${id}`)
      toast.success('ลบใบรับสินค้าแล้ว')
      fetchReceipts()
    } catch { toast.error('ไม่สามารถลบได้') }
  }

  const handleCreateInvoice = async () => {
    setFormLoading(true)
    try {
      const { data } = await api.post('/purchase/invoices', {
        purchaseOrderId: invoiceForm.purchase_order_id,
        goodsReceiptIds: invoiceForm.goods_receipt_ids,
        supplierInvoiceNumber: invoiceForm.supplier_invoice_number,
        invoiceDate: invoiceForm.invoice_date,
        dueDate: invoiceForm.due_date,
        taxRate: invoiceForm.tax_rate,
        notes: invoiceForm.notes,
      })
      if (data.success) {
        toast.success('สร้างใบแจ้งหนี้สำเร็จ')
        closeModal()
        fetchInvoices()
      } else { toast.error(data.message || 'ไม่สามารถสร้างใบแจ้งหนี้ได้') }
    } catch (error) { toast.error('เกิดข้อผิดพลาด') }
    finally { setFormLoading(false) }
  }

  const handleCreatePayment = async () => {
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
        toast.success('บันทึกการจ่ายเงินสำเร็จ')
        closeModal()
        fetchPayments()
        fetchInvoices()
      } else { toast.error(data.message || 'ไม่สามารถบันทึกการจ่ายเงินได้') }
    } catch (error) { toast.error('เกิดข้อผิดพลาด') }
    finally { setFormLoading(false) }
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
        toast.success('สร้างใบคืนสินค้าสำเร็จ')
        closeModal()
        fetchReturns()
      } else { toast.error(data.message || 'ไม่สามารถสร้างใบคืนสินค้าได้') }
    } catch (error) { toast.error('เกิดข้อผิดพลาด') }
    finally { setFormLoading(false) }
  }

  const handleUpdateReturnStatus = async (id: string, status: string) => {
    try {
      const { data } = await api.put(`/purchase/returns/${id}/status`, { status })
      if (data.success) {
        const labels: Record<string, string> = { SUBMITTED: 'ส่งอนุมัติแล้ว', APPROVED: 'อนุมัติแล้ว', CANCELLED: 'ยกเลิกแล้ว' }
        toast.success(labels[status] || 'อัพเดทสถานะแล้ว')
        fetchReturns()
      } else { toast.error(data.message || 'ไม่สามารถอัพเดทสถานะได้') }
    } catch { toast.error('เกิดข้อผิดพลาด') }
  }

  const handleConfirmReturn = async (id: string) => {
    try {
      const { data } = await api.put(`/purchase/returns/${id}/confirm`)
      if (data.success) {
        toast.success('ยืนยันคืนสินค้า — ตัดสต็อกแล้ว')
        fetchReturns()
      } else { toast.error(data.message || 'ไม่สามารถยืนยันการคืนสินค้าได้') }
    } catch (error: any) { toast.error(error.response?.data?.message || 'ไม่สามารถยืนยันการคืนสินค้าได้') }
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
          items: data.items || [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }]
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
        setInvoiceForm({
          purchase_order_id: data.purchase_order_id || '',
          goods_receipt_ids: grIds,
          supplier_invoice_number: data.supplier_invoice_number || '',
          invoice_date: data.invoice_date?.split('T')[0] || new Date().toISOString().split('T')[0],
          due_date: data.due_date?.split('T')[0] || '',
          tax_rate: data.tax_rate || 7,
          notes: data.notes || ''
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
          items: data.items || [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }]
        })
      }
    } else {
      setRequestForm({ department: '', required_date: '', priority: 'NORMAL', preferred_supplier_id: '', notes: '', items: [{ material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] })
      setOrderForm({ supplier_id: '', expected_date: '', payment_terms: 30, discount: 0, tax_rate: 7, notes: '', linked_pr_id: '', items: [{ material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }] })
      setReceiptForm({ purchase_order_id: '', receipt_date: new Date().toISOString().split('T')[0], received_by: user?.email || '', delivery_note_no: '', notes: '', items: [] })
      setInvoiceForm({ purchase_order_id: '', goods_receipt_ids: [], supplier_invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', tax_rate: 7, notes: '' })
      setPaymentForm({ supplier_id: '', purchase_invoice_id: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'TRANSFER', payment_reference: '', amount: 0, withholding_tax: 0, notes: '' })
      setReturnForm({ purchase_order_id: '', goods_receipt_id: '', return_date: new Date().toISOString().split('T')[0], reason: '', tax_rate: 7, notes: '', items: [{ material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }] })
    }
  }

  const closeModal = () => {
    setModalOpen(null)
    setModalMode('create')
    setModalData(null)
  }

  // ── print helper: adds company info then delegates to purchasePrint utility
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
      printDocument(type, { ...doc, _company: user?.name || 'บริษัท' }, format)
    } catch { toast.error('ไม่สามารถโหลดข้อมูลเพื่อพิมพ์ได้') }
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

  const addOrderItem = () => setOrderForm(prev => ({ ...prev, items: [...prev.items, { material_id: '', description: '', quantity: 1, unit_price: 0, total_price: 0, notes: '' }] }))
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

  const addReturnItem = () => setReturnForm(prev => ({ ...prev, items: [...prev.items, { material_id: '', quantity: 1, unit_price: 0, total_price: 0, reason: '' }] }))
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
        setReceiptForm(prev => ({
          ...prev,
          purchase_order_id: poId,
          items: data.data.map((item: any) => ({
            purchase_order_item_id: item.id,
            material_id: item.material_id || '',
            description: item.description || item.material_name || '',
            unit: item.unit || 'หน่วย',
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
        }))
      }
    } catch (error) { toast.error('ไม่สามารถโหลดรายการที่ค้างรับได้') }
  }

  // Helpers
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  }

  // ─── UI Components ───────────────────────────────────────────────

  const StatusBadge = ({ status }: { status: string }) => {
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      DRAFT:     { bg: 'bg-gray-500/15',   text: 'text-gray-400',   label: 'ร่าง' },
      PENDING:   { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'รออนุมัติ' },
      SUBMITTED: { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: 'ส่งอนุมัติ' },
      APPROVED:  { bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'อนุมัติแล้ว' },
      REJECTED:  { bg: 'bg-red-500/15',    text: 'text-red-400',    label: 'ปฏิเสธ' },
      CONFIRMED: { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   label: 'ยืนยัน' },
      PARTIAL:   { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'บางส่วน' },
      RECEIVED:  { bg: 'bg-green-600/15',  text: 'text-green-400',  label: 'รับครบ' },
      UNPAID:    { bg: 'bg-red-500/15',    text: 'text-red-400',    label: 'ค้างจ่าย' },
      PAID:      { bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'จ่ายแล้ว' },
      OVERDUE:   { bg: 'bg-red-600/15',    text: 'text-red-400',    label: 'เกินกำหนด' },
      CANCELLED: { bg: 'bg-gray-500/15',   text: 'text-gray-500',   label: 'ยกเลิก' },
      ISSUED:    { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: 'ออกแล้ว' },
    }
    const c = cfg[status] || { bg: 'bg-gray-500/15', text: 'text-gray-400', label: status }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>
  }

  // Convert PR → PO Modal
  const ConvertToPOModal = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-cyber-border flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white">แปลงเป็นใบสั่งซื้อ</h2>
            <p className="text-sm text-gray-400 mt-0.5">เลือกผู้ขายเพื่อสร้าง PO จากใบขอซื้อนี้</p>
          </div>
          <button onClick={() => setConvertPRId(null)} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              ผู้ขาย <span className="text-red-400">*</span>
            </label>
            <select value={convertForm.supplier_id} onChange={e => setConvertForm(p => ({ ...p, supplier_id: e.target.value }))}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-white focus:outline-none focus:border-cyber-primary">
              <option value="">-- เลือกผู้ขาย --</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">กำหนดส่งสินค้า</label>
            <input type="date" value={convertForm.expected_date} onChange={e => setConvertForm(p => ({ ...p, expected_date: e.target.value }))}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-white focus:outline-none focus:border-cyber-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">หมายเหตุ</label>
            <textarea value={convertForm.notes} onChange={e => setConvertForm(p => ({ ...p, notes: e.target.value }))} rows={2}
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-xl text-white text-sm focus:outline-none focus:border-cyber-primary resize-none" />
          </div>
        </div>
        <div className="p-5 border-t border-cyber-border flex gap-3">
          <button onClick={() => setConvertPRId(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">ยกเลิก</button>
          <button onClick={handleDoConvert} disabled={converting || !convertForm.supplier_id}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 disabled:opacity-50 transition-colors">
            {converting
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <ArrowRight className="w-4 h-4" />}
            สร้างใบสั่งซื้อ
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
        label: 'ใบขอซื้อรออนุมัติ',
        count: summary?.purchaseRequests.pending || 0,
        color: 'text-yellow-400',
        tab: 'requests' as const,
      },
      {
        icon: ShoppingCart,
        label: 'ใบสั่งซื้อรอรับสินค้า',
        count: (summary?.purchaseOrders.pending || 0) + (summary?.purchaseOrders.partial || 0),
        color: 'text-blue-400',
        tab: 'orders' as const,
      },
      {
        icon: Receipt,
        label: 'ใบแจ้งหนี้ค้างจ่าย',
        count: summary?.invoices.unpaid || 0,
        color: 'text-red-400',
        tab: 'invoices' as const,
      },
    ].filter(a => a.count > 0)

    return (
      <div className="space-y-6">
        {/* Metric cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-cyber-primary/20 to-cyber-secondary/20 rounded-xl p-5 border border-cyber-primary/30">
            <p className="text-sm text-gray-400">ยอดสั่งซื้อรวม</p>
            <p className="text-2xl font-bold text-cyber-primary mt-1">{formatCurrency(summary?.purchaseOrders.totalAmount || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">{summary?.purchaseOrders.total || 0} ใบสั่งซื้อ</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-cyber-purple/20 to-cyber-magenta/20 rounded-xl p-5 border border-cyber-purple/30">
            <p className="text-sm text-gray-400">ใบขอซื้อรออนุมัติ</p>
            <p className="text-2xl font-bold text-cyber-purple mt-1">{summary?.purchaseRequests.pending || 0}</p>
            <p className="text-xs text-gray-500 mt-1">จาก {summary?.purchaseRequests.total || 0} ใบทั้งหมด</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-cyber-green/20 to-emerald-500/20 rounded-xl p-5 border border-cyber-green/30">
            <p className="text-sm text-gray-400">จ่ายเงินแล้ว</p>
            <p className="text-2xl font-bold text-cyber-green mt-1">{formatCurrency(summary?.payments.totalPaid || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">{summary?.payments.total || 0} รายการ</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-5 border border-orange-500/30">
            <p className="text-sm text-gray-400">ยอดค้างจ่าย</p>
            <p className="text-2xl font-bold text-orange-400 mt-1">{formatCurrency(summary?.invoices.outstanding || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">{summary?.invoices.unpaid || 0} ใบค้างจ่าย</p>
          </motion.div>
        </div>

        {/* Pending actions */}
        {pendingActions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="bg-cyber-card border border-yellow-500/30 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> รายการรอดำเนินการ
            </h3>
            <div className="space-y-2">
              {pendingActions.map(item => (
                <button key={item.label} onClick={() => setActiveTab(item.tab)}
                  className="w-full flex items-center justify-between p-3 bg-cyber-dark rounded-xl hover:bg-cyber-dark/60 transition-colors group">
                  <div className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-colors" />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${item.color}`}>{item.count}</span>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Workflow pipeline */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-cyber-card border border-cyber-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">กระบวนการจัดซื้อ</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: 'ใบขอซื้อ', count: summary?.purchaseRequests.total || 0, color: 'text-cyber-primary' },
              { label: 'ใบสั่งซื้อ', count: summary?.purchaseOrders.total || 0, color: 'text-cyber-purple' },
              { label: 'รับสินค้า', count: summary?.goodsReceipts.confirmed || 0, color: 'text-cyber-green' },
              { label: 'ใบแจ้งหนี้', count: summary?.invoices.total || 0, color: 'text-blue-400' },
              { label: 'จ่ายเงิน', count: summary?.payments.total || 0, color: 'text-green-400' },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="text-center min-w-[60px]">
                  <p className={`text-2xl font-bold ${step.color}`}>{step.count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{step.label}</p>
                </div>
                {i < arr.length - 1 && <ChevronRight className="w-5 h-5 text-gray-700 shrink-0" />}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Status grids */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-cyber-card border border-cyber-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-cyber-primary" /> สถานะใบสั่งซื้อ
            </h3>
            <div className="space-y-2">
              {[
                { label: 'ฉบับร่าง', value: summary?.purchaseOrders.draft || 0, color: 'text-gray-400' },
                { label: 'รอดำเนินการ', value: summary?.purchaseOrders.pending || 0, color: 'text-yellow-400' },
                { label: 'รับบางส่วน', value: summary?.purchaseOrders.partial || 0, color: 'text-orange-400' },
                { label: 'รับครบแล้ว', value: summary?.purchaseOrders.received || 0, color: 'text-green-400' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                  <span className="text-sm text-gray-400">{item.label}</span>
                  <span className={`text-lg font-semibold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-cyber-card border border-cyber-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-cyber-green" /> สถานะการจ่ายเงิน
            </h3>
            <div className="space-y-2">
              {[
                { label: 'ค้างจ่าย', value: summary?.invoices.unpaid || 0, color: 'text-red-400' },
                { label: 'จ่ายบางส่วน', value: summary?.invoices.partial || 0, color: 'text-yellow-400' },
                { label: 'จ่ายครบแล้ว', value: summary?.invoices.paid || 0, color: 'text-green-400' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                  <span className="text-sm text-gray-400">{item.label}</span>
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
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        className="w-full pl-9 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary text-sm" />
    </div>
  )

  const EmptyState = ({ text }: { text: string }) => (
    <div className="text-center py-16 text-gray-500 bg-cyber-card border border-cyber-border rounded-xl">{text}</div>
  )

  // ─── Document list content components ────────────────────────────
  const RequestsContent = () => {
    const filtered = requests.filter(r =>
      r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.requester_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาใบขอซื้อ..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('request', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> สร้างใบขอซื้อ
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการใบขอซื้อ" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(req => (
              <div key={req.id} className="bg-cyber-card border border-cyber-border hover:border-cyber-primary/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{req.pr_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{req.requester_name}</p>
                    <p className="text-sm text-gray-400">{req.department || '-'}</p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>ขอ {formatDate(req.request_date)}</span>
                  <span>ต้องการ {formatDate(req.required_date)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div>
                    {req.priority === 'URGENT' && <span className="text-xs text-red-400 font-semibold">⚡ ด่วนมาก</span>}
                    {req.priority === 'HIGH' && <span className="text-xs text-orange-400 font-semibold">↑ สำคัญ</span>}
                  </div>
                  <p className="font-bold text-white text-sm">{formatCurrency(req.total_amount)}</p>
                </div>
                <div className="flex gap-2 mt-auto pt-3 mt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModalWithDetail('request', 'view', req.id, req)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('pr', req.id)}
                    title="พิมพ์ A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {req.status === 'DRAFT' && (
                    <button onClick={() => openModalWithDetail('request', 'edit', req.id, req)}
                      className="flex-1 py-1.5 text-xs text-cyber-primary bg-cyber-primary/10 rounded-lg hover:bg-cyber-primary/20 transition-colors">
                      แก้ไข
                    </button>
                  )}
                  {req.status === 'APPROVED' && (
                    <button onClick={() => handleConvertRequestToOrder(req.id)}
                      className="flex-1 py-1.5 text-xs text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 font-medium transition-colors flex items-center justify-center gap-1">
                      แปลง PO <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  {req.status === 'DRAFT' && (
                    <button onClick={() => handleDeleteRequest(req.id)}
                      className="px-2.5 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const OrdersContent = () => {
    const filtered = orders.filter(o =>
      o.po_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาใบสั่งซื้อ..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('order', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> สร้างใบสั่งซื้อ
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการใบสั่งซื้อ" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(order => (
              <div key={order.id} className="bg-cyber-card border border-cyber-border hover:border-cyber-primary/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{order.po_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{order.supplier_name}</p>
                    <p className="text-sm text-gray-400">{order.supplier_code}</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>สั่ง {formatDate(order.order_date)}</span>
                  <span>กำหนดรับ {formatDate(order.expected_date)}</span>
                </div>
                {/* Option A: Procurement chain badges */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {order.linked_pr_id && (() => { const pr = requests.find(r => r.id === order.linked_pr_id); return pr ? (
                    <span className="text-xs font-mono text-gray-400 bg-gray-500/10 px-1.5 py-0.5 rounded">
                      {pr.pr_number}
                    </span>
                  ) : null })()}
                  {(() => {
                    const grAll = receipts.filter(r => r.purchase_order_id === order.id)
                    const grDraft = grAll.filter(r => r.status === 'DRAFT')
                    const grConfirmed = grAll.filter(r => r.status === 'CONFIRMED')
                    return (<>
                      {grConfirmed.length > 0 && (
                        <span className="text-xs text-cyber-green bg-cyber-green/10 px-1.5 py-0.5 rounded">
                          GR ×{grConfirmed.length}
                        </span>
                      )}
                      {grDraft.length > 0 && (
                        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <AlertCircle className="w-2.5 h-2.5" /> GR ร่าง ×{grDraft.length}
                        </span>
                      )}
                    </>)
                  })()}
                  {(() => { const invCount = invoices.filter(i => i.purchase_order_id === order.id).length; return invCount > 0 ? (
                    <span className="text-xs text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                      INV ×{invCount}
                    </span>
                  ) : null })()}
                </div>
                <p className="font-bold text-white text-sm mt-2 text-right">{formatCurrency(order.total_amount)}</p>
                <div className="flex gap-2 mt-3 pt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModalWithDetail('order', 'view', order.id, order)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('po', order.id)}
                    title="พิมพ์ใบสั่งซื้อ A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {/* DRAFT → ส่งอนุมัติ + ลบ */}
                  {order.status === 'DRAFT' && (<>
                    <button onClick={() => handleUpdateOrderStatus(order.id, 'SUBMITTED')}
                      className="flex-1 py-1.5 text-xs text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 font-medium transition-colors">
                      ส่งอนุมัติ
                    </button>
                    <button onClick={() => handleDeleteOrder(order.id)}
                      className="px-2.5 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>)}
                  {/* SUBMITTED → อนุมัติ */}
                  {order.status === 'SUBMITTED' && (
                    <button onClick={() => handleUpdateOrderStatus(order.id, 'APPROVED')}
                      className="flex-1 py-1.5 text-xs text-green-400 bg-green-500/10 rounded-lg hover:bg-green-500/20 font-medium transition-colors flex items-center justify-center gap-1">
                      <Check className="w-3 h-3" /> อนุมัติ
                    </button>
                  )}
                  {/* APPROVED / PARTIAL → รับสินค้า */}
                  {(order.status === 'APPROVED' || order.status === 'PARTIAL') && (
                    <button onClick={() => {
                      setReceiptForm(p => ({ ...p, purchase_order_id: order.id, items: [] }))
                      loadPendingItems(order.id)
                      openModal('receipt', 'create')
                    }}
                      className="flex-1 py-1.5 text-xs text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 font-medium transition-colors flex items-center justify-center gap-1">
                      รับสินค้า <Package className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const ReceiptsContent = () => {
    const filtered = receipts.filter(r =>
      r.gr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.po_number?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาใบรับสินค้า..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('receipt', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> บันทึกรับสินค้า
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการรับสินค้า" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(receipt => (
              <div key={receipt.id} className="bg-cyber-card border border-cyber-border hover:border-cyber-primary/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{receipt.gr_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{receipt.supplier_name}</p>
                    <p className="text-sm text-gray-400">PO: {receipt.po_number}</p>
                  </div>
                  <StatusBadge status={receipt.status} />
                </div>
                <p className="text-xs text-gray-500 mt-2">รับวันที่ {formatDate(receipt.receipt_date)}</p>
                {receipt.journal_entry_number && (
                  <p className="text-xs text-cyber-primary/70 mt-1">สมุดรายวัน: {receipt.journal_entry_number}</p>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModalWithDetail('receipt', 'view', receipt.id, receipt)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('gr', receipt.id, 'a4')}
                    title="พิมพ์ A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handlePrint('gr', receipt.id, 'thermal')}
                    title="พิมพ์สลิป 80mm"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-yellow-400 bg-cyber-dark rounded-lg transition-colors text-xs leading-none">
                    🧾
                  </button>
                  {receipt.status === 'DRAFT' && (<>
                    <button onClick={() => handleConfirmReceipt(receipt.id)}
                      className="flex-1 py-1.5 text-xs text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 font-medium transition-colors flex items-center justify-center gap-1">
                      <Check className="w-3 h-3" /> ยืนยัน
                    </button>
                    <button onClick={() => handleDeleteReceipt(receipt.id)}
                      className="px-2.5 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const InvoicesContent = () => {
    const filtered = invoices.filter(i =>
      i.pi_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาใบแจ้งหนี้..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('invoice', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> สร้างใบแจ้งหนี้
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการใบแจ้งหนี้" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(invoice => (
              <div key={invoice.id} className={`bg-cyber-card border rounded-xl p-4 transition-colors flex flex-col ${invoice.payment_status === 'UNPAID' ? 'border-red-500/30 hover:border-red-400/50' : 'border-cyber-border hover:border-cyber-primary/40'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{invoice.pi_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{invoice.supplier_name}</p>
                    <p className="text-sm text-gray-400">PO: {invoice.po_number}</p>
                  </div>
                  <StatusBadge status={invoice.payment_status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>ออก {formatDate(invoice.invoice_date)}</span>
                  <span>ครบ {formatDate(invoice.due_date)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">ยอดรวม {formatCurrency(invoice.total_amount)}</span>
                  {invoice.balance_amount > 0 && (
                    <span className="text-sm font-bold text-red-400">ค้าง {formatCurrency(invoice.balance_amount)}</span>
                  )}
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModalWithDetail('invoice', 'view', invoice.id, invoice)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('pi', invoice.id)}
                    title="พิมพ์ใบสำคัญรับ A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {invoice.payment_status !== 'PAID' && (
                    <button onClick={() => openModal('payment', 'create', { purchase_invoice_id: invoice.id, supplier_id: invoice.supplier_id, amount: invoice.balance_amount })}
                      className="flex-1 py-1.5 text-xs text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 font-medium transition-colors flex items-center justify-center gap-1">
                      <DollarSign className="w-3 h-3" /> จ่ายเงิน
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const PaymentsContent = () => {
    const filtered = payments.filter(p =>
      p.payment_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const methodLabel: Record<string, string> = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', CREDIT_CARD: 'บัตรเครดิต' }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาการจ่ายเงิน..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('payment', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> บันทึกจ่ายเงิน
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการจ่ายเงิน" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(payment => (
              <div key={payment.id} className="bg-cyber-card border border-cyber-border hover:border-cyber-primary/40 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{payment.payment_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{payment.supplier_name}</p>
                    <p className="text-sm text-gray-400">{methodLabel[payment.payment_method] || payment.payment_method}</p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400">จ่ายแล้ว</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">{formatDate(payment.payment_date)}</span>
                  <span className="font-bold text-cyber-green text-sm">{formatCurrency(payment.amount)}</span>
                </div>
                {payment.journal_entry_number && (
                  <p className="text-xs text-cyber-primary/70 mt-1">สมุดรายวัน: {payment.journal_entry_number}</p>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModal('payment', 'view', payment)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('payment', payment.id)}
                    title="พิมพ์ใบสำคัญจ่าย A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const ReturnsContent = () => {
    const filtered = returns.filter(r =>
      r.pr_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const reasonLabel: Record<string, string> = {
      DEFECTIVE: 'สินค้าเสียหาย', WRONG_ITEM: 'ส่งผิดรายการ',
      WRONG_QUANTITY: 'ส่งผิดจำนวน', QUALITY_ISSUE: 'คุณภาพไม่ตรง',
      EXPIRED: 'หมดอายุ', OTHER: 'อื่นๆ'
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SearchBar placeholder="ค้นหาใบคืนสินค้า..." value={searchQuery} onChange={setSearchQuery} />
          <button onClick={() => openModal('return', 'create')}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 whitespace-nowrap text-sm">
            <Plus className="w-4 h-4" /> สร้างใบคืนสินค้า
          </button>
        </div>
        {filtered.length === 0 ? <EmptyState text="ไม่พบรายการคืนสินค้า" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(ret => (
              <div key={ret.id} className="bg-cyber-card border border-cyber-border hover:border-red-400/30 rounded-xl p-4 transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{ret.pr_number}</p>
                    <p className="font-semibold text-white mt-0.5 truncate">{ret.supplier_name}</p>
                    <p className="text-sm text-gray-400">PO: {ret.po_number}</p>
                  </div>
                  <StatusBadge status={ret.status} />
                </div>
                <p className="text-xs text-orange-400/80 mt-1">{reasonLabel[ret.reason] || ret.reason}</p>
                <p className="font-bold text-red-400 text-sm mt-2 text-right">{formatCurrency(ret.total_amount)}</p>
                <div className="flex gap-2 mt-3 pt-3 border-t border-cyber-border/40">
                  <button onClick={() => openModalWithDetail('return', 'view', ret.id, ret)}
                    className="flex-1 py-1.5 text-xs text-gray-300 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handlePrint('return', ret.id)}
                    title="พิมพ์ใบส่งคืน A4"
                    className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-cyber-dark rounded-lg transition-colors">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {/* DRAFT → ส่งอนุมัติ */}
                  {ret.status === 'DRAFT' && (
                    <button onClick={() => handleUpdateReturnStatus(ret.id, 'SUBMITTED')}
                      className="flex-1 py-1.5 text-xs text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 font-medium transition-colors">
                      ส่งอนุมัติ
                    </button>
                  )}
                  {/* SUBMITTED → อนุมัติ */}
                  {ret.status === 'SUBMITTED' && (
                    <button onClick={() => handleUpdateReturnStatus(ret.id, 'APPROVED')}
                      className="flex-1 py-1.5 text-xs text-green-400 bg-green-500/10 rounded-lg hover:bg-green-500/20 font-medium transition-colors flex items-center justify-center gap-1">
                      <Check className="w-3 h-3" /> อนุมัติ
                    </button>
                  )}
                  {/* APPROVED → ยืนยันคืนสินค้า (ตัดสต็อก) */}
                  {ret.status === 'APPROVED' && (
                    <button onClick={() => handleConfirmReturn(ret.id)}
                      className="flex-1 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 font-medium transition-colors flex items-center justify-center gap-1">
                      <Check className="w-3 h-3" /> ยืนยันคืนสินค้า
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── 1. Request Modal ────────────────────────────────────────────────────────
  const RequestModal = () => (
    <ModalShell
      title={modalMode === 'create' ? 'สร้างใบขอซื้อ' : modalMode === 'edit' ? 'แก้ไขใบขอซื้อ' : 'รายละเอียดใบขอซื้อ'}
      onClose={closeModal}
      footer={
        modalMode !== 'view' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={modalMode === 'create' ? handleCreateRequest : handleUpdateRequest} disabled={formLoading}
              className="px-6 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {modalMode === 'create' ? 'สร้างใบขอซื้อ' : 'บันทึก'}
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ปิด</button>
      }
    >
      {/* Header info row */}
      {modalMode === 'view' && modalData?.pr_number && (
        <div className="flex items-center gap-2 p-3 bg-cyber-primary/10 border border-cyber-primary/20 rounded-xl">
          <FileText className="w-4 h-4 text-cyber-primary shrink-0" />
          <span className="text-sm font-mono text-cyber-primary font-semibold">{modalData.pr_number}</span>
          <span className="text-xs text-gray-400 ml-auto">สร้างโดย: {modalData.requester_name}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="แผนก">
          <input type="text" value={requestForm.department} onChange={e => setRequestForm(p => ({ ...p, department: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} placeholder="เช่น การผลิต, คลังสินค้า" />
        </Field>
        <Field label="ต้องการภายในวันที่" required>
          <input type="date" value={requestForm.required_date} onChange={e => setRequestForm(p => ({ ...p, required_date: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} />
        </Field>
        <Field label="ระดับความสำคัญ">
          <select value={requestForm.priority} onChange={e => setRequestForm(p => ({ ...p, priority: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')}>
            <option value="LOW">🟢 ต่ำ — ไม่เร่งด่วน</option>
            <option value="NORMAL">🔵 ปกติ</option>
            <option value="HIGH">🟡 สูง — เร่งด่วน</option>
            <option value="URGENT">🔴 ด่วนมาก — หยุดสายการผลิต</option>
          </select>
        </Field>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-300">ผู้ขายที่แนะนำ (optional)</label>
            {modalMode !== 'view' && (
              <button onClick={() => openQuickAddSupplier(id => setRequestForm(p => ({ ...p, preferred_supplier_id: id })))}
                className="text-xs text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1 px-2 py-0.5 border border-cyber-primary/30 rounded-lg hover:bg-cyber-primary/10 transition-colors">
                <Plus className="w-3 h-3" /> เพิ่มใหม่
              </button>
            )}
          </div>
          <SupplierSearchInput suppliers={suppliers}
            value={requestForm.preferred_supplier_id}
            onChange={id => setRequestForm(p => ({ ...p, preferred_supplier_id: id }))}
            disabled={modalMode === 'view'}
            placeholder="ค้นหาผู้ขาย..."
          />
        </div>
      </div>

      <Field label="หมายเหตุ / เหตุผลที่ขอ">
        <textarea value={requestForm.notes} onChange={e => setRequestForm(p => ({ ...p, notes: e.target.value }))}
          disabled={modalMode === 'view'} rows={2} className={`${inputCls(modalMode === 'view')} resize-none`}
          placeholder="เช่น วัตถุดิบหมด, เตรียมสำหรับออเดอร์ลูกค้า..." />
      </Field>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-gray-300">รายการสินค้า/วัตถุดิบ
            <span className="ml-2 text-xs text-gray-500">({requestForm.items.length} รายการ)</span>
          </span>
          {modalMode !== 'view' && (
            <button onClick={addRequestItem}
              className="flex items-center gap-1 px-2.5 py-1 bg-cyber-primary/10 text-cyber-primary text-xs rounded-lg hover:bg-cyber-primary/20 transition-colors">
              <Plus className="w-3 h-3" /> เพิ่มรายการ
            </button>
          )}
        </div>
        <div className="space-y-3">
          {requestForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-cyber-dark rounded-xl space-y-2 border border-cyber-border/40">
              {/* Row 1: material + description */}
              <div className="grid grid-cols-2 gap-2">
                <MaterialSearchInput materials={materials}
                  value={item.material_id}
                  disabled={modalMode === 'view'}
                  onChange={(id, mat) => updateRequestItemFields(index, {
                    material_id: id,
                    unit: mat?.unit || item.unit,
                    description: mat ? mat.name : ''
                  })}
                />
                <input type="text" placeholder="รายละเอียดเพิ่มเติม" value={item.description}
                  onChange={e => updateRequestItem(index, 'description', e.target.value)}
                  disabled={modalMode === 'view'}
                  className="w-full px-2.5 py-2 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
              </div>
              {/* Row 2: qty + unit + price + total + delete */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">จำนวน</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateRequestItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    disabled={modalMode === 'view'}
                    className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white text-center focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">หน่วย</label>
                  <input type="text" value={item.unit}
                    onChange={e => updateRequestItem(index, 'unit', e.target.value)}
                    disabled={modalMode === 'view'}
                    placeholder="ชิ้น/กก."
                    className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-gray-500 mb-0.5 block">ราคา/หน่วย (ประมาณ)</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.estimated_unit_price}
                      onChange={e => updateRequestItem(index, 'estimated_unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full pl-5 pr-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
                  </div>
                </div>
                <div className="col-span-4 flex items-end justify-between">
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">รวม</label>
                    <span className="text-sm font-semibold text-cyber-primary">{formatCurrency(item.estimated_total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <button onClick={() => removeRequestItem(index)}
                      className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {requestForm.items.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-cyber-border rounded-xl">
              ยังไม่มีรายการ — กดเพิ่มรายการด้านบน
            </div>
          )}
        </div>
        {requestForm.items.length > 0 && (
          <div className="flex justify-end mt-3 p-3 bg-cyber-primary/5 rounded-xl">
            <div className="text-right">
              <p className="text-xs text-gray-400">รวมประมาณการทั้งหมด</p>
              <p className="text-lg font-bold text-cyber-primary">
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
      title={modalMode === 'create' ? 'สร้างใบสั่งซื้อ (PO)' : 'รายละเอียดใบสั่งซื้อ'}
      onClose={closeModal}
      footer={
        modalMode !== 'view' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={handleCreateOrder} disabled={formLoading || !orderForm.supplier_id || orderForm.items.length === 0}
              className="px-6 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              สร้างใบสั่งซื้อ
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ปิด</button>
      }
    >
      {/* PO header display when viewing */}
      {modalMode === 'view' && modalData?.po_number && (
        <div className="flex items-center gap-2 p-3 bg-cyber-primary/10 border border-cyber-primary/20 rounded-xl">
          <ShoppingCart className="w-4 h-4 text-cyber-primary shrink-0" />
          <span className="text-sm font-mono text-cyber-primary font-semibold">{modalData.po_number}</span>
          <span className="text-xs text-gray-400 ml-auto">{modalData.supplier_name}</span>
        </div>
      )}

      {/* PR Reference — create mode only */}
      {modalMode === 'create' && (
        <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-1.5">
          <label className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> อ้างอิงใบขอซื้อ (ไม่บังคับ — เลือกเพื่อโหลดรายการอัตโนมัติ)
          </label>
          <PRSearchInput
            requests={requests.filter(r => r.status === 'APPROVED' || r.status === 'PENDING')}
            value={orderForm.linked_pr_id}
            onChange={(id) => handleSelectPR(id)}
          />
          {orderForm.linked_pr_id && (
            <p className="text-xs text-blue-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              โหลดรายการจากใบขอซื้อแล้ว — แก้ไขได้ตามต้องการ
            </p>
          )}
        </div>
      )}

      {/* Supplier + delivery */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-300">ผู้ขาย <span className="text-red-400">*</span></label>
            {modalMode !== 'view' && (
              <button onClick={() => openQuickAddSupplier(id => setOrderForm(p => ({ ...p, supplier_id: id })))}
                className="text-xs text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1 px-2 py-0.5 border border-cyber-primary/30 rounded-lg hover:bg-cyber-primary/10 transition-colors">
                <Plus className="w-3 h-3" /> เพิ่มผู้ขายใหม่
              </button>
            )}
          </div>
          <SupplierSearchInput suppliers={suppliers} value={orderForm.supplier_id}
            onChange={id => setOrderForm(p => ({ ...p, supplier_id: id }))}
            disabled={modalMode === 'view'}
            placeholder="ค้นหา รหัส / ชื่อผู้ขาย..." />
        </div>
        <Field label="กำหนดส่งสินค้า">
          <input type="date" value={orderForm.expected_date}
            onChange={e => setOrderForm(p => ({ ...p, expected_date: e.target.value }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')} />
        </Field>
        <Field label="เงื่อนไขการชำระ">
          <select value={orderForm.payment_terms}
            onChange={e => setOrderForm(p => ({ ...p, payment_terms: parseInt(e.target.value) }))}
            disabled={modalMode === 'view'} className={inputCls(modalMode === 'view')}>
            <option value={0}>COD — ชำระทันที</option>
            <option value={15}>NET 15 วัน</option>
            <option value={30}>NET 30 วัน</option>
            <option value={45}>NET 45 วัน</option>
            <option value={60}>NET 60 วัน</option>
          </select>
        </Field>
      </div>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-gray-300">รายการสินค้า
            <span className="ml-2 text-xs text-gray-500">({orderForm.items.length} รายการ)</span>
          </span>
          {modalMode !== 'view' && (
            <button onClick={addOrderItem}
              className="flex items-center gap-1 px-2.5 py-1 bg-cyber-primary/10 text-cyber-primary text-xs rounded-lg hover:bg-cyber-primary/20">
              <Plus className="w-3 h-3" /> เพิ่มรายการ
            </button>
          )}
        </div>
        <div className="space-y-3">
          {orderForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-cyber-dark rounded-xl space-y-2 border border-cyber-border/40">
              <div className="grid grid-cols-2 gap-2">
                <MaterialSearchInput materials={materials} value={item.material_id} disabled={modalMode === 'view'}
                  onChange={(id, mat) => updateOrderItemFields(index, {
                    material_id: id,
                    description: mat ? mat.name : '',
                    // suggest last purchase cost from stock — user can override
                    unit_price: mat?.unitCost && item.unit_price === 0 ? mat.unitCost : item.unit_price,
                  })} />
                <input type="text" placeholder="รายละเอียด" value={item.description}
                  onChange={e => updateOrderItem(index, 'description', e.target.value)}
                  disabled={modalMode === 'view'}
                  className="w-full px-2.5 py-2 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
              </div>
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">จำนวน</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateOrderItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    disabled={modalMode === 'view'}
                    className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white text-center focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
                </div>
                <div className="col-span-4">
                  <label className="text-xs text-gray-500 mb-0.5 block">ราคา/หน่วย (บาท)</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.unit_price}
                      onChange={e => updateOrderItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      disabled={modalMode === 'view'}
                      className="w-full pl-5 pr-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary disabled:opacity-50" />
                  </div>
                </div>
                <div className="col-span-5 flex items-end justify-between">
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">รวม</label>
                    <span className="text-sm font-semibold text-cyber-primary">{formatCurrency(item.total_price)}</span>
                  </div>
                  {modalMode !== 'view' && (
                    <button onClick={() => removeOrderItem(index)}
                      className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {orderForm.items.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-cyber-border rounded-xl">
              ยังไม่มีรายการ — กดเพิ่มรายการด้านบน
            </div>
          )}
        </div>
      </div>

      {/* Amounts breakdown */}
      {orderForm.items.length > 0 && (
        <div className="p-4 bg-cyber-dark rounded-xl space-y-2 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>ก่อนหักส่วนลด</span><span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between gap-2 items-center">
            <span className="text-gray-400">ส่วนลด (บาท)</span>
            {modalMode !== 'view' ? (
              <div className="relative w-32">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">฿</span>
                <input type="number" min="0" value={orderForm.discount}
                  onChange={e => setOrderForm(p => ({ ...p, discount: parseFloat(e.target.value) || 0 }))}
                  className="w-full pl-5 pr-2 py-1 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary text-right" />
              </div>
            ) : <span className="text-orange-400">-{formatCurrency(orderForm.discount)}</span>}
          </div>
          <div className="flex justify-between gap-2 items-center">
            <span className="text-gray-400">ภาษี (%)</span>
            {modalMode !== 'view' ? (
              <div className="relative w-32">
                <input type="number" min="0" max="30" value={orderForm.tax_rate}
                  onChange={e => setOrderForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary text-right" />
              </div>
            ) : <span className="text-gray-300">VAT {orderForm.tax_rate}% = {formatCurrency(taxAmount)}</span>}
          </div>
          <div className="flex justify-between font-bold text-white border-t border-cyber-border pt-2">
            <span>รวมทั้งสิ้น</span>
            <span className="text-lg text-cyber-primary">{formatCurrency(grandTotal)}</span>
          </div>
        </div>
      )}

      <Field label="หมายเหตุ">
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
      title="บันทึกรับสินค้า (GR)"
      onClose={closeModal}
      footer={
        <div className="flex justify-between items-center w-full">
          <span className="text-xs text-gray-500">
            {receiptForm.items.length > 0
              ? `${receiptForm.items.length} รายการ · รวมรับ ${receiptForm.items.reduce((s, i) => s + i.accepted_qty, 0).toFixed(2)} หน่วย`
              : 'เลือก PO เพื่อโหลดรายการ'}
          </span>
          <div className="flex gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={handleCreateReceipt}
              disabled={formLoading || !receiptForm.purchase_order_id || receiptForm.items.length === 0}
              className="px-6 py-2.5 bg-cyber-green text-cyber-dark font-semibold rounded-xl hover:bg-cyber-green/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              <Check className="w-4 h-4" /> ยืนยันรับสินค้า
            </button>
          </div>
        </div>
      }
    >
      {/* ── Section 1: เลือก PO ── */}
      <div className="space-y-3">
        <Field label="เลือกใบสั่งซื้อ (PO)" required>
          <POSearchInput
            orders={orders.filter(o => !['CANCELLED', 'RECEIVED'].includes(o.status))}
            value={receiptForm.purchase_order_id}
            onChange={id => { setReceiptForm(p => ({ ...p, purchase_order_id: id, items: [] })); if (id) loadPendingItems(id) }}
          />
        </Field>

        {/* PO summary */}
        {selectedPO && (
          <div className="grid grid-cols-4 gap-3 p-3 bg-cyber-green/5 border border-cyber-green/20 rounded-xl text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">ผู้ขาย</p>
              <p className="text-white font-medium truncate">{selectedPO.supplier_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">มูลค่า PO</p>
              <p className="text-cyber-primary font-semibold">{formatCurrency(selectedPO.total_amount)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">กำหนดส่ง</p>
              <p className="text-white">{selectedPO.expected_date ? new Date(selectedPO.expected_date).toLocaleDateString('th-TH') : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">สถานะ</p>
              <p className={`text-xs font-medium ${selectedPO.status === 'PARTIAL' ? 'text-yellow-400' : 'text-green-400'}`}>
                {selectedPO.status === 'PARTIAL' ? 'รับบางส่วนแล้ว' : 'รอรับสินค้า'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: ข้อมูลการรับ ── */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="วันที่รับสินค้า">
          <input type="date" value={receiptForm.receipt_date}
            onChange={e => setReceiptForm(p => ({ ...p, receipt_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label="ผู้รับสินค้า">
          <input type="text" value={receiptForm.received_by}
            onChange={e => setReceiptForm(p => ({ ...p, received_by: e.target.value }))}
            placeholder="ชื่อพนักงานที่รับ" className={inputCls()} />
        </Field>
        <Field label="เลขที่ใบส่งของ (DO No.)">
          <input type="text" value={receiptForm.delivery_note_no}
            onChange={e => setReceiptForm(p => ({ ...p, delivery_note_no: e.target.value }))}
            placeholder="เช่น DO-2026-001" className={inputCls()} />
        </Field>
        <Field label="หมายเหตุ">
          <input type="text" value={receiptForm.notes}
            onChange={e => setReceiptForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="เช่น ส่งมาล่าช้า, สินค้าบุบบางส่วน" className={inputCls()} />
        </Field>
      </div>

      {/* ── Section 3: รายการสินค้า ── */}
      {receiptForm.items.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            รายการสินค้าที่ต้องรับ
            <span className="text-xs font-normal text-gray-500">({receiptForm.items.length} รายการ)</span>
          </p>
          <div className="space-y-4">
            {receiptForm.items.map((item, index) => {
              const pendingPct = item.ordered_qty > 0 ? (item.pending_qty / item.ordered_qty) * 100 : 0
              return (
                <div key={index} className="p-4 bg-cyber-dark rounded-xl border border-cyber-border/40 space-y-3">

                  {/* ── Item header ── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{item.description || item.material_id}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        ราคา/หน่วย: <span className="text-cyber-primary font-medium">{formatCurrency(item.unit_price)}</span>
                        {item.unit && <span className="ml-2 text-gray-600">· {item.unit}</span>}
                      </p>
                    </div>
                    {/* Progress bar: already received vs ordered */}
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500 mb-1">
                        รับแล้ว {item.already_received_qty}/{item.ordered_qty} {item.unit}
                      </p>
                      <div className="w-32 h-1.5 bg-cyber-border rounded-full overflow-hidden">
                        <div className="h-full bg-cyber-green rounded-full transition-all"
                          style={{ width: `${Math.min(100 - pendingPct, 100)}%` }} />
                      </div>
                      <p className="text-xs text-yellow-400 mt-0.5">คงค้าง {item.pending_qty} {item.unit}</p>
                    </div>
                  </div>

                  {/* ── Qty inputs ── */}
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { label: 'รับจริง (ครั้งนี้)', key: 'received_qty' as const, color: 'border-blue-500/50 focus:border-blue-400' },
                      { label: 'รับเข้าสต็อก ✓', key: 'accepted_qty' as const, color: 'border-cyber-green/50 focus:border-cyber-green' },
                      { label: 'ปฏิเสธ / เสียหาย ✗', key: 'rejected_qty' as const, color: 'border-red-500/50 focus:border-red-400' },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
                        <input type="number" min="0" step="0.01" value={item[f.key]}
                          onChange={e => updateItem(index, f.key, parseFloat(e.target.value) || 0)}
                          className={`w-full px-2 py-2 bg-cyber-card border ${f.color} rounded-lg text-sm text-white text-center focus:outline-none`} />
                      </div>
                    ))}
                  </div>

                  {/* ── Warnings ── */}
                  {item.received_qty > item.pending_qty && item.pending_qty > 0 && (
                    <p className="text-xs text-yellow-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> รับเกินยอดคงค้าง {(item.received_qty - item.pending_qty).toFixed(2)} {item.unit}
                    </p>
                  )}
                  {(item.received_qty !== item.accepted_qty + item.rejected_qty) && item.received_qty > 0 && (
                    <p className="text-xs text-orange-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> รับจริง ≠ รับเข้าสต็อก + ปฏิเสธ (ยอดไม่สมดุล)
                    </p>
                  )}

                  {/* ── Lot + Location + Rejection notes ── */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 flex items-center gap-1 block">
                        <span className="text-yellow-400">*</span> Lot / Batch No.
                      </label>
                      <input type="text" value={item.lot_number} placeholder="เช่น LOT-2026-001"
                        onChange={e => updateItem(index, 'lot_number', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-cyber-card border border-yellow-500/30 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">สถานที่จัดเก็บ</label>
                      <input type="text" value={item.location} placeholder="เช่น คลัง A, ชั้น 3"
                        onChange={e => updateItem(index, 'location', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary" />
                    </div>
                  </div>
                  {item.rejected_qty > 0 && (
                    <input type="text" value={item.notes} placeholder="สาเหตุที่ปฏิเสธ / รายละเอียดความเสียหาย..."
                      onChange={e => updateItem(index, 'notes', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-cyber-card border border-red-500/30 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-400" />
                  )}

                  {/* ── Line total ── */}
                  <div className="flex justify-end pt-1 border-t border-cyber-border/30">
                    <span className="text-xs text-gray-500 mr-2">มูลค่ารับเข้า</span>
                    <span className="text-sm font-semibold text-cyber-primary">
                      {formatCurrency(item.accepted_qty * item.unit_price)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total summary */}
          <div className="mt-3 p-3 bg-cyber-primary/5 border border-cyber-primary/20 rounded-xl flex justify-between items-center">
            <span className="text-sm text-gray-400">มูลค่ารับเข้าสต็อกรวม</span>
            <span className="text-lg font-bold text-cyber-primary">
              {formatCurrency(receiptForm.items.reduce((s, i) => s + i.accepted_qty * i.unit_price, 0))}
            </span>
          </div>
        </div>
      ) : receiptForm.purchase_order_id ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <div className="w-5 h-5 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          กำลังโหลดรายการจาก PO...
        </div>
      ) : (
        <div className="text-center py-8 text-gray-600 text-sm border border-dashed border-cyber-border/40 rounded-xl">
          เลือกใบสั่งซื้อด้านบนเพื่อโหลดรายการสินค้าที่ต้องรับ
        </div>
      )}
    </ModalShell>
    )
  }

  // ─── 4. Invoice Modal ────────────────────────────────────────────────────────
  const InvoiceModal = () => {
    const selectedPO     = orders.find(o => o.id === invoiceForm.purchase_order_id)
    const selectedGRs    = invoiceForm.goods_receipt_ids.map(id => receipts.find(r => r.id === id)).filter(Boolean) as GoodsReceipt[]
    const linkedPR       = selectedPO?.linked_pr_id ? requests.find(r => r.id === selectedPO.linked_pr_id) : null
    const poGRs          = receipts.filter(r => r.purchase_order_id === invoiceForm.purchase_order_id && r.status === 'CONFIRMED')
    const supplierDetail = selectedPO ? suppliers.find(s => s.id === selectedPO.supplier_id) : null
    const subtotal    = selectedPO?.subtotal || 0
    const taxAmt      = subtotal * (invoiceForm.tax_rate / 100)
    const total       = subtotal + taxAmt
    return (
    <ModalShell
      title={modalMode === 'view' ? 'รายละเอียดใบแจ้งหนี้' : 'สร้างใบแจ้งหนี้ผู้ขาย'}
      onClose={closeModal}
      footer={
        modalMode !== 'view' ? (
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={handleCreateInvoice} disabled={formLoading || !invoiceForm.purchase_order_id}
              className="px-6 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center gap-2 text-sm">
              {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              สร้างใบแจ้งหนี้
            </button>
          </div>
        ) : <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ปิด</button>
      }
    >
      {/* ── Procurement Chain (Option A: PO as master) ── */}
      {selectedPO && (
        <div className="flex items-center gap-1.5 p-3 bg-cyber-dark rounded-xl overflow-x-auto">
          {linkedPR && (<>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono text-gray-400 bg-gray-500/15 px-2 py-1 rounded-lg">{linkedPR.pr_number}</span>
              <span className="text-gray-600 text-xs">PR</span>
            </div>
            <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
          </>)}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-mono text-cyber-primary bg-cyber-primary/15 px-2 py-1 rounded-lg font-semibold">{selectedPO.po_number}</span>
            <span className="text-gray-600 text-xs">PO ★</span>
          </div>
          {selectedGRs.length > 0 && (<>
            <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {selectedGRs.map(gr => (
                <span key={gr.id} className="text-xs font-mono text-cyber-green bg-cyber-green/15 px-2 py-1 rounded-lg">{gr.gr_number}</span>
              ))}
              <span className="text-gray-600 text-xs">GR</span>
            </div>
          </>)}
          <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
          <span className="text-xs font-mono text-yellow-400 bg-yellow-500/15 px-2 py-1 rounded-lg shrink-0">INV-????</span>
        </div>
      )}

      {/* ── Section 1: PO + GR reference ── */}
      <div className="space-y-3">
        <Field label="ใบสั่งซื้อ (PO)" required>
          <POSearchInput
            orders={orders.filter(o => !['CANCELLED', 'DRAFT'].includes(o.status))}
            value={invoiceForm.purchase_order_id}
            onChange={id => {
              const po = orders.find(o => o.id === id)
              setInvoiceForm(p => ({
                ...p,
                purchase_order_id: id,
                goods_receipt_ids: [],
                tax_rate: po?.tax_rate || 7,
                due_date: po?.expected_date?.split('T')[0] || '',
              }))
            }}
          />
        </Field>

        <Field label="อ้างอิงใบรับสินค้า (GR) — เลือกได้หลายใบ">
          <GRSearchInput
            receipts={poGRs}
            values={invoiceForm.goods_receipt_ids}
            onChange={(ids) => setInvoiceForm(p => ({ ...p, goods_receipt_ids: ids }))}
            disabled={!invoiceForm.purchase_order_id}
          />
        </Field>

        {/* PO + Supplier summary */}
        {selectedPO && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-cyber-primary/5 border border-cyber-primary/20 rounded-xl text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">ผู้ขาย</p>
              <p className="text-white font-medium truncate">{selectedPO.supplier_name}</p>
              {supplierDetail?.tax_id && (
                <p className="text-xs text-gray-400 font-mono mt-0.5">เลขผู้เสียภาษี: {supplierDetail.tax_id}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">มูลค่า PO</p>
              <p className="text-cyber-primary font-semibold">{formatCurrency(selectedPO.total_amount)}</p>
              <p className="text-xs text-cyber-green mt-0.5">GR ยืนยันแล้ว {poGRs.length} ใบ {selectedGRs.length > 0 ? `(เลือก ${selectedGRs.length} ใบ)` : ''}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Invoice details ── */}
      <Field label="เลขที่ใบกำกับภาษีของผู้ขาย *">
        <input type="text" value={invoiceForm.supplier_invoice_number}
          placeholder="เช่น TAX-INV-2026-0001 (เลขที่จากผู้ขาย)"
          onChange={e => setInvoiceForm(p => ({ ...p, supplier_invoice_number: e.target.value }))}
          className={inputCls()} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="วันที่ในใบกำกับ">
          <input type="date" value={invoiceForm.invoice_date}
            onChange={e => setInvoiceForm(p => ({ ...p, invoice_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label="วันครบกำหนดชำระ">
          <input type="date" value={invoiceForm.due_date}
            onChange={e => setInvoiceForm(p => ({ ...p, due_date: e.target.value }))} className={inputCls()} />
        </Field>
      </div>

      {/* ── Section 3: Amount breakdown ── */}
      {selectedPO && (
        <div className="p-4 bg-cyber-dark rounded-xl space-y-2.5 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>ราคาสินค้า (จาก PO)</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-gray-400">VAT (%)</span>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="30" value={invoiceForm.tax_rate}
                onChange={e => setInvoiceForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                className="w-20 px-2 py-1 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white text-right focus:outline-none focus:border-cyber-primary" />
              <span className="text-gray-500 text-xs">= {formatCurrency(taxAmt)}</span>
            </div>
          </div>
          <div className="flex justify-between font-bold text-white border-t border-cyber-border/50 pt-2.5">
            <span>รวมทั้งสิ้น</span>
            <span className="text-xl text-cyber-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <Field label="หมายเหตุ">
        <textarea value={invoiceForm.notes} onChange={e => setInvoiceForm(p => ({ ...p, notes: e.target.value }))}
          rows={2} className={`${inputCls()} resize-none`} placeholder="หมายเหตุเพิ่มเติม..." />
      </Field>

      {/* Journal preview */}
      {selectedPO && (
        <JournalPreview entries={[
          { dr: true,  account: '1107 สต็อกวัตถุดิบ',    label: 'มูลค่าสินค้า', amount: subtotal },
          { dr: true,  account: '1110 ภาษีซื้อ',          label: 'VAT',          amount: taxAmt },
          { dr: false, account: '2101 เจ้าหนี้การค้า',    label: 'ยอดรวม',       amount: total },
        ]} />
      )}
    </ModalShell>
    )
  }

  // ─── 5. Payment Modal ────────────────────────────────────────────────────────
  const PaymentModal = () => {
    const selectedInv = invoices.find(i => i.id === paymentForm.purchase_invoice_id)
    const netPay      = paymentForm.amount - paymentForm.withholding_tax
    return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-cyber-card rounded-2xl border border-cyber-border w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyber-green" /> บันทึกการจ่ายเงิน
          </h2>
          <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4 flex-1">

          {/* Supplier */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-300">ผู้ขาย <span className="text-red-400">*</span></label>
              <button onClick={() => openQuickAddSupplier(id => setPaymentForm(p => ({ ...p, supplier_id: id, purchase_invoice_id: '', amount: 0, withholding_tax: 0 })))}
                className="text-xs text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1 px-2 py-0.5 border border-cyber-primary/30 rounded-lg hover:bg-cyber-primary/10 transition-colors">
                <Plus className="w-3 h-3" /> เพิ่มผู้ขายใหม่
              </button>
            </div>
            <SupplierSearchInput suppliers={suppliers} value={paymentForm.supplier_id}
              onChange={id => setPaymentForm(p => ({ ...p, supplier_id: id, purchase_invoice_id: '', amount: 0, withholding_tax: 0 }))}
              placeholder="ค้นหาผู้ขาย..." />
          </div>

          {/* Invoice selector — filtered by supplier */}
          <Field label="ใบแจ้งหนี้ที่ต้องการชำระ">
            <select value={paymentForm.purchase_invoice_id}
              onChange={e => {
                const id  = e.target.value
                const inv = invoices.find(i => i.id === id)
                setPaymentForm(p => ({ ...p, purchase_invoice_id: id, amount: inv?.balance_amount || 0 }))
              }}
              className={inputCls()}>
              <option value="">-- เลือกใบแจ้งหนี้ --</option>
              {invoices
                .filter(i => i.payment_status !== 'PAID' && (!paymentForm.supplier_id || i.supplier_id === paymentForm.supplier_id))
                .map(i => (
                  <option key={i.id} value={i.id}>{i.pi_number} — ค้าง {formatCurrency(i.balance_amount)}</option>
                ))}
            </select>
          </Field>

          {/* Invoice summary */}
          {selectedInv && (
            <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">ยอดรวม</p>
                <p className="text-white font-medium">{formatCurrency(selectedInv.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">ชำระแล้ว</p>
                <p className="text-cyber-green font-medium">{formatCurrency(selectedInv.paid_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">คงค้าง</p>
                <p className="text-red-400 font-bold">{formatCurrency(selectedInv.balance_amount)}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="วันที่จ่าย">
              <input type="date" value={paymentForm.payment_date}
                onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} className={inputCls()} />
            </Field>
            <Field label="วิธีการจ่าย">
              <select value={paymentForm.payment_method}
                onChange={e => setPaymentForm(p => ({ ...p, payment_method: e.target.value }))} className={inputCls()}>
                <option value="CASH">💵 เงินสด</option>
                <option value="TRANSFER">🏦 โอนธนาคาร</option>
                <option value="CHEQUE">📄 เช็ค</option>
                <option value="CREDIT_CARD">💳 บัตรเครดิต</option>
              </select>
            </Field>
          </div>

          {/* Amount + WHT */}
          <div className="p-4 bg-cyber-dark rounded-xl space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">จำนวนเงินที่จ่าย (บาท)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">฿</span>
                  <input type="number" min="0" step="0.01" value={paymentForm.amount}
                    onChange={e => setPaymentForm(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full pl-7 pr-3 py-2.5 bg-cyber-card border border-cyber-border rounded-xl text-white text-lg font-bold focus:outline-none focus:border-cyber-primary" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <label className="text-xs text-gray-400 mb-1 block">อัตรา WHT</label>
                <select
                  onChange={e => setPaymentForm(p => ({ ...p, withholding_tax: p.amount * (parseFloat(e.target.value) / 100) }))}
                  className="w-full px-2.5 py-2 bg-cyber-card border border-cyber-border rounded-xl text-sm text-white focus:outline-none focus:border-cyber-primary">
                  <option value="0">ไม่หัก WHT</option>
                  <option value="1">1% — บริการทั่วไป</option>
                  <option value="3">3% — ค่าเช่า/บริการ</option>
                  <option value="5">5% — ค่าสิทธิ์</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">หัก ณ ที่จ่าย (คำนวณอัตโนมัติ)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">฿</span>
                  <input type="number" min="0" step="0.01" value={paymentForm.withholding_tax}
                    onChange={e => setPaymentForm(p => ({ ...p, withholding_tax: parseFloat(e.target.value) || 0 }))}
                    className="w-full pl-7 pr-3 py-2.5 bg-cyber-card border border-cyber-border rounded-xl text-white focus:outline-none focus:border-cyber-primary" />
                </div>
              </div>
            </div>
            <div className={`flex justify-between items-center p-3 rounded-xl font-semibold ${netPay > 0 ? 'bg-cyber-green/10 border border-cyber-green/30' : 'bg-cyber-dark'}`}>
              <span className="text-sm text-gray-300">ยอดที่โอน/จ่ายจริง</span>
              <span className="text-xl text-cyber-green">{formatCurrency(netPay)}</span>
            </div>
          </div>

          <Field label="เลขที่อ้างอิง (สลิป / เลขเช็ค)">
            <input type="text" value={paymentForm.payment_reference} placeholder="เช่น 20250316001"
              onChange={e => setPaymentForm(p => ({ ...p, payment_reference: e.target.value }))} className={inputCls()} />
          </Field>

          {/* Journal preview */}
          {paymentForm.amount > 0 && (
            <JournalPreview entries={[
              { dr: true,  account: '2100 เจ้าหนี้การค้า',   label: 'ลดยอดเจ้าหนี้', amount: paymentForm.amount },
              { dr: false, account: '1100 เงินฝากธนาคาร',    label: 'ยอดโอนจริง',    amount: netPay },
              ...(paymentForm.withholding_tax > 0 ? [
                { dr: false as const, account: '2180 ภาษีหัก ณ ที่จ่าย', label: 'WHT ที่นำส่งสรรพากร', amount: paymentForm.withholding_tax }
              ] : [])
            ]} />
          )}
        </div>
        <div className="p-5 border-t border-cyber-border flex justify-end gap-3 shrink-0">
          <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
          <button onClick={handleCreatePayment} disabled={formLoading || !paymentForm.supplier_id || !paymentForm.amount}
            className="px-6 py-2.5 bg-cyber-green text-cyber-dark font-semibold rounded-xl hover:bg-cyber-green/80 disabled:opacity-50 flex items-center gap-2 text-sm">
            {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            <Check className="w-4 h-4" /> ยืนยันจ่ายเงิน
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
      title="สร้างใบคืนสินค้า (PR-Return)"
      onClose={closeModal}
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={closeModal} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
          <button onClick={handleCreateReturn}
            disabled={formLoading || !returnForm.reason || returnForm.items.length === 0}
            className="px-6 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center gap-2 text-sm">
            {formLoading && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            <RotateCcw className="w-4 h-4" /> สร้างใบคืน
          </button>
        </div>
      }
    >
      {/* References */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="ใบสั่งซื้อ (PO)">
          <select value={returnForm.purchase_order_id}
            onChange={e => setReturnForm(p => ({ ...p, purchase_order_id: e.target.value }))} className={inputCls()}>
            <option value="">-- เลือก PO --</option>
            {orders.filter(o => o.status === 'RECEIVED' || o.status === 'PARTIAL').map(o => (
              <option key={o.id} value={o.id}>{o.po_number} — {o.supplier_name}</option>
            ))}
          </select>
        </Field>
        <Field label="ใบรับสินค้า (GR)">
          <select value={returnForm.goods_receipt_id}
            onChange={e => setReturnForm(p => ({ ...p, goods_receipt_id: e.target.value }))} className={inputCls()}>
            <option value="">-- เลือก GR --</option>
            {receipts
              .filter(r => r.status === 'CONFIRMED' && (!returnForm.purchase_order_id || r.purchase_order_id === returnForm.purchase_order_id))
              .map(r => <option key={r.id} value={r.id}>{r.gr_number} ({r.po_number})</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="วันที่คืนสินค้า">
          <input type="date" value={returnForm.return_date}
            onChange={e => setReturnForm(p => ({ ...p, return_date: e.target.value }))} className={inputCls()} />
        </Field>
        <Field label="สาเหตุการคืน" required>
          <select value={returnForm.reason}
            onChange={e => setReturnForm(p => ({ ...p, reason: e.target.value }))} className={inputCls()}>
            <option value="">-- เลือกสาเหตุหลัก --</option>
            <option value="DEFECTIVE">🔴 สินค้าเสียหาย/บกพร่อง</option>
            <option value="WRONG_ITEM">📦 ส่งผิดรายการ</option>
            <option value="WRONG_QUANTITY">🔢 ส่งผิดจำนวน</option>
            <option value="QUALITY_ISSUE">⚠️ คุณภาพไม่ผ่านมาตรฐาน</option>
            <option value="EXPIRED">⏰ สินค้าหมดอายุ</option>
            <option value="OTHER">อื่นๆ</option>
          </select>
        </Field>
      </div>

      {/* Items */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-gray-300">รายการที่คืน</span>
          <button onClick={addReturnItem}
            className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 text-red-400 text-xs rounded-lg hover:bg-red-500/20">
            <Plus className="w-3 h-3" /> เพิ่มรายการ
          </button>
        </div>
        <div className="space-y-3">
          {returnForm.items.map((item, index) => (
            <div key={index} className="p-3 bg-cyber-dark rounded-xl space-y-2 border border-red-500/20">
              <MaterialSearchInput materials={materials} value={item.material_id}
                onChange={(id) => updateReturnItemFields(index, { material_id: id })} />
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  <label className="text-xs text-gray-500 mb-0.5 block">จำนวนคืน</label>
                  <input type="number" min="0" step="0.01" value={item.quantity}
                    onChange={e => updateReturnItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 bg-cyber-card border border-red-500/30 rounded-lg text-sm text-white text-center focus:outline-none focus:border-red-400" />
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-gray-500 mb-0.5 block">ราคา/หน่วย</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">฿</span>
                    <input type="number" min="0" step="0.01" value={item.unit_price}
                      onChange={e => updateReturnItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full pl-5 pr-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white focus:outline-none focus:border-cyber-primary" />
                  </div>
                </div>
                <div className="col-span-3">
                  <label className="text-xs text-gray-500 mb-0.5 block">หมายเหตุ item</label>
                  <input type="text" value={item.reason} placeholder="สาเหตุเพิ่มเติม"
                    onChange={e => updateReturnItem(index, 'reason', e.target.value)}
                    className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary" />
                </div>
                <div className="col-span-2 text-right">
                  <label className="text-xs text-gray-500 mb-0.5 block">รวม</label>
                  <span className="text-sm font-semibold text-red-400">{formatCurrency(item.total_price)}</span>
                </div>
                <div className="col-span-1 flex items-end justify-center pb-0.5">
                  <button onClick={() => removeReturnItem(index)}
                    className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {returnForm.items.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-red-500/30 rounded-xl">
              ยังไม่มีรายการ — กดเพิ่มรายการด้านบน
            </div>
          )}
        </div>
      </div>

      {/* Amount breakdown */}
      {returnForm.items.length > 0 && (
        <div className="p-4 bg-cyber-dark rounded-xl space-y-2 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>ก่อนภาษี</span><span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-gray-400">ภาษี (%)</span>
            <div className="w-24">
              <input type="number" min="0" max="30" value={returnForm.tax_rate}
                onChange={e => setReturnForm(p => ({ ...p, tax_rate: parseFloat(e.target.value) || 0 }))}
                className="w-full px-2 py-1 bg-cyber-card border border-cyber-border rounded-lg text-sm text-white text-right focus:outline-none focus:border-cyber-primary" />
            </div>
          </div>
          <div className="flex justify-between font-bold text-white border-t border-cyber-border pt-2">
            <span>มูลค่าคืนทั้งสิ้น</span>
            <span className="text-lg text-red-400">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <Field label="หมายเหตุ">
        <textarea value={returnForm.notes} onChange={e => setReturnForm(p => ({ ...p, notes: e.target.value }))}
          rows={2} className={`${inputCls()} resize-none`}
          placeholder="รายละเอียดเพิ่มเติมเกี่ยวกับการคืนสินค้า..." />
      </Field>

      {/* Journal preview */}
      {returnForm.items.length > 0 && (
        <JournalPreview entries={[
          { dr: true,  account: '2100 เจ้าหนี้การค้า',  label: 'ลดยอดหนี้',       amount: total },
          { dr: false, account: '1400 สินค้าคงคลัง',    label: 'มูลค่าสินค้าคืน', amount: subtotal },
          { dr: false, account: '1760 ภาษีซื้อ',        label: 'VAT ที่ยกเลิก',   amount: taxAmt },
        ]} />
      )}
    </ModalShell>
    )
  }

  // ─── Main render ──────────────────────────────────────────────────
  const pendingCounts = {
    requests: requests.filter(r => r.status === 'PENDING').length,
    orders: orders.filter(o => o.status === 'CONFIRMED' || o.status === 'PARTIAL').length,
    invoices: invoices.filter(i => i.payment_status === 'UNPAID' || i.payment_status === 'OVERDUE').length,
  }

  const tabs = [
    { id: 'overview',  label: 'ภาพรวม',    icon: TrendingUp, badge: 0 },
    { id: 'requests',  label: 'ใบขอซื้อ',  icon: FileText,   badge: pendingCounts.requests },
    { id: 'orders',    label: 'ใบสั่งซื้อ', icon: ShoppingCart, badge: pendingCounts.orders },
    { id: 'receipts',  label: 'รับสินค้า',  icon: Package,    badge: 0 },
    { id: 'invoices',  label: 'ใบแจ้งหนี้', icon: Receipt,    badge: pendingCounts.invoices },
    { id: 'payments',  label: 'จ่ายเงิน',   icon: CreditCard, badge: 0 },
    { id: 'returns',   label: 'คืนสินค้า',  icon: RotateCcw,  badge: 0 },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <ShoppingCart className="w-8 h-8 text-cyber-primary" /> การจัดซื้อ
          </h1>
          <p className="text-gray-400 mt-1">จัดการใบขอซื้อ ใบสั่งซื้อ รับสินค้า และการจ่ายเงิน</p>
        </div>
        <button onClick={() => openModal('request', 'create')}
          className="flex items-center gap-2 px-5 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 transition-colors">
          <Plus className="w-4 h-4" /> สร้างใบขอซื้อ
        </button>
      </motion.div>

      {/* Tab navigation */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-1.5 bg-cyber-card p-2 rounded-2xl border border-cyber-border">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); setSearchQuery('') }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all relative ${
              activeTab === tab.id ? 'bg-cyber-primary text-cyber-dark shadow-lg' : 'text-gray-400 hover:text-white hover:bg-cyber-dark'
            }`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
            {tab.badge > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                activeTab === tab.id ? 'bg-cyber-dark/30 text-cyber-dark' : 'bg-yellow-500 text-black'
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyber-primary" />
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

      {/* Quick add supplier — sits above other modals (z-[80]) */}
      {showQuickAddSupplier && (
        <QuickAddSupplierModal
          onClose={() => { setShowQuickAddSupplier(false); setQuickAddSupplierCallback(null) }}
          onCreated={handleQuickAddSupplierCreated}
        />
      )}
    </div>
  )
}

export default Purchase
