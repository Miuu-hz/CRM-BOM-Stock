import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Search, Plus, Phone, Mail, MapPin, Building2, X, ShoppingCart, Heart, Lightbulb, FileText, Clock,
  AlertTriangle, MessageSquare, UserCheck, Truck, Upload, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Trash2, TrendingUp, CreditCard, AlertCircle, Pencil, LayoutList, LayoutGrid, Star, Gift, ArrowLeftRight,
  History, RefreshCw, Crown, Target, User,
} from 'lucide-react'
import api from '../services/api'
import SupplierTab from '../components/crm/SupplierTab'
import ImportModal from '../components/common/ImportModal'
import customerRecommendationsApi from '../services/customerRecommendations'
import { useModalClose } from '../hooks/useModalClose'
import { useTranslation } from 'react-i18next'
import { unitLabel } from '../hooks/useUnits'

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
  address: string
  taxId: string
  creditLimit: number
  status: 'ACTIVE' | 'INACTIVE'
  totalOrders: number
  totalRevenue: number
  segment?: CustomerSegment
  daysSinceLastOrder?: number
  creditUsed?: number
  loyalty_points?: number
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
  const { t } = useTranslation()
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
    'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities' | 'loyalty'
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
      alert(t('crm.deleteFailed'))
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
        address: c.address ?? '',
        taxId: c.tax_id ?? c.taxId ?? '',
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
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
            <span className="text-[var(--fg-1)]">{t('crm.title')}</span>
          </h1>
          <p className="text-[var(--fg-3)]">
            {mainTab === 'customers' ? t('crm.subtitleCustomers') : t('crm.subtitleSuppliers')}
          </p>
        </div>
        {mainTab === 'customers' && (
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowImportModal(true)}
              className="phopy-btn-secondary flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              {t('crm.import')}</motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { setEditingCustomer(null); setShowCustomerModal(true) }}
              className="phopy-btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('crm.addCustomer')}</motion.button>
          </div>
        )}
      </div>

      {/* Main Tabs: Customers / Suppliers */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2">
        <button
          onClick={() => setMainTab('customers')}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
            mainTab === 'customers'
              ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-b-2 border-phopy-indigo'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)]'
          }`}
        >
          <Users className="w-5 h-5" />
          {t('crm.tabs.customers')}</button>
        <button
          onClick={() => setMainTab('suppliers')}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all ${
            mainTab === 'suppliers'
              ? 'bg-purple-500/20 text-purple-500 border-b-2 border-purple-500'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--bg)]'
          }`}
        >
          <Truck className="w-5 h-5" />
          {t('crm.tabs.suppliers')}</button>
      </div>

      {/* Suppliers Tab Content */}
      {mainTab === 'suppliers' && <SupplierTab />}

      {/* Customers Tab Content */}
      {mainTab === 'customers' && (<>


      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label={t('crm.stats.totalCustomers')}
          value={summary?.totalCustomers?.toLocaleString('th-TH') ?? '-'}
          icon={Users}
        />
        <StatCard
          label={t('crm.stats.activeCustomers')}
          value={summary?.activeCustomers?.toLocaleString('th-TH') ?? '-'}
          icon={Building2}
        />
        <StatCard
          label={t('crm.stats.totalRevenue')}
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
          label={t('crm.stats.avgOrderValue')}
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
      <div className="phopy-card p-4">
        <div className="flex flex-col md:flex-row gap-3 items-center">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
            <input
              type="text"
              placeholder={t('crm.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="phopy-input pl-10 w-full"
            />
          </div>

          {/* Type Filter */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'HOTEL', 'WHOLESALE', 'RETAIL'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedType === type
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)] hover:border-phopy-indigo/30'
                }`}
              >
                {type === 'all' ? t('crm.customerType.all') : type === 'HOTEL' ? t('crm.customerType.hotel') : type === 'WHOLESALE' ? t('crm.customerType.wholesale') : t('crm.customerType.retail')}
              </button>
            ))}
          </div>

          {/* Per-page selector */}
          <div className="flex items-center gap-1 text-sm text-[var(--fg-3)]">
            <span className="whitespace-nowrap">{t('crm.show')}</span>
            {[25, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setCustomerLimit(n)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  customerLimit === n
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)] hover:border-phopy-indigo/30'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'}`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('card')}
              className={`p-1.5 rounded transition-all ${viewMode === 'card' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-[var(--fg-4)] px-1">
        <span>{t('crm.resultsFound', { count: filteredCustomers.length })}</span>
        {totalCustomerPages > 1 && (
          <span>{t('crm.pageOf', { current: customerPageNum, total: totalCustomerPages })}</span>
        )}
      </div>

      {/* Customers — List View */}
      {loading && <p className="text-[var(--fg-3)] text-center py-8">{t('crm.loading')}</p>}

      {!loading && viewMode === 'list' && (
        <div className="phopy-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="phopy-table">
            <thead>
              <tr>
                <th>{t('crm.table.customer')}</th>
                <th>{t('crm.table.type')}</th>
                <th>{t('crm.table.contact')}</th>
                <th>{t('crm.table.orders')}</th>
                <th>{t('crm.table.totalRevenue')}</th>
                <th>{t('crm.table.status')}</th>
              </tr>
            </thead>
            <tbody>
              {pagedCustomers.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--fg-4)]">{t('crm.noCustomers')}</td></tr>
              ) : pagedCustomers.map((customer, index) => (
                  <motion.tr
                    key={customer.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="cursor-pointer hover:bg-phopy-indigo/5 transition-colors"
                    onClick={() => { setSelectedCustomerId(customer.id); setShowModal(true); setActiveTab('overview') }}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-phopy-indigo/10 border border-phopy-indigo-50 flex items-center justify-center text-sm font-bold text-[var(--primary)]">
                          {customer.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-[var(--fg-2)] font-medium">{customer.name}</p>
                          <p className="text-[var(--fg-4)] text-xs">{customer.code || customer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge text-xs ${
                        customer.type === 'HOTEL' ? 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30' :
                        customer.type === 'WHOLESALE' ? 'text-purple-400 bg-purple-500/20 border-purple-500/30' :
                        'text-warning bg-[var(--warning-soft)] border-warning/30'
                      }`}>
                        {t(`crm.customerType.${customer.type.toLowerCase()}`)}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">
                        {customer.contactName && <p className="text-[var(--fg-2)]">{customer.contactName}</p>}
                        {customer.phone && <p className="text-[var(--fg-4)] text-xs">{customer.phone}</p>}
                      </div>
                    </td>
                    <td className="text-[var(--primary)] font-semibold">{customer.totalOrders ?? 0}</td>
                    <td className="text-success font-semibold">฿{(customer.totalRevenue ?? 0).toLocaleString()}</td>
                    <td>
                      <span className={`status-badge text-xs ${
                        customer.status === 'ACTIVE' ? 'bg-[var(--success-soft)] text-success border-success/30' :
                        'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]'
                      }`}>{t(`crm.status.${customer.status.toLowerCase()}`, { defaultValue: customer.status })}</span>
                    </td>
                  </motion.tr>
              ))}
            </tbody>
          </table>
          </div>
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
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-[var(--fg-3)]" />
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
                    ? 'bg-phopy-indigo text-white'
                    : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {p}
              </button>
            )
          })}
          <button
            onClick={() => setCustomerPageNum(p => Math.min(totalCustomerPages, p + 1))}
            disabled={customerPageNum === totalCustomerPages}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-[var(--fg-3)]" />
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
  const { t } = useTranslation()
  useModalClose(onClose)
  const [form, setForm] = useState({
    code: '', name: '', type: 'RETAIL', contactName: '', email: '', phone: '',
    city: '', address: '', taxId: '', creditLimit: 0, status: 'ACTIVE'
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (customer) {
      setForm({
        code: customer.code, name: customer.name, type: customer.type,
        contactName: customer.contactName, email: customer.email, phone: customer.phone,
        city: customer.city, address: customer.address ?? '', taxId: customer.taxId ?? '', creditLimit: customer.creditLimit, status: customer.status
      })
    } else {
      setForm({ code: '', name: '', type: 'RETAIL', contactName: '', email: '', phone: '',
        city: '', address: '', taxId: '', creditLimit: 0, status: 'ACTIVE' })
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
      alert(err.response?.data?.message || t('crm.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                {customer ? t('crm.modal.editCustomer') : t('crm.modal.newCustomer')}
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg">
                <X className="w-5 h-5 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.code')}</label>
                  <input type="text" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="phopy-input w-full" required disabled={!!customer}
                    placeholder={t('crm.modal.codePlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.name')}</label>
                  <input type="text" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="phopy-input w-full" required placeholder={t('crm.modal.namePlaceholder')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.type')}</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="phopy-input w-full">
                    <option value="RETAIL">{t('crm.customerType.retail')}</option>
                    <option value="HOTEL">{t('crm.customerType.hotel')}</option>
                    <option value="WHOLESALE">{t('crm.customerType.wholesale')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.status')}</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="phopy-input w-full">
                    <option value="ACTIVE">{t('crm.status.active')}</option>
                    <option value="INACTIVE">{t('crm.status.inactive')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.contactName')}</label>
                  <input type="text" value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="phopy-input w-full" required placeholder={t('crm.modal.contactPlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.phone')}</label>
                  <input type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="phopy-input w-full" required placeholder={t('crm.modal.phonePlaceholder')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.email')}</label>
                  <input type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="phopy-input w-full" placeholder={t('crm.modal.emailPlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.city')}</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="phopy-input w-full" placeholder={t('crm.modal.cityPlaceholder')} />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.address')}</label>
                <textarea value={form.address} rows={2}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="phopy-input w-full" placeholder={t('crm.modal.addressPlaceholder')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.taxId')}</label>
                  <input type="text" value={form.taxId} inputMode="numeric" maxLength={13}
                    onChange={(e) => setForm({ ...form, taxId: e.target.value.replace(/\D/g, '') })}
                    className="phopy-input w-full" placeholder={t('crm.modal.taxIdPlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.modal.creditLimit')}</label>
                  <input type="number" value={form.creditLimit}
                    onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
                    className="phopy-input w-full" min="0" placeholder="0" />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:bg-[var(--bg)]">{t('crm.modal.cancel')}</button>
                <button type="submit" disabled={saving}
                  className="phopy-btn-primary flex items-center gap-2">
                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
                  {customer ? t('crm.modal.updateCustomer') : t('crm.modal.createCustomer')}
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
  activeTab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities' | 'loyalty'
  setActiveTab: (tab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities' | 'loyalty') => void
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
  const { t } = useTranslation()
  useModalClose(onClose)
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
    if (!confirm(t('crm.recommendationsTab.confirmDelete', { defaultValue: 'ลบรายการแนะนำนี้?' }))) return
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
    { id: 'loyalty',          label: 'แต้มสะสม',      icon: Star },
  ] as const

  const totalRevenue = (insights?.stats?.totalRevenue ?? 0) + (insights?.stats?.totalPaid ?? 0)
  const totalOrders  = (insights?.stats?.totalOrders ?? 0) + (insights?.stats?.totalSO ?? 0)
  const lastDate = (() => {
    const d1 = insights?.stats?.lastOrderDate
    const d2 = insights?.stats?.lastSODate
    return d1 && d2 ? (d1 > d2 ? d1 : d2) : (d1 || d2)
  })()

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-2" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface-2)] border border-phopy-indigo/40 rounded-2xl shadow-2xl shadow-phopy-indigo/10 w-full max-w-5xl max-h-[95vh] flex overflow-hidden"
      >
        {/* ── LEFT SIDEBAR ─────────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 bg-[var(--surface-2)] border-r border-[var(--border)] flex flex-col overflow-y-auto modal-scroll">
          {/* Avatar + Name */}
          <div className="relative p-5 text-center bg-gradient-to-b from-phopy-indigo/10 to-transparent border-b border-[var(--border)]/50">
            <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
              <X className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--fg-1)]" />
            </button>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-phopy-indigo to-purple-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-phopy-indigo/30">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-base font-bold text-[var(--fg-1)] leading-tight">{customer.name}</h2>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{customer.code}</p>
            <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-phopy-indigo/15 text-[var(--primary)] border border-phopy-indigo-50">{customer.type}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${customer.status === 'ACTIVE' ? 'bg-[var(--success-soft)] text-success border-success/20' : 'bg-[var(--danger-soft)] text-danger border-danger/20'}`}>{customer.status === 'ACTIVE' ? t('crm.status.active') : t('crm.status.inactive')}</span>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3 justify-center">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] border border-phopy-indigo-50 hover:bg-[var(--primary-soft)] text-xs transition-all"
              >
                <Pencil className="w-3 h-3" />แก้ไข
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--danger-soft)] text-danger border border-danger/20 hover:bg-[var(--danger-soft)] text-xs transition-all"
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
                    className="px-2 py-1.5 rounded-lg bg-[var(--surface)] text-[var(--fg-3)] text-xs hover:bg-[var(--surface-2)] transition-all"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Contact */}
          <div className="p-4 space-y-2.5 border-b border-[var(--border)]/50">
            <p className="text-[10px] text-[var(--fg-4)] uppercase tracking-widest font-semibold">{t('crm.detail.contactInfo')}</p>
            {customer.contactName && (
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[var(--fg-4)] flex-shrink-0" />
                <span className="text-xs text-[var(--fg-2)] truncate">{customer.contactName}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-[var(--fg-4)] flex-shrink-0" />
                <span className="text-xs text-[var(--fg-2)] truncate">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
                <span className="text-xs text-[var(--fg-1)] font-semibold">{customer.phone}</span>
              </div>
            )}
            {customer.city && (
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-[var(--fg-4)] flex-shrink-0" />
                <span className="text-xs text-[var(--fg-2)] truncate">{customer.city}</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="p-4 space-y-4 flex-1">
            <p className="text-[10px] text-[var(--fg-4)] uppercase tracking-widest font-semibold">{t('crm.detail.purchaseStats')}</p>

            <div>
              <p className="text-xs text-[var(--fg-3)] mb-0.5">{t('crm.table.totalRevenue')}</p>
              <p className="text-xl font-bold text-success">฿{totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
            </div>

            <div>
              <p className="text-xs text-[var(--fg-3)] mb-0.5 flex items-center gap-1">
                วงเงินเครดิต
                {customer.creditUsed !== undefined && customer.creditUsed > customer.creditLimit * 0.8 && (
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                )}
              </p>
              <p className="text-lg font-bold text-purple-500">฿{(customer.creditLimit ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
              {customer.creditUsed !== undefined && customer.creditLimit > 0 && (
                <div className="mt-1.5">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--fg-4)]">{t('crm.detail.used')}</span>
                    <span className={customer.creditUsed > customer.creditLimit * 0.9 ? 'text-danger' : customer.creditUsed > customer.creditLimit * 0.7 ? 'text-warning' : 'text-success'}>
                      {((customer.creditUsed / customer.creditLimit) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-[var(--surface-2)] h-1.5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${customer.creditUsed > customer.creditLimit * 0.9 ? 'bg-red-500' : customer.creditUsed > customer.creditLimit * 0.7 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min((customer.creditUsed / customer.creditLimit) * 100, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5">
                <p className="text-[10px] text-[var(--fg-4)] mb-0.5">{t('crm.table.orders')}</p>
                <p className="text-lg font-bold text-[var(--primary)]">{totalOrders}</p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5">
                <p className="text-[10px] text-[var(--fg-4)] mb-0.5">{t('crm.detail.latest')}</p>
                <p className="text-xs font-semibold text-[var(--fg-1)]">{lastDate ? new Date(lastDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}</p>
              </div>
            </div>

            {insights && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-500/5 border border-green-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-[var(--fg-4)] mb-0.5">{t('crm.detail.paid')}</p>
                  <p className="text-xs font-bold text-success">฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-orange-500/5 border border-orange-500/10 rounded-lg p-2.5">
                  <p className="text-[10px] text-[var(--fg-4)] mb-0.5">{t('crm.detail.outstanding')}</p>
                  <p className="text-xs font-bold text-warning">฿{(insights.stats.totalOutstanding ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </div>
              </div>
            )}

            {/* Loyalty Points */}
            <button
              onClick={() => setActiveTab('loyalty')}
              className={`w-full bg-yellow-500/5 border rounded-lg p-3 text-left transition-all hover:bg-[var(--warning-soft)] ${activeTab === 'loyalty' ? 'border-yellow-500/50' : 'border-yellow-500/20'}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[10px] text-[var(--fg-4)] flex items-center gap-1"><Star className="w-3 h-3 text-warning" />{t('crm.detail.tabs.loyalty')}</p>
                <span className="text-[10px] text-warning/60">{t('crm.detail.clickForDetails')}</span>
              </div>
              <p className="text-xl font-bold text-warning">{(customer.loyalty_points ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-[var(--fg-4)]">แต้ม</p>
            </button>
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Nav */}
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/80 px-4 flex-shrink-0">
            <div className="flex gap-0.5 overflow-x-auto no-scrollbar pt-3">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as typeof activeTab)}
                  className={`px-3 py-2 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
                    activeTab === id
                      ? 'border-phopy-indigo text-[var(--primary)]'
                      : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:border-[var(--border-strong)]'
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
              <p className="text-[var(--fg-3)]">{t('crm.loading')}</p>
            </div>
          )}

          {!insightsLoading && activeTab === 'overview' && (
            <div className="space-y-4">
              {insights ? (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="phopy-card p-3 text-center border border-phopy-indigo/10">
                      <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.detail.allOrders')}</p>
                      <p className="text-2xl font-bold text-[var(--primary)]">
                        {((insights.stats.totalOrders ?? 0) + (insights.stats.totalSO ?? 0)).toLocaleString()}
                      </p>
                      <p className="text-xs text-[var(--fg-4)] mt-0.5">SO {insights.stats.totalSO ?? 0} · เก่า {insights.stats.totalOrders ?? 0}</p>
                    </div>
                    <div className="phopy-card p-3 text-center border border-success/10">
                      <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.table.totalRevenue')}</p>
                      <p className="text-2xl font-bold text-success">
                        ฿{((insights.stats.totalRevenue ?? 0) + (insights.stats.totalPaid ?? 0)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-xs text-[var(--fg-4)] mt-0.5">ชำระแล้ว ฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className="phopy-card p-3 text-center border border-[var(--border-strong)]">
                      <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.detail.lastOrder')}</p>
                      <p className="text-sm font-bold text-[var(--fg-1)]">
                        {lastDate ? new Date(lastDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}
                      </p>
                      {insights.stats.daysSinceLastOrder !== undefined && (
                        <p className={`text-xs mt-0.5 ${insights.stats.daysSinceLastOrder > 60 ? 'text-danger' : insights.stats.daysSinceLastOrder > 30 ? 'text-warning' : 'text-[var(--fg-4)]'}`}>
                          {insights.stats.daysSinceLastOrder} วันที่แล้ว
                        </p>
                      )}
                    </div>
                  </div>

                  {/* QT / SO / INV breakdown */}
                  <div>
                    <p className="text-xs text-[var(--fg-4)] uppercase tracking-wider mb-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> รายละเอียดเอกสาร
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="phopy-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-blue-400" />
                          <span className="text-xs text-[var(--fg-3)]">{t('crm.detail.quotation')}</span>
                        </div>
                        <p className="text-lg font-bold text-blue-400">{insights.stats.totalQT ?? 0} ใบ</p>
                        <p className="text-xs text-[var(--fg-4)]">฿{(insights.stats.totalQTAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div className="phopy-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ShoppingCart className="w-4 h-4 text-purple-400" />
                          <span className="text-xs text-[var(--fg-3)]">{t('crm.detail.salesOrder')}</span>
                        </div>
                        <p className="text-lg font-bold text-purple-400">{insights.stats.totalSO ?? 0} ใบ</p>
                        <p className="text-xs text-[var(--fg-4)]">฿{(insights.stats.totalSOAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div className="phopy-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <CreditCard className="w-4 h-4 text-success" />
                          <span className="text-xs text-[var(--fg-3)]">{t('crm.detail.paid')}</span>
                        </div>
                        <p className="text-lg font-bold text-success">฿{(insights.stats.totalPaid ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                        <p className="text-xs text-[var(--fg-4)]">{insights.stats.totalInvoices ?? 0} ใบแจ้งหนี้</p>
                      </div>
                      <div className="phopy-card p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertCircle className="w-4 h-4 text-warning" />
                          <span className="text-xs text-[var(--fg-3)]">{t('crm.detail.outstanding')}</span>
                        </div>
                        <p className="text-lg font-bold text-warning">฿{(insights.stats.totalOutstanding ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-[var(--fg-4)]">{t('common.noData')}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-[var(--primary)]" />
                  ประวัติออเดอร์
                  {orderPage && <span className="text-sm text-[var(--fg-3)] font-normal">({orderPage.pagination.total} รายการ)</span>}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--fg-3)]">{t('crm.show')}</span>
                  {[25, 50, 100].map(l => (
                    <button key={l} onClick={() => onOrderLimitChange(l)}
                      className={`px-2 py-1 text-xs rounded ${orderLimit === l ? 'bg-phopy-indigo text-white' : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {orderPageLoading ? (
                <p className="text-center text-[var(--fg-3)] py-8">{t('common.loading')}</p>
              ) : orderPage && orderPage.data.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {orderPage.data.map((order: any) => (
                      <div key={order.id} className="phopy-card p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[var(--primary)]">{order.orderNumber}</span>
                            {order.source === 'SO' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/20">SO</span>
                            )}
                          </div>
                          <span className="text-xs text-[var(--fg-3)]">{new Date(order.orderDate).toLocaleDateString('th-TH')}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-700/50 text-[var(--fg-2)]">{order.status}</span>
                          <span className="font-bold text-success">฿{(order.totalAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                        </div>
                        {order.items && order.items.length > 0 && (
                          <div className="text-xs text-[var(--fg-3)] space-y-0.5 border-t border-[var(--border)] pt-2 mt-2">
                            {order.items.map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between">
                                <span>{item.productName}</span>
                                <span className="text-[var(--primary)]">x{item.quantity}</span>
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
                      <span className="text-xs text-[var(--fg-3)]">{t('crm.ordersTab.pageOf', { current: orderPage.pagination.page, total: orderPage.pagination.totalPages })}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => onOrderPageChange(orderPageNum - 1)} disabled={orderPageNum <= 1}
                          className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-30">
                          <ChevronLeft className="w-4 h-4 text-[var(--fg-3)]" />
                        </button>
                        {Array.from({ length: Math.min(5, orderPage.pagination.totalPages) }, (_, i) => {
                          const start = Math.max(1, Math.min(orderPageNum - 2, orderPage.pagination.totalPages - 4))
                          const p = start + i
                          return (
                            <button key={p} onClick={() => onOrderPageChange(p)}
                              className={`w-7 h-7 text-xs rounded ${p === orderPageNum ? 'bg-phopy-indigo text-white' : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]'}`}>
                              {p}
                            </button>
                          )
                        })}
                        <button onClick={() => onOrderPageChange(orderPageNum + 1)} disabled={orderPageNum >= orderPage.pagination.totalPages}
                          className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-30">
                          <ChevronRight className="w-4 h-4 text-[var(--fg-3)]" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-center text-[var(--fg-4)] py-8">{t('crm.ordersTab.noOrders')}</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'favourites' && (
            <FavouritesDonutTab products={insights?.favouriteProducts ?? []} />
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-[var(--primary)]" />สินค้าแนะนำ
                </h3>
                <button onClick={() => setShowAddRec(!showAddRec)} className="phopy-btn-secondary text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" />เพิ่ม
                </button>
              </div>

              {showAddRec && (
                <div className="phopy-card p-4 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
                    <input type="text" value={searchQuery} onChange={(e) => handleSearchProducts(e.target.value)}
                      placeholder="ค้นหาสินค้า (2+ ตัวอักษร)..." className="phopy-input w-full pl-10" />
                    {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--fg-3)]">{t('crm.recommendationsTab.searching')}</span>}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {searchResults.map((product) => (
                        <div key={product.id} className="flex items-center justify-between p-2 bg-[var(--bg)] rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-[var(--fg-1)]">{product.name}</p>
                            <p className="text-xs text-[var(--fg-3)]">{product.sku} • {product.category}</p>
                          </div>
                          <button onClick={() => handleAddRecommendation(product)} disabled={addingRec}
                            className="px-2 py-1 bg-[var(--primary-soft)] text-[var(--primary)] rounded text-xs hover:bg-phopy-indigo/30">
                            {addingRec ? '...' : 'เพิ่ม'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                    <p className="text-center text-[var(--fg-4)] text-sm py-2">{t('crm.recommendationsTab.noProducts')}</p>
                  )}
                </div>
              )}

              {recommendationsLoading ? (
                <p className="text-center text-[var(--fg-3)] py-8">{t('common.loading')}</p>
              ) : recommendations.length > 0 ? (
                <div className="space-y-2">
                  {recommendations.map((rec) => (
                    <div key={rec.id} className="phopy-card p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--fg-1)] text-sm truncate">{rec.productName}</p>
                        <p className="text-xs text-[var(--fg-3)]">{rec.productCategory || '-'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded inline-block mt-1 ${
                          rec.status === 'PENDING' ? 'bg-[var(--warning-soft)] text-warning' :
                          rec.status === 'OFFERED' ? 'bg-[var(--info-soft)] text-blue-400' :
                          rec.status === 'ACCEPTED' ? 'bg-[var(--success-soft)] text-success' :
                          'bg-[var(--danger-soft)] text-danger'
                        }`}>
                          {t(`crm.recommendationsTab.status.${rec.status.toLowerCase()}`)}
                        </span>
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {rec.status === 'PENDING' && (
                          <button onClick={() => handleUpdateRec(rec.id, 'OFFERED')}
                            className="px-2 py-1 text-xs rounded bg-[var(--info-soft)] text-blue-400 hover:bg-blue-500/30">{t('crm.recommendationsTab.status.offered')}</button>
                        )}
                        {rec.status === 'OFFERED' && (
                          <>
                            <button onClick={() => handleUpdateRec(rec.id, 'ACCEPTED')}
                              className="px-2 py-1 text-xs rounded bg-[var(--success-soft)] text-success hover:bg-green-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />สนใจ
                            </button>
                            <button onClick={() => handleUpdateRec(rec.id, 'REJECTED')}
                              className="px-2 py-1 text-xs rounded bg-[var(--danger-soft)] text-danger hover:bg-[var(--danger-soft)] flex items-center gap-1">
                              <XCircle className="w-3 h-3" />ไม่สนใจ
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDeleteRec(rec.id)}
                          className="p-1 text-[var(--fg-4)] hover:text-danger rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-[var(--fg-4)] py-8">{t('crm.recommendationsTab.empty')}</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'proposals' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
                <FileText className="w-5 h-5 text-[var(--primary)]" />ใบเสนอราคา (QT) ที่เคยส่ง
              </h3>
              {insights && insights.quotations && insights.quotations.length > 0 ? (
                <div className="space-y-3">
                  {insights.quotations.map((qt) => {
                    const statusColor: Record<string, string> = {
                      DRAFT: 'bg-[var(--surface-sunken)] text-[var(--fg-3)]', SENT: 'bg-[var(--info-soft)] text-blue-400',
                      ACCEPTED: 'bg-[var(--success-soft)] text-success', REJECTED: 'bg-[var(--danger-soft)] text-danger',
                      EXPIRED: 'bg-[var(--warning-soft)] text-warning', CONVERTED: 'bg-purple-500/20 text-purple-400',
                    }
                    const statusTH: Record<string, string> = {
                      DRAFT: 'crm.proposalsTab.status.draft', SENT: 'crm.proposalsTab.status.sent', ACCEPTED: 'crm.proposalsTab.status.accepted', REJECTED: 'crm.proposalsTab.status.rejected',
                      EXPIRED: 'crm.proposalsTab.status.expired', CONVERTED: 'crm.proposalsTab.status.converted',
                    }
                    return (
                      <details key={qt.id} className="phopy-card group">
                        <summary className="p-4 cursor-pointer list-none flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-[var(--primary)]">{qt.quotation_number}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${statusColor[qt.status] || statusColor.DRAFT}`}>
                              {t(statusTH[qt.status] || qt.status)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-success">฿{(qt.total_amount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                            <span className="text-xs text-[var(--fg-3)]">{qt.quotation_date ? new Date(qt.quotation_date).toLocaleDateString('th-TH') : '-'}</span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
                          {qt.items.length > 0 ? (
                            <div className="space-y-1">
                              {qt.items.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs">
                                  <span className="text-[var(--fg-2)]">{it.productName}</span>
                                  <span className="text-[var(--fg-3)]">x{it.quantity} · ฿{(it.total_price ?? 0).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ) : <p className="text-xs text-[var(--fg-4)]">{t('crm.proposalsTab.noItems')}</p>}
                          {qt.notes && <p className="text-xs text-[var(--fg-4)] mt-2 italic">{qt.notes}</p>}
                        </div>
                      </details>
                    )
                  })}
                </div>
              ) : (
                <p className="text-center text-[var(--fg-4)] py-8">{t('crm.proposalsTab.noQuotations')}</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'activities' && (
            <ActivityLogTab
              activities={activities}
              onAddActivity={onAddActivity}
            />
          )}

          {activeTab === 'loyalty' && (
            <LoyaltyTab customerId={customer.id} initialPoints={customer.loyalty_points ?? 0} />
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
  const { t } = useTranslation()
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
    CALL:    { label: 'crm.activityTab.types.call',     icon: Phone,        dot: 'bg-blue-500',   border: 'border-l-blue-500',   badge: 'bg-blue-500/10 text-blue-400',   iconColor: 'text-blue-400'   },
    EMAIL:   { label: 'crm.activityTab.types.email',      icon: Mail,         dot: 'bg-green-500',  border: 'border-l-green-500',  badge: 'bg-[var(--success-soft)] text-success', iconColor: 'text-success'  },
    MEETING: { label: 'crm.activityTab.types.meeting',      icon: UserCheck,    dot: 'bg-purple-500', border: 'border-l-purple-500', badge: 'bg-purple-500/10 text-purple-400',iconColor: 'text-purple-400' },
    NOTE:    { label: 'crm.activityTab.types.note',icon: MessageSquare,dot: 'bg-gray-500',  border: 'border-l-gray-500',   badge: 'bg-gray-500/10 text-[var(--fg-3)]',   iconColor: 'text-[var(--fg-3)]'   },
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
        <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--primary)]" />
          ประวัติการติดตามลูกค้า
          {activities?.length > 0 && (
            <span className="text-xs bg-[var(--primary-soft)] text-[var(--primary)] px-2 py-0.5 rounded-full">
              {activities.length}
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="phopy-btn-primary text-sm px-3 py-1.5 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          เพิ่มบันทึก
        </button>
      </div>

      {/* Add Activity Form */}
      {showAddForm && (
        <div className="phopy-card p-4 space-y-3 border-2 border-phopy-indigo/30">
          <h4 className="font-semibold text-[var(--fg-1)] text-sm">{t('crm.activityTab.formTitle')}</h4>
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
                      : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)] border-[var(--border)]'
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
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo min-h-[80px] resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowAddForm(false); setNote('') }}
              className="px-4 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleAddActivity}
              disabled={!note.trim() || saving}
              className="px-4 py-1.5 rounded-lg text-sm bg-phopy-indigo text-white hover:bg-phopy-indigo/80 disabled:opacity-50 disabled:cursor-not-allowed"
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
                ? 'bg-phopy-indigo text-white font-semibold'
                : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]'
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
                    : 'bg-[var(--surface)] text-[var(--fg-3)] hover:bg-[var(--surface-2)]'
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
                  <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ring-2 ring-[var(--bg)] flex-shrink-0`} />
                  {idx < filtered.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--border)]/50 mt-1 mb-1" />
                  )}
                </div>
                {/* Card */}
                <div className={`flex-1 bg-[var(--surface)] rounded-lg p-3 mb-2 border-l-2 ${cfg.border} transition-all group-hover:bg-[var(--surface-2)]`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {activity.createdBy && (
                        <span className="text-xs text-[var(--fg-4)]">โดย {activity.createdBy}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-xs text-[var(--fg-3)]">{timeAgo(activity.createdAt)}</span>
                      <span className="text-[10px] text-[var(--fg-4)]">
                        {new Date(activity.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--fg-2)] leading-relaxed whitespace-pre-wrap">{activity.note}</p>
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-[var(--fg-4)] mx-auto mb-3" />
            {filter !== 'ALL' ? (
              <>
                <p className="text-[var(--fg-4)]">{t('crm.activityTab.noRecordsType', { type: t(typeConfig[filter as keyof typeof typeConfig]?.label || '') })}</p>
                <button onClick={() => setFilter('ALL')} className="text-xs text-[var(--primary)] mt-2 hover:underline">{t('crm.activityTab.viewAll')}</button>
              </>
            ) : (
              <>
                <p className="text-[var(--fg-4)]">{t('crm.activityTab.noRecords')}</p>
                <p className="text-xs text-[var(--fg-4)] mt-1">{t('crm.activityTab.startRecording')}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// -- Donut chart for favourites ----------------------------------------------
const DONUT_COLORS = ['#3949E5','#16A34A','#F5A524','#8B5CF6','#EC4899','#0EA5E9','#EF4444','#64748B','#14B8A6','#A855F7']  // distinct categorical hues

function DonutChart({ slices, centerValue, centerLabel }: { slices: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const size = 200
  const cx = size / 2
  const cy = size / 2
  const R = 88
  const r = 56
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      <defs>
        <filter id="donutDepth" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000000" floodOpacity="0.18" />
        </filter>
      </defs>
      <g filter="url(#donutDepth)">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="var(--surface)" strokeWidth={2.5} strokeLinejoin="round">
            <title>{p.label} · {p.pct}%</title>
          </path>
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r - 3} fill="var(--surface)" />
      <text x={cx} y={cy - 2} textAnchor="middle" fill="var(--fg-1)" fontSize="28" fontWeight="800">{centerValue}</text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="var(--fg-4)" fontSize="11" fontWeight="600">{centerLabel}</text>
    </svg>
  )
}

function FavouritesDonutTab({ products }: { products: any[] }) {
  const { t } = useTranslation()
  if (!products || products.length === 0) {
    return (
      <div className="text-center py-16">
        <Heart className="w-12 h-12 text-[var(--fg-4)] mx-auto mb-3" />
        <p className="text-[var(--fg-4)]">{t('crm.favouritesTab.emptyTitle')}</p>
        <p className="text-xs text-[var(--fg-4)] mt-1">{t('crm.favouritesTab.emptySubtitle')}</p>
      </div>
    )
  }

  const totalQty = products.reduce((s, p) => s + (p.totalQuantity ?? 0), 0)
  const totalRevenue = products.reduce((s, p) => s + (p.totalRevenue ?? 0), 0)
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

  const chips = [
    { label: 'รายการสินค้า', value: products.length.toLocaleString(), unit: 'ชนิด' },
    { label: 'ซื้อรวม', value: totalQty.toLocaleString(), unit: 'ชิ้น' },
    { label: 'มูลค่ารวม', value: `฿${totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`, unit: '' },
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-[var(--fg-1)] flex items-center gap-2">
        <Heart className="w-4 h-4 text-[var(--primary)]" />สินค้าที่ซื้อบ่อย
        <span className="text-xs text-[var(--fg-4)] font-normal">{t('crm.favouritesTab.totalItems', { count: totalQty })}</span>
      </h3>

      <div className="grid grid-cols-3 gap-3">
        {chips.map((ch, i) => (
          <div key={i} className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2.5">
            <p className="text-[11px] text-[var(--fg-4)] mb-0.5">{ch.label}</p>
            <p className="text-lg font-bold text-[var(--fg-1)] leading-none">
              {ch.value}{ch.unit && <span className="text-xs font-medium text-[var(--fg-4)] ml-1">{unitLabel(ch.unit)}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-2xl bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface)] border border-[var(--border)]">
        <div className="flex-shrink-0">
          <DonutChart slices={slices} centerValue={totalQty.toLocaleString()} centerLabel="ชิ้นรวม" />
        </div>

        <div className="flex-1 space-y-2.5 w-full">
          {slices.map((sl, i) => {
            const pct = totalQty > 0 ? Math.round((sl.value / totalQty) * 100) : 0
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold flex-shrink-0 text-white" style={{ backgroundColor: sl.color }}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-[var(--fg-1)] font-medium truncate pr-2">{sl.label}</span>
                    <span className="text-xs font-bold flex-shrink-0" style={{ color: sl.color }}>{pct}%</span>
                  </div>
                  <div className="w-full bg-[var(--surface-2)] rounded-full h-1.5 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: sl.color }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[10px] text-[var(--fg-4)]">{sl.category}</span>
                    <span className="text-[10px] text-[var(--fg-3)]">
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
    <div className="phopy-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
          <p className="text-2xl font-bold text-[var(--primary)]">
            {value}
          </p>
        </div>
        <Icon className="w-8 h-8 text-[var(--primary)]/50" />
      </div>
    </div>
  )
}

// Helper function สำหรับ segment badge
function getSegmentInfo(segment: CustomerSegment) {
  const segmentMap = {
    VIP: { label: 'VIP', color: 'from-yellow-500 to-amber-500', icon: Crown, textColor: 'text-warning' },
    PREMIUM: { label: 'Premium', color: 'from-purple-500 to-pink-500', icon: Star, textColor: 'text-purple-400' },
    GROWING: { label: 'เติบโต', color: 'from-green-500 to-success', icon: TrendingUp, textColor: 'text-success' },
    AT_RISK: { label: 'เสี่ยง', color: 'from-red-500 to-orange-500', icon: AlertTriangle, textColor: 'text-danger' },
    NEW: { label: 'ใหม่', color: 'from-blue-500 to-cyan-500', icon: Target, textColor: 'text-blue-400' },
    SEASONAL: { label: 'ตามฤดู', color: 'from-indigo-500 to-violet-500', icon: RefreshCw, textColor: 'text-indigo-400' },
    REGULAR: { label: 'ปกติ', color: 'from-gray-500 to-slate-500', icon: User, textColor: 'text-[var(--fg-3)]' },
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
  const { t } = useTranslation()
  const segmentInfo = getSegmentInfo(segment)
  const isAtRisk = daysSinceLastOrder && daysSinceLastOrder > 60

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      className={`phopy-card p-6  cursor-pointer ${
        isAtRisk ? 'ring-2 ring-danger/30' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-phopy-indigo to-purple-500 flex items-center justify-center shadow-2">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-[var(--fg-1)]">{customer.name}</h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gradient-to-r ${segmentInfo.color} text-white flex items-center gap-1`}
                title={t(`crm.segments.${segment.toLowerCase()}`, { defaultValue: segmentInfo.label })}
              >
                <segmentInfo.icon className="w-3 h-3" />
                <span>{t(`crm.segments.${segment.toLowerCase()}`, { defaultValue: segmentInfo.label })}</span>
              </span>
            </div>
            <p className="text-sm text-[var(--fg-3)]">{customer.code}</p>
          </div>
        </div>
        {isAtRisk && (
          <div className="ml-2" title={`ไม่ได้สั่งมา ${daysSinceLastOrder} วัน`}>
            <AlertTriangle className="w-5 h-5 text-danger animate-pulse" />
          </div>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg transition-colors ml-2"
            title={t('crm.editCustomer')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-[var(--primary)]" />
          <span className="text-[var(--fg-3)]">{t('crm.contact')}:</span>
          <span className="text-[var(--fg-2)]">{customer.contactName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-[var(--primary)]" />
          <span className="text-[var(--fg-3)]">{customer.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Phone className="w-4 h-4 text-[var(--primary)]" />
          <span className="text-[var(--fg-3)]">{customer.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-[var(--primary)]" />
          <span className="text-[var(--fg-3)]">{customer.city}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[var(--border)]">
        <div>
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.customerCard.orders')}</p>
          <p className="text-sm font-semibold text-[var(--primary)]">
            {(customer.totalOrders ?? 0).toLocaleString('th-TH')}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.customerCard.revenue')}</p>
          <p className="text-sm font-semibold text-success">
            ฿
            {(customer.totalRevenue ?? 0).toLocaleString('th-TH', {
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.customerCard.credit')}</p>
          <p className="text-sm font-semibold text-purple-500">
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

// ── Loyalty Points Tab ─────────────────────────────────────────────────────────
interface LoyaltyTransaction {
  id: string
  type: 'EARN' | 'REDEEM' | 'ADJUST'
  points: number
  balance_after: number
  reference_type: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

function LoyaltyTab({ customerId, initialPoints }: { customerId: string; initialPoints: number }) {
  const { t } = useTranslation()
  const [points, setPoints] = useState(initialPoints)
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'earn' | 'redeem' | null>(null)
  const [inputPoints, setInputPoints] = useState('')
  const [inputAmount, setInputAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Read loyalty config from localStorage (same as Settings page)
  const loyaltyCfg = (() => {
    try {
      const s = localStorage.getItem('pos_loyalty_settings')
      return s ? JSON.parse(s) : { enabled: true, earnRate: 100, redeemRate: 10, minRedeemPoints: 100 }
    } catch { return { enabled: true, earnRate: 100, redeemRate: 10, minRedeemPoints: 100 } }
  })()

  const fetchLoyalty = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/customers/${customerId}/loyalty`)
      setPoints(res.data.data.points)
      setTransactions(res.data.data.transactions)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLoyalty() }, [customerId])

  // Auto-calc points from amount
  const calcPointsFromAmount = (amt: number) =>
    Math.floor(amt / loyaltyCfg.earnRate)

  const handleEarn = async () => {
    const pts = parseInt(inputPoints)
    if (!pts || pts <= 0) { setError(t('crm.loyaltyTab.errors.invalidPoints')); return }
    setSaving(true); setError('')
    try {
      await api.post(`/customers/${customerId}/loyalty/earn`, { points: pts, note })
      await fetchLoyalty()
      setMode(null); setInputPoints(''); setInputAmount(''); setNote('')
    } catch (e: any) {
      setError(e.response?.data?.message || t('common.error'))
    } finally { setSaving(false) }
  }

  const handleRedeem = async () => {
    const pts = parseInt(inputPoints)
    if (!pts || pts <= 0) { setError(t('crm.loyaltyTab.errors.invalidPoints')); return }
    if (pts < loyaltyCfg.minRedeemPoints) { setError(t('crm.loyaltyTab.errors.minRedeem', { min: loyaltyCfg.minRedeemPoints })); return }
    if (pts > points) { setError(t('crm.loyaltyTab.errors.insufficient')); return }
    setSaving(true); setError('')
    try {
      await api.post(`/customers/${customerId}/loyalty/redeem`, { points: pts, note })
      await fetchLoyalty()
      setMode(null); setInputPoints(''); setNote('')
    } catch (e: any) {
      setError(e.response?.data?.message || t('common.error'))
    } finally { setSaving(false) }
  }

  const typeLabel = { EARN: 'crm.loyaltyTab.transactionTypes.earn', REDEEM: 'crm.loyaltyTab.transactionTypes.redeem', ADJUST: 'crm.loyaltyTab.transactionTypes.adjust' }
  const typeBadge = {
    EARN:   'bg-[var(--success-soft)] text-success border border-success/20',
    REDEEM: 'bg-yellow-500/15 text-warning border border-yellow-500/20',
    ADJUST: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--fg-1)] flex items-center gap-2">
          <Star className="w-5 h-5 text-warning" />
          ระบบแต้มสะสม
        </h3>
        <button onClick={fetchLoyalty} className="p-1.5 text-[var(--fg-3)] hover:text-[var(--primary)] rounded-lg hover:bg-phopy-indigo/10 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Points balance card */}
      <div className="bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border border-yellow-500/20 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-[var(--fg-3)] mb-1">{t('crm.loyaltyTab.balance')}</p>
            <p className="text-4xl font-bold text-warning">{points.toLocaleString()}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">แต้ม</p>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-[var(--warning-soft)] flex items-center justify-center">
            <Star className="w-8 h-8 text-warning" />
          </div>
        </div>

        {/* Config info */}
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-yellow-500/10 pt-3">
          <div className="flex items-center gap-1.5 text-[var(--fg-3)]">
            <Gift className="w-3.5 h-3.5 text-success" />
            {t('crm.loyaltyTab.earnRate', { amount: loyaltyCfg.earnRate.toLocaleString() })}
          </div>
          <div className="flex items-center gap-1.5 text-[var(--fg-3)]">
            <ArrowLeftRight className="w-3.5 h-3.5 text-warning" />
            {t('crm.loyaltyTab.redeemRate', { points: loyaltyCfg.redeemRate })}
          </div>
        </div>

        {/* Redeem value */}
        {points > 0 && (
          <div className="mt-2 text-xs text-warning/70">
            {t('crm.loyaltyTab.currentValue', { amount: (points / loyaltyCfg.redeemRate).toLocaleString('th-TH', { maximumFractionDigits: 2 }) })}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { setMode(mode === 'earn' ? null : 'earn'); setError(''); setInputPoints(''); setInputAmount(''); setNote('') }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all border ${
              mode === 'earn' ? 'bg-[var(--success-soft)] text-success border-green-500/40' : 'bg-[var(--success-soft)] text-success border-success/20 hover:bg-[var(--success-soft)]'
            }`}
          >
            <Gift className="w-4 h-4" /> เพิ่มแต้ม
          </button>
          <button
            onClick={() => { setMode(mode === 'redeem' ? null : 'redeem'); setError(''); setInputPoints(''); setNote('') }}
            disabled={points < loyaltyCfg.minRedeemPoints}
            className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === 'redeem' ? 'bg-[var(--warning-soft)] text-warning border-yellow-500/40' : 'bg-[var(--warning-soft)] text-warning border-yellow-500/20 hover:bg-[var(--warning-soft)]'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" /> แลกแต้ม
          </button>
        </div>
      </div>

      {/* Earn form */}
      {mode === 'earn' && (
        <div className="phopy-card p-4 space-y-3 border border-success/20">
          <h4 className="font-semibold text-success text-sm flex items-center gap-2">
            <Gift className="w-4 h-4" /> เพิ่มแต้มให้ลูกค้า
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('crm.loyaltyTab.amountLabel')}</label>
              <input
                type="number" min="0" value={inputAmount}
                onChange={e => { setInputAmount(e.target.value); setInputPoints(String(calcPointsFromAmount(parseFloat(e.target.value) || 0))) }}
                className="phopy-input w-full" placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">{t('crm.loyaltyTab.pointsLabel')}</label>
              <input
                type="number" min="1" value={inputPoints}
                onChange={e => { setInputPoints(e.target.value); setInputAmount('') }}
                className="phopy-input w-full" placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">{t('common.notes')}</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="phopy-input w-full" placeholder="เช่น ซื้อสินค้า SO-2026-00001" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setMode(null); setError('') }} className="px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg-3)] rounded-lg hover:bg-[var(--surface-2)] min-h-[44px]">{t('common.cancel')}</button>
            <button onClick={handleEarn} disabled={saving || !inputPoints} className="px-4 py-1.5 text-sm bg-success text-white rounded-lg hover:bg-success/90 disabled:opacity-50 font-semibold min-h-[44px]">
              {saving ? 'กำลังบันทึก...' : 'เพิ่มแต้ม'}
            </button>
          </div>
        </div>
      )}

      {/* Redeem form */}
      {mode === 'redeem' && (
        <div className="phopy-card p-4 space-y-3 border border-yellow-500/20">
          <h4 className="font-semibold text-warning text-sm flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" /> แลกแต้มเป็นส่วนลด
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--fg-3)] mb-1">จำนวนแต้มที่ต้องการแลก</label>
              <input
                type="number" min="1" max={points} value={inputPoints}
                onChange={e => setInputPoints(e.target.value)}
                className="phopy-input w-full" placeholder={t('crm.loyaltyTab.maxPlaceholder', { max: points })}
              />
            </div>
            <div className="flex flex-col justify-end">
              <p className="text-xs text-[var(--fg-3)] mb-1">มูลค่าส่วนลด</p>
              <p className="text-xl font-bold text-warning">
                ฿{inputPoints ? (parseInt(inputPoints || '0') / loyaltyCfg.redeemRate).toFixed(2) : '0.00'}
              </p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">{t('common.notes')}</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="phopy-input w-full" placeholder="เช่น แลกส่วนลดสำหรับ SO-2026-00002" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setMode(null); setError('') }} className="px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg-3)] rounded-lg hover:bg-[var(--surface-2)] min-h-[44px]">{t('common.cancel')}</button>
            <button onClick={handleRedeem} disabled={saving || !inputPoints} className="px-4 py-1.5 text-sm bg-warning text-white rounded-lg hover:bg-warning/90 disabled:opacity-50 font-semibold min-h-[44px]">
              {saving ? 'กำลังบันทึก...' : 'แลกแต้ม'}
            </button>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div>
        <h4 className="text-sm font-semibold text-[var(--fg-2)] flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-[var(--fg-3)]" />
          ประวัติการใช้งานแต้ม
          {transactions.length > 0 && <span className="text-xs bg-[var(--surface)] px-2 py-0.5 rounded-full text-[var(--fg-3)]">{transactions.length} รายการ</span>}
        </h4>

        {loading ? (
          <p className="text-center text-[var(--fg-3)] py-6 text-sm">{t('common.loading')}</p>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10">
            <Star className="w-10 h-10 text-gray-700 mx-auto mb-2" />
            <p className="text-[var(--fg-4)] text-sm">{t('crm.loyaltyTab.noHistory')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-start gap-3 p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]/50 hover:border-[var(--border)] transition-colors">
                {/* Icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tx.type === 'EARN' ? 'bg-[var(--success-soft)]' : tx.type === 'REDEEM' ? 'bg-yellow-500/15' : 'bg-blue-500/15'}`}>
                  {tx.type === 'EARN' ? <Gift className="w-4 h-4 text-success" />
                    : tx.type === 'REDEEM' ? <ArrowLeftRight className="w-4 h-4 text-warning" />
                    : <Star className="w-4 h-4 text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadge[tx.type]}`}>
                      {t(typeLabel[tx.type])}
                    </span>
                    <span className={`text-sm font-bold ${tx.points > 0 ? 'text-success' : 'text-danger'}`}>
                      {tx.points > 0 ? '+' : ''}{tx.points.toLocaleString()} แต้ม
                    </span>
                  </div>
                  {tx.note && <p className="text-xs text-[var(--fg-2)] mt-1">{tx.note}</p>}
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[var(--fg-4)]">
                      {new Date(tx.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {tx.created_by && ` · ${tx.created_by}`}
                    </span>
                    <span className="text-[10px] text-[var(--fg-4)]">{t('crm.loyaltyTab.balanceAfter', { balance: tx.balance_after.toLocaleString() })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CRM
