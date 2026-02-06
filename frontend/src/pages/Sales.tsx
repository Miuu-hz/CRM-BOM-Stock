import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  FileText, 
  ShoppingCart, 
  Truck, 
  Receipt, 
  Plus, 
  Search, 
  Filter,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Package,
  CreditCard,
  RotateCcw,
  Percent,
  Box,
  LayoutTemplate,
  ChevronRight,
  Eye,
  Edit,
  ArrowLeftRight,
  X
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
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

const Sales = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'quotations' | 'orders' | 'invoices' | 'credit-notes' | 'backorders' | 'templates'>('overview')
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [backorders, setBackorders] = useState<Backorder[]>([])
  const [templates, setTemplates] = useState<QuotationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Modal states
  const [showModal, setShowModal] = useState<string | null>(null)
  const [modalData, setModalData] = useState<any>(null)

  // Fetch data based on active tab
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
    }
  }, [activeTab])

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token')
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  }

  const handleApiError = (error: any, defaultMsg: string) => {
    console.error('API Error:', error)
    if (error.status === 401) {
      toast.error('Session expired. Please login again.')
      // Optionally redirect to login
    } else {
      toast.error(defaultMsg)
    }
  }

  const fetchSummary = async () => {
    try {
      const res = await fetch('/api/sales/summary', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setSummary(data.data)
      }
    } catch (error) {
      console.error('Fetch summary error:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchQuotations = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/quotations', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setQuotations(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบเสนอราคาได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchSalesOrders = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/sales-orders', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setSalesOrders(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลคำสั่งขายได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/invoices', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setInvoices(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบแจ้งหนี้ได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchCreditNotes = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/credit-notes', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setCreditNotes(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบลดหนี้ได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchBackorders = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/backorders', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setBackorders(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลใบค้างส่งได้')
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sales/quotation-templates', {
        headers: getAuthHeaders()
      })
      if (res.status === 401) {
        handleApiError({ status: 401 }, '')
        return
      }
      const data = await res.json()
      if (data.success) {
        setTemplates(data.data)
      }
    } catch (error) {
      handleApiError(error, 'ไม่สามารถดึงข้อมูลเทมเพลตได้')
    } finally {
      setLoading(false)
    }
  }

  // Action handlers
  const handleCreateQuotation = () => {
    toast('ฟีเจอร์สร้างใบเสนอราคากำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleCreateSalesOrder = () => {
    toast('ฟีเจอร์สร้างคำสั่งขายกำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleCreateInvoice = () => {
    toast('ฟีเจอร์สร้างใบแจ้งหนี้กำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleCreateCreditNote = () => {
    toast('ฟีเจอร์สร้างใบลดหนี้กำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleCreateBackorder = () => {
    toast('ฟีเจอร์สร้างใบค้างส่งกำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleCreateTemplate = () => {
    toast('ฟีเจอร์สร้างเทมเพลตกำลังพัฒนา...')
    // TODO: Open modal or navigate to create page
  }

  const handleViewDetail = (item: any, type: string) => {
    toast(`ดูรายละเอียด ${type} - ID: ${item.id}`)
    // TODO: Open detail modal
  }

  const handleEdit = (item: any, type: string) => {
    toast(`แก้ไข ${type} - ID: ${item.id}`)
    // TODO: Open edit modal
  }

  const handleRecordPayment = (invoice: Invoice) => {
    toast(`บันทึกการรับเงิน - ${invoice.invoice_number}`)
    // TODO: Open payment modal
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'DRAFT': 'bg-gray-500',
      'SENT': 'bg-blue-500',
      'ACCEPTED': 'bg-green-500',
      'REJECTED': 'bg-red-500',
      'EXPIRED': 'bg-gray-400',
      'CANCELLED': 'bg-red-400',
      'CONFIRMED': 'bg-cyan-500',
      'PROCESSING': 'bg-yellow-500',
      'READY': 'bg-purple-500',
      'DELIVERED': 'bg-indigo-500',
      'COMPLETED': 'bg-green-600',
      'PARTIAL': 'bg-orange-500',
      'ISSUED': 'bg-blue-500',
      'PAID': 'bg-green-500',
      'UNPAID': 'bg-red-500',
      'OVERDUE': 'bg-red-600',
      'PENDING': 'bg-yellow-500',
    }
    return colors[status] || 'bg-gray-500'
  }

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = {
      'DRAFT': 'ฉบับร่าง',
      'SENT': 'ส่งแล้ว',
      'ACCEPTED': 'อนุมัติ',
      'REJECTED': 'ปฏิเสธ',
      'EXPIRED': 'หมดอายุ',
      'CANCELLED': 'ยกเลิก',
      'CONFIRMED': 'ยืนยัน',
      'PROCESSING': 'กำลังดำเนินการ',
      'READY': 'พร้อมส่ง',
      'DELIVERED': 'ส่งแล้ว',
      'COMPLETED': 'เสร็จสิ้น',
      'PARTIAL': 'ส่งบางส่วน',
      'ISSUED': 'ออกใบแล้ว',
      'PAID': 'ชำระแล้ว',
      'UNPAID': 'ค้างชำระ',
      'OVERDUE': 'เกินกำหนด',
      'PENDING': 'รอดำเนินการ',
    }
    return texts[status] || status
  }

  const formatCurrency = (amount: number) => {
    return `฿${amount?.toLocaleString('th-TH') || 0}`
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('th-TH')
  }

  // Overview Tab Content
  const OverviewContent = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-cyber-primary/20 to-cyber-secondary/20 rounded-xl p-6 border border-cyber-primary/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ยอดขายรวม</p>
              <p className="text-2xl font-bold text-cyber-primary">
                {formatCurrency(summary?.salesOrders.totalSales || 0)}
              </p>
            </div>
            <div className="p-3 bg-cyber-primary/20 rounded-lg">
              <TrendingUp className="w-6 h-6 text-cyber-primary" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-cyber-purple/20 to-cyber-magenta/20 rounded-xl p-6 border border-cyber-purple/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">คำสั่งขาย</p>
              <p className="text-2xl font-bold text-cyber-purple">
                {summary?.salesOrders.total || 0}
              </p>
            </div>
            <div className="p-3 bg-cyber-purple/20 rounded-lg">
              <ShoppingCart className="w-6 h-6 text-cyber-purple" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-cyber-green/20 to-emerald-500/20 rounded-xl p-6 border border-cyber-green/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">รับเงินวันนี้</p>
              <p className="text-2xl font-bold text-cyber-green">
                {formatCurrency(summary?.receipts.todayReceived || 0)}
              </p>
            </div>
            <div className="p-3 bg-cyber-green/20 rounded-lg">
              <DollarSign className="w-6 h-6 text-cyber-green" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-6 border border-orange-500/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ยอดค้างรับ</p>
              <p className="text-2xl font-bold text-orange-400">
                {formatCurrency(summary?.invoices.outstanding || 0)}
              </p>
            </div>
            <div className="p-3 bg-orange-500/20 rounded-lg">
              <AlertCircle className="w-6 h-6 text-orange-400" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-cyber-card rounded-xl border border-cyber-border p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ใบลดหนี้</p>
              <p className="text-xl font-bold text-red-400">
                {formatCurrency(summary?.creditNotes.totalAmount || 0)}
              </p>
              <p className="text-xs text-gray-500">{summary?.creditNotes.total || 0} รายการ</p>
            </div>
            <div className="p-3 bg-red-500/20 rounded-lg">
              <RotateCcw className="w-5 h-5 text-red-400" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-cyber-card rounded-xl border border-cyber-border p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ค้างส่ง (Backorder)</p>
              <p className="text-xl font-bold text-yellow-400">
                {summary?.backorders.pending || 0}
              </p>
              <p className="text-xs text-gray-500">รายการ</p>
            </div>
            <div className="p-3 bg-yellow-500/20 rounded-lg">
              <Package className="w-5 h-5 text-yellow-400" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-cyber-card rounded-xl border border-cyber-border p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">ส่งบางส่วน</p>
              <p className="text-xl font-bold text-orange-400">
                {summary?.salesOrders.partial || 0}
              </p>
              <p className="text-xs text-gray-500">คำสั่งขาย</p>
            </div>
            <div className="p-3 bg-orange-500/20 rounded-lg">
              <ArrowLeftRight className="w-5 h-5 text-orange-400" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Order Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-cyber-card rounded-xl border border-cyber-border p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-cyber-primary" />
            สถานะคำสั่งขาย
          </h3>
          <div className="space-y-3">
            {[
              { label: 'ฉบับร่าง', value: summary?.salesOrders.draft || 0, color: 'text-gray-400' },
              { label: 'กำลังดำเนินการ', value: summary?.salesOrders.processing || 0, color: 'text-yellow-400' },
              { label: 'ส่งบางส่วน', value: summary?.salesOrders.partial || 0, color: 'text-orange-400' },
              { label: 'เสร็จสิ้น', value: summary?.salesOrders.completed || 0, color: 'text-green-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                <span className="text-gray-400">{item.label}</span>
                <span className={`text-xl font-semibold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-cyber-card rounded-xl border border-cyber-border p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyber-green" />
            สถานะการชำระเงิน
          </h3>
          <div className="space-y-3">
            {[
              { label: 'ค้างชำระ', value: summary?.invoices.unpaid || 0, color: 'text-red-400' },
              { label: 'ชำระบางส่วน', value: summary?.invoices.partial || 0, color: 'text-yellow-400' },
              { label: 'ชำระครบแล้ว', value: summary?.invoices.paid || 0, color: 'text-green-400' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center p-3 bg-cyber-dark rounded-lg">
                <span className="text-gray-400">{item.label}</span>
                <span className={`text-xl font-semibold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )

  // Generic table component for data display
  const DataTable = ({ columns, data, renderRow }: { columns: any[], data: any[], renderRow: (item: any) => React.ReactNode }) => (
    <div className="bg-cyber-card rounded-xl border border-cyber-border overflow-hidden">
      <table className="w-full">
        <thead className="bg-cyber-dark border-b border-cyber-border">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`px-6 py-4 text-sm font-medium text-gray-400 ${col.align || 'text-left'}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, idx) => renderRow(item))}
        </tbody>
      </table>
    </div>
  )

  // Quotations Tab Content
  const QuotationsContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาใบเสนอราคา..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />
            กรอง
          </button>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('templates')}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" />
            เทมเพลต
          </button>
          <button 
            onClick={handleCreateQuotation}
            className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors"
          >
            <Plus className="w-4 h-4" />
            สร้างใบเสนอราคา
          </button>
        </div>
      </div>

      <DataTable
        columns={[
          { key: 'number', label: 'เลขที่' },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'date', label: 'วันที่' },
          { key: 'expiry', label: 'หมดอายุ' },
          { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' },
          { key: 'status', label: 'สถานะ', align: 'text-center' },
          { key: 'actions', label: 'จัดการ', align: 'text-center' },
        ]}
        data={quotations.filter(q => 
          q.quotation_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          q.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderRow={(quotation) => (
          <tr key={quotation.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4">
              <span className="font-medium text-cyber-primary">{quotation.quotation_number}</span>
            </td>
            <td className="px-6 py-4">
              <div>
                <p className="font-medium text-white">{quotation.customer_name}</p>
                <p className="text-sm text-gray-500">{quotation.customer_code}</p>
              </div>
            </td>
            <td className="px-6 py-4 text-gray-300">{formatDate(quotation.quotation_date)}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(quotation.expiry_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(quotation.total_amount)}</td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(quotation.status)}`}>
                {getStatusText(quotation.status)}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button 
                  onClick={() => handleViewDetail(quotation, 'ใบเสนอราคา')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="ดูรายละเอียด"
                >
                  <Eye className="w-4 h-4 text-cyber-primary" />
                </button>
                <button 
                  onClick={() => handleEdit(quotation, 'ใบเสนอราคา')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="แก้ไข"
                >
                  <Edit className="w-4 h-4 text-cyber-primary" />
                </button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  // Sales Orders Tab Content
  const OrdersContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาคำสั่งขาย..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />
            กรอง
          </button>
        </div>
        <button 
          onClick={handleCreateSalesOrder}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          สร้างคำสั่งขาย
        </button>
      </div>

      <DataTable
        columns={[
          { key: 'number', label: 'เลขที่ SO' },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'date', label: 'วันที่สั่ง' },
          { key: 'delivery', label: 'กำหนดส่ง' },
          { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' },
          { key: 'status', label: 'สถานะ', align: 'text-center' },
          { key: 'payment', label: 'การชำระ', align: 'text-center' },
          { key: 'actions', label: 'จัดการ', align: 'text-center' },
        ]}
        data={salesOrders.filter(o => 
          o.so_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderRow={(order) => (
          <tr key={order.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4">
              <span className="font-medium text-cyber-primary">{order.so_number}</span>
              {order.quotation_number && (
                <p className="text-xs text-gray-500">QT: {order.quotation_number}</p>
              )}
              {order.pending_qty > 0 && (
                <p className="text-xs text-orange-400">ค้างส่ง: {order.pending_qty}</p>
              )}
            </td>
            <td className="px-6 py-4">
              <div>
                <p className="font-medium text-white">{order.customer_name}</p>
                <p className="text-sm text-gray-500">{order.customer_code}</p>
              </div>
            </td>
            <td className="px-6 py-4 text-gray-300">{formatDate(order.order_date)}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(order.delivery_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(order.total_amount)}</td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(order.status)}`}>
                {getStatusText(order.status)}
              </span>
            </td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(order.payment_status)}`}>
                {getStatusText(order.payment_status)}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button 
                  onClick={() => handleViewDetail(order, 'คำสั่งขาย')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="ดูรายละเอียด"
                >
                  <Eye className="w-4 h-4 text-cyber-primary" />
                </button>
                <button 
                  onClick={() => handleEdit(order, 'คำสั่งขาย')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="แก้ไข"
                >
                  <Edit className="w-4 h-4 text-cyber-primary" />
                </button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  // Invoices Tab Content
  const InvoicesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาใบแจ้งหนี้..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors">
            <Filter className="w-4 h-4" />
            กรอง
          </button>
        </div>
        <button 
          onClick={handleCreateInvoice}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          สร้างใบแจ้งหนี้
        </button>
      </div>

      <DataTable
        columns={[
          { key: 'number', label: 'เลขที่ INV' },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'date', label: 'วันที่' },
          { key: 'due', label: 'ครบกำหนด' },
          { key: 'total', label: 'ยอดรวม', align: 'text-right' },
          { key: 'balance', label: 'คงค้าง', align: 'text-right' },
          { key: 'status', label: 'สถานะ', align: 'text-center' },
          { key: 'actions', label: 'จัดการ', align: 'text-center' },
        ]}
        data={invoices.filter(i => 
          i.invoice_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderRow={(invoice) => (
          <tr key={invoice.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4">
              <span className="font-medium text-cyber-primary">{invoice.invoice_number}</span>
              <p className="text-xs text-gray-500">SO: {invoice.so_number}</p>
            </td>
            <td className="px-6 py-4">
              <div>
                <p className="font-medium text-white">{invoice.customer_name}</p>
                <p className="text-sm text-gray-500">{invoice.customer_code}</p>
              </div>
            </td>
            <td className="px-6 py-4 text-gray-300">{formatDate(invoice.invoice_date)}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(invoice.due_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-white">{formatCurrency(invoice.total_amount)}</td>
            <td className="px-6 py-4 text-right">
              <span className={invoice.balance_amount > 0 ? 'text-red-400 font-medium' : 'text-green-400'}>
                {formatCurrency(invoice.balance_amount)}
              </span>
            </td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(invoice.payment_status)}`}>
                {getStatusText(invoice.payment_status)}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button 
                  onClick={() => handleViewDetail(invoice, 'ใบแจ้งหนี้')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="ดูรายละเอียด"
                >
                  <Eye className="w-4 h-4 text-cyber-primary" />
                </button>
                <button 
                  onClick={() => handleRecordPayment(invoice)}
                  className="p-2 hover:bg-cyber-green/20 rounded-lg transition-colors" 
                  title="บันทึกการรับเงิน"
                >
                  <DollarSign className="w-4 h-4 text-cyber-green" />
                </button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  // Credit Notes Tab Content
  const CreditNotesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาใบลดหนี้..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64"
            />
          </div>
        </div>
        <button 
          onClick={handleCreateCreditNote}
          className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          สร้างใบลดหนี้
        </button>
      </div>

      <DataTable
        columns={[
          { key: 'number', label: 'เลขที่ CN' },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'invoice', label: 'ใบแจ้งหนี้' },
          { key: 'reason', label: 'เหตุผล' },
          { key: 'date', label: 'วันที่' },
          { key: 'amount', label: 'จำนวนเงิน', align: 'text-right' },
          { key: 'status', label: 'สถานะ', align: 'text-center' },
          { key: 'actions', label: 'จัดการ', align: 'text-center' },
        ]}
        data={creditNotes.filter(cn => 
          cn.cn_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cn.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderRow={(cn) => (
          <tr key={cn.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4">
              <span className="font-medium text-red-400">{cn.cn_number}</span>
            </td>
            <td className="px-6 py-4">
              <div>
                <p className="font-medium text-white">{cn.customer_name}</p>
                <p className="text-sm text-gray-500">{cn.customer_code}</p>
              </div>
            </td>
            <td className="px-6 py-4 text-gray-300">{cn.invoice_number}</td>
            <td className="px-6 py-4 text-gray-300">{cn.reason}</td>
            <td className="px-6 py-4 text-gray-300">{formatDate(cn.credit_date)}</td>
            <td className="px-6 py-4 text-right font-medium text-red-400">{formatCurrency(cn.total_amount)}</td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(cn.status)}`}>
                {getStatusText(cn.status)}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button 
                  onClick={() => handleViewDetail(cn, 'ใบลดหนี้')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="ดูรายละเอียด"
                >
                  <Eye className="w-4 h-4 text-cyber-primary" />
                </button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  // Backorders Tab Content
  const BackordersContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="ค้นหาใบค้างส่ง..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyber-primary w-64"
            />
          </div>
        </div>
        <button 
          onClick={handleCreateBackorder}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          สร้างใบค้างส่ง
        </button>
      </div>

      <DataTable
        columns={[
          { key: 'number', label: 'เลขที่ BO' },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'so', label: 'คำสั่งขาย' },
          { key: 'original', label: 'ใบส่งของต้นฉบับ' },
          { key: 'status', label: 'สถานะ', align: 'text-center' },
          { key: 'actions', label: 'จัดการ', align: 'text-center' },
        ]}
        data={backorders.filter(bo => 
          bo.bo_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          bo.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderRow={(bo) => (
          <tr key={bo.id} className="border-b border-cyber-border/50 hover:bg-cyber-dark/50 transition-colors">
            <td className="px-6 py-4">
              <span className="font-medium text-orange-400">{bo.bo_number}</span>
            </td>
            <td className="px-6 py-4">
              <div>
                <p className="font-medium text-white">{bo.customer_name}</p>
                <p className="text-sm text-gray-500">{bo.customer_code}</p>
              </div>
            </td>
            <td className="px-6 py-4 text-gray-300">{bo.so_number}</td>
            <td className="px-6 py-4 text-gray-300">{bo.original_do || '-'}</td>
            <td className="px-6 py-4 text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium text-white ${getStatusColor(bo.status)}`}>
                {getStatusText(bo.status)}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex justify-center gap-2">
                <button 
                  onClick={() => handleViewDetail(bo, 'ใบค้างส่ง')}
                  className="p-2 hover:bg-cyber-primary/20 rounded-lg transition-colors" 
                  title="ดูรายละเอียด"
                >
                  <Eye className="w-4 h-4 text-cyber-primary" />
                </button>
              </div>
            </td>
          </tr>
        )}
      />
    </div>
  )

  // Templates Tab Content
  const TemplatesContent = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">เทมเพลตใบเสนอราคา</h2>
        <button 
          onClick={handleCreateTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          สร้างเทมเพลต
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-cyber-card rounded-xl border border-cyber-border p-6 hover:border-cyber-primary transition-colors"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-cyber-primary/20 rounded-lg">
                <LayoutTemplate className="w-6 h-6 text-cyber-primary" />
              </div>
              {template.is_default === 1 && (
                <span className="px-2 py-1 bg-cyber-green/20 text-cyber-green text-xs rounded-full">
                  ค่าเริ่มต้น
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{template.name}</h3>
            <p className="text-sm text-gray-400 mb-4">{template.description || 'ไม่มีคำอธิบาย'}</p>
            <div className="flex justify-between items-center text-sm text-gray-500 mb-4">
              <span>{template.item_count} รายการ</span>
              <span>หมดอายุ {template.expiration_days} วัน</span>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleEdit(template, 'เทมเพลต')}
                className="flex-1 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-gray-300 hover:border-cyber-primary transition-colors"
              >
                แก้ไข
              </button>
              <button 
                onClick={() => toast('ใช้เทมเพลต: ' + template.name)}
                className="flex-1 py-2 bg-cyber-primary text-cyber-dark font-semibold rounded-lg hover:bg-cyber-primary/80 transition-colors"
              >
                ใช้เทมเพลต
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )

  const tabs = [
    { id: 'overview', label: 'ภาพรวม', icon: TrendingUp },
    { id: 'quotations', label: 'ใบเสนอราคา', icon: FileText },
    { id: 'orders', label: 'คำสั่งขาย', icon: ShoppingCart },
    { id: 'invoices', label: 'ใบแจ้งหนี้', icon: Receipt },
    { id: 'credit-notes', label: 'ใบลดหนี้', icon: RotateCcw },
    { id: 'backorders', label: 'ค้างส่ง', icon: Package },
    { id: 'templates', label: 'เทมเพลต', icon: LayoutTemplate },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center"
      >
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-cyber-primary" />
            การขาย
          </h1>
          <p className="text-gray-400 mt-1">จัดการใบเสนอราคา คำสั่งขาย ใบแจ้งหนี้ และการรับชำระเงิน</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-2 bg-cyber-card p-2 rounded-xl border border-cyber-border"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-cyber-primary text-cyber-dark'
                : 'text-gray-400 hover:text-white hover:bg-cyber-dark'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyber-primary" />
        </div>
      ) : (
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'overview' && <OverviewContent />}
          {activeTab === 'quotations' && <QuotationsContent />}
          {activeTab === 'orders' && <OrdersContent />}
          {activeTab === 'invoices' && <InvoicesContent />}
          {activeTab === 'credit-notes' && <CreditNotesContent />}
          {activeTab === 'backorders' && <BackordersContent />}
          {activeTab === 'templates' && <TemplatesContent />}
        </motion.div>
      )}
    </div>
  )
}

export default Sales
