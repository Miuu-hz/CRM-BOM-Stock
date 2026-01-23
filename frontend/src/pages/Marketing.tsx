import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Upload,
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Eye,
  MousePointer,
  Store,
  Plus,
  Download,
  Trash2,
  BarChart3,
  PieChart,
  Filter,
  Calendar,
} from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import axios from 'axios'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

interface Shop {
  id: string
  name: string
  platform: string
  shopId: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface MarketingMetric {
  id: string
  fileId: string
  shopId: string
  date: string
  campaignName?: string
  productName?: string
  sku?: string
  impressions: number
  clicks: number
  ctr: number
  orders: number
  sales: number
  adCost: number
  roas: number
  acos: number
  conversionRate: number
}

interface Summary {
  totalImpressions: number
  totalClicks: number
  totalOrders: number
  totalSales: number
  totalAdCost: number
  avgCTR: number
  avgConversionRate: number
  totalROAS: number
  totalACOS: number
  recordCount: number
}

const COLORS = ['#00f0ff', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']

const PLATFORMS = [
  { id: 'SHOPEE', name: 'Shopee', color: 'from-orange-500 to-red-500' },
  { id: 'TIKTOK', name: 'TikTok', color: 'from-black to-gray-700' },
  { id: 'LAZADA', name: 'Lazada', color: 'from-blue-500 to-purple-500' },
  { id: 'LINE', name: 'LINE', color: 'from-green-500 to-emerald-500' },
]

const CHART_TYPES = [
  { id: 'line', name: 'Line Chart', icon: TrendingUp },
  { id: 'bar', name: 'Bar Chart', icon: BarChart3 },
  { id: 'area', name: 'Area Chart', icon: PieChart },
]

function Marketing() {
  const [selectedPlatform, setSelectedPlatform] = useState('SHOPEE')
  const [shops, setShops] = useState<Shop[]>([])
  const [selectedShop, setSelectedShop] = useState<string>('')
  const [metrics, setMetrics] = useState<MarketingMetric[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showAddShopModal, setShowAddShopModal] = useState(false)

  // Fetch shops
  const fetchShops = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/marketing/shops`, {
        params: { platform: selectedPlatform },
      })
      setShops(response.data.data || [])

      // Auto-select first shop if available
      if (response.data.data.length > 0 && !selectedShop) {
        setSelectedShop(response.data.data[0].id)
      }
    } catch (error) {
      console.error('Failed to fetch shops:', error)
      toast.error('ไม่สามารถโหลดข้อมูลร้านค้า')
    }
  }, [selectedPlatform, selectedShop])

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    if (!selectedShop) return

    setLoading(true)
    try {
      const params: any = { shopId: selectedShop }
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end

      const [metricsRes, summaryRes] = await Promise.all([
        axios.get(`${API_URL}/api/marketing/metrics`, { params }),
        axios.get(`${API_URL}/api/marketing/analytics/summary`, { params }),
      ])

      setMetrics(metricsRes.data.data || [])
      setSummary(summaryRes.data.data || null)
    } catch (error) {
      console.error('Failed to fetch metrics:', error)
      toast.error('ไม่สามารถโหลดข้อมูลการตลาด')
    } finally {
      setLoading(false)
    }
  }, [selectedShop, dateRange])

  useEffect(() => {
    fetchShops()
  }, [fetchShops])

  useEffect(() => {
    if (selectedShop) {
      fetchMetrics()
    }
  }, [selectedShop, fetchMetrics])

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('shopId', selectedShop)
    formData.append('platform', selectedPlatform)
    formData.append('startDate', dateRange.start)
    formData.append('endDate', dateRange.end)

    try {
      const response = await axios.post(`${API_URL}/api/marketing/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      toast.success(`อัพโหลดสำเร็จ! นำเข้าข้อมูล ${response.data.data.metricsCount} แถว`)
      fetchMetrics()
      setShowUploadModal(false)
    } catch (error: any) {
      console.error('Upload error:', error)
      toast.error(error.response?.data?.message || 'อัพโหลดไฟล์ไม่สำเร็จ')
    } finally {
      setUploading(false)
    }
  }

  // Add new shop
  const handleAddShop = async (name: string, shopId: string) => {
    try {
      const response = await axios.post(`${API_URL}/api/marketing/shops`, {
        name,
        platform: selectedPlatform,
        shopId,
      })

      toast.success('เพิ่มร้านค้าสำเร็จ')
      fetchShops()
      setShowAddShopModal(false)
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'เพิ่มร้านค้าไม่สำเร็จ')
    }
  }

  // Prepare chart data
  const chartData = metrics
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(m => ({
      date: format(parseISO(m.date), 'dd/MM'),
      sales: parseFloat(m.sales.toString()),
      adCost: parseFloat(m.adCost.toString()),
      orders: m.orders,
      impressions: m.impressions,
      clicks: m.clicks,
      roas: parseFloat(m.roas.toString()),
    }))

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    }

    switch (chartType) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="sales" stroke="#00f0ff" strokeWidth={2} name="ยอดขาย (฿)" />
            <Line type="monotone" dataKey="adCost" stroke="#a855f7" strokeWidth={2} name="ค่าโฆษณา (฿)" />
            <Line type="monotone" dataKey="orders" stroke="#10b981" strokeWidth={2} name="คำสั่งซื้อ" />
          </LineChart>
        )
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            <Bar dataKey="sales" fill="#00f0ff" name="ยอดขาย (฿)" />
            <Bar dataKey="adCost" fill="#a855f7" name="ค่าโฆษณา (฿)" />
          </BarChart>
        )
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            <Area type="monotone" dataKey="sales" stackId="1" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.6} name="ยอดขาย (฿)" />
            <Area type="monotone" dataKey="adCost" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.6} name="ค่าโฆษณา (฿)" />
          </AreaChart>
        )
    }
  }

  return (
    <div className="min-h-screen space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold neon-text mb-2">Marketing Analytics</h1>
          <p className="text-gray-400">วิเคราะห์ประสิทธิภาพการตลาดและโฆษณา</p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAddShopModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-cyber-purple to-cyber-primary rounded-lg font-semibold hover:shadow-neon transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            เพิ่มร้านค้า
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowUploadModal(true)}
            disabled={!selectedShop}
            className="px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-green rounded-lg font-semibold hover:shadow-neon transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-5 h-5" />
            อัพโหลดข้อมูล
          </motion.button>
        </div>
      </motion.div>

      {/* Platform Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="cyber-card p-1"
      >
        <div className="flex gap-2">
          {PLATFORMS.map(platform => (
            <button
              key={platform.id}
              onClick={() => {
                setSelectedPlatform(platform.id)
                setSelectedShop('')
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${
                selectedPlatform === platform.id
                  ? `bg-gradient-to-r ${platform.color} shadow-neon`
                  : 'bg-cyber-card/50 hover:bg-cyber-card text-gray-400 hover:text-white'
              }`}
            >
              {platform.name}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Shop Selector & Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="cyber-card p-4 flex flex-wrap gap-4 items-center"
      >
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Store className="w-5 h-5 text-cyber-primary" />
          <select
            value={selectedShop}
            onChange={(e) => setSelectedShop(e.target.value)}
            className="flex-1 bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
          >
            <option value="">เลือกร้านค้า</option>
            {shops.map(shop => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-cyber-primary" />
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
          />
          <span className="text-gray-400">ถึง</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
          />
        </div>

        <div className="flex gap-2">
          {CHART_TYPES.map(type => (
            <button
              key={type.id}
              onClick={() => setChartType(type.id as any)}
              className={`p-2 rounded-lg transition-all ${
                chartType === type.id
                  ? 'bg-cyber-primary text-white'
                  : 'bg-cyber-card/50 text-gray-400 hover:bg-cyber-card hover:text-white'
              }`}
              title={type.name}
            >
              <type.icon className="w-5 h-5" />
            </button>
          ))}
        </div>
      </motion.div>

      {/* Summary Cards */}
      {summary && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard
            title="ยอดขายรวม"
            value={`฿${summary.totalSales.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
            icon={DollarSign}
            color="from-cyber-primary to-cyber-green"
            subtitle={`${summary.totalOrders} คำสั่งซื้อ`}
          />

          <StatCard
            title="ค่าโฆษณารวม"
            value={`฿${summary.totalAdCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
            icon={TrendingUp}
            color="from-cyber-purple to-pink-500"
            subtitle={`ROAS: ${summary.totalROAS.toFixed(2)}`}
          />

          <StatCard
            title="Impressions"
            value={summary.totalImpressions.toLocaleString('th-TH')}
            icon={Eye}
            color="from-blue-500 to-cyan-500"
            subtitle={`CTR: ${(summary.avgCTR * 100).toFixed(2)}%`}
          />

          <StatCard
            title="Clicks"
            value={summary.totalClicks.toLocaleString('th-TH')}
            icon={MousePointer}
            color="from-orange-500 to-red-500"
            subtitle={`Conv: ${(summary.avgConversionRate * 100).toFixed(2)}%`}
          />
        </motion.div>
      )}

      {/* Chart */}
      {metrics.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="cyber-card p-6"
        >
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-cyber-primary" />
            Performance Trends
          </h2>
          <ResponsiveContainer width="100%" height={400}>
            {renderChart()}
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* No Data Message */}
      {!loading && metrics.length === 0 && selectedShop && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="cyber-card p-12 text-center"
        >
          <Upload className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-400 mb-2">ยังไม่มีข้อมูล</h3>
          <p className="text-gray-500 mb-6">อัพโหลดไฟล์ CSV เพื่อเริ่มวิเคราะห์ข้อมูลการตลาด</p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-6 py-3 bg-gradient-to-r from-cyber-primary to-cyber-green rounded-lg font-semibold hover:shadow-neon transition-all"
          >
            อัพโหลดไฟล์
          </button>
        </motion.div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          platform={selectedPlatform}
          shops={shops}
          selectedShop={selectedShop}
          setSelectedShop={setSelectedShop}
          dateRange={dateRange}
          setDateRange={setDateRange}
          uploading={uploading}
          onClose={() => setShowUploadModal(false)}
          onUpload={handleFileUpload}
        />
      )}

      {/* Add Shop Modal */}
      {showAddShopModal && (
        <AddShopModal
          platform={selectedPlatform}
          onClose={() => setShowAddShopModal(false)}
          onSubmit={handleAddShop}
        />
      )}
    </div>
  )
}

// Helper Components
function StatCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string
  value: string
  icon: any
  color: string
  subtitle?: string
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -5 }}
      className="cyber-card p-4 relative overflow-hidden"
    >
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${color} opacity-10 rounded-full blur-2xl`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-400">{title}</p>
          <Icon className={`w-5 h-5 bg-gradient-to-r ${color} bg-clip-text text-transparent`} />
        </div>
        <p className="text-2xl font-bold text-white mb-1">{value}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </motion.div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="cyber-card p-6 max-w-lg w-full"
      >
        {children}
        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 bg-cyber-card hover:bg-red-500/20 rounded-lg transition-all"
        >
          ปิด
        </button>
      </motion.div>
    </div>
  )
}

function UploadModal({
  platform,
  shops,
  selectedShop,
  setSelectedShop,
  dateRange,
  setDateRange,
  uploading,
  onClose,
  onUpload,
}: {
  platform: string
  shops: Shop[]
  selectedShop: string
  setSelectedShop: (shopId: string) => void
  dateRange: { start: string; end: string }
  setDateRange: (range: { start: string; end: string }) => void
  uploading: boolean
  onClose: () => void
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredShops = shops.filter(shop =>
    shop.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    shop.shopId.includes(searchTerm)
  )

  const canUpload = selectedShop && dateRange.start && dateRange.end

  return (
    <Modal onClose={onClose}>
      <h3 className="text-xl font-bold mb-4">อัพโหลดข้อมูลการตลาด</h3>

      <div className="space-y-4">
        {/* Platform */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Platform</label>
          <div className="w-full bg-cyber-card/50 border border-cyber-border rounded-lg px-4 py-2 text-white">
            {PLATFORMS.find(p => p.id === platform)?.name}
          </div>
        </div>

        {/* Shop Selector with Search */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">ร้านค้า</label>
          <input
            type="text"
            placeholder="🔍 ค้นหาร้านค้า..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary mb-2"
          />
          <select
            value={selectedShop}
            onChange={(e) => setSelectedShop(e.target.value)}
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
            required
          >
            <option value="">เลือกร้านค้า</option>
            {filteredShops.map(shop => (
              <option key={shop.id} value={shop.id}>
                {shop.name} ({shop.shopId})
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">วันที่เริ่มต้น</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">วันที่สิ้นสุด</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
              required
            />
          </div>
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">ไฟล์ CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={onUpload}
            disabled={uploading || !canUpload}
            className="w-full p-4 border-2 border-dashed border-cyber-border rounded-lg bg-cyber-card/50 hover:border-cyber-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {!canUpload && (
            <p className="text-sm text-yellow-500 mt-2">กรุณาเลือกร้านค้าและวันที่ก่อนอัพโหลด</p>
          )}
        </div>

        {uploading && (
          <p className="text-center text-cyber-primary mt-4">กำลังประมวลผล...</p>
        )}
      </div>
    </Modal>
  )
}

function AddShopModal({
  platform,
  onClose,
  onSubmit,
}: {
  platform: string
  onClose: () => void
  onSubmit: (name: string, shopId: string) => void
}) {
  const [name, setName] = useState('')
  const [shopId, setShopId] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name && shopId) {
      onSubmit(name, shopId)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="text-xl font-bold mb-4">เพิ่มร้านค้าใหม่</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">ชื่อร้านค้า</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-2">Shop ID ({platform})</label>
          <input
            type="text"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="w-full bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-primary"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full px-4 py-2 bg-gradient-to-r from-cyber-primary to-cyber-green rounded-lg font-semibold hover:shadow-neon transition-all"
        >
          เพิ่มร้านค้า
        </button>
      </form>
    </Modal>
  )
}

export default Marketing
