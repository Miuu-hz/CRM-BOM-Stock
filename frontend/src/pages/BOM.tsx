import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Plus,
  Search,
  Package,
  Layers,
  DollarSign,
  Edit,
  Copy,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import bomService, { BOM, BOMStats } from '../services/bom'

function BOMPage() {
  const [boms, setBoms] = useState<BOM[]>([])
  const [stats, setStats] = useState<BOMStats | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch BOMs and stats
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [bomsData, statsData] = await Promise.all([
        bomService.getAll(),
        bomService.getStats(),
      ])

      setBoms(bomsData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to fetch BOM data:', err)
      setError('ไม่สามารถโหลดข้อมูล BOM ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Filter BOMs by search term
  const filteredBOMs = boms.filter((bom) =>
    bom.product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bom.product.code.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle delete BOM
  const handleDelete = async (id: string, productName: string) => {
    if (!confirm(`คุณต้องการลบ BOM ของ "${productName}" หรือไม่?`)) {
      return
    }

    try {
      await bomService.delete(id)
      setBoms((prev) => prev.filter((bom) => bom.id !== id))
      // Refresh stats
      const newStats = await bomService.getStats()
      setStats(newStats)
    } catch (err) {
      console.error('Failed to delete BOM:', err)
      alert('ไม่สามารถลบ BOM ได้ กรุณาลองใหม่อีกครั้ง')
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-cyber-primary animate-spin mx-auto mb-4" />
          <p className="text-gray-400">กำลังโหลดข้อมูล BOM...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="cyber-btn-primary flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-5 h-5" />
            ลองใหม่
          </button>
        </div>
      </div>
    )
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
            <span className="neon-text">Bill of Materials</span>
          </h1>
          <p className="text-gray-400">Manage product formulas and materials</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="cyber-btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Create BOM
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Total BOMs"
          value={stats?.totalBOMs.toString() || '0'}
          icon={FileText}
          color="primary"
        />
        <StatCard
          label="Active Formulas"
          value={stats?.activeBOMs.toString() || '0'}
          icon={Layers}
          color="green"
        />
        <StatCard
          label="Total Materials"
          value={stats?.totalMaterials.toString() || '0'}
          icon={Package}
          color="purple"
        />
        <StatCard
          label="Avg. Cost/Unit"
          value={`฿${(stats?.avgCostPerUnit || 0).toLocaleString()}`}
          icon={DollarSign}
          color="primary"
        />
      </div>

      {/* Search */}
      <div className="cyber-card p-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search BOM by product name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="cyber-input pl-10 w-full"
          />
        </div>
      </div>

      {/* Empty state */}
      {filteredBOMs.length === 0 && (
        <div className="cyber-card p-12 text-center">
          <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            {searchTerm ? 'ไม่พบ BOM ที่ค้นหา' : 'ยังไม่มี BOM'}
          </h3>
          <p className="text-gray-500">
            {searchTerm
              ? 'ลองค้นหาด้วยคำอื่น'
              : 'เริ่มต้นสร้าง BOM แรกของคุณ'}
          </p>
        </div>
      )}

      {/* BOM List */}
      <div className="grid grid-cols-1 gap-6">
        {filteredBOMs.map((bom, index) => (
          <motion.div
            key={bom.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="cyber-card p-6"
          >
            {/* BOM Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center shadow-neon">
                  <FileText className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-100">
                    {bom.product.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-gray-400">{bom.product.code}</span>
                    <span className="text-sm text-gray-400">•</span>
                    <span className="text-sm text-cyber-primary">{bom.version}</span>
                    <span className="text-sm text-gray-400">•</span>
                    <span className="text-sm text-gray-400">{bom.product.category}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge status={bom.status.toLowerCase() as 'active' | 'draft'} />
                <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
                  <Edit className="w-5 h-5 text-gray-400 hover:text-cyber-primary" />
                </button>
                <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
                  <Copy className="w-5 h-5 text-gray-400 hover:text-cyber-green" />
                </button>
                <button
                  onClick={() => handleDelete(bom.id, bom.product.name)}
                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-gray-400 hover:text-red-400" />
                </button>
              </div>
            </div>

            {/* Materials Table */}
            <div className="overflow-x-auto mb-4">
              <table className="cyber-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Code</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Cost/Unit</th>
                    <th>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.materials.map((item) => {
                    const itemTotal = Number(item.quantity) * Number(item.material.unitCost)
                    return (
                      <tr key={item.id}>
                        <td className="text-gray-300">{item.material.name}</td>
                        <td className="text-gray-400">{item.material.code}</td>
                        <td className="text-gray-400">{Number(item.quantity)}</td>
                        <td className="text-gray-400">{item.unit}</td>
                        <td className="text-gray-400">
                          ฿{Number(item.material.unitCost).toLocaleString()}
                        </td>
                        <td className="text-cyber-green font-semibold">
                          ฿{itemTotal.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Total Cost */}
            <div className="flex items-center justify-between pt-4 border-t border-cyber-border">
              <div className="text-sm text-gray-400">
                Last updated: {new Date(bom.updatedAt).toLocaleDateString('th-TH')}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Total Production Cost:</span>
                <span className="text-2xl font-bold text-cyber-primary font-['Orbitron']">
                  ฿{bom.totalCost.toLocaleString()}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: any
  color: string
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

function StatusBadge({ status }: { status: 'active' | 'draft' | 'archived' }) {
  const config = {
    active: {
      label: 'Active',
      className: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    },
    draft: {
      label: 'Draft',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    archived: {
      label: 'Archived',
      className: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    },
  }

  const selected = config[status] || config.draft

  return (
    <span className={`status-badge ${selected.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {selected.label}
    </span>
  )
}

export default BOMPage
