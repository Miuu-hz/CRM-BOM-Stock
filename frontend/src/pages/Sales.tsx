import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  ShoppingCart,
  Receipt,
  Plus,
  Search,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Package,
  RotateCcw,
  LayoutTemplate,
  ChevronRight,
  ArrowRight,
  ArrowLeftRight,
  X,
  Store,
  ShoppingBag,
  Ban,
  ChevronDown,
  ChevronUp,
  Banknote,
  QrCode,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import posService from '../services/pos.service'
import toast from 'react-hot-toast'

// Types
interface SalesSummary {
  salesOrders: {
    total: number
    draft: number
    processing: number
    partial: number
    completed: number
    totalSales: number
  }
  invoices: {
    total: number
    unpaid: number
    partial: number
    paid: number
    totalInvoiced: number
    outstanding: number
  }
  receipts: {
    todayReceived: number
  }
  creditNotes: {
    total: number
    totalAmount: number
  }
  backorders: {
    pending: number
  }
}

interface Quotation {
  id: string
  quotation_number: string
  customer_name: string
  customer_code: string
  quotation_date: string
  expiry_date: string
  total_amount: number
  status: string
  item_count: number
}

interface SalesOrder {
  id: string
  so_number: string
  customer_name: string
  customer_code: string
  quotation_number?: string
  order_date: string
  delivery_date: string
  total_amount: number
  status: string
  payment_status: string
  item_count: number
  pending_qty?: number
}

interface Invoice {
  id: string
  invoice_number: string
  customer_name: string
  customer_code: string
  so_number: string
  invoice_date: string
  due_date: string
  total_amount: number
  balance_amount: number
  status: string
  payment_status: string
}

interface CreditNote {
  id: string
  cn_number: string
  customer_name: string
  customer_code: string
  invoice_number: string
  credit_date: string
  total_amount: number
  reason: string
  status: string
}

interface Backorder {
  id: string
  bo_number: string
  customer_name: string
  customer_code: string
  so_number: string
  original_do?: string
  status: string
}

interface QuotationTemplate {
  id: string
  name: string
  description: string
  item_count: number
  is_default: number
  expiration_days: number
}

interface POSPendingBill {
  id: string
  bill_number: string
  display_name: string
  total_amount: number
  closed_at: string
  payment_method: string
}

interface POSShift {
  id: string
  shift_number: string
  status: 'OPEN' | 'CLOSED'
  opened_at: string
  closed_at?: string
  opening_cash: number
  closing_cash_counted?: number
  expected_cash?: number
  cash_difference?: number
  total_revenue: number
  cash_revenue: number
  bank_revenue: number
  bill_count: number
  opened_by_name?: string
  closed_by_name?: string
  notes?: string
  live?: {
    bill_count: number
    total_revenue: number
    cash_revenue: number
    bank_revenue: number
  }
}

interface POSDailySales {
  id: string
  summary_number: string
  sales_date: string
  total_revenue: number
  total_tax: number
  total_service_charge: number
  total_discount: number
  estimated_cogs: number
  net_profit: number
  cash_amount: number
  bank_amount: number
  other_amount: number
  bill_count: number
  notes?: string
  closed_by_name?: string
  created_at: string
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT:      { label: 'ฉบับร่าง',        bg: 'bg-gray-500/15',    text: 'text-gray-300' },
  SENT:       { label: 'ส่งแล้ว',          bg: 'bg-blue-500/15',    text: 'text-blue-300' },
  ACCEPTED:   { label: 'อนุมัติ',          bg: 'bg-green-500/15',   text: 'text-green-300' },
  REJECTED:   { label: 'ปฏิเสธ',           bg: 'bg-red-500/15',     text: 'text-red-300' },
  EXPIRED:    { label: 'หมดอายุ',          bg: 'bg-gray-500/15',    text: 'text-gray-400' },
  CANCELLED:  { label: 'ยกเลิก',           bg: 'bg-red-500/15',     text: 'text-red-300' },
  CONFIRMED:  { label: 'ยืนยัน',           bg: 'bg-cyan-500/15',    text: 'text-cyan-300' },
  PROCESSING: { label: 'กำลังดำเนินการ',   bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
  READY:      { label: 'พร้อมส่ง',         bg: 'bg-purple-500/15',  text: 'text-purple-300' },
  DELIVERED:  { label: 'ส่งแล้ว',          bg: 'bg-indigo-500/15',  text: 'text-indigo-300' },
  COMPLETED:  { label: 'เสร็จสิ้น',        bg: 'bg-green-600/15',   text: 'text-green-300' },
  PARTIAL:    { label: 'ส่งบางส่วน',       bg: 'bg-orange-500/15',  text: 'text-orange-300' },
  ISSUED:     { label: 'ออกใบแล้ว',        bg: 'bg-blue-500/15',    text: 'text-blue-300' },
  PAID:       { label: 'ชำระแล้ว',         bg: 'bg-green-500/15',   text: 'text-green-300' },
  UNPAID:     { label: 'ค้างชำระ',         bg: 'bg-red-500/15',     text: 'text-red-300' },
  OVERDUE:    { label: 'เกินกำหนด',        bg: 'bg-red-600/15',     text: 'text-red-400' },
  PENDING:    { label: 'รอดำเนินการ',      bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
}

const StatusBadge = ({ status }: { status: string }) => {
  const cfg = STATUS_CONFIG[status] || { label: status, bg: 'bg-gray-500/15', text: 'text-gray-400' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

const ModalShell = ({ title, icon: Icon, iconColor = 'text-cyber-primary', onClose, children, footer }: {
  title: string; icon: any; iconColor?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode
}) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
      <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} /> {title}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">{footer}</div>
    </motion.div>
  </div>
)

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
    {children}
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────
const Sales = () => {
  useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'quotations' | 'orders' | 'invoices' | 'credit-notes' | 'backorders' | 'templates' | 'pos-daily'>('overview')
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [backorders, setBackorders] = useState<Backorder[]>([])
  const [templates, setTemplates] = useState<QuotationTemplate[]>([])
  const [, setPosDailySales] = useState<POSDailySales[]>([])
  const [posPendingBills, setPosPendingBills] = useState<POSPendingBill[]>([])
  const [posCurrentShift, setPosCurrentShift] = useState<POSShift | null | undefined>(undefined)
  const [posShifts, setPosShifts] = useState<POSShift[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // POS shift modals
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [showCloseShift, setShowCloseShift] = useState(false)
  const [voidingBill, setVoidingBill] = useState<POSPendingBill | null>(null)

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchSummary()
    } else if (activeTab === 'quotations') {
      fetchQuotations()
    } else if (activeTab === 'orders') {
      fetchSalesOrders()
    } else if (activeTab === 'invoices') {
      fetchInvoices()
    } else if (activeTab === 'credit-notes') {
      fetchCreditNotes()
    } else if (activeTab === 'backorders') {
      fetchBackorders()
    } else if (activeTab === 'templates') {
      fetchTemplates()
    } else if (activeTab === 'pos-daily') {
      fetchPOSDailySales()
      fetchPOSShifts()
    }
  }, [activeTab])

  const handleApiError = (error: any, defaultMsg: string) => {
    console.error('API Error:', error)
    if (error.response?.status === 401) {
      toast.error('Session expired. Please login again.')
    } else {
      toast.error(defaultMsg)
    }
  }

  const fetchSummary = async () => {
    try {
      const { data } = await api.get('/sales/summary')
      if (data.success) setSummary(data.data)
    } catch (error) {
      console.error('Fetch summary error:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchQuotations = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/quotations')
      if (data.success) setQuotations(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบเสนอราคาได้')
    } finally { setLoading(false) }
  }

  const fetchSalesOrders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/sales-orders')
      if (data.success) setSalesOrders(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลคำสั่งขายได้')
    } finally { setLoading(false) }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/invoices')
      if (data.success) setInvoices(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบแจ้งหนี้ได้')
    } finally { setLoading(false) }
  }

  const fetchCreditNotes = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/credit-notes')
      if (data.success) setCreditNotes(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบลดหนี้ได้')
    } finally { setLoading(false) }
  }

  const fetchBackorders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/backorders')
      if (data.success) setBackorders(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบค้างส่งได้')
    } finally { setLoading(false) }
  }

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/quotation-templates')
      if (data.success) setTemplates(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลเทมเพลตได้')
    } finally { setLoading(false) }
  }

  const fetchPOSShifts = async () => {
    try {
      const [currentRes, listRes] = await Promise.all([
        api.get('/sales/pos-shifts/current'),
        api.get('/sales/pos-shifts')
      ])
      if (currentRes.data.success) setPosCurrentShift(currentRes.data.data)
      if (listRes.data.success) setPosShifts(listRes.data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลกะได้')
    }
  }

  const fetchPOSDailySales = async () => {
    setLoading(true)
    try {
      const [summaryRes, pendingRes] = await Promise.all([
        api.get('/sales/pos-daily-sales'),
        api.get('/sales/pos-daily-sales/pending-bills')
      ])
      if (summaryRes.data.success) setPosDailySales(summaryRes.data.data)
      if (pendingRes.data.success) setPosPendingBills(pendingRes.data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลยอดขายประจำวันได้')
    } finally { setLoading(false) }
  }

  // Action handlers (stubs — backend not yet implemented)
  const handleCreateQuotation  = () => toast('ฟีเจอร์สร้างใบเสนอราคากำลังพัฒนา...')
  const handleCreateSalesOrder = () => toast('ฟีเจอร์สร้างคำสั่งขายกำลังพัฒนา...')
  const handleCreateInvoice    = () => toast('ฟีเจอร์สร้างใบแจ้งหนี้กำลังพัฒนา...')
  const handleCreateCreditNote = () => toast('ฟีเจอร์สร้างใบลดหนี้กำลังพัฒนา...')
  const handleCreateBackorder  = () => toast('ฟีเจอร์สร้างใบค้างส่งกำลังพัฒนา...')
  const handleCreateTemplate   = () => toast('ฟีเจอร์สร้างเทมเพลตกำลังพัฒนา...')
  const handleViewDetail       = (_item: any, type: string) => toast(`ดูรายละเอียด ${type} — กำลังพัฒนา`)
  const handleEdit             = (_item: any, type: string) => toast(`แก้ไข ${type} — กำลังพัฒนา`)
  const handleRecordPayment    = (invoice: Invoice) => toast(`บันทึกการรับเงิน ${invoice.invoice_number} — กำลังพัฒนา`)
  const handleConvertQtToSO    = (quotation: Quotation) => toast(`แปลงเป็นคำสั่งขาย ${quotation.quotation_number} — กำลังพัฒนา`)

  // Formatters
  const formatCurrency = (amount: number) => `฿${(amount || 0).toLocaleString('th-TH')}`
  const formatDate     = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH')
  }
  const fmt   = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const fmtDT = (s: string) => new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // ── Search filter ──────────────────────────────────────────────────────────
  const filterItems = <T extends Record<string, any>>(items: T[], keys: (keyof T)[]) =>
    items.filter(item => keys.some(k => String(item[k] || '').toLowerCase().includes(searchQuery.toLowerCase())))

  // ── Pending counts for tab badges ──────────────────────────────────────────
  const pendingQuotations = quotations.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length
  const pendingOrders     = salesOrders.filter(o => o.status === 'PROCESSING' || o.status === 'READY').length
  const pendingInvoices   = invoices.filter(i => i.payment_status === 'UNPAID' || i.payment_status === 'OVERDUE').length
  const pendingBackorders = backorders.filter(b => b.status === 'PENDING').length

  // ── Overview ──────────────────────────────────────────────────────────────
  const OverviewContent = () => (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'ยอดขายรวม',   value: formatCurrency(summary?.salesOrders.totalSales || 0), icon: TrendingUp,  color: 'text-cyber-primary', bg: 'bg-cyber-primary/10',  border: 'border-cyber-primary/20' },
          { label: 'คำสั่งขาย',   value: `${summary?.salesOrders.total || 0} รายการ`,          icon: ShoppingCart, color: 'text-cyber-purple',  bg: 'bg-cyber-purple/10',   border: 'border-cyber-purple/20' },
          { label: 'รับเงินวันนี้', value: formatCurrency(summary?.receipts.todayReceived || 0), icon: DollarSign,  color: 'text-cyber-green',   bg: 'bg-cyber-green/10',    border: 'border-cyber-green/20' },
          { label: 'ยอดค้างรับ',   value: formatCurrency(summary?.invoices.outstanding || 0),   icon: AlertCircle, color: 'text-orange-400',    bg: 'bg-orange-500/10',     border: 'border-orange-500/20' },
        ].map((card, i) => (
          <motion.div key={card.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className={`rounded-xl p-5 border ${card.border} ${card.bg}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
              </div>
              <div className={`p-2 rounded-lg ${card.bg} shrink-0`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending actions */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="lg:col-span-1 bg-cyber-card border border-cyber-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-400" /> รายการรอดำเนินการ
          </h3>
          <div className="space-y-2">
            {[
              { label: 'ใบเสนอราคา (ร่าง/ส่งแล้ว)', count: summary?.salesOrders.draft || 0,          color: 'text-yellow-400', tab: 'quotations' as const },
              { label: 'คำสั่งขายกำลังดำเนินการ',     count: summary?.salesOrders.processing || 0,    color: 'text-blue-400',   tab: 'orders' as const },
              { label: 'ใบแจ้งหนี้ค้างชำระ',          count: summary?.invoices.unpaid || 0,           color: 'text-red-400',    tab: 'invoices' as const },
              { label: 'ส่งบางส่วน (Partial)',         count: summary?.salesOrders.partial || 0,       color: 'text-orange-400', tab: 'orders' as const },
              { label: 'รายการค้างส่ง',                count: summary?.backorders.pending || 0,        color: 'text-orange-400', tab: 'backorders' as const },
            ].map(item => (
              <button key={item.label} onClick={() => setActiveTab(item.tab)}
                className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-cyber-dark/60 transition-colors ${item.count > 0 ? 'border border-yellow-500/20 bg-yellow-500/5' : 'bg-cyber-dark/30'}`}>
                <span className="text-sm text-gray-300">{item.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-semibold ${item.count > 0 ? item.color : 'text-gray-500'}`}>{item.count}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Sales workflow pipeline */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="lg:col-span-2 bg-cyber-card border border-cyber-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-cyber-primary" /> กระบวนการขาย
          </h3>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { label: 'ใบเสนอราคา', sub: `${summary?.salesOrders.total || 0} รายการ`, icon: FileText,   color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   tab: 'quotations' as const },
              { label: 'คำสั่งขาย',  sub: `${summary?.salesOrders.total || 0} รายการ`, icon: ShoppingCart, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', tab: 'orders' as const },
              { label: 'ใบแจ้งหนี้', sub: `${summary?.invoices.total || 0} รายการ`,    icon: Receipt,    color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', tab: 'invoices' as const },
              { label: 'รับชำระ',    sub: `${summary?.invoices.paid || 0} ชำระแล้ว`,   icon: DollarSign, color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30',  tab: 'invoices' as const },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-1 flex-1 min-w-[100px]">
                <button onClick={() => setActiveTab(step.tab)}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border ${step.bg} ${step.border} hover:brightness-110 transition-all`}>
                  <step.icon className={`w-5 h-5 ${step.color}`} />
                  <span className="text-xs font-medium text-white">{step.label}</span>
                  <span className="text-xs text-gray-500">{step.sub}</span>
                </button>
                {i < 3 && <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />}
              </div>
            ))}
          </div>

          {/* Invoice payment breakdown */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: 'ค้างชำระ',    value: summary?.invoices.unpaid || 0,   color: 'text-red-400' },
              { label: 'ชำระบางส่วน', value: summary?.invoices.partial || 0,  color: 'text-yellow-400' },
              { label: 'ชำระครบแล้ว', value: summary?.invoices.paid || 0,     color: 'text-green-400' },
            ].map(item => (
              <div key={item.label} className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )

  // ── Search bar ─────────────────────────────────────────────────────────────
  const SearchBar = ({ placeholder }: { placeholder: string }) => (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input type="text" placeholder={placeholder} value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64 text-sm" />
    </div>
  )

  // ── Quotations ─────────────────────────────────────────────────────────────
  const QuotationsContent = () => {
    const items = filterItems(quotations, ['quotation_number', 'customer_name'])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <SearchBar placeholder="ค้นหาใบเสนอราคา..." />
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('templates')}
              className="flex items-center gap-2 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary text-sm transition-colors">
              <LayoutTemplate className="w-4 h-4" /> เทมเพลต
            </button>
            <button onClick={handleCreateQuotation}
              className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm transition-colors">
              <Plus className="w-4 h-4" /> สร้างใบเสนอราคา
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบเสนอราคา</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((q, i) => (
              <motion.div key={q.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-cyber-primary/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-cyber-primary">{q.quotation_number}</p>
                    <p className="text-white font-medium mt-0.5">{q.customer_name}</p>
                    <p className="text-xs text-gray-500">{q.customer_code}</p>
                  </div>
                  <StatusBadge status={q.status} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                  <span>วันที่: <span className="text-gray-300">{formatDate(q.quotation_date)}</span></span>
                  <span>หมดอายุ: <span className={`font-medium ${new Date(q.expiry_date) < new Date() ? 'text-red-400' : 'text-gray-300'}`}>{formatDate(q.expiry_date)}</span></span>
                  <span>{q.item_count} รายการสินค้า</span>
                  <span className="text-right font-semibold text-white">{formatCurrency(q.total_amount)}</span>
                </div>
                <div className="flex gap-2 pt-3 border-t border-cyber-border/50">
                  <button onClick={() => handleViewDetail(q, 'ใบเสนอราคา')}
                    className="flex-1 py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                    ดูรายละเอียด
                  </button>
                  {(q.status === 'ACCEPTED') && (
                    <button onClick={() => handleConvertQtToSO(q)}
                      className="flex-1 py-1.5 text-xs font-medium text-cyber-primary bg-cyber-primary/10 rounded-lg hover:bg-cyber-primary/20 transition-colors flex items-center justify-center gap-1">
                      <ArrowRight className="w-3 h-3" /> แปลงเป็น SO
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Sales Orders ───────────────────────────────────────────────────────────
  const OrdersContent = () => {
    const items = filterItems(salesOrders, ['so_number', 'customer_name'])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <SearchBar placeholder="ค้นหาคำสั่งขาย..." />
          <button onClick={handleCreateSalesOrder}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm transition-colors">
            <Plus className="w-4 h-4" /> สร้างคำสั่งขาย
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบคำสั่งขาย</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((order, i) => (
              <motion.div key={order.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-cyber-primary/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-cyber-primary">{order.so_number}</p>
                    {order.quotation_number && (
                      <p className="text-xs text-gray-500">QT: {order.quotation_number}</p>
                    )}
                    <p className="text-white font-medium mt-0.5">{order.customer_name}</p>
                    <p className="text-xs text-gray-500">{order.customer_code}</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <StatusBadge status={order.status} />
                    <StatusBadge status={order.payment_status} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                  <span>สั่งซื้อ: <span className="text-gray-300">{formatDate(order.order_date)}</span></span>
                  <span>กำหนดส่ง: <span className="text-gray-300">{formatDate(order.delivery_date)}</span></span>
                  <span>{order.item_count} รายการสินค้า</span>
                  <span className="text-right font-semibold text-white">{formatCurrency(order.total_amount)}</span>
                </div>
                {(order.pending_qty ?? 0) > 0 && (
                  <div className="mb-3 flex items-center gap-1.5 text-xs text-orange-400 bg-orange-500/10 rounded-lg px-2.5 py-1.5">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    ค้างส่ง {order.pending_qty} ชิ้น
                  </div>
                )}
                <div className="flex gap-2 pt-3 border-t border-cyber-border/50">
                  <button onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                    className="flex-1 py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                    ดูรายละเอียด
                  </button>
                  <button onClick={() => handleEdit(order, 'คำสั่งขาย')}
                    className="flex-1 py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                    แก้ไข
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  const InvoicesContent = () => {
    const items = filterItems(invoices, ['invoice_number', 'customer_name'])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <SearchBar placeholder="ค้นหาใบแจ้งหนี้..." />
          <button onClick={handleCreateInvoice}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm transition-colors">
            <Plus className="w-4 h-4" /> สร้างใบแจ้งหนี้
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบแจ้งหนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((inv, i) => {
              const isOverdue = inv.payment_status === 'OVERDUE'
              const isUnpaid  = inv.payment_status === 'UNPAID' || isOverdue
              return (
                <motion.div key={inv.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className={`bg-cyber-card border rounded-xl p-4 hover:brightness-105 transition-all ${isOverdue ? 'border-red-500/40' : 'border-cyber-border hover:border-cyber-primary/50'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-cyber-primary">{inv.invoice_number}</p>
                      <p className="text-xs text-gray-500">SO: {inv.so_number}</p>
                      <p className="text-white font-medium mt-0.5">{inv.customer_name}</p>
                      <p className="text-xs text-gray-500">{inv.customer_code}</p>
                    </div>
                    <StatusBadge status={inv.payment_status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                    <span>วันที่: <span className="text-gray-300">{formatDate(inv.invoice_date)}</span></span>
                    <span>ครบกำหนด: <span className={isOverdue ? 'text-red-400 font-medium' : 'text-gray-300'}>{formatDate(inv.due_date)}</span></span>
                    <span>ยอดรวม: <span className="text-white font-medium">{formatCurrency(inv.total_amount)}</span></span>
                    <span className="text-right">
                      คงค้าง: <span className={inv.balance_amount > 0 ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'}>
                        {formatCurrency(inv.balance_amount)}
                      </span>
                    </span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-cyber-border/50">
                    <button onClick={() => handleViewDetail(inv, 'ใบแจ้งหนี้')}
                      className="flex-1 py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                      ดูรายละเอียด
                    </button>
                    {isUnpaid && (
                      <button onClick={() => handleRecordPayment(inv)}
                        className="flex-1 py-1.5 text-xs font-medium text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 transition-colors flex items-center justify-center gap-1">
                        <DollarSign className="w-3 h-3" /> รับเงิน
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Credit Notes ───────────────────────────────────────────────────────────
  const CreditNotesContent = () => {
    const items = filterItems(creditNotes, ['cn_number', 'customer_name'])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <SearchBar placeholder="ค้นหาใบลดหนี้..." />
          <button onClick={handleCreateCreditNote}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/80 text-white font-semibold rounded-lg hover:bg-red-500 text-sm transition-colors">
            <Plus className="w-4 h-4" /> สร้างใบลดหนี้
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบลดหนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((cn, i) => (
              <motion.div key={cn.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-red-500/40 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-red-400">{cn.cn_number}</p>
                    <p className="text-xs text-gray-500">INV: {cn.invoice_number}</p>
                    <p className="text-white font-medium mt-0.5">{cn.customer_name}</p>
                    <p className="text-xs text-gray-500">{cn.customer_code}</p>
                  </div>
                  <StatusBadge status={cn.status} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                  <span>วันที่: <span className="text-gray-300">{formatDate(cn.credit_date)}</span></span>
                  <span className="text-right font-semibold text-red-400">-{formatCurrency(cn.total_amount)}</span>
                  <span className="col-span-2 text-gray-400">เหตุผล: {cn.reason}</span>
                </div>
                <div className="pt-3 border-t border-cyber-border/50">
                  <button onClick={() => handleViewDetail(cn, 'ใบลดหนี้')}
                    className="w-full py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                    ดูรายละเอียด
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Backorders ─────────────────────────────────────────────────────────────
  const BackordersContent = () => {
    const items = filterItems(backorders, ['bo_number', 'customer_name'])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <SearchBar placeholder="ค้นหาใบค้างส่ง..." />
          <button onClick={handleCreateBackorder}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500/80 text-white font-semibold rounded-lg hover:bg-orange-500 text-sm transition-colors">
            <Plus className="w-4 h-4" /> สร้างใบค้างส่ง
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบค้างส่ง</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((bo, i) => (
              <motion.div key={bo.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-orange-500/40 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-orange-400">{bo.bo_number}</p>
                    <p className="text-xs text-gray-500">SO: {bo.so_number}</p>
                    <p className="text-white font-medium mt-0.5">{bo.customer_name}</p>
                    <p className="text-xs text-gray-500">{bo.customer_code}</p>
                  </div>
                  <StatusBadge status={bo.status} />
                </div>
                {bo.original_do && (
                  <p className="text-xs text-gray-400 mb-3">ใบส่งของต้นฉบับ: <span className="text-gray-300">{bo.original_do}</span></p>
                )}
                <div className="pt-3 border-t border-cyber-border/50">
                  <button onClick={() => handleViewDetail(bo, 'ใบค้างส่ง')}
                    className="w-full py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                    ดูรายละเอียด
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  const TemplatesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-white">เทมเพลตใบเสนอราคา</h2>
        <button onClick={handleCreateTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm transition-colors">
          <Plus className="w-4 h-4" /> สร้างเทมเพลต
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template, i) => (
          <motion.div key={template.id}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-cyber-card rounded-xl border border-cyber-border p-5 hover:border-cyber-primary/50 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-cyber-primary/20 rounded-lg">
                <LayoutTemplate className="w-5 h-5 text-cyber-primary" />
              </div>
              {template.is_default === 1 && (
                <span className="px-2 py-0.5 bg-cyber-green/20 text-cyber-green text-xs rounded-full">ค่าเริ่มต้น</span>
              )}
            </div>
            <h3 className="text-base font-semibold text-white mb-1">{template.name}</h3>
            <p className="text-sm text-gray-400 mb-3">{template.description || 'ไม่มีคำอธิบาย'}</p>
            <div className="flex justify-between text-xs text-gray-500 mb-4">
              <span>{template.item_count} รายการ</span>
              <span>หมดอายุ {template.expiration_days} วัน</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(template, 'เทมเพลต')}
                className="flex-1 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary text-sm transition-colors">
                แก้ไข
              </button>
              <button onClick={() => toast('ใช้เทมเพลต: ' + template.name)}
                className="flex-1 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm transition-colors">
                ใช้เทมเพลต
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs = [
    { id: 'overview',     label: 'ภาพรวม',       icon: TrendingUp,    badge: 0 },
    { id: 'quotations',   label: 'ใบเสนอราคา',   icon: FileText,      badge: pendingQuotations },
    { id: 'orders',       label: 'คำสั่งขาย',    icon: ShoppingCart,  badge: pendingOrders },
    { id: 'invoices',     label: 'ใบแจ้งหนี้',   icon: Receipt,       badge: pendingInvoices },
    { id: 'credit-notes', label: 'ใบลดหนี้',     icon: RotateCcw,     badge: 0 },
    { id: 'backorders',   label: 'ค้างส่ง',       icon: Package,       badge: pendingBackorders },
    { id: 'templates',    label: 'เทมเพลต',       icon: LayoutTemplate,badge: 0 },
    { id: 'pos-daily',    label: 'POS กะขาย',    icon: Store,         badge: 0 },
  ]

  // ── POS components (fully functional — keep intact) ────────────────────────
  const PendingBillsPanel = ({ bills, onVoid }: { bills: POSPendingBill[]; onVoid: (b: POSPendingBill) => void }) => {
    const [expanded, setExpanded] = useState(false)
    return (
      <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
        <button onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-cyber-dark/30">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-cyber-primary" />
            <span className="text-sm font-medium text-white">บิลในกะนี้</span>
            <span className="text-xs text-gray-500">{bills.length} บิล</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-cyber-primary">
              {fmt(bills.reduce((s, b) => s + b.total_amount, 0))}
            </span>
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </div>
        </button>
        {expanded && (
          <div className="divide-y divide-cyber-border/50">
            {bills.map(bill => (
              <div key={bill.id} className="px-5 py-3 flex items-center justify-between bg-cyber-dark/20">
                <div>
                  <div className="flex items-center gap-2">
                    {bill.payment_method === 'CASH'
                      ? <Banknote className="w-3 h-3 text-yellow-400" />
                      : <QrCode className="w-3 h-3 text-blue-400" />}
                    <span className="text-sm text-white">{bill.bill_number}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {bill.display_name} · {fmtDT(bill.closed_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">{fmt(bill.total_amount)}</span>
                  <button onClick={() => onVoid(bill)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10">
                    <Ban className="w-3 h-3" /> ยกเลิก
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const OpenShiftModal = ({ onClose }: { onClose: () => void }) => {
    const [openingCash, setOpeningCash] = useState('0')
    const [saving, setSaving] = useState(false)
    const handleOpen = async () => {
      setSaving(true)
      try {
        const { data } = await api.post('/sales/pos-shifts/open', { opening_cash: parseFloat(openingCash) || 0 })
        if (data.success) {
          toast.success(`เปิดกะสำเร็จ: ${data.data.shift_number}`)
          fetchPOSShifts()
          onClose()
        }
      } catch (e: any) { toast.error(e.response?.data?.message || 'ไม่สามารถเปิดกะได้') }
      finally { setSaving(false) }
    }
    return (
      <ModalShell title="เปิดกะ" icon={ShoppingBag} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={handleOpen} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              เริ่มกะ
            </button>
          </>
        }>
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-400">นับเงินในลิ้นชักก่อนเริ่มขาย แล้วกรอกยอดด้านล่าง</p>
        </div>
        <Field label="เงินสดในลิ้นชัก (ยอดเริ่มต้น)">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
            <input type="number" value={openingCash}
              onChange={e => setOpeningCash(e.target.value)}
              onFocus={e => e.target.select()}
              className="w-full pl-8 pr-3 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white text-xl font-bold focus:outline-none focus:border-cyber-primary" />
          </div>
        </Field>
      </ModalShell>
    )
  }

  const CloseShiftModal = ({ shift, onClose }: { shift: POSShift; onClose: () => void }) => {
    const live = shift.live
    const cashRevenue = live?.cash_revenue || 0
    const expectedCash = (shift.opening_cash || 0) + cashRevenue
    const [closingCash, setClosingCash] = useState(expectedCash.toFixed(2))
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)
    const diff = (parseFloat(closingCash) || 0) - expectedCash
    const handleClose = async () => {
      setSaving(true)
      try {
        const { data } = await api.post(`/sales/pos-shifts/${shift.id}/close`, {
          closing_cash_counted: parseFloat(closingCash) || 0, notes
        })
        if (data.success) {
          toast.success('ปิดกะสำเร็จ')
          fetchPOSShifts()
          onClose()
        }
      } catch (e: any) { toast.error(e.response?.data?.message || 'ไม่สามารถปิดกะได้') }
      finally { setSaving(false) }
    }
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
          <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <X className="w-5 h-5 text-red-400" /> ปิดกะ — {shift.shift_number}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">ยอดรวม</p>
                <p className="text-base font-bold text-cyber-primary">{fmt(live?.total_revenue || 0)}</p>
              </div>
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">เงินสด</p>
                <p className="text-base font-bold text-yellow-400">{fmt(cashRevenue)}</p>
              </div>
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">QR/โอน</p>
                <p className="text-base font-bold text-blue-400">{fmt(live?.bank_revenue || 0)}</p>
              </div>
            </div>
            <div className="p-4 bg-cyber-dark rounded-lg space-y-1 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>เงินสดเปิดกะ</span><span>{fmt(shift.opening_cash)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>+ ขายเงินสด</span><span>{fmt(cashRevenue)}</span>
              </div>
              <div className="flex justify-between font-semibold text-white border-t border-cyber-border pt-2 mt-2">
                <span>ยอดที่ควรมีในลิ้นชัก</span><span>{fmt(expectedCash)}</span>
              </div>
            </div>
            <Field label="นับเงินสดจริงในลิ้นชัก">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                <input type="number" value={closingCash}
                  onChange={e => setClosingCash(e.target.value)}
                  onFocus={e => e.target.select()}
                  className="w-full pl-8 pr-3 py-3 bg-cyber-dark border border-cyber-border rounded-lg text-white text-xl font-bold focus:outline-none focus:border-cyber-primary" />
              </div>
            </Field>
            <div className={`flex justify-between items-center p-3 rounded-lg text-sm font-medium ${
              Math.abs(diff) < 0.01 ? 'bg-cyber-green/10 border border-cyber-green/30 text-cyber-green'
              : diff > 0 ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <span>ผลต่าง</span>
              <span>{diff >= 0 ? '+' : ''}{fmt(diff)} {Math.abs(diff) < 0.01 ? '✓ ตรง' : diff > 0 ? '(เกิน)' : '(ขาด)'}</span>
            </div>
            <Field label="หมายเหตุ (optional)">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-cyber-primary resize-none"
                placeholder="เช่น สาเหตุที่เงินขาด/เกิน..." />
            </Field>
          </div>
          <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
            <button onClick={handleClose} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500/80 text-white font-semibold rounded-lg hover:bg-red-500 disabled:opacity-50">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              ยืนยันปิดกะ
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  const VoidBillModal = ({ bill, onClose }: { bill: POSPendingBill; onClose: () => void }) => {
    const [reason, setReason] = useState('')
    const [saving, setSaving] = useState(false)
    const handleVoid = async () => {
      if (!reason.trim()) { toast.error('กรุณาระบุสาเหตุการยกเลิก'); return }
      try {
        setSaving(true)
        const res = await posService.voidBill(bill.id, reason)
        if (res.success) {
          toast.success(`ยกเลิกบิล ${bill.bill_number} สำเร็จ`)
          fetchPOSDailySales()
          fetchPOSShifts()
          onClose()
        }
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'ยกเลิกบิลไม่สำเร็จ')
      } finally { setSaving(false) }
    }
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-cyber-card border border-red-500/40 rounded-2xl w-full max-w-sm">
          <div className="p-5 border-b border-cyber-border flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-400" /> ยกเลิกบิล
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <p className="text-sm font-medium text-white">{bill.bill_number}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {bill.display_name} · {fmt(bill.total_amount)} · {bill.payment_method === 'CASH' ? 'เงินสด' : 'QR/โอน'}
              </p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-400">
              ระบบจะบันทึก: Dr. รายได้ขาย 4100 / Cr. POS-Clearing 1180 เพื่อล้างยอดอัตโนมัติ
            </div>
            <Field label="สาเหตุการยกเลิก *">
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white text-sm focus:outline-none focus:border-red-400 resize-none"
                placeholder="เช่น ลูกค้าแจ้งยกเลิก, เก็บเงินผิด, ออเดอร์ผิด..." />
            </Field>
          </div>
          <div className="p-5 border-t border-cyber-border flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ปิด</button>
            <button onClick={handleVoid} disabled={saving || !reason.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500/80 hover:bg-red-500 text-white font-semibold rounded-lg disabled:opacity-50">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="w-4 h-4" />}
              ยืนยันยกเลิกบิล
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  const POSDailyContent = () => (
    <div className="space-y-5 max-w-2xl">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-white">กะการขาย</h2>
          <p className="text-gray-400 text-sm">เปิด/ปิดกะ ติดตามยอดขายและเงินสดในลิ้นชัก</p>
        </div>
        <button onClick={fetchPOSShifts} className="p-2 rounded-lg bg-cyber-dark text-gray-400 hover:text-white">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {posCurrentShift === undefined ? (
        <div className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-cyber-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : posCurrentShift === null ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-cyber-card border border-cyber-border rounded-xl p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8 text-gray-500" />
          </div>
          <div>
            <p className="text-white font-medium">ยังไม่มีกะที่เปิดอยู่</p>
            <p className="text-gray-500 text-sm mt-1">กรอกเงินสดในลิ้นชักแล้วกดเปิดกะ เพื่อเริ่มรับออเดอร์</p>
          </div>
          <button onClick={() => setShowOpenShift(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-cyber-primary text-cyber-dark font-semibold rounded-xl hover:bg-cyber-primary/80 text-lg">
            <ShoppingBag className="w-5 h-5" /> เปิดกะ
          </button>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-cyber-card border border-cyber-green/40 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-cyber-green/10 border-b border-cyber-green/30 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
            <span className="text-cyber-green font-medium text-sm">กะกำลังเปิดอยู่</span>
            <span className="ml-auto text-gray-400 text-xs">{posCurrentShift.shift_number} · เปิดตั้งแต่ {fmtDT(posCurrentShift.opened_at)}</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">ยอดขายรวม</p>
                <p className="text-xl font-bold text-cyber-primary">{fmt(posCurrentShift.live?.total_revenue || 0)}</p>
                <p className="text-xs text-gray-500">{posCurrentShift.live?.bill_count || 0} บิล</p>
              </div>
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">เงินสด</p>
                <p className="text-xl font-bold text-yellow-400">{fmt(posCurrentShift.live?.cash_revenue || 0)}</p>
              </div>
              <div className="bg-cyber-dark rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">QR/โอน</p>
                <p className="text-xl font-bold text-blue-400">{fmt(posCurrentShift.live?.bank_revenue || 0)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-400 bg-cyber-dark rounded-lg px-4 py-2.5">
              <span>เงินสดเปิดกะ</span>
              <span className="text-white font-medium">{fmt(posCurrentShift.opening_cash)}</span>
            </div>
            <button onClick={() => setShowCloseShift(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-red-500/50 text-red-400 font-semibold rounded-xl hover:bg-red-500/10 transition-colors">
              <X className="w-4 h-4" /> ปิดกะ
            </button>
          </div>
        </motion.div>
      )}

      {posShifts.filter(s => s.status === 'CLOSED').length > 0 && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-cyber-border">
            <h3 className="text-sm font-medium text-gray-400">ประวัติกะ</h3>
          </div>
          <div className="divide-y divide-cyber-border">
            {posShifts.filter(s => s.status === 'CLOSED').slice(0, 10).map(s => (
              <div key={s.id} className="px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-white">{s.shift_number}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtDT(s.opened_at)} → {s.closed_at ? fmtDT(s.closed_at) : '-'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-cyber-primary">{fmt(s.total_revenue)}</p>
                    <p className="text-xs text-gray-500">{s.bill_count} บิล</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: 'เปิดกะ',  value: fmt(s.opening_cash) },
                    { label: 'นับได้',  value: fmt(s.closing_cash_counted || 0) },
                    { label: 'ผลต่าง', value: fmt(s.cash_difference || 0), color: (s.cash_difference || 0) >= 0 ? 'text-cyber-green' : 'text-red-400' },
                  ].map(item => (
                    <div key={item.label} className="text-xs text-center">
                      <p className="text-gray-500">{item.label}</p>
                      <p className={item.color || 'text-white'}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {posPendingBills.length > 0 && (
        <PendingBillsPanel bills={posPendingBills} onVoid={b => setVoidingBill(b)} />
      )}

      {showOpenShift && <OpenShiftModal onClose={() => setShowOpenShift(false)} />}
      {showCloseShift && posCurrentShift && (
        <CloseShiftModal shift={posCurrentShift} onClose={() => setShowCloseShift(false)} />
      )}
      {voidingBill && <VoidBillModal bill={voidingBill} onClose={() => setVoidingBill(null)} />}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-cyber-primary" />
            การขาย
          </h1>
          <p className="text-gray-400 mt-1 text-sm">จัดการใบเสนอราคา คำสั่งขาย ใบแจ้งหนี้ และการรับชำระเงิน</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-1.5 bg-cyber-card p-1.5 rounded-xl border border-cyber-border">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setSearchQuery(''); setActiveTab(tab.id as any) }}
            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-lg font-medium text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-cyber-primary text-cyber-dark'
                : 'text-gray-400 hover:text-white hover:bg-cyber-dark'
            }`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
            {tab.badge > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                activeTab === tab.id ? 'bg-cyber-dark text-cyber-primary' : 'bg-yellow-500/20 text-yellow-400'
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
        <motion.div key={activeTab}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          {activeTab === 'overview'     && <OverviewContent />}
          {activeTab === 'quotations'   && <QuotationsContent />}
          {activeTab === 'orders'       && <OrdersContent />}
          {activeTab === 'invoices'     && <InvoicesContent />}
          {activeTab === 'credit-notes' && <CreditNotesContent />}
          {activeTab === 'backorders'   && <BackordersContent />}
          {activeTab === 'templates'    && <TemplatesContent />}
          {activeTab === 'pos-daily'    && <POSDailyContent />}
        </motion.div>
      )}
    </div>
  )
}

export default Sales
