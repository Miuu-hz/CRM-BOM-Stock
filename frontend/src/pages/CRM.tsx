import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import api from '../utils/api'
import SupplierTab from '../components/crm/SupplierTab'

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
  }
  recentOrders: {
    id: string
    orderNumber: string
    orderDate: string
    totalAmount: number
    status: string
    notes?: string
    items: {
      productId: string
      productName: string
      category: string
      quantity: number
      totalPrice: number
    }[]
  }[]
  favouriteProducts: {
    productId: string
    name: string
    category: string
    totalQuantity: number
    totalRevenue: number
  }[]
  recommendations: {
    productId: string
    name: string
    category: string
    popularity: number
  }[]
  proposalsHistory: {
    orderNumber: string
    note: string
    createdAt: string
  }[]
  activities?: ActivityLog[]
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
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)

  // Load activities for selected customer
  const fetchActivities = async (customerId: string) => {
    setActivitiesLoading(true)
    try {
      const res = await api.get(`/activities/customer/${customerId}`)
      setActivities(res.data.data)
    } catch (error) {
      console.error('Failed to load activities:', error)
      setActivities([])
    } finally {
      setActivitiesLoading(false)
    }
  }

  // Add new activity
  const handleAddActivity = async (customerId: string, type: string, note: string) => {
    const res = await api.post('/activities', { customerId, type, note })
    // Refresh activities after adding
    await fetchActivities(customerId)
    return res.data.data
  }

  // Load CRM summary + customer list
  const loadData = async () => {
    setLoading(true)
    try {
      const [summaryRes, customersRes] = await Promise.all([
        api.get('/customers/summary/stats'),
        api.get('/customers'),
      ])
      setSummary(summaryRes.data.data)
      setCustomers(customersRes.data.data)
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
  // TODO: Implement /customers/:id/insights endpoint in backend
  useEffect(() => {
    // setInsights(null) // Skip for now
    setInsightsLoading(false)
    
    // Load activities for selected customer
    if (selectedCustomerId) {
      fetchActivities(selectedCustomerId)
    } else {
      setActivities([])
    }
  }, [selectedCustomerId])

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
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.contactName.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = selectedType === 'all' || customer.type === selectedType
    return matchesSearch && matchesType
  })

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
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { setEditingCustomer(null); setShowCustomerModal(true) }}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Customer
          </motion.button>
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
          value={summary?.total_customers?.toLocaleString('th-TH') ?? '-'}
          icon={Users}
        />
        <StatCard
          label="ลูกค้าที่ใช้งานอยู่"
          value={summary?.active_customers?.toLocaleString('th-TH') ?? '-'}
          icon={Building2}
        />
        <StatCard
          label="ยอดซื้อรวม"
          value={
            summary?.total_revenue
              ? `฿${(summary?.total_revenue ?? 0).toLocaleString('th-TH', {
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
              ? `฿${summary.avg_customer_value?.toLocaleString('th-TH', {
                  maximumFractionDigits: 0,
                })}`
              : '-'
          }
          icon={Users}
        />
      </div>

      {/* Filters and Search */}
      <div className="cyber-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
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
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'all'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedType('hotel')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'hotel'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Hotels
            </button>
            <button
              onClick={() => setSelectedType('wholesale')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'wholesale'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Wholesale
            </button>
            <button
              onClick={() => setSelectedType('retail')}
              className={`px-4 py-2 rounded-lg transition-all ${
                selectedType === 'retail'
                  ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                  : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
              }`}
            >
              Retail
            </button>
          </div>
        </div>
      </div>

      {/* Customers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading && <p className="text-gray-400">กำลังโหลดข้อมูลลูกค้า...</p>}
        {!loading &&
          filteredCustomers.map((customer, index) => {
            const segment = calculateSegment(customer, null)
            const daysSince = customer.daysSinceLastOrder
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  setSelectedCustomerId(customer.id)
                  setShowModal(true)
                  setActiveTab('overview')
                }}
                className="w-full text-left"
              >
                <CustomerCard
                  customer={customer}
                  index={index}
                  segment={segment}
                  daysSinceLastOrder={daysSince}
                  onEdit={(e) => {
                    e.stopPropagation()
                    setEditingCustomer(customer)
                    setShowCustomerModal(true)
                  }}
                />
              </button>
            )
          })}
      </div>

      {/* Customer Detail Modal */}
      {showModal && selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          insights={insights}
          insightsLoading={insightsLoading}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Add/Edit Customer Modal */}
      <CustomerModal
        open={showCustomerModal}
        customer={editingCustomer}
        onClose={() => { setShowCustomerModal(false); setEditingCustomer(null) }}
        onSave={loadData}
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
  activeTab,
  setActiveTab,
  onClose,
}: {
  customer: Customer
  insights: CustomerInsights | null
  insightsLoading: boolean
  activeTab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities'
  setActiveTab: (tab: 'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals' | 'activities') => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-cyber-darker border-2 border-cyber-primary/50 rounded-2xl shadow-2xl shadow-cyber-primary/20 max-w-4xl w-full max-h-[90vh] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="border-b border-cyber-border p-6 flex items-start justify-between bg-gradient-to-r from-cyber-card/50 to-cyber-darker">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-cyber-primary mb-1">
                {customer.name}
              </h2>
              <p className="text-sm text-gray-400">
                โค้ด: {customer.code} • ประเภท: {customer.type} • สถานะ: {customer.status}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
          >
            <X className="w-6 h-6 text-gray-400 hover:text-white" />
          </button>
        </div>

        {/* Contact Info */}
        <div className="p-6 border-b border-cyber-border bg-cyber-card/30">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyber-primary" />
              <div>
                <p className="text-xs text-gray-400">ผู้ติดต่อ</p>
                <p className="text-white font-medium">{customer.contactName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-cyber-primary" />
              <div>
                <p className="text-xs text-gray-400">อีเมล</p>
                <p className="text-white font-medium truncate">{customer.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-cyber-primary" />
              <div>
                <p className="text-xs text-gray-400">โทรศัพท์</p>
                <p className="text-white font-medium">{customer.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-cyber-primary" />
              <div>
                <p className="text-xs text-gray-400">ที่ตั้ง</p>
                <p className="text-white font-medium">{customer.city}</p>
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-cyber-border/30">
            <div>
              <p className="text-xs text-gray-400">ยอดซื้อรวมทั้งหมด</p>
              <p className="text-xl font-bold text-cyber-green mt-1">
                ฿{(insights?.stats?.totalRevenue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }) || '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                วงเงินเครดิต
                {customer.creditUsed !== undefined && customer.creditUsed > customer.creditLimit * 0.8 && (
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                )}
              </p>
              <p className="text-xl font-bold text-cyber-purple mt-1">
                ฿{(customer.creditLimit ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
              </p>
              {customer.creditUsed !== undefined && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="text-gray-400">ใช้ไป:</span>
                    <span className={`font-semibold ${
                      customer.creditUsed > customer.creditLimit * 0.9 ? 'text-red-400' :
                      customer.creditUsed > customer.creditLimit * 0.7 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      ฿{(customer.creditUsed ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                      {' '}({((customer.creditUsed / customer.creditLimit) * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div className="w-full bg-cyber-darker h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        customer.creditUsed > customer.creditLimit * 0.9 ? 'bg-red-500' :
                        customer.creditUsed > customer.creditLimit * 0.7 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min((customer.creditUsed / customer.creditLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">จำนวนออเดอร์</p>
              <p className="text-xl font-bold text-cyber-primary mt-1">
                {(insights?.stats?.totalOrders ?? 0).toLocaleString('th-TH') || '-'}
              </p>
              {insights?.stats.avgOrderValue && (
                <p className="text-xs text-gray-400 mt-1">
                  เฉลี่ย: ฿{(insights?.stats?.avgOrderValue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">ออเดอร์ล่าสุด</p>
              <p className="text-sm font-medium text-white mt-1">
                {insights?.stats.lastOrderDate
                  ? new Date(insights.stats.lastOrderDate).toLocaleDateString('th-TH')
                  : '-'}
              </p>
              {insights?.stats.daysSinceLastOrder !== undefined && (
                <p className={`text-xs mt-1 ${
                  insights.stats.daysSinceLastOrder > 60 ? 'text-red-400' :
                  insights.stats.daysSinceLastOrder > 30 ? 'text-yellow-400' :
                  'text-gray-400'
                }`}>
                  {insights.stats.daysSinceLastOrder} วันที่แล้ว
                  {insights.stats.daysSinceLastOrder > 60 && ' ⚠️'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-cyber-border bg-cyber-darker">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'overview'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>ภาพรวม</span>
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'orders'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span>ออเดอร์</span>
            </button>
            <button
              onClick={() => setActiveTab('favourites')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'favourites'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <Heart className="w-4 h-4" />
              <span>สิ่งที่ซื้อบ่อย</span>
            </button>
            <button
              onClick={() => setActiveTab('recommendations')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'recommendations'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <Lightbulb className="w-4 h-4" />
              <span>แนะนำสินค้า</span>
            </button>
            <button
              onClick={() => setActiveTab('proposals')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'proposals'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>สิ่งที่เคยเสนอ</span>
            </button>
            <button
              onClick={() => setActiveTab('activities')}
              className={`px-4 py-2 rounded-t-lg border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'activities'
                  ? 'border-cyber-primary bg-cyber-primary/10 text-cyber-primary'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-cyber-card/30'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>ติดตาม</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-400px)]">
          {insightsLoading && (
            <div className="text-center py-12">
              <p className="text-gray-400">กำลังโหลดข้อมูลลูกค้า...</p>
            </div>
          )}

          {!insightsLoading && activeTab === 'overview' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-cyber-primary" />
                ภาพรวมลูกค้ารายบุคคล
              </h3>
              {insights && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="cyber-card p-4">
                    <p className="text-sm text-gray-400 mb-2">จำนวนออเดอร์ทั้งหมด</p>
                    <p className="text-2xl font-bold text-cyber-primary">
                      {(insights?.stats?.totalOrders ?? 0).toLocaleString('th-TH')}
                    </p>
                  </div>
                  <div className="cyber-card p-4">
                    <p className="text-sm text-gray-400 mb-2">ยอดซื้อรวมทั้งหมด</p>
                    <p className="text-2xl font-bold text-cyber-green">
                      ฿{(insights?.stats?.totalRevenue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="cyber-card p-4">
                    <p className="text-sm text-gray-400 mb-2">การติดต่อล่าสุด</p>
                    <p className="text-lg font-semibold text-white">
                      {insights.stats.lastOrderDate
                        ? new Date(insights.stats.lastOrderDate).toLocaleDateString('th-TH')
                        : '-'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'orders' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-cyber-primary" />
                ออเดอร์ล่าสุด
              </h3>
              {insights && insights.recentOrders.length > 0 ? (
                <div className="space-y-3">
                  {insights.recentOrders.map((order) => (
                    <div
                      key={order.id}
                      className="cyber-card p-4 hover:bg-cyber-card/80 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-semibold text-cyber-primary text-lg">
                          {order.orderNumber}
                        </span>
                        <span className="text-gray-400">
                          {new Date(order.orderDate).toLocaleDateString('th-TH')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm text-gray-400">{order.status}</span>
                        <span className="text-xl font-bold text-cyber-green">
                          ฿{(order?.totalAmount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      {order.items.length > 0 && (
                        <div className="text-sm text-gray-300">
                          <p className="font-semibold mb-1">รายการสินค้า:</p>
                          <ul className="space-y-1">
                            {order.items.map((item, idx) => (
                              <li key={idx} className="flex justify-between">
                                <span>{item.productName}</span>
                                <span className="text-cyber-primary">x{item.quantity}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">ยังไม่มีประวัติการสั่งซื้อ</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'favourites' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Heart className="w-5 h-5 text-cyber-primary" />
                สินค้าที่ซื้อบ่อย (Top Products)
              </h3>
              {insights && insights.favouriteProducts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {insights.favouriteProducts.map((prod) => (
                    <div
                      key={prod.productId}
                      className="cyber-card p-4 hover:bg-cyber-card/80 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-semibold text-white mb-1">{prod.name}</p>
                          <p className="text-xs text-gray-400">หมวด: {prod.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-cyber-primary">
                            x{(prod?.totalQuantity ?? 0).toLocaleString('th-TH')}
                          </p>
                          <p className="text-sm text-cyber-green">
                            ฿{(prod?.totalRevenue ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">ยังไม่มีข้อมูลสินค้าโปรด</p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'recommendations' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-cyber-primary" />
                สินค้าที่แนะนำให้เสนอเพิ่ม
              </h3>
              {insights && insights.recommendations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {insights.recommendations.map((rec) => (
                    <div
                      key={rec.productId}
                      className="cyber-card p-4 hover:bg-cyber-card/80 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold text-white mb-1">{rec.name}</p>
                          <p className="text-xs text-gray-400 mb-2">หมวด: {rec.category}</p>
                          <p className="text-xs text-cyber-primary">
                            ความนิยมรวม: {(rec?.popularity ?? 0).toLocaleString('th-TH')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  ยังไม่มีคำแนะนำสินค้าเพิ่มเติมสำหรับลูกค้าคนนี้
                </p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'proposals' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyber-primary" />
                สิ่งที่เคยเสนอไปแล้ว
              </h3>
              {insights && insights.proposalsHistory.length > 0 ? (
                <div className="space-y-3">
                  {insights.proposalsHistory.map((p) => (
                    <div
                      key={p.orderNumber}
                      className="cyber-card p-4 hover:bg-cyber-card/80 transition-colors"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-cyber-primary">{p.orderNumber}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(p.createdAt).toLocaleDateString('th-TH')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">{p.note}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  ยังไม่มีโน้ต/ข้อเสนอที่บันทึกไว้ในออเดอร์ของลูกค้าคนนี้
                </p>
              )}
            </div>
          )}

          {!insightsLoading && activeTab === 'activities' && (
            <ActivityLogTab 
                  customer={customer} 
                  activities={activities}
                  onAddActivity={(type, note) => handleAddActivity(customer.id, type, note)}
                />
          )}
        </div>
      </motion.div>
    </div>
  )
}

// Activity Log Tab Component
function ActivityLogTab({ 
  customer, 
  activities, 
  onAddActivity 
}: { 
  customer: Customer; 
  activities: ActivityLog[];
  onAddActivity: (type: string, note: string) => Promise<void>;
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [activityType, setActivityType] = useState<'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'>('NOTE')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

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

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'CALL':
        return <Phone className="w-4 h-4 text-blue-400" />
      case 'EMAIL':
        return <Mail className="w-4 h-4 text-green-400" />
      case 'MEETING':
        return <UserCheck className="w-4 h-4 text-purple-400" />
      case 'NOTE':
        return <MessageSquare className="w-4 h-4 text-gray-400" />
      default:
        return <MessageSquare className="w-4 h-4 text-gray-400" />
    }
  }

  const getActivityLabel = (type: string) => {
    switch (type) {
      case 'CALL':
        return 'โทรติดตาม'
      case 'EMAIL':
        return 'ส่งอีเมล'
      case 'MEETING':
        return 'พบลูกค้า'
      case 'NOTE':
        return 'บันทึกเพิ่มเติม'
      default:
        return type
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyber-primary" />
          ประวัติการติดตามลูกค้า
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
          <div className="flex gap-2">
            {(['NOTE', 'CALL', 'EMAIL', 'MEETING'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setActivityType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                  activityType === type
                    ? 'bg-cyber-primary text-white'
                    : 'bg-cyber-card text-gray-400 hover:bg-cyber-card/80'
                }`}
              >
                {getActivityLabel(type)}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="บันทึกรายละเอียด..."
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyber-primary min-h-[80px]"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowAddForm(false)
                setNote('')
              }}
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

      {/* Activities Timeline */}
      <div className="space-y-3">
        {activities && activities.length > 0 ? (
          activities.map((activity, idx) => (
            <div key={activity.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-cyber-card flex items-center justify-center">
                  {getActivityIcon(activity.type)}
                </div>
                {idx < activities.length - 1 && <div className="w-0.5 flex-1 bg-cyber-border mt-2" />}
              </div>
              <div className="flex-1 cyber-card p-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-cyber-primary">
                    {getActivityLabel(activity.type)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(activity.createdAt).toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm text-gray-300">{activity.note}</p>
                {activity.createdBy && (
                  <p className="text-xs text-gray-500 mt-1">โดย: {activity.createdBy}</p>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">ยังไม่มีบันทึกการติดตาม</p>
            <p className="text-xs text-gray-600 mt-1">คลิก "เพิ่มบันทึก" เพื่อเริ่มบันทึกการติดตามลูกค้า</p>
          </div>
        )}
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
