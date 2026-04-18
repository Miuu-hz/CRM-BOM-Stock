import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Calculator,
  Package,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Loader2,
  Ban,
} from 'lucide-react'
import bomService, { BOM } from '../../services/bom'
import materialsService, { Material } from '../../services/materials'

interface MaterialRequirement {
  materialId: string
  materialName: string
  materialCode: string
  requiredQuantity: number
  availableStock: number
  unit: string
  unitCost: number
  totalCost: number
  status: 'OK' | 'LOW' | 'INSUFFICIENT' | 'OUT_OF_STOCK'
  shortage: number
}

function ProductionCalculator() {
  const [boms, setBoms] = useState<BOM[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedBomId, setSelectedBomId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [requirements, setRequirements] = useState<MaterialRequirement[]>([])
  const [totalCost, setTotalCost] = useState(0)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [bomsData, materialsData] = await Promise.all([
        bomService.getAll(),
        materialsService.getAll(),
      ])
      setBoms((bomsData || []).filter((b) => b.status === 'ACTIVE'))
      setMaterials(materialsData)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const calculateRequirements = () => {
    if (!selectedBomId || quantity <= 0) {
      setRequirements([])
      setTotalCost(0)
      return
    }

    const selectedBom = boms.find((b) => b.id === selectedBomId)
    if (!selectedBom) return

    const reqs: MaterialRequirement[] = (selectedBom.materials || []).map((bomItem) => {
      const material = materials.find((m) => m.id === bomItem.materialId)
      const requiredQty = Number(bomItem.quantity) * quantity
      const availableStock = material?.currentStock || 0
      const shortage = Math.max(0, requiredQty - availableStock)
      const unitCost = material ? Number(material.unitCost) : 0

      let status: 'OK' | 'LOW' | 'INSUFFICIENT' | 'OUT_OF_STOCK' = 'OK'
      if (availableStock === 0) {
        status = 'OUT_OF_STOCK'
      } else if (availableStock < requiredQty) {
        status = 'INSUFFICIENT'
      } else if (availableStock < requiredQty * 1.2) {
        status = 'LOW'
      }

      return {
        materialId: bomItem.materialId ?? '',
        materialName: bomItem.material?.name ?? '',
        materialCode: bomItem.material?.code ?? '',
        requiredQuantity: requiredQty,
        availableStock,
        unit: bomItem.unit ?? '',
        unitCost,
        totalCost: requiredQty * unitCost,
        status,
        shortage,
      }
    })

    setRequirements(reqs)
    setTotalCost(reqs.reduce((sum, r) => sum + r.totalCost, 0))
  }

  useEffect(() => {
    calculateRequirements()
  }, [selectedBomId, quantity, boms, materials])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'OK':
        return <CheckCircle className="w-5 h-5 text-cyber-green" />
      case 'LOW':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />
      case 'INSUFFICIENT':
        return <AlertCircle className="w-5 h-5 text-red-400" />
      case 'OUT_OF_STOCK':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return null
    }
  }

  const hasZeroStock = requirements.some((r) => r.availableStock === 0)
  const canProduce = requirements.length > 0 && requirements.every((r) => r.status !== 'INSUFFICIENT') && !hasZeroStock

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="cyber-card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center">
            <Calculator className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Production Calculator</h2>
            <p className="text-sm text-gray-400">
              Calculate material requirements for production
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Select BOM</label>
            <select
              value={selectedBomId}
              onChange={(e) => setSelectedBomId(e.target.value)}
              className="cyber-input w-full"
            >
              <option value="">-- Select a BOM --</option>
              {(boms || []).map((bom) => (
                <option key={bom.id} value={bom.id}>
                  {bom.product.name} ({bom.version})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Production Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              min="1"
              className="cyber-input w-full"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      {selectedBomId && requirements.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="cyber-card p-4"
            >
              <p className="text-sm text-gray-400 mb-1">Total Materials</p>
              <p className="text-2xl font-bold text-cyber-primary">{requirements.length}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="cyber-card p-4"
            >
              <p className="text-sm text-gray-400 mb-1">Total Cost</p>
              <p className="text-2xl font-bold text-cyber-green">
                ฿{totalCost.toLocaleString()}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`cyber-card p-4 ${
                canProduce ? 'border-cyber-green/50' : hasZeroStock ? 'border-red-600/70' : 'border-red-500/50'
              }`}
            >
              <p className="text-sm text-gray-400 mb-1">Production Status</p>
              <div className="flex items-center gap-2">
                {canProduce ? (
                  <>
                    <CheckCircle className="w-6 h-6 text-cyber-green" />
                    <span className="text-xl font-bold text-cyber-green">Ready</span>
                  </>
                ) : hasZeroStock ? (
                  <>
                    <Ban className="w-6 h-6 text-red-500" />
                    <span className="text-xl font-bold text-red-500">Blocked</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-6 h-6 text-red-400" />
                    <span className="text-xl font-bold text-red-400">Insufficient</span>
                  </>
                )}
              </div>
            </motion.div>
          </div>

          {/* Materials Table */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="cyber-card overflow-hidden"
          >
            <div className="p-4 border-b border-cyber-border">
              <h3 className="text-lg font-semibold text-gray-100">Material Requirements</h3>
            </div>
            <div className="overflow-x-auto">
            <table className="cyber-table w-full">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Material</th>
                  <th>Code</th>
                  <th>Required</th>
                  <th>Available</th>
                  <th>Shortage</th>
                  <th>Unit Cost</th>
                  <th>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {(requirements || []).map((req) => (
                  <tr
                    key={req.materialId}
                    className={req.status === 'OUT_OF_STOCK' ? 'bg-red-600/20' : req.status === 'INSUFFICIENT' ? 'bg-red-500/10' : ''}
                  >
                    <td>{getStatusIcon(req.status)}</td>
                    <td className="text-gray-200">{req.materialName}</td>
                    <td className="text-gray-400 font-mono">{req.materialCode}</td>
                    <td className="text-gray-300">
                      {req.requiredQuantity.toLocaleString()} {req.unit}
                    </td>
                    <td
                      className={
                        req.status === 'OUT_OF_STOCK'
                          ? 'text-red-500'
                          : req.status === 'INSUFFICIENT'
                          ? 'text-red-400'
                          : req.status === 'LOW'
                          ? 'text-yellow-400'
                          : 'text-cyber-green'
                      }
                    >
                      {req.availableStock === 0 ? (
                        <span className="flex items-center gap-1">
                          <Ban className="w-4 h-4" />
                          OUT OF STOCK
                        </span>
                      ) : (
                        `${req.availableStock.toLocaleString()} ${req.unit}`
                      )}
                    </td>
                    <td className={req.shortage > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}>
                      {req.shortage > 0 ? `-${req.shortage.toLocaleString()}` : '-'}
                    </td>
                    <td className="text-gray-400">฿{req.unitCost.toLocaleString()}</td>
                    <td className="text-cyber-green font-semibold">
                      ฿{req.totalCost.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-cyber-border">
                  <td colSpan={7} className="text-right text-gray-400 font-semibold">
                    Total Production Cost:
                  </td>
                  <td className="text-2xl font-bold text-cyber-primary">
                    ฿{totalCost.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </motion.div>

          {/* Zero Stock Warning */}
          {hasZeroStock && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="cyber-card p-6 border-red-600/70 bg-red-500/5"
            >
              <div className="flex items-start gap-4">
                <Ban className="w-8 h-8 text-red-500 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold text-red-500 mb-2">
                    Production Blocked - Zero Stock
                  </h3>
                  <p className="text-gray-400 mb-4">
                    Production cannot proceed because the following materials have zero stock:
                  </p>
                  <ul className="space-y-2">
                    {requirements
                      .filter((r) => r.availableStock === 0)
                      .map((r) => (
                        <li key={r.materialId} className="flex items-center gap-2 text-gray-300">
                          <Ban className="w-4 h-4 text-red-500" />
                          <span>
                            {r.materialName}{' '}
                            <span className="text-red-500 font-semibold">
                              (0 {r.unit} available)
                            </span>
                          </span>
                        </li>
                      ))}
                  </ul>
                  <p className="text-red-400/80 text-sm mt-4">
                    Please restock these materials before attempting production.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Shortages Warning */}
          {!canProduce && !hasZeroStock && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="cyber-card p-6 border-red-500/50"
            >
              <div className="flex items-start gap-4">
                <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold text-red-400 mb-2">
                    Insufficient Materials
                  </h3>
                  <p className="text-gray-400 mb-4">
                    The following materials need to be restocked before production:
                  </p>
                  <ul className="space-y-2">
                    {requirements
                      .filter((r) => r.status === 'INSUFFICIENT')
                      .map((r) => (
                        <li key={r.materialId} className="flex items-center gap-2 text-gray-300">
                          <Package className="w-4 h-4 text-red-400" />
                          <span>
                            {r.materialName}: Need{' '}
                            <span className="text-red-400 font-semibold">
                              {r.shortage.toLocaleString()} {r.unit}
                            </span>{' '}
                            more
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Empty State */}
      {!selectedBomId && (
        <div className="cyber-card p-12 text-center">
          <Calculator className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            Select a BOM to Calculate
          </h3>
          <p className="text-gray-500">
            Choose a Bill of Materials and enter the production quantity to see material
            requirements
          </p>
        </div>
      )}
    </div>
  )
}

export default ProductionCalculator
