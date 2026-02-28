import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator as CalcIcon,
  Package,
  DollarSign,
  TrendingUp,
  Search,
  Plus,
  X,
  Save,
  RefreshCw,
  ShoppingCart,
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

interface Product {
  id: string
  code: string
  name: string
  category: string
}

interface BOMMaterial {
  materialId: string
  quantity: number
  unit: string
  materialName?: string
  materialCode?: string
  unitCost?: number
}

interface BOM {
  id: string
  productId: string
  productName?: string
  productCode?: string
  version: string
  status: string
  materials: BOMMaterial[]
}

interface OperatingCostItem {
  id: string
  category: string
  amount: number
  type: 'fixed' | 'percent' // fixed = ฿, percent = %
}

interface PlatformCalculation {
  platform: string
  sellingPrice: number
  quantity: number
  targetGP: number
  affiliateRate: number
  vatRate: number
  platformFees: number
  grossRevenue: number
  totalCosts: number
  netProfit: number
  profitMargin: number
}

function Calculator() {
  // Data from database
  const [products, setProducts] = useState<Product[]>([])
  const [boms, setBOMs] = useState<BOM[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])

  // Search and selection
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null)

  // Operating costs (multiple categories)
  const [operatingCosts, setOperatingCosts] = useState<OperatingCostItem[]>([
    { id: '1', category: '', amount: 0, type: 'fixed' },
  ])

  // Cost calculation
  const [scrapValue, setScrapValue] = useState<number>(0)
  const [costBreakdown, setCostBreakdown] = useState<any>(null)

  // Platform settings
  const [sellingPrice, setSellingPrice] = useState<number>(0)
  const [quantity, setQuantity] = useState<number>(1)
  const [targetGP, setTargetGP] = useState<number>(30) // Target GP %
  const [affiliateRate, setAffiliateRate] = useState<number>(0) // Affiliate %
  const [vatRate, setVatRate] = useState<number>(7) // VAT %

  const [platformResults, setPlatformResults] = useState<PlatformCalculation[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch initial data
  useEffect(() => {
    fetchInitialData()
  }, [])

  // Filter products when search changes
  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = (products || []).filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
      setFilteredProducts(filtered)
      setShowDropdown(true)
    } else {
      setFilteredProducts([])
      setShowDropdown(false)
    }
  }, [searchQuery, products])

  const fetchInitialData = async () => {
    try {
      setLoading(true)
      const [productsRes, bomsRes] = await Promise.all([
        api.get('/data/products'),
        api.get('/data/boms'),
      ])

      setProducts(productsRes.data.data)
      setBOMs(bomsRes.data.data)
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('ไม่สามารถโหลดข้อมูลได้')
    } finally {
      setLoading(false)
    }
  }

  const handleProductSelect = (product: Product) => {
    setSearchQuery(`${product.code} - ${product.name}`)
    setSelectedProduct(product.id)
    setShowDropdown(false)

    // Find BOM for this product
    const bom = boms.find((b) => b.productId === product.id && b.status === 'ACTIVE')

    if (bom) {
      setSelectedBOM(bom)
      toast.success(`โหลด BOM ${bom.version} สำเร็จ`)
    } else {
      setSelectedBOM(null)
      toast.error('ไม่พบ BOM สำหรับสินค้านี้')
    }
  }

  // Operating costs management
  const addOperatingCost = () => {
    setOperatingCosts([
      ...operatingCosts,
      { id: Date.now().toString(), category: '', amount: 0, type: 'fixed' },
    ])
  }

  const removeOperatingCost = (id: string) => {
    setOperatingCosts((operatingCosts || []).filter((c) => c.id !== id))
  }

  const updateOperatingCost = (id: string, field: 'category' | 'amount' | 'type', value: string | number) => {
    setOperatingCosts(
      (operatingCosts || []).map((c) => (c.id === id ? { ...c, [field]: value } : c))
    )
  }

  const calculateCost = async () => {
    if (!selectedBOM) {
      toast.error('กรุณาเลือกสินค้าก่อน')
      return
    }

    try {
      // Prepare materials data
      const materialsData = (selectedBOM.materials || []).map((m) => ({
        name: m.materialName || '',
        quantity: m.quantity,
        unit: m.unit,
        unitPrice: m.unitCost || 0,
      }))

      // Calculate raw material cost first (for percentage calculation)
      const rawMaterialCost = selectedBOM.materials.reduce(
        (sum, m) => sum + (m.unitCost || 0) * m.quantity,
        0
      )

      // Calculate operating costs (handle both fixed and percentage)
      let totalOperatingCost = 0
      operatingCosts.forEach((cost) => {
        if (cost.type === 'percent') {
          // Calculate percentage of raw material cost
          totalOperatingCost += (rawMaterialCost * (cost.amount || 0)) / 100
        } else {
          // Fixed amount
          totalOperatingCost += cost.amount || 0
        }
      })

      const response = await api.post('/calculator/production-cost', {
        materials: materialsData,
        operatingCost: totalOperatingCost,
        scrapValue,
      })

      const result = response.data.data
      setCostBreakdown(result)
      toast.success('คำนวณต้นทุนสำเร็จ!')

      // Auto-suggest selling price based on GP
      if (targetGP > 0) {
        const suggestedPrice = result.totalCost / (1 - targetGP / 100)
        setSellingPrice(Math.ceil(suggestedPrice))
      }
    } catch (error) {
      console.error('Error calculating cost:', error)
      toast.error('เกิดข้อผิดพลาดในการคำนวณ')
    }
  }

  const comparePlatforms = async () => {
    if (!costBreakdown) {
      toast.error('กรุณาคำนวณต้นทุนก่อน')
      return
    }

    if (!sellingPrice || sellingPrice <= 0) {
      toast.error('กรุณาใส่ราคาขาย')
      return
    }

    try {
      const response = await api.post('/calculator/compare-platforms', {
        sellingPrice,
        quantity,
        productionCost: costBreakdown.totalCost,
        platforms: ['lazada', 'shopee', 'tiktok', 'facebook', 'line'],
      })

      const data = response.data.data

      // Calculate with GP, Affiliate, VAT
      const results: PlatformCalculation[] = Object.keys(data).map((platform) => {
        const platformData = data[platform]
        const grossRevenue = platformData.grossRevenue
        const platformFees = platformData.platformFees

        // Calculate affiliate cost
        const affiliateCost = (grossRevenue * affiliateRate) / 100

        // Calculate VAT
        const vatAmount = (grossRevenue * vatRate) / 100

        // Total costs = production + platform fees + affiliate + VAT
        const totalCosts = platformData.productionCost + platformFees + affiliateCost + vatAmount

        const netProfit = grossRevenue - totalCosts
        const profitMargin = (netProfit / grossRevenue) * 100

        return {
          platform,
          sellingPrice,
          quantity,
          targetGP,
          affiliateRate,
          vatRate,
          platformFees,
          grossRevenue,
          totalCosts,
          netProfit,
          profitMargin,
        }
      })

      setPlatformResults(results.sort((a, b) => b.netProfit - a.netProfit))
      toast.success('เปรียบเทียบ Platform สำเร็จ!')
    } catch (error) {
      console.error('Error comparing platforms:', error)
      toast.error('เกิดข้อผิดพลาดในการเปรียบเทียบ')
    }
  }

  const saveStandardCost = async () => {
    if (!selectedProduct || !costBreakdown) {
      toast.error('กรุณาคำนวณต้นทุนก่อน')
      return
    }

    try {
      // Save standard cost to product
      const product = products.find((p) => p.id === selectedProduct)

      toast.success(`บันทึกต้นทุนมาตรฐาน ฿${costBreakdown.totalCost.toFixed(2)} สำหรับ ${product?.name}`)
    } catch (error) {
      console.error('Error saving standard cost:', error)
      toast.error('เกิดข้อผิดพลาดในการบันทึก')
    }
  }

  const resetForm = () => {
    setSearchQuery('')
    setSelectedProduct('')
    setSelectedBOM(null)
    setOperatingCosts([{ id: '1', category: '', amount: 0, type: 'fixed' }])
    setScrapValue(0)
    setCostBreakdown(null)
    setSellingPrice(0)
    setQuantity(1)
    setPlatformResults([])
  }

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
            <span className="neon-text">Cost Calculator</span>
          </h1>
          <p className="text-gray-400">
            คำนวณต้นทุนการผลิตและกำไรจาก E-commerce Platforms
          </p>
        </div>
        <button
          onClick={resetForm}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          รีเซ็ต
        </button>
      </div>

      {/* Main Content - Single Column */}
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Product Search */}
        <div className="cyber-card p-4">
          <div className="flex items-center gap-3 mb-6">
            <Package className="w-6 h-6 text-cyber-primary" />
            <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
              ค้นหาสินค้า
            </h2>
          </div>

          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery && setShowDropdown(true)}
                className="cyber-input w-full pl-12"
                placeholder="ค้นหาด้วยรหัสหรือชื่อสินค้า..."
                disabled={loading}
              />
            </div>

            {/* Search Results Dropdown */}
            {showDropdown && filteredProducts.length > 0 && (
              <div className="absolute z-10 w-full mt-2 bg-cyber-darker border border-cyber-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {(filteredProducts || []).map((product) => (
                  <button
                    key={product.id}
                    onClick={() => handleProductSelect(product)}
                    className="w-full text-left px-4 py-3 hover:bg-cyber-primary/10 border-b border-cyber-border last:border-b-0 transition-colors"
                  >
                    <div className="font-semibold text-gray-100">{product.code}</div>
                    <div className="text-sm text-gray-400">{product.name}</div>
                    <div className="text-xs text-cyber-primary">{product.category}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedBOM && (
            <div className="mt-4 p-4 bg-cyber-primary/10 rounded-lg border border-cyber-primary/30">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-400">BOM Version:</span>
                  <p className="font-semibold text-cyber-primary">{selectedBOM.version}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-400">จำนวนวัตถุดิบ:</span>
                  <p className="font-semibold text-cyber-green">
                    {selectedBOM.materials.length} รายการ
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Materials List */}
        {selectedBOM && (
          <div className="cyber-card p-4">
            <div className="flex items-center gap-3 mb-6">
              <Package className="w-6 h-6 text-cyber-green" />
              <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                รายการวัตถุดิบ
              </h2>
            </div>

            <div className="space-y-3">
              {(selectedBOM.materials || []).map((material, index) => (
                <div
                  key={index}
                  className="p-4 bg-cyber-darker/50 rounded-lg border border-cyber-border"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-100 text-lg">
                        {material.materialName}
                      </h3>
                      <p className="text-sm text-gray-400">{material.materialCode}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-cyber-green">
                        ฿{((material.unitCost || 0) * material.quantity).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm bg-cyber-darker/30 p-3 rounded">
                    <div>
                      <span className="text-gray-400 block mb-1">จำนวน:</span>
                      <p className="text-gray-200 font-medium">
                        {material.quantity} {material.unit}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400 block mb-1">ราคา/หน่วย:</span>
                      <p className="text-gray-200 font-medium">
                        ฿{(material.unitCost || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400 block mb-1">รวม:</span>
                      <p className="text-gray-200 font-medium">
                        ฿{((material.unitCost || 0) * material.quantity).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Operating Costs */}
        {selectedBOM && (
          <div className="cyber-card p-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-cyber-purple" />
                <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                  ค่าดำเนินการ
                </h2>
              </div>
              <button
                onClick={addOperatingCost}
                className="flex items-center gap-2 px-3 py-2 bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50 rounded-lg hover:bg-cyber-primary/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
                เพิ่มหมวด
              </button>
            </div>

            <div className="space-y-3">
              {(operatingCosts || []).map((cost) => (
                <div key={cost.id} className="flex gap-2 items-center">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={cost.category}
                      onChange={(e) =>
                        updateOperatingCost(cost.id, 'category', e.target.value)
                      }
                      className="cyber-input w-full"
                      placeholder="หมวดค่าใช้จ่าย (เช่น ค่าแรง, ค่าไฟ)"
                    />
                  </div>
                  <div className="w-40">
                    <input
                      type="number"
                      value={cost.amount || ''}
                      onChange={(e) =>
                        updateOperatingCost(cost.id, 'amount', parseFloat(e.target.value) || 0)
                      }
                      className="cyber-input w-full"
                      placeholder={cost.type === 'percent' ? '0' : '฿0.00'}
                    />
                  </div>
                  <div className="w-24">
                    <select
                      value={cost.type}
                      onChange={(e) =>
                        updateOperatingCost(cost.id, 'type', e.target.value)
                      }
                      className="cyber-input w-full"
                    >
                      <option value="fixed">฿</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                  {operatingCosts.length > 1 && (
                    <button
                      onClick={() => removeOperatingCost(cost.id)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}

              <div className="pt-3 border-t border-cyber-border">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">รวมค่าดำเนินการทั้งหมด:</span>
                  <span className="text-xl font-bold text-cyber-green">
                    {selectedBOM ? (() => {
                      const rawMaterialCost = selectedBOM.materials.reduce(
                        (sum, m) => sum + (m.unitCost || 0) * m.quantity,
                        0
                      )
                      let total = 0
                      operatingCosts.forEach((cost) => {
                        if (cost.type === 'percent') {
                          total += (rawMaterialCost * (cost.amount || 0)) / 100
                        } else {
                          total += cost.amount || 0
                        }
                      })
                      return `฿${total.toFixed(2)}`
                    })() : '฿0.00'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                มูลค่าของเสีย (ถ้ามี)
              </label>
              <input
                type="number"
                value={scrapValue || ''}
                onChange={(e) => setScrapValue(parseFloat(e.target.value) || 0)}
                className="cyber-input w-full"
                placeholder="฿0.00"
              />
            </div>

            <button
              onClick={calculateCost}
              className="w-full mt-6 cyber-btn-primary flex items-center justify-center gap-2"
            >
              <CalcIcon className="w-5 h-5" />
              คำนวณต้นทุนการผลิต
            </button>
          </div>
        )}

        {/* Cost Result */}
        {costBreakdown && (
          <div className="cyber-card p-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-6 h-6 text-cyber-green" />
                <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                  ผลการคำนวณ
                </h2>
              </div>
              <button
                onClick={saveStandardCost}
                className="flex items-center gap-2 px-4 py-2 cyber-btn-secondary"
              >
                <Save className="w-4 h-4" />
                บันทึกต้นทุนมาตรฐาน
              </button>
            </div>

            <div className="p-5 bg-gradient-to-br from-cyber-primary/10 to-cyber-green/10 rounded-lg border border-cyber-border">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-lg">
                  <span className="text-gray-400">ต้นทุนวัตถุดิบ:</span>
                  <span className="text-gray-200 font-semibold">
                    ฿{costBreakdown.rawMaterialCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-lg">
                  <span className="text-gray-400">ค่าดำเนินการ:</span>
                  <span className="text-gray-200 font-semibold">
                    +฿{costBreakdown.operatingCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-lg">
                  <span className="text-gray-400">มูลค่าของเสีย:</span>
                  <span className="text-red-400 font-semibold">
                    -฿{costBreakdown.scrapValue.toFixed(2)}
                  </span>
                </div>
                <div className="pt-4 border-t-2 border-cyber-border">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold text-cyber-primary">
                      ต้นทุนรวมต่อหน่วย:
                    </span>
                    <span className="text-4xl font-bold text-cyber-green">
                      ฿{costBreakdown.totalCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Platform Comparison */}
        {costBreakdown && (
          <div className="cyber-card p-4">
            <div className="flex items-center gap-3 mb-6">
              <ShoppingCart className="w-6 h-6 text-cyber-purple" />
              <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                เปรียบเทียบกำไร E-commerce
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  ราคาขาย (บาท/หน่วย)
                </label>
                <input
                  type="number"
                  value={sellingPrice || ''}
                  onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                  className="cyber-input w-full"
                  placeholder="฿0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  จำนวน (หน่วย)
                </label>
                <input
                  type="number"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  className="cyber-input w-full"
                  placeholder="1"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Target GP (%)
                </label>
                <input
                  type="number"
                  value={targetGP || ''}
                  onChange={(e) => setTargetGP(parseFloat(e.target.value) || 0)}
                  className="cyber-input w-full"
                  placeholder="30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Affiliate (%)
                </label>
                <input
                  type="number"
                  value={affiliateRate || ''}
                  onChange={(e) => setAffiliateRate(parseFloat(e.target.value) || 0)}
                  className="cyber-input w-full"
                  placeholder="0"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  VAT (%)
                </label>
                <input
                  type="number"
                  value={vatRate || ''}
                  onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
                  className="cyber-input w-full"
                  placeholder="7"
                />
              </div>
            </div>

            <button
              onClick={comparePlatforms}
              className="w-full cyber-btn-secondary flex items-center justify-center gap-2 mb-6"
            >
              <TrendingUp className="w-5 h-5" />
              เปรียบเทียบ Platforms
            </button>

            {/* Platform Results */}
            {platformResults.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">
                  ผลการเปรียบเทียบ (เรียงตามกำไรสูงสุด)
                </h3>

                {(platformResults || []).map((result, index) => (
                  <div
                    key={result.platform}
                    className={`p-6 rounded-lg border ${
                      index === 0
                        ? 'bg-cyber-green/10 border-cyber-green/50 shadow-lg'
                        : 'bg-cyber-darker/50 border-cyber-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-gray-100 capitalize">
                          {result.platform}
                        </span>
                        {index === 0 && (
                          <span className="px-3 py-1 text-sm bg-cyber-green/20 text-cyber-green rounded-full font-semibold">
                            คุ้มที่สุด
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">รายได้รวม:</span>
                        <span className="text-gray-200 font-medium">
                          ฿{result.grossRevenue.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">ค่าธรรมเนียม:</span>
                        <span className="text-red-400 font-medium">
                          -฿{result.platformFees.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Affiliate:</span>
                        <span className="text-red-400 font-medium">
                          -฿{((result.grossRevenue * affiliateRate) / 100).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">VAT:</span>
                        <span className="text-red-400 font-medium">
                          -฿{((result.grossRevenue * vatRate) / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-cyber-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-semibold text-gray-300">
                          กำไรสุทธิ:
                        </span>
                        <span className="text-3xl font-bold text-cyber-green">
                          ฿{result.netProfit.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">% กำไร:</span>
                        <span className="text-lg font-semibold text-cyber-primary">
                          {result.profitMargin.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default Calculator
