import { useState } from 'react'
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
} from 'lucide-react'

interface Material {
  id: string
  name: string
  quantity: number
  unit: string
  cost: number
}

interface BOMItem {
  id: string
  productName: string
  category: string
  version: string
  materials: Material[]
  totalCost: number
  status: 'active' | 'draft' | 'archived'
  lastUpdated: string
}

const bomItems: BOMItem[] = [
  {
    id: 'BOM-001',
    productName: 'King Size Mattress Premium',
    category: 'Mattress',
    version: 'v2.1',
    materials: [
      { id: 'MAT-001', name: 'Foam Layer', quantity: 2.5, unit: 'kg', cost: 1500 },
      { id: 'MAT-002', name: 'Spring Coils', quantity: 800, unit: 'units', cost: 4000 },
      { id: 'MAT-003', name: 'Fabric Cover', quantity: 3.5, unit: 'meters', cost: 875 },
      { id: 'MAT-004', name: 'Thread', quantity: 1, unit: 'roll', cost: 200 },
      { id: 'MAT-005', name: 'Zipper', quantity: 1, unit: 'unit', cost: 50 },
    ],
    totalCost: 6625,
    status: 'active',
    lastUpdated: '2024-01-15',
  },
  {
    id: 'BOM-002',
    productName: 'Premium Pillow Set',
    category: 'Pillow',
    version: 'v1.5',
    materials: [
      { id: 'MAT-006', name: 'Memory Foam', quantity: 0.5, unit: 'kg', cost: 400 },
      { id: 'MAT-007', name: 'Cotton Cover', quantity: 0.8, unit: 'meters', cost: 160 },
      { id: 'MAT-008', name: 'Thread', quantity: 0.5, unit: 'roll', cost: 100 },
    ],
    totalCost: 660,
    status: 'active',
    lastUpdated: '2024-01-12',
  },
  {
    id: 'BOM-003',
    productName: 'Luxury Blanket',
    category: 'Blanket',
    version: 'v1.0',
    materials: [
      { id: 'MAT-009', name: 'Fleece Fabric', quantity: 2.0, unit: 'meters', cost: 600 },
      { id: 'MAT-010', name: 'Border Trim', quantity: 5.0, unit: 'meters', cost: 250 },
      { id: 'MAT-011', name: 'Thread', quantity: 0.5, unit: 'roll', cost: 100 },
    ],
    totalCost: 950,
    status: 'active',
    lastUpdated: '2024-01-10',
  },
]

function BOM() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedBOM, setSelectedBOM] = useState<BOMItem | null>(null)

  const filteredBOMs = bomItems.filter((bom) =>
    bom.productName.toLowerCase().includes(searchTerm.toLowerCase())
  )

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
          value="45"
          icon={FileText}
          color="primary"
        />
        <StatCard
          label="Active Formulas"
          value="38"
          icon={Layers}
          color="green"
        />
        <StatCard
          label="Total Materials"
          value="156"
          icon={Package}
          color="purple"
        />
        <StatCard
          label="Avg. Cost/Unit"
          value="฿2,745"
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
            placeholder="Search BOM..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="cyber-input pl-10 w-full"
          />
        </div>
      </div>

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
                    {bom.productName}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-gray-400">{bom.id}</span>
                    <span className="text-sm text-gray-400">•</span>
                    <span className="text-sm text-cyber-primary">{bom.version}</span>
                    <span className="text-sm text-gray-400">•</span>
                    <span className="text-sm text-gray-400">{bom.category}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge status={bom.status} />
                <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
                  <Edit className="w-5 h-5 text-gray-400 hover:text-cyber-primary" />
                </button>
                <button className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors">
                  <Copy className="w-5 h-5 text-gray-400 hover:text-cyber-green" />
                </button>
                <button className="p-2 rounded-lg hover:bg-red-500/10 transition-colors">
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
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Cost/Unit</th>
                    <th>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.materials.map((material) => (
                    <tr key={material.id}>
                      <td className="text-gray-300">{material.name}</td>
                      <td className="text-gray-400">{material.quantity}</td>
                      <td className="text-gray-400">{material.unit}</td>
                      <td className="text-gray-400">
                        ฿{material.cost / material.quantity}
                      </td>
                      <td className="text-cyber-green font-semibold">
                        ฿{material.cost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total Cost */}
            <div className="flex items-center justify-between pt-4 border-t border-cyber-border">
              <div className="text-sm text-gray-400">
                Last updated: {bom.lastUpdated}
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

function StatusBadge({ status }: { status: BOMItem['status'] }) {
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

  const selected = config[status]

  return (
    <span className={`status-badge ${selected.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {selected.label}
    </span>
  )
}

export default BOM
