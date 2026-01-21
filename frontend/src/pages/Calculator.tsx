import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator as CalcIcon,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Package,
  Plus,
  X,
} from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'

interface Material {
  id: string
  name: string
  quantity: number
  unit: string
  unitCost: number
}

interface PlatformResult {
  platform: string
  grossRevenue: number
  platformFees: number
  netProfit: number
  profitMargin: number
}

function Calculator() {
  // Production Cost State
  const [materials, setMaterials] = useState<Material[]>([
    { id: '1', name: '', quantity: 0, unit: '', unitCost: 0 },
  ])
  const [operatingCost, setOperatingCost] = useState(0)
  const [scrapValue, setScrapValue] = useState(0)
  const [productionCostResult, setProductionCostResult] = useState<any>(null)

  // Platform Comparison State
  const [sellingPrice, setSellingPrice] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [platformResults, setPlatformResults] = useState<PlatformResult[]>([])

  // Add Material
  const addMaterial = () => {
    setMaterials([
      ...materials,
      {
        id: Date.now().toString(),
        name: '',
        quantity: 0,
        unit: '',
        unitCost: 0,
      },
    ])
  }

  // Remove Material
  const removeMaterial = (id: string) => {
    setMaterials(materials.filter((m) => m.id !== id))
  }

  // Update Material
  const updateMaterial = (id: string, field: keyof Material, value: any) => {
    setMaterials(
      materials.map((m) =>
        m.id === id ? { ...m, [field]: value } : m
      )
    )
  }

  // คำนวณต้นทุนการผลิต
  const calculateProductionCost = async () => {
    try {
      const response = await axios.post('/api/calculator/production-cost', {
        materials,
        operatingCost,
        scrapValue,
      })

      setProductionCostResult(response.data.data)
      toast.success('คำนวณต้นทุนการผลิตสำเร็จ!')
    } catch (error) {
      console.error('Error:', error)
      toast.error('เกิดข้อผิดพลาดในการคำนวณ')
    }
  }

  // เปรียบเทียบกำไรระหว่าง Platforms
  const comparePlatforms = async () => {
    if (!productionCostResult) {
      toast.error('กรุณาคำนวณต้นทุนการผลิตก่อน')
      return
    }

    try {
      const response = await axios.post('/api/calculator/compare-platforms', {
        sellingPrice,
        quantity,
        productionCost: productionCostResult.totalCost,
        platforms: ['lazada', 'shopee', 'tiktok'],
      })

      const data = response.data.data
      const results = Object.keys(data).map((platform) => ({
        platform,
        ...data[platform],
      }))

      setPlatformResults(results)
      toast.success('เปรียบเทียบ Platform สำเร็จ!')
    } catch (error) {
      console.error('Error:', error)
      toast.error('เกิดข้อผิดพลาดในการเปรียบเทียบ')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
          <span className="neon-text">Cost Calculator</span>
        </h1>
        <p className="text-gray-400">
          คำนวณต้นทุนการผลิตและกำไรจากการขายผ่าน E-commerce
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Production Cost Calculator */}
        <div className="cyber-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <Package className="w-6 h-6 text-cyber-primary" />
            <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
              คำนวณต้นทุนการผลิต
            </h2>
          </div>

          {/* Materials List */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-300">
                รายการวัตถุดิบ
              </label>
              <button
                onClick={addMaterial}
                className="flex items-center gap-2 px-3 py-1 text-xs bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50 rounded-lg hover:bg-cyber-primary/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
                เพิ่มวัตถุดิบ
              </button>
            </div>

            {materials.map((material, index) => (
              <div
                key={material.id}
                className="grid grid-cols-12 gap-2 items-end"
              >
                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="ชื่อ"
                    value={material.name}
                    onChange={(e) =>
                      updateMaterial(material.id, 'name', e.target.value)
                    }
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    placeholder="จำนวน"
                    value={material.quantity || ''}
                    onChange={(e) =>
                      updateMaterial(
                        material.id,
                        'quantity',
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    placeholder="หน่วย"
                    value={material.unit}
                    onChange={(e) =>
                      updateMaterial(material.id, 'unit', e.target.value)
                    }
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    placeholder="ราคา/หน่วย"
                    value={material.unitCost || ''}
                    onChange={(e) =>
                      updateMaterial(
                        material.id,
                        'unitCost',
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div className="col-span-2 flex items-center">
                  <div className="text-sm text-gray-400">
                    ฿{(material.quantity * material.unitCost).toFixed(2)}
                  </div>
                  {materials.length > 1 && (
                    <button
                      onClick={() => removeMaterial(material.id)}
                      className="ml-2 p-1 text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Operating Cost & Scrap Value */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ค่าดำเนินการ (แรง/ไฟ)
              </label>
              <input
                type="number"
                value={operatingCost || ''}
                onChange={(e) => setOperatingCost(parseFloat(e.target.value) || 0)}
                className="cyber-input w-full"
                placeholder="฿0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                มูลค่าของเสีย
              </label>
              <input
                type="number"
                value={scrapValue || ''}
                onChange={(e) => setScrapValue(parseFloat(e.target.value) || 0)}
                className="cyber-input w-full"
                placeholder="฿0"
              />
            </div>
          </div>

          {/* Calculate Button */}
          <button
            onClick={calculateProductionCost}
            className="w-full cyber-btn-primary flex items-center justify-center gap-2"
          >
            <CalcIcon className="w-5 h-5" />
            คำนวณต้นทุน
          </button>

          {/* Result */}
          {productionCostResult && (
            <div className="mt-6 p-4 bg-cyber-darker/50 rounded-lg border border-cyber-border">
              <h3 className="text-sm font-semibold text-cyber-primary mb-3">
                ผลการคำนวณ
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">ต้นทุนวัตถุดิบ:</span>
                  <span className="text-gray-200 font-semibold">
                    ฿{productionCostResult.rawMaterialCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ค่าดำเนินการ:</span>
                  <span className="text-gray-200 font-semibold">
                    ฿{productionCostResult.operatingCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">มูลค่าของเสีย:</span>
                  <span className="text-red-400 font-semibold">
                    -฿{productionCostResult.scrapValue.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-cyber-border">
                  <span className="text-cyber-primary font-bold">ต้นทุนรวม:</span>
                  <span className="text-cyber-green font-bold text-lg">
                    ฿{productionCostResult.totalCost.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Platform Profit Comparison */}
        <div className="cyber-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <ShoppingCart className="w-6 h-6 text-cyber-purple" />
            <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
              เปรียบเทียบกำไร E-commerce
            </h2>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ราคาขาย (บาท)
              </label>
              <input
                type="number"
                value={sellingPrice || ''}
                onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                className="cyber-input w-full"
                placeholder="฿0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                จำนวน (ชิ้น)
              </label>
              <input
                type="number"
                value={quantity || ''}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="cyber-input w-full"
                placeholder="1"
              />
            </div>
          </div>

          <button
            onClick={comparePlatforms}
            disabled={!productionCostResult}
            className="w-full cyber-btn-secondary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TrendingUp className="w-5 h-5" />
            เปรียบเทียบ Platform
          </button>

          {/* Platform Results */}
          {platformResults.length > 0 && (
            <div className="mt-6 space-y-3">
              {platformResults
                .sort((a, b) => b.netProfit - a.netProfit)
                .map((result, index) => (
                  <div
                    key={result.platform}
                    className={`p-4 rounded-lg border ${
                      index === 0
                        ? 'bg-cyber-green/10 border-cyber-green/50'
                        : 'bg-cyber-darker/50 border-cyber-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-gray-100 capitalize">
                          {result.platform}
                        </span>
                        {index === 0 && (
                          <span className="px-2 py-1 text-xs bg-cyber-green/20 text-cyber-green rounded-full">
                            แนะนำ
                          </span>
                        )}
                      </div>
                      <span className="text-xl font-bold text-cyber-green">
                        ฿{result.netProfit.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-400">รายได้รวม:</span>
                        <span className="ml-1 text-gray-200">
                          ฿{result.grossRevenue.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">ค่าธรรมเนียม:</span>
                        <span className="ml-1 text-red-400">
                          ฿{result.platformFees.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">% กำไร:</span>
                        <span className="ml-1 text-cyber-primary font-semibold">
                          {result.profitMargin.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default Calculator
