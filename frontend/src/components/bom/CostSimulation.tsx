import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Loader2,
  DollarSign,
} from 'lucide-react'
import bomService, { BOM } from '../../services/bom'
import materialsService, { Material } from '../../services/materials'

interface SimulatedCost {
  materialId: string
  materialName: string
  originalCost: number
  simulatedCost: number
  quantity: number
  originalTotal: number
  simulatedTotal: number
  change: number
  changePercent: number
}

function CostSimulation() {
  const [boms, setBoms] = useState<BOM[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedBomId, setSelectedBomId] = useState('')
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({})
  const [simulatedCosts, setSimulatedCosts] = useState<SimulatedCost[]>([])

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
      setBoms(bomsData)
      setMaterials(materialsData)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const selectedBom = boms.find((b) => b.id === selectedBomId)

  // Initialize price changes when BOM is selected
  useEffect(() => {
    if (selectedBom) {
      const initialPrices: Record<string, number> = {}
      selectedBom.materials.forEach((item) => {
        initialPrices[item.materialId!] = Number(item.material?.unitCost)
      })
      setPriceChanges(initialPrices)
    } else {
      setPriceChanges({})
    }
  }, [selectedBomId])

  // Calculate simulated costs
  useEffect(() => {
    if (!selectedBom) {
      setSimulatedCosts([])
      return
    }

    const costs: SimulatedCost[] = (selectedBom.materials || []).map((item) => {
      const originalCost = Number(item.material?.unitCost)
      const simulatedCost = priceChanges[item.materialId!] ?? originalCost
      const quantity = Number(item.quantity)
      const originalTotal = originalCost * quantity
      const simulatedTotal = simulatedCost * quantity
      const change = simulatedTotal - originalTotal
      const changePercent = originalTotal > 0 ? (change / originalTotal) * 100 : 0

      return {
        materialId: item.materialId ?? '',
        materialName: item.material?.name ?? '',
        originalCost,
        simulatedCost,
        quantity,
        originalTotal,
        simulatedTotal,
        change,
        changePercent,
      }
    })

    setSimulatedCosts(costs)
  }, [selectedBom, priceChanges])

  const handlePriceChange = (materialId: string, value: number) => {
    setPriceChanges((prev) => ({
      ...prev,
      [materialId]: value,
    }))
  }

  const resetPrices = () => {
    if (selectedBom) {
      const initialPrices: Record<string, number> = {}
      selectedBom.materials.forEach((item) => {
        initialPrices[item.materialId!] = Number(item.material?.unitCost)
      })
      setPriceChanges(initialPrices)
    }
  }

  const applyPercentageChange = (percent: number) => {
    if (selectedBom) {
      const newPrices: Record<string, number> = {}
      selectedBom.materials.forEach((item) => {
        const original = Number(item.material?.unitCost)
        newPrices[item.materialId!] = Math.round(original * (1 + percent / 100) * 100) / 100
      })
      setPriceChanges(newPrices)
    }
  }

  const originalTotal = simulatedCosts.reduce((sum, c) => sum + c.originalTotal, 0)
  const simulatedTotal = simulatedCosts.reduce((sum, c) => sum + c.simulatedTotal, 0)
  const totalChange = simulatedTotal - originalTotal
  const totalChangePercent = originalTotal > 0 ? (totalChange / originalTotal) * 100 : 0

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
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyber-green to-cyan-500 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Cost Simulation</h2>
            <p className="text-sm text-gray-400">
              Simulate production costs with different material prices
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-gray-400 mb-2">Select BOM</label>
            <select
              value={selectedBomId}
              onChange={(e) => setSelectedBomId(e.target.value)}
              className="cyber-input w-full"
            >
              <option value="">-- Select a BOM --</option>
              {(boms || []).map((bom) => (
                <option key={bom.id} value={bom.id}>
                  {bom.product.name} ({bom.version}) - ฿{bom.totalCost.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          {selectedBomId && (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => applyPercentageChange(-10)}
                  className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm"
                >
                  -10%
                </button>
                <button
                  onClick={() => applyPercentageChange(-5)}
                  className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm"
                >
                  -5%
                </button>
                <button
                  onClick={() => applyPercentageChange(5)}
                  className="px-3 py-2 bg-cyber-green/20 text-cyber-green rounded-lg hover:bg-cyber-green/30 text-sm"
                >
                  +5%
                </button>
                <button
                  onClick={() => applyPercentageChange(10)}
                  className="px-3 py-2 bg-cyber-green/20 text-cyber-green rounded-lg hover:bg-cyber-green/30 text-sm"
                >
                  +10%
                </button>
              </div>
              <button
                onClick={resetPrices}
                className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:text-gray-300 flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {selectedBom && simulatedCosts.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="cyber-card p-4"
            >
              <p className="text-sm text-gray-400 mb-1">Original Cost</p>
              <p className="text-2xl font-bold text-gray-300">
                ฿{originalTotal.toLocaleString()}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="cyber-card p-4"
            >
              <p className="text-sm text-gray-400 mb-1">Simulated Cost</p>
              <p className="text-2xl font-bold text-cyber-primary">
                ฿{simulatedTotal.toLocaleString()}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`cyber-card p-4 ${
                totalChange > 0
                  ? 'border-red-500/50'
                  : totalChange < 0
                  ? 'border-cyber-green/50'
                  : ''
              }`}
            >
              <p className="text-sm text-gray-400 mb-1">Difference</p>
              <div className="flex items-center gap-2">
                {totalChange > 0 ? (
                  <TrendingUp className="w-6 h-6 text-red-400" />
                ) : totalChange < 0 ? (
                  <TrendingDown className="w-6 h-6 text-cyber-green" />
                ) : (
                  <Minus className="w-6 h-6 text-gray-400" />
                )}
                <span
                  className={`text-2xl font-bold ${
                    totalChange > 0
                      ? 'text-red-400'
                      : totalChange < 0
                      ? 'text-cyber-green'
                      : 'text-gray-400'
                  }`}
                >
                  {totalChange > 0 ? '+' : ''}฿{totalChange.toLocaleString()}
                </span>
                <span
                  className={`text-sm ${
                    totalChange > 0
                      ? 'text-red-400'
                      : totalChange < 0
                      ? 'text-cyber-green'
                      : 'text-gray-400'
                  }`}
                >
                  ({totalChangePercent > 0 ? '+' : ''}
                  {totalChangePercent.toFixed(1)}%)
                </span>
              </div>
            </motion.div>
          </div>

          {/* Materials Table with Price Adjustments */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="cyber-card overflow-hidden"
          >
            <div className="p-4 border-b border-cyber-border">
              <h3 className="text-lg font-semibold text-gray-100">
                Adjust Material Prices
              </h3>
            </div>
            <table className="cyber-table w-full">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Quantity</th>
                  <th>Original Price</th>
                  <th>Simulated Price</th>
                  <th>Original Total</th>
                  <th>Simulated Total</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {(simulatedCosts || []).map((cost) => (
                  <tr key={cost.materialId}>
                    <td className="text-gray-200">{cost.materialName}</td>
                    <td className="text-gray-400">{cost.quantity}</td>
                    <td className="text-gray-400">฿{cost.originalCost.toLocaleString()}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-gray-500" />
                        <input
                          type="number"
                          value={priceChanges[cost.materialId] ?? cost.originalCost}
                          onChange={(e) =>
                            handlePriceChange(
                              cost.materialId,
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="cyber-input w-24 text-sm py-1"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </td>
                    <td className="text-gray-400">฿{cost.originalTotal.toLocaleString()}</td>
                    <td className="text-cyber-primary font-semibold">
                      ฿{cost.simulatedTotal.toLocaleString()}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {cost.change > 0 ? (
                          <TrendingUp className="w-4 h-4 text-red-400" />
                        ) : cost.change < 0 ? (
                          <TrendingDown className="w-4 h-4 text-cyber-green" />
                        ) : (
                          <Minus className="w-4 h-4 text-gray-500" />
                        )}
                        <span
                          className={
                            cost.change > 0
                              ? 'text-red-400'
                              : cost.change < 0
                              ? 'text-cyber-green'
                              : 'text-gray-500'
                          }
                        >
                          {cost.change > 0 ? '+' : ''}
                          {cost.changePercent.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          {/* Impact Analysis */}
          {Math.abs(totalChangePercent) > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`cyber-card p-6 ${
                totalChange > 0 ? 'border-red-500/30' : 'border-cyber-green/30'
              }`}
            >
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Impact Analysis</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-gray-400 mb-2">Per Unit Impact</p>
                  <p
                    className={`text-3xl font-bold ${
                      totalChange > 0 ? 'text-red-400' : 'text-cyber-green'
                    }`}
                  >
                    {totalChange > 0 ? '+' : ''}฿{totalChange.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 mb-2">For 100 Units</p>
                  <p
                    className={`text-3xl font-bold ${
                      totalChange > 0 ? 'text-red-400' : 'text-cyber-green'
                    }`}
                  >
                    {totalChange > 0 ? '+' : ''}฿{(totalChange * 100).toLocaleString()}
                  </p>
                </div>
              </div>
              <p className="text-gray-500 mt-4 text-sm">
                {totalChange > 0
                  ? `⚠️ Material price increases will raise production costs by ${totalChangePercent.toFixed(
                      1
                    )}%`
                  : `✅ Material price decreases will reduce production costs by ${Math.abs(
                      totalChangePercent
                    ).toFixed(1)}%`}
              </p>
            </motion.div>
          )}
        </>
      )}

      {/* Empty State */}
      {!selectedBomId && (
        <div className="cyber-card p-12 text-center">
          <TrendingUp className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            Select a BOM to Simulate
          </h3>
          <p className="text-gray-500">
            Choose a Bill of Materials to simulate cost changes based on material price
            adjustments
          </p>
        </div>
      )}
    </div>
  )
}

export default CostSimulation
