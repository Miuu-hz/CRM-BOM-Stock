import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator as CalcIcon,
  Package,
  DollarSign,
  TrendingUp,
  ChevronDown,
  Save,
  RefreshCw,
  ShoppingCart,
} from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'

interface Product {
  id: string
  code: string
  name: string
  category: string
}

interface Material {
  id: string
  code: string
  name: string
  unit: string
  unitCost: number
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

interface PlatformResult {
  platform: string
  grossRevenue: number
  platformFees: number
  netProfit: number
  profitMargin: number
  productionCost: number
  totalCosts: number
}

function Calculator() {
  // Data from database
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [boms, setBOMs] = useState<BOM[]>([])

  // Selected data
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null)

  // Cost calculation
  const [operatingCost, setOperatingCost] = useState<number>(0)
  const [scrapValue, setScrapValue] = useState<number>(0)
  const [productionCost, setProductionCost] = useState<number>(0)
  const [costBreakdown, setCostBreakdown] = useState<any>(null)

  // Platform comparison
  const [sellingPrice, setSellingPrice] = useState<number>(0)
  const [quantity, setQuantity] = useState<number>(1)
  const [platformResults, setPlatformResults] = useState<PlatformResult[]>([])

  // UI states
  const [loading, setLoading] = useState(false)

  // Fetch initial data
  useEffect(() => {
    fetchInitialData()
  }, [])

  const fetchInitialData = async () => {
    try {
      setLoading(true)
      const [productsRes, materialsRes, bomsRes] = await Promise.all([
        axios.get('/api/data/products'),
        axios.get('/api/data/materials'),
        axios.get('/api/data/boms'),
      ])

      setProducts(productsRes.data.data)
      setMaterials(materialsRes.data.data)
      setBOMs(bomsRes.data.data)
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('ไม่สามารถโหลดข้อมูลได้')
    } finally {
      setLoading(false)
    }
  }

  // Handle product selection
  const handleProductChange = async (productId: string) => {
    setSelectedProduct(productId)

    if (!productId) {
      setSelectedBOM(null)
      setCostBreakdown(null)
      setProductionCost(0)
      return
    }

    try {
      // Find BOM for this product
      const bom = boms.find(b => b.productId === productId && b.status === 'ACTIVE')

      if (bom) {
        setSelectedBOM(bom)
        toast.success(`โหลด BOM สำหรับ ${bom.productName} สำเร็จ`)
      } else {
        setSelectedBOM(null)
        toast.error('ไม่พบ BOM สำหรับสินค้านี้')
      }
    } catch (error) {
      console.error('Error loading BOM:', error)
      toast.error('เกิดข้อผิดพลาดในการโหลด BOM')
    }
  }

  // Calculate production cost
  const calculateCost = async () => {
    if (!selectedBOM) {
      toast.error('กรุณาเลือกสินค้าก่อน')
      return
    }

    try {
      // Prepare materials data
      const materialsData = selectedBOM.materials.map(m => ({
        name: m.materialName || '',
        quantity: m.quantity,
        unit: m.unit,
        unitPrice: m.unitCost || 0,
      }))

      const response = await axios.post('/api/calculator/production-cost', {
        materials: materialsData,
        operatingCost,
        scrapValue,
      })

      const result = response.data.data
      setCostBreakdown(result)
      setProductionCost(result.totalCost)
      toast.success('คำนวณต้นทุนสำเร็จ!')
    } catch (error) {
      console.error('Error calculating cost:', error)
      toast.error('เกิดข้อผิดพลาดในการคำนวณ')
    }
  }

  // Compare platforms
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
      const response = await axios.post('/api/calculator/compare-platforms', {
        sellingPrice,
        quantity,
        productionCost: costBreakdown.totalCost,
        platforms: ['lazada', 'shopee', 'tiktok', 'facebook', 'line'],
      })

      const data = response.data.data
      const results: PlatformResult[] = Object.keys(data).map((platform) => ({
        platform,
        ...data[platform],
      }))

      setPlatformResults(results.sort((a, b) => b.netProfit - a.netProfit))
      toast.success('เปรียบเทียบ Platform สำเร็จ!')
    } catch (error) {
      console.error('Error comparing platforms:', error)
      toast.error('เกิดข้อผิดพลาดในการเปรียบเทียบ')
    }
  }

  // Reset form
  const resetForm = () => {
    setSelectedProduct('')
    setSelectedBOM(null)
    setOperatingCost(0)
    setScrapValue(0)
    setProductionCost(0)
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Cost Calculation */}
        <div className="space-y-6">
          {/* Product Selection */}
          <div className="cyber-card p-6">
            <div className="flex items-center gap-3 mb-6">
              <Package className="w-6 h-6 text-cyber-primary" />
              <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                เลือกสินค้า
              </h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                สินค้า *
              </label>
              <div className="relative">
                <select
                  value={selectedProduct}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="w-full cyber-input appearance-none pr-10"
                  disabled={loading}
                >
                  <option value="">-- เลือกสินค้า --</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.code} - {product.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              </div>

              {selectedBOM && (
                <div className="mt-4 p-4 bg-cyber-primary/10 rounded-lg border border-cyber-primary/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">
                      BOM Version:
                    </span>
                    <span className="text-sm font-semibold text-cyber-primary">
                      {selectedBOM.version}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-300">
                      จำนวนวัตถุดิบ:
                    </span>
                    <span className="text-sm font-semibold text-cyber-green">
                      {selectedBOM.materials.length} รายการ
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Materials List */}
          {selectedBOM && (
            <div className="cyber-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <Package className="w-6 h-6 text-cyber-green" />
                <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                  รายการวัตถุดิบ
                </h2>
              </div>

              <div className="space-y-3">
                {selectedBOM.materials.map((material, index) => (
                  <div
                    key={index}
                    className="p-4 bg-cyber-darker/50 rounded-lg border border-cyber-border"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-100">
                          {material.materialName}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">
                          {material.materialCode}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-cyber-green">
                          ฿{((material.unitCost || 0) * material.quantity).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-400">จำนวน:</span>
                        <p className="text-gray-200 font-medium">
                          {material.quantity} {material.unit}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-400">ราคา/หน่วย:</span>
                        <p className="text-gray-200 font-medium">
                          ฿{(material.unitCost || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-400">รวม:</span>
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

          {/* Additional Costs */}
          {selectedBOM && (
            <div className="cyber-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <DollarSign className="w-6 h-6 text-cyber-purple" />
                <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                  ค่าใช้จ่ายเพิ่มเติม
                </h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    ค่าดำเนินการ (แรงงาน, ไฟฟ้า, etc.)
                  </label>
                  <input
                    type="number"
                    value={operatingCost || ''}
                    onChange={(e) => setOperatingCost(parseFloat(e.target.value) || 0)}
                    className="cyber-input w-full"
                    placeholder="฿0.00"
                  />
                </div>

                <div>
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
                  className="w-full cyber-btn-primary flex items-center justify-center gap-2"
                >
                  <CalcIcon className="w-5 h-5" />
                  คำนวณต้นทุนการผลิต
                </button>
              </div>
            </div>
          )}

          {/* Cost Result */}
          {costBreakdown && (
            <div className="cyber-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <TrendingUp className="w-6 h-6 text-cyber-green" />
                <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                  ผลการคำนวณ
                </h2>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-cyber-darker/50 rounded-lg border border-cyber-border">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">ต้นทุนวัตถุดิบ:</span>
                      <span className="text-gray-200 font-semibold">
                        ฿{costBreakdown.rawMaterialCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">ค่าดำเนินการ:</span>
                      <span className="text-gray-200 font-semibold">
                        +฿{costBreakdown.operatingCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">มูลค่าของเสีย:</span>
                      <span className="text-red-400 font-semibold">
                        -฿{costBreakdown.scrapValue.toFixed(2)}
                      </span>
                    </div>
                    <div className="pt-3 border-t border-cyber-border">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-cyber-primary">
                          ต้นทุนรวมต่อหน่วย:
                        </span>
                        <span className="text-2xl font-bold text-cyber-green">
                          ฿{costBreakdown.totalCost.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Platform Comparison */}
        <div className="space-y-6">
          <div className="cyber-card p-6">
            <div className="flex items-center gap-3 mb-6">
              <ShoppingCart className="w-6 h-6 text-cyber-purple" />
              <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
                เปรียบเทียบกำไร E-commerce
              </h2>
            </div>

            {!costBreakdown ? (
              <div className="text-center py-12">
                <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500">
                  กรุณาคำนวณต้นทุนการผลิตก่อน
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Input Section */}
                <div className="space-y-4">
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

                  <button
                    onClick={comparePlatforms}
                    className="w-full cyber-btn-secondary flex items-center justify-center gap-2"
                  >
                    <TrendingUp className="w-5 h-5" />
                    เปรียบเทียบ Platforms
                  </button>
                </div>

                {/* Platform Results */}
                {platformResults.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3">
                      ผลการเปรียบเทียบ (เรียงตามกำไรสูงสุด)
                    </h3>

                    {platformResults.map((result, index) => (
                      <div
                        key={result.platform}
                        className={`p-5 rounded-lg border ${
                          index === 0
                            ? 'bg-cyber-green/10 border-cyber-green/50 shadow-lg'
                            : 'bg-cyber-darker/50 border-cyber-border'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xl font-bold text-gray-100 capitalize">
                              {result.platform}
                            </span>
                            {index === 0 && (
                              <span className="px-3 py-1 text-xs bg-cyber-green/20 text-cyber-green rounded-full font-semibold">
                                คุ้มที่สุด
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">รายได้รวม:</span>
                            <span className="text-gray-200 font-medium">
                              ฿{result.grossRevenue.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">ต้นทุนผลิต:</span>
                            <span className="text-gray-200 font-medium">
                              ฿{result.productionCost.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">ค่าธรรมเนียม:</span>
                            <span className="text-red-400 font-medium">
                              -฿{result.platformFees.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-cyber-border/50">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-300">
                              กำไรสุทธิ:
                            </span>
                            <span className="text-2xl font-bold text-cyber-green">
                              ฿{result.netProfit.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-400">
                              % กำไร:
                            </span>
                            <span className="text-sm font-semibold text-cyber-primary">
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
        </div>
      </div>
    </motion.div>
  )
}

export default Calculator
