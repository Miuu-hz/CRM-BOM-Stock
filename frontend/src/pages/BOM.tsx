import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
import { unitLabel } from '../hooks/useUnits'

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
  /** ต้นทุนต่อ 1 หน่วยผลผลิต (Agent A เปลี่ยน calculateBOMCost ให้คืนต้นทุนต่อหน่วยแล้ว) */
  totalCost: number
  items?: BOMItem[]
  materials?: BOMItem[]
  itemCount?: number
  createdAt: string
  updatedAt: string
  isTopLevel?: boolean
  /** BOM 1 ใบผลิตได้กี่หน่วย (R2-UI) — backend อาจคืน camelCase หรือ snake_case แล้วแต่ endpoint */
  outputQty?: number
  output_qty?: number
  /** หน่วยผลผลิต — ไม่มีค่า = ใช้หน่วยของสินค้า */
  outputUnit?: string
  output_unit?: string
}

/** ผลผลิตต่อ 1 ชุดของ BOM (default 1 เมื่อ backend ยังไม่ส่งมา) */
const bomOutputQty = (bom: BOM): number => {
  const q = bom.outputQty ?? bom.output_qty
  return q && q > 0 ? Number(q) : 1
}

/** หน่วยผลผลิตของ BOM — ใช้หน่วยของสินค้าเป็น fallback ถ้ามีให้ */
const bomOutputUnit = (bom: BOM, fallback?: string): string =>
  bom.outputUnit || bom.output_unit || fallback || ''

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
      unit?: string
      notes?: string
    }[]
  }) => {
    const response = await (await import('../services/api')).default.post('/bom', {
      ...data,
      materials: data.items.map(item => ({
        materialId: item.materialId,
        childBomId: item.childBomId,
        quantity: item.quantity,
        unit: item.unit,
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
      unit?: string
      notes?: string
    }[]
  }) => {
    const response = await (await import('../services/api')).default.put(`/bom/${id}`, {
      ...data,
      materials: data.items?.map(item => ({
        materialId: item.materialId,
        childBomId: item.childBomId,
        quantity: item.quantity,
        unit: item.unit,
        itemType: item.itemType,
        notes: item.notes,
      }))
    })
    return response.data?.data
  }
}

function BOMPage() {
  const { t } = useTranslation()
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
  const [expandedItemsMap, setExpandedItemsMap] = useState<Record<string, BOMItem[]>>({})
  const [expandedLoadingIds, setExpandedLoadingIds] = useState<Set<string>>(new Set())

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
        itemCount: bom.itemCount ?? bom.item_count,
      }))

      setBoms(transformedBOMs)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to fetch BOM data:', err)
      setError(t('bom.errors.loadFailed'))
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
    if (!confirm(t('bom.confirmDelete', { name: productName }))) {
      return
    }

    try {
      await nestedBomService.delete(id)
      setBoms((prev) => prev.filter((bom) => bom.id !== id))
      const newStats = await nestedBomService.getStats()
      setStats(newStats)
    } catch (err) {
      console.error('Failed to delete BOM:', err)
      alert(t('bom.errors.deleteFailed'))
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
  const toggleExpanded = async (bom: BOM) => {
    const isCurrentlyExpanded = expandedIds.has(bom.id)
    setExpandedIds((prev) => {
      const newSet = new Set(prev)
      if (isCurrentlyExpanded) {
        newSet.delete(bom.id)
      } else {
        newSet.add(bom.id)
      }
      return newSet
    })

    // Lazy-load items on first expand (list view never gets items/materials from GET /bom)
    if (!isCurrentlyExpanded && !expandedItemsMap[bom.id] && !bom.items && !bom.materials) {
      setExpandedLoadingIds((prev) => new Set(prev).add(bom.id))
      try {
        const full = await nestedBomService.getById(bom.id)
        setExpandedItemsMap((prev) => ({ ...prev, [bom.id]: full.items || full.materials || [] }))
      } catch (err) {
        console.error('Failed to fetch BOM items:', err)
        setExpandedItemsMap((prev) => ({ ...prev, [bom.id]: [] }))
      } finally {
        setExpandedLoadingIds((prev) => {
          const newSet = new Set(prev)
          newSet.delete(bom.id)
          return newSet
        })
      }
    }
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
      alert(t('bom.errors.loadTreeFailed'))
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
          <Loader2 className="w-12 h-12 text-[var(--primary)] animate-spin mx-auto mb-4" />
          <p className="text-[var(--fg-3)]">{t('bom.loading')}</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-danger mx-auto mb-4" />
          <p className="text-[var(--fg-2)] mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="phopy-btn-primary flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-5 h-5" />
            {t('bom.retry')}
          </button>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'bom' as TabType, label: t('bom.tabs.bomList'), icon: FileText },
    { id: 'materials' as TabType, label: t('bom.tabs.materials'), icon: Boxes },
    { id: 'calculator' as TabType, label: t('bom.tabs.productionCalculator'), icon: Calculator },
    { id: 'simulation' as TabType, label: t('bom.tabs.costSimulation'), icon: TrendingUp },
  ]

  const filterTabs = [
    { id: 'all' as BOMFilterType, label: t('bom.filter.all'), count: stats?.totalBOMs || 0 },
    { id: 'tree-view' as BOMFilterType, label: t('bom.filter.treeView'), icon: FolderTree },
    { id: 'semi-finished' as BOMFilterType, label: t('bom.filter.semiFinished'), count: stats?.semiFinishedBOMs || 0 },
    { id: 'finished' as BOMFilterType, label: t('bom.filter.finishedGoods') },
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
            <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
              <span className="text-[var(--fg-1)]">{t('bom.title')}</span>
            </h1>
            <p className="text-[var(--fg-3)]">{t('bom.subtitle')}</p>
          </div>
          {activeTab === 'bom' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleCreate}
              className="phopy-btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('bom.createBOM')}
            </motion.button>
          )}
        </div>

        {/* Tabs Navigation */}
        <div className="flex gap-2 border-b border-[var(--border)] pb-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-b-2 border-phopy-indigo'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
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
                label={t('bom.stats.totalBOMs')}
                value={stats?.totalBOMs.toString() || '0'}
                icon={FileText}
                color="primary"
              />
              <StatCard
                label={t('bom.stats.semiFinishedBOMs')}
                value={stats?.semiFinishedBOMs?.toString() || '0'}
                icon={GitBranch}
                color="purple"
              />
              <StatCard
                label={t('bom.stats.totalMaterials')}
                value={stats?.totalMaterials.toString() || '0'}
                icon={Package}
                color="green"
              />
              <StatCard
                label={t('bom.stats.avgCostPerUnit')}
                value={`฿${(stats?.avgCostPerUnit || 0).toLocaleString()}`}
                icon={DollarSign}
                color="primary"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 border-b border-[var(--border)]/50 pb-2 overflow-x-auto">
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setBomFilter(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap text-sm ${
                    bomFilter === tab.id
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/30'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--surface-2)] border border-transparent'
                  }`}
                >
                  {tab.icon && <tab.icon className="w-4 h-4" />}
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="ml-1 px-2 py-0.5 bg-[var(--bg)] rounded-full text-xs">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Search & View Toggle */}
            <div className="phopy-card p-6">
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
                  <input
                    type="text"
                    placeholder={t('bom.searchPlaceholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="phopy-input pl-10 w-full"
                  />
                </div>
                {bomFilter !== 'tree-view' && (
                  <div className="flex items-center gap-1 bg-[var(--surface-2)] rounded-lg p-1 border border-[var(--border)]">
                    <button
                      onClick={() => setViewMode('card')}
                      className={`p-2 rounded-md transition-colors ${
                        viewMode === 'card'
                          ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                          : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                      }`}
                      title="Card View"
                    >
                      <LayoutGrid className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded-md transition-colors ${
                        viewMode === 'list'
                          ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                          : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
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
              <div className="phopy-card p-12 text-center">
                <Package className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-[var(--fg-2)] mb-2">
                  {searchTerm ? t('bom.empty.noResults') : t('bom.empty.noBOMs')}
                </h3>
                <p className="text-[var(--fg-4)] mb-4">
                  {searchTerm ? t('bom.empty.tryDifferent') : t('bom.empty.startCreate')}
                </p>
                {!searchTerm && (
                  <button onClick={handleCreate} className="phopy-btn-primary">
                    <Plus className="w-5 h-5 mr-2" />
                    {t('bom.createBOM')}
                  </button>
                )}
              </div>
            )}

            {/* Tree View */}
            {bomFilter === 'tree-view' && filteredBOMs.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* BOM Selector */}
                <div className="phopy-card p-4">
                  <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                    <FolderTree className="w-5 h-5 text-[var(--primary)]" />
                    {t('bom.tree.selectBOM')}
                  </h3>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {(boms || []).filter(b => b.isTopLevel || b.level === 0).map((bom) => (
                      <button
                        key={bom.id}
                        onClick={() => loadBOMTree(bom)}
                        className={`w-full text-left p-3 rounded-lg transition-all ${
                          selectedTreeBOM?.id === bom.id
                            ? 'bg-[var(--primary-soft)] border border-phopy-indigo/50'
                            : 'bg-[var(--bg)]/30 hover:bg-[var(--surface-2)] border border-[var(--border)]/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--fg-2)] font-medium">{bom.productName}</span>
                          <LevelBadge level={0} />
                        </div>
                        <div className="text-sm text-[var(--fg-4)] mt-1">{bom.productCode}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-success" title={t('bom.common.costPerUnitTooltip')}>
                            ฿{bom.totalCost?.toLocaleString()}
                            {bomOutputUnit(bom) && <span className="text-[var(--fg-4)]"> / {unitLabel(bomOutputUnit(bom))}</span>}
                          </span>
                          <StatusBadge status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tree Visualization */}
                <div className="lg:col-span-2 phopy-card p-4">
                  {treeLoading ? (
                    <div className="flex items-center justify-center h-[400px]">
                      <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
                    </div>
                  ) : treeData ? (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-[var(--fg-2)] flex items-center gap-2">
                          <GitBranch className="w-5 h-5 text-[var(--primary)]" />
                          {t('bom.tree.hierarchy', { name: treeData.productName })}
                        </h3>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-[var(--primary)]" title={t('bom.common.costPerUnitTooltip')}>
                            ฿{treeData.totalCost?.toLocaleString()}
                            {bomOutputUnit(treeData) && <span className="text-sm text-[var(--fg-4)] font-normal"> / {unitLabel(bomOutputUnit(treeData))}</span>}
                          </span>
                          <p className="text-[10px] text-[var(--fg-4)]">{t('bom.common.costPerUnitLabel')}</p>
                        </div>
                      </div>
                      <div className="border-l-2 border-[var(--border)]/50 ml-4 space-y-2">
                        <TreeNode
                          node={treeData}
                          expandedNodes={expandedTreeNodes}
                          onToggle={toggleTreeNode}
                          level={0}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[400px] text-[var(--fg-4)]">
                      <div className="text-center">
                        <FolderTree className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>{t('bom.tree.empty')}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Card View */}
            {bomFilter !== 'tree-view' && viewMode === 'card' && filteredBOMs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
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
              <div className="phopy-card overflow-hidden">
                <div className="overflow-x-auto">
                <table className="phopy-table w-full">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>{t('bom.list.product')}</th>
                      <th>{t('bom.list.level')}</th>
                      <th>{t('bom.list.type')}</th>
                      <th>{t('bom.list.version')}</th>
                      <th>{t('bom.list.items')}</th>
                      <th>{t('bom.list.status')}</th>
                      <th>{t('bom.list.totalCost')}</th>
                      <th className="text-right">{t('bom.list.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBOMs.map((bom) => (
                      <React.Fragment key={bom.id}>
                        <tr
                          className="cursor-pointer hover:bg-[var(--surface-2)]"
                          onClick={() => toggleExpanded(bom)}
                        >
                          <td>
                            {expandedIds.has(bom.id) ? (
                              <ChevronUp className="w-4 h-4 text-[var(--fg-3)]" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-[var(--fg-3)]" />
                            )}
                          </td>
                          <td>
                            <div>
                              <span className="text-[var(--fg-2)] font-medium">
                                {bom.productName}
                              </span>
                              <span className="text-[var(--fg-4)] text-sm ml-2">
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
                          <td className="text-[var(--primary)]">{bom.version}</td>
                          <td className="text-[var(--fg-3)]">{bom.itemCount ?? (bom.items?.length || bom.materials?.length || 0)} {t('common.items')}</td>
                          <td>
                            <StatusBadge
                              status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'}
                            />
                          </td>
                          <td className="text-success font-semibold" title={t('bom.common.costPerUnitTooltip')}>
                            ฿{(bom.totalCost || 0).toLocaleString()}
                            {bomOutputUnit(bom) && <span className="text-[var(--fg-4)] font-normal"> / {unitLabel(bomOutputUnit(bom))}</span>}
                          </td>
                          <td>
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => handleEdit(bom)}
                                className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
                                title={t('common.edit')}
                              >
                                <Edit className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--primary)]" />
                              </button>
                              <button
                                onClick={() => handleCopy(bom)}
                                className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
                                title={t('common.copy')}
                              >
                                <Copy className="w-4 h-4 text-[var(--fg-3)] hover:text-success" />
                              </button>
                              <button
                                onClick={() => handleDelete(bom.id, bom.productName)}
                                className="p-2 rounded-lg hover:bg-[var(--danger-soft)] transition-colors"
                                title={t('common.delete')}
                              >
                                <Trash2 className="w-4 h-4 text-[var(--fg-3)] hover:text-danger" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {/* Expanded Materials */}
                        {expandedIds.has(bom.id) && (
                          <tr>
                            <td colSpan={9} className="bg-[var(--bg)]/30 p-0">
                              <div className="p-4">
                                {expandedLoadingIds.has(bom.id) ? (
                                  <div className="flex items-center gap-2 py-4 text-sm text-[var(--fg-3)]">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('bom.card.loading')}
                                  </div>
                                ) : (
                                  <BOMItemsTable items={expandedItemsMap[bom.id] || bom.items || bom.materials || []} />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
  const { t } = useTranslation()
  const isExpanded = expandedNodes.has(node.id)
  const childItems = (node as BOMTreeNode).items || []

  const paddingLeft = level * 24

  if ('itemType' in node) {
    // This is a BOMItem
    const item = node as BOMItem
    const isChildBOM = item.itemType === 'CHILD_BOM'

    return (
      <div style={{ marginLeft: paddingLeft }}>
        <div className="flex items-center gap-2 py-2 border-b border-[var(--border)]/20">
          {isChildBOM && item.childBOM ? (
            <>
              <button
                onClick={() => onToggle(item.id)}
                className="p-1 rounded hover:bg-[var(--surface-2)]"
              >
                {expandedNodes.has(item.id) ? (
                  <ChevronDown className="w-4 h-4 text-[var(--primary)]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[var(--primary)]" />
                )}
              </button>
              <FolderTree className="w-4 h-4 text-purple-500" />
              <span className="text-[var(--fg-2)] font-medium">{item.childBomProductName}</span>
              <LevelBadge level={item.childBOM?.level || level + 1} />
              <span className="text-xs text-[var(--fg-4)]">{item.childBomProductCode}</span>
              <span className="text-xs text-[var(--primary)]">× {item.quantity}</span>
              <span className="ml-auto text-success text-sm">
                ฿{((item.childBOM?.totalCost || 0) * item.quantity).toLocaleString()}
              </span>
            </>
          ) : (
            <>
              <div className="w-6" />
              <Box className="w-4 h-4 text-[var(--fg-4)]" />
              <span className="text-[var(--fg-2)]">{item.material?.name || item.materialId}</span>
              <span className="text-xs text-[var(--fg-4)]">{item.material?.code}</span>
              <span className="text-xs text-[var(--fg-3)]">{item.quantity} {unitLabel(item.unit || item.material?.unit)}</span>
              <span className="ml-auto text-[var(--fg-3)] text-sm">
                ฿{((item.material?.unitCost || 0) * item.quantity).toLocaleString()}
              </span>
            </>
          )}
        </div>
        
        {/* Render child BOM items if expanded */}
        {isChildBOM && item.childBOM && expandedNodes.has(item.id) && (
          <div className="border-l border-[var(--border)]/30 ml-4">
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
        className="flex items-center gap-2 py-3 px-3 bg-phopy-indigo/5 rounded-lg border border-phopy-indigo-50"
        style={{ marginLeft: paddingLeft }}
      >
        {childItems.some((i) => i.itemType === 'CHILD_BOM') ? (
          <button
            onClick={() => onToggle(bomNode.id)}
            className="p-1 rounded hover:bg-[var(--surface-2)]"
          >
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-[var(--primary)]" />
            ) : (
              <ChevronRight className="w-5 h-5 text-[var(--primary)]" />
            )}
          </button>
        ) : (
          <div className="w-7" />
        )}
        <Layers className="w-5 h-5 text-[var(--primary)]" />
        <span className="text-[var(--fg-1)] font-semibold">{bomNode.productName}</span>
        <LevelBadge level={bomNode.level} />
        <BOMTypeBadge isSemiFinished={bomNode.isSemiFinished} isTopLevel={bomNode.level === 0} />
        <span className="text-xs text-[var(--fg-4)]">{bomNode.productCode}</span>
        <span className="ml-auto text-[var(--primary)] font-bold" title={t('bom.common.costPerUnitTooltip')}>
          ฿{(bomNode.totalCost || 0).toLocaleString()}
          {bomOutputUnit(bomNode) && <span className="text-xs text-[var(--fg-4)] font-normal"> / {unitLabel(bomOutputUnit(bomNode))}</span>}
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
  const { t } = useTranslation()
  return (
    <div>
      <h4 className="text-sm font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
        <Boxes className="w-4 h-4 text-[var(--primary)]" />
        BOM Items
      </h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[var(--fg-4)] border-b border-[var(--border)]/30">
            <th className="text-left py-2">{t('bom.itemsTable.type')}</th>
            <th className="text-left py-2">{t('bom.itemsTable.name')}</th>
            <th className="text-left py-2">{t('bom.itemsTable.code')}</th>
            <th className="text-right py-2">{t('bom.itemsTable.quantity')}</th>
            <th className="text-right py-2">{t('bom.itemsTable.unitCost')}</th>
            <th className="text-right py-2">{t('bom.itemsTable.total')}</th>
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
              <tr key={item.id} className="border-b border-[var(--border)]/10">
                <td className="py-2">
                  {isChildBOM ? (
                    <span className="flex items-center gap-1 text-purple-500">
                      <GitBranch className="w-3 h-3" />
                      <span className="text-xs">{t('bom.itemType.childBOM')}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--fg-3)]">
                      <Box className="w-3 h-3" />
                      <span className="text-xs">{t('bom.itemType.material')}</span>
                    </span>
                  )}
                </td>
                <td className="py-2 text-[var(--fg-2)]">{name}</td>
                <td className="py-2 text-[var(--fg-4)]">{code}</td>
                <td className="py-2 text-right text-[var(--fg-3)]">
                  {item.quantity} {unitLabel(item.unit || item.material?.unit)}
                </td>
                <td className="py-2 text-right text-[var(--fg-3)]">
                  {!isChildBOM && `฿${unitCost.toLocaleString()}`}
                </td>
                <td className="py-2 text-right text-success">
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
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [cardItems, setCardItems] = useState<BOMItem[]>(bom.items || bom.materials || [])
  const [cardLoading, setCardLoading] = useState(false)
  const [itemsFetched, setItemsFetched] = useState(!!(bom.items || bom.materials))
  // Prefer the server-provided count (available immediately from GET /bom) so the
  // badge is correct before the user ever expands the card. Once the full item
  // list has been fetched (or was already present), fall back to its length.
  const itemCount = itemsFetched ? cardItems.length : (bom.itemCount ?? cardItems.length)

  const handleToggle = async () => {
    const next = !isExpanded
    setIsExpanded(next)
    // Fetch items on first expand if not loaded yet
    if (next && !itemsFetched) {
      setCardLoading(true)
      try {
        const full = await bomService.getById(bom.id)
        const loaded = full.items || full.materials || []
        setCardItems(loaded)
      } catch {
        setCardItems([])
      } finally {
        setItemsFetched(true)
        setCardLoading(false)
      }
    }
  }

  const fmtDate = (s?: string) => {
    if (!s || s === 'Invalid Date') return '-'
    const d = new Date(s)
    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('th-TH')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="phopy-card p-4 md:p-5"
    >
      {/* BOM Header */}
      <div className="flex items-start justify-between mb-4 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-12 h-12 shrink-0 rounded-lg flex items-center justify-center shadow-2 ${
            bom.isSemiFinished
              ? 'bg-gradient-to-br from-purple-500 to-pink-500'
              : bom.level === 0
              ? 'bg-gradient-to-br from-phopy-indigo to-phopy-indigo-600'
              : 'bg-gradient-to-br from-success to-phopy-indigo'
          }`}>
            {bom.isSemiFinished ? (
              <GitBranch className="w-6 h-6 text-white" />
            ) : (
              <FileText className="w-6 h-6 text-white" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-base font-bold text-[var(--fg-1)] truncate">{bom.productName}</h3>
              <LevelBadge level={bom.level} />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <BOMTypeBadge
                isSemiFinished={bom.isSemiFinished}
                isTopLevel={bom.isTopLevel || bom.level === 0}
              />
              <span className="text-xs text-[var(--fg-3)]">{bom.productCode}</span>
              <span className="text-xs text-[var(--fg-3)]">•</span>
              <span className="text-xs text-[var(--primary)]">{bom.version}</span>
            </div>
            {bomOutputUnit(bom) && (
              <div className="text-xs text-[var(--fg-4)] mt-1">
                {t('bom.card.outputBadge', { qty: bomOutputQty(bom).toLocaleString('th-TH'), unit: unitLabel(bomOutputUnit(bom)) })}
              </div>
            )}
            {bom.parentProductName && (
              <div className="flex items-center gap-1 mt-1 text-xs text-[var(--fg-4)]">
                <ArrowRight className="w-3 h-3" />
                <span className="truncate">{t('bom.card.usedIn', { name: bom.parentProductName })}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <StatusBadge status={bom.status.toLowerCase() as 'active' | 'draft' | 'archived'} />
          <button
            onClick={() => onEdit(bom)}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
            title={t('common.edit')}
          >
            <Edit className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--primary)]" />
          </button>
          <button
            onClick={() => onCopy(bom)}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
            title={t('common.copy')}
          >
            <Copy className="w-4 h-4 text-[var(--fg-3)] hover:text-success" />
          </button>
          <button
            onClick={() => onDelete(bom.id, bom.productName)}
            className="p-1.5 rounded-lg hover:bg-[var(--danger-soft)] transition-colors"
            title={t('common.delete')}
          >
            <Trash2 className="w-4 h-4 text-[var(--fg-3)] hover:text-danger" />
          </button>
        </div>
      </div>

      {/* BOM Items Preview */}
      <div className="mb-4">
        <button
          onClick={handleToggle}
          className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 mb-2"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span className="font-medium">{t('bom.card.materialsCount', { count: itemCount })}</span>
        </button>
        
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {cardLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[var(--fg-3)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('bom.card.loading')}
                </div>
              ) : itemCount === 0 ? (
                <div className="py-4 text-center text-sm text-[var(--fg-4)] bg-[var(--bg)]/30 rounded-lg border border-[var(--border)]/30">
                  <Box className="w-5 h-5 mx-auto mb-1 text-[var(--fg-4)]" />
                  {t('bom.card.noItems')}
                </div>
              ) : (
                // Compact vertical list (not a wide 6-col table) so it stays readable
                // inside a narrower grid column. Type/code move to a subtext line
                // under the material name; only qty + total are shown alongside.
                <div className="rounded-lg border border-[var(--border)]/30 divide-y divide-[var(--border)]/10 bg-[var(--bg)]/20">
                  {cardItems.map((item) => {
                    const isChildBOM = item.itemType === 'CHILD_BOM'
                    const name = isChildBOM ? item.childBomProductName : item.material?.name
                    const code = isChildBOM ? item.childBomProductCode : item.material?.code
                    const unitCost = isChildBOM ? 0 : (item.material?.unitCost || 0)
                    const itemTotal = isChildBOM ? 0 : unitCost * Number(item.quantity)

                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 py-2 px-3 hover:bg-[var(--surface-2)]">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[var(--fg-2)] truncate">{name}</div>
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-[var(--fg-4)]">
                            {isChildBOM ? (
                              <span className="flex items-center gap-1 text-purple-500">
                                <GitBranch className="w-3 h-3" />
                                Child BOM
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Box className="w-3 h-3" />
                                {t('bom.itemType.material')}
                              </span>
                            )}
                            {code && <span>· {code}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-[var(--fg-3)]">
                            {Number(item.quantity)} {unitLabel(item.unit || item.material?.unit)}
                          </div>
                          {!isChildBOM && (
                            <div className="text-sm text-success font-semibold">
                              ฿{itemTotal.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Total Cost */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-4 border-t border-[var(--border)]">
        <div className="text-xs text-[var(--fg-3)]">
          {t('bom.card.lastUpdated')}: {fmtDate(bom.updatedAt)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--fg-3)]" title={t('bom.common.costPerUnitTooltip')}>{t('bom.card.totalProductionCost')}:</span>
          <span className="text-lg font-bold text-[var(--primary)]">
            ฿{(bom.totalCost || 0).toLocaleString()}
            {bomOutputUnit(bom) && <span className="text-sm text-[var(--fg-4)] font-normal"> / {unitLabel(bomOutputUnit(bom))}</span>}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

// Level Badge Component
function LevelBadge({ level }: { level: number }) {
  const colors = [
    'bg-[var(--primary-soft)] text-[var(--primary)] border-phopy-indigo/30',
    'bg-purple-500/20 text-purple-500 border-purple-500/30',
    'bg-[var(--success-soft)] text-success border-success/30',
    'bg-[var(--warning-soft)] text-warning border-warning/30',
    'bg-[var(--warning-soft)] text-warning border-warning/30',
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
  const { t } = useTranslation()
  if (isTopLevel) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium border bg-[var(--success-soft)] text-success border-success/30 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        {t('bom.typeBadge.finished')}
      </span>
    )
  }
  
  if (isSemiFinished) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/20 text-purple-500 border-purple-500/30 flex items-center gap-1">
        <GitBranch className="w-3 h-3" />
        {t('bom.typeBadge.semiFinished')}
      </span>
    )
  }

  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium border bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)] flex items-center gap-1">
      <Box className="w-3 h-3" />
      {t('bom.typeBadge.component')}
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
    primary: 'text-[var(--primary)]',
    green: 'text-success',
    purple: 'text-purple-500',
    yellow: 'text-warning',
  }

  return (
    <div className="phopy-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
          <p className={`text-2xl font-bold ${colorClasses[color] || 'text-[var(--primary)]'}`}>
            {value}
          </p>
        </div>
        <Icon className={`w-8 h-8 opacity-50 ${colorClasses[color] || 'text-[var(--primary)]'}`} />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'active' | 'draft' | 'archived' }) {
  const { t } = useTranslation()
  const config = {
    active: {
      label: t('bom.status.active'),
      className: 'bg-[var(--success-soft)] text-success border-success/30',
    },
    draft: {
      label: t('bom.status.draft'),
      className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
    },
    archived: {
      label: t('bom.status.archived'),
      className: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]',
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
