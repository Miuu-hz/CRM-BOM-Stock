import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Building2,
  X,
  ShoppingCart,
  Heart,
  Lightbulb,
  FileText,
  Clock,
  AlertTriangle,
  MessageSquare,
  UserCheck,
  Truck,
  Upload,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Trash2,
  TrendingUp,
  CreditCard,
  AlertCircle,
  Pencil,
  LayoutList,
  LayoutGrid,
} from 'lucide-react'
import api from '../utils/api'
import SupplierTab from '../components/crm/SupplierTab'
import ImportModal from '../components/common/ImportModal'
import customerRecommendationsApi from '../services/customerRecommendations'

type CustomerType = 'HOTEL' | 'RETAIL' | 'WHOLESALE'
type CustomerSegment = 'VIP' | 'PREMIUM' | 'GROWING' | 'AT_RISK' | 'NEW' | 'SEASONAL' | 'REGULAR'

interface Customer {
  id: string
  code: string
  name: string
  type: CustomerType
  contactName: string
  email: string
  phone: string
  city: string
  creditLimit: number
  status: 'ACTIVE' | 'INACTIVE'
  totalOrders: number
  totalRevenue: number
  segment?: CustomerSegment
  daysSinceLastOrder?: number
  creditUsed?: number
}

interface ActivityLog {
  id: string
  customerId: string
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'
  note: string
  createdAt: string
  createdBy?: string
}

interface CrmSummary {
  totalCustomers: number
  activeCustomers: number
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  recentContacts: {
    customerName: string
    contactName: string
    lastContactAt: string
    lastOrderNumber: string
    totalAmount: number
  }[]
}

interface CustomerInsights {
  stats: {
    totalOrders: number
    totalRevenue: number
    lastOrderDate: string | null
    daysSinceLastOrder?: number
    avgOrderValue?: number
    // Sales module
    totalSO: number
    totalSOAmount: number
    lastSODate?: string
    totalInvoices: number
    totalInvoiced: number
    totalPaid: number
    totalOutstanding: number
    totalQT: number
    totalQTAmount: number
  }
  recentOrders: {
    id: string
    orderNumber: string
    orderDate: string
    totalAmount: number
    status: string
    notes?: string
    items: { productId: string; productName: string; category: string; quantity: number; totalPrice: number }[]
  }[]
  favouriteProducts: {
    productId: string
    name: string
    category: string
    totalQuantity: number
    totalRevenue: number
    stockQty?: number
    unit?: string
  }[]
  recommendations: {
    productId: string
    name: string
    category: string
    sku?: string
    popularity: number
    stockQty?: number
    unit?: string
  }[]
  quotations: {
    id: string
    quotation_number: string
    quotation_date: string
    expiry_date?: string
    status: string
    total_amount: number
    notes?: string
    items: { productName: string; quantity: number; unit_price: number; total_price: number; discount_percent?: number }[]
  }[]
  proposalsHistory: { orderNumber: string; note: string; createdAt: string }[]
  activities?: ActivityLog[]
}

interface OrderPage {
  data: CustomerInsights['recentOrders']
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

function CRM() {
  const [mainTab, setMainTab] = useState<'customers' | 'suppliers'>('customers')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [summary, setSummary] = useState<CrmSummary | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [insights, setInsights] = useState<CustomerInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities'
  >('overview')
  const [showModal, setShowModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [activities, setActivities] = useState<ActivityLog[]>([])
  // Customer list view & pagination
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')
  const [customerPageNum, setCustomerPageNum] = useState(1)
  const [customerLimit, setCustomerLimit] = useState(25)

  // Order pagination
  const [orderPage, setOrderPage] = useState<OrderPage | null>(null)
  const [orderPageNum, setOrderPageNum] = useState(1)
  const [orderLimit, setOrderLimit] = useState(25)
  const [orderPageLoading, setOrderPageLoading] = useState(false)

  // Add new activity
  const handleAddActivity = async (type: string, note: string) => {
    if (!selectedCustomerId || !type || !note?.trim()) {
      throw new Error('Missing required fields')
    }
    const res = await api.post('/activities', { 
      customerId: selectedCustomerId, 
      type, 
      note 
    })
    // Refresh activities after adding
    if (selectedCustomerId) {
      const activitiesRes = await api.get(`/activities/customer/${selectedCustomerId}`)
      setActivities(activitiesRes.data.data || [])
    }
    return res.data.data
  }

  const handleDeleteCustomer = async () => {
    if (!selectedCustomerId) return
    try {
      await api.delete(`/customers/${selectedCustomerId}`)
      setShowModal(false)
      setSelectedCustomerId(null)
      loadData()
    } catch (err) {
      console.error('Delete customer failed', err)
      alert('ไม่สามารถลบลูกค้าได้')
    }
  }

  // Fetch paginated orders
  const fetchOrderPage = useCallback(async (customerId: string, page: number, limit: number) => {
    setOrderPageLoading(true)
    try {
      const res = await api.get(`/customers/${customerId}/orders?page=${page}&limit=${limit}`)
      setOrderPage({ data: res.data.data, pagination: res.data.pagination })
    } catch (e) {
      console.error('Failed to load orders', e)
    } finally {
      setOrderPageLoading(false)
    }
  }, [])

  // Load CRM summary + customer list
  const loadData = async () => {
    setLoading(true)
    try {
      const [summaryRes, customersRes] = await Promise.all([
        api.get('/customers/summary/stats'),
        api.get('/customers'),
      ])
      const raw = summaryRes.data.data
      setSummary({
        totalCustomers: raw.total_customers ?? raw.totalCustomers ?? 0,
        activeCustomers: raw.active_customers ?? raw.activeCustomers ?? 0,
        totalOrders: raw.total_orders ?? raw.totalOrders ?? 0,
        totalRevenue: raw.total_revenue ?? raw.totalRevenue ?? 0,
        avgOrderValue: raw.avg_customer_value ?? raw.avgOrderValue ?? 0,
        recentContacts: raw.recentContacts ?? [],
      })
      setCustomers((customersRes.data.data as any[]).map(c => ({
        ...c,
        totalOrders: c.total_orders ?? c.totalOrders ?? 0,
        totalRevenue: c.total_revenue ?? c.totalRevenue ?? 0,
        creditLimit: c.credit_limit ?? c.creditLimit ?? 0,
        creditUsed: c.credit_used ?? c.creditUsed ?? 0,
        contactName: c.contact_name ?? c.contactName ?? '',
      })))
    } catch (error) {
      console.error('Failed to load CRM data', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load insights when customer changes
  useEffect(() => {
    const loadInsights = async () => {
      if (!selectedCustomerId) {
        setInsights(null)
        setActivities([])
        setOrderPage(null)
        return
      }
      setOrderPageNum(1)
      setOrderLimit(25)
      setInsightsLoading(true)
      try {
        const [insightsRes, activitiesRes] = await Promise.all([
          api.get(`/customers/${selectedCustomerId}/insights`),
          api.get(`/activities/customer/${selectedCustomerId}`)
        ])
        setInsights(insightsRes.data.data)
        setActivities(activitiesRes.data.data || [])
      } catch (error) {
        console.error('Failed to load customer insights:', error)
        setInsights(null)
        setActivities([])
      } finally {
        setInsightsLoading(false)
      }
    }
    
    loadInsights()
  }, [selectedCustomerId])

  // Fetch orders when tab = orders or pagination changes
  useEffect(() => {
    if (activeTab === 'orders' && selectedCustomerId) {
      fetchOrderPage(selectedCustomerId, orderPageNum, orderLimit)
    }
  }, [activeTab, selectedCustomerId, orderPageNum, orderLimit, fetchOrderPage])

  // Auto-calculate customer segment
  const calculateSegment = (customer: Customer, insights: CustomerInsights | null): CustomerSegment => {
    const daysSince = insights?.stats.daysSinceLastOrder || customer.daysSinceLastOrder || 0
    const revenue = customer.totalRevenue
    const orders = customer.totalOrders

    // VIP - ยอดซื้อมากกว่า 500k
    if (revenue > 500000) return 'VIP'

    // Premium - ยอดซื้อ 200k-500k
    if (revenue >= 200000) return 'PREMIUM'

    // At Risk - ไม่ได้สั่งมา 60+ วัน และเคยสั่งแล้ว
    if (daysSince > 60 && orders > 0) return 'AT_RISK'

    // New - ลูกค้าใหม่ (ออเดอร์น้อยกว่า 3)
    if (orders < 3) return 'NEW'

    // Growing - ออเดอร์มากกว่า 5 และยอดเฉลี่ยดี
    if (orders >= 5 && revenue / orders > 20000) return 'GROWING'

    return 'REGULAR'
  }

  const filteredCustomers = (customers || []).filter((customer) => {
    const matchesSearch =
      customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.contactName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      false
    const matchesType = selectedType === 'all' || customer.type === selectedType
    return matchesSearch && matchesType
  })

  // Reset to page 1 when filter changes
  useEffect(() => { setCustomerPageNum(1) }, [searchTerm, selectedType, customerLimit])

  const totalCustomerPages = Math.ceil(filteredCustomers.length / customerLimit)
  const pagedCustomers = filteredCustomers.slice((customerPageNum - 1) * customerLimit, customerPageNum * customerLimit)

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null

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
            <span className="neon-text">CRM</span>
          </h1>
          <p className="text-gray-400">
            {mainTab === 'customers' ? 'จัดการลูกค้าและโอกาสเพิ่มยอดขาย' : 'จัดการผู้ขายและซัพพลายเออร์'}
          </p>
        </div>
        {mainTab === 'customers' && (
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowImportModal(true)}
              className="cyber-btn-secondary flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Import
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { setEditingCustomer(null); setShowCustomerModal(true) }}
              className="cyber-btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Customer
            </motion.button>
          </div>
        )}
      </div>

      {/* Main Tabs: Customers / Suppliers */}
      <div className="flex gap-2 border-b border-cyber-border pb-2">
        <button
          onClick={() => setMainTab('customers')}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
            mainTab === 'customers'
              ? 'bg-cyber-primary/20 text-cyber-primary border-b-2 border-cyber-primary'
              : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark'
          }`}
        >
          <Users className="w-5 h-5" />
          Customers (ลูกค้า)
        </button>
        <button
          onClick={() => setMainTab('suppliers')}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
            mainTab === 'suppliers'
              ? 'bg-cyber-purple/20 text-cyber-purple border-b-2 border-cyber-purple'
              : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-dark'
          }`}
        >
          <Truck className="w-5 h-5" />
          Suppliers (ผู้ขาย)
        </button>
      </div>

      {/* Suppliers Tab Content */}
      {mainTab === 'suppliers' && <SupplierTab />}

      {/* Customers Tab Content */}
      {mainTab === 'customers' && (<>


      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="ลูกค้าทั้งหมด"
          value={summary?.totalCustomers?.toLocaleString('th-TH') ?? '-'}
          icon={Users}
        />
        <StatCard
          label="ลูกค้าที่ใช้งานอยู่"
          value={summary?.activeCustomers?.toLocaleString('th-TH') ?? '-'}
          icon={Building2}
        />
        <StatCard
          label="ยอดซื้อรวม"
          value={
            summary?.totalRevenue
              ? `฿${(summary?.totalRevenue ?? 0).toLocaleString('th-TH', {
                  maximumFractionDigits: 0,
                })}`
              : '-'
          }
          icon={Users}
        />
        <StatCard
          label="ยอดสั่งซื้อเฉลี่ย/ออเดอร์"
          value={
            summary
              ? `฿${summary.avgOrderValue?.toLocaleString('th-TH', {
                  maximumFractionDigits: 0,
                })}`
              : '-'
          }
          icon={Users}
        />
      </div>

      {/* Filters and Search */}
      <div className="cyber-card p-4">
        <div className="flex flex-col md:flex-row gap-3 items-center">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>

          {/* Type Filter */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'HOTEL', 'WHOLESALE', 'RETAIL'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedType === t
                    ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                    : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
                }`}
              >
                {t === 'all' ? 'All' : t === 'HOTEL' ? 'Hotels' : t === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
              </button>
            ))}
          </div>

          {/* Per-page selector */}
          <div className="flex items-center gap-1 text-sm text-gray-400">
            <span className="whitespace-nowrap">แสดง</span>
            {[25, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setCustomerLimit(n)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  customerLimit === n
                    ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                    : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-cyber-darker border border-cyber-border rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('card')}
              className={`p-1.5 rounded transition-all ${viewMode === 'card' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-gray-500 px-1">
        <span>พบ <span className="text-gray-300 font-medium">{filteredCustomers.length}</span> รายการ</span>
        {totalCustomerPages > 1 && (
          <span>หน้า {customerPageNum} / {totalCustomerPages}</span>
        )}
      </div>

      {/* Customers — List View */}
      {loading && <p className="text-gray-400 text-center py-8">กำลังโหลดข้อมูลลูกค้า...</p>}

      {!loading && viewMode === 'list' && (
        <div className="cyber-card overflow-hidden">
          <table className="cyber-table">
            <thead>
              <tr>
                <th>ลูกค้า</th>
                <th>ประเภท</th>
                <th>ผู้ติดต่อ</th>
                <th>ออเดอร์</th>
                <th>ยอดซื้อรวม</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {pagedCustomers.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">ไม่พบข้อมูลลูกค้า</td></tr>
              ) : pagedCustomers.map((customer, index) => (
                  <motion.tr
                    key={customer.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="cursor-pointer hover:bg-cyber-primary/5 transition-colors"
                    onClick={() => { setSelectedCustomerId(customer.id); setShowModal(true); setActiveTab('overview') }}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-cyber-primary/10 border border-cyber-primary/20 flex items-center justify-center text-sm font-bold text-cyber-primary">
                          {customer.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-gray-200 font-medium">{customer.name}</p>
                          <p className="text-gray-500 text-xs">{customer.code || customer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge text-xs ${
                        customer.type === 'HOTEL' ? 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30' :
                        customer.type === 'WHOLESALE' ? 'text-purple-400 bg-purple-500/20 border-purple-500/30' :
                        'text-yellow-400 bg-yellow-500/20 border-yellow-500/30'
                      }`}>
                        {customer.type}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">
                        {customer.contactName && <p className="text-gray-300">{customer.contactName}</p>}
                        {customer.phone && <p className="text-gray-500 text-xs">{customer.phone}</p>}
                      </div>
                    </td>
                    <td className="text-cyber-primary font-semibold">{customer.totalOrders ?? 0}</td>
                    <td className="text-cyber-green font-semibold">฿{(customer.totalRevenue ?? 0).toLocaleString()}</td>
                    <td>
                      <span className={`status-badge text-xs ${
                        customer.status === 'ACTIVE' ? 'bg-cyber-green/20 text-cyber-green border-cyber-green/30' :
                        'bg-gray-500/20 text-gray-400 border-gray-500/30'
                      }`}>{customer.status}</span>
                    </td>
                  </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Customers — Card View */}
      {!loading && viewMode === 'card' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pagedCustomers.map((customer, index) => {
            const segment = calculateSegment(customer, null)
            const daysSince = customer.daysSinceLastOrder
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => { setSelectedCustomerId(customer.id); setShowModal(true); setActiveTab('overview') }}
                className="w-full text-left"
              >
                <CustomerCard
                  customer={customer}
                  index={index}
                  segment={segment}
                  daysSinceLastOrder={daysSince}
                  onEdit={(e) => { e.stopPropagation(); setEditingCustomer(customer); setShowCustomerModal(true) }}
                />
              </button>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalCustomerPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setCustomerPageNum(p => Math.max(1, p - 1))}
            disabled={customerPageNum === 1}
            className="p-1.5 rounded-lg hover:bg-cyber-card disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </button>
          {Array.from({ length: Math.min(7, totalCustomerPages) }, (_, i) => {
            const start = Math.max(1, Math.min(customerPageNum - 3, totalCustomerPages - 6))
            const p = start + i
            return (
              <button
                key={p}
                onClick={() => setCustomerPageNum(p)}
                className={`w-8 h-8 text-xs rounded-lg transition-all ${
                  p === customerPageNum
                    ? 'bg-cyber-primary text-white'
                    : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'
                }`}
              >
                {p}
              </button>
            )
          })}
          <button
            onClick={() => setCustomerPageNum(p => Math.min(totalCustomerPages, p + 1))}
            disabled={customerPageNum === totalCustomerPages}
            className="p-1.5 rounded-lg hover:bg-cyber-card disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      )}

      {/* Customer Detail Modal */}
      {showModal && selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          insights={insights}
          insightsLoading={insightsLoading}
          activities={activities}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setShowModal(false)}
          onAddActivity={handleAddActivity}
          onEdit={() => {
            setEditingCustomer(selectedCustomer)
            setShowModal(false)
            setShowCustomerModal(true)
          }}
          onDelete={handleDeleteCustomer}
          orderPage={orderPage}
          orderPageNum={orderPageNum}
          orderLimit={orderLimit}
          orderPageLoading={orderPageLoading}
          onOrderPageChange={(p) => setOrderPageNum(p)}
          onOrderLimitChange={(l) => { setOrderLimit(l); setOrderPageNum(1) }}
        />
      )}

      {/* Add/Edit Customer Modal */}
      <CustomerModal
        open={showCustomerModal}
        customer={editingCustomer}
        onClose={() => { setShowCustomerModal(false); setEditingCustomer(null) }}
        onSave={loadData}
      />
      
      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        type="customers"
        onSuccess={loadData}
      />
      </>)}
    </motion.div>
  )
}

function CustomerModal({ open, customer, onClose, onSave }: {
  open: boolean; customer: Customer | null; onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({
    code: '', name: '', type: 'RETAIL', contactName: '', email: '', phone: '',
    city: '', creditLimit: 0, status: 'ACTIVE'
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (customer) {
      setForm({
        code: customer.code, name: customer.name, type: customer.type,
        contactName: customer.contactName, email: customer.email, phone: customer.phone,
        city: customer.city, creditLimit: customer.creditLimit, status: customer.status
      })
    } else {
      setForm({ code: '', name: '', type: 'RETAIL', contactName: '', email: '', phone: '',
        city: '', creditLimit: 0, status: 'ACTIVE' })
    }
  }, [customer, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (customer) {
        await api.put(`/customers/${customer.id}`, form)
      } else {
        await api.post('/customers', form)
      }
      onSave()
      onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="cyber-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-cyber-border flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-100">
                {customer ? 'Edit Customer' : 'New Customer'}
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Code *</label>
                  <input type="text" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="cyber-input w-full" required disabled={!!customer}
                    placeholder="CUS-001" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Name *</label>
                  <input type="text" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="cyber-input w-full" required placeholder="Customer Name" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="cyber-input w-full">
                    <option value="RETAIL">Retail</option>
                    <option value="HOTEL">Hotel</option>
                    <option value="WHOLESALE">Wholesale</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="cyber-input w-full">
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Contact Name *</label>
                  <input type="text" value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="cyber-input w-full" required placeholder="Contact Person" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Phone *</label>
                  <input type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="cyber-input w-full" required placeholder="081-234-5678" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Email</label>
                  <input type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="cyber-input w-full" placeholder="email@example.com" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">City</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="cyber-input w-full" placeholder="Bangkok" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Credit Limit (฿)</label>
                <input type="number" value={form.creditLimit}
                  onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
                  className="cyber-input w-full" min="0" placeholder="0" />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:bg-cyber-dark">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="cyber-btn-primary flex items-center gap-2">
                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
                  {customer ? 'Update' : 'Create'} Customer
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function CustomerDetailModal({
  customer,
  insights,
  insightsLoading,
  activities,
  activeTab,
  setActiveTab,
  onClose,
  onAddActivity,
  orderPage,
  orderPageNum,
  orderLimit,
  orderPageLoading,
  onOrderPageChange,
  onOrderLimitChange,
  onEdit,
  onDelete,
}: {
  customer: Customer
  insights: CustomerInsights | null
  insightsLoading: boolean
  activities: ActivityLog[]
  activeTab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities'
  setActiveTab: (tab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities') => void
  onClose: () => void
  onAddActivity: (type: string, note: string) => Promise<void>
  orderPage: OrderPage | null
  orderPageNum: number
  orderLimit: number
  orderPageLoading: boolean
  onOrderPageChange: (p: number) => void
  onOrderLimitChange: (l: number) => void
  onEdit: () => void
  onDelete: () => void
}) {
  // State for recommendations
  const [recommendations, setRecommendations] = useState<any[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [showAddRec, setShowAddRec] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [addingRec, setAddingRec] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Load recommendations when tab is active
  useEffect(() => {
    if (activeTab === 'recommendations' && customer.id) {
      fetchRecommendations()
    }
  }, [activeTab, customer.id])

  const fetchRecommendations = async () => {
    setRecommendationsLoading(true)
    try {
      const res = await customerRecommendationsApi.getByCustomer(customer.id)
      setRecommendations(res.data.data)
    } catch (error) {
      console.error('Failed to load recommendations:', error)
    } finally {
      setRecommendationsLoading(false)
    }
  }

  const handleSearchProducts = async (query: string) => {
    setSearchQuery(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await customerRecommendationsApi.searchProducts(query)
      setSearchResults(res.data.data)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setSearching(false)
    }
  }

  const handleAddRecommendation = async (product: any) => {
    setAddingRec(true)
    try {
      await customerRecommendationsApi.create({
        customerId: customer.id,
        productId: product.id,
        productName: product.name,
        productCategory: product.category,
      })
      await fetchRecommendations()
      setSearchQuery('')
      setSearchResults([])
      setShowAddRec(false)
    } catch (error) {
      console.error('Failed to add recommendation:', error)
    } finally {
      setAddingRec(false)
    }
  }

  const handleUpdateRec = async (id: string, status: string) => {
    try {
      await customerRecommendationsApi.update(id, { status })
      await fetchRecommendations()
    } catch (error) {
      console.error('Failed to update recommendation:', error)
    }
  }

  const handleDeleteRec = async (id: string) => {
    if (!confirm('ลบรายการแนะนำนี้?')) return
    try {
      await customerRecommendationsApi.delete(id)
      await fetchRecommendations()
    } catch (error) {
      console.error('Failed to delete recommendation:', error)
    }
  }

  const tabs = [
    { id: 'overview',         label: 'ภาพรวม',       icon: Users },
    { id: 'orders',           label: 'ออเดอร์',       icon: ShoppingCart },
    { id: 'favourites',       label: 'ซื้อบ่อย',      icon: Heart },
    { id: 'recommendations',  label: 'แนะนำสินค้า',   icon: Lightbulb },
    { id: 'proposals',        label: 'ใบเสนอราคา',    icon: FileText },
    { id: 'activities',       label: 'ติดตาม',        icon: Clock },
  ] as const

  const totalRevenue = (insights?.stats?.totalRevenue ?? 0) + (insights?.stats?.totalPaid ?? 0)
  const totalOrders  = (insights?.stats?.totalOrders ?? 0) + (insights?.stats?.totalSO ?? 0)
  const lastDate = (() => {
    const d1 = insights?.stats?.lastOrderDate
    const d2 = insights?.stats?.lastSODate
    return d1 && d2 ? (d1 > d2 ? d1 : d2) : (d1 || d2)
  })()

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-cyber-darker border border-cyber-primary/40 rounded-2xl shadow-2xl shadow-cyber-primary/10 w-full max-w-5xl max-h-[95vh] flex overflow-hidden"
      >
        {/* ── LEFT SIDEBAR ─────────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 bg-cyber-card/40 border-r border-cyber-border flex flex-col overflow-y-auto">
          {/* Avatar + Name */}
          <div className="relative p-5 text-center bg-gradient-to-b from-cyber-primary/10 to-transparent border-b border-cyber-border/50">
            <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-cyber-card/60 transition-colors">
              <X className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center mx-auto mb-3 shadow-lg shadow-cyber-primary/30">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-base font-bold text-white leading-tight">{customer.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{customer.code}</p>
            <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyber-primary/15 text-cyber-primary border border-cyber-primary/20">{customer.type}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${customer.status === 'ACTIVE' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{customer.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด'}</span>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3 justify-center">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyber-primary/10 text-cyber-primary border border-cyber-primary/20 hover:bg-cyber-primary/20 text-xs transition-all"
              >
                <Pencil className="w-3 h-3" />แก้ไข
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-xs transition-all"
                >
                  <Trash2 className="w-3 h-3" />ลบ
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={onDelete}
                    className="px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs hover:bg-red-600 transition-all font-semibold"
                  >
                    ยืนยันลบ
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1.5 rounded-lg bg-cyber-card text-gray-400 text-xs hover:bg-cyber-card/80 transition-all"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Contact */}
          <div className="p-4 space-y-2.5 border-b border-cyber-border/50">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">ข้อมูลติดต่อ</p>
            {customer.contactName && (
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="text-xs text-gray-300 truncate">{customer.contactName}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="text-xs text-gray-300 truncate">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-cyber-primary flex-shrink-0" />
                <span className="text-xs text-white font-semibold">{customer.phone}</span>
              </div>
            )}
            {customer.city && (
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="text-xs text-gray-300 truncate">{customer.city}</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="p-4 space-y-4 flex-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">สถิติการซื้อ</p>

            <div>
              <p className="text-xs text-gray-400 mb-0.5">ยอดซื้อรวม</p>
              <p className="text-xl font-bold text-cyber-green">฿{totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
                วงเงินเครดิต
                {customer.creditUsed !== undefined && customer.creditUsed > customer.creditLimit * 0.8 && (
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                )}
              </p>
              <p className="text-lg font-bold text-cyber-purple">฿{(customer.creditLimit ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
              {customer.creditUsed !== undefined && customer.creditLimit > 0 && (
                <div className="mt-1.5">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">ใช้ไป</span>
                    <span className={customer.creditUsed > customer.creditLimit * 0.9 ? 'text-red-400' : customer.creditUsed > customer.creditLimit * 0.7 ? 'text-yellow-400' : 'text-green-400'}>
                      {((customer.creditUsed / customer.creditLimit) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-cyber-darker h-1.5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${customer.creditUsed > customer.creditLimit * 0.9 ? 'bg-red-500' : customer.creditUsed > customer.creditLimit * 0.7 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min((customer.creditUsed / customer.creditLimit) * 100, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-cyber-darker/60 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">ออเดอร์</p>
                <p className="text-lg font-bold text-cyber-primary">{totalOrders}</p>
              </div>
              <div className="bg-cyber-darker/60 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">ล่าสุด</p>
                <p className="text-xs font-semibold text-white">{lastDate ? new Date(lastDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}</p>
              </div>
            </div>

            {insights && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-500/5 border border-green-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 mb-0.5">ชำระแล้ว</p>
                  <p className="text-xs font-bold text-cyber-green">฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-orange-500/5 border border-orange-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 mb-0.5">ค้างชำระ</p>
                  <p className="text-xs font-bold text-orange-400">฿{(insights.stats.totalOutstanding ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Nav */}
          <div className="border-b border-cyber-border bg-cyber-darker/80 px-4 flex-shrink-0">
            <div className="flex gap-0.5 overflow-x-auto no-scrollbar pt-3">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as typeof activeTab)}
                  className={`px-3 py-2 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
                    activeTab === id
                      ? 'border-cyber-primary text-cyber-primary'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-5">
          {insightsLoading && (
            <div className="text-center py-12">
              <p className="text-gray-400">กำลังโหลดข้อมูลลูกค้า...</p>
            </div>
          )}

          {!insightsLoading && activeTab === 'overview' && (
            <div className="space-y-4">
              {insights ? (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="cyber-card p-3 text-center border border-cyber-primary/10">
                      <p className="text-xs text-gray-400 mb-1">ออเดอร์ทั้งหมด</p>
                      <p className="text-2xl font-bold text-cyber-primary">
                        {((insights.stats.totalOrders ?? 0) + (insights.stats.totalSO ?? 0)).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">SO {insights.stats.totalSO ?? 0} · เก่า {insights.stats.totalOrders ?? 0}</p>
                    </div>
                    <div className="cyber-card p-3 text-center border border-cyber-green/10">
                      <p className="text-xs text-gray-400 mb-1">ยอดซื้อรวม</p>
                      <p className="text-2xl font-bold text-cyber-green">
                        ฿{((insights.stats.totalRevenue ?? 0) + (insights.stats.totalPaid ?? 0)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">ชำระแล้ว ฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className="cyber-card p-3 text-center border border-gray-700/30">
                      <p className="text-xs text-gray-400 mb-1">ออเดอร์ล่าสุด</p>
                      <p className="text-sm font-bold text-white">
                        {lastDate ? new Date(lastDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}
                      </p>
                      {insights.stats.daysSinceLastOrder !== undefined && (
                        <p className={`text-xs mt-0.5 ${insights.stats.daysSinceLastOrder > 60 ? 'text-red-400' : insights.stats.daysSinceLastOrder > 30 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {insights.stats.daysSinceLastOrder} วันที่แล้ว
                        </p>
                      )}
                    </div>
                  </div>

                  {/* QT / SO / INV breakdown */}
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> รายละเอียดเอกสาร
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="cyber-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-blue-400" />
                          <span className="text-xs text-gray-400">ใบเสนอราคา (QT)</span>
                        </div>
                        <p className="text-lg font-bold text-blue-400">{insights.stats.totalQT ?? 0} ใบ</p>
                        <p className="text-xs text-gray-500">฿{(insights.stats.totalQTAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div className="cyber-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ShoppingCart className="w-4 h-4 text-purple-400" />
                          <span className="text-xs text-gray-400">คำสั่งขาย (SO)</span>
                        </div>
                        <p className="text-lg font-bold text-purple-400">{insights.stats.totalSO ?? 0} ใบ</p>
                        <p className="text-xs text-gray-500">฿{(insights.stats.totalSOAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div className="cyber-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <CreditCard className="w-4 h-4 text-cyber-green" />
                          <span className="text-xs text-gray-400">ชำระแล้ว</span>
                        </div>
                        <p className="text-lg font-bold text-cyber-green">฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                        <p className="text-xs text-gray-500">{insights.stats.totalInvoices ?? 0} ใบแจ้งหนี้</p>
                      </div>
                      <div className="cyber-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertCircle className="w-4 h-4 text-orange-400" />
                          <span className="text-xs text-gray-400">ค้างชำระ</span>
                        </div>
                        <p className="text-lg font-bold text-orange-400">฿{(insights.stats.totalOutstanding ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">ยังไม่มีข้อมูล</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-cyber-primary" />
                  ประวัติออเดอร์
                  {orderPage && <span className="text-sm text-gray-400 font-normal">({orderPage.pagination.total} รายการ)</span>}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">แสดง</span>
                  {[25, 50, 100].map(l => (
                    <button key={l} onClick={() => onOrderLimitChange(l)}
                      className={`px-2 py-1 text-xs rounded ${orderLimit === l ? 'bg-cyber-primary text-white' : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {orderPageLoading ? (
                <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
              ) : orderPage && orderPage.data.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {orderPage.data.map((order: any) => (
                      <div key={order.id} className="cyber-card p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-cyber-primary">{order.orderNumber}</span>
                            {order.source === 'SO' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/20">SO</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{new Date(order.orderDate).toLocaleDateString('th-TH')}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-700/50 text-gray-300">{order.status}</span>
                          <span className="font-bold text-cyber-green">฿{(order.totalAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                        </div>
                        {order.items && order.items.length > 0 && (
                          <div className="text-xs text-gray-400 space-y-0.5 border-t border-cyber-border pt-2 mt-2">
                            {order.items.map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between">
                                <span>{item.productName}</span>
                                <span className="text-cyber-primary">x{item.quantity}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {orderPage.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-gray-400">
                        หน้า {orderPage.pagination.page} / {orderPage.pagination.totalPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => onOrderPageChange(orderPageNum - 1)} disabled={orderPageNum <= 1}
                          className="p-1 rounded hover:bg-cyber-card disabled:opacity-30">
                          <ChevronLeft className="w-4 h-4 text-gray-400" />
                        </button>
                        {Array.from({ length: Math.min(5, orderPage.pagination.totalPages) }, (_, i) => {
                          const start = Math.max(1, Math.min(orderPageNum - 2, orderPage.pagination.totalPages - 4))
                          const p = start + i
                          return (
                            <button key={p} onClick={() => onOrderPageChange(p)}
                              className={`w-7 h-7 text-xs rounded ${p === orderPageNum ? 'bg-cyber-primary text-white' : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'}`}>
                              {p}
                            </button>
                          )
                        })}
                        <button onClick={() => onOrderPageChange(orderPageNum + 1)} disabled={orderPageNum >= orderPage.pagination.totalPages}
                          className="p-1 rounded hover:bg-cyber-card disabled:opacity-30">
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-center text-gray-500 py-8">ยังไม่มีประวัติการสั่งซื้อ</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'favourites' && (
            <FavouritesDonutTab products={insights?.favouriteProducts ?? []} />
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-cyber-primary" />สินค้าแนะนำ
                </h3>
                <button onClick={() => setShowAddRec(!showAddRec)} className="cyber-btn-secondary text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" />เพิ่ม
                </button>
              </div>

              {showAddRec && (
                <div className="cyber-card p-4 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={searchQuery} onChange={(e) => handleSearchProducts(e.target.value)}
                      placeholder="ค้นหาสินค้า (2+ ตัวอักษร)..." className="cyber-input w-full pl-10" />
                    {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">ค้นหา...</span>}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {searchResults.map((product) => (
                        <div key={product.id} className="flex items-center justify-between p-2 bg-cyber-dark rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-white">{product.name}</p>
                            <p className="text-xs text-gray-400">{product.sku} • {product.category}</p>
                          </div>
                          <button onClick={() => handleAddRecommendation(product)} disabled={addingRec}
                            className="px-2 py-1 bg-cyber-primary/20 text-cyber-primary rounded text-xs hover:bg-cyber-primary/30">
                            {addingRec ? '...' : 'เพิ่ม'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                    <p className="text-center text-gray-500 text-sm py-2">ไม่พบสินค้า</p>
                  )}
                </div>
              )}

              {recommendationsLoading ? (
                <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
              ) : recommendations.length > 0 ? (
                <div className="space-y-2">
                  {recommendations.map((rec) => (
                    <div key={rec.id} className="cyber-card p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{rec.productName}</p>
                        <p className="text-xs text-gray-400">{rec.productCategory || '-'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded inline-block mt-1 ${
                          rec.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                          rec.status === 'OFFERED' ? 'bg-blue-500/20 text-blue-400' :
                          rec.status === 'ACCEPTED' ? 'bg-green-500/20 text-green-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {rec.status === 'PENDING' ? 'รอเสนอ' : rec.status === 'OFFERED' ? 'เสนอแล้ว' : rec.status === 'ACCEPTED' ? 'สนใจ' : 'ไม่สนใจ'}
                        </span>
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {rec.status === 'PENDING' && (
                          <button onClick={() => handleUpdateRec(rec.id, 'OFFERED')}
                            className="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">เสนอแล้ว</button>
                        )}
                        {rec.status === 'OFFERED' && (
                          <>
                            <button onClick={() => handleUpdateRec(rec.id, 'ACCEPTED')}
                              className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />สนใจ
                            </button>
                            <button onClick={() => handleUpdateRec(rec.id, 'REJECTED')}
                              className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />ไม่สนใจ
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDeleteRec(rec.id)}
                          className="p-1 text-gray-600 hover:text-red-400 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">ยังไม่มีรายการ กด "เพิ่ม" เพื่อเพิ่มสินค้าแนะนำ</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'proposals' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyber-primary" />ใบเสนอราคา (QT) ที่เคยส่ง
              </h3>
              {insights && insights.quotations && insights.quotations.length > 0 ? (
                <div className="space-y-3">
                  {insights.quotations.map((qt) => {
                    const statusColor: Record<string, string> = {
                      DRAFT: 'bg-gray-500/20 text-gray-400', SENT: 'bg-blue-500/20 text-blue-400',
                      ACCEPTED: 'bg-green-500/20 text-green-400', REJECTED: 'bg-red-500/20 text-red-400',
                      EXPIRED: 'bg-orange-500/20 text-orange-400', CONVERTED: 'bg-purple-500/20 text-purple-400',
                    }
                    const statusTH: Record<string, string> = {
                      DRAFT: 'ร่าง', SENT: 'ส่งแล้ว', ACCEPTED: 'อนุมัติ', REJECTED: 'ปฏิเสธ',
                      EXPIRED: 'หมดอายุ', CONVERTED: 'แปลงเป็น SO',
                    }
                    return (
                      <details key={qt.id} className="cyber-card group">
                        <summary className="p-4 cursor-pointer list-none flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-cyber-primary">{qt.quotation_number}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${statusColor[qt.status] || statusColor.DRAFT}`}>
                              {statusTH[qt.status] || qt.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-cyber-green">฿{(qt.total_amount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                            <span className="text-xs text-gray-400">{qt.quotation_date ? new Date(qt.quotation_date).toLocaleDateString('th-TH') : '-'}</span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 border-t border-cyber-border pt-3">
                          {qt.items.length > 0 ? (
                            <div className="space-y-1">
                              {qt.items.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs">
                                  <span className="text-gray-300">{it.productName}</span>
                                  <span className="text-gray-400">x{it.quantity} · ฿{(it.total_price ?? 0).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ) : <p className="text-xs text-gray-500">ไม่มีรายการสินค้า</p>}
                          {qt.notes && <p className="text-xs text-gray-500 mt-2 italic">{qt.notes}</p>}
                        </div>
                      </details>
                    )
                  })}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">ยังไม่มีใบเสนอราคาสำหรับลูกค้านี้</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'activities' && (
            <ActivityLogTab 
              activities={activities}
              onAddActivity={onAddActivity}
            />
          )}
        </div>
        {/* end tab content */}
        </div>
        {/* end right panel */}
      </motion.div>
    </div>
  )
}

// Activity Log Tab Component
function ActivityLogTab({
  activities,
  onAddActivity
}: {
  activities: ActivityLog[];
  onAddActivity: (type: string, note: string) => Promise<void>;
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [activityType, setActivityType] = useState<'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'>('NOTE')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'ALL' | 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'>('ALL')

  const handleAddActivity = async () => {
    if (!note.trim()) return
    setSaving(true)
    try {
      await onAddActivity(activityType, note)
      setNote('')
      setShowAddForm(false)
    } catch (error) {
      console.error('Failed to add activity:', error)
    } finally {
      setSaving(false)
    }
  }

  const typeConfig = {
    CALL:    { label: 'โทรติดตาม',     icon: Phone,        dot: 'bg-blue-500',   border: 'border-l-blue-500',   badge: 'bg-blue-500/10 text-blue-400',   iconColor: 'text-blue-400'   },
    EMAIL:   { label: 'ส่งอีเมล',      icon: Mail,         dot: 'bg-green-500',  border: 'border-l-green-500',  badge: 'bg-green-500/10 text-green-400', iconColor: 'text-green-400'  },
    MEETING: { label: 'พบลูกค้า',      icon: UserCheck,    dot: 'bg-purple-500', border: 'border-l-purple-500', badge: 'bg-purple-500/10 text-purple-400',iconColor: 'text-purple-400' },
    NOTE:    { label: 'บันทึกเพิ่มเติม',icon: MessageSquare,dot: 'bg-gray-500',  border: 'border-l-gray-500',   badge: 'bg-gray-500/10 text-gray-400',   iconColor: 'text-gray-400'   },
  } as const

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1)  return 'เมื่อสักครู่'
    if (m < 60) return `${m} นาทีที่แล้ว`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} ชั่วโมงที่แล้ว`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d} วันที่แล้ว`
    return new Date(dateStr).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const filtered = (activities || []).filter(a => filter === 'ALL' || a.type === filter)

  const filterCounts = (['CALL', 'EMAIL', 'MEETING', 'NOTE'] as const).reduce((acc, t) => {
    acc[t] = (activities || []).filter(a => a.type === t).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyber-primary" />
          ประวัติการติดตามลูกค้า
          {activities?.length > 0 && (
            <span className="text-xs bg-cyber-primary/20 text-cyber-primary px-2 py-0.5 rounded-full">
              {activities.length}
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="cyber-btn-primary text-sm px-3 py-1.5 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          เพิ่มบันทึก
        </button>
      </div>

      {/* Add Activity Form */}
      {showAddForm && (
        <div className="cyber-card p-4 space-y-3 border-2 border-cyber-primary/30">
          <h4 className="font-semibold text-white text-sm">เพิ่มบันทึกการติดตาม</h4>
          <div className="flex gap-2 flex-wrap">
            {(['NOTE', 'CALL', 'EMAIL', 'MEETING'] as const).map((type) => {
              const cfg = typeConfig[type]
              const Icon = cfg.icon
              return (
                <button
                  key={type}
                  onClick={() => setActivityType(type)}
                  className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all border ${
                    activityType === type
                      ? `${cfg.badge} border-current font-semibold`
                      : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80 border-cyber-border'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${activityType === type ? '' : 'opacity-60'}`} />
                  {cfg.label}
                </button>
              )
            })}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="บันทึกรายละเอียด..."
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary min-h-[80px] resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowAddForm(false); setNote('') }}
              className="px-4 py-1.5 rounded-lg text-sm bg-cyber-card text-gray-400 hover:bg-cyber-card/80"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleAddActivity}
              disabled={!note.trim() || saving}
              className="px-4 py-1.5 rounded-lg text-sm bg-cyber-primary text-white hover:bg-cyber-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      {activities && activities.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1 rounded-full text-xs transition-all ${
              filter === 'ALL'
                ? 'bg-cyber-primary text-white font-semibold'
                : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'
            }`}
          >
            ทั้งหมด ({activities.length})
          </button>
          {(['CALL', 'EMAIL', 'MEETING', 'NOTE'] as const).filter(t => filterCounts[t] > 0).map((type) => {
            const cfg = typeConfig[type]
            const Icon = cfg.icon
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 transition-all ${
                  filter === type
                    ? `${cfg.badge} font-semibold ring-1 ring-current`
                    : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'
                }`}
              >
                <Icon className="w-3 h-3" />
                {cfg.label} ({filterCounts[type]})
              </button>
            )
          })}
        </div>
      )}

      {/* Activities Timeline */}
      <div className="space-y-2">
        {filtered.length > 0 ? (
          filtered.map((activity, idx) => {
            const cfg = typeConfig[activity.type as keyof typeof typeConfig] ?? typeConfig.NOTE
            const Icon = cfg.icon
            return (
              <div key={activity.id} className="flex gap-3 group">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center pt-1 min-w-[20px]">
                  <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ring-2 ring-cyber-bg flex-shrink-0`} />
                  {idx < filtered.length - 1 && (
                    <div className="w-px flex-1 bg-cyber-border/50 mt-1 mb-1" />
                  )}
                </div>
                {/* Card */}
                <div className={`flex-1 bg-cyber-card rounded-lg p-3 mb-2 border-l-2 ${cfg.border} transition-all group-hover:bg-cyber-card/80`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {activity.createdBy && (
                        <span className="text-xs text-gray-500">โดย {activity.createdBy}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-xs text-gray-400">{timeAgo(activity.createdAt)}</span>
                      <span className="text-[10px] text-gray-600">
                        {new Date(activity.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{activity.note}</p>
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            {filter !== 'ALL' ? (
              <>
                <p className="text-gray-500">ไม่มีบันทึกประเภท "{typeConfig[filter as keyof typeof typeConfig]?.label}"</p>
                <button onClick={() => setFilter('ALL')} className="text-xs text-cyber-primary mt-2 hover:underline">ดูทั้งหมด</button>
              </>
            ) : (
              <>
                <p className="text-gray-500">ยังไม่มีบันทึกการติดตาม</p>
                <p className="text-xs text-gray-600 mt-1">คลิก "เพิ่มบันทึก" เพื่อเริ่มบันทึกการติดตามลูกค้า</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Donut chart for favourites ────────────────────────────────────────────────
const DONUT_COLORS = ['#06b6d4','#a855f7','#10b981','#f59e0b','#3b82f6','#6b7280']

function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const size = 180
  const cx = size / 2
  const cy = size / 2
  const R = 78
  const r = 48
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total === 0) return null

  let angle = -Math.PI / 2
  const paths = slices.map((sl) => {
    const ratio = sl.value / total
    const sweep = ratio * 2 * Math.PI
    const x1 = cx + R * Math.cos(angle)
    const y1 = cy + R * Math.sin(angle)
    const x2 = cx + R * Math.cos(angle + sweep)
    const y2 = cy + R * Math.sin(angle + sweep)
    const ix1 = cx + r * Math.cos(angle + sweep)
    const iy1 = cy + r * Math.sin(angle + sweep)
    const ix2 = cx + r * Math.cos(angle)
    const iy2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    const d = `M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${large},0 ${ix2},${iy2} Z`
    angle += sweep
    return { d, color: sl.color, pct: Math.round(ratio * 100), label: sl.label }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} opacity={0.9}>
          <title>{p.label} {p.pct}%</title>
        </path>
      ))}
      <circle cx={cx} cy={cy} r={r - 2} fill="#0f172a" />
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#e2e8f0" fontSize="20" fontWeight="bold">{paths[0]?.pct}%</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize="9">{paths[0]?.label.substring(0, 10)}</text>
    </svg>
  )
}

function FavouritesDonutTab({ products }: { products: any[] }) {
  if (!products || products.length === 0) {
    return (
      <div className="text-center py-16">
        <Heart className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500">ยังไม่มีข้อมูลสินค้าที่ซื้อบ่อย</p>
        <p className="text-xs text-gray-600 mt-1">ข้อมูลจะปรากฏเมื่อมีประวัติการสั่งซื้อ</p>
      </div>
    )
  }

  const totalQty = products.reduce((s, p) => s + (p.totalQuantity ?? 0), 0)
  const top5 = products.slice(0, 5)
  const othersQty = products.slice(5).reduce((s, p) => s + (p.totalQuantity ?? 0), 0)

  const slices = [
    ...top5.map((p, i) => ({
      label: p.name,
      value: p.totalQuantity ?? 0,
      color: DONUT_COLORS[i],
      revenue: p.totalRevenue ?? 0,
      category: p.category ?? '',
    })),
    ...(othersQty > 0 ? [{ label: 'อื่นๆ', value: othersQty, color: DONUT_COLORS[5], revenue: 0, category: '' }] : []),
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-100 flex items-center gap-2">
        <Heart className="w-4 h-4 text-cyber-primary" />สินค้าที่ซื้อบ่อย
        <span className="text-xs text-gray-500 font-normal">รวม {totalQty.toLocaleString()} ชิ้น</span>
      </h3>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Donut */}
        <div className="flex-shrink-0">
          <DonutChart slices={slices} />
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2 w-full">
          {slices.map((sl, i) => {
            const pct = totalQty > 0 ? Math.round((sl.value / totalQty) * 100) : 0
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: sl.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-white font-medium truncate pr-2">{sl.label}</span>
                    <span className="text-xs font-bold flex-shrink-0" style={{ color: sl.color }}>{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-darker rounded-full h-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: sl.color }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[10px] text-gray-500">{sl.category}</span>
                    <span className="text-[10px] text-gray-400">
                      x{sl.value.toLocaleString()}
                      {sl.revenue > 0 && ` · ฿${sl.revenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: any
}) {
  return (
    <div className="cyber-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className="text-2xl font-bold text-cyber-primary font-['Orbitron']">
            {value}
          </p>
        </div>
        <Icon className="w-8 h-8 text-cyber-primary/50" />
      </div>
    </div>
  )
}

// Helper function สำหรับ segment badge
function getSegmentInfo(segment: CustomerSegment) {
  const segmentMap = {
    VIP: { label: 'VIP', color: 'from-yellow-500 to-amber-500', icon: '👑', textColor: 'text-yellow-400' },
    PREMIUM: { label: 'Premium', color: 'from-purple-500 to-pink-500', icon: '⭐', textColor: 'text-purple-400' },
    GROWING: { label: 'เติบโต', color: 'from-green-500 to-emerald-500', icon: '📈', textColor: 'text-green-400' },
    AT_RISK: { label: 'เสี่ยง', color: 'from-red-500 to-orange-500', icon: '⚠️', textColor: 'text-red-400' },
    NEW: { label: 'ใหม่', color: 'from-blue-500 to-cyan-500', icon: '🎯', textColor: 'text-blue-400' },
    SEASONAL: { label: 'ตามฤดู', color: 'from-indigo-500 to-violet-500', icon: '🔄', textColor: 'text-indigo-400' },
    REGULAR: { label: 'ปกติ', color: 'from-gray-500 to-slate-500', icon: '👤', textColor: 'text-gray-400' },
  }
  return segmentMap[segment] || segmentMap.REGULAR
}

function CustomerCard({
  customer,
  index,
  segment,
  daysSinceLastOrder,
  onEdit,
}: {
  customer: Customer
  index: number
  segment: CustomerSegment
  daysSinceLastOrder?: number
  onEdit?: (e: React.MouseEvent) => void
}) {
  const segmentInfo = getSegmentInfo(segment)
  const isAtRisk = daysSinceLastOrder && daysSinceLastOrder > 60

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      className={`cyber-card p-6 glow-effect cursor-pointer ${
        isAtRisk ? 'ring-2 ring-red-500/30' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-gray-100">{customer.name}</h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gradient-to-r ${segmentInfo.color} text-white flex items-center gap-1`}
                title={segmentInfo.label}
              >
                <span>{segmentInfo.icon}</span>
                <span>{segmentInfo.label}</span>
              </span>
            </div>
            <p className="text-sm text-gray-400">{customer.code}</p>
          </div>
        </div>
        {isAtRisk && (
          <div className="ml-2" title={`ไม่ได้สั่งมา ${daysSinceLastOrder} วัน`}>
            <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
          </div>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors ml-2"
            title="Edit Customer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">Contact:</span>
          <span className="text-gray-300">{customer.contactName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Phone className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-cyber-primary" />
          <span className="text-gray-400">{customer.city}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-cyber-border">
        <div>
          <p className="text-xs text-gray-400 mb-1">Orders</p>
          <p className="text-sm font-semibold text-cyber-primary">
            {(customer.totalOrders ?? 0).toLocaleString('th-TH')}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Revenue</p>
          <p className="text-sm font-semibold text-cyber-green">
            ฿
            {(customer.totalRevenue ?? 0).toLocaleString('th-TH', {
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Credit</p>
          <p className="text-sm font-semibold text-cyber-purple">
            ฿
            {(customer.creditLimit ?? 0).toLocaleString('th-TH', {
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

export default CRM
