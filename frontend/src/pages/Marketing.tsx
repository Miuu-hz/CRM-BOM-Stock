import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {Upload, TrendingUp, DollarSign, Eye, MousePointer, Store, Plus, BarChart3, PieChart, Calendar, Settings, Table} from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import api from '../services/api'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { useModalClose } from '../hooks/useModalClose'
import HintBanner from '../components/common/HintBanner'


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

interface PivotConfig {
  rowBy: 'date' | 'product' | 'campaign' | 'sku'
  metrics: string[]
  aggregation: 'sum' | 'avg' | 'count'
  groupBy: 'day' | 'week' | 'month'
}

interface PivotRow {
  [key: string]: any
}

const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)', 'var(--fg-4)']

const PLATFORMS = [
  { id: 'SHOPEE', name: 'Shopee', color: 'from-orange-500 to-red-500' },
  { id: 'TIKTOK', name: 'TikTok', color: 'from-gray-800 to-gray-600' },
  { id: 'LAZADA', name: 'Lazada', color: 'from-blue-500 to-purple-500' },
  { id: 'LINE', name: 'LINE', color: 'from-green-500 to-success' },
]

const CHART_TYPES = [
  { id: 'line', name: 'Line Chart', icon: TrendingUp },
  { id: 'bar', name: 'Bar Chart', icon: BarChart3 },
  { id: 'area', name: 'Area Chart', icon: PieChart },
]

const METRIC_OPTIONS = [
  { key: 'sales', label: 'ยอดขาย', color: 'var(--primary)' },
  { key: 'adCost', label: 'ค่าโฆษณา', color: 'var(--info)' },
  { key: 'orders', label: 'คำสั่งซื้อ', color: 'var(--success)' },
  { key: 'impressions', label: 'การมองเห็น', color: 'var(--warning)' },
  { key: 'clicks', label: 'คลิก', color: 'var(--danger)' },
  { key: 'roas', label: 'ROAS', color: 'var(--fg-4)' },
]

const ROW_OPTIONS = [
  { key: 'date', label: 'วันที่' },
  { key: 'product', label: 'สินค้า' },
  { key: 'campaign', label: 'แคมเปญ' },
  { key: 'sku', label: 'SKU' },
]

function Marketing() {
  const [selectedPlatform, setSelectedPlatform] = useState('SHOPEE')
  const [shops, setShops] = useState<Shop[]>([])
  const [selectedShop, setSelectedShop] = useState<string>('')
  const [metrics, setMetrics] = useState<MarketingMetric[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showAddShopModal, setShowAddShopModal] = useState(false)
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [showPivotSettings, setShowPivotSettings] = useState(false)

  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rowBy: 'date',
    metrics: ['sales', 'adCost'],
    aggregation: 'sum',
    groupBy: 'day',
  })

  // Fetch shops
  const fetchShops = useCallback(async () => {
    try {
      const response = await api.get('/marketing/shops', {
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
        api.get('/marketing/metrics', { params }),
        api.get('/marketing/analytics/summary', { params }),
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

  // Add new shop
  const handleAddShop = async (name: string, shopId: string) => {
    try {
      await api.post('/marketing/shops', {
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

  // Transform data to pivot table format
  const transformToPivot = (): PivotRow[] => {
    if (!metrics || metrics.length === 0) return []

    const grouped: { [key: string]: MarketingMetric[] } = {}

    // Group by selected dimension
    metrics.forEach(metric => {
      let key = ''
      switch (pivotConfig.rowBy) {
        case 'date':
          key = format(parseISO(metric.date), 'dd/MM/yyyy')
          break
        case 'product':
          key = metric.productName || 'N/A'
          break
        case 'campaign':
          key = metric.campaignName || 'N/A'
          break
        case 'sku':
          key = metric.sku || 'N/A'
          break
      }

      if (!grouped[key]) grouped[key] = []
      grouped[key].push(metric)
    })

    // Aggregate metrics
    const pivotData: PivotRow[] = Object.entries(grouped).map(([key, items]) => {
      const row: PivotRow = { key }

      pivotConfig.metrics.forEach(metricKey => {
        const values = items.map(item => {
          const val = item[metricKey as keyof MarketingMetric]
          return typeof val === 'number' ? val : 0
        })

        let aggregated = 0
        if (pivotConfig.aggregation === 'sum') {
          aggregated = values.reduce((a, b) => a + b, 0)
        } else if (pivotConfig.aggregation === 'avg') {
          aggregated = values.reduce((a, b) => a + b, 0) / values.length
        } else if (pivotConfig.aggregation === 'count') {
          aggregated = values.length
        }

        row[metricKey] = aggregated
      })

      return row
    })

    return pivotData.sort((a, b) => {
      if (pivotConfig.rowBy === 'date') {
        return new Date(a.key.split('/').reverse().join('-')).getTime() -
               new Date(b.key.split('/').reverse().join('-')).getTime()
      }
      return a.key.localeCompare(b.key)
    })
  }

  // Prepare chart data from pivot
  const pivotData = transformToPivot()
  const chartData = pivotData.map(row => ({
    key: row.key,
    ...row
  }))

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    }

    const tooltipStyle = {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      color: 'var(--fg-1)',
    }

    switch (chartType) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="key" stroke="var(--fg-3)" />
            <YAxis stroke="var(--fg-3)" />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {pivotConfig.metrics.map((metricKey, index) => {
              const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
              return (
                <Line
                  key={metricKey}
                  type="monotone"
                  dataKey={metricKey}
                  stroke={metric?.color || COLORS[index]}
                  strokeWidth={2}
                  name={metric?.label || metricKey}
                />
              )
            })}
          </LineChart>
        )
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="key" stroke="var(--fg-3)" />
            <YAxis stroke="var(--fg-3)" />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {pivotConfig.metrics.map((metricKey, index) => {
              const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
              return (
                <Bar
                  key={metricKey}
                  dataKey={metricKey}
                  fill={metric?.color || COLORS[index]}
                  name={metric?.label || metricKey}
                />
              )
            })}
          </BarChart>
        )
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="key" stroke="var(--fg-3)" />
            <YAxis stroke="var(--fg-3)" />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {pivotConfig.metrics.map((metricKey, index) => {
              const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
              return (
                <Area
                  key={metricKey}
                  type="monotone"
                  dataKey={metricKey}
                  stackId="1"
                  stroke={metric?.color || COLORS[index]}
                  fill={metric?.color || COLORS[index]}
                  fillOpacity={0.6}
                  name={metric?.label || metricKey}
                />
              )
            })}
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
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">Marketing Analytics</h1>
          <p className="text-[var(--fg-3)]">วิเคราะห์ประสิทธิภาพการตลาดและโฆษณา</p>
        </div>

        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAddShopModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-phopy-indigo rounded-lg font-semibold hover:shadow-2 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            เพิ่มร้านค้า
          </motion.button>
        </div>
      </motion.div>

      {/* เลิกอัปโหลด CSV แล้ว — ข้อมูลรอบเดือนของแพลตฟอร์มเข้าทาง MCP (platform_submit_file) เท่านั้น */}
      <HintBanner id="marketing-mcp-import" title="นำเข้าข้อมูลผ่าน AI ผู้ช่วยเท่านั้น">
        หน้านี้เลิกรับอัปโหลดไฟล์แล้ว ให้คุยกับ AI ผู้ช่วยแล้วแนบรายงานรอบเดือนจากแพลตฟอร์ม (เช่น Shopee)
        บอกแพลตฟอร์ม ร้านค้า และเดือนของรอบ ระบบจะนำเข้าข้อมูลให้อัตโนมัติ
      </HintBanner>

      {/* ===== เมตริกโฆษณา / ROAS — หน้านี้ไม่แตะบัญชีและไม่แตะสต็อก ===== */}
      {(
        <>
          {/* Platform Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="phopy-card p-1"
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
                      ? `bg-gradient-to-r ${platform.color} shadow-2 text-white`
                      : 'bg-[var(--surface-2)] hover:bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
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
            className="phopy-card p-4 flex flex-wrap gap-4 items-center"
          >
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Store className="w-5 h-5 text-[var(--primary)]" />
              <select
                value={selectedShop}
                onChange={(e) => setSelectedShop(e.target.value)}
                className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
              >
                <option value="">เลือกร้านค้า</option>
                {(shops || []).map(shop => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[var(--primary)]" />
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
              />
              <span className="text-[var(--fg-3)]">ถึง</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
              />
            </div>

            <div className="flex gap-2">
              {/* View Mode Toggle */}
              <button
                onClick={() => setViewMode('chart')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'chart'
                    ? 'bg-phopy-indigo text-white'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-1)]'
                }`}
                title="Chart View"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'table'
                    ? 'bg-phopy-indigo text-white'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-1)]'
                }`}
                title="Table View"
              >
                <Table className="w-5 h-5" />
              </button>

              <div className="w-px h-8 bg-[var(--border)] mx-1" />

              {/* Chart Types (only show when in chart mode) */}
              {viewMode === 'chart' && CHART_TYPES.map(type => (
                <button
                  key={type.id}
                  onClick={() => setChartType(type.id as any)}
                  className={`p-2 rounded-lg transition-all ${
                    chartType === type.id
                      ? 'bg-phopy-indigo text-white'
                      : 'bg-[var(--surface-2)] text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-1)]'
                  }`}
                  title={type.name}
                >
                  <type.icon className="w-5 h-5" />
                </button>
              ))}

              <div className="w-px h-8 bg-[var(--border)] mx-1" />

              {/* Pivot Settings */}
              <button
                onClick={() => setShowPivotSettings(!showPivotSettings)}
                className={`p-2 rounded-lg transition-all ${
                  showPivotSettings
                    ? 'bg-phopy-indigo text-white'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-1)]'
                }`}
                title="Pivot Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
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
                color="from-phopy-indigo to-success"
                subtitle={`${summary.totalOrders} คำสั่งซื้อ`}
              />
              <StatCard
                title="ค่าโฆษณารวม"
                value={`฿${summary.totalAdCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
                icon={TrendingUp}
                color="from-purple-500 to-pink-500"
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

          {/* Pivot Settings Panel */}
          {showPivotSettings && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="phopy-card p-4"
            >
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-[var(--primary)]" />
                Pivot Table Configuration
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">จัดกลุ่มตาม</label>
                  <select
                    value={pivotConfig.rowBy}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, rowBy: e.target.value as any })}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
                  >
                    {ROW_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">Metrics</label>
                  <div className="space-y-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 max-h-32 overflow-y-auto">
                    {METRIC_OPTIONS.map(metric => (
                      <label key={metric.key} className="flex items-center gap-2 cursor-pointer hover:bg-[var(--surface-2)] p-1 rounded">
                        <input
                          type="checkbox"
                          checked={pivotConfig.metrics.includes(metric.key)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPivotConfig({ ...pivotConfig, metrics: [...pivotConfig.metrics, metric.key] })
                            } else {
                              setPivotConfig({ ...pivotConfig, metrics: (pivotConfig.metrics || []).filter(m => m !== metric.key) })
                            }
                          }}
                          className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-phopy-indigo"
                        />
                        <span className="text-sm">{metric.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">การคำนวณ</label>
                  <select
                    value={pivotConfig.aggregation}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, aggregation: e.target.value as any })}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
                  >
                    <option value="sum">รวม (Sum)</option>
                    <option value="avg">เฉลี่ย (Average)</option>
                    <option value="count">นับ (Count)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">จัดกลุ่มช่วง</label>
                  <select
                    value={pivotConfig.groupBy}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, groupBy: e.target.value as any })}
                    disabled={pivotConfig.rowBy !== 'date'}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo disabled:opacity-50"
                  >
                    <option value="day">รายวัน</option>
                    <option value="week">รายสัปดาห์</option>
                    <option value="month">รายเดือน</option>
                  </select>
                </div>
              </div>
            </motion.div>
          )}

          {/* Chart View */}
          {metrics.length > 0 && viewMode === 'chart' && pivotData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="phopy-card p-6"
            >
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-[var(--primary)]" />
                Performance Trends
              </h2>
              <ResponsiveContainer width="100%" height={400}>
                {renderChart()}
              </ResponsiveContainer>
            </motion.div>
          )}

          {/* Table View */}
          {metrics.length > 0 && viewMode === 'table' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="phopy-card p-6"
            >
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Table className="w-6 h-6 text-[var(--primary)]" />
                Pivot Table View
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-[var(--fg-2)]">
                        {ROW_OPTIONS.find(opt => opt.key === pivotConfig.rowBy)?.label || 'Key'}
                      </th>
                      {pivotConfig.metrics.map(metricKey => {
                        const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
                        return (
                          <th key={metricKey} className="text-right py-3 px-4 text-sm font-semibold text-[var(--fg-2)]">
                            {metric?.label || metricKey}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(pivotData || []).map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[var(--border)]/30 hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <td className="py-3 px-4 text-sm font-medium text-[var(--fg-1)]">{row.key}</td>
                        {pivotConfig.metrics.map(metricKey => {
                          const value = row[metricKey]
                          const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
                          let formatted = ''
                          if (metricKey === 'sales' || metricKey === 'adCost' || metricKey.includes('cost')) {
                            formatted = `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          } else if (metricKey === 'roas' || metricKey === 'acos' || metricKey.includes('rate') || metricKey === 'ctr') {
                            formatted = value.toFixed(2)
                          } else {
                            formatted = Math.round(value).toLocaleString('th-TH')
                          }
                          return (
                            <td key={metricKey} className="py-3 px-4 text-sm text-right font-mono" style={{ color: metric?.color || 'var(--fg-4)' }}>
                              {formatted}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {pivotData.length > 1 && (
                      <tr className="border-t-2 border-phopy-indigo/50 bg-[var(--surface-2)] font-bold">
                        <td className="py-3 px-4 text-sm text-[var(--fg-1)]">
                          รวมทั้งหมด ({pivotConfig.aggregation === 'avg' ? 'เฉลี่ย' : 'รวม'})
                        </td>
                        {pivotConfig.metrics.map(metricKey => {
                          const total = pivotData.reduce((sum, row) => sum + (row[metricKey] || 0), 0)
                          const avg = total / pivotData.length
                          const value = pivotConfig.aggregation === 'avg' ? avg : total
                          const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
                          let formatted = ''
                          if (metricKey === 'sales' || metricKey === 'adCost' || metricKey.includes('cost')) {
                            formatted = `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          } else if (metricKey === 'roas' || metricKey === 'acos' || metricKey.includes('rate') || metricKey === 'ctr') {
                            formatted = value.toFixed(2)
                          } else {
                            formatted = Math.round(value).toLocaleString('th-TH')
                          }
                          return (
                            <td key={metricKey} className="py-3 px-4 text-sm text-right font-mono" style={{ color: metric?.color || 'var(--fg-4)' }}>
                              {formatted}
                            </td>
                          )
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pivotData.length === 0 && (
                <div className="text-center py-12 text-[var(--fg-3)]">
                  <Table className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>ไม่มีข้อมูลให้แสดง</p>
                </div>
              )}
            </motion.div>
          )}

          {/* No Data Message */}
          {!loading && metrics.length === 0 && selectedShop && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="phopy-card p-12 text-center"
            >
              <Upload className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-[var(--fg-3)] mb-2">ยังไม่มีข้อมูล</h3>
              <p className="text-[var(--fg-4)] mb-6">บอก AI ผู้ช่วยให้นำเข้ารายงานรอบเดือนของแพลตฟอร์มนี้</p>
            </motion.div>
          )}
        </>
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
      className="phopy-card p-4 relative overflow-hidden"
    >
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${color} opacity-10 rounded-full blur-2xl`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-[var(--fg-3)]">{title}</p>
          <Icon className={`w-5 h-5 bg-gradient-to-r ${color} bg-clip-text text-transparent`} />
        </div>
        <p className="text-2xl font-bold text-[var(--fg-1)] mb-1">{value}</p>
        {subtitle && <p className="text-xs text-[var(--fg-4)]">{subtitle}</p>}
      </div>
    </motion.div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useModalClose(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--fg-1)]/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={e => e.stopPropagation()}
        className="phopy-card p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
      >
        {children}
        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 bg-[var(--surface)] hover:bg-[var(--danger-soft)] rounded-lg transition-all"
        >
          ปิด
        </button>
      </motion.div>
    </div>
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
  useModalClose(onClose)
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
          <label className="block text-sm text-[var(--fg-3)] mb-2">ชื่อร้านค้า</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--fg-3)] mb-2">Shop ID ({platform})</label>
          <input
            type="text"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--fg-1)] focus:outline-none focus:border-phopy-indigo"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full px-4 py-2 bg-gradient-to-r from-phopy-indigo to-success rounded-lg font-semibold hover:shadow-2 transition-all"
        >
          เพิ่มร้านค้า
        </button>
      </form>
    </Modal>
  )
}

export default Marketing
