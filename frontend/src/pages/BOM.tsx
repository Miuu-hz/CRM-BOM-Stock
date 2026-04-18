import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  LayoutGrid,
  List,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Calculator,
  TrendingUp,
  Boxes,
  FolderTree,
  GitBranch,
  Box,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import bomService from '../services/bom'
import BOMModal from '../components/bom/BOMModal'
import MaterialsTab from '../components/bom/MaterialsTab'
import ProductionCalculator from '../components/bom/ProductionCalculator'
import CostSimulation from '../components/bom/CostSimulation'

// Types for Nested BOM
interface BOMItem {
  id: string
  materialId?: string
  childBomId?: string
  itemType: 'MATERIAL' | 'CHILD_BOM'
  quantity: number
  unit?: string
  notes?: string
  sortOrder: number
  material?: {
    id: string
    code: string
    name: string
    unit: string
    unitCost: number
  }
  childBomProductName?: string
  childBomProductCode?: string
  childBomVersion?: string
  childBOM?: BOMTreeNode
}

interface BOM {
  id: string
  productId: string
  productName: string
  productCode: string
  productCategory?: string
  version: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  level: number
  isSemiFinished: boolean
  parentId?: string
  parentVersion?: string
  parentProductName?: string
  totalCost: number
  items?: BOMItem[]
  materials?: BOMItem[]
  createdAt: string
  updatedAt: string
  isTopLevel?: boolean
}

interface BOMTreeNode extends BOM {
  items: BOMItem[]
  itemCount: number
  children?: BOMTreeNode[]
}

interface BOMStats {
  totalBOMs: number
  activeBOMs: number
  semiFinishedBOMs: number
  totalMaterials: number
  avgCostPerUnit: number
}

type ViewMode = 'card' | 'list' | 'tree'
type TabType = 'bom' | 'materials' | 'calculator' | 'simulation'
type BOMFilterType = 'all' | 'finished' | 'semi-finished' | 'tree-view'

// API Service extensions for Nested BOM
const nestedBomService = {
  ...bomService,
  
  // Get BOM tree (nested structure)
  getTree: async (id: string): Promise<BOMTreeNode> => {
    const response = await (await import('../services/api')).default.get(`/bom/tree/${id}`)
    if (!response.data?.data) {
      throw new Error('BOM tree not found')
    }
    return response.data.data
  },
  
  // Get available child BOMs for selection
  getAvailableChildren: async (id?: string): Promise<BOM[]> => {
    const response = await (await import('../services/api')).default.get(`/bom/available-children/${id || ''}`)
    return response.data?.data || []
  },
  
  // Create BOM with nested items support
  createWithItems: async (data: {
    productId: string
    version: string
    status?: 'DRAFT' | 'ACTIVE'
    isSemiFinished?: boolean
    items: {
      itemType: 'MATERIAL' | 'CHILD_BOM'
      materialId?: string
      childBomId?: string
      quantity: number
      notes?: string
    }[]
  }) => {
    const response = await (await import('../services/api')).default.post('/bom', {
      ...data,
      materials: data.items.map(item => ({
        materialId: item.materialId,
        childBomId: item.childBomId,
        quantity: item.quantity,
        itemType: item.itemType,
        notes: item.notes,
      }))
    })
    return response.data?.data
  },
  
  // Update BOM with nested items
  updateWithItems: async (id: string, data: {
    version?: string
    status?: 'DRAFT' | 'ACTIVE'
    isSemiFinished?: boolean
    items?: {
      itemType: 'MATERIAL' | 'CHILD_BOM'
      materialId?: string
      childBomId?: string
      quantity: number
      notes?: string
    }[]
  }) => {
    const response = await (await import('../services/api')).default.put(`/bom/${id}`, {
      ...data,
      materials: data.items?.map(item => ({
        materialId: item.materialId,
        childBomId: item.childBomId,
        quantity: item.quantity,
        itemType: item.itemType,
        notes: item.notes,
      }))
    })
    return response.data?.data
  }
}

function BOMPage() {
  const [activeTab, setActiveTab] = useState<TabType>('bom')
  const [boms, setBoms] = useState<BOM[]>([])
  const [stats, setStats] = useState<BOMStats | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [bomFilter, setBomFilter] = useState<BOMFilterType>('all')

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingBOM, setEditingBOM] = useState<BOM | null>(null)
  const [copyingBOM, setCopyingBOM] = useState<BOM | null>(null)

  // Tree view states
  const [selectedTreeBOM, setSelectedTreeBOM] = useState<BOM | null>(null)
  const [treeData, setTreeData] = useState<BOMTreeNode | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Set<string>>(new Set())

  // List view expanded states
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Fetch BOMs and stats
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [bomsData, statsData] = await Promise.all([
        nestedBomService.getAll(),
        nestedBomService.getStats(),
      ])

      // Transform the data to match our BOM interface
      const transformedBOMs = (bomsData || []).map((bom: any) => ({
        ...bom,
        productName: bom.product_name || bom.product?.name || '',
        productCode: bom.product_code || bom.product?.code || '',
        productCategory: bom.product_category || bom.product?.category || '',
        isSemiFinished: bom.is_semi_finished === 1 || bom.isSemiFinished === true,
        isTopLevel: bom.isTopLevel || (!bom.parent_id && bom.level === 0),
        level: bom.level || 0,
        parentId: bom.parent_id,
        parentVersion: bom.parent_version,
        parentProductName: bom.parent_product_name,
      }))

      setBoms(transformedBOMs)
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

  // Filter BOMs by search term and type
  const filteredBOMs = (boms || []).filter((bom) => {
    const matchesSearch = 
      (bom.productName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (bom.productCode || '').toLowerCase().includes(searchTerm.toLowerCase())
    
    if (!matchesSearch) return false

    switch (bomFilter) {
      case 'finished':
        return bom.isTopLevel || bom.level === 0
      case 'semi-finished':
        return bom.isSemiFinished
      case 'tree-view':
        return true
      default:
        return true
    }
  })

  // Handle create BOM
  const handleCreate = () => {
    setEditingBOM(null)
    setCopyingBOM(null)
    setIsModalOpen(true)
  }

  // Handle edit BOM
  const handleEdit = (bom: BOM) => {
    setEditingBOM(bom)
    setCopyingBOM(null)
    setIsModalOpen(true)
  }

  // Handle copy BOM
  const handleCopy = (bom: BOM) => {
    setEditingBOM(null)
    setCopyingBOM(bom)
    setIsModalOpen(true)
  }

  // Handle delete BOM
  const handleDelete = async (id: string, productName: string) => {
    if (!confirm(`คุณต้องการลบ BOM ของ "${productName}" หรือไม่?`)) {
      return
    }

    try {
      await nestedBomService.delete(id)
      setBoms((prev) => prev.filter((bom) => bom.id !== id))
      const newStats = await nestedBomService.getStats()
      setStats(newStats)
    } catch (err) {
      console.error('Failed to delete BOM:', err)
      alert('ไม่สามารถลบ BOM ได้ กรุณาลองใหม่อีกครั้ง')
    }
  }

  // Handle modal success
  const handleModalSuccess = () => {
    fetchData()
  }

  // Handle close modal
  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingBOM(null)
    setCopyingBOM(null)
  }

  // Toggle expanded row in list view
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  // Load BOM tree
  const loadBOMTree = async (bom: BOM) => {
    setSelectedTreeBOM(bom)
    setTreeLoading(true)
    try {
      const tree = await nestedBomService.getTree(bom.id)
      setTreeData(tree)
      // Expand root node by default
      setExpandedTreeNodes(new Set([bom.id]))
    } catch (err) {
      console.error('Failed to load BOM tree:', err)
      alert('ไม่สามารถโหลดข้อมูล BOM Tree ได้')
    } finally {
      setTreeLoading(false)
    }
  }

  // Toggle tree node expansion
  const toggleTreeNode = (nodeId: string) => {
    setExpandedTreeNodes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId)
      } else {
        newSet.add(nodeId)
      }
      return newSet
    })
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

  const tabs = [
    { id: 'bom' as TabType, label: 'BOM List', icon: FileText },
    { id: 'materials' as TabType, label: 'Materials', icon: Boxes },
    { id: 'calculator' as TabType, label: 'Production Calculator', icon: Calculator },
    { id: 'simulation' as TabType, label: 'Cost Simulation', icon: TrendingUp },
  ]

  const filterTabs = [
    { id: 'all' as BOMFilterType, label: 'All BOMs', count: stats?.totalBOMs || 0 },
    { id: 'tree-view' as BOMFilterType, label: 'Tree View', icon: FolderTree },
    { id: 'semi-finished' as BOMFilterType, label: 'Semi-finished', count: stats?.semiFinishedBOMs || 0 },
    { id: 'finished' as BOMFilterType, label: 'Finished Goods' },
  ]

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-100 mb-2">
              <span className="neon-text">Bill of Materials</span>
            </h1>
            <p className="text-gray-400">Manage product formulas and materials with nested BOM support</p>
          </div>
          {activeTab === 'bom' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleCreate}
              className="cyber-btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create BOM
            </motion.button>
          )}
        </div>

        {/* Tabs Navigation */}
        <div className="flex gap-2 border-b border-cyber-border pb-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-cyber-primary/20 text-cyber-primary border-b-2 border-cyber-primary'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-card/30'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'materials' && <MaterialsTab />}
        {activeTab === 'calculator' && <ProductionCalculator />}
        {activeTab === 'simulation' && <CostSimulation />}

        {/* BOM Tab Content */}
        {activeTab === 'bom' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <StatCard
                label="Total BOMs"
                value={stats?.totalBOMs.toString() || '0'}
                icon={FileText}
                color="primary"
              />
              <StatCard
                label="Semi-finished BOMs"
                value={stats?.semiFinishedBOMs?.toString() || '0'}
                icon={GitBranch}
                color="purple"
              />
              <StatCard
                label="Total Materials"
                value={stats?.totalMaterials.toString() || '0'}
                icon={Package}
                color="green"
              />
              <StatCard
                label="Avg. Cost/Unit"
                value={`฿${(stats?.avgCostPerUnit || 0).toLocaleString()}`}
                icon={DollarSign}
                color="primary"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 border-b border-cyber-border/50 pb-2 overflow-x-auto">
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setBomFilter(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap text-sm ${
                    bomFilter === tab.id
                      ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/30'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-card/30 border border-transparent'
                  }`}
                >
                  {tab.icon && <tab.icon className="w-4 h-4" />}
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="ml-1 px-2 py-0.5 bg-cyber-dark rounded-full text-xs">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Search & View Toggle */}
            <div className="cyber-card p-6">
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search BOM by product name or code..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="cyber-input pl-10 w-full"
                  />
                </div>
                {bomFilter !== 'tree-view' && (
                  <div className="flex items-center gap-1 bg-cyber-dark/50 rounded-lg p-1 border border-cyber-border">
                    <button
                      onClick={() => setViewMode('card')}
                      className={`p-2 rounded-md transition-colors ${
                        viewMode === 'card'
                          ? 'bg-cyber-primary/20 text-cyber-primary'
                          : 'text-gray-400 hover:text-gray-300'
                      }`}
                      title="Card View"
                    >
                      <LayoutGrid className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded-md transition-colors ${
                        viewMode === 'list'
                          ? 'bg-cyber-primary/20 text-cyber-primary'
                          : 'text-gray-400 hover:text-gray-300'
                      }`}
                      title="List View"
                    >
                      <List className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Empty state */}
            {filteredBOMs.length === 0 && (
              <div className="cyber-card p-12 text-center">
                <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-300 mb-2">
                  {searchTerm ? 'ไม่พบ BOM ที่ค้นหา' : 'ยังไม่มี BOM'}
                </h3>
                <p className="text-gray-500 mb-4">
                  {searchTerm ? 'ลองค้นหาด้วยคำอื่น' : 'เริ่มต้นสร้าง BOM แรกของคุณ'}
                </p>
                {!searchTerm && (
                  <button onClick={handleCreate} className="cyber-btn-primary">
                    <Plus className="w-5 h-5 mr-2" />
                    สร้าง BOM
                  </button>
                )}
              </div>
            )}

            {/* Tree View */}
            {bomFilter === 'tree-view' && filteredBOMs.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* BOM Selector */}
                <div className="cyber-card p-4">
                  <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
                    <FolderTree className="w-5 h-5 text-cyber-primary" />
                    Select BOM to View
                  </h3>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {(boms || []).filter(b => b.isTopLevel || b.level === 0).map((bom) => (
                      <button
                        key={bom.id}
                        onClick={() => loadBOMTree(bom)}
                        className={`w-full text-left p-3 rounded-lg transition-all ${
                          selectedTreeBOM?.id === bom.id
                            ? 'bg-cyber-primary/20 border border-cyber-primary/50'
                            : 'bg-cyber-dark/30 hover:bg-cyber-dark/50 border border-cyber-border/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-gray-200 font-medium">{bom.productName}</span>
                          <LevelBadge level={0} />
                        </div>
                        <div className="text-sm text-gray-500 mt-1">{bom.productCode}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-cyber-green">฿{bom.totalCost?.toLocaleString()}</span>
                          <StatusBadge status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tree Visualization */}
                <div className="lg:col-span-2 cyber-card p-4">
                  {treeLoading ? (
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
                    </div>
                  ) : treeData ? (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                          <GitBranch className="w-5 h-5 text-cyber-primary" />
                          BOM Hierarchy: {treeData.productName}
                        </h3>
                        <span className="text-2xl font-bold text-cyber-primary">
                          ฿{treeData.totalCost?.toLocaleString()}
                        </span>
                      </div>
                      <div className="border-l-2 border-cyber-border/50 ml-4 space-y-2">
                        <TreeNode
                          node={treeData}
                          expandedNodes={expandedTreeNodes}
                          onToggle={toggleTreeNode}
                          level={0}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[400px] text-gray-500">
                      <div className="text-center">
                        <FolderTree className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>Select a BOM to view its hierarchy</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Card View */}
            {bomFilter !== 'tree-view' && viewMode === 'card' && filteredBOMs.length > 0 && (
              <div className="grid grid-cols-1 gap-6">
                {filteredBOMs.map((bom, index) => (
                  <BOMCard
                    key={bom.id}
                    bom={bom}
                    index={index}
                    onEdit={handleEdit}
                    onCopy={handleCopy}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            {/* List View */}
            {bomFilter !== 'tree-view' && viewMode === 'list' && filteredBOMs.length > 0 && (
              <div className="cyber-card overflow-hidden">
                <div className="overflow-x-auto">
                <table className="cyber-table w-full">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>Product</th>
                      <th>Level</th>
                      <th>Type</th>
                      <th>Version</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>Total Cost</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBOMs.map((bom) => (
                      <>
                        <tr
                          key={bom.id}
                          className="cursor-pointer hover:bg-cyber-card/30"
                          onClick={() => toggleExpanded(bom.id)}
                        >
                          <td>
                            {expandedIds.has(bom.id) ? (
                              <ChevronUp className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            )}
                          </td>
                          <td>
                            <div>
                              <span className="text-gray-200 font-medium">
                                {bom.productName}
                              </span>
                              <span className="text-gray-500 text-sm ml-2">
                                {bom.productCode}
                              </span>
                            </div>
                          </td>
                          <td>
                            <LevelBadge level={bom.level} />
                          </td>
                          <td>
                            <BOMTypeBadge 
                              isSemiFinished={bom.isSemiFinished} 
                              isTopLevel={bom.isTopLevel || bom.level === 0}
                            />
                          </td>
                          <td className="text-cyber-primary">{bom.version}</td>
                          <td className="text-gray-400">{bom.items?.length || bom.materials?.length || 0} items</td>
                          <td>
                            <StatusBadge
                              status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'}
                            />
                          </td>
                          <td className="text-cyber-green font-semibold">
                            ฿{(bom.totalCost || 0).toLocaleString()}
                          </td>
                          <td>
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => handleEdit(bom)}
                                className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
                                title="แก้ไข"
                              >
                                <Edit className="w-4 h-4 text-gray-400 hover:text-cyber-primary" />
                              </button>
                              <button
                                onClick={() => handleCopy(bom)}
                                className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
                                title="คัดลอก"
                              >
                                <Copy className="w-4 h-4 text-gray-400 hover:text-cyber-green" />
                              </button>
                              <button
                                onClick={() => handleDelete(bom.id, bom.productName)}
                                className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                                title="ลบ"
                              >
                                <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {/* Expanded Materials */}
                        {expandedIds.has(bom.id) && (
                          <tr key={`${bom.id}-materials`}>
                            <td colSpan={9} className="bg-cyber-dark/30 p-0">
                              <div className="p-4">
                                <BOMItemsTable items={bom.items || bom.materials || []} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* BOM Modal */}
      <BOMModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        editBOM={editingBOM as any}
        copyFrom={copyingBOM as any}
      />
    </>
  )
}

// Tree Node Component
function TreeNode({
  node,
  expandedNodes,
  onToggle,
  level,
}: {
  node: BOMTreeNode | BOMItem
  expandedNodes: Set<string>
  onToggle: (id: string) => void
  level: number
}) {
  const isExpanded = expandedNodes.has(node.id)
  const childItems = (node as BOMTreeNode).items || []

  const paddingLeft = level * 24

  if ('itemType' in node) {
    // This is a BOMItem
    const item = node as BOMItem
    const isChildBOM = item.itemType === 'CHILD_BOM'

    return (
      <div style={{ marginLeft: paddingLeft }}>
        <div className="flex items-center gap-2 py-2 border-b border-cyber-border/20">
          {isChildBOM && item.childBOM ? (
            <>
              <button
                onClick={() => onToggle(item.id)}
                className="p-1 rounded hover:bg-cyber-card/50"
              >
                {expandedNodes.has(item.id) ? (
                  <ChevronDown className="w-4 h-4 text-cyber-primary" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-cyber-primary" />
                )}
              </button>
              <FolderTree className="w-4 h-4 text-cyber-purple" />
              <span className="text-gray-200 font-medium">{item.childBomProductName}</span>
              <LevelBadge level={item.childBOM?.level || level + 1} />
              <span className="text-xs text-gray-500">{item.childBomProductCode}</span>
              <span className="text-xs text-cyber-primary">× {item.quantity}</span>
              <span className="ml-auto text-cyber-green text-sm">
                ฿{((item.childBOM?.totalCost || 0) * item.quantity).toLocaleString()}
              </span>
            </>
          ) : (
            <>
              <div className="w-6" />
              <Box className="w-4 h-4 text-gray-500" />
              <span className="text-gray-300">{item.material?.name || item.materialId}</span>
              <span className="text-xs text-gray-500">{item.material?.code}</span>
              <span className="text-xs text-gray-400">{item.quantity} {item.unit || item.material?.unit}</span>
              <span className="ml-auto text-gray-400 text-sm">
                ฿{((item.material?.unitCost || 0) * item.quantity).toLocaleString()}
              </span>
            </>
          )}
        </div>
        
        {/* Render child BOM items if expanded */}
        {isChildBOM && item.childBOM && expandedNodes.has(item.id) && (
          <div className="border-l border-cyber-border/30 ml-4">
            {item.childBOM.items?.map((childItem) => (
              <TreeNode
                key={childItem.id}
                node={childItem}
                expandedNodes={expandedNodes}
                onToggle={onToggle}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // This is a BOMTreeNode (root or parent)
  const bomNode = node as BOMTreeNode

  return (
    <div>
      <div
        className="flex items-center gap-2 py-3 px-3 bg-cyber-primary/5 rounded-lg border border-cyber-primary/20"
        style={{ marginLeft: paddingLeft }}
      >
        {childItems.some((i) => i.itemType === 'CHILD_BOM') ? (
          <button
            onClick={() => onToggle(bomNode.id)}
            className="p-1 rounded hover:bg-cyber-card/50"
          >
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-cyber-primary" />
            ) : (
              <ChevronRight className="w-5 h-5 text-cyber-primary" />
            )}
          </button>
        ) : (
          <div className="w-7" />
        )}
        <Layers className="w-5 h-5 text-cyber-primary" />
        <span className="text-gray-100 font-semibold">{bomNode.productName}</span>
        <LevelBadge level={bomNode.level} />
        <BOMTypeBadge isSemiFinished={bomNode.isSemiFinished} isTopLevel={bomNode.level === 0} />
        <span className="text-xs text-gray-500">{bomNode.productCode}</span>
        <span className="ml-auto text-cyber-primary font-bold">
          ฿{(bomNode.totalCost || 0).toLocaleString()}
        </span>
      </div>

      {/* Render items */}
      {isExpanded && (
        <div className="mt-2 space-y-1">
          {childItems.map((item) => (
            <TreeNode
              key={item.id}
              node={item}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// BOM Items Table Component (for expanded view)
function BOMItemsTable({ items }: { items: BOMItem[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
        <Boxes className="w-4 h-4 text-cyber-primary" />
        BOM Items
      </h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 border-b border-cyber-border/30">
            <th className="text-left py-2">Type</th>
            <th className="text-left py-2">Name</th>
            <th className="text-left py-2">Code</th>
            <th className="text-right py-2">Quantity</th>
            <th className="text-right py-2">Unit Cost</th>
            <th className="text-right py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isChildBOM = item.itemType === 'CHILD_BOM'
            const name = isChildBOM ? item.childBomProductName : item.material?.name
            const code = isChildBOM ? item.childBomProductCode : item.material?.code
            const unitCost = isChildBOM ? 0 : (item.material?.unitCost || 0)
            const total = isChildBOM 
              ? 0 // Would need to fetch child BOM cost
              : (item.material?.unitCost || 0) * item.quantity

            return (
              <tr key={item.id} className="border-b border-cyber-border/10">
                <td className="py-2">
                  {isChildBOM ? (
                    <span className="flex items-center gap-1 text-cyber-purple">
                      <GitBranch className="w-3 h-3" />
                      <span className="text-xs">Child BOM</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-gray-400">
                      <Box className="w-3 h-3" />
                      <span className="text-xs">Material</span>
                    </span>
                  )}
                </td>
                <td className="py-2 text-gray-300">{name}</td>
                <td className="py-2 text-gray-500">{code}</td>
                <td className="py-2 text-right text-gray-400">
                  {item.quantity} {item.unit || item.material?.unit}
                </td>
                <td className="py-2 text-right text-gray-400">
                  {!isChildBOM && `฿${unitCost.toLocaleString()}`}
                </td>
                <td className="py-2 text-right text-cyber-green">
                  {!isChildBOM && `฿${total.toLocaleString()}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Card component for BOM
function BOMCard({
  bom,
  index,
  onEdit,
  onCopy,
  onDelete,
}: {
  bom: BOM
  index: number
  onEdit: (bom: BOM) => void
  onCopy: (bom: BOM) => void
  onDelete: (id: string, name: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="cyber-card p-6"
    >
      {/* BOM Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-lg flex items-center justify-center shadow-neon ${
            bom.isSemiFinished 
              ? 'bg-gradient-to-br from-cyber-purple to-cyber-magenta' 
              : bom.level === 0
              ? 'bg-gradient-to-br from-cyber-primary to-cyber-secondary'
              : 'bg-gradient-to-br from-cyber-green to-cyber-primary'
          }`}>
            {bom.isSemiFinished ? (
              <GitBranch className="w-8 h-8 text-white" />
            ) : (
              <FileText className="w-8 h-8 text-white" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold text-gray-100">{bom.productName}</h3>
              <LevelBadge level={bom.level} />
              <BOMTypeBadge 
                isSemiFinished={bom.isSemiFinished} 
                isTopLevel={bom.isTopLevel || bom.level === 0}
              />
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-400">{bom.productCode}</span>
              <span className="text-sm text-gray-400">•</span>
              <span className="text-sm text-cyber-primary">{bom.version}</span>
              <span className="text-sm text-gray-400">•</span>
              <span className="text-sm text-gray-400">{bom.productCategory}</span>
            </div>
            {bom.parentProductName && (
              <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                <ArrowRight className="w-3 h-3" />
                <span>Used in: {bom.parentProductName}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'} />
          <button
            onClick={() => onEdit(bom)}
            className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
            title="แก้ไข"
          >
            <Edit className="w-5 h-5 text-gray-400 hover:text-cyber-primary" />
          </button>
          <button
            onClick={() => onCopy(bom)}
            className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
            title="คัดลอก"
          >
            <Copy className="w-5 h-5 text-gray-400 hover:text-cyber-green" />
          </button>
          <button
            onClick={() => onDelete(bom.id, bom.productName)}
            className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
            title="ลบ"
          >
            <Trash2 className="w-5 h-5 text-gray-400 hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* BOM Items Preview */}
      <div className="overflow-x-auto mb-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-sm text-cyber-primary hover:text-cyber-primary/80"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span>Items ({(bom.items || bom.materials || []).length})</span>
          </button>
        </div>
        
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <table className="cyber-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Item</th>
                    <th>Code</th>
                    <th>Quantity</th>
                    <th>Cost/Unit</th>
                    <th>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(bom.items || bom.materials || []).map((item) => {
                    const isChildBOM = item.itemType === 'CHILD_BOM'
                    const name = isChildBOM ? item.childBomProductName : item.material?.name
                    const code = isChildBOM ? item.childBomProductCode : item.material?.code
                    const unitCost = isChildBOM ? 0 : (item.material?.unitCost || 0)
                    const itemTotal = isChildBOM ? 0 : unitCost * Number(item.quantity)

                    return (
                      <tr key={item.id}>
                        <td>
                          {isChildBOM ? (
                            <span className="flex items-center gap-1 text-cyber-purple text-sm">
                              <GitBranch className="w-3 h-3" />
                              BOM
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-gray-400 text-sm">
                              <Box className="w-3 h-3" />
                              Material
                            </span>
                          )}
                        </td>
                        <td className="text-gray-300">{name}</td>
                        <td className="text-gray-400">{code}</td>
                        <td className="text-gray-400">
                          {Number(item.quantity)} {item.unit || item.material?.unit}
                        </td>
                        <td className="text-gray-400">
                          {!isChildBOM && `฿${unitCost.toLocaleString()}`}
                        </td>
                        <td className="text-cyber-green font-semibold">
                          {!isChildBOM && `฿${itemTotal.toLocaleString()}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Total Cost */}
      <div className="flex items-center justify-between pt-4 border-t border-cyber-border">
        <div className="text-sm text-gray-400">
          Last updated: {new Date(bom.updatedAt).toLocaleDateString('th-TH')}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Total Production Cost:</span>
          <span className="text-2xl font-bold text-cyber-primary">
            ฿{(bom.totalCost || 0).toLocaleString()}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

// Level Badge Component
function LevelBadge({ level }: { level: number }) {
  const colors = [
    'bg-cyber-primary/20 text-cyber-primary border-cyber-primary/30',
    'bg-cyber-purple/20 text-cyber-purple border-cyber-purple/30',
    'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ]
  const colorClass = colors[level % colors.length]

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
      L{level}
    </span>
  )
}

// BOM Type Badge Component
function BOMTypeBadge({ 
  isSemiFinished, 
  isTopLevel 
}: { 
  isSemiFinished: boolean
  isTopLevel: boolean 
}) {
  if (isTopLevel) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium border bg-cyber-green/20 text-cyber-green border-cyber-green/30 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Finished
      </span>
    )
  }
  
  if (isSemiFinished) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium border bg-cyber-purple/20 text-cyber-purple border-cyber-purple/30 flex items-center gap-1">
        <GitBranch className="w-3 h-3" />
        Semi-finished
      </span>
    )
  }

  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium border bg-gray-500/20 text-gray-400 border-gray-500/30 flex items-center gap-1">
      <Box className="w-3 h-3" />
      Component
    </span>
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
  const colorClasses: Record<string, string> = {
    primary: 'text-cyber-primary',
    green: 'text-cyber-green',
    purple: 'text-cyber-purple',
    yellow: 'text-yellow-400',
  }

  return (
    <div className="cyber-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${colorClasses[color] || 'text-cyber-primary'}`}>
            {value}
          </p>
        </div>
        <Icon className={`w-8 h-8 opacity-50 ${colorClasses[color] || 'text-cyber-primary'}`} />
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
