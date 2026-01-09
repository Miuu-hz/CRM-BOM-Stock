import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Package,
  Plus,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
} from 'lucide-react'

interface StockItem {
  id: string
  name: string
  category: 'raw' | 'wip' | 'finished'
  sku: string
  quantity: number
  unit: string
  minStock: number
  maxStock: number
  location: string
  lastUpdated: string
  status: 'adequate' | 'low' | 'critical' | 'overstock'
  recentMovement: 'in' | 'out' | 'none'
}

const stockItems: StockItem[] = [
  {
    id: 'STK-001',
    name: 'Foam Material',
    category: 'raw',
    sku: 'RM-FOAM-001',
    quantity: 150,
    unit: 'kg',
    minStock: 500,
    maxStock: 2000,
    location: 'Warehouse A - Zone 1',
    lastUpdated: '2024-01-15 14:30',
    status: 'critical',
    recentMovement: 'out',
  },
  {
    id: 'STK-002',
    name: 'Spring Coils',
    category: 'raw',
    sku: 'RM-SPRING-002',
    quantity: 5400,
    unit: 'units',
    minStock: 2000,
    maxStock: 8000,
    location: 'Warehouse A - Zone 2',
    lastUpdated: '2024-01-15 10:15',
    status: 'adequate',
    recentMovement: 'in',
  },
  {
    id: 'STK-003',
    name: 'King Mattress (Unfinished)',
    category: 'wip',
    sku: 'WIP-MATT-K-001',
    quantity: 45,
    unit: 'units',
    minStock: 20,
    maxStock: 100,
    location: 'Production Floor B',
    lastUpdated: '2024-01-15 16:45',
    status: 'adequate',
    recentMovement: 'none',
  },
  {
    id: 'STK-004',
    name: 'King Mattress Premium',
    category: 'finished',
    sku: 'FG-MATT-K-PREM',
    quantity: 180,
    unit: 'units',
    minStock: 50,
    maxStock: 200,
    location: 'Warehouse C - Zone 1',
    lastUpdated: '2024-01-15 12:00',
    status: 'adequate',
    recentMovement: 'out',
  },
  {
    id: 'STK-005',
    name: 'Premium Pillow',
    category: 'finished',
    sku: 'FG-PILL-PREM',
    quantity: 850,
    unit: 'units',
    minStock: 200,
    maxStock: 600,
    location: 'Warehouse C - Zone 2',
    lastUpdated: '2024-01-15 09:30',
    status: 'overstock',
    recentMovement: 'in',
  },
  {
    id: 'STK-006',
    name: 'Fabric Cover',
    category: 'raw',
    sku: 'RM-FABRIC-003',
    quantity: 80,
    unit: 'meters',
    minStock: 100,
    maxStock: 500,
    location: 'Warehouse A - Zone 3',
    lastUpdated: '2024-01-15 11:20',
    status: 'low',
    recentMovement: 'out',
  },
]

function Stock() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')

  const filteredItems = stockItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory =
      selectedCategory === 'all' || item.category === selectedCategory
    const matchesStatus =
      selectedStatus === 'all' || item.status === selectedStatus
    return matchesSearch && matchesCategory && matchesStatus
  })

  const stats = {
    total: stockItems.length,
    critical: stockItems.filter((i) => i.status === 'critical').length,
    low: stockItems.filter((i) => i.status === 'low').length,
    adequate: stockItems.filter((i) => i.status === 'adequate').length,
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
            <span className="neon-text">Inventory Management</span>
          </h1>
          <p className="text-gray-400">Track and manage your stock levels</p>
        </div>
        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="cyber-btn-secondary flex items-center gap-2"
          >
            <ArrowUpCircle className="w-5 h-5" />
            Stock In
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <ArrowDownCircle className="w-5 h-5" />
            Stock Out
          </motion.button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Total Items"
          value={stats.total.toString()}
          icon={Package}
          color="primary"
        />
        <StatCard
          label="Critical Stock"
          value={stats.critical.toString()}
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          label="Low Stock"
          value={stats.low.toString()}
          icon={TrendingDown}
          color="yellow"
        />
        <StatCard
          label="Adequate Stock"
          value={stats.adequate.toString()}
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="cyber-card p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search items by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>

          {/* Category Filter */}
          <div className="flex gap-2">
            <FilterButton
              label="All"
              active={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
            />
            <FilterButton
              label="Raw Material"
              active={selectedCategory === 'raw'}
              onClick={() => setSelectedCategory('raw')}
            />
            <FilterButton
              label="WIP"
              active={selectedCategory === 'wip'}
              onClick={() => setSelectedCategory('wip')}
            />
            <FilterButton
              label="Finished"
              active={selectedCategory === 'finished'}
              onClick={() => setSelectedCategory('finished')}
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            <FilterButton
              label="All Status"
              active={selectedStatus === 'all'}
              onClick={() => setSelectedStatus('all')}
            />
            <FilterButton
              label="Critical"
              active={selectedStatus === 'critical'}
              onClick={() => setSelectedStatus('critical')}
            />
            <FilterButton
              label="Low"
              active={selectedStatus === 'low'}
              onClick={() => setSelectedStatus('low')}
            />
          </div>
        </div>
      </div>

      {/* Stock List */}
      <div className="cyber-card p-6">
        <div className="overflow-x-auto">
          <table className="cyber-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Current Stock</th>
                <th>Min / Max</th>
                <th>Location</th>
                <th>Status</th>
                <th>Movement</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, index) => (
                <motion.tr
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-cyber-primary" />
                      <span className="text-gray-300 font-medium">
                        {item.name}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="text-gray-400 font-mono text-sm">
                      {item.sku}
                    </span>
                  </td>
                  <td>
                    <CategoryBadge category={item.category} />
                  </td>
                  <td>
                    <span className="text-cyber-primary font-semibold">
                      {item.quantity} {item.unit}
                    </span>
                  </td>
                  <td>
                    <span className="text-gray-400 text-sm">
                      {item.minStock} / {item.maxStock}
                    </span>
                  </td>
                  <td>
                    <span className="text-gray-400 text-sm">
                      {item.location}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>
                    <MovementIndicator movement={item.recentMovement} />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const colorClass = {
    primary: 'text-cyber-primary',
    green: 'text-cyber-green',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  }[color]

  return (
    <div className="cyber-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${colorClass} font-['Orbitron']`}>
            {value}
          </p>
        </div>
        <Icon className={`w-8 h-8 ${colorClass} opacity-50`} />
      </div>
    </div>
  )
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
        active
          ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
          : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
      }`}
    >
      {label}
    </button>
  )
}

function CategoryBadge({ category }: { category: StockItem['category'] }) {
  const config = {
    raw: { label: 'Raw Material', color: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
    wip: { label: 'WIP', color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
    finished: { label: 'Finished', color: 'text-cyber-green bg-cyber-green/20 border-cyber-green/30' },
  }

  const selected = config[category]

  return (
    <span className={`status-badge ${selected.color}`}>{selected.label}</span>
  )
}

function StatusBadge({ status }: { status: StockItem['status'] }) {
  const config = {
    adequate: {
      label: 'Adequate',
      className: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    },
    low: {
      label: 'Low',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    critical: {
      label: 'Critical',
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
    },
    overstock: {
      label: 'Overstock',
      className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
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

function MovementIndicator({ movement }: { movement: StockItem['recentMovement'] }) {
  if (movement === 'none') {
    return <span className="text-gray-500 text-sm">-</span>
  }

  return (
    <div className="flex items-center gap-1">
      {movement === 'in' ? (
        <ArrowUpCircle className="w-4 h-4 text-cyber-green" />
      ) : (
        <ArrowDownCircle className="w-4 h-4 text-red-400" />
      )}
      <span className={movement === 'in' ? 'text-cyber-green' : 'text-red-400'}>
        {movement === 'in' ? 'In' : 'Out'}
      </span>
    </div>
  )
}

export default Stock
