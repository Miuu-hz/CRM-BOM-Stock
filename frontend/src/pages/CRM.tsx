import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Users,
  Search,
  Plus,
  MoreVertical,
  Phone,
  Mail,
  MapPin,
  Building2,
} from 'lucide-react'
import axios from 'axios'

type CustomerType = 'HOTEL' | 'RETAIL' | 'WHOLESALE'

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
    'overview' | 'orders' | 'favourites' | 'recommendations' | 'proposals'
  >('overview')

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
        if (customersRes.data.data.length > 0 && !selectedCustomerId) {
          setSelectedCustomerId(customersRes.data.data[0].id)
        }
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

      {/* Customers List + Per-Customer Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading && <p className="text-gray-400">กำลังโหลดข้อมูลลูกค้า...</p>}
          {!loading &&
            filteredCustomers.map((customer, index) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  setSelectedCustomerId(customer.id)
                  setActiveTab('overview')
                }}
                className="w-full text-left"
              >
                <CustomerCard
                  customer={customer}
                  index={index}
                  selected={customer.id === selectedCustomerId}
                />
              </button>
            ))}
        </div>

        {/* Right panel: CRM insights for selected customer */}
        <div className="space-y-4">
          {/* ถ้ายังไม่เลือกชื่อลูกค้า ให้ขึ้นข้อความแนะนำ */}
          {!selectedCustomer && (
            <div className="cyber-card p-4">
              <p className="text-sm text-gray-400">
                กรุณาเลือกรายชื่อลูกค้าทางซ้ายเพื่อดูภาพรวมและประวัติของลูกค้ารายนั้น
              </p>
            </div>
          )}

          {/* ข้อมูลหัวลูกค้าที่เลือก (per customer header) */}
          {selectedCustomer && (
            <div className="cyber-card p-4 space-y-2">
              <h2 className="text-lg font-semibold text-gray-100 mb-1">
                ภาพรวมลูกค้า: <span className="text-cyber-primary">{selectedCustomer.name}</span>
              </h2>
              <p className="text-xs text-gray-400 mb-2">
                โค้ด: {selectedCustomer.code} • ประเภท: {selectedCustomer.type} • สถานะ:{' '}
                {selectedCustomer.status}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Users className="w-3 h-3 text-cyber-primary" />
                  <span>{selectedCustomer.contactName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3 text-cyber-primary" />
                  <span className="truncate">{selectedCustomer.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3 h-3 text-cyber-primary" />
                  <span>{selectedCustomer.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-cyber-primary" />
                  <span>{selectedCustomer.city}</span>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">ยอดซื้อรวมทั้งหมด</p>
                  <p className="text-sm font-semibold text-cyber-green">
                    ฿
                    {insights
                      ? insights.stats.totalRevenue.toLocaleString('th-TH', {
                          maximumFractionDigits: 0,
                        })
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">วงเงินเครดิต</p>
                  <p className="text-sm font-semibold text-cyber-purple">
                    ฿
                    {selectedCustomer.creditLimit.toLocaleString('th-TH', {
                      maximumFractionDigits: 0,
                    })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* เมนูย่อยของลูกค้าแต่ละคน (tabs) */}
          {selectedCustomer && (
            <div className="cyber-card p-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1 rounded-md border transition-all ${
                    activeTab === 'overview'
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400 hover:border-cyber-primary/40'
                  }`}
                >
                  ภาพรวม
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  className={`px-3 py-1 rounded-md border transition-all ${
                    activeTab === 'orders'
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400 hover:border-cyber-primary/40'
                  }`}
                >
                  ออเดอร์ล่าสุด
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('favourites')}
                  className={`px-3 py-1 rounded-md border transition-all ${
                    activeTab === 'favourites'
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400 hover:border-cyber-primary/40'
                  }`}
                >
                  ชอบซื้ออะไร
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('recommendations')}
                  className={`px-3 py-1 rounded-md border transition-all ${
                    activeTab === 'recommendations'
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400 hover:border-cyber-primary/40'
                  }`}
                >
                  สิ่งที่แนะนำ
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('proposals')}
                  className={`px-3 py-1 rounded-md border transition-all ${
                    activeTab === 'proposals'
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400 hover:border-cyber-primary/40'
                  }`}
                >
                  เคยเสนออะไรไปแล้วบ้าง
                </button>
              </div>
            </div>
          )}

          {/* เนื้อหาในแต่ละเมนู (per customer) */}
          {selectedCustomer && (
            <>
              {/* Overview: การติดต่อล่าสุด + ตัวเลขรวมหลัก ๆ */}
              {activeTab === 'overview' && (
                <div className="cyber-card p-4">
                  <h3 className="text-md font-semibold text-gray-100 mb-2">
                    ภาพรวมลูกค้ารายบุคคล
                  </h3>
                  {insightsLoading && (
                    <p className="text-gray-400 text-sm">กำลังโหลดข้อมูลลูกค้า...</p>
                  )}
                  {!insightsLoading && insights && (
                    <div className="space-y-2 text-sm text-gray-300">
                      <p>
                        <span className="text-gray-400">จำนวนออเดอร์ทั้งหมด: </span>
                        <span className="text-cyber-primary">
                          {insights.stats.totalOrders.toLocaleString('th-TH')}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-400">ยอดซื้อรวมทั้งหมด: </span>
                        <span className="text-cyber-green">
                          ฿
                          {insights.stats.totalRevenue.toLocaleString('th-TH', {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-400">การติดต่อล่าสุด (ออเดอร์ล่าสุด): </span>
                        <span>
                          {insights.stats.lastOrderDate
                            ? new Date(
                                insights.stats.lastOrderDate,
                              ).toLocaleDateString('th-TH')
                            : '-'}
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Recent orders */}
              {activeTab === 'orders' && (
                <div className="cyber-card p-4">
                  <h3 className="text-md font-semibold text-gray-100 mb-2">
                    ออเดอร์ล่าสุดของลูกค้าคนนี้
                  </h3>
                  {insights && insights.recentOrders.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-auto text-xs">
                      {insights.recentOrders.map((order) => (
                        <div
                          key={order.id}
                          className="border border-cyber-border/60 rounded-lg p-2 space-y-1"
                        >
                          <div className="flex justify-between">
                            <span className="font-semibold text-cyber-primary">
                              {order.orderNumber}
                            </span>
                            <span className="text-gray-400">
                              {new Date(order.orderDate).toLocaleDateString('th-TH')}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">{order.status}</span>
                            <span className="text-cyber-green">
                              ฿
                              {order.totalAmount.toLocaleString('th-TH', {
                                maximumFractionDigits: 0,
                              })}
                            </span>
                          </div>
                          {order.items.length > 0 && (
                            <p className="text-gray-400 truncate">
                              {order.items
                                .map((i) => `${i.productName} x${i.quantity}`)
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(!insights || insights.recentOrders.length === 0) && (
                    <p className="text-xs text-gray-500">ยังไม่มีประวัติการสั่งซื้อ</p>
                  )}
                </div>
              )}

              {/* Favourite products */}
              {activeTab === 'favourites' && (
                <div className="cyber-card p-4">
                  <h3 className="text-md font-semibold text-gray-100 mb-2">
                    ชอบซื้ออะไร (Top Products)
                  </h3>
                  {insights && insights.favouriteProducts.length > 0 && (
                    <ul className="space-y-1 text-xs text-gray-300">
                      {insights.favouriteProducts.map((prod) => (
                        <li
                          key={prod.productId}
                          className="flex justify-between border border-cyber-border/60 rounded-lg px-2 py-1"
                        >
                          <div>
                            <p className="font-semibold">{prod.name}</p>
                            <p className="text-gray-400 text-[10px]">
                              หมวด: {prod.category}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-cyber-primary">
                              x{prod.totalQuantity.toLocaleString('th-TH')}
                            </p>
                            <p className="text-cyber-green">
                              ฿
                              {prod.totalRevenue.toLocaleString('th-TH', {
                                maximumFractionDigits: 0,
                              })}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(!insights || insights.favouriteProducts.length === 0) && (
                    <p className="text-xs text-gray-500">ยังไม่มีข้อมูลสินค้าโปรด</p>
                  )}
                </div>
              )}

              {/* Recommendations */}
              {activeTab === 'recommendations' && (
                <div className="cyber-card p-4">
                  <h3 className="text-md font-semibold text-gray-100 mb-2">
                    สิ่งที่แนะนำให้เสนอเพิ่ม
                  </h3>
                  {insights && insights.recommendations.length > 0 ? (
                    <ul className="space-y-1 text-xs text-gray-300">
                      {insights.recommendations.map((rec) => (
                        <li
                          key={rec.productId}
                          className="flex justify-between border border-cyber-border/60 rounded-lg px-2 py-1"
                        >
                          <div>
                            <p className="font-semibold">{rec.name}</p>
                            <p className="text-gray-400 text-[10px]">
                              หมวด: {rec.category}
                            </p>
                          </div>
                          <p className="text-cyber-primary text-[10px]">
                            ความนิยมรวม (ทุกลูกค้า):{' '}
                            {rec.popularity.toLocaleString('th-TH')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-500">
                      ยังไม่มีคำแนะนำสินค้าเพิ่มเติมสำหรับลูกค้าคนนี้
                    </p>
                  )}
                </div>
              )}

              {/* Proposals history */}
              {activeTab === 'proposals' && (
                <div className="cyber-card p-4">
                  <h3 className="text-md font-semibold text-gray-100 mb-2">
                    เคยเสนออะไรไปแล้วบ้าง (จากโน้ตในออเดอร์)
                  </h3>
                  {insights && insights.proposalsHistory.length > 0 ? (
                    <ul className="space-y-1 text-xs text-gray-300 max-h-40 overflow-auto">
                      {insights.proposalsHistory.map((p) => (
                        <li
                          key={p.orderNumber}
                          className="border border-cyber-border/60 rounded-lg px-2 py-1"
                        >
                          <div className="flex justify-between mb-1">
                            <span className="font-semibold text-cyber-primary">
                              {p.orderNumber}
                            </span>
                            <span className="text-gray-400 text-[10px]">
                              {new Date(p.createdAt).toLocaleDateString('th-TH')}
                            </span>
                          </div>
                          <p className="text-gray-300">{p.note}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-500">
                      ยังไม่มีโน้ต/ข้อเสนอที่บันทึกไว้ในออเดอร์ของลูกค้าคนนี้
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
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

function CustomerCard({
  customer,
  index,
  selected,
}: {
  customer: Customer
  index: number
  selected?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      className={`cyber-card p-6 glow-effect ${
        selected ? 'ring-2 ring-cyber-primary/70' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-100">{customer.name}</h3>
            <p className="text-sm text-gray-400">{customer.code}</p>
          </div>
        </div>
        <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
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
