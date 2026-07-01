import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {FileText, ShoppingCart, Receipt, Plus, Search, CheckCircle, Clock, AlertCircle, DollarSign, TrendingUp, Package, RotateCcw, LayoutTemplate, LayoutList, LayoutGrid, ChevronRight, ArrowRight, X, Store, ShoppingBag, Ban, ChevronDown, ChevronUp, Banknote, QrCode, Printer, Upload, ImageIcon, Trash2, Eye, Pencil, AlertTriangle, Check} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import posService from '../services/pos.service'
import salesService, { type Customer, type Product } from '../services/sales.service'
import { stockService } from '../services/stock'
import { printSalesDoc } from '../utils/salesPrint'
import { getCachedCompanySettings } from '../services/companySettings.service'
import { normalizeUnit } from '../utils/unitNormalize'
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

interface DeliveryOrder {
  id: string
  do_number: string
  customer_name: string
  customer_code: string
  so_number: string
  delivery_date: string
  status: string
  driver_name?: string
  vehicle_plate?: string
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
  DRAFT:      { label: 'ฉบับร่าง',        bg: 'bg-gray-500/15',    text: 'text-[var(--fg-2)]' },
  SENT:       { label: 'ส่งแล้ว',          bg: 'bg-blue-500/15',    text: 'text-blue-300' },
  ACCEPTED:   { label: 'อนุมัติ',          bg: 'bg-[var(--success-soft)]',   text: 'text-green-300' },
  REJECTED:   { label: 'ปฏิเสธ',           bg: 'bg-[var(--danger-soft)]',     text: 'text-red-300' },
  EXPIRED:    { label: 'หมดอายุ',          bg: 'bg-gray-500/15',    text: 'text-[var(--fg-3)]' },
  CANCELLED:  { label: 'ยกเลิก',           bg: 'bg-[var(--danger-soft)]',     text: 'text-red-300' },
  CONFIRMED:  { label: 'ยืนยัน',           bg: 'bg-cyan-500/15',    text: 'text-cyan-300' },
  PROCESSING: { label: 'กำลังดำเนินการ',   bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
  READY:      { label: 'พร้อมส่ง',         bg: 'bg-purple-500/15',  text: 'text-purple-300' },
  DELIVERED:  { label: 'ส่งแล้ว',          bg: 'bg-indigo-500/15',  text: 'text-indigo-300' },
  COMPLETED:  { label: 'เสร็จสิ้น',        bg: 'bg-green-600/15',   text: 'text-green-300' },
  PARTIAL:    { label: 'ส่งบางส่วน',       bg: 'bg-orange-500/15',  text: 'text-orange-300' },
  ISSUED:     { label: 'ออกใบแล้ว',        bg: 'bg-blue-500/15',    text: 'text-blue-300' },
  PAID:       { label: 'ชำระแล้ว',         bg: 'bg-[var(--success-soft)]',   text: 'text-green-300' },
  UNPAID:     { label: 'ค้างชำระ',         bg: 'bg-[var(--danger-soft)]',     text: 'text-red-300' },
  OVERDUE:    { label: 'เกินกำหนด',        bg: 'bg-red-600/15',     text: 'text-danger' },
  PENDING:    { label: 'รอดำเนินการ',      bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
}

const StatusBadge = ({ status }: { status: string }) => {
  const cfg = STATUS_CONFIG[status] || { label: status, bg: 'bg-gray-500/15', text: 'text-[var(--fg-3)]' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

function ModalShell({ title, icon: Icon, iconColor = 'text-[var(--primary)]', onClose, children, footer }: {
  title: string; icon: any; iconColor?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode
}) {
  useModalClose(onClose)
  return (
  <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      onClick={e => e.stopPropagation()}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
      <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} /> {title}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto modal-scroll p-5 space-y-4">{children}</div>
      <div className="p-5 border-t border-[var(--border)] flex gap-3 shrink-0">{footer}</div>
    </motion.div>
  </div>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm text-[var(--fg-3)] mb-1.5">{label}</label>
    {children}
  </div>
)

// ── Reusable Journal Preview (outside main component) ────────────────────────
const JournalPreview = ({ entries }: { entries: { dr?: boolean; account: string; label: string; amount?: number }[] }) => (
  <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-1">
    <p className="text-xs text-warning font-medium mb-2">สมุดรายวัน (ระบบบันทึกอัตโนมัติ)</p>
    {entries.map((e, i) => (
      <div key={i} className={`flex items-center gap-2 text-xs ${e.dr ? '' : 'pl-6'}`}>
        <span className={`font-mono w-14 shrink-0 ${e.dr ? 'text-blue-400' : 'text-danger'}`}>{e.dr ? 'Dr.' : 'Cr.'}</span>
        <span className="text-[var(--fg-2)] flex-1">{e.account}</span>
        <span className="text-[var(--fg-3)]">{e.label}</span>
        {e.amount !== undefined && <span className="text-[var(--fg-1)] font-medium">฿{(e.amount).toLocaleString('th-TH')}</span>}
      </div>
    ))}
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────
const Sales = () => {
  const { tenant } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'quotations' | 'orders' | 'delivery-orders' | 'invoices' | 'credit-notes' | 'backorders' | 'templates' | 'pos-daily'>('overview')
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [backorders, setBackorders] = useState<Backorder[]>([])
  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([])
  const [templates, setTemplates] = useState<QuotationTemplate[]>([])
  const [, setPosDailySales] = useState<POSDailySales[]>([])
  const [posPendingBills, setPosPendingBills] = useState<POSPendingBill[]>([])
  const [posCurrentShift, setPosCurrentShift] = useState<POSShift | null | undefined>(undefined)
  const [posShifts, setPosShifts] = useState<POSShift[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)

  // POS shift modals
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [showCloseShift, setShowCloseShift] = useState(false)
  const [voidingBill, setVoidingBill] = useState<POSPendingBill | null>(null)

  // Sales modals
  const [showCreateQT, setShowCreateQT]     = useState(false)
  const [showCreateSO, setShowCreateSO]     = useState(false)
  const [showCreateCN, setShowCreateCN]     = useState(false)
  const [editQTData, setEditQTData]         = useState<any>(null)
  const [editSOData, setEditSOData]         = useState<any>(null)
  const [detailQT, setDetailQT]             = useState<Quotation | null>(null)
  const [detailSO, setDetailSO]             = useState<SalesOrder | null>(null)
  const [detailInv, setDetailInv]           = useState<Invoice | null>(null)
  const [detailCN, setDetailCN]             = useState<CreditNote | null>(null)
  const [detailBO, setDetailBO]             = useState<Backorder | null>(null)
  const [convertQT, setConvertQT]           = useState<Quotation | null>(null)  // QT → SO

  useEffect(() => {
    setCurrentPage(1)
    if (activeTab === 'overview') {
      fetchSummary()
    } else if (activeTab === 'quotations') {
      fetchQuotations()
    } else if (activeTab === 'orders') {
      fetchSalesOrders()
    } else if (activeTab === 'delivery-orders') {
      fetchDeliveryOrders()
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

  const fetchDeliveryOrders = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/sales/delivery-orders')
      if (data.success) setDeliveryOrders(data.data)
    } catch (error: any) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบส่งของได้')
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
  const handleCreateInvoiceFromSO = async (so: SalesOrder) => {
    try {
      await salesService.createInvoice(so.id)
      toast.success('สร้างใบแจ้งหนี้สำเร็จ')
      fetchInvoices()
      setActiveTab('invoices')
    } catch { toast.error('สร้างใบแจ้งหนี้ไม่สำเร็จ') }
  }
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
  const handleEditQT = async (q: Quotation) => {
    try {
      const r = await salesService.getQuotation(q.id)
      setEditQTData(r.data)
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ') }
  }
  const handleEditSO = async (so: SalesOrder) => {
    try {
      const r = await salesService.getSalesOrder(so.id)
      setEditSOData(r.data)
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ') }
  }
  const handleRecordPayment    = (invoice: Invoice) => setDetailInv(invoice)
  const handleConvertQtToSO    = (quotation: Quotation) => setConvertQT(quotation)

  // Inline status updates
  const handleUpdateQTStatus = async (id: string, status: string) => {
    try {
      await salesService.updateQuotationStatus(id, status)
      toast.success('อัปเดตสถานะสำเร็จ')
      fetchQuotations()
    } catch { toast.error('อัปเดตสถานะไม่สำเร็จ') }
  }
  const handleUpdateSOStatus = async (id: string, status: string) => {
    try {
      await salesService.updateSOStatus(id, status)
      toast.success('อัปเดตสถานะสำเร็จ')
      fetchSalesOrders()
    } catch (err: any) { toast.error(err?.response?.data?.message || 'อัปเดตสถานะไม่สำเร็จ') }
  }

  // Delete handlers
  const handleDeleteQuotation = async (id: string) => {
    if (!confirm('ต้องการลบใบเสนอราคานี้?')) return
    try {
      await api.delete(`/sales/quotations/${id}`)
      toast.success('ลบใบเสนอราคาสำเร็จ')
      fetchQuotations()
    } catch { toast.error('ไม่สามารถลบใบเสนอราคาได้') }
  }
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('ต้องการลบเทมเพลตนี้?')) return
    try {
      await api.delete(`/sales/quotation-templates/${id}`)
      toast.success('ลบเทมเพลตสำเร็จ')
      fetchTemplates()
    } catch { toast.error('ไม่สามารถลบเทมเพลตได้') }
  }
  const handleUpdateDOStatus = async (id: string, status: string) => {
    try {
      await api.put(`/sales/delivery-orders/${id}/status`, { status })
      toast.success('อัปเดตสถานะสำเร็จ')
      fetchDeliveryOrders()
    } catch { toast.error('อัปเดตสถานะไม่สำเร็จ') }
  }

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
    return result
  }

  const paginate = <T,>(items: T[]) => {
    return items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  }

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
          แสดง {Math.min((currentPage - 1) * pageSize + 1, total)}–{Math.min(currentPage * pageSize, total)} จาก {total} รายการ
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

  const PageSizeSelect = () => (
    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value) as 25|50|100); setCurrentPage(1) }}
      className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-2)] focus:outline-none focus:border-phopy-indigo">
      <option value={25}>25 / หน้า</option>
      <option value={50}>50 / หน้า</option>
      <option value={100}>100 / หน้า</option>
    </select>
  )

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
          { label: 'ยอดขายรวม',   value: formatCurrency(summary?.salesOrders.totalSales || 0), icon: TrendingUp,  color: 'text-[var(--primary)]', bg: 'bg-phopy-indigo/10',  border: 'border-phopy-indigo-50' },
          { label: 'คำสั่งขาย',   value: `${summary?.salesOrders.total || 0} รายการ`,          icon: ShoppingCart, color: 'text-purple-500',  bg: 'bg-purple-500/10',   border: 'border-purple-500/20' },
          { label: 'รับเงินวันนี้', value: formatCurrency(summary?.receipts.todayReceived || 0), icon: DollarSign,  color: 'text-success',   bg: 'bg-success/10',    border: 'border-success-soft' },
          { label: 'ยอดค้างรับ',   value: formatCurrency(summary?.invoices.outstanding || 0),   icon: AlertCircle, color: 'text-warning',    bg: 'bg-orange-500/10',     border: 'border-orange-500/20' },
        ].map((card, i) => (
          <motion.div key={card.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className={`rounded-xl p-5 border ${card.border} ${card.bg}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-[var(--fg-3)] mb-1">{card.label}</p>
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
          className="lg:col-span-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-warning" /> รายการรอดำเนินการ
          </h3>
          <div className="space-y-2">
            {[
              { label: 'ใบเสนอราคา (ร่าง/ส่งแล้ว)', count: summary?.salesOrders.draft || 0,          color: 'text-warning', tab: 'quotations' as const },
              { label: 'คำสั่งขายกำลังดำเนินการ',     count: summary?.salesOrders.processing || 0,    color: 'text-blue-400',   tab: 'orders' as const },
              { label: 'ใบแจ้งหนี้ค้างชำระ',          count: summary?.invoices.unpaid || 0,           color: 'text-danger',    tab: 'invoices' as const },
              { label: 'ส่งบางส่วน (Partial)',         count: summary?.salesOrders.partial || 0,       color: 'text-warning', tab: 'orders' as const },
              { label: 'รายการค้างส่ง',                count: summary?.backorders.pending || 0,        color: 'text-warning', tab: 'backorders' as const },
            ].map(item => (
              <button key={item.label} onClick={() => setActiveTab(item.tab)}
                className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-[var(--bg)]/60 transition-colors ${item.count > 0 ? 'border border-yellow-500/20 bg-yellow-500/5' : 'bg-[var(--bg)]/30'}`}>
                <span className="text-sm text-[var(--fg-2)]">{item.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-semibold ${item.count > 0 ? item.color : 'text-[var(--fg-4)]'}`}>{item.count}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-4)]" />
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Sales workflow pipeline */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--fg-1)] mb-4 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-[var(--primary)]" /> กระบวนการขาย
          </h3>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { label: 'ใบเสนอราคา', sub: `${summary?.salesOrders.total || 0} รายการ`, icon: FileText,   color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-info/30',   tab: 'quotations' as const },
              { label: 'คำสั่งขาย',  sub: `${summary?.salesOrders.total || 0} รายการ`, icon: ShoppingCart, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', tab: 'orders' as const },
              { label: 'ใบแจ้งหนี้', sub: `${summary?.invoices.total || 0} รายการ`,    icon: Receipt,    color: 'text-warning', bg: 'bg-[var(--warning-soft)]', border: 'border-warning/30', tab: 'invoices' as const },
              { label: 'รับชำระ',    sub: `${summary?.invoices.paid || 0} ชำระแล้ว`,   icon: DollarSign, color: 'text-success',  bg: 'bg-[var(--success-soft)]',  border: 'border-green-500/30',  tab: 'invoices' as const },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-1 flex-1 min-w-[100px]">
                <button onClick={() => setActiveTab(step.tab)}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border ${step.bg} ${step.border} hover:brightness-110 transition-all`}>
                  <step.icon className={`w-5 h-5 ${step.color}`} />
                  <span className="text-xs font-medium text-[var(--fg-1)]">{step.label}</span>
                  <span className="text-xs text-[var(--fg-4)]">{step.sub}</span>
                </button>
                {i < 3 && <ArrowRight className="w-4 h-4 text-[var(--fg-4)] shrink-0" />}
              </div>
            ))}
          </div>

          {/* Invoice payment breakdown */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: 'ค้างชำระ',    value: summary?.invoices.unpaid || 0,   color: 'text-danger' },
              { label: 'ชำระบางส่วน', value: summary?.invoices.partial || 0,  color: 'text-warning' },
              { label: 'ชำระครบแล้ว', value: summary?.invoices.paid || 0,     color: 'text-success' },
            ].map(item => (
              <div key={item.label} className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">{item.label}</p>
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-3)]" />
            <input type="text" placeholder={placeholder} value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder-gray-500 focus:outline-none focus:border-phopy-indigo w-52 text-sm" />
          </div>
          {/* Date range */}
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            <span className="text-[var(--fg-4)] text-xs">ถึง</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-[var(--fg-4)] hover:text-danger text-xs px-1.5 py-1 rounded">ล้าง</button>
            )}
          </div>
          {/* Limit */}
          <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-1 py-1">
            {([25, 50, 100] as const).map(n => (
              <button key={n} onClick={() => setListLimit(n)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${listLimit === n ? 'bg-phopy-indigo text-white' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
                {n}
              </button>
            ))}
          </div>
          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-1">
            <button onClick={() => setViewMode('list')} title="มุมมองรายการ"
              className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-phopy-indigo text-white' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('card')} title="มุมมองการ์ด"
              className={`p-1 rounded transition-colors ${viewMode === 'card' ? 'bg-phopy-indigo text-white' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
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
    const filtered = filterItems(quotations, ['quotation_number', 'customer_name'], 'quotation_date')
    const items = paginate(filtered)
    const qtNextStatus: Record<string, { status: string; label: string; color: string }> = {
      DRAFT: { status: 'SENT', label: 'ส่งใบเสนอราคา', color: 'text-blue-400 bg-blue-500/10 hover:bg-[var(--info-soft)]' },
      SENT:  { status: 'ACCEPTED', label: 'อนุมัติ', color: 'text-success bg-success/10 hover:bg-[var(--success-soft)]' },
    }
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบเสนอราคา..." action={
          <>
            <PageSizeSelect />
            <button onClick={() => setActiveTab('templates')}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-phopy-indigo text-sm">
              <LayoutTemplate className="w-4 h-4" /> เทมเพลต
            </button>
            <button onClick={handleCreateQuotation}
              className="flex items-center gap-1.5 px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm">
              <Plus className="w-4 h-4" /> สร้างใบเสนอราคา
            </button>
          </>
        } />

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--fg-4)]"><FileText className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>ไม่พบใบเสนอราคา</p></div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">วันที่</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">หมดอายุ</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">ยอดรวม</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(q => {
                  const next = qtNextStatus[q.status]
                  return (
                  <tr key={q.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-[var(--primary)]">{q.quotation_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--fg-1)] font-medium">{q.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{q.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-3)] text-xs hidden sm:table-cell">{formatDate(q.quotation_date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-medium ${q.expiry_date && new Date(q.expiry_date) < new Date() ? 'text-danger' : 'text-[var(--fg-3)]'}`}>
                        {formatDate(q.expiry_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--fg-1)]">{formatCurrency(q.total_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => handleViewDetail(q, 'ใบเสนอราคา')}
                          className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                        {['DRAFT', 'SENT'].includes(q.status) && (
                          <button onClick={() => handleEditQT(q)}
                            className="px-2 py-1 text-xs text-warning bg-[var(--warning-soft)] rounded-lg flex items-center gap-1" title="แก้ไข">
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {next && (
                          <button onClick={() => handleUpdateQTStatus(q.id, next.status)}
                            className={`px-2 py-1 text-xs rounded-lg flex items-center gap-1 ${next.color}`}>
                            <CheckCircle className="w-3 h-3" /> {next.label}
                          </button>
                        )}
                        {q.status === 'ACCEPTED' && (
                          <button onClick={() => handleConvertQtToSO(q)}
                            className="px-2.5 py-1 text-xs text-[var(--primary)] bg-phopy-indigo/10 rounded-lg hover:bg-[var(--primary-soft)] flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" /> SO
                          </button>
                        )}
                        {q.status === 'DRAFT' && (
                          <button onClick={() => handleDeleteQuotation(q.id)}
                            className="px-2 py-1 text-xs text-danger bg-[var(--danger-soft)] rounded-lg hover:bg-[var(--danger-soft)]">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            <Pagination total={filtered.length} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((q, i) => {
              const isExpired = q.expiry_date && new Date(q.expiry_date) < new Date()
              const next = qtNextStatus[q.status]
              return (
                <motion.div key={q.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-phopy-indigo/50 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--primary)]">{q.quotation_number}</p>
                      <p className="text-[var(--fg-1)] font-medium mt-0.5">{q.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{q.customer_code}</p>
                    </div>
                    <StatusBadge status={q.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--fg-3)] mb-3">
                    <span>วันที่: <span className="text-[var(--fg-2)]">{formatDate(q.quotation_date)}</span></span>
                    <span>หมดอายุ: <span className={isExpired ? 'text-danger font-medium' : 'text-[var(--fg-2)]'}>{formatDate(q.expiry_date)}</span></span>
                    <span>{q.item_count} รายการ</span>
                    <span className="text-right font-semibold text-[var(--fg-1)]">{formatCurrency(q.total_amount)}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-[var(--border)]/50">
                    <button onClick={() => handleViewDetail(q, 'ใบเสนอราคา')}
                      className="flex-1 py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
                      ดูรายละเอียด
                    </button>
                    {['DRAFT', 'SENT'].includes(q.status) && (
                      <button onClick={() => handleEditQT(q)}
                        className="px-3 py-1.5 text-xs text-warning bg-[var(--warning-soft)] rounded-lg flex items-center gap-1" title="แก้ไข">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {next && (
                      <button onClick={() => handleUpdateQTStatus(q.id, next.status)}
                        className={`flex-1 py-1.5 text-xs rounded-lg flex items-center justify-center gap-1 ${next.color}`}>
                        <CheckCircle className="w-3 h-3" /> {next.label}
                      </button>
                    )}
                    {q.status === 'ACCEPTED' && (
                      <button onClick={() => handleConvertQtToSO(q)}
                        className="flex-1 py-1.5 text-xs font-medium text-[var(--primary)] bg-phopy-indigo/10 rounded-lg hover:bg-[var(--primary-soft)] flex items-center justify-center gap-1">
                        <ArrowRight className="w-3 h-3" /> แปลง SO
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
            <Pagination total={filtered.length} />
          </div>
        )}
      </div>
    )
  }

  // ── Sales Orders ───────────────────────────────────────────────────────────
  const SO_DELIVERY_STEPS = [
    { status: 'DRAFT',      label: 'ฉบับร่าง',        color: 'text-[var(--fg-3)]' },
    { status: 'CONFIRMED',  label: 'ยืนยันแล้ว',       color: 'text-blue-400' },
    { status: 'PROCESSING', label: 'กำลังเตรียม',      color: 'text-warning' },
    { status: 'READY',      label: 'พร้อมส่ง',          color: 'text-purple-400' },
    { status: 'DELIVERED',  label: 'ส่งแล้ว',           color: 'text-success' },
    { status: 'COMPLETED',  label: 'เสร็จสิ้น',         color: 'text-success' },
  ]

  const OrdersContent = () => {
    const [filterStatus, setFilterStatus] = useState<string>('')
    const filtered = filterItems(salesOrders, ['so_number', 'customer_name'], 'order_date')
      .filter(o => !filterStatus || o.status === filterStatus)
    const items = paginate(filtered)
    const soNextStatus: Record<string, { status: string; label: string; color: string }> = {
      DRAFT:      { status: 'CONFIRMED',  label: 'ยืนยัน',       color: 'text-blue-400 bg-blue-500/10 hover:bg-[var(--info-soft)]' },
      CONFIRMED:  { status: 'PROCESSING', label: 'เตรียมสินค้า', color: 'text-warning bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]' },
      PROCESSING: { status: 'READY',      label: 'พร้อมส่ง',     color: 'text-purple-400 bg-purple-500/10 hover:bg-purple-500/20' },
      READY:      { status: 'DELIVERED',  label: 'ส่งของแล้ว',  color: 'text-success bg-success/10 hover:bg-[var(--success-soft)]' },
      DELIVERED:  { status: 'COMPLETED',  label: 'เสร็จสิ้น',   color: 'text-success bg-success/10 hover:bg-[var(--success-soft)]' },
    }

    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาคำสั่งขาย..." action={
          <>
            <PageSizeSelect />
            <button onClick={handleCreateSalesOrder}
              className="flex items-center gap-1.5 px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm">
              <Plus className="w-4 h-4" /> สร้างคำสั่งขาย
            </button>
          </>
        } />

        {/* Delivery status filter pills */}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${!filterStatus ? 'bg-phopy-indigo text-white border-phopy-indigo' : 'border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
            ทั้งหมด
          </button>
          {SO_DELIVERY_STEPS.map(s => (
            <button key={s.status} onClick={() => setFilterStatus(s.status === filterStatus ? '' : s.status)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterStatus === s.status ? 'bg-[var(--bg)] border-phopy-indigo text-[var(--fg-1)]' : 'border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--fg-4)]"><ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>ไม่พบคำสั่งขาย</p></div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
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
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(order => {
                  const step = SO_DELIVERY_STEPS.find(s => s.status === order.status)
                  const stepIdx = SO_DELIVERY_STEPS.findIndex(s => s.status === order.status)
                  const isLate = order.delivery_date && new Date(order.delivery_date) < new Date() && order.status !== 'DELIVERED' && order.status !== 'COMPLETED'
                  const next = soNextStatus[order.status]
                  return (
                    <tr key={order.id} className="hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-purple-400">{order.so_number}</p>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {order.quotation_number && (
                            <span className="text-[10px] text-[var(--fg-4)] bg-gray-500/10 px-1.5 py-0.5 rounded">QT: {order.quotation_number}</span>
                          )}
                          {(() => {
                            const doAll = deliveryOrders.filter(d => d.so_number === order.so_number)
                            const doDraft = doAll.filter(d => d.status === 'DRAFT')
                            const doShipped = doAll.filter(d => d.status === 'SHIPPED')
                            return (<>
                              {doShipped.length > 0 && (
                                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">DO ×{doShipped.length}</span>
                              )}
                              {doDraft.length > 0 && (
                                <span className="text-[10px] text-warning bg-[var(--warning-soft)] px-1.5 py-0.5 rounded">DO ร่าง ×{doDraft.length}</span>
                              )}
                            </>)
                          })()}
                          {(() => { const invCount = invoices.filter(i => i.so_number === order.so_number).length; return invCount > 0 ? (
                            <span className="text-[10px] text-[var(--primary)] bg-phopy-indigo/10 px-1.5 py-0.5 rounded">INV ×{invCount}</span>
                          ) : null })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--fg-1)] font-medium">{order.customer_name}</p>
                        <p className="text-xs text-[var(--fg-4)]">{order.customer_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden sm:table-cell">{formatDate(order.order_date)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`text-xs font-medium ${isLate ? 'text-danger' : 'text-[var(--fg-3)]'}`}>
                          {formatDate(order.delivery_date)}{isLate ? <AlertTriangle className="w-3 h-3 inline" /> : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-0.5 justify-center">
                          {SO_DELIVERY_STEPS.slice(0, 5).map((s, i) => (
                            <div key={s.status} className={`h-1.5 rounded-full flex-1 ${i <= stepIdx ? 'bg-phopy-indigo' : 'bg-[var(--border)]'}`} style={{ minWidth: 12 }} />
                          ))}
                        </div>
                        <p className={`text-xs text-center mt-1 font-medium ${step?.color || 'text-[var(--fg-3)]'}`}>{step?.label}</p>
                        {(order.pending_qty ?? 0) > 0 && (
                          <p className="text-xs text-center text-warning">ค้างส่ง {order.pending_qty}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        <StatusBadge status={order.payment_status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[var(--fg-1)]">{formatCurrency(order.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                            className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                          {order.status === 'DRAFT' && (
                            <button onClick={() => handleEditSO(order)}
                              className="px-2 py-1 text-xs text-warning bg-[var(--warning-soft)] rounded-lg flex items-center gap-1" title="แก้ไข">
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {next && (
                            <button onClick={() => handleUpdateSOStatus(order.id, next.status)}
                              className={`px-2 py-1 text-xs rounded-lg flex items-center gap-1 ${next.color}`}>
                              <CheckCircle className="w-3 h-3" /> {next.label}
                            </button>
                          )}
                          {['CONFIRMED','PROCESSING','READY','DELIVERED','COMPLETED'].includes(order.status) && (
                            <button onClick={() => handleCreateInvoiceFromSO(order)}
                              className="px-2 py-1 text-xs text-warning bg-[var(--warning-soft)] rounded-lg hover:bg-[var(--warning-soft)] flex items-center gap-1">
                              <Receipt className="w-3 h-3" /> INV
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination total={filtered.length} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((order, i) => {
              const step = SO_DELIVERY_STEPS.find(s => s.status === order.status)
              const stepIdx = SO_DELIVERY_STEPS.findIndex(s => s.status === order.status)
              const isLate = order.delivery_date && new Date(order.delivery_date) < new Date() && order.status !== 'DELIVERED' && order.status !== 'COMPLETED'
              const next = soNextStatus[order.status]
              return (
                <motion.div key={order.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-purple-500/40 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-purple-400">{order.so_number}</p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {order.quotation_number && (
                          <span className="text-[10px] text-[var(--fg-4)] bg-gray-500/10 px-1.5 py-0.5 rounded">QT: {order.quotation_number}</span>
                        )}
                        {(() => {
                          const doAll = deliveryOrders.filter(d => d.so_number === order.so_number)
                          const doDraft = doAll.filter(d => d.status === 'DRAFT')
                          const doShipped = doAll.filter(d => d.status === 'SHIPPED')
                          return (<>
                            {doShipped.length > 0 && (
                              <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">DO ×{doShipped.length}</span>
                            )}
                            {doDraft.length > 0 && (
                              <span className="text-[10px] text-warning bg-[var(--warning-soft)] px-1.5 py-0.5 rounded">DO ร่าง ×{doDraft.length}</span>
                            )}
                          </>)
                        })()}
                        {(() => { const invCount = invoices.filter(i => i.so_number === order.so_number).length; return invCount > 0 ? (
                          <span className="text-[10px] text-[var(--primary)] bg-phopy-indigo/10 px-1.5 py-0.5 rounded">INV ×{invCount}</span>
                        ) : null })()}
                      </div>
                      <p className="text-[var(--fg-1)] font-medium mt-0.5">{order.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{order.customer_code}</p>
                    </div>
                    <StatusBadge status={order.payment_status} />
                  </div>
                  {/* Delivery progress bar */}
                  <div className="flex items-center gap-0.5 my-2">
                    {SO_DELIVERY_STEPS.slice(0, 5).map((s, idx) => (
                      <div key={s.status} className={`h-1.5 rounded-full flex-1 ${idx <= stepIdx ? 'bg-phopy-indigo' : 'bg-[var(--border)]'}`} />
                    ))}
                  </div>
                  <p className={`text-xs font-medium mb-2 ${step?.color || 'text-[var(--fg-3)]'}`}>{step?.label}{(order.pending_qty ?? 0) > 0 ? ` · ค้างส่ง ${order.pending_qty}` : ''}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--fg-3)] mb-3">
                    <span>วันสั่ง: <span className="text-[var(--fg-2)]">{formatDate(order.order_date)}</span></span>
                    <span>กำหนดส่ง: <span className={isLate ? 'text-danger font-medium' : 'text-[var(--fg-2)]'}>{formatDate(order.delivery_date)}{isLate ? <AlertTriangle className="w-3 h-3 inline" /> : ''}</span></span>
                    <span>{order.item_count} รายการ</span>
                    <span className="text-right font-semibold text-[var(--fg-1)]">{formatCurrency(order.total_amount)}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-[var(--border)]/50">
                    <button onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                      className="flex-1 py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
                      ดูรายละเอียด
                    </button>
                    {order.status === 'DRAFT' && (
                      <button onClick={() => handleEditSO(order)}
                        className="px-3 py-1.5 text-xs text-warning bg-[var(--warning-soft)] rounded-lg flex items-center gap-1" title="แก้ไข">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {next && (
                      <button onClick={() => handleUpdateSOStatus(order.id, next.status)}
                        className={`flex-1 py-1.5 text-xs rounded-lg flex items-center justify-center gap-1 ${next.color}`}>
                        <CheckCircle className="w-3 h-3" /> {next.label}
                      </button>
                    )}
                    {['CONFIRMED','PROCESSING','READY','DELIVERED','COMPLETED'].includes(order.status) && (
                      <button onClick={() => handleCreateInvoiceFromSO(order)}
                        className="flex-1 py-1.5 text-xs text-warning bg-[var(--warning-soft)] rounded-lg hover:bg-[var(--warning-soft)] flex items-center justify-center gap-1">
                        <Receipt className="w-3 h-3" /> ออก INV
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
            <Pagination total={filtered.length} />
          </div>
        )}
      </div>
    )
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  const InvoicesContent = () => {
    const filtered = filterItems(invoices, ['invoice_number', 'customer_name'], 'invoice_date')
    const items = paginate(filtered)
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบแจ้งหนี้..." action={
          <>
            <PageSizeSelect />
            <button onClick={handleCreateInvoice}
              className="flex items-center gap-1.5 px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm">
              <Plus className="w-4 h-4" /> สร้างใบแจ้งหนี้
            </button>
          </>
        } />

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--fg-4)]">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบแจ้งหนี้</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
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
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(inv => {
                  const isOverdue = inv.payment_status === 'OVERDUE'
                  const isUnpaid = inv.payment_status === 'UNPAID' || isOverdue
                  return (
                    <tr key={inv.id} className={`hover:bg-[var(--surface-2)] transition-colors ${isOverdue ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-warning">{inv.invoice_number}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--fg-1)] font-medium">{inv.customer_name}</p>
                        <p className="text-xs text-[var(--fg-4)]">{inv.customer_code}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {inv.so_number && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">{inv.so_number}</span>
                            {(() => {
                              const so = salesOrders.find(s => s.so_number === inv.so_number)
                              return so?.quotation_number ? (
                                <span className="text-[10px] text-[var(--fg-4)] bg-gray-500/10 px-1.5 py-0.5 rounded">{so.quotation_number}</span>
                              ) : null
                            })()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden md:table-cell">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`text-xs font-medium ${isOverdue ? 'text-danger' : 'text-[var(--fg-3)]'}`}>
                          {formatDate(inv.due_date)}{isOverdue ? <AlertTriangle className="w-3 h-3 inline" /> : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={inv.payment_status} /></td>
                      <td className="px-4 py-3 text-right font-semibold text-[var(--fg-1)]">{formatCurrency(inv.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-semibold ${inv.balance_amount > 0 ? 'text-danger' : 'text-success'}`}>
                          {formatCurrency(inv.balance_amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => handleViewDetail(inv, 'ใบแจ้งหนี้')}
                            className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                          {isUnpaid && (
                            <button onClick={() => handleRecordPayment(inv)}
                              className="px-2.5 py-1 text-xs font-medium text-success bg-success/10 rounded-lg hover:bg-[var(--success-soft)] flex items-center gap-1">
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
            <Pagination total={filtered.length} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((inv, i) => {
              const isOverdue = inv.payment_status === 'OVERDUE'
              const isUnpaid  = inv.payment_status === 'UNPAID' || isOverdue
              return (
                <motion.div key={inv.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className={`bg-[var(--surface)] border rounded-xl p-4 hover:brightness-105 transition-all ${isOverdue ? 'border-danger/40' : 'border-[var(--border)] hover:border-phopy-indigo/50'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-warning">{inv.invoice_number}</p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {inv.so_number && (
                          <>
                            <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">{inv.so_number}</span>
                            {(() => {
                              const so = salesOrders.find(s => s.so_number === inv.so_number)
                              return so?.quotation_number ? (
                                <span className="text-[10px] text-[var(--fg-4)] bg-gray-500/10 px-1.5 py-0.5 rounded">{so.quotation_number}</span>
                              ) : null
                            })()}
                          </>
                        )}
                      </div>
                      <p className="text-[var(--fg-1)] font-medium mt-0.5">{inv.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{inv.customer_code}</p>
                    </div>
                    <StatusBadge status={inv.payment_status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--fg-3)] mb-3">
                    <span>วันที่: <span className="text-[var(--fg-2)]">{formatDate(inv.invoice_date)}</span></span>
                    <span>ครบกำหนด: <span className={isOverdue ? 'text-danger font-medium' : 'text-[var(--fg-2)]'}>{formatDate(inv.due_date)}</span></span>
                    <span>ยอดรวม: <span className="text-[var(--fg-1)] font-medium">{formatCurrency(inv.total_amount)}</span></span>
                    <span className="text-right">
                      คงค้าง: <span className={inv.balance_amount > 0 ? 'text-danger font-semibold' : 'text-success font-semibold'}>
                        {formatCurrency(inv.balance_amount)}
                      </span>
                    </span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-[var(--border)]/50">
                    <button onClick={() => handleViewDetail(inv, 'ใบแจ้งหนี้')}
                      className="flex-1 py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
                      ดูรายละเอียด
                    </button>
                    {isUnpaid && (
                      <button onClick={() => handleRecordPayment(inv)}
                        className="flex-1 py-1.5 text-xs font-medium text-success bg-success/10 rounded-lg hover:bg-[var(--success-soft)] transition-colors flex items-center justify-center gap-1">
                        <DollarSign className="w-3 h-3" /> รับเงิน
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
            <Pagination total={filtered.length} />
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
          <div className="text-center py-16 text-[var(--fg-4)]">
            <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบลดหนี้</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
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
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(cn => (
                  <tr key={cn.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-danger">{cn.cn_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--fg-1)] font-medium">{cn.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{cn.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden sm:table-cell">{cn.invoice_number}</td>
                    <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden md:table-cell">{formatDate(cn.credit_date)}</td>
                    <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden md:table-cell max-w-[160px] truncate">{cn.reason}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={cn.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-danger">-{formatCurrency(cn.total_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleViewDetail(cn, 'ใบลดหนี้')}
                        className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-[var(--border)]/50 text-xs text-[var(--fg-4)]">
              แสดง {items.length} รายการ
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((cn, i) => (
              <motion.div key={cn.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-danger/40 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-danger">{cn.cn_number}</p>
                    <p className="text-xs text-[var(--fg-4)]">INV: {cn.invoice_number}</p>
                    <p className="text-[var(--fg-1)] font-medium mt-0.5">{cn.customer_name}</p>
                    <p className="text-xs text-[var(--fg-4)]">{cn.customer_code}</p>
                  </div>
                  <StatusBadge status={cn.status} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--fg-3)] mb-3">
                  <span>วันที่: <span className="text-[var(--fg-2)]">{formatDate(cn.credit_date)}</span></span>
                  <span className="text-right font-semibold text-danger">-{formatCurrency(cn.total_amount)}</span>
                  <span className="col-span-2 text-[var(--fg-3)]">เหตุผล: {cn.reason}</span>
                </div>
                <div className="pt-3 border-t border-[var(--border)]/50">
                  <button onClick={() => handleViewDetail(cn, 'ใบลดหนี้')}
                    className="w-full py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
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
          <div className="text-center py-16 text-[var(--fg-4)]">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ไม่พบใบค้างส่ง</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">SO</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">ใบส่งของต้นฉบับ</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(bo => (
                  <tr key={bo.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-warning">{bo.bo_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--fg-1)] font-medium">{bo.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{bo.customer_code}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden sm:table-cell">{bo.so_number}</td>
                    <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden md:table-cell">{bo.original_do || '-'}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={bo.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleViewDetail(bo, 'ใบค้างส่ง')}
                        className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-[var(--border)]/50 text-xs text-[var(--fg-4)]">
              แสดง {items.length} รายการ
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((bo, i) => (
              <motion.div key={bo.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-orange-500/40 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-warning">{bo.bo_number}</p>
                    <p className="text-xs text-[var(--fg-4)]">SO: {bo.so_number}</p>
                    <p className="text-[var(--fg-1)] font-medium mt-0.5">{bo.customer_name}</p>
                    <p className="text-xs text-[var(--fg-4)]">{bo.customer_code}</p>
                  </div>
                  <StatusBadge status={bo.status} />
                </div>
                {bo.original_do && (
                  <p className="text-xs text-[var(--fg-3)] mb-3">ใบส่งของต้นฉบับ: <span className="text-[var(--fg-2)]">{bo.original_do}</span></p>
                )}
                <div className="pt-3 border-t border-[var(--border)]/50">
                  <button onClick={() => handleViewDetail(bo, 'ใบค้างส่ง')}
                    className="w-full py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
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

  // ── Delivery Orders ────────────────────────────────────────────────────────
  const DeliveryOrdersContent = () => {
    const filtered = filterItems(deliveryOrders, ['do_number', 'customer_name'], 'delivery_date')
    const items = paginate(filtered)
    const doNextStatus: Record<string, { status: string; label: string; color: string }> = {
      DRAFT: { status: 'READY',    label: 'พร้อมส่ง',   color: 'text-purple-400 bg-purple-500/10 hover:bg-purple-500/20' },
      READY: { status: 'SHIPPED',  label: 'ส่งแล้ว',    color: 'text-blue-400 bg-blue-500/10 hover:bg-[var(--info-soft)]' },
    }
    return (
      <div className="space-y-3">
        <ListToolbar placeholder="ค้นหาใบส่งของ..." action={
          <>
            <PageSizeSelect />
            <button onClick={() => toast('สร้างใบส่งของจากคำสั่งขาย')}
              className="flex items-center gap-1.5 px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm">
              <Plus className="w-4 h-4" /> สร้างใบส่งของ
            </button>
          </>
        } />

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--fg-4)]"><Package className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>ไม่พบใบส่งของ</p></div>
        ) : viewMode === 'list' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--fg-3)]">
                  <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                  <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">SO</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">วันส่ง</th>
                  <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                  <th className="text-right px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/50">
                {items.map(do_ => {
                  const next = doNextStatus[do_.status]
                  return (
                    <tr key={do_.id} className="hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-blue-400">{do_.do_number}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--fg-1)] font-medium">{do_.customer_name}</p>
                        <p className="text-xs text-[var(--fg-4)]">{do_.customer_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden sm:table-cell">{do_.so_number}</td>
                      <td className="px-4 py-3 text-xs text-[var(--fg-3)] hidden md:table-cell">{formatDate(do_.delivery_date)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={do_.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => handleViewDetail(do_, 'ใบส่งของ')}
                            className="px-2.5 py-1 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)]">ดู</button>
                          {next && (
                            <button onClick={() => handleUpdateDOStatus(do_.id, next.status)}
                              className={`px-2 py-1 text-xs rounded-lg flex items-center gap-1 ${next.color}`}>
                              <CheckCircle className="w-3 h-3" /> {next.label}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination total={filtered.length} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((do_, i) => {
              const next = doNextStatus[do_.status]
              return (
                <motion.div key={do_.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-blue-500/40 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-blue-400">{do_.do_number}</p>
                      <p className="text-xs text-[var(--fg-4)]">SO: {do_.so_number}</p>
                      <p className="text-[var(--fg-1)] font-medium mt-0.5">{do_.customer_name}</p>
                      <p className="text-xs text-[var(--fg-4)]">{do_.customer_code}</p>
                    </div>
                    <StatusBadge status={do_.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--fg-3)] mb-3">
                    <span>วันส่ง: <span className="text-[var(--fg-2)]">{formatDate(do_.delivery_date)}</span></span>
                    <span className="text-right">{do_.driver_name || '-'}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-[var(--border)]/50">
                    <button onClick={() => handleViewDetail(do_, 'ใบส่งของ')}
                      className="flex-1 py-1.5 text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-lg hover:text-[var(--fg-1)] transition-colors">
                      ดูรายละเอียด
                    </button>
                    {next && (
                      <button onClick={() => handleUpdateDOStatus(do_.id, next.status)}
                        className={`flex-1 py-1.5 text-xs rounded-lg flex items-center justify-center gap-1 ${next.color}`}>
                        <CheckCircle className="w-3 h-3" /> {next.label}
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
            <Pagination total={filtered.length} />
          </div>
        )}
      </div>
    )
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  const TemplatesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-[var(--fg-1)]">เทมเพลตใบเสนอราคา</h2>
        <button onClick={handleCreateTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm transition-colors">
          <Plus className="w-4 h-4" /> สร้างเทมเพลต
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template, i) => (
          <motion.div key={template.id}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5 hover:border-phopy-indigo/50 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-[var(--primary-soft)] rounded-lg">
                <LayoutTemplate className="w-5 h-5 text-[var(--primary)]" />
              </div>
              {template.is_default === 1 && (
                <span className="px-2 py-0.5 bg-[var(--success-soft)] text-success text-xs rounded-full">ค่าเริ่มต้น</span>
              )}
            </div>
            <h3 className="text-base font-semibold text-[var(--fg-1)] mb-1">{template.name}</h3>
            <p className="text-sm text-[var(--fg-3)] mb-3">{template.description || 'ไม่มีคำอธิบาย'}</p>
            <div className="flex justify-between text-xs text-[var(--fg-4)] mb-4">
              <span>{template.item_count} รายการ</span>
              <span>หมดอายุ {template.expiration_days} วัน</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toast('แก้ไขเทมเพลต: กำลังพัฒนา')}
                className="flex-1 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:border-phopy-indigo text-sm transition-colors">
                แก้ไข
              </button>
              <button onClick={() => toast('ใช้เทมเพลต: ' + template.name)}
                className="flex-1 py-2 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 text-sm transition-colors">
                ใช้เทมเพลต
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )

  // ── Tab definitions ────────────────────────────────────────────────────────
  const pendingDeliveryOrders = deliveryOrders.filter(d => d.status === 'DRAFT' || d.status === 'READY').length

  const tabs = [
    { id: 'overview',        label: 'ภาพรวม',       icon: TrendingUp,     badge: 0 },
    { id: 'quotations',      label: 'ใบเสนอราคา',   icon: FileText,       badge: pendingQuotations },
    { id: 'orders',          label: 'คำสั่งขาย',    icon: ShoppingCart,   badge: pendingOrders },
    { id: 'delivery-orders', label: 'ใบส่งของ',    icon: Package,        badge: pendingDeliveryOrders },
    { id: 'invoices',        label: 'ใบแจ้งหนี้',   icon: Receipt,        badge: pendingInvoices },
    { id: 'credit-notes',    label: 'ใบลดหนี้',     icon: RotateCcw,      badge: 0 },
    { id: 'backorders',      label: 'ค้างส่ง',       icon: Package,        badge: pendingBackorders },
    { id: 'templates',       label: 'เทมเพลต',       icon: LayoutTemplate, badge: 0 },
    { id: 'pos-daily',       label: 'POS กะขาย',    icon: Store,          badge: 0 },
  ]

  // ── POS components (fully functional — keep intact) ────────────────────────
  const PendingBillsPanel = ({ bills, onVoid }: { bills: POSPendingBill[]; onVoid: (b: POSPendingBill) => void }) => {
    const [expanded, setExpanded] = useState(false)
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <button onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--bg)]/30">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[var(--primary)]" />
            <span className="text-sm font-medium text-[var(--fg-1)]">บิลในกะนี้</span>
            <span className="text-xs text-[var(--fg-4)]">{bills.length} บิล</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--primary)]">
              {fmt(bills.reduce((s, b) => s + b.total_amount, 0))}
            </span>
            {expanded ? <ChevronUp className="w-4 h-4 text-[var(--fg-4)]" /> : <ChevronDown className="w-4 h-4 text-[var(--fg-4)]" />}
          </div>
        </button>
        {expanded && (
          <div className="divide-y divide-[var(--border)]/50">
            {bills.map(bill => (
              <div key={bill.id} className="px-5 py-3 flex items-center justify-between bg-[var(--bg)]/20">
                <div>
                  <div className="flex items-center gap-2">
                    {bill.payment_method === 'CASH'
                      ? <Banknote className="w-3 h-3 text-warning" />
                      : <QrCode className="w-3 h-3 text-blue-400" />}
                    <span className="text-sm text-[var(--fg-1)]">{bill.bill_number}</span>
                  </div>
                  <p className="text-xs text-[var(--fg-4)] mt-0.5">
                    {bill.display_name} · {fmtDT(bill.closed_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--fg-1)]">{fmt(bill.total_amount)}</span>
                  <button onClick={() => onVoid(bill)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-danger border border-danger/30 hover:bg-[var(--danger-soft)]">
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
            <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
            <button onClick={handleOpen} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-50">
              {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              เริ่มกะ
            </button>
          </>
        }>
        <div className="p-4 bg-blue-500/10 border border-info/30 rounded-lg">
          <p className="text-sm text-blue-400">นับเงินในลิ้นชักก่อนเริ่มขาย แล้วกรอกยอดด้านล่าง</p>
        </div>
        <Field label="เงินสดในลิ้นชัก (ยอดเริ่มต้น)">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm">฿</span>
            <input type="number" value={openingCash}
              onChange={e => setOpeningCash(e.target.value)}
              onFocus={e => e.target.select()}
              className="w-full pl-8 pr-3 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-xl font-bold focus:outline-none focus:border-phopy-indigo" />
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
      <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
          <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
            <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
              <X className="w-5 h-5 text-danger" /> ปิดกะ — {shift.shift_number}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
          </div>
          <div className="overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">ยอดรวม</p>
                <p className="text-base font-bold text-[var(--primary)]">{fmt(live?.total_revenue || 0)}</p>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">เงินสด</p>
                <p className="text-base font-bold text-warning">{fmt(cashRevenue)}</p>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">QR/โอน</p>
                <p className="text-base font-bold text-blue-400">{fmt(live?.bank_revenue || 0)}</p>
              </div>
            </div>
            <div className="p-4 bg-[var(--bg)] rounded-lg space-y-1 text-sm">
              <div className="flex justify-between text-[var(--fg-3)]">
                <span>เงินสดเปิดกะ</span><span>{fmt(shift.opening_cash)}</span>
              </div>
              <div className="flex justify-between text-[var(--fg-3)]">
                <span>+ ขายเงินสด</span><span>{fmt(cashRevenue)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[var(--fg-1)] border-t border-[var(--border)] pt-2 mt-2">
                <span>ยอดที่ควรมีในลิ้นชัก</span><span>{fmt(expectedCash)}</span>
              </div>
            </div>
            <Field label="นับเงินสดจริงในลิ้นชัก">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-sm">฿</span>
                <input type="number" value={closingCash}
                  onChange={e => setClosingCash(e.target.value)}
                  onFocus={e => e.target.select()}
                  className="w-full pl-8 pr-3 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-xl font-bold focus:outline-none focus:border-phopy-indigo" />
              </div>
            </Field>
            <div className={`flex justify-between items-center p-3 rounded-lg text-sm font-medium ${
              Math.abs(diff) < 0.01 ? 'bg-success/10 border border-success/30 text-success'
              : diff > 0 ? 'bg-[var(--warning-soft)] border border-warning/30 text-warning'
              : 'bg-[var(--danger-soft)] border border-danger/30 text-danger'
            }`}>
              <span>ผลต่าง</span>
              <span>{diff >= 0 ? '+' : ''}{fmt(diff)} {Math.abs(diff) < 0.01 ? '<Check className="w-4 h-4" /> ตรง' : diff > 0 ? '(เกิน)' : '(ขาด)'}</span>
            </div>
            <Field label="หมายเหตุ (optional)">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo resize-none"
                placeholder="เช่น สาเหตุที่เงินขาด/เกิน..." />
            </Field>
          </div>
          <div className="p-5 border-t border-[var(--border)] flex gap-3 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
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
      <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-[var(--surface)] border border-danger/40 rounded-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto">
          <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
              <Ban className="w-5 h-5 text-danger" /> ยกเลิกบิล
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-[var(--danger-soft)] border border-danger/20 rounded-xl p-4">
              <p className="text-sm font-medium text-[var(--fg-1)]">{bill.bill_number}</p>
              <p className="text-xs text-[var(--fg-3)] mt-0.5">
                {bill.display_name} · {fmt(bill.total_amount)} · {bill.payment_method === 'CASH' ? 'เงินสด' : 'QR/โอน'}
              </p>
            </div>
            <div className="bg-[var(--warning-soft)] border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-warning">
              ระบบจะบันทึก: Dr. รายได้ขาย 4100 / Cr. POS-Clearing 1180 เพื่อล้างยอดอัตโนมัติ
            </div>
            <Field label="สาเหตุการยกเลิก *">
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-red-400 resize-none"
                placeholder="เช่น ลูกค้าแจ้งยกเลิก, เก็บเงินผิด, ออเดอร์ผิด..." />
            </Field>
          </div>
          <div className="p-5 border-t border-[var(--border)] flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ปิด</button>
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
          <h2 className="text-xl font-semibold text-[var(--fg-1)]">กะการขาย</h2>
          <p className="text-[var(--fg-3)] text-sm">เปิด/ปิดกะ ติดตามยอดขายและเงินสดในลิ้นชัก</p>
        </div>
        <button onClick={fetchPOSShifts} className="p-2 rounded-lg bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {posCurrentShift === undefined ? (
        <div className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-phopy-indigo border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : posCurrentShift === null ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8 text-[var(--fg-4)]" />
          </div>
          <div>
            <p className="text-[var(--fg-1)] font-medium">ยังไม่มีกะที่เปิดอยู่</p>
            <p className="text-[var(--fg-4)] text-sm mt-1">กรอกเงินสดในลิ้นชักแล้วกดเปิดกะ เพื่อเริ่มรับออเดอร์</p>
          </div>
          <button onClick={() => setShowOpenShift(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 text-lg">
            <ShoppingBag className="w-5 h-5" /> เปิดกะ
          </button>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] border border-success/40 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-success/10 border-b border-success/30 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-success font-medium text-sm">กะกำลังเปิดอยู่</span>
            <span className="ml-auto text-[var(--fg-3)] text-xs">{posCurrentShift.shift_number} · เปิดตั้งแต่ {fmtDT(posCurrentShift.opened_at)}</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">ยอดขายรวม</p>
                <p className="text-xl font-bold text-[var(--primary)]">{fmt(posCurrentShift.live?.total_revenue || 0)}</p>
                <p className="text-xs text-[var(--fg-4)]">{posCurrentShift.live?.bill_count || 0} บิล</p>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">เงินสด</p>
                <p className="text-xl font-bold text-warning">{fmt(posCurrentShift.live?.cash_revenue || 0)}</p>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <p className="text-xs text-[var(--fg-4)] mb-1">QR/โอน</p>
                <p className="text-xl font-bold text-blue-400">{fmt(posCurrentShift.live?.bank_revenue || 0)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-[var(--fg-3)] bg-[var(--bg)] rounded-lg px-4 py-2.5">
              <span>เงินสดเปิดกะ</span>
              <span className="text-[var(--fg-1)] font-medium">{fmt(posCurrentShift.opening_cash)}</span>
            </div>
            <button onClick={() => setShowCloseShift(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-danger/50 text-danger font-semibold rounded-xl hover:bg-[var(--danger-soft)] transition-colors">
              <X className="w-4 h-4" /> ปิดกะ
            </button>
          </div>
        </motion.div>
      )}

      {posShifts.filter(s => s.status === 'CLOSED').length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--fg-3)]">ประวัติกะ</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {posShifts.filter(s => s.status === 'CLOSED').slice(0, 10).map(s => (
              <div key={s.id} className="px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-1)]">{s.shift_number}</p>
                    <p className="text-xs text-[var(--fg-4)] mt-0.5">
                      {fmtDT(s.opened_at)} → {s.closed_at ? fmtDT(s.closed_at) : '-'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[var(--primary)]">{fmt(s.total_revenue)}</p>
                    <p className="text-xs text-[var(--fg-4)]">{s.bill_count} บิล</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: 'เปิดกะ',  value: fmt(s.opening_cash) },
                    { label: 'นับได้',  value: fmt(s.closing_cash_counted || 0) },
                    { label: 'ผลต่าง', value: fmt(s.cash_difference || 0), color: (s.cash_difference || 0) >= 0 ? 'text-success' : 'text-danger' },
                  ].map(item => (
                    <div key={item.label} className="text-xs text-center">
                      <p className="text-[var(--fg-4)]">{item.label}</p>
                      <p className={item.color || 'text-[var(--fg-1)]'}>{item.value}</p>
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
          <h1 className="text-3xl font-bold text-[var(--fg-1)] flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-[var(--primary)]" />
            การขาย
          </h1>
          <p className="text-[var(--fg-3)] mt-1 text-sm">จัดการใบเสนอราคา คำสั่งขาย ใบแจ้งหนี้ และการรับชำระเงิน</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-1.5 bg-[var(--surface)] p-1.5 rounded-xl border border-[var(--border)]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setSearchQuery(''); setActiveTab(tab.id as any) }}
            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-lg font-medium text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-phopy-indigo text-white'
                : 'text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--bg)]'
            }`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
            {tab.badge > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                activeTab === tab.id ? 'bg-[var(--bg)] text-[var(--primary)]' : 'bg-[var(--warning-soft)] text-warning'
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
        <motion.div key={activeTab}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          {activeTab === 'overview'     && <OverviewContent />}
          {activeTab === 'quotations'   && <QuotationsContent />}
          {activeTab === 'orders'          && <OrdersContent />}
          {activeTab === 'delivery-orders' && <DeliveryOrdersContent />}
          {activeTab === 'invoices'        && <InvoicesContent />}
          {activeTab === 'credit-notes'    && <CreditNotesContent />}
          {activeTab === 'backorders'      && <BackordersContent />}
          {activeTab === 'templates'       && <TemplatesContent />}
          {activeTab === 'pos-daily'       && <POSDailyContent />}
        </motion.div>
      )}

      {/* ── Sales Modals — always mounted at top-level ── */}
      {showCreateQT && (
        <CreateQuotationModal
          onClose={() => setShowCreateQT(false)}
          onSaved={() => { setShowCreateQT(false); fetchQuotations() }}
        />
      )}
      {editQTData && (
        <CreateQuotationModal
          editData={editQTData}
          onClose={() => setEditQTData(null)}
          onSaved={() => { setEditQTData(null); fetchQuotations() }}
        />
      )}
      {showCreateSO && (
        <CreateSOModal
          onClose={() => setShowCreateSO(false)}
          onSaved={() => { setShowCreateSO(false); fetchSalesOrders() }}
        />
      )}
      {editSOData && (
        <CreateSOModal
          editData={editSOData}
          onClose={() => setEditSOData(null)}
          onSaved={() => { setEditSOData(null); fetchSalesOrders() }}
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="text-base font-bold text-[var(--fg-1)] flex items-center gap-2">
            <Plus className="w-4 h-4 text-[var(--primary)]" /> เพิ่มลูกค้าใหม่ (ด่วน)
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1 block">ชื่อลูกค้า *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อบริษัท / บุคคล..."
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[var(--fg-4)] mb-1 block">รหัสลูกค้า *</label>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="C-XXXX"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div>
              <label className="text-xs text-[var(--fg-4)] mb-1 block">ประเภท</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo">
                <option value="INDIVIDUAL">บุคคล</option>
                <option value="COMPANY">บริษัท</option>
                <option value="GOVERNMENT">รัฐบาล</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1 block">เบอร์โทร *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0812345678"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
          </div>
          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1 block">อีเมล</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
          </div>
        </div>
        <div className="p-4 border-t border-[var(--border)] flex gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)]">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-phopy-indigo text-white font-semibold rounded-lg text-sm hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center justify-center gap-1">
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
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg)] border border-phopy-indigo/50 rounded-lg">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--fg-1)] truncate">{value.name}</p>
          <p className="text-xs text-[var(--fg-4)]">{value.code} · {value.phone || '-'}</p>
        </div>
        <button onClick={() => onChange(null)} className="text-[var(--fg-4)] hover:text-danger">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-3)]" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSearched(false) }}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="ค้นหาลูกค้า (ชื่อ / รหัส / เบอร์โทร)..."
          className="w-full pl-9 pr-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] placeholder-gray-500 text-sm focus:outline-none focus:border-phopy-indigo"
        />
        {open && (results.length > 0 || searched) && (
          <div className="absolute z-50 w-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
            {results.map(c => (
              <button key={c.id} onMouseDown={() => { onChange(c); setQuery(''); setOpen(false); setSearched(false) }}
                className="w-full px-4 py-2.5 flex items-start gap-2 hover:bg-[var(--bg)] text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--fg-1)] font-medium truncate">{c.name}</p>
                  <p className="text-xs text-[var(--fg-4)]">{c.code} · {c.phone || '-'}</p>
                </div>
              </button>
            ))}
            {results.length === 0 && searched && (
              <div className="px-4 py-3 text-sm text-[var(--fg-4)]">ไม่พบลูกค้า</div>
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
      <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg)] border border-phopy-indigo/50 rounded-lg min-w-0">
        <span className="flex-1 text-sm text-[var(--fg-1)] truncate">{displayName}</span>
        <button type="button" onClick={onClear} className="shrink-0 text-[var(--fg-4)] hover:text-danger">
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
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-0.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {filtered.map(p => (
            <button key={p.id} type="button"
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--bg)] text-left gap-2">
              <div className="min-w-0">
                <p className="text-sm text-[var(--fg-1)] truncate">{p.name}</p>
                <p className="text-xs text-[var(--fg-4)]">{p.code}</p>
              </div>
              <span className="text-xs text-[var(--primary)] shrink-0">฿{(p.sell_price || 0).toLocaleString('th-TH')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function UnitSelectForRow({ productId, value, onChange }: {
  productId?: string
  value: string
  onChange: (unit: string) => void
}) {
  const { units, loading } = useUnits(productId || null)
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
    >
      <option value="">เลือกหน่วย</option>
      {units.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
      {loading && <option disabled>กำลังโหลด...</option>}
    </select>
  )
}

function LineItemsEditor({
  items, onChange, products,
}: {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
  products: Product[]
}) {
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
        <p className="text-sm font-semibold text-[var(--fg-2)]">รายการสินค้า</p>
        <button type="button" onClick={add}
          className="flex items-center gap-1 text-xs text-[var(--primary)] hover:text-[var(--primary)]/80">
          <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
        </button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="bg-[var(--surface-2)] p-3 rounded-lg space-y-2">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-5">
              <label className="text-xs text-[var(--fg-4)] mb-1 block">สินค้า</label>
              <ProductSearch
                value={item.productId ? { id: item.productId, name: item.productName } : item.productName ? { id: undefined, name: item.productName } : null}
                products={products}
                onSelect={p => update(i, { productId: p.id, productName: p.name, unit: normalizeUnit(p.unit || ''), unitPrice: p.sell_price || 0 })}
onClear={() => update(i, { productId: undefined, productName: '' })}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--fg-4)] mb-1 block">จำนวน</label>
              <input type="number" value={item.quantity} min={0.01} step={0.01}
                onChange={e => update(i, { quantity: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--fg-4)] mb-1 block">หน่วย</label>
              <UnitSelectForRow
                productId={item.productId}
                value={item.unit}
                onChange={u => update(i, { unit: u })}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--fg-4)] mb-1 block">ราคา/หน่วย</label>
              <input type="number" value={item.unitPrice} min={0} step={0.01}
                onChange={e => update(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--fg-4)] mb-1 block">ส่วนลด%</label>
              <input type="number" value={item.discountPercent} min={0} max={100}
                onChange={e => update(i, { discountPercent: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div className="col-span-1 flex justify-end pb-1">
              {items.length > 1 && (
                <button type="button" onClick={() => remove(i)} className="p-1.5 text-danger hover:bg-[var(--danger-soft)] rounded-lg">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-[var(--fg-3)]">
            รวม: <span className="text-[var(--fg-1)] font-medium">
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
    <div className="bg-[var(--surface-2)] p-4 rounded-xl space-y-2 text-sm">
      <div className="flex justify-between text-[var(--fg-3)]">
        <span>ยอดรวม</span><span>฿{subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="flex justify-between text-[var(--fg-3)] items-center gap-4">
        <span className="shrink-0">ส่วนลด (฿)</span>
        <input type="number" value={discountAmount} min={0}
          onChange={e => setDiscountAmount(parseFloat(e.target.value) || 0)}
          onFocus={e => e.target.select()}
          className="w-28 text-right bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
      </div>
      <div className="flex justify-between text-[var(--fg-3)] items-center gap-4">
        <span className="shrink-0">VAT (%)</span>
        <div className="flex items-center gap-2">
          {[0, 7].map(r => (
            <button key={r} type="button" onClick={() => setTaxRate(r)}
              className={`px-2 py-0.5 rounded text-xs border ${taxRate === r ? 'border-phopy-indigo text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-4)]'}`}>
              {r}%
            </button>
          ))}
          <input type="number" value={taxRate} min={0} max={100}
            onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            className="w-16 text-right bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[var(--fg-1)] text-xs focus:outline-none focus:border-phopy-indigo" />
        </div>
      </div>
      {taxRate > 0 && (
        <div className="flex justify-between text-warning">
          <span>VAT ({taxRate}%)</span><span>+฿{tax.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-base border-t border-[var(--border)] pt-2">
        <span className="text-[var(--fg-1)]">ยอดสุทธิ</span>
        <span className="text-success">฿{total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}

// ─── Create / Edit Quotation Modal ───────────────────────────────────────────
function CreateQuotationModal({ onClose, onSaved, editData }: {
  onClose: () => void; onSaved: () => void; editData?: any
}) {
  useModalClose(onClose)
  const isEdit = !!editData
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [expiryDate, setExpiryDate] = useState(editData?.expiry_date?.split('T')[0] || '')
  const [taxRate, setTaxRate] = useState(editData?.tax_rate ?? 0)
  const [discountAmount, setDiscountAmount] = useState(editData?.discount_amount ?? 0)
  const [notes, setNotes] = useState(editData?.notes || '')
  const [items, setItems] = useState<LineItem[]>(
    editData?.items?.length
      ? editData.items.map((it: any) => ({
          productId: it.stock_item_id || it.product_id || undefined,
          productName: it.product_name || '',
          quantity: it.quantity,
          unit: it.unit || '',
          unitPrice: it.unit_price,
          discountPercent: it.discount_percent || 0,
        }))
      : [{ productName: '', quantity: 1, unit: '', unitPrice: 0, discountPercent: 0 }]
  )
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [showQuickAddCust, setShowQuickAddCust] = useState(false)

  useEffect(() => {
    salesService.getProducts().then(setProducts).catch(() => {})
    if (isEdit && editData?.customer_name) {
      salesService.searchCustomers(editData.customer_name).then(r => { if (r.length) setCustomer(r[0]) }).catch(() => {})
    }
  }, [])

  const handleSave = async () => {
    if (!customer) { toast.error('กรุณาเลือกลูกค้า'); return }
    if (items.every(it => !it.productName && !it.productId)) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return }
    setSaving(true)
    try {
      const payload = {
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
      }
      if (isEdit) {
        await salesService.updateQuotation(editData.id, payload)
        toast.success('บันทึกการแก้ไขใบเสนอราคาสำเร็จ')
      } else {
        await salesService.createQuotation(payload)
        toast.success('สร้างใบเสนอราคาสำเร็จ')
      }
      onSaved()
    } catch {
      toast.error(isEdit ? 'แก้ไขใบเสนอราคาไม่สำเร็จ' : 'สร้างใบเสนอราคาไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--primary)]" />
            {isEdit ? `แก้ไขใบเสนอราคา ${editData.quotation_number}` : 'สร้างใบเสนอราคา (QT)'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-sm text-[var(--fg-3)]">ลูกค้า *</label>
                <button type="button" onClick={() => setShowQuickAddCust(true)}
                  className="flex items-center gap-1 text-xs text-[var(--primary)] hover:text-[var(--primary)]/80">
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
              <label className="block text-sm text-[var(--fg-3)] mb-1.5">วันหมดอายุ</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1.5">หมายเหตุ</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="หมายเหตุ..."
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo" />
            </div>
          </div>

          <LineItemsEditor items={items} onChange={setItems} products={products} />
          <TotalsSummary items={items} taxRate={taxRate} setTaxRate={setTaxRate} discountAmount={discountAmount} setDiscountAmount={setDiscountAmount} />
        </div>

        <div className="p-5 border-t border-[var(--border)] flex gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-phopy-indigo text-white font-semibold rounded-lg hover:bg-phopy-indigo/80 disabled:opacity-50 text-sm">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : isEdit ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'บันทึกการแก้ไข' : 'สร้างใบเสนอราคา'}
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <div>
            <p className="font-mono text-sm text-[var(--primary)] font-semibold">{quotation.quotation_number}</p>
            <p className="text-[var(--fg-1)] font-bold">{quotation.customer_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={quotation.status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo mx-auto" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">วันที่</p>
                  <p className="text-[var(--fg-1)]">{formatDate(detail?.quotation_date)}</p>
                </div>
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">วันหมดอายุ</p>
                  <p className={`font-medium ${detail?.expiry_date && new Date(detail.expiry_date) < new Date() ? 'text-danger' : 'text-[var(--fg-1)]'}`}>
                    {formatDate(detail?.expiry_date)}
                  </p>
                </div>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[var(--fg-2)]">รายการสินค้า</p>
                <div className="space-y-1">
                  {(detail?.items || []).map((it: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-2 px-3 bg-[var(--surface-2)] rounded-lg text-sm">
                      <div>
                        <p className="text-[var(--fg-1)]">{it.product_name || it.productName || `รายการ ${i + 1}`}</p>
                        <p className="text-xs text-[var(--fg-4)]">{it.quantity} × ฿{(it.unit_price || 0).toLocaleString()}{it.discount_percent > 0 ? ` (-${it.discount_percent}%)` : ''}</p>
                      </div>
                      <p className="text-[var(--fg-1)] font-medium">{formatCurrency(it.total_price)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-[var(--surface-2)] rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-[var(--fg-3)]"><span>ยอดรวม</span><span>{formatCurrency(detail?.subtotal)}</span></div>
                {(detail?.discount_amount || 0) > 0 && <div className="flex justify-between text-danger"><span>ส่วนลด</span><span>-{formatCurrency(detail?.discount_amount)}</span></div>}
                {(detail?.tax_amount || 0) > 0 && <div className="flex justify-between text-warning"><span>VAT ({detail?.tax_rate}%)</span><span>+{formatCurrency(detail?.tax_amount)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--fg-1)]">ยอดสุทธิ</span><span className="text-success">{formatCurrency(detail?.total_amount)}</span>
                </div>
              </div>

              {detail?.notes && (
                <div className="bg-[var(--bg)] rounded-lg p-3 text-sm text-[var(--fg-3)]">หมายเหตุ: {detail.notes}</div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-[var(--border)] flex gap-2 shrink-0 flex-wrap">
          {/* Print buttons */}
          {!loading && (
            <>
              <button onClick={() => handlePrint('a4')} title="พิมพ์ A4"
                className="px-2.5 py-2 text-[var(--fg-3)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors">
                <Printer className="w-4 h-4" />
              </button>
              <button onClick={() => handlePrint('thermal')} title="พิมพ์ Thermal"
                className="px-2 py-2 text-[var(--fg-4)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors text-xs">
                <Printer className="w-3.5 h-3.5 inline" /> 80mm
              </button>
            </>
          )}
          {quotation.status === 'DRAFT' && (
            <button onClick={() => updateStatus('SENT')} disabled={updating}
              className="flex-1 py-2 bg-[var(--info-soft)] border border-blue-500/50 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 disabled:opacity-50">
              ส่งใบเสนอราคา
            </button>
          )}
          {(quotation.status === 'SENT' || quotation.status === 'DRAFT') && (
            <button onClick={() => updateStatus('ACCEPTED')} disabled={updating}
              className="flex-1 py-2 bg-[var(--success-soft)] border border-success/50 text-success rounded-lg text-sm font-medium hover:bg-success/30 disabled:opacity-50">
              อนุมัติ
            </button>
          )}
          {quotation.status === 'ACCEPTED' && (
            <button onClick={() => onConvert(quotation)} disabled={updating}
              className="flex-1 py-2 bg-phopy-indigo text-white rounded-lg text-sm font-semibold hover:bg-phopy-indigo/80">
              <ArrowRight className="w-4 h-4 inline mr-1" />แปลงเป็นคำสั่งขาย (SO)
            </button>
          )}
          {!['CANCELLED', 'EXPIRED'].includes(quotation.status) && (
            <button onClick={() => updateStatus('CANCELLED')} disabled={updating}
              className="py-2 px-3 text-danger border border-danger/30 rounded-lg text-sm hover:bg-[var(--danger-soft)] disabled:opacity-50">
              ยกเลิก
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Create / Edit Sales Order Modal ─────────────────────────────────────────
function CreateSOModal({ sourceQuotation, onClose, onSaved, editData }: {
  sourceQuotation?: Quotation; onClose: () => void; onSaved: () => void; editData?: any
}) {
  useModalClose(onClose)
  const isEdit = !!editData
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [deliveryDate, setDeliveryDate] = useState(editData?.delivery_date?.split('T')[0] || '')
  const [taxRate, setTaxRate] = useState(editData?.tax_rate ?? 0)
  const [discountAmount, setDiscountAmount] = useState(editData?.discount_amount ?? 0)
  const [notes, setNotes] = useState(editData?.notes || '')
  const [items, setItems] = useState<LineItem[]>(
    editData?.items?.length
      ? editData.items.map((it: any) => ({
          productId: it.stock_item_id || it.product_id || undefined,
          productName: it.product_name || '',
          quantity: it.quantity,
          unit: it.unit || '',
          unitPrice: it.unit_price,
          discountPercent: it.discount_percent || 0,
        }))
      : [{ productName: '', quantity: 1, unit: '', unitPrice: 0, discountPercent: 0 }]
  )
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
      // Edit mode: load existing customer
      if (isEdit && editData?.customer_name) {
        salesService.searchCustomers(editData.customer_name).then(r => {
          if (r.length) setCustomer(r[0])
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!customer) { toast.error('กรุณาเลือกลูกค้า'); return }
    if (items.every(it => !it.productName && !it.productId)) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return }
    setSaving(true)
    try {
      const payload = {
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
      }
      if (isEdit) {
        await salesService.updateSalesOrder(editData.id, payload)
        toast.success('บันทึกการแก้ไขคำสั่งขายสำเร็จ')
      } else {
        await salesService.createSalesOrder(payload)
        toast.success('สร้างคำสั่งขายสำเร็จ')
      }
      onSaved()
    } catch {
      toast.error(isEdit ? 'แก้ไขคำสั่งขายไม่สำเร็จ' : 'สร้างคำสั่งขายไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-purple-400" />
            {isEdit ? `แก้ไขคำสั่งขาย ${editData.so_number}` : sourceQuotation ? `แปลง ${sourceQuotation.quotation_number} → SO` : 'สร้างคำสั่งขาย (SO)'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-sm text-[var(--fg-3)]">ลูกค้า *</label>
                <button type="button" onClick={() => setShowQuickAddCust(true)}
                  className="flex items-center gap-1 text-xs text-[var(--primary)] hover:text-[var(--primary)]/80">
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
              <label className="block text-sm text-[var(--fg-3)] mb-1.5">กำหนดส่ง</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo" />
            </div>
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1.5">หมายเหตุ</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="หมายเหตุ..."
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo" />
            </div>
          </div>

          <LineItemsEditor items={items} onChange={setItems} products={products} />
          <TotalsSummary items={items} taxRate={taxRate} setTaxRate={setTaxRate} discountAmount={discountAmount} setDiscountAmount={setDiscountAmount} />
        </div>

        <div className="p-5 border-t border-[var(--border)] flex gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-purple-500 text-[var(--fg-1)] font-semibold rounded-lg hover:bg-purple-600 disabled:opacity-50 text-sm">
            {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : isEdit ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'บันทึกการแก้ไข' : sourceQuotation ? 'แปลงเป็นคำสั่งขาย' : 'สร้างคำสั่งขาย'}
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <div>
            <p className="font-mono text-sm text-purple-400 font-semibold">{salesOrder.so_number}</p>
            <p className="text-[var(--fg-1)] font-bold">{salesOrder.customer_name}</p>
            {salesOrder.quotation_number && <p className="text-xs text-[var(--fg-4)]">QT: {salesOrder.quotation_number}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={salesOrder.status} />
            <StatusBadge status={salesOrder.payment_status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]"><X className="w-4 h-4" /></button>
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
                  <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${isCurrent ? 'bg-purple-500 text-[var(--fg-1)]' : isPast ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'}`}>
                    {STATUS_CONFIG[s]?.label || s}
                  </div>
                  {i < SO_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo mx-auto" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">วันสั่งซื้อ</p><p className="text-[var(--fg-1)]">{fmtD(detail?.order_date)}</p>
                </div>
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">กำหนดส่ง</p><p className="text-[var(--fg-1)]">{fmtD(detail?.delivery_date)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-[var(--fg-2)]">รายการสินค้า</p>
                {(detail?.items || []).map((it: any, i: number) => {
                  const insufficient = it.stock_item_id && (it.stock_qty ?? Infinity) < it.quantity
                  return (
                    <div key={i} className={`flex justify-between items-start py-2 px-3 rounded-lg text-sm ${insufficient ? 'bg-[var(--danger-soft)] border border-danger/30' : 'bg-[var(--surface-2)]'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--fg-1)]">{it.product_name || `รายการ ${i + 1}`}</p>
                        <p className="text-xs text-[var(--fg-4)]">{it.quantity} × {fmt(it.unit_price)}{it.discount_percent > 0 ? ` (-${it.discount_percent}%)` : ''}</p>
                        {insufficient && (
                          <p className="text-xs text-danger mt-0.5"><AlertTriangle className="w-4 h-4" /> สต็อกไม่พอ (มี {it.stock_qty ?? 0} ชิ้น)</p>
                        )}
                      </div>
                      <p className="text-[var(--fg-1)] font-medium ml-3">{fmt(it.total_price)}</p>
                    </div>
                  )
                })}
              </div>

              <div className="bg-[var(--surface-2)] rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-[var(--fg-3)]"><span>ยอดรวม</span><span>{fmt(detail?.subtotal)}</span></div>
                {(detail?.discount_amount || 0) > 0 && <div className="flex justify-between text-danger"><span>ส่วนลด</span><span>-{fmt(detail?.discount_amount)}</span></div>}
                {(detail?.tax_amount || 0) > 0 && <div className="flex justify-between text-warning"><span>VAT ({detail?.tax_rate}%)</span><span>+{fmt(detail?.tax_amount)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--fg-1)]">ยอดสุทธิ</span><span className="text-success">{fmt(detail?.total_amount)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-[var(--border)] flex gap-2 shrink-0 flex-wrap">
          {!loading && (
            <button onClick={handlePrint} title="พิมพ์ SO (A4)"
              className="px-2.5 py-2 text-[var(--fg-3)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors">
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
              className="flex-1 py-2 bg-[var(--warning-soft)] border border-yellow-500/50 text-warning rounded-lg text-sm font-medium hover:bg-[var(--warning-soft)] disabled:opacity-50 flex items-center justify-center gap-1">
              {creatingInv ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
              ออกใบแจ้งหนี้
            </button>
          )}
          {!['CANCELLED', 'COMPLETED'].includes(salesOrder.status) && (
            <button onClick={() => updateStatus('CANCELLED')} disabled={updating}
              className="py-2 px-3 text-danger border border-danger/30 rounded-lg text-sm hover:bg-[var(--danger-soft)] disabled:opacity-50">
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Header */}
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <p className="font-mono text-base text-warning font-bold">{invoice.invoice_number}</p>
              {invoice.so_number && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--fg-4)]">
                  <span className="px-1.5 py-0.5 bg-[var(--bg)] rounded font-mono">SO: {invoice.so_number}</span>
                </div>
              )}
            </div>
            <p className="text-[var(--fg-1)] font-semibold text-lg">{invoice.customer_name}</p>
            {invoice.customer_code && <p className="text-xs text-[var(--fg-4)] font-mono">{invoice.customer_code}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={invoice.payment_status} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)]"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-phopy-indigo mx-auto" /></div>
          ) : (
            <>
              {/* Info row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-[var(--bg)] rounded-xl p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">วันที่ออกใบ</p>
                  <p className="text-[var(--fg-1)] font-medium">{fmtD(detail?.invoice_date)}</p>
                </div>
                <div className="bg-[var(--bg)] rounded-xl p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">ครบกำหนด</p>
                  <p className={detail?.payment_status === 'OVERDUE' ? 'text-danger font-medium' : 'text-[var(--fg-1)] font-medium'}>{fmtD(detail?.due_date)}</p>
                </div>
                <div className="bg-[var(--bg)] rounded-xl p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">ยอดรวมทั้งหมด</p>
                  <p className="text-[var(--fg-1)] font-bold">{fmt(detail?.total_amount)}</p>
                </div>
                <div className="bg-[var(--bg)] rounded-xl p-3">
                  <p className="text-[var(--fg-4)] text-xs mb-1">ยอดคงค้าง</p>
                  <p className={invoice.balance_amount > 0 ? 'text-danger font-bold' : 'text-success font-bold'}>{fmt(invoice.balance_amount)}</p>
                </div>
              </div>

              {/* Items list */}
              <div>
                <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">รายการสินค้า</p>
                <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 px-3 py-2 bg-[var(--surface-2)] text-xs text-[var(--fg-4)] font-medium border-b border-[var(--border)]/50">
                    <span className="col-span-5">สินค้า</span>
                    <span className="col-span-2 text-center">จำนวน</span>
                    <span className="col-span-2 text-right">ราคา/หน่วย</span>
                    <span className="col-span-1 text-right">ส่วนลด</span>
                    <span className="col-span-2 text-right">รวม</span>
                  </div>
                  {(detail?.items || []).map((it: any, i: number) => (
                    <div key={i} className={`grid grid-cols-12 px-3 py-3 text-sm items-center ${i % 2 === 0 ? '' : 'bg-[var(--surface-2)]/40'} border-b border-[var(--border)]/30 last:border-0`}>
                      <div className="col-span-5">
                        <p className="text-[var(--fg-1)] font-medium">{it.product_name || `รายการ ${i + 1}`}</p>
                        {it.product_code && <p className="text-xs text-[var(--fg-4)] font-mono">{it.product_code}</p>}
                      </div>
                      <p className="col-span-2 text-center text-[var(--fg-2)]">{it.quantity} {it.unit || ''}</p>
                      <p className="col-span-2 text-right text-[var(--fg-2)]">{fmt(it.unit_price)}</p>
                      <p className="col-span-1 text-right text-[var(--fg-4)] text-xs">{it.discount_percent ? `${it.discount_percent}%` : '-'}</p>
                      <p className="col-span-2 text-right text-[var(--fg-1)] font-semibold">{fmt(it.total_price)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals + Payment history — 2 columns on wide screen */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Totals */}
                <div className="bg-[var(--surface-2)] rounded-xl p-4 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">สรุปยอด</p>
                  <div className="flex justify-between text-[var(--fg-3)]"><span>ยอดก่อนภาษี</span><span>{fmt((detail?.total_amount || 0) / (detail?.vat_rate ? (1 + detail.vat_rate / 100) : 1))}</span></div>
                  {detail?.vat_amount > 0 && <div className="flex justify-between text-[var(--fg-3)]"><span>VAT {detail?.vat_rate || 7}%</span><span>{fmt(detail?.vat_amount)}</span></div>}
                  <div className="flex justify-between text-[var(--fg-2)] border-t border-[var(--border)]/50 pt-1.5"><span>ยอดรวม</span><span>{fmt(detail?.total_amount)}</span></div>
                  {(detail?.withholdingTax || []).length > 0 && (
                    <>
                      {(detail.withholdingTax as any[]).map((w: any) => (
                        <div key={w.id} className="flex justify-between text-warning text-xs">
                          <span>หัก ณ ที่จ่าย {w.tax_type} {w.tax_rate}%</span>
                          <span>-{fmt(w.tax_amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-[var(--fg-2)] text-xs">
                        <span>ยอดสุทธิ (หัก WHT)</span>
                        <span>{fmt((detail?.total_amount || 0) - (detail?.withholdingTax || []).reduce((s: number, w: any) => s + (w.tax_amount || 0), 0))}</span>
                      </div>
                    </>
                  )}
                  {(detail?.paid_amount || 0) > 0 && <div className="flex justify-between text-success"><span>ชำระแล้ว</span><span>-{fmt(detail?.paid_amount)}</span></div>}
                  <div className="flex justify-between font-bold text-base border-t border-[var(--border)] pt-2">
                    <span className="text-[var(--fg-1)]">ยอดคงค้าง</span>
                    <span className={invoice.balance_amount > 0 ? 'text-danger' : 'text-success'}>{fmt(invoice.balance_amount)}</span>
                  </div>
                </div>

                {/* Payment receipts */}
                <div>
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide mb-2">ประวัติการรับเงิน</p>
                  {(detail?.receipts || []).length === 0 ? (
                    <div className="bg-[var(--surface-2)] rounded-xl p-4 text-center text-sm text-[var(--fg-4)]">ยังไม่มีการรับเงิน</div>
                  ) : (
                    <div className="space-y-2">
                      {detail.receipts.map((r: any) => (
                        <div key={r.id} className="bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="text-[var(--fg-1)] font-mono text-xs font-semibold">{r.receipt_number}</p>
                              <p className="text-xs text-[var(--fg-4)] mt-0.5">{fmtD(r.receipt_date)} · {r.payment_method}{r.payment_reference ? ` · ${r.payment_reference}` : ''}</p>
                              {r.notes && <p className="text-xs text-[var(--fg-3)] mt-1 italic">"{r.notes}"</p>}
                            </div>
                            <p className="text-success font-bold ml-3">{fmt(r.amount)}</p>
                          </div>
                          <div className="flex gap-1 mt-2">
                            <button onClick={() => handlePrintReceipt(r, 'a4')}
                              className="px-2 py-1 text-[var(--fg-4)] hover:text-[var(--fg-1)] border border-[var(--border)]/50 rounded-lg text-xs flex items-center gap-1">
                              <Printer className="w-3 h-3" /> A4
                            </button>
                            <button onClick={() => handlePrintReceipt(r, 'thermal')}
                              className="px-2 py-1 text-[var(--fg-4)] hover:text-[var(--fg-1)] border border-[var(--border)]/50 rounded-lg text-xs flex items-center gap-1">
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
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wide">เอกสารแนบ / รูปภาพ</p>
                  <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${uploading ? 'bg-[var(--bg)] text-[var(--fg-4)]' : 'bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-phopy-indigo/30'}`}>
                    {uploading ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป (สูงสุด 10MB)'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadAttachment} disabled={uploading} />
                  </label>
                </div>
                {(detail?.attachments || []).length === 0 ? (
                  <div className="border-2 border-dashed border-[var(--border)]/50 rounded-xl p-6 text-center text-[var(--fg-4)] text-sm">
                    <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    ยังไม่มีเอกสารแนบ
                  </div>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {detail.attachments.map((att: any) => (
                      <div key={att.id} className="relative group rounded-xl overflow-hidden border border-[var(--border)]/50 bg-[var(--surface-2)] aspect-square">
                        <img src={`/uploads/invoice-attachments/${att.file_path.split('/').pop()}`}
                          alt={att.original_name}
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div className="absolute inset-0 bg-[var(--fg-1)]/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button onClick={() => setPreviewUrl(`/uploads/invoice-attachments/${att.file_path.split('/').pop()}`)}
                            className="p-1.5 bg-[var(--surface-2)] rounded-lg hover:bg-[var(--surface-2)]">
                            <Eye className="w-3.5 h-3.5 text-[var(--fg-1)]" />
                          </button>
                          <button onClick={() => handleDeleteAttachment(att.id)}
                            className="p-1.5 bg-[var(--danger-soft)] rounded-lg hover:bg-red-500/50">
                            <Trash2 className="w-3.5 h-3.5 text-danger" />
                          </button>
                        </div>
                        <p className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-[var(--fg-1)]/60 text-[10px] text-[var(--fg-2)] truncate">{att.original_name}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Record Payment Form */}
              {isUnpaid && showPayment && (
                <div className="bg-[var(--bg)] border border-phopy-indigo/30 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-[var(--primary)]">บันทึกการรับเงิน</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 block">จำนวนเงิน (฿)</label>
                      <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                        placeholder={`สูงสุด ${fmt(invoice.balance_amount)}`}
                        onFocus={e => e.target.select()}
                        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 block">วิธีชำระ</label>
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo">
                        <option value="CASH">เงินสด</option>
                        <option value="TRANSFER">โอนเงิน</option>
                        <option value="CHEQUE">เช็ค</option>
                        <option value="CREDIT_CARD">บัตรเครดิต</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 block">วันที่รับเงิน</label>
                      <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1 block">เลขอ้างอิง</label>
                      <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="เลขโอน / เช็ค..."
                        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm placeholder-gray-600 focus:outline-none focus:border-phopy-indigo" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--fg-4)] mb-1 block">หมายเหตุ</label>
                    <textarea value={payNote} onChange={e => setPayNote(e.target.value)} rows={2}
                      placeholder="เช่น ชำระบางส่วน / โอนเข้าบัญชี xxx..."
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm placeholder-gray-600 focus:outline-none focus:border-phopy-indigo resize-none" />
                  </div>
                  {/* Journal Preview */}
                  <JournalPreview entries={[
                    { dr: true,  account: payMethod === 'CASH' ? '1100 เงินสด' : '1101 เงินฝากธนาคาร', label: 'เพิ่มสินทรัพย์', amount: parseFloat(payAmount) || 0 },
                    { dr: false, account: '1110 ลูกหนี้การค้า', label: 'ลดลูกหนี้', amount: parseFloat(payAmount) || 0 },
                  ]} />

                  <div className="flex gap-2">
                    <button onClick={() => setShowPayment(false)} className="px-3 py-2 text-[var(--fg-3)] text-sm hover:text-[var(--fg-1)]">ยกเลิก</button>
                    <button onClick={handleRecordPayment} disabled={saving}
                      className="flex-1 py-2 bg-success text-white font-semibold rounded-lg text-sm hover:bg-success/80 disabled:opacity-50 flex items-center justify-center gap-1">
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
          <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 flex items-center gap-2">
            <button onClick={() => handlePrintInv('a4')} title="พิมพ์ใบแจ้งหนี้ A4"
              className="px-3 py-2 text-[var(--fg-3)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors flex items-center gap-1.5 text-sm">
              <Printer className="w-4 h-4" /> A4
            </button>
            <button onClick={() => handlePrintInv('thermal')} title="พิมพ์ Thermal"
              className="px-3 py-2 text-[var(--fg-4)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors text-sm flex items-center gap-1">
              <Printer className="w-3.5 h-3.5" /> 80mm
            </button>
            <div className="flex-1" />
            {isUnpaid && !showPayment && (
              <button onClick={() => setShowPayment(true)}
                className="px-5 py-2 bg-success text-white font-semibold rounded-lg hover:bg-success/80 text-sm flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> บันทึกการรับเงิน
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>

    {/* Image Preview Lightbox */}
    {previewUrl && (
      <div className="fixed inset-0 bg-[var(--fg-1)]/90 z-50 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
        <button className="absolute top-4 right-4 p-2 bg-[var(--surface-2)] rounded-lg text-[var(--fg-1)] hover:bg-[var(--surface-2)]">
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)] flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-warning" /> สร้างใบลดหนี้ (CN)
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1.5 block">ใบแจ้งหนี้อ้างอิง *</label>
            <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo">
              <option value="">-- เลือกใบแจ้งหนี้ --</option>
              {invoices.map((inv: any) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} · {inv.customer_name} · ฿{Number(inv.total_amount).toLocaleString('th-TH')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1.5 block">วันที่ออกใบลดหนี้</label>
            <input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo" />
          </div>

          <div>
            <label className="text-xs text-[var(--fg-4)] mb-1.5 block">เหตุผลการลดหนี้ *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="เช่น สินค้าชำรุด, ส่งคืนสินค้า, ราคาผิดพลาด..."
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--fg-1)] text-sm placeholder-gray-600 focus:outline-none focus:border-phopy-indigo resize-none" />
          </div>
        </div>

        <div className="p-5 border-t border-[var(--border)] shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] text-sm hover:text-[var(--fg-1)]">ยกเลิก</button>
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
    DRAFT: 'text-[var(--fg-3)] bg-gray-400/10',
    ISSUED: 'text-blue-400 bg-blue-400/10',
    APPLIED: 'text-success bg-success/10',
    CANCELLED: 'text-danger bg-[var(--danger-soft)]',
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--fg-1)] font-mono">{creditNote.cn_number}</h2>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{creditNote.customer_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[creditNote.status] || 'text-[var(--fg-3)] bg-gray-400/10'}`}>
              {statusLabel[creditNote.status] || creditNote.status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-[var(--surface-2)] rounded-lg p-3">
              <p className="text-xs text-[var(--fg-4)] mb-1">ใบแจ้งหนี้อ้างอิง</p>
              <p className="text-[var(--fg-1)] font-mono font-medium">{creditNote.invoice_number}</p>
            </div>
            <div className="bg-[var(--surface-2)] rounded-lg p-3">
              <p className="text-xs text-[var(--fg-4)] mb-1">วันที่ออก</p>
              <p className="text-[var(--fg-1)]">{fmtD(creditNote.credit_date)}</p>
            </div>
          </div>

          <div className="bg-[var(--surface-2)] rounded-lg p-3">
            <p className="text-xs text-[var(--fg-4)] mb-1">เหตุผล</p>
            <p className="text-[var(--fg-1)] text-sm">{creditNote.reason || '-'}</p>
          </div>

          <div className="bg-[var(--surface-2)] p-4 rounded-xl flex justify-between items-center">
            <span className="text-[var(--fg-2)] text-sm font-semibold">ยอดลดหนี้</span>
            <span className="text-warning font-bold text-lg">{fmt(creditNote.total_amount)}</span>
          </div>
        </div>

        <div className="p-5 border-t border-[var(--border)] shrink-0 flex gap-2">
          <button onClick={handlePrint} title="พิมพ์ใบลดหนี้ A4"
            className="px-2.5 py-2 text-[var(--fg-3)] border border-[var(--border)] rounded-lg hover:text-[var(--fg-1)] hover:border-[var(--border)] transition-colors">
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
    PENDING: 'text-warning bg-[var(--warning-soft)]',
    FULFILLED: 'text-success bg-success/10',
    CANCELLED: 'text-danger bg-[var(--danger-soft)]',
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
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--fg-1)] font-mono">{backorder.bo_number}</h2>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{backorder.customer_name} · SO: {backorder.so_number}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[backorder.status] || 'text-[var(--fg-3)] bg-gray-400/10'}`}>
              {statusLabel[backorder.status] || backorder.status}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {items.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[var(--fg-2)]">รายการค้างส่ง</p>
              {items.map((item: any, i: number) => (
                <div key={i} className="bg-[var(--surface-2)] rounded-lg p-3 text-sm">
                  <p className="text-[var(--fg-1)] font-medium">{item.product_name || item.productName}</p>
                  <div className="flex gap-4 mt-1.5 text-xs text-[var(--fg-4)]">
                    <span>สั่ง: <span className="text-[var(--fg-1)]">{item.ordered_qty ?? item.quantity}</span></span>
                    <span>ส่งแล้ว: <span className="text-success">{item.delivered_qty ?? 0}</span></span>
                    <span>ค้าง: <span className="text-warning">{item.remaining_qty ?? ((item.ordered_qty ?? item.quantity) - (item.delivered_qty ?? 0))}</span></span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--fg-4)] text-sm">
              {detail === null ? 'กำลังโหลด...' : 'ไม่มีรายการ'}
            </div>
          )}
        </div>

        {backorder.status === 'PENDING' && (
          <div className="p-5 border-t border-[var(--border)] shrink-0">
            <button onClick={handleFulfill} disabled={saving}
              className="w-full py-2.5 bg-success text-white font-semibold rounded-lg text-sm hover:bg-success/80 disabled:opacity-50 flex items-center justify-center gap-2">
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
