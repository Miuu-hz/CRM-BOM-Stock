import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Upload,
  TrendingUp,
  DollarSign,
  Eye,
  MousePointer,
  Store,
  Plus,
  BarChart3,
  PieChart,
  Calendar,
  Settings,
  Table,
  Trash2,
  X,
  Calculator,
} from 'lucide-react'
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
import api from '../utils/api'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'


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

interface AdSpend {
  id: string
  date: string
  platform: string
  channel?: string
  amount: number
  notes?: string
}

interface ProfitRow {
  date: string
  revenue: number
  cogs: number
  csvAdSpend: number
  manualAdSpend: number
  totalAdSpend: number
  grossProfit: number
  netProfit: number
  netMargin: number
  roas: number
  adByPlatform: Record<string, number>
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

const METRIC_OPTIONS = [
  { key: 'sales', label: 'ยอดขาย', color: '#00f0ff' },
  { key: 'adCost', label: 'ค่าโฆษณา', color: '#a855f7' },
  { key: 'orders', label: 'คำสั่งซื้อ', color: '#10b981' },
  { key: 'impressions', label: 'การมองเห็น', color: '#f59e0b' },
  { key: 'clicks', label: 'คลิก', color: '#ef4444' },
  { key: 'roas', label: 'ROAS', color: '#3b82f6' },
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
  const [uploading, setUploading] = useState(false)
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showAddShopModal, setShowAddShopModal] = useState(false)
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [mainTab, setMainTab] = useState<'analytics' | 'profit' | 'platform'>('analytics')
  const [adSpends, setAdSpends] = useState<AdSpend[]>([])
  const [profitReport, setProfitReport] = useState<ProfitRow[]>([])
  const [profitLoading, setProfitLoading] = useState(false)
  const [adForm, setAdForm] = useState({ date: '', platform: 'FACEBOOK', channel: '', amount: '', notes: '' })
  const [adFormSaving, setAdFormSaving] = useState(false)
  const [showPivotSettings, setShowPivotSettings] = useState(false)

  // Platform tab state
  const [platPlatform, setPlatPlatform] = useState('SHOPEE')
  const [platImportDate, setPlatImportDate] = useState('')
  const [platFile, setPlatFile] = useState<File | null>(null)
  const [platUploading, setPlatUploading] = useState(false)
  const [platPreview, setPlatPreview] = useState<any>(null)
  const [platImports, setPlatImports] = useState<any[]>([])
  const [platPendingJE, setPlatPendingJE] = useState<any[]>([])
  const [platAccounts, setPlatAccounts] = useState<any[]>([])
  const [platJEModal, setPlatJEModal] = useState<any>(null)
  const [platJEDr, setPlatJEDr] = useState('')
  const [platJECr, setPlatJECr] = useState('')
  const [platJENotes, setPlatJENotes] = useState('')
  const [platJESaving, setPlatJESaving] = useState(false)
  const [platSkuSearchMap, setPlatSkuSearchMap] = useState<Record<string, string>>({})
  const [platSkuResults, setPlatSkuResults] = useState<Record<string, any[]>>({})
  const [platSkuSaving, setPlatSkuSaving] = useState<Record<string, boolean>>({})
  const [platConfirming, setPlatConfirming] = useState(false)

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

  // Fetch P&L data
  const fetchProfitData = useCallback(async () => {
    setProfitLoading(true)
    try {
      const params: any = {}
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end

      const [adSpendsRes, profitRes] = await Promise.all([
        api.get('/marketing/ad-spends', { params }),
        api.get('/marketing/profit-report', { params }),
      ])

      setAdSpends(adSpendsRes.data.data || adSpendsRes.data || [])
      setProfitReport(profitRes.data.data || profitRes.data || [])
    } catch (error) {
      console.error('Failed to fetch profit data:', error)
      toast.error('ไม่สามารถโหลดข้อมูล P&L')
    } finally {
      setProfitLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    if (mainTab === 'profit') {
      fetchProfitData()
    }
  }, [mainTab, dateRange, fetchProfitData])

  // Platform tab data fetchers
  const fetchPlatImports = useCallback(async () => {
    try {
      const res = await api.get('/marketing/platform/imports')
      setPlatImports(res.data.data || [])
    } catch { /* silent */ }
  }, [])

  const fetchPlatPendingJE = useCallback(async () => {
    try {
      const res = await api.get('/marketing/platform/pending-je')
      setPlatPendingJE(res.data.data || [])
    } catch { /* silent */ }
  }, [])

  const fetchPlatAccounts = useCallback(async () => {
    try {
      const res = await api.get('/accounts')
      setPlatAccounts(res.data.data || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (mainTab === 'platform') {
      fetchPlatImports()
      fetchPlatPendingJE()
      fetchPlatAccounts()
    }
  }, [mainTab, fetchPlatImports, fetchPlatPendingJE, fetchPlatAccounts])

  const handlePlatPreview = async () => {
    if (!platFile || !platImportDate) {
      toast.error('กรุณาเลือกไฟล์และวันที่นำเข้า')
      return
    }
    setPlatUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', platFile)
      formData.append('platform', platPlatform)
      formData.append('importDate', platImportDate)
      const res = await api.post('/marketing/platform/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPlatPreview(res.data.data)
      toast.success(`โหลดตัวอย่างสำเร็จ! พบ ${res.data.data.summary.totalRows} รายการ`)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'อัปโหลดล้มเหลว')
    } finally {
      setPlatUploading(false)
    }
  }

  const handlePlatConfirm = async () => {
    if (!platPreview?.importId) return
    setPlatConfirming(true)
    try {
      const res = await api.post(`/marketing/platform/confirm/${platPreview.importId}`)
      const d = res.data.data
      toast.success(`ยืนยันสำเร็จ! ตัดสต๊อก ${d.deducted} รายการ | ข้าม ${d.skipped} | ไม่พอ ${d.insufficient}`)
      setPlatPreview(null)
      setPlatFile(null)
      fetchPlatImports()
      fetchPlatPendingJE()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ยืนยันล้มเหลว')
    } finally {
      setPlatConfirming(false)
    }
  }

  const handlePlatSkuSearch = async (sku: string, query: string) => {
    setPlatSkuSearchMap(prev => ({ ...prev, [sku]: query }))
    if (!query || query.length < 2) {
      setPlatSkuResults(prev => ({ ...prev, [sku]: [] }))
      return
    }
    try {
      const res = await api.get('/stock', { params: { search: query } })
      setPlatSkuResults(prev => ({ ...prev, [sku]: (res.data.data || []).slice(0, 8) }))
    } catch { /* silent */ }
  }

  const handlePlatSaveMapping = async (sku: string, stockItemId: string) => {
    setPlatSkuSaving(prev => ({ ...prev, [sku]: true }))
    try {
      await api.post('/marketing/platform/sku-mapping', {
        platformSku: sku,
        platform: platPlatform,
        stockItemId,
      })
      toast.success(`เชื่อม SKU ${sku} สำเร็จ`)
      setPlatSkuResults(prev => ({ ...prev, [sku]: [] }))
      setPlatSkuSearchMap(prev => ({ ...prev, [sku]: '' }))
      // Refresh preview items to show updated match status
      if (platPreview?.importId) {
        try {
          const res = await api.get(`/marketing/platform/imports/${platPreview.importId}`)
          const imp = res.data.data
          const items = (imp.items || []).map((it: any) => ({
            sku: it.sku,
            productName: it.product_name,
            itemsSold: it.items_sold,
            revenue: it.revenue,
            adCost: it.ad_cost,
            roas: it.roas,
            stockItemId: it.stock_item_id,
            stockItemName: it.stock_item_name,
            currentStock: it.current_stock,
            matchStatus: it.stock_item_id ? 'MATCHED' : 'UNMATCHED',
          }))
          setPlatPreview((prev: any) => ({
            ...prev,
            items,
            summary: {
              ...prev.summary,
              matched: imp.matched_rows,
              unmatched: imp.unmatched_rows,
            },
          }))
        } catch { /* silent */ }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'บันทึก mapping ล้มเหลว')
    } finally {
      setPlatSkuSaving(prev => ({ ...prev, [sku]: false }))
    }
  }

  const handlePlatApproveJE = async () => {
    if (!platJEModal || !platJEDr || !platJECr) {
      toast.error('กรุณาเลือกบัญชี Dr. และ Cr.')
      return
    }
    setPlatJESaving(true)
    try {
      const res = await api.post(`/marketing/platform/approve-je/${platJEModal.id}`, {
        drAccountId: platJEDr,
        crAccountId: platJECr,
        notes: platJENotes,
      })
      toast.success(`อนุมัติ JE สำเร็จ! เลขที่: ${res.data.data?.entryNumber || ''}`)
      setPlatJEModal(null)
      setPlatJEDr('')
      setPlatJECr('')
      setPlatJENotes('')
      fetchPlatPendingJE()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'อนุมัติล้มเหลว')
    } finally {
      setPlatJESaving(false)
    }
  }

  const handlePlatRejectJE = async (id: string) => {
    try {
      await api.post(`/marketing/platform/reject-je/${id}`, { notes: 'ปฏิเสธโดยผู้ใช้' })
      toast.success('ปฏิเสธ JE แล้ว')
      fetchPlatPendingJE()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ปฏิเสธล้มเหลว')
    }
  }

  // Handle add ad spend
  const handleAddAdSpend = async () => {
    if (!adForm.date || !adForm.platform || !adForm.amount) {
      toast.error('กรุณากรอกวันที่ แพลตฟอร์ม และจำนวนเงิน')
      return
    }
    setAdFormSaving(true)
    try {
      await api.post('/marketing/ad-spends', {
        date: adForm.date,
        platform: adForm.platform,
        channel: adForm.channel || undefined,
        amount: parseFloat(adForm.amount),
        notes: adForm.notes || undefined,
      })
      setAdForm({ date: '', platform: 'FACEBOOK', channel: '', amount: '', notes: '' })
      await fetchProfitData()
      toast.success('บันทึกค่าโฆษณาสำเร็จ')
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setAdFormSaving(false)
    }
  }

  // Handle delete ad spend
  const handleDeleteAdSpend = async (id: string) => {
    try {
      await api.delete(`/marketing/ad-spends/${id}`)
      await fetchProfitData()
      toast.success('ลบข้อมูลสำเร็จ')
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

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
      const response = await api.post('/marketing/upload', formData, {
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
      backgroundColor: '#1f2937',
      border: '1px solid #374151',
      borderRadius: '0.5rem',
    }

    switch (chartType) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="key" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="key" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="key" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
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

      {/* Main Tab Switcher */}
      <div className="flex gap-1 bg-cyber-card border border-cyber-border rounded-xl p-1 w-fit">
        <button
          onClick={() => setMainTab('analytics')}
          className={mainTab === 'analytics' ? 'px-4 py-2 rounded-lg bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/40 text-sm font-medium' : 'px-4 py-2 rounded-lg text-gray-400 hover:text-white text-sm'}
        >
          📊 Analytics
        </button>
        <button
          onClick={() => setMainTab('profit')}
          className={mainTab === 'profit' ? 'px-4 py-2 rounded-lg bg-cyber-green/20 text-cyber-green border border-cyber-green/40 text-sm font-medium' : 'px-4 py-2 rounded-lg text-gray-400 hover:text-white text-sm'}
        >
          <Calculator className="w-4 h-4 inline mr-1" /> ต้นทุน &amp; กำไร
        </button>
        <button
          onClick={() => setMainTab('platform')}
          className={mainTab === 'platform' ? 'px-4 py-2 rounded-lg bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/40 text-sm font-medium' : 'px-4 py-2 rounded-lg text-gray-400 hover:text-white text-sm'}
        >
          <Upload className="w-4 h-4 inline mr-1" /> Platform Orders
        </button>
      </div>

      {/* ===== ANALYTICS TAB ===== */}
      {mainTab === 'analytics' && (
        <>
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
                {(shops || []).map(shop => (
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
              {/* View Mode Toggle */}
              <button
                onClick={() => setViewMode('chart')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'chart'
                    ? 'bg-cyber-primary text-white'
                    : 'bg-cyber-card/50 text-gray-400 hover:bg-cyber-card hover:text-white'
                }`}
                title="Chart View"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'table'
                    ? 'bg-cyber-primary text-white'
                    : 'bg-cyber-card/50 text-gray-400 hover:bg-cyber-card hover:text-white'
                }`}
                title="Table View"
              >
                <Table className="w-5 h-5" />
              </button>

              <div className="w-px h-8 bg-cyber-border mx-1" />

              {/* Chart Types (only show when in chart mode) */}
              {viewMode === 'chart' && CHART_TYPES.map(type => (
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

              <div className="w-px h-8 bg-cyber-border mx-1" />

              {/* Pivot Settings */}
              <button
                onClick={() => setShowPivotSettings(!showPivotSettings)}
                className={`p-2 rounded-lg transition-all ${
                  showPivotSettings
                    ? 'bg-cyber-primary text-white'
                    : 'bg-cyber-card/50 text-gray-400 hover:bg-cyber-card hover:text-white'
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

          {/* Pivot Settings Panel */}
          {showPivotSettings && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="cyber-card p-4"
            >
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-cyber-primary" />
                Pivot Table Configuration
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">จัดกลุ่มตาม</label>
                  <select
                    value={pivotConfig.rowBy}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, rowBy: e.target.value as any })}
                    className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-primary"
                  >
                    {ROW_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Metrics</label>
                  <div className="space-y-1 bg-cyber-card border border-cyber-border rounded-lg p-2 max-h-32 overflow-y-auto">
                    {METRIC_OPTIONS.map(metric => (
                      <label key={metric.key} className="flex items-center gap-2 cursor-pointer hover:bg-cyber-card/50 p-1 rounded">
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
                          className="rounded border-cyber-border text-cyber-primary focus:ring-cyber-primary"
                        />
                        <span className="text-sm">{metric.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">การคำนวณ</label>
                  <select
                    value={pivotConfig.aggregation}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, aggregation: e.target.value as any })}
                    className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-primary"
                  >
                    <option value="sum">รวม (Sum)</option>
                    <option value="avg">เฉลี่ย (Average)</option>
                    <option value="count">นับ (Count)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">จัดกลุ่มช่วง</label>
                  <select
                    value={pivotConfig.groupBy}
                    onChange={(e) => setPivotConfig({ ...pivotConfig, groupBy: e.target.value as any })}
                    disabled={pivotConfig.rowBy !== 'date'}
                    className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-primary disabled:opacity-50"
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

          {/* Table View */}
          {metrics.length > 0 && viewMode === 'table' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="cyber-card p-6"
            >
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Table className="w-6 h-6 text-cyber-primary" />
                Pivot Table View
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-cyber-border">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">
                        {ROW_OPTIONS.find(opt => opt.key === pivotConfig.rowBy)?.label || 'Key'}
                      </th>
                      {pivotConfig.metrics.map(metricKey => {
                        const metric = METRIC_OPTIONS.find(m => m.key === metricKey)
                        return (
                          <th key={metricKey} className="text-right py-3 px-4 text-sm font-semibold text-gray-300">
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
                        className="border-b border-cyber-border/30 hover:bg-cyber-card/30 transition-colors"
                      >
                        <td className="py-3 px-4 text-sm font-medium text-white">{row.key}</td>
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
                            <td key={metricKey} className="py-3 px-4 text-sm text-right font-mono" style={{ color: metric?.color || '#9ca3af' }}>
                              {formatted}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {pivotData.length > 1 && (
                      <tr className="border-t-2 border-cyber-primary/50 bg-cyber-card/50 font-bold">
                        <td className="py-3 px-4 text-sm text-white">
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
                            <td key={metricKey} className="py-3 px-4 text-sm text-right font-mono" style={{ color: metric?.color || '#9ca3af' }}>
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
                <div className="text-center py-12 text-gray-400">
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
        </>
      )}

      {/* ===== P&L TAB ===== */}
      {mainTab === 'profit' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Date Range Filter */}
          <div className="cyber-card p-4 flex flex-wrap gap-4 items-center">
            <Calendar className="w-5 h-5 text-cyber-green" />
            <span className="text-gray-400 text-sm">ช่วงวันที่:</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-green"
            />
            <span className="text-gray-400">ถึง</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-cyber-card border border-cyber-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyber-green"
            />
          </div>

          {/* Two-column: Form + History */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Ad Spend Form */}
            <div className="cyber-card p-5 space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2 text-cyber-green">
                <Plus className="w-5 h-5" />
                บันทึกค่าโฆษณา
                <button
                  type="button"
                  onClick={() => setAdForm({ date: '', platform: 'FACEBOOK', channel: '', amount: '', notes: '' })}
                  className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
                  title="ล้างฟอร์ม"
                >
                  <X className="w-4 h-4" />
                </button>
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">วันที่ *</label>
                  <input
                    type="date"
                    value={adForm.date}
                    onChange={(e) => setAdForm({ ...adForm, date: e.target.value })}
                    className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-green text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">แพลตฟอร์ม *</label>
                  <select
                    value={adForm.platform}
                    onChange={(e) => setAdForm({ ...adForm, platform: e.target.value })}
                    className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-green text-sm"
                  >
                    <option value="FACEBOOK">Facebook</option>
                    <option value="GOOGLE">Google</option>
                    <option value="LINE_OA">LINE OA</option>
                    <option value="TIKTOK_ADS">TikTok Ads</option>
                    <option value="INSTAGRAM">Instagram</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อ Campaign (ไม่บังคับ)</label>
                <input
                  type="text"
                  placeholder="เช่น Summer Sale Campaign"
                  value={adForm.channel}
                  onChange={(e) => setAdForm({ ...adForm, channel: e.target.value })}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-green text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">จำนวนเงิน (฿) *</label>
                <input
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={adForm.amount}
                  onChange={(e) => setAdForm({ ...adForm, amount: e.target.value })}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-green text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">หมายเหตุ (ไม่บังคับ)</label>
                <textarea
                  placeholder="รายละเอียดเพิ่มเติม..."
                  value={adForm.notes}
                  onChange={(e) => setAdForm({ ...adForm, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-green text-sm resize-none"
                />
              </div>

              <button
                onClick={handleAddAdSpend}
                disabled={adFormSaving}
                className="w-full py-2 bg-gradient-to-r from-cyber-green to-emerald-500 rounded-lg font-semibold hover:shadow-neon transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
              >
                {adFormSaving ? (
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {adFormSaving ? 'กำลังบันทึก...' : 'บันทึกค่าโฆษณา'}
              </button>
            </div>

            {/* Right: Ad Spend History */}
            <div className="cyber-card p-5">
              <h3 className="text-lg font-bold flex items-center gap-2 text-cyber-primary mb-4">
                <DollarSign className="w-5 h-5" />
                ประวัติค่าโฆษณา (Manual)
              </h3>
              {adSpends.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">ยังไม่มีข้อมูลค่าโฆษณา</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {adSpends.map((spend) => {
                    const badgeColors: Record<string, string> = {
                      FACEBOOK: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                      GOOGLE: 'bg-red-500/20 text-red-400 border-red-500/30',
                      LINE_OA: 'bg-green-500/20 text-green-400 border-green-500/30',
                      TIKTOK_ADS: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                      INSTAGRAM: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
                      OTHER: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                    }
                    return (
                      <div key={spend.id} className="flex items-center gap-2 p-2 bg-cyber-card/50 rounded-lg border border-cyber-border/30 hover:border-cyber-border transition-colors">
                        <span className="text-xs text-gray-400 w-20 shrink-0">{spend.date}</span>
                        <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${badgeColors[spend.platform] || badgeColors.OTHER}`}>
                          {spend.platform}
                        </span>
                        <span className="text-xs text-gray-300 flex-1 truncate">{spend.channel || '-'}</span>
                        <span className="text-xs font-mono text-cyber-green shrink-0">
                          ฿{spend.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </span>
                        <button
                          onClick={() => handleDeleteAdSpend(spend.id)}
                          className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* P&L Summary Cards */}
          {profitReport.length > 0 && (() => {
            const totalRevenue = profitReport.reduce((s, r) => s + r.revenue, 0)
            const totalCogs = profitReport.reduce((s, r) => s + r.cogs, 0)
            const totalAdSpend = profitReport.reduce((s, r) => s + r.totalAdSpend, 0)
            const totalNetProfit = profitReport.reduce((s, r) => s + r.netProfit, 0)
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div whileHover={{ scale: 1.02 }} className="cyber-card p-4">
                  <p className="text-xs text-gray-400 mb-1">ยอดขายรวม</p>
                  <p className="text-xl font-bold text-cyan-400">฿{totalRevenue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} className="cyber-card p-4">
                  <p className="text-xs text-gray-400 mb-1">ต้นทุนสินค้ารวม</p>
                  <p className="text-xl font-bold text-orange-400">฿{totalCogs.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} className="cyber-card p-4">
                  <p className="text-xs text-gray-400 mb-1">ค่าโฆษณารวม</p>
                  <p className="text-xl font-bold text-purple-400">฿{totalAdSpend.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</p>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} className="cyber-card p-4">
                  <p className="text-xs text-gray-400 mb-1">กำไรสุทธิรวม</p>
                  <p className={`text-xl font-bold ${totalNetProfit >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>
                    ฿{totalNetProfit.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </p>
                </motion.div>
              </div>
            )
          })()}

          {/* P&L Report Table */}
          <div className="cyber-card p-5">
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Calculator className="w-5 h-5 text-cyber-green" />
              รายงาน P&amp;L รายวัน
            </h3>

            {profitLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-2 border-cyber-green border-t-transparent rounded-full" />
                <span className="ml-3 text-gray-400">กำลังโหลด...</span>
              </div>
            ) : profitReport.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Calculator className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="text-sm">ไม่มีข้อมูล P&amp;L ในช่วงเวลานี้</p>
                <p className="text-xs mt-1 text-gray-600">เลือกช่วงวันที่และตรวจสอบข้อมูลยอดขาย</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-cyber-border">
                      <th className="text-left py-2 px-3 text-gray-400 font-semibold">วันที่</th>
                      <th className="text-right py-2 px-3 text-cyan-400 font-semibold">ยอดขาย</th>
                      <th className="text-right py-2 px-3 text-orange-400 font-semibold">COGS</th>
                      <th className="text-right py-2 px-3 text-green-400 font-semibold">กำไรขั้นต้น</th>
                      <th className="text-right py-2 px-3 text-purple-400 font-semibold">โฆษณา CSV</th>
                      <th className="text-right py-2 px-3 text-purple-300 font-semibold">โฆษณา Manual</th>
                      <th className="text-right py-2 px-3 text-purple-500 font-semibold">โฆษณารวม</th>
                      <th className="text-right py-2 px-3 text-green-400 font-semibold">กำไรสุทธิ</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-semibold">Net Margin</th>
                      <th className="text-right py-2 px-3 text-blue-400 font-semibold">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitReport.map((row, idx) => (
                      <tr key={idx} className="border-b border-cyber-border/20 hover:bg-cyber-card/30 transition-colors">
                        <td className="py-2 px-3 text-gray-300 font-medium">{row.date}</td>
                        <td className="py-2 px-3 text-right font-mono text-cyan-400">
                          ฿{row.revenue.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-orange-400">
                          ฿{row.cogs.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${row.grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ฿{row.grossProfit.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-purple-400">
                          ฿{row.csvAdSpend.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-purple-300">
                          ฿{row.manualAdSpend.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-purple-500">
                          ฿{row.totalAdSpend.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${row.netProfit >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>
                          ฿{row.netProfit.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${row.netMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {row.netMargin.toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-blue-400">
                          {row.roas.toFixed(2)}x
                        </td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    {profitReport.length > 1 && (() => {
                      const tRev = profitReport.reduce((s, r) => s + r.revenue, 0)
                      const tCogs = profitReport.reduce((s, r) => s + r.cogs, 0)
                      const tGross = profitReport.reduce((s, r) => s + r.grossProfit, 0)
                      const tCsvAd = profitReport.reduce((s, r) => s + r.csvAdSpend, 0)
                      const tManAd = profitReport.reduce((s, r) => s + r.manualAdSpend, 0)
                      const tTotAd = profitReport.reduce((s, r) => s + r.totalAdSpend, 0)
                      const tNet = profitReport.reduce((s, r) => s + r.netProfit, 0)
                      const tMargin = tRev > 0 ? (tNet / tRev) * 100 : 0
                      const tRoas = tTotAd > 0 ? tRev / tTotAd : 0
                      return (
                        <tr className="border-t-2 border-cyber-green/40 bg-cyber-card/50 font-bold">
                          <td className="py-2 px-3 text-white text-xs">รวมทั้งหมด</td>
                          <td className="py-2 px-3 text-right font-mono text-cyan-400">฿{tRev.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className="py-2 px-3 text-right font-mono text-orange-400">฿{tCogs.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className={`py-2 px-3 text-right font-mono ${tGross >= 0 ? 'text-green-400' : 'text-red-400'}`}>฿{tGross.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className="py-2 px-3 text-right font-mono text-purple-400">฿{tCsvAd.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className="py-2 px-3 text-right font-mono text-purple-300">฿{tManAd.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className="py-2 px-3 text-right font-mono text-purple-500">฿{tTotAd.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className={`py-2 px-3 text-right font-mono ${tNet >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>฿{tNet.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                          <td className={`py-2 px-3 text-right font-mono ${tMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>{tMargin.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right font-mono text-blue-400">{tRoas.toFixed(2)}x</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ===== PLATFORM TAB ===== */}
      {mainTab === 'platform' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* A. Upload & Preview Panel */}
          <div className="cyber-card p-5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2 text-cyber-purple">
              <Upload className="w-5 h-5" />
              อัปโหลด CSV จาก Platform
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Platform</label>
                <select
                  value={platPlatform}
                  onChange={e => setPlatPlatform(e.target.value)}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-purple text-sm"
                >
                  <option value="SHOPEE">Shopee</option>
                  <option value="LAZADA">Lazada</option>
                  <option value="TIKTOK">TikTok Shop</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">วันที่นำเข้า</label>
                <input
                  type="date"
                  value={platImportDate}
                  onChange={e => setPlatImportDate(e.target.value)}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-purple text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ไฟล์ CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={e => setPlatFile(e.target.files?.[0] || null)}
                  className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyber-purple text-sm file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-cyber-purple/20 file:text-cyber-purple"
                />
              </div>
            </div>

            <button
              onClick={handlePlatPreview}
              disabled={platUploading || !platFile || !platImportDate}
              className="px-5 py-2 bg-gradient-to-r from-cyber-purple to-pink-500 rounded-lg font-semibold text-sm hover:shadow-neon transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {platUploading ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {platUploading ? 'กำลังโหลด...' : 'โหลดตัวอย่าง'}
            </button>

            {/* Preview Table */}
            {platPreview && (
              <div className="space-y-3">
                {/* Summary */}
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full">
                    จับคู่แล้ว {platPreview.summary.matched} รายการ
                  </span>
                  <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full">
                    ยังไม่จับคู่ {platPreview.summary.unmatched} รายการ
                  </span>
                  <span className="px-3 py-1 bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/30 rounded-full">
                    ตัดสต๊อกรวม {platPreview.summary.totalItemsSold} ชิ้น
                  </span>
                  <span className="px-3 py-1 bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/30 rounded-full">
                    ค่าโฆษณา ฿{(platPreview.summary.totalAdCost || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-cyber-border">
                        <th className="text-left py-2 px-2 text-gray-400">SKU</th>
                        <th className="text-left py-2 px-2 text-gray-400">สินค้า</th>
                        <th className="text-right py-2 px-2 text-gray-400">ขายแล้ว</th>
                        <th className="text-right py-2 px-2 text-gray-400">ยอดขาย</th>
                        <th className="text-right py-2 px-2 text-gray-400">ค่าโฆษณา</th>
                        <th className="text-right py-2 px-2 text-gray-400">ROAS</th>
                        <th className="text-right py-2 px-2 text-gray-400">สต๊อก</th>
                        <th className="text-center py-2 px-2 text-gray-400">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(platPreview.items || []).map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-cyber-border/20 hover:bg-cyber-card/30">
                          <td className="py-2 px-2 font-mono text-gray-300">{item.sku}</td>
                          <td className="py-2 px-2 text-gray-300 max-w-[140px] truncate">{item.productName}</td>
                          <td className="py-2 px-2 text-right text-cyber-primary font-mono">{item.itemsSold}</td>
                          <td className="py-2 px-2 text-right text-cyan-400 font-mono">
                            ฿{(item.revenue || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2 px-2 text-right text-purple-400 font-mono">
                            ฿{(item.adCost || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2 px-2 text-right text-blue-400 font-mono">{(item.roas || 0).toFixed(2)}x</td>
                          <td className="py-2 px-2 text-right text-gray-300 font-mono">{item.currentStock ?? '-'}</td>
                          <td className="py-2 px-2 text-center">
                            {item.matchStatus === 'MATCHED' ? (
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded text-xs">
                                ✅ พบสินค้า
                              </span>
                            ) : (
                              <div className="space-y-1">
                                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded text-xs block text-center">
                                  ⚠️ ไม่พบ SKU
                                </span>
                                <div className="flex gap-1">
                                  <input
                                    type="text"
                                    placeholder="ค้นหาสินค้า..."
                                    value={platSkuSearchMap[item.sku] || ''}
                                    onChange={e => handlePlatSkuSearch(item.sku, e.target.value)}
                                    className="flex-1 bg-cyber-card border border-cyber-border rounded px-1.5 py-0.5 text-white text-xs focus:outline-none focus:border-yellow-400 min-w-0"
                                  />
                                </div>
                                {(platSkuResults[item.sku] || []).length > 0 && (
                                  <div className="bg-cyber-card border border-cyber-border rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                                    {(platSkuResults[item.sku] || []).map((si: any) => (
                                      <button
                                        key={si.id}
                                        onClick={() => handlePlatSaveMapping(item.sku, si.id)}
                                        disabled={platSkuSaving[item.sku]}
                                        className="w-full text-left px-2 py-1 hover:bg-cyber-primary/20 text-xs text-gray-300 hover:text-white transition-colors border-b border-cyber-border/30 last:border-0 flex justify-between items-center gap-1"
                                      >
                                        <span className="truncate">{si.name}</span>
                                        <span className="text-gray-500 shrink-0 font-mono">{si.sku}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={handlePlatConfirm}
                  disabled={platConfirming}
                  className="w-full py-2.5 bg-gradient-to-r from-cyber-green to-emerald-500 rounded-lg font-semibold text-sm hover:shadow-neon transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {platConfirming ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : null}
                  {platConfirming ? 'กำลังยืนยัน...' : 'ยืนยันและตัดสต๊อก'}
                </button>
              </div>
            )}
          </div>

          {/* B. Pending JE Approval */}
          <div className="cyber-card p-5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2 text-yellow-400">
              <DollarSign className="w-5 h-5" />
              รออนุมัติ JE ค่าโฆษณา
            </h3>
            {platPendingJE.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-20" />
                ไม่มีรายการรออนุมัติ
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-cyber-border">
                      <th className="text-left py-2 px-2 text-gray-400">วันที่</th>
                      <th className="text-left py-2 px-2 text-gray-400">Platform</th>
                      <th className="text-left py-2 px-2 text-gray-400">รายการ</th>
                      <th className="text-right py-2 px-2 text-gray-400">จำนวน</th>
                      <th className="text-center py-2 px-2 text-gray-400">สถานะ</th>
                      <th className="text-center py-2 px-2 text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platPendingJE.map((pje: any) => (
                      <tr key={pje.id} className="border-b border-cyber-border/20 hover:bg-cyber-card/30">
                        <td className="py-2 px-2 text-gray-300">{pje.import_date}</td>
                        <td className="py-2 px-2">
                          <span className="px-2 py-0.5 bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/30 rounded text-xs">
                            {pje.platform}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-300 max-w-[200px] truncate">{pje.description}</td>
                        <td className="py-2 px-2 text-right font-mono text-yellow-400">
                          ฿{(pje.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded text-xs">
                            {pje.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => {
                                setPlatJEModal(pje)
                                setPlatJEDr('')
                                setPlatJECr('')
                                setPlatJENotes('')
                              }}
                              className="px-2 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded text-xs hover:bg-green-500/30 transition-colors"
                            >
                              อนุมัติ
                            </button>
                            <button
                              onClick={() => handlePlatRejectJE(pje.id)}
                              className="px-2 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-xs hover:bg-red-500/30 transition-colors"
                            >
                              ปฏิเสธ
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* C. Import History */}
          <div className="cyber-card p-5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2 text-cyber-primary">
              <BarChart3 className="w-5 h-5" />
              ประวัติการนำเข้า
            </h3>
            {platImports.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                ยังไม่มีประวัติการนำเข้า
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-cyber-border">
                      <th className="text-left py-2 px-2 text-gray-400">วันที่</th>
                      <th className="text-left py-2 px-2 text-gray-400">Platform</th>
                      <th className="text-left py-2 px-2 text-gray-400">ไฟล์</th>
                      <th className="text-right py-2 px-2 text-gray-400">จับคู่</th>
                      <th className="text-right py-2 px-2 text-gray-400">ตัดสต๊อก</th>
                      <th className="text-right py-2 px-2 text-gray-400">ค่าโฆษณา</th>
                      <th className="text-center py-2 px-2 text-gray-400">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platImports.map((imp: any) => (
                      <tr key={imp.id} className="border-b border-cyber-border/20 hover:bg-cyber-card/30">
                        <td className="py-2 px-2 text-gray-300">{imp.import_date}</td>
                        <td className="py-2 px-2">
                          <span className="px-2 py-0.5 bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/30 rounded text-xs">
                            {imp.platform}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-400 max-w-[160px] truncate">{imp.filename}</td>
                        <td className="py-2 px-2 text-right text-green-400 font-mono">
                          {imp.matched_rows}/{imp.total_rows}
                        </td>
                        <td className="py-2 px-2 text-right text-cyber-primary font-mono">{imp.total_items_sold}</td>
                        <td className="py-2 px-2 text-right text-purple-400 font-mono">
                          ฿{(imp.total_ad_cost || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs border ${
                            imp.status === 'CONFIRMED'
                              ? 'bg-green-500/20 text-green-400 border-green-500/30'
                              : imp.status === 'CANCELLED'
                              ? 'bg-red-500/20 text-red-400 border-red-500/30'
                              : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                          }`}>
                            {imp.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* JE Approval Modal */}
      {platJEModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="cyber-card p-6 max-w-md w-full space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-yellow-400">อนุมัติ JE ค่าโฆษณา</h3>
              <button onClick={() => setPlatJEModal(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-cyber-card/50 rounded-lg p-3 border border-cyber-border/30 text-sm space-y-1">
              <p className="text-gray-400 text-xs">รายการ</p>
              <p className="text-white">{platJEModal.description}</p>
              <p className="text-yellow-400 font-bold text-lg font-mono">
                ฿{(platJEModal.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Dr. บัญชีค่าโฆษณา (Expense)</label>
              <select
                value={platJEDr}
                onChange={e => setPlatJEDr(e.target.value)}
                className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-yellow-400 text-sm"
              >
                <option value="">-- เลือกบัญชี --</option>
                {platAccounts
                  .filter((a: any) => a.type === 'EXPENSE' || a.normal_balance === 'DEBIT')
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Cr. บัญชีเจ้าหนี้ / เงินสด</label>
              <select
                value={platJECr}
                onChange={e => setPlatJECr(e.target.value)}
                className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-yellow-400 text-sm"
              >
                <option value="">-- เลือกบัญชี --</option>
                {platAccounts
                  .filter((a: any) => a.type === 'LIABILITY' || a.type === 'ASSET' || a.normal_balance === 'CREDIT')
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">หมายเหตุ</label>
              <textarea
                value={platJENotes}
                onChange={e => setPlatJENotes(e.target.value)}
                rows={2}
                placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
                className="w-full bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-yellow-400 text-sm resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handlePlatApproveJE}
                disabled={platJESaving || !platJEDr || !platJECr}
                className="flex-1 py-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg font-semibold text-sm hover:shadow-neon transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {platJESaving ? (
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : null}
                {platJESaving ? 'กำลังบันทึก...' : 'อนุมัติ JE'}
              </button>
              <button
                onClick={() => setPlatJEModal(null)}
                className="px-4 py-2 bg-cyber-card hover:bg-red-500/20 rounded-lg text-sm transition-all"
              >
                ยกเลิก
              </button>
            </div>
          </motion.div>
        </div>
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

  const filteredShops = (shops || []).filter(shop =>
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
            {(filteredShops || []).map(shop => (
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
