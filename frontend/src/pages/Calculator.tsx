import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator as CalcIcon,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Package,
  Plus,
  X,
  Save,
  FolderOpen,
  Trash2,
  Download,
} from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'

interface Material {
  id?: string
  name: string
  quantity: number
  unit?: string
  unitCost?: number
  unitPrice?: number
}

interface PlatformResult {
  platform: string
  grossRevenue: number
  platformFees: number
  netProfit: number
  profitMargin: number
}

interface SavedBOM {
  id: string
  name: string
  description: string
  materials: Material[]
  operatingCost: number
  scrapValue: number
  totalCost: number
  createdAt: Date
  updatedAt: Date
}

function Calculator() {
  // Production Cost State
  const [materials, setMaterials] = useState<Material[]>([
    { id: '1', name: '', quantity: 0, unit: '', unitCost: 0 },
  ])
  const [operatingCost, setOperatingCost] = useState(0)
  const [scrapValue, setScrapValue] = useState(0)
  const [productionCostResult, setProductionCostResult] = useState<any>(null)

  // Save BOM State
  const [bomName, setBomName] = useState('')
  const [bomDescription, setBomDescription] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [savedBOMs, setSavedBOMs] = useState<SavedBOM[]>([])

  // Platform Comparison State
  const [sellingPrice, setSellingPrice] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [platformResults, setPlatformResults] = useState<PlatformResult[]>([])

  // Fetch saved BOMs on component mount
  useEffect(() => {
    fetchSavedBOMs()
  }, [])

  // Fetch Saved BOMs
  const fetchSavedBOMs = async () => {
    try {
      const response = await axios.get('/api/calculator/saved-boms')
      setSavedBOMs(response.data.data)
    } catch (error) {
      console.error('Error fetching saved BOMs:', error)
    }
  }

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
  const updateMaterial = (id: string | undefined, field: string, value: any) => {
    setMaterials(
      materials.map((m) =>
        m.id === id ? { ...m, [field]: value } : m
      )
    )
  }

  // คำนวณต้นทุนการผลิต
  const calculateProductionCost = async () => {
    try {
      const materialsData = materials.map(m => ({
        name: m.name,
        quantity: m.quantity,
        unit: m.unit,
        unitPrice: m.unitCost || m.unitPrice || 0
      }))

      const response = await axios.post('/api/calculator/production-cost', {
        materials: materialsData,
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

  // บันทึก BOM
  const saveBOM = async () => {
    if (!bomName.trim()) {
      toast.error('กรุณาใส่ชื่อ BOM')
      return
    }

    if (materials.every(m => !m.name)) {
      toast.error('กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ')
      return
    }

    try {
      const materialsData = materials
        .filter(m => m.name)
        .map(m => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          unitPrice: m.unitCost || m.unitPrice || 0
        }))

      const response = await axios.post('/api/calculator/saved-boms', {
        name: bomName,
        description: bomDescription,
        materials: materialsData,
        operatingCost,
        scrapValue,
      })

      toast.success('บันทึก BOM สำเร็จ!')
      setShowSaveModal(false)
      setBomName('')
      setBomDescription('')
      fetchSavedBOMs()
    } catch (error) {
      console.error('Error:', error)
      toast.error('เกิดข้อผิดพลาดในการบันทึก')
    }
  }

  // โหลด BOM
  const loadBOM = (bom: SavedBOM) => {
    const loadedMaterials = bom.materials.map((m, index) => ({
      id: String(index + 1),
      name: m.name,
      quantity: m.quantity,
      unit: m.unit || '',
      unitCost: m.unitPrice || m.unitCost || 0,
    }))

    setMaterials(loadedMaterials)
    setOperatingCost(bom.operatingCost)
    setScrapValue(bom.scrapValue)
    setBomName(bom.name)
    setBomDescription(bom.description)

    toast.success(`โหลด BOM "${bom.name}" สำเร็จ!`)
  }

  // ลบ BOM
  const deleteBOM = async (id: string) => {
    if (!confirm('คุณต้องการลบ BOM นี้หรือไม่?')) {
      return
    }

    try {
      await axios.delete(`/api/calculator/saved-boms/${id}`)
      toast.success('ลบ BOM สำเร็จ!')
      fetchSavedBOMs()
    } catch (error) {
      console.error('Error:', error)
      toast.error('เกิดข้อผิดพลาดในการลบ')
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
        platforms: ['lazada', 'shopee', 'tiktok', 'facebook', 'line'],
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Saved BOMs List */}
        <div className="cyber-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <FolderOpen className="w-6 h-6 text-cyber-green" />
            <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
              BOM ที่บันทึกไว้
            </h2>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto cyber-scrollbar">
            {savedBOMs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                ยังไม่มี BOM ที่บันทึกไว้
              </p>
            ) : (
              savedBOMs.map((bom) => (
                <div
                  key={bom.id}
                  className="p-3 bg-cyber-darker/50 rounded-lg border border-cyber-border hover:border-cyber-primary/50 transition-colors group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-100 text-sm">
                        {bom.name}
                      </h3>
                      {bom.description && (
                        <p className="text-xs text-gray-400 mt-1">
                          {bom.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteBOM(bom.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-cyber-green font-semibold">
                      ฿{bom.totalCost.toFixed(2)}
                    </span>
                    <button
                      onClick={() => loadBOM(bom)}
                      className="px-2 py-1 text-xs bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50 rounded hover:bg-cyber-primary/30 transition-colors flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      โหลด
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Production Cost Calculator */}
        <div className="cyber-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <Package className="w-6 h-6 text-cyber-primary" />
            <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
              คำนวณต้นทุนการผลิต
            </h2>
          </div>

          {/* BOM Name (when loaded) */}
          {bomName && (
            <div className="mb-4 p-3 bg-cyber-primary/10 rounded-lg border border-cyber-primary/30">
              <p className="text-xs text-gray-400">กำลังแก้ไข:</p>
              <p className="text-sm font-semibold text-cyber-primary">{bomName}</p>
            </div>
          )}

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

            {materials.map((material) => (
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
                    ฿{((material.quantity || 0) * (material.unitCost || 0)).toFixed(2)}
                  </div>
                  {materials.length > 1 && (
                    <button
                      onClick={() => removeMaterial(material.id!)}
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

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={calculateProductionCost}
              className="cyber-btn-primary flex items-center justify-center gap-2"
            >
              <CalcIcon className="w-5 h-5" />
              คำนวณ
            </button>
            <button
              onClick={() => setShowSaveModal(true)}
              className="cyber-btn-secondary flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              บันทึก
            </button>
          </div>

          {/* Result */}
          {productionCostResult && (
            <div className="p-4 bg-cyber-darker/50 rounded-lg border border-cyber-border">
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
            <div className="mt-6 space-y-3 max-h-[500px] overflow-y-auto cyber-scrollbar">
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

      {/* Save BOM Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-gradient-card border border-cyber-border rounded-xl p-6 max-w-md w-full"
          >
            <h3 className="text-xl font-bold text-gray-100 mb-4 font-['Orbitron']">
              บันทึก BOM
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  ชื่อ BOM *
                </label>
                <input
                  type="text"
                  value={bomName}
                  onChange={(e) => setBomName(e.target.value)}
                  className="cyber-input w-full"
                  placeholder="เช่น King Size Mattress"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  คำอธิบาย (ไม่บังคับ)
                </label>
                <textarea
                  value={bomDescription}
                  onChange={(e) => setBomDescription(e.target.value)}
                  className="cyber-input w-full"
                  placeholder="คำอธิบายเพิ่มเติม..."
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowSaveModal(false)
                    setBomName('')
                    setBomDescription('')
                  }}
                  className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={saveBOM}
                  className="flex-1 cyber-btn-primary"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}

export default Calculator
