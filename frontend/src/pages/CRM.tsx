import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
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
} from 'lucide-react'
import axios from 'axios'

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

  // Load CRM summary + customer list
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [summaryRes, customersRes] = await Promise.all([
          axios.get('/api/customers/summary'),
          axios.get('/api/customers'),
        ])
        setSummary(summaryRes.data.data)
        setCustomers(customersRes.data.data)
      } catch (error) {
        console.error('Failed to load CRM data', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load insights when customer changes
  useEffect(() => {
    const fetchInsights = async () => {
      if (!selectedCustomerId) return
      setInsightsLoading(true)
      try {
        const res = await axios.get(`/api/customers/${selectedCustomerId}/insights`)
        setInsights(res.data.data)
      } catch (error) {
        console.error('Failed to load customer insights', error)
      } finally {
        setInsightsLoading(false)
      }
    }

    fetchInsights()
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

  const filteredCustomers = customers.filter((customer) => {
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
            <span className="neon-text">Customer Management</span>
          </h1>
          <p className="text-gray-400">
            ภาพรวมลูกค้าและโอกาสเพิ่มยอดขาย
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="cyber-btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Customer
        </motion.button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="ลูกค้าทั้งหมด"
          value={summary ? summary.totalCustomers.toLocaleString('th-TH') : '-'}
          icon={Users}
        />
        <StatCard
          label="ลูกค้าที่ใช้งานอยู่"
          value={summary ? summary.activeCustomers.toLocaleString('th-TH') : '-'}
          icon={Building2}
        />
        <StatCard
          label="ยอดซื้อรวม"
          value={
            summary
              ? `฿${summary.totalRevenue.toLocaleString('th-TH', {
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
              ? `฿${summary.avgOrderValue.toLocaleString('th-TH', {
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
    </motion.div>
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
                ฿{insights?.stats.totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 }) || '-'}
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
                ฿{customer.creditLimit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                      ฿{customer.creditUsed.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                {insights?.stats.totalOrders.toLocaleString('th-TH') || '-'}
              </p>
              {insights?.stats.avgOrderValue && (
                <p className="text-xs text-gray-400 mt-1">
                  เฉลี่ย: ฿{insights.stats.avgOrderValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                      {insights.stats.totalOrders.toLocaleString('th-TH')}
                    </p>
                  </div>
                  <div className="cyber-card p-4">
                    <p className="text-sm text-gray-400 mb-2">ยอดซื้อรวมทั้งหมด</p>
                    <p className="text-2xl font-bold text-cyber-green">
                      ฿{insights.stats.totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                          ฿{order.totalAmount.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                            x{prod.totalQuantity.toLocaleString('th-TH')}
                          </p>
                          <p className="text-sm text-cyber-green">
                            ฿{prod.totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
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
                            ความนิยมรวม: {rec.popularity.toLocaleString('th-TH')}
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
            <ActivityLogTab customer={customer} activities={insights?.activities || []} />
          )}
        </div>
      </motion.div>
    </div>
  )
}

// Activity Log Tab Component
function ActivityLogTab({ customer, activities }: { customer: Customer; activities: ActivityLog[] }) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [activityType, setActivityType] = useState<'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'>('NOTE')
  const [note, setNote] = useState('')

  const handleAddActivity = () => {
    // TODO: ส่งไปยัง API
    console.log('Add activity:', { customerId: customer.id, type: activityType, note })
    setNote('')
    setShowAddForm(false)
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
              disabled={!note.trim()}
              className="px-4 py-1.5 rounded-lg text-sm bg-cyber-primary text-white hover:bg-cyber-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              บันทึก
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
}: {
  customer: Customer
  index: number
  segment: CustomerSegment
  daysSinceLastOrder?: number
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
            {customer.totalOrders.toLocaleString('th-TH')}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Revenue</p>
          <p className="text-sm font-semibold text-cyber-green">
            ฿
            {customer.totalRevenue.toLocaleString('th-TH', {
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Credit</p>
          <p className="text-sm font-semibold text-cyber-purple">
            ฿
            {customer.creditLimit.toLocaleString('th-TH', {
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

export default CRM
