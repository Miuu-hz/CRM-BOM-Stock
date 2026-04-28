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
  LayoutList,
  LayoutGrid,
  ChevronRight,
  ArrowRight,
  X,
  Store,
  ShoppingBag,
  Ban,
  ChevronDown,
  ChevronUp,
  Banknote,
  QrCode,
  Printer,
  Upload,
  ImageIcon,
  Trash2,
  Eye,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import posService from '../services/pos.service'
import salesService, { type Customer, type Product } from '../services/sales.service'
import { printSalesDoc } from '../utils/salesPrint'
import { getCachedCompanySettings } from '../services/companySettings.service'
import toast from 'react-hot-toast'
import { useModalClose } from '../hooks/useModalClose'
import { useUnits } from '../hooks/useUnits'

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

function ModalShell({ title, icon: Icon, iconColor = 'text-cyber-primary', onClose, children, footer }: {
  title: string; icon: any; iconColor?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode
}) {
  useModalClose(onClose)
  return (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      onClick={e => e.stopPropagation()}
      className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
      <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} /> {title}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto modal-scroll p-5 space-y-4">{children}</div>
      <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">{footer}</div>
    </motion.div>
  </div>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
    {children}
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────
const Sales = () => {
  const { tenant } = useAuth()
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

  // Sales modals
  const [showCreateQT, setShowCreateQT]     = useState(false)
  const [showCreateSO, setShowCreateSO]     = useState(false)
  const [showCreateCN, setShowCreateCN]     = useState(false)
  const [detailQT, setDetailQT]             = useState<Quotation | null>(null)
  const [detailSO, setDetailSO]             = useState<SalesOrder | null>(null)
  const [detailInv, setDetailInv]           = useState<Invoice | null>(null)
  const [detailCN, setDetailCN]             = useState<CreditNote | null>(null)
  const [detailBO, setDetailBO]             = useState<Backorder | null>(null)
  const [convertQT, setConvertQT]           = useState<Quotation | null>(null)  // QT → SO

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

  // Action handlers
  const handleCreateQuotation  = () => setShowCreateQT(true)
  const handleCreateSalesOrder = () => setShowCreateSO(true)
  const handleCreateInvoice    = () => toast('สร้างใบแจ้งหนี้: เลือก SO ก่อนจากหน้าคำสั่งขาย')
  const handleCreateCreditNote = () => setShowCreateCN(true)
  const handleCreateBackorder  = () => toast('ใบค้างส่งสร้างอัตโนมัติจากการส่งของบางส่วน')
  const handleCreateTemplate   = () => toast('ฟีเจอร์สร้างเทมเพลตกำลังพัฒนา...')
  const handleViewDetail = (item: any, type: string) => {
    if (type === 'ใบเสนอราคา') setDetailQT(item)
    else if (type === 'คำสั่งขาย') setDetailSO(item)
    else if (type === 'ใบแจ้งหนี้') setDetailInv(item)
    else if (type === 'ใบลดหนี้') setDetailCN(item)
    else if (type === 'ใบค้างส่ง') setDetailBO(item)
    else toast(`ดูรายละเอียด ${type} — กำลังพัฒนา`)
  }
  const handleEdit = (_item: any, type: string) => toast(`แก้ไข ${type} — กำลังพัฒนา`)
  const handleRecordPayment    = (invoice: Invoice) => setDetailInv(invoice)
  const handleConvertQtToSO    = (quotation: Quotation) => setConvertQT(quotation)

  // Formatters
  const formatCurrency = (amount: number) => `฿${(amount || 0).toLocaleString('th-TH')}`
  const formatDate     = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH')
  }
  const fmt   = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const fmtDT = (s: string) => new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // ── Search filter ──────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [listLimit, setListLimit] = useState<25 | 50 | 100>(50)
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')

  const filterItems = <T extends Record<string, any>>(items: T[], keys: (keyof T)[], dateKey?: keyof T) => {
    let result = items.filter(item => !searchQuery || keys.some(k => String(item[k] || '').toLowerCase().includes(searchQuery.toLowerCase())))
    if (dateKey) {
      if (dateFrom) result = result.filter(it => String(it[dateKey] || '').slice(0, 10) >= dateFrom)
      if (dateTo)   result = result.filter(it => String(it[dateKey] || '').slice(0, 10) <= dateTo)
    }
    return result.slice(0, listLimit)
  }

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

  // ── Toolbar (search + date range + limit) ──────────────────────────────────
  const ListToolbar = ({ placeholder, action }: { placeholder: string; action?: React.ReactNode }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder={placeholder} value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-52 text-sm" />
          </div>
          {/* Date range */}
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-cyber-dark border border-cyber-border rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            <span className="text-gray-500 text-xs">ถึง</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-cyber-dark border border-cyber-border rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-gray-500 hover:text-red-400 text-xs px-1.5 py-1 rounded">ล้าง</button>
            )}
          </div>
          {/* Limit */}
          <div className="flex items-center gap-1 bg-cyber-dark border border-cyber-border rounded-lg px-1 py-1">
            {([25, 50, 100] as const).map(n => (
              <button key={n} onClick={() => setListLimit(n)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${listLimit === n ? 'bg-cyber-primary text-cyber-dark' : 'text-gray-400 hover:text-white'}`}>
                {n}
              </button>
            ))}
          </div>
          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-cyber-dark border border-cyber-border rounded-lg p-1">
            <button onClick={() => setViewMode('list')} title="มุมมองรายการ"
              className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-cyber-primary text-cyber-dark' : 'text-gray-400 hover:text-white'}`}>
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('card')} title="มุมมองการ์ด"
              className={`p-1 rounded transition-colors ${viewMode === 'card' ? 'bg-cyber-primary text-cyber-dark' : 'text-gray-400 hover:text-white'}`}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {action && <div className="flex gap-2 shrink-0">{action}</div>}
      </div>
    </div>
  )

  // ── Quotations ─────────────────────────────────────────────────────────────
  const QuotationsContent = () => {
    const items = filterItems(quotations, ['quotation_number', 'customer_name'], 'quotation_date')
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบเสนอราคา..." action={
          <>
            <button onClick={() => setActiveTab('templates')}
              className="flex items-center gap-1.5 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary text-sm">
              <LayoutTemplate className="w-4 h-4" /> เทมเพลต
            </button>
            <button onClick={handleCreateQuotation}
              className="flex items-center gap-1.5 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm">
              <Plus className="w-4 h-4" /> สร้างใบเสนอราคา
            </button>
          </>
        } />

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500"><FileText className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>ไม่พบใบเสนอราคา</p></div>
        ) : viewMode === 'list' ? (
          <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-border bg-cyber-darker text-xs text-gray-400">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">วันที่</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">หมดอายุ</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">ยอดรวม</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border/50">
                {items.map(q => (
                  <tr key={q.id} className="hover:bg-cyber-dark/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-cyber-primary">{q.quotation_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{q.customer_name}</p>
                      <p className="text-xs text-gray-500">{q.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">{formatDate(q.quotation_date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-medium ${q.expiry_date && new Date(q.expiry_date) < new Date() ? 'text-red-400' : 'text-gray-400'}`}>
                        {formatDate(q.expiry_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{formatCurrency(q.total_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => handleViewDetail(q, 'ใบเสนอราคา')}
                          className="px-2.5 py-1 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white">ดู</button>
                        {q.status === 'ACCEPTED' && (
                          <button onClick={() => handleConvertQtToSO(q)}
                            className="px-2.5 py-1 text-xs text-cyber-primary bg-cyber-primary/10 rounded-lg hover:bg-cyber-primary/20 flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" /> SO
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cyber-border/50 text-xs text-gray-500">
              แสดง {items.length} รายการ
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((q, i) => {
              const isExpired = q.expiry_date && new Date(q.expiry_date) < new Date()
              return (
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
                    <span>หมดอายุ: <span className={isExpired ? 'text-red-400 font-medium' : 'text-gray-300'}>{formatDate(q.expiry_date)}</span></span>
                    <span>{q.item_count} รายการ</span>
                    <span className="text-right font-semibold text-white">{formatCurrency(q.total_amount)}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-cyber-border/50">
                    <button onClick={() => handleViewDetail(q, 'ใบเสนอราคา')}
                      className="flex-1 py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                      ดูรายละเอียด
                    </button>
                    {q.status === 'ACCEPTED' && (
                      <button onClick={() => handleConvertQtToSO(q)}
                        className="flex-1 py-1.5 text-xs font-medium text-cyber-primary bg-cyber-primary/10 rounded-lg hover:bg-cyber-primary/20 flex items-center justify-center gap-1">
                        <ArrowRight className="w-3 h-3" /> แปลง SO
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

  // ── Sales Orders ───────────────────────────────────────────────────────────
  const SO_DELIVERY_STEPS = [
    { status: 'DRAFT',      label: 'ฉบับร่าง',        color: 'text-gray-400' },
    { status: 'CONFIRMED',  label: 'ยืนยันแล้ว',       color: 'text-blue-400' },
    { status: 'PROCESSING', label: 'กำลังเตรียม',      color: 'text-yellow-400' },
    { status: 'READY',      label: 'พร้อมส่ง',          color: 'text-purple-400' },
    { status: 'DELIVERED',  label: 'ส่งแล้ว',           color: 'text-cyber-green' },
    { status: 'COMPLETED',  label: 'เสร็จสิ้น',         color: 'text-cyber-green' },
  ]

  const OrdersContent = () => {
    const [filterStatus, setFilterStatus] = useState<string>('')
    const items = filterItems(salesOrders, ['so_number', 'customer_name'], 'order_date')
      .filter(o => !filterStatus || o.status === filterStatus)

    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาคำสั่งขาย..." action={
          <button onClick={handleCreateSalesOrder}
            className="flex items-center gap-1.5 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm">
            <Plus className="w-4 h-4" /> สร้างคำสั่งขาย
          </button>
        } />

        {/* Delivery status filter pills */}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${!filterStatus ? 'bg-cyber-primary text-cyber-dark border-cyber-primary' : 'border-cyber-border text-gray-400 hover:text-white'}`}>
            ทั้งหมด
          </button>
          {SO_DELIVERY_STEPS.map(s => (
            <button key={s.status} onClick={() => setFilterStatus(s.status === filterStatus ? '' : s.status)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterStatus === s.status ? 'bg-cyber-dark border-cyber-primary text-white' : 'border-cyber-border text-gray-400 hover:text-white'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500"><ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>ไม่พบคำสั่งขาย</p></div>
        ) : viewMode === 'list' ? (
          <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-border bg-cyber-darker text-xs text-gray-400">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">วันสั่ง</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">กำหนดส่ง</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะจัดส่ง</th>
                  <th className="text-center px-4 py-2.5 font-medium hidden lg:table-cell">ชำระ</th>
                  <th className="text-right px-4 py-2.5 font-medium">ยอดรวม</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border/50">
                {items.map(order => {
                  const step = SO_DELIVERY_STEPS.find(s => s.status === order.status)
                  const stepIdx = SO_DELIVERY_STEPS.findIndex(s => s.status === order.status)
                  const isLate = order.delivery_date && new Date(order.delivery_date) < new Date() && order.status !== 'DELIVERED' && order.status !== 'COMPLETED'
                  return (
                    <tr key={order.id} className="hover:bg-cyber-dark/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-purple-400">{order.so_number}</p>
                        {order.quotation_number && <p className="text-xs text-gray-600">QT: {order.quotation_number}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{order.customer_name}</p>
                        <p className="text-xs text-gray-500">{order.customer_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{formatDate(order.order_date)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`text-xs font-medium ${isLate ? 'text-red-400' : 'text-gray-400'}`}>
                          {formatDate(order.delivery_date)}{isLate ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-0.5 justify-center">
                          {SO_DELIVERY_STEPS.slice(0, 5).map((s, i) => (
                            <div key={s.status} className={`h-1.5 rounded-full flex-1 ${i <= stepIdx ? 'bg-cyber-primary' : 'bg-cyber-border'}`} style={{ minWidth: 12 }} />
                          ))}
                        </div>
                        <p className={`text-xs text-center mt-1 font-medium ${step?.color || 'text-gray-400'}`}>{step?.label}</p>
                        {(order.pending_qty ?? 0) > 0 && (
                          <p className="text-xs text-center text-orange-400">ค้างส่ง {order.pending_qty}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        <StatusBadge status={order.payment_status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-white">{formatCurrency(order.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                          className="px-2.5 py-1 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white">ดู</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cyber-border/50 text-xs text-gray-500">
              แสดง {items.length} รายการ
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((order, i) => {
              const step = SO_DELIVERY_STEPS.find(s => s.status === order.status)
              const stepIdx = SO_DELIVERY_STEPS.findIndex(s => s.status === order.status)
              const isLate = order.delivery_date && new Date(order.delivery_date) < new Date() && order.status !== 'DELIVERED' && order.status !== 'COMPLETED'
              return (
                <motion.div key={order.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-purple-500/40 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-purple-400">{order.so_number}</p>
                      {order.quotation_number && <p className="text-xs text-gray-500">QT: {order.quotation_number}</p>}
                      <p className="text-white font-medium mt-0.5">{order.customer_name}</p>
                      <p className="text-xs text-gray-500">{order.customer_code}</p>
                    </div>
                    <StatusBadge status={order.payment_status} />
                  </div>
                  {/* Delivery progress bar */}
                  <div className="flex items-center gap-0.5 my-2">
                    {SO_DELIVERY_STEPS.slice(0, 5).map((s, idx) => (
                      <div key={s.status} className={`h-1.5 rounded-full flex-1 ${idx <= stepIdx ? 'bg-cyber-primary' : 'bg-cyber-border'}`} />
                    ))}
                  </div>
                  <p className={`text-xs font-medium mb-2 ${step?.color || 'text-gray-400'}`}>{step?.label}{(order.pending_qty ?? 0) > 0 ? ` · ค้างส่ง ${order.pending_qty}` : ''}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                    <span>วันสั่ง: <span className="text-gray-300">{formatDate(order.order_date)}</span></span>
                    <span>กำหนดส่ง: <span className={isLate ? 'text-red-400 font-medium' : 'text-gray-300'}>{formatDate(order.delivery_date)}{isLate ? ' ⚠' : ''}</span></span>
                    <span>{order.item_count} รายการ</span>
                    <span className="text-right font-semibold text-white">{formatCurrency(order.total_amount)}</span>
                  </div>
                  <div className="pt-3 border-t border-cyber-border/50">
                    <button onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                      className="w-full py-1.5 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white transition-colors">
                      ดูรายละเอียด
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  const InvoicesContent = () => {
    const items = filterItems(invoices, ['invoice_number', 'customer_name'], 'invoice_date')
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบแจ้งหนี้..." action={
          <button onClick={handleCreateInvoice}
            className="flex items-center gap-1.5 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 text-sm">
            <Plus className="w-4 h-4" /> สร้างใบแจ้งหนี้
          </button>
        } />

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบแจ้งหนี้</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-border bg-cyber-darker text-xs text-gray-400">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">SO</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">วันที่</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">ครบกำหนด</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">ยอดรวม</th>
                  <th className="text-right px-4 py-2.5 font-medium">คงค้าง</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border/50">
                {items.map(inv => {
                  const isOverdue = inv.payment_status === 'OVERDUE'
                  const isUnpaid = inv.payment_status === 'UNPAID' || isOverdue
                  return (
                    <tr key={inv.id} className={`hover:bg-cyber-dark/50 transition-colors ${isOverdue ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-yellow-400">{inv.invoice_number}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{inv.customer_name}</p>
                        <p className="text-xs text-gray-500">{inv.customer_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{inv.so_number}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`text-xs font-medium ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
                          {formatDate(inv.due_date)}{isOverdue ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={inv.payment_status} /></td>
                      <td className="px-4 py-3 text-right font-semibold text-white">{formatCurrency(inv.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-semibold ${inv.balance_amount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {formatCurrency(inv.balance_amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => handleViewDetail(inv, 'ใบแจ้งหนี้')}
                            className="px-2.5 py-1 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white">ดู</button>
                          {isUnpaid && (
                            <button onClick={() => handleRecordPayment(inv)}
                              className="px-2.5 py-1 text-xs font-medium text-cyber-green bg-cyber-green/10 rounded-lg hover:bg-cyber-green/20 flex items-center gap-1">
                              <DollarSign className="w-3 h-3" /> รับเงิน
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cyber-border/50 text-xs text-gray-500">
              แสดง {items.length} รายการ
            </div>
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
                      <p className="font-mono text-sm font-semibold text-yellow-400">{inv.invoice_number}</p>
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
    const items = filterItems(creditNotes, ['cn_number', 'customer_name'], 'credit_date')
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบลดหนี้..." action={
          <button onClick={handleCreateCreditNote}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-500/80 text-white font-semibold rounded-lg hover:bg-red-500 text-sm">
            <Plus className="w-4 h-4" /> สร้างใบลดหนี้
          </button>
        } />

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบลดหนี้</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-border bg-cyber-darker text-xs text-gray-400">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">INV</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">วันที่</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">เหตุผล</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">ยอด</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border/50">
                {items.map(cn => (
                  <tr key={cn.id} className="hover:bg-cyber-dark/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-red-400">{cn.cn_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{cn.customer_name}</p>
                      <p className="text-xs text-gray-500">{cn.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{cn.invoice_number}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">{formatDate(cn.credit_date)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell max-w-[160px] truncate">{cn.reason}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={cn.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-red-400">-{formatCurrency(cn.total_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleViewDetail(cn, 'ใบลดหนี้')}
                        className="px-2.5 py-1 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white">ดู</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cyber-border/50 text-xs text-gray-500">
              แสดง {items.length} รายการ
            </div>
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
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบค้างส่ง..." action={
          <button onClick={handleCreateBackorder}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-500/80 text-white font-semibold rounded-lg hover:bg-orange-500 text-sm">
            <Plus className="w-4 h-4" /> สร้างใบค้างส่ง
          </button>
        } />

        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบค้างส่ง</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-border bg-cyber-darker text-xs text-gray-400">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">SO</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">ใบส่งของต้นฉบับ</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-border/50">
                {items.map(bo => (
                  <tr key={bo.id} className="hover:bg-cyber-dark/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-orange-400">{bo.bo_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{bo.customer_name}</p>
                      <p className="text-xs text-gray-500">{bo.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{bo.so_number}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">{bo.original_do || '-'}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={bo.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleViewDetail(bo, 'ใบค้างส่ง')}
                        className="px-2.5 py-1 text-xs text-gray-300 bg-cyber-dark rounded-lg hover:text-white">ดู</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cyber-border/50 text-xs text-gray-500">
              แสดง {items.length} รายการ
            </div>
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

      {/* ── Sales Modals — always mounted at top-level ── */}
      {showCreateQT && (
        <CreateQuotationModal
          onClose={() => setShowCreateQT(false)}
          onSaved={() => { setShowCreateQT(false); fetchQuotations() }}
        />
      )}
      {showCreateSO && (
        <CreateSOModal
          onClose={() => setShowCreateSO(false)}
          onSaved={() => { setShowCreateSO(false); fetchSalesOrders() }}
        />
      )}
      {convertQT && (
        <CreateSOModal
          sourceQuotation={convertQT}
          onClose={() => setConvertQT(null)}
          onSaved={() => { setConvertQT(null); fetchSalesOrders(); fetchQuotations() }}
        />
      )}
      {detailQT && (
        <QuotationDetailModal
          quotation={detailQT}
          onClose={() => setDetailQT(null)}
          onRefresh={() => fetchQuotations()}
          onConvert={(q) => { setDetailQT(null); setConvertQT(q) }}
          companyName={tenant?.name}
        />
      )}
      {detailSO && (
        <SODetailModal
          salesOrder={detailSO}
          onClose={() => setDetailSO(null)}
          onRefresh={() => fetchSalesOrders()}
          onCreateInvoice={() => { setDetailSO(null); fetchInvoices(); setActiveTab('invoices') }}
          companyName={tenant?.name}
        />
      )}
      {detailInv && (
        <InvoiceDetailModal
          invoice={detailInv}
          onClose={() => setDetailInv(null)}
          onRefresh={() => fetchInvoices()}
          companyName={tenant?.name}
        />
      )}
      {showCreateCN && (
        <CreateCreditNoteModal
          onClose={() => setShowCreateCN(false)}
          onSaved={() => { setShowCreateCN(false); fetchCreditNotes() }}
        />
      )}
      {detailCN && (
        <CreditNoteDetailModal
          creditNote={detailCN}
          onClose={() => setDetailCN(null)}
          onRefresh={() => fetchCreditNotes()}
          companyName={tenant?.name}
        />
      )}
      {detailBO && (
        <BackorderDetailModal
          backorder={detailBO}
          onClose={() => setDetailBO(null)}
          onRefresh={() => fetchBackorders()}
        />
      )}
    </div>
  )
}

// ─── Quick Add Customer Modal ─────────────────────────────────────────────────
function QuickAddCustomerModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (c: Customer) => void
}) {
  useModalClose(onClose)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [type, setType] = useState('INDIVIDUAL')
  const [saving, setSaving] = useState(false)

  // Auto-generate code from name
  useEffect(() => {
    if (!code && name) {
      const gen = 'C-' + name.replace(/\s+/g, '').substring(0, 6).toUpperCase() + '-' + Date.now().toString().slice(-4)
      setCode(gen)
    }
  }, [name])

  const handleSave = async () => {
    if (!name.trim() || !code.trim() || !phone.trim()) {
      toast.error('กรุณากรอก ชื่อ, รหัสลูกค้า และเบอร์โทร')
      return
    }
    setSaving(true)
    try {
      const customer = await salesService.createCustomer({
        code: code.trim(),
        name: name.trim(),
        type,
        contactName: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
      })
      toast.success('เพิ่มลูกค้าสำเร็จ')
      onCreated(customer)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'เพิ่มลูกค้าไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-sm">
        <div className="p-4 border-b border-cyber-border flex justify-between items-center">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyber-primary" /> เพิ่มลูกค้าใหม่ (ด่วน)
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อลูกค้า *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อบริษัท / บุคคล..."
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">รหัสลูกค้า *</label>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="C-XXXX"
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary">
                <option value="INDIVIDUAL">บุคคล</option>
                <option value="COMPANY">บริษัท</option>
                <option value="GOVERNMENT">รัฐบาล</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">เบอร์โทร *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0812345678"
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">อีเมล</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
          </div>
        </div>
        <div className="p-4 border-t border-cyber-border flex gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-white">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg text-sm hover:bg-cyber-primary/80 disabled:opacity-50 flex items-center justify-center gap-1">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Shared: Customer Search Dropdown ────────────────────────────────────────
function CustomerSearch({ value, onChange }: {
  value: Customer | null
  onChange: (c: Customer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [open, setOpen] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return }
    const t = setTimeout(async () => {
      const r = await salesService.searchCustomers(query)
      setResults(r)
      setSearched(true)
      setOpen(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cyber-dark border border-cyber-primary/50 rounded-lg">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{value.name}</p>
          <p className="text-xs text-gray-500">{value.code} · {value.phone || '-'}</p>
        </div>
        <button onClick={() => onChange(null)} className="text-gray-500 hover:text-red-400">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSearched(false) }}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="ค้นหาลูกค้า (ชื่อ / รหัส / เบอร์โทร)..."
          className="w-full pl-9 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-cyber-primary"
        />
        {open && (results.length > 0 || searched) && (
          <div className="absolute z-50 w-full mt-1 bg-cyber-card border border-cyber-border rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
            {results.map(c => (
              <button key={c.id} onMouseDown={() => { onChange(c); setQuery(''); setOpen(false); setSearched(false) }}
                className="w-full px-4 py-2.5 flex items-start gap-2 hover:bg-cyber-dark text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.code} · {c.phone || '-'}</p>
                </div>
              </button>
            ))}
            {results.length === 0 && searched && (
              <div className="px-4 py-3 text-sm text-gray-500">ไม่พบลูกค้า</div>
            )}
          </div>
        )}
      </div>
      {showQuickAdd && (
        <QuickAddCustomerModal
          onClose={() => setShowQuickAdd(false)}
          onCreated={c => { onChange(c); setShowQuickAdd(false); setQuery('') }}
        />
      )}
    </>
  )
}

// ─── Shared: Product Line Items Editor ───────────────────────────────────────

interface LineItem {
  productId?: string
  productName: string
  quantity: number
  unit: string
  unitPrice: number
  discountPercent: number
}

function ProductSearch({ value, products, onSelect, onClear }: {
  value: { id?: string; name: string } | null
  products: Product[]
  onSelect: (p: Product) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = query.trim().length > 0
    ? products.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.code.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 30)
    : []

  if (value?.id || value?.name) {
    const displayName = value.name || products.find(p => p.id === value.id)?.name || value.id?.slice(0, 12) || '...'
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 bg-cyber-dark border border-cyber-primary/50 rounded-lg min-w-0">
        <span className="flex-1 text-sm text-white truncate">{displayName}</span>
        <button type="button" onClick={onClear} className="shrink-0 text-gray-500 hover:text-red-400">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="ค้นหาสินค้า (ชื่อ / รหัส)..."
        className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-0.5 bg-cyber-card border border-cyber-border rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {filtered.map(p => (
            <button key={p.id} type="button"
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full px-3 py-2 flex items-center justify-between hover:bg-cyber-dark text-left gap-2">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{p.name}</p>
                <p className="text-xs text-gray-500">{p.code}</p>
              </div>
              <span className="text-xs text-cyber-primary shrink-0">฿{(p.sell_price || 0).toLocaleString('th-TH')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LineItemsEditor({
  items, onChange, products,
}: {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
  products: Product[]
}) {
  const { units: availableUnits } = useUnits()
  const add = () => onChange([...items, { productName: '', quantity: 1, unit: '', unitPrice: 0, discountPercent: 0 }])
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  const update = (i: number, patch: Partial<LineItem>) => {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-300">รายการสินค้า</p>
        <button type="button" onClick={add}
          className="flex items-center gap-1 text-xs text-cyber-primary hover:text-cyber-primary/80">
          <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
        </button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="bg-cyber-darker p-3 rounded-lg space-y-2">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-5">
              <label className="text-xs text-gray-500 mb-1 block">สินค้า</label>
              <ProductSearch
                value={item.productId ? { id: item.productId, name: item.productName } : item.productName ? { id: undefined, name: item.productName } : null}
                products={products}
                onSelect={p => update(i, { productId: p.id, productName: p.name, unit: p.unit || '', unitPrice: p.sell_price || 0 })}
onClear={() => update(i, { productId: undefined, productName: '' })}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">จำนวน</label>
              <input type="number" value={item.quantity} min={0.01} step={0.01}
                onChange={e => update(i, { quantity: parseFloat(e.target.value) || 0 })}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">หน่วย</label>
              <select
                value={item.unit || ''}
                onChange={e => update(i, { unit: e.target.value })}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyber-primary">
                <option value="">เลือกหน่วย</option>
                {availableUnits.map(u => <option key={u.value} value={u.value}>{u.label} ({u.value})</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">ราคา/หน่วย</label>
              <input type="number" value={item.unitPrice} min={0} step={0.01}
                onChange={e => update(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">ส่วนลด%</label>
              <input type="number" value={item.discountPercent} min={0} max={100}
                onChange={e => update(i, { discountPercent: parseFloat(e.target.value) || 0 })}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            </div>
            <div className="col-span-1 flex justify-end pb-1">
              {items.length > 1 && (
                <button type="button" onClick={() => remove(i)} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-gray-400">
            รวม: <span className="text-white font-medium">
              ฿{(item.quantity * item.unitPrice * (1 - item.discountPercent / 100)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Shared: Totals Summary ───────────────────────────────────────────────────
function TotalsSummary({ items, taxRate, setTaxRate, discountAmount, setDiscountAmount }: {
  items: LineItem[]
  taxRate: number; setTaxRate: (v: number) => void
  discountAmount: number; setDiscountAmount: (v: number) => void
}) {
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice * (1 - it.discountPercent / 100), 0)
  const afterDiscount = Math.max(0, subtotal - discountAmount)
  const tax = afterDiscount * (taxRate / 100)
  const total = afterDiscount + tax
  return (
    <div className="bg-cyber-darker p-4 rounded-xl space-y-2 text-sm">
      <div className="flex justify-between text-gray-400">
        <span>ยอดรวม</span><span>฿{subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="flex justify-between text-gray-400 items-center gap-4">
        <span className="shrink-0">ส่วนลด (฿)</span>
        <input type="number" value={discountAmount} min={0}
          onChange={e => setDiscountAmount(parseFloat(e.target.value) || 0)}
          onFocus={e => e.target.select()}
          className="w-28 text-right bg-cyber-dark border border-cyber-border rounded px-2 py-1 text-white focus:outline-none focus:border-cyber-primary" />
      </div>
      <div className="flex justify-between text-gray-400 items-center gap-4">
        <span className="shrink-0">VAT (%)</span>
        <div className="flex items-center gap-2">
          {[0, 7].map(r => (
            <button key={r} type="button" onClick={() => setTaxRate(r)}
              className={`px-2 py-0.5 rounded text-xs border ${taxRate === r ? 'border-cyber-primary text-cyber-primary' : 'border-cyber-border text-gray-500'}`}>
              {r}%
            </button>
          ))}
          <input type="number" value={taxRate} min={0} max={100}
            onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            className="w-16 text-right bg-cyber-dark border border-cyber-border rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-cyber-primary" />
        </div>
      </div>
      {taxRate > 0 && (
        <div className="flex justify-between text-yellow-400">
          <span>VAT ({taxRate}%)</span><span>+฿{tax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-base border-t border-cyber-border pt-2">
        <span className="text-gray-100">ยอดสุทธิ</span>
        <span className="text-cyber-green">฿{total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}

// ─── Create Quotation Modal ───────────────────────────────────────────────────
function CreateQuotationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useModalClose(onClose)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ productName: '', quantity: 1, unit: '', unitPrice: 0, discountPercent: 0 }])
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [showQuickAddCust, setShowQuickAddCust] = useState(false)

  useEffect(() => {
    salesService.getProducts().then(setProducts).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!customer) { toast.error('กรุณาเลือกลูกค้า'); return }
    if (items.every(it => !it.productName && !it.productId)) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return }
    setSaving(true)
    try {
      await salesService.createQuotation({
        customerId: customer.id,
        expiryDate: expiryDate || undefined,
        taxRate,
        discountAmount,
        notes,
        items: items.filter(it => it.productName || it.productId).map(it => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          discountPercent: it.discountPercent,
        })),
      })
      toast.success('สร้างใบเสนอราคาสำเร็จ')
      onSaved()
    } catch {
      toast.error('สร้างใบเสนอราคาไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyber-primary" /> สร้างใบเสนอราคา (QT)
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-sm text-gray-400">ลูกค้า *</label>
                <button type="button" onClick={() => setShowQuickAddCust(true)}
                  className="flex items-center gap-1 text-xs text-cyber-primary hover:text-cyber-primary/80">
                  <Plus className="w-3.5 h-3.5" /> เพิ่มลูกค้า
                </button>
              </div>
              <CustomerSearch value={customer} onChange={setCustomer} />
              {showQuickAddCust && (
                <QuickAddCustomerModal
                  onClose={() => setShowQuickAddCust(false)}
                  onCreated={c => { setCustomer(c); setShowQuickAddCust(false) }}
                />
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">วันหมดอายุ</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">หมายเหตุ</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="หมายเหตุ..."
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary" />
            </div>
          </div>

          <LineItemsEditor items={items} onChange={setItems} products={products} />
          <TotalsSummary items={items} taxRate={taxRate} setTaxRate={setTaxRate} discountAmount={discountAmount} setDiscountAmount={setDiscountAmount} />
        </div>

        <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 disabled:opacity-50 text-sm">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            สร้างใบเสนอราคา
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Quotation Detail Modal ───────────────────────────────────────────────────
function QuotationDetailModal({ quotation, onClose, onRefresh, onConvert, companyName }: {
  quotation: Quotation; onClose: () => void; onRefresh: () => void; onConvert: (q: Quotation) => void; companyName?: string
}) {
  useModalClose(onClose)
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    salesService.getQuotation(quotation.id).then(r => { setDetail(r.data); setLoading(false) })
  }, [quotation.id])

  const handlePrint = (format: 'a4' | 'thermal') => {
    if (!detail) return
    const co = getCachedCompanySettings()
    printSalesDoc('qt', { ...detail, _company: co.name || companyName || '-', _companyAddress: co.address || '', _companyTax: co.tax_id || '', _companyPhone: co.phone || '', _companyLogo: co.logo_base64 || '' }, format)
  }

  const updateStatus = async (status: string) => {
    setUpdating(true)
    try {
      await salesService.updateQuotationStatus(quotation.id, status)
      toast.success('อัปเดตสถานะสำเร็จ')
      onRefresh()
      onClose()
    } catch {
      toast.error('อัปเดตสถานะไม่สำเร็จ')
    } finally { setUpdating(false) }
  }

  const formatCurrency = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const formatDate = (s: string) => s ? new Date(s).toLocaleDateString('th-TH') : '-'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <div>
            <p className="font-mono text-sm text-cyber-primary font-semibold">{quotation.quotation_number}</p>
            <p className="text-white font-bold">{quotation.customer_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={quotation.status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-primary mx-auto" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-cyber-dark rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">วันที่</p>
                  <p className="text-white">{formatDate(detail?.quotation_date)}</p>
                </div>
                <div className="bg-cyber-dark rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">วันหมดอายุ</p>
                  <p className={`font-medium ${detail?.expiry_date && new Date(detail.expiry_date) < new Date() ? 'text-red-400' : 'text-white'}`}>
                    {formatDate(detail?.expiry_date)}
                  </p>
                </div>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-300">รายการสินค้า</p>
                <div className="space-y-1">
                  {(detail?.items || []).map((it: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-2 px-3 bg-cyber-darker rounded-lg text-sm">
                      <div>
                        <p className="text-white">{it.product_name || it.productName || `รายการ ${i + 1}`}</p>
                        <p className="text-xs text-gray-500">{it.quantity} × ฿{(it.unit_price || 0).toLocaleString()}{it.discount_percent > 0 ? ` (-${it.discount_percent}%)` : ''}</p>
                      </div>
                      <p className="text-white font-medium">{formatCurrency(it.total_price)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-cyber-darker rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-400"><span>ยอดรวม</span><span>{formatCurrency(detail?.subtotal)}</span></div>
                {(detail?.discount_amount || 0) > 0 && <div className="flex justify-between text-red-400"><span>ส่วนลด</span><span>-{formatCurrency(detail?.discount_amount)}</span></div>}
                {(detail?.tax_amount || 0) > 0 && <div className="flex justify-between text-yellow-400"><span>VAT ({detail?.tax_rate}%)</span><span>+{formatCurrency(detail?.tax_amount)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t border-cyber-border pt-2">
                  <span className="text-gray-100">ยอดสุทธิ</span><span className="text-cyber-green">{formatCurrency(detail?.total_amount)}</span>
                </div>
              </div>

              {detail?.notes && (
                <div className="bg-cyber-dark rounded-lg p-3 text-sm text-gray-400">หมายเหตุ: {detail.notes}</div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-cyber-border flex gap-2 shrink-0 flex-wrap">
          {/* Print buttons */}
          {!loading && (
            <>
              <button onClick={() => handlePrint('a4')} title="พิมพ์ A4"
                className="px-2.5 py-2 text-gray-400 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors">
                <Printer className="w-4 h-4" />
              </button>
              <button onClick={() => handlePrint('thermal')} title="พิมพ์ Thermal"
                className="px-2 py-2 text-gray-500 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors text-xs">
                <Printer className="w-3.5 h-3.5 inline" /> 80mm
              </button>
            </>
          )}
          {quotation.status === 'DRAFT' && (
            <button onClick={() => updateStatus('SENT')} disabled={updating}
              className="flex-1 py-2 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 disabled:opacity-50">
              ส่งใบเสนอราคา
            </button>
          )}
          {(quotation.status === 'SENT' || quotation.status === 'DRAFT') && (
            <button onClick={() => updateStatus('ACCEPTED')} disabled={updating}
              className="flex-1 py-2 bg-cyber-green/20 border border-cyber-green/50 text-cyber-green rounded-lg text-sm font-medium hover:bg-cyber-green/30 disabled:opacity-50">
              อนุมัติ
            </button>
          )}
          {quotation.status === 'ACCEPTED' && (
            <button onClick={() => onConvert(quotation)} disabled={updating}
              className="flex-1 py-2 bg-cyber-primary text-cyber-dark rounded-lg text-sm font-semibold hover:bg-cyber-primary/80">
              <ArrowRight className="w-4 h-4 inline mr-1" />แปลงเป็นคำสั่งขาย (SO)
            </button>
          )}
          {!['CANCELLED', 'EXPIRED'].includes(quotation.status) && (
            <button onClick={() => updateStatus('CANCELLED')} disabled={updating}
              className="py-2 px-3 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/10 disabled:opacity-50">
              ยกเลิก
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Create Sales Order Modal ─────────────────────────────────────────────────
function CreateSOModal({ sourceQuotation, onClose, onSaved }: {
  sourceQuotation?: Quotation; onClose: () => void; onSaved: () => void
}) {
  useModalClose(onClose)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ productName: '', quantity: 1, unit: '', unitPrice: 0, discountPercent: 0 }])
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [showQuickAddCust, setShowQuickAddCust] = useState(false)

  useEffect(() => {
    salesService.getProducts().then(prods => {
      setProducts(prods)
      // Pre-fill from quotation (after products loaded so we can lookup names)
      if (sourceQuotation) {
        salesService.getQuotation(sourceQuotation.id).then(r => {
          const qt = r.data
          if (qt) {
            setTaxRate(qt.tax_rate || 0)
            setDiscountAmount(qt.discount_amount || 0)
            if (qt.items?.length) {
              setItems(qt.items.map((it: any) => {
                const pid = it.stock_item_id || it.product_id || undefined
                const pname = it.product_name || prods.find(p => p.id === pid)?.name || ''
                return {
                  productId: pid,
                  productName: pname,
                  quantity: it.quantity,
                  unit: it.unit || '',
                  unitPrice: it.unit_price,
                  discountPercent: it.discount_percent || 0,
                }
              }))
            }
          }
        }).catch(() => {})
        // Pre-load customer
        if (sourceQuotation.customer_code) {
          salesService.searchCustomers(sourceQuotation.customer_name).then(r => {
            if (r.length) setCustomer(r[0])
          }).catch(() => {})
        }
      }
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!customer) { toast.error('กรุณาเลือกลูกค้า'); return }
    if (items.every(it => !it.productName && !it.productId)) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return }
    setSaving(true)
    try {
      await salesService.createSalesOrder({
        customerId: customer.id,
        quotationId: sourceQuotation?.id,
        deliveryDate: deliveryDate || undefined,
        taxRate,
        discountAmount,
        notes,
        items: items.filter(it => it.productName || it.productId).map(it => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          discountPercent: it.discountPercent,
        })),
      })
      toast.success('สร้างคำสั่งขายสำเร็จ')
      onSaved()
    } catch {
      toast.error('สร้างคำสั่งขายไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-purple-400" />
            {sourceQuotation ? `แปลง ${sourceQuotation.quotation_number} → SO` : 'สร้างคำสั่งขาย (SO)'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-sm text-gray-400">ลูกค้า *</label>
                <button type="button" onClick={() => setShowQuickAddCust(true)}
                  className="flex items-center gap-1 text-xs text-cyber-primary hover:text-cyber-primary/80">
                  <Plus className="w-3.5 h-3.5" /> เพิ่มลูกค้า
                </button>
              </div>
              <CustomerSearch value={customer} onChange={setCustomer} />
              {showQuickAddCust && (
                <QuickAddCustomerModal
                  onClose={() => setShowQuickAddCust(false)}
                  onCreated={c => { setCustomer(c); setShowQuickAddCust(false) }}
                />
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">กำหนดส่ง</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyber-primary" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">หมายเหตุ</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="หมายเหตุ..."
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyber-primary" />
            </div>
          </div>

          <LineItemsEditor items={items} onChange={setItems} products={products} />
          <TotalsSummary items={items} taxRate={taxRate} setTaxRate={setTaxRate} discountAmount={discountAmount} setDiscountAmount={setDiscountAmount} />
        </div>

        <div className="p-5 border-t border-cyber-border flex gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600 disabled:opacity-50 text-sm">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            {sourceQuotation ? 'แปลงเป็นคำสั่งขาย' : 'สร้างคำสั่งขาย'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Sales Order Detail Modal ─────────────────────────────────────────────────
function SODetailModal({ salesOrder, onClose, onRefresh, onCreateInvoice, companyName }: {
  salesOrder: SalesOrder; onClose: () => void; onRefresh: () => void; onCreateInvoice: () => void; companyName?: string
}) {
  useModalClose(onClose)
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [creatingInv, setCreatingInv] = useState(false)

  useEffect(() => {
    salesService.getSalesOrder(salesOrder.id).then(r => { setDetail(r.data); setLoading(false) })
  }, [salesOrder.id])

  const handlePrint = () => {
    if (!detail) return
    const co = getCachedCompanySettings()
    printSalesDoc('so', { ...detail, _company: co.name || companyName || '-', _companyAddress: co.address || '', _companyTax: co.tax_id || '', _companyPhone: co.phone || '', _companyLogo: co.logo_base64 || '' }, 'a4')
  }

  const updateStatus = async (status: string) => {
    setUpdating(true)
    try {
      await salesService.updateSOStatus(salesOrder.id, status)
      toast.success('อัปเดตสถานะสำเร็จ')
      onRefresh()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'อัปเดตสถานะไม่สำเร็จ')
    } finally { setUpdating(false) }
  }

  const handleCreateInvoice = async () => {
    setCreatingInv(true)
    try {
      await salesService.createInvoice(salesOrder.id)
      toast.success('สร้างใบแจ้งหนี้สำเร็จ')
      onCreateInvoice()
    } catch { toast.error('สร้างใบแจ้งหนี้ไม่สำเร็จ') }
    finally { setCreatingInv(false) }
  }

  const fmt = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const fmtD = (s: string) => s ? new Date(s).toLocaleDateString('th-TH') : '-'

  const SO_FLOW = ['DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'COMPLETED']
  const nextStatus: Record<string, string> = { DRAFT: 'CONFIRMED', CONFIRMED: 'PROCESSING', PROCESSING: 'READY', READY: 'DELIVERED', DELIVERED: 'COMPLETED' }
  const nextLabel: Record<string, string> = { DRAFT: 'ยืนยัน SO', CONFIRMED: 'เริ่มดำเนินการ', PROCESSING: 'พร้อมส่ง', READY: 'ส่งของแล้ว', DELIVERED: 'เสร็จสิ้น' }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <div>
            <p className="font-mono text-sm text-purple-400 font-semibold">{salesOrder.so_number}</p>
            <p className="text-white font-bold">{salesOrder.customer_name}</p>
            {salesOrder.quotation_number && <p className="text-xs text-gray-500">QT: {salesOrder.quotation_number}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={salesOrder.status} />
            <StatusBadge status={salesOrder.payment_status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {/* Status Flow */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {SO_FLOW.map((s, i) => {
              const currentIdx = SO_FLOW.indexOf(salesOrder.status)
              const isPast = i < currentIdx
              const isCurrent = i === currentIdx
              return (
                <div key={s} className="flex items-center gap-1 shrink-0">
                  <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${isCurrent ? 'bg-purple-500 text-white' : isPast ? 'bg-cyber-green/20 text-cyber-green' : 'bg-cyber-darker text-gray-500'}`}>
                    {STATUS_CONFIG[s]?.label || s}
                  </div>
                  {i < SO_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-gray-600 shrink-0" />}
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-primary mx-auto" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-cyber-dark rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">วันสั่งซื้อ</p><p className="text-white">{fmtD(detail?.order_date)}</p>
                </div>
                <div className="bg-cyber-dark rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">กำหนดส่ง</p><p className="text-white">{fmtD(detail?.delivery_date)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-300">รายการสินค้า</p>
                {(detail?.items || []).map((it: any, i: number) => {
                  const insufficient = it.stock_item_id && (it.stock_qty ?? Infinity) < it.quantity
                  return (
                    <div key={i} className={`flex justify-between items-start py-2 px-3 rounded-lg text-sm ${insufficient ? 'bg-red-500/10 border border-red-500/30' : 'bg-cyber-darker'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-white">{it.product_name || `รายการ ${i + 1}`}</p>
                        <p className="text-xs text-gray-500">{it.quantity} × {fmt(it.unit_price)}{it.discount_percent > 0 ? ` (-${it.discount_percent}%)` : ''}</p>
                        {insufficient && (
                          <p className="text-xs text-red-400 mt-0.5">⚠ สต็อกไม่พอ (มี {it.stock_qty ?? 0} ชิ้น)</p>
                        )}
                      </div>
                      <p className="text-white font-medium ml-3">{fmt(it.total_price)}</p>
                    </div>
                  )
                })}
              </div>

              <div className="bg-cyber-darker rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-400"><span>ยอดรวม</span><span>{fmt(detail?.subtotal)}</span></div>
                {(detail?.discount_amount || 0) > 0 && <div className="flex justify-between text-red-400"><span>ส่วนลด</span><span>-{fmt(detail?.discount_amount)}</span></div>}
                {(detail?.tax_amount || 0) > 0 && <div className="flex justify-between text-yellow-400"><span>VAT ({detail?.tax_rate}%)</span><span>+{fmt(detail?.tax_amount)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t border-cyber-border pt-2">
                  <span className="text-gray-100">ยอดสุทธิ</span><span className="text-cyber-green">{fmt(detail?.total_amount)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-cyber-border flex gap-2 shrink-0 flex-wrap">
          {!loading && (
            <button onClick={handlePrint} title="พิมพ์ SO (A4)"
              className="px-2.5 py-2 text-gray-400 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors">
              <Printer className="w-4 h-4" />
            </button>
          )}
          {nextStatus[salesOrder.status] && (
            <button onClick={() => updateStatus(nextStatus[salesOrder.status])} disabled={updating}
              className="flex-1 py-2 bg-purple-500/20 border border-purple-500/50 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50">
              {nextLabel[salesOrder.status]}
            </button>
          )}
          {['CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'COMPLETED'].includes(salesOrder.status) && (
            <button onClick={handleCreateInvoice} disabled={creatingInv}
              className="flex-1 py-2 bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30 disabled:opacity-50 flex items-center justify-center gap-1">
              {creatingInv ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
              ออกใบแจ้งหนี้
            </button>
          )}
          {!['CANCELLED', 'COMPLETED'].includes(salesOrder.status) && (
            <button onClick={() => updateStatus('CANCELLED')} disabled={updating}
              className="py-2 px-3 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/10 disabled:opacity-50">
              ยกเลิก
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Invoice Detail Modal ─────────────────────────────────────────────────────
function InvoiceDetailModal({ invoice, onClose, onRefresh, companyName }: {
  invoice: Invoice; onClose: () => void; onRefresh: () => void; companyName?: string
}) {
  useModalClose(onClose)
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showPayment, setShowPayment] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  const [payRef, setPayRef] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const loadDetail = () => {
    salesService.getInvoice(invoice.id).then(r => { setDetail(r.data); setLoading(false) })
  }
  useEffect(() => { loadDetail() }, [invoice.id])

  const handlePrintInv = (format: 'a4' | 'thermal') => {
    if (!detail) return
    const co = getCachedCompanySettings()
    printSalesDoc('inv', { ...detail, _company: co.name || companyName || '-', _companyAddress: co.address || '', _companyTax: co.tax_id || '', _companyPhone: co.phone || '', _companyLogo: co.logo_base64 || '' }, format)
  }
  const handlePrintReceipt = (r: any, format: 'a4' | 'thermal') => {
    const co = getCachedCompanySettings()
    printSalesDoc('rc', {
      ...r,
      customer_name: invoice.customer_name,
      customer_code: invoice.customer_code,
      invoice_number: invoice.invoice_number,
      so_number: invoice.so_number,
      _company: co.name || companyName || '-',
      _companyAddress: co.address || '',
      _companyTax: co.tax_id || '',
      _companyPhone: co.phone || '',
      _companyLogo: co.logo_base64 || '',
    }, format)
  }

  const handleRecordPayment = async () => {
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) { toast.error('กรุณากรอกจำนวนเงิน'); return }
    setSaving(true)
    try {
      await salesService.recordPayment(invoice.id, {
        amount,
        paymentMethod: payMethod,
        receiptDate: payDate,
        paymentReference: payRef || undefined,
        notes: payNote || undefined,
      })
      toast.success('บันทึกการรับเงินสำเร็จ')
      onRefresh()
      onClose()
    } catch { toast.error('บันทึกการรับเงินไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 10MB'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      await api.post(`/sales/invoices/${invoice.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('อัปโหลดสำเร็จ')
      loadDetail()
    } catch { toast.error('อัปโหลดไม่สำเร็จ') }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleDeleteAttachment = async (attId: string) => {
    if (!confirm('ลบรูปนี้?')) return
    try {
      await api.delete(`/sales/invoices/${invoice.id}/attachments/${attId}`)
      toast.success('ลบสำเร็จ')
      loadDetail()
    } catch { toast.error('ลบไม่สำเร็จ') }
  }

  const fmt = (n: number) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const fmtD = (s: string) => s ? new Date(s).toLocaleDateString('th-TH') : '-'
  const isUnpaid = invoice.payment_status === 'UNPAID' || invoice.payment_status === 'OVERDUE' || invoice.payment_status === 'PARTIAL'

  return (
    <>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-4xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Header */}
        <div className="p-5 border-b border-cyber-border flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <p className="font-mono text-base text-yellow-400 font-bold">{invoice.invoice_number}</p>
              {invoice.so_number && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="px-1.5 py-0.5 bg-cyber-dark rounded font-mono">SO: {invoice.so_number}</span>
                </div>
              )}
            </div>
            <p className="text-white font-semibold text-lg">{invoice.customer_name}</p>
            {invoice.customer_code && <p className="text-xs text-gray-500 font-mono">{invoice.customer_code}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={invoice.payment_status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-primary mx-auto" /></div>
          ) : (
            <>
              {/* Info row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-cyber-dark rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">วันที่ออกใบ</p>
                  <p className="text-white font-medium">{fmtD(detail?.invoice_date)}</p>
                </div>
                <div className="bg-cyber-dark rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">ครบกำหนด</p>
                  <p className={detail?.payment_status === 'OVERDUE' ? 'text-red-400 font-medium' : 'text-white font-medium'}>{fmtD(detail?.due_date)}</p>
                </div>
                <div className="bg-cyber-dark rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">ยอดรวมทั้งหมด</p>
                  <p className="text-white font-bold">{fmt(detail?.total_amount)}</p>
                </div>
                <div className="bg-cyber-dark rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">ยอดคงค้าง</p>
                  <p className={invoice.balance_amount > 0 ? 'text-red-400 font-bold' : 'text-cyber-green font-bold'}>{fmt(invoice.balance_amount)}</p>
                </div>
              </div>

              {/* Items list */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">รายการสินค้า</p>
                <div className="border border-cyber-border rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 px-3 py-2 bg-cyber-darker text-xs text-gray-500 font-medium border-b border-cyber-border/50">
                    <span className="col-span-5">สินค้า</span>
                    <span className="col-span-2 text-center">จำนวน</span>
                    <span className="col-span-2 text-right">ราคา/หน่วย</span>
                    <span className="col-span-1 text-right">ส่วนลด</span>
                    <span className="col-span-2 text-right">รวม</span>
                  </div>
                  {(detail?.items || []).map((it: any, i: number) => (
                    <div key={i} className={`grid grid-cols-12 px-3 py-3 text-sm items-center ${i % 2 === 0 ? '' : 'bg-cyber-darker/40'} border-b border-cyber-border/30 last:border-0`}>
                      <div className="col-span-5">
                        <p className="text-white font-medium">{it.product_name || `รายการ ${i + 1}`}</p>
                        {it.product_code && <p className="text-xs text-gray-500 font-mono">{it.product_code}</p>}
                      </div>
                      <p className="col-span-2 text-center text-gray-300">{it.quantity} {it.unit || ''}</p>
                      <p className="col-span-2 text-right text-gray-300">{fmt(it.unit_price)}</p>
                      <p className="col-span-1 text-right text-gray-500 text-xs">{it.discount_percent ? `${it.discount_percent}%` : '-'}</p>
                      <p className="col-span-2 text-right text-white font-semibold">{fmt(it.total_price)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals + Payment history — 2 columns on wide screen */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Totals */}
                <div className="bg-cyber-darker rounded-xl p-4 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">สรุปยอด</p>
                  <div className="flex justify-between text-gray-400"><span>ยอดก่อนภาษี</span><span>{fmt((detail?.total_amount || 0) / (detail?.vat_rate ? (1 + detail.vat_rate / 100) : 1))}</span></div>
                  {detail?.vat_amount > 0 && <div className="flex justify-between text-gray-400"><span>VAT {detail?.vat_rate || 7}%</span><span>{fmt(detail?.vat_amount)}</span></div>}
                  <div className="flex justify-between text-gray-300 border-t border-cyber-border/50 pt-1.5"><span>ยอดรวม</span><span>{fmt(detail?.total_amount)}</span></div>
                  {(detail?.paid_amount || 0) > 0 && <div className="flex justify-between text-cyber-green"><span>ชำระแล้ว</span><span>-{fmt(detail?.paid_amount)}</span></div>}
                  <div className="flex justify-between font-bold text-base border-t border-cyber-border pt-2">
                    <span className="text-gray-100">ยอดคงค้าง</span>
                    <span className={invoice.balance_amount > 0 ? 'text-red-400' : 'text-cyber-green'}>{fmt(invoice.balance_amount)}</span>
                  </div>
                </div>

                {/* Payment receipts */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ประวัติการรับเงิน</p>
                  {(detail?.receipts || []).length === 0 ? (
                    <div className="bg-cyber-darker rounded-xl p-4 text-center text-sm text-gray-600">ยังไม่มีการรับเงิน</div>
                  ) : (
                    <div className="space-y-2">
                      {detail.receipts.map((r: any) => (
                        <div key={r.id} className="bg-cyber-darker rounded-xl px-4 py-3 text-sm">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="text-white font-mono text-xs font-semibold">{r.receipt_number}</p>
                              <p className="text-xs text-gray-500 mt-0.5">{fmtD(r.receipt_date)} · {r.payment_method}{r.payment_reference ? ` · ${r.payment_reference}` : ''}</p>
                              {r.notes && <p className="text-xs text-gray-400 mt-1 italic">"{r.notes}"</p>}
                            </div>
                            <p className="text-cyber-green font-bold ml-3">{fmt(r.amount)}</p>
                          </div>
                          <div className="flex gap-1 mt-2">
                            <button onClick={() => handlePrintReceipt(r, 'a4')}
                              className="px-2 py-1 text-gray-500 hover:text-white border border-cyber-border/50 rounded-lg text-xs flex items-center gap-1">
                              <Printer className="w-3 h-3" /> A4
                            </button>
                            <button onClick={() => handlePrintReceipt(r, 'thermal')}
                              className="px-2 py-1 text-gray-500 hover:text-white border border-cyber-border/50 rounded-lg text-xs flex items-center gap-1">
                              <Printer className="w-3 h-3" /> 80mm
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">เอกสารแนบ / รูปภาพ</p>
                  <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${uploading ? 'bg-cyber-dark text-gray-500' : 'bg-cyber-primary/20 text-cyber-primary hover:bg-cyber-primary/30'}`}>
                    {uploading ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป (สูงสุด 10MB)'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadAttachment} disabled={uploading} />
                  </label>
                </div>
                {(detail?.attachments || []).length === 0 ? (
                  <div className="border-2 border-dashed border-cyber-border/50 rounded-xl p-6 text-center text-gray-600 text-sm">
                    <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    ยังไม่มีเอกสารแนบ
                  </div>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {detail.attachments.map((att: any) => (
                      <div key={att.id} className="relative group rounded-xl overflow-hidden border border-cyber-border/50 bg-cyber-darker aspect-square">
                        <img src={`/uploads/invoice-attachments/${att.file_path.split('/').pop()}`}
                          alt={att.original_name}
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button onClick={() => setPreviewUrl(`/uploads/invoice-attachments/${att.file_path.split('/').pop()}`)}
                            className="p-1.5 bg-white/20 rounded-lg hover:bg-white/30">
                            <Eye className="w-3.5 h-3.5 text-white" />
                          </button>
                          <button onClick={() => handleDeleteAttachment(att.id)}
                            className="p-1.5 bg-red-500/30 rounded-lg hover:bg-red-500/50">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                        <p className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/60 text-[10px] text-gray-300 truncate">{att.original_name}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Record Payment Form */}
              {isUnpaid && showPayment && (
                <div className="bg-cyber-dark border border-cyber-primary/30 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-cyber-primary">บันทึกการรับเงิน</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">จำนวนเงิน (฿)</label>
                      <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                        placeholder={`สูงสุด ${fmt(invoice.balance_amount)}`}
                        onFocus={e => e.target.select()}
                        className="w-full bg-cyber-darker border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">วิธีชำระ</label>
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                        className="w-full bg-cyber-darker border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary">
                        <option value="CASH">เงินสด</option>
                        <option value="TRANSFER">โอนเงิน</option>
                        <option value="CHEQUE">เช็ค</option>
                        <option value="CREDIT_CARD">บัตรเครดิต</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">วันที่รับเงิน</label>
                      <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                        className="w-full bg-cyber-darker border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">เลขอ้างอิง</label>
                      <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="เลขโอน / เช็ค..."
                        className="w-full bg-cyber-darker border border-cyber-border rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyber-primary" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                    <textarea value={payNote} onChange={e => setPayNote(e.target.value)} rows={2}
                      placeholder="เช่น ชำระบางส่วน / โอนเข้าบัญชี xxx..."
                      className="w-full bg-cyber-darker border border-cyber-border rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyber-primary resize-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPayment(false)} className="px-3 py-2 text-gray-400 text-sm hover:text-white">ยกเลิก</button>
                    <button onClick={handleRecordPayment} disabled={saving}
                      className="flex-1 py-2 bg-cyber-green text-cyber-dark font-semibold rounded-lg text-sm hover:bg-cyber-green/80 disabled:opacity-50 flex items-center justify-center gap-1">
                      {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      ยืนยันรับเงิน
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="px-5 py-4 border-t border-cyber-border shrink-0 flex items-center gap-2">
            <button onClick={() => handlePrintInv('a4')} title="พิมพ์ใบแจ้งหนี้ A4"
              className="px-3 py-2 text-gray-400 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors flex items-center gap-1.5 text-sm">
              <Printer className="w-4 h-4" /> A4
            </button>
            <button onClick={() => handlePrintInv('thermal')} title="พิมพ์ Thermal"
              className="px-3 py-2 text-gray-500 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors text-sm flex items-center gap-1">
              <Printer className="w-3.5 h-3.5" /> 80mm
            </button>
            <div className="flex-1" />
            {isUnpaid && !showPayment && (
              <button onClick={() => setShowPayment(true)}
                className="px-5 py-2 bg-cyber-green text-cyber-dark font-semibold rounded-lg hover:bg-cyber-green/80 text-sm flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> บันทึกการรับเงิน
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>

    {/* Image Preview Lightbox */}
    {previewUrl && (
      <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
        <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-lg text-white hover:bg-white/20">
          <X className="w-5 h-5" />
        </button>
        <img src={previewUrl} alt="preview" className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
      </div>
    )}
    </>
  )
}

// ─── Create Credit Note Modal ─────────────────────────────────────────────────
function CreateCreditNoteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useModalClose(onClose)
  const [invoices, setInvoices] = useState<any[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [reason, setReason] = useState('')
  const [creditDate, setCreditDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/sales/invoices').then(({ data }) => {
      const list = (data.data || []).filter((inv: any) => inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID')
      setInvoices(list)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!invoiceId) { toast.error('กรุณาเลือกใบแจ้งหนี้'); return }
    if (!reason.trim()) { toast.error('กรุณาระบุเหตุผลการลดหนี้'); return }
    setSaving(true)
    try {
      await api.post('/sales/credit-notes', { invoiceId, reason, creditDate })
      toast.success('สร้างใบลดหนี้สำเร็จ')
      onSaved()
    } catch {
      toast.error('สร้างใบลดหนี้ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-orange-400" /> สร้างใบลดหนี้ (CN)
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">ใบแจ้งหนี้อ้างอิง *</label>
            <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cyber-primary">
              <option value="">-- เลือกใบแจ้งหนี้ --</option>
              {invoices.map((inv: any) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} · {inv.customer_name} · ฿{Number(inv.total_amount).toLocaleString('th-TH')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">วันที่ออกใบลดหนี้</label>
            <input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)}
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cyber-primary" />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">เหตุผลการลดหนี้ *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="เช่น สินค้าชำรุด, ส่งคืนสินค้า, ราคาผิดพลาด..."
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyber-primary resize-none" />
          </div>
        </div>

        <div className="p-5 border-t border-cyber-border shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 text-sm hover:text-white">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-orange-500 text-white font-semibold rounded-lg text-sm hover:bg-orange-400 disabled:opacity-50 flex items-center justify-center gap-1">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            สร้างใบลดหนี้
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Credit Note Detail Modal ─────────────────────────────────────────────────
function CreditNoteDetailModal({ creditNote, onClose, onRefresh, companyName }: {
  creditNote: CreditNote
  onClose: () => void
  onRefresh: () => void
  companyName?: string
}) {
  useModalClose(onClose)
  const [saving, setSaving] = useState(false)
  const fmt = (v: number) => `฿${Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
  const fmtD = (d: string) => d ? new Date(d).toLocaleDateString('th-TH') : '-'

  const handlePrint = () => {
    const co = getCachedCompanySettings()
    printSalesDoc('cn', { ...creditNote, _company: co.name || companyName || '-', _companyAddress: co.address || '', _companyTax: co.tax_id || '', _companyPhone: co.phone || '', _companyLogo: co.logo_base64 || '' }, 'a4')
  }

  const statusLabel: Record<string, string> = {
    DRAFT: 'ร่าง', ISSUED: 'ออกแล้ว', APPLIED: 'นำไปใช้แล้ว', CANCELLED: 'ยกเลิก',
  }
  const statusColor: Record<string, string> = {
    DRAFT: 'text-gray-400 bg-gray-400/10',
    ISSUED: 'text-blue-400 bg-blue-400/10',
    APPLIED: 'text-cyber-green bg-cyber-green/10',
    CANCELLED: 'text-red-400 bg-red-400/10',
  }

  const handleIssue = async () => {
    setSaving(true)
    try {
      await api.put(`/sales/credit-notes/${creditNote.id}/status`, { status: 'ISSUED' })
      toast.success('ยืนยันใบลดหนี้สำเร็จ')
      onRefresh()
      onClose()
    } catch {
      toast.error('ไม่สามารถยืนยันใบลดหนี้ได้')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white font-mono">{creditNote.cn_number}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{creditNote.customer_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[creditNote.status] || 'text-gray-400 bg-gray-400/10'}`}>
              {statusLabel[creditNote.status] || creditNote.status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-cyber-darker rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">ใบแจ้งหนี้อ้างอิง</p>
              <p className="text-white font-mono font-medium">{creditNote.invoice_number}</p>
            </div>
            <div className="bg-cyber-darker rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">วันที่ออก</p>
              <p className="text-white">{fmtD(creditNote.credit_date)}</p>
            </div>
          </div>

          <div className="bg-cyber-darker rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">เหตุผล</p>
            <p className="text-white text-sm">{creditNote.reason || '-'}</p>
          </div>

          <div className="bg-cyber-darker p-4 rounded-xl flex justify-between items-center">
            <span className="text-gray-300 text-sm font-semibold">ยอดลดหนี้</span>
            <span className="text-orange-400 font-bold text-lg">{fmt(creditNote.total_amount)}</span>
          </div>
        </div>

        <div className="p-5 border-t border-cyber-border shrink-0 flex gap-2">
          <button onClick={handlePrint} title="พิมพ์ใบลดหนี้ A4"
            className="px-2.5 py-2 text-gray-400 border border-cyber-border rounded-lg hover:text-white hover:border-gray-400 transition-colors">
            <Printer className="w-4 h-4" />
          </button>
          {creditNote.status === 'DRAFT' && (
            <button onClick={handleIssue} disabled={saving}
              className="flex-1 py-2 bg-orange-500 text-white font-semibold rounded-lg text-sm hover:bg-orange-400 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              ยืนยันใบลดหนี้
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Backorder Detail Modal ───────────────────────────────────────────────────
function BackorderDetailModal({ backorder, onClose, onRefresh }: {
  backorder: Backorder
  onClose: () => void
  onRefresh: () => void
}) {
  useModalClose(onClose)
  const [detail, setDetail] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get(`/sales/backorders/${backorder.id}`).then(({ data }) => {
      setDetail(data.data || data)
    }).catch(() => {})
  }, [backorder.id])

  const statusLabel: Record<string, string> = {
    PENDING: 'รอจัดส่ง', FULFILLED: 'จัดส่งแล้ว', CANCELLED: 'ยกเลิก',
  }
  const statusColor: Record<string, string> = {
    PENDING: 'text-yellow-400 bg-yellow-400/10',
    FULFILLED: 'text-cyber-green bg-cyber-green/10',
    CANCELLED: 'text-red-400 bg-red-400/10',
  }

  const handleFulfill = async () => {
    setSaving(true)
    try {
      await api.put(`/sales/backorders/${backorder.id}/status`, { status: 'FULFILLED' })
      toast.success('อัปเดตสถานะสำเร็จ')
      onRefresh()
      onClose()
    } catch {
      toast.error('ไม่สามารถอัปเดตสถานะได้')
    } finally {
      setSaving(false)
    }
  }

  const items: any[] = detail?.items || []

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white font-mono">{backorder.bo_number}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{backorder.customer_name} · SO: {backorder.so_number}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[backorder.status] || 'text-gray-400 bg-gray-400/10'}`}>
              {statusLabel[backorder.status] || backorder.status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cyber-dark text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {items.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-300">รายการค้างส่ง</p>
              {items.map((item: any, i: number) => (
                <div key={i} className="bg-cyber-darker rounded-lg p-3 text-sm">
                  <p className="text-white font-medium">{item.product_name || item.productName}</p>
                  <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
                    <span>สั่ง: <span className="text-white">{item.ordered_qty ?? item.quantity}</span></span>
                    <span>ส่งแล้ว: <span className="text-cyber-green">{item.delivered_qty ?? 0}</span></span>
                    <span>ค้าง: <span className="text-yellow-400">{item.remaining_qty ?? ((item.ordered_qty ?? item.quantity) - (item.delivered_qty ?? 0))}</span></span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              {detail === null ? 'กำลังโหลด...' : 'ไม่มีรายการ'}
            </div>
          )}
        </div>

        {backorder.status === 'PENDING' && (
          <div className="p-5 border-t border-cyber-border shrink-0">
            <button onClick={handleFulfill} disabled={saving}
              className="w-full py-2.5 bg-cyber-green text-cyber-dark font-semibold rounded-lg text-sm hover:bg-cyber-green/80 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Package className="w-4 h-4" />}
              ยืนยันจัดส่งครบแล้ว
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default Sales
