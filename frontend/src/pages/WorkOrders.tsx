import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Loader2,
  PackageCheck,
  Pause,
  Play,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
  XCircle,
  ClipboardCheck,
  HardHat,
  Banknote,
  Landmark,
} from 'lucide-react'
import workOrderService, { WorkOrder, WOStats } from '../services/workOrder'
import subcontractService, { Subcontract } from '../services/subcontract'
import api from '../services/api'
import { useModalClose } from '../hooks/useModalClose'
import { SearchableDropdown } from '../components/common/SearchableDropdown'

const STATUS_STYLES: Record<string, { color: string; icon: any }> = {
  DRAFT: { color: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]', icon: FileText },
  PLANNED: { color: 'bg-[var(--info-soft)] text-blue-400 border-info/30', icon: Clock },
  IN_PROGRESS: { color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: Play },
  ON_HOLD: { color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: Pause },
  COMPLETED: { color: 'bg-[var(--success-soft)] text-success border-success/30', icon: CheckCircle },
  CANCELLED: { color: 'bg-[var(--danger-soft)] text-danger border-danger/30', icon: X },
}

const PRIORITY_STYLES: Record<string, { color: string }> = {
  URGENT: { color: 'text-danger bg-[var(--danger-soft)] border-danger/30' },
  HIGH: { color: 'text-warning bg-[var(--warning-soft)] border-warning/30' },
  NORMAL: { color: 'text-blue-400 bg-[var(--info-soft)] border-info/30' },
  LOW: { color: 'text-[var(--fg-3)] bg-[var(--surface-sunken)] border-[var(--border-strong)]' },
}

function getStatusConfig(t: (key: string) => string, status: string) {
  const base = STATUS_STYLES[status] || STATUS_STYLES.DRAFT
  return { ...base, label: t(`workOrders.status.${status.toLowerCase()}`) }
}

function getPriorityConfig(t: (key: string) => string, priority: string) {
  const base = PRIORITY_STYLES[priority] || PRIORITY_STYLES.NORMAL
  return { ...base, label: t(`workOrders.priority.${priority.toLowerCase()}`) }
}

function WorkOrders() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [stats, setStats] = useState<WOStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<WorkOrder | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [ordersData, statsData] = await Promise.all([
        workOrderService.getAll(),
        workOrderService.getStats(),
      ])
      setOrders(ordersData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load WO data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await workOrderService.updateStatus(id, status)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.error.updateStatus'))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('workOrders.confirmDelete'))) return
    try {
      await workOrderService.delete(id)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.error.delete'))
    }
  }

  const handleViewDetail = async (wo: WorkOrder) => {
    try {
      const detail = await workOrderService.getById(wo.id)
      setShowDetailModal(detail)
    } catch (err) {
      console.error(err)
    }
  }

  const filtered = (orders || []).filter((o) => {
    const matchSearch = o.wo_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.assigned_to || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || o.status === statusFilter
    return matchSearch && matchStatus
  })

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
            <span className="text-[var(--fg-1)]">{t('workOrders.title')}</span>
          </h1>
          <p className="text-[var(--fg-3)]">{t('workOrders.subtitle')}</p>
        </div>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreateModal(true)} className="phopy-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" /> {t('workOrders.createWorkOrder')}
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard labelKey="workOrders.stats.total" value={(stats?.totalOrders ?? 0).toString()} color="text-[var(--primary)]" />
        <StatCard labelKey="workOrders.stats.planned" value={(stats?.planned ?? 0).toString()} color="text-blue-400" />
        <StatCard labelKey="workOrders.stats.inProgress" value={(stats?.inProgress ?? 0).toString()} color="text-warning" />
        <StatCard labelKey="workOrders.stats.completed" value={(stats?.completed ?? 0).toString()} color="text-success" />
        <StatCard labelKey="workOrders.stats.totalProduced" value={(stats?.totalProduced ?? 0).toLocaleString()} color="text-purple-500" />
      </div>

      {/* Filters */}
      <div className="phopy-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
            <input type="text" placeholder={t('workOrders.searchPlaceholder')}
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="phopy-input pl-10 w-full" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  statusFilter === s ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)]'
                }`}>
                {s === 'all' ? t('common.all') : getStatusConfig(t, s).label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* WO List */}
      <div className="phopy-card p-6">
        <div className="overflow-x-auto">
          <table className="phopy-table">
            <thead>
              <tr>
                <th>{t('workOrders.table.woNumber')}</th>
                <th>{t('workOrders.table.product')}</th>
                <th>{t('workOrders.table.priority')}</th>
                <th>{t('workOrders.table.status')}</th>
                <th>{t('workOrders.table.quantity')}</th>
                <th>{t('workOrders.table.progress')}</th>
                <th>{t('workOrders.table.dueDate')}</th>
                <th>{t('workOrders.table.assignedTo')}</th>
                <th>{t('workOrders.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-[var(--fg-4)]">{t('workOrders.empty')}</td></tr>
              ) : (
                filtered.map((wo, i) => {
                  const statusConf = getStatusConfig(t, wo.status)
                  const priorityConf = getPriorityConfig(t, wo.priority)
                  const progress = wo.quantity > 0 ? Math.round((wo.completed_qty / wo.quantity) * 100) : 0
                  const isOverdue = wo.due_date && new Date(wo.due_date) < new Date() && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'

                  return (
                    <motion.tr key={wo.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                      <td>
                        <span className="text-[var(--primary)] font-mono font-semibold">{wo.wo_number}</span>
                      </td>
                      <td>
                        <div>
                          <p className="text-[var(--fg-2)]">{wo.product_name || '-'}</p>
                          <p className="text-[var(--fg-4)] text-xs">{t('workOrders.materialsCount', { count: wo.material_count || 0 })}</p>
                        </div>
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded text-xs font-semibold border ${priorityConf.color}`}>
                          {priorityConf.label}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${statusConf.color}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {statusConf.label}
                        </span>
                      </td>
                      <td><span className="text-[var(--fg-3)]">{wo.completed_qty}/{wo.quantity}</span></td>
                      <td>
                        <div className="w-24">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--fg-4)]">{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              progress === 100 ? 'bg-success' : progress > 0 ? 'bg-phopy-indigo' : 'bg-gray-600'
                            }`} style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          {isOverdue && <AlertTriangle className="w-3 h-3 text-danger" />}
                          <span className={`text-sm ${isOverdue ? 'text-danger' : 'text-[var(--fg-3)]'}`}>
                            {wo.due_date ? new Date(wo.due_date).toLocaleDateString('th-TH') : '-'}
                          </span>
                        </div>
                      </td>
                      <td><span className="text-[var(--fg-3)] text-sm">{wo.assigned_to || '-'}</span></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleViewDetail(wo)}
                            className="p-2 text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-phopy-indigo/10 rounded-lg">
                            <Eye className="w-4 h-4" />
                          </button>
                          {wo.status === 'DRAFT' && (
                            <button onClick={() => handleStatusChange(wo.id, 'PLANNED')}
                              className="p-2 text-[var(--fg-3)] hover:text-blue-400 hover:bg-blue-400/10 rounded-lg" title={t('workOrders.actions.plan')}>
                              <Clock className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'PLANNED' && (
                            <button onClick={() => handleStatusChange(wo.id, 'IN_PROGRESS')}
                              className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg" title={t('workOrders.actions.startProduction')}>
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'IN_PROGRESS' && (
                            <button onClick={() => handleStatusChange(wo.id, 'COMPLETED')}
                              className="p-2 text-[var(--fg-3)] hover:text-success hover:bg-success/10 rounded-lg" title={t('workOrders.actions.markComplete')}>
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'DRAFT' && (
                            <button onClick={() => handleDelete(wo.id)}
                              className="p-2 text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] rounded-lg">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <CreateWOModal open={showCreateModal}
        onClose={() => setShowCreateModal(false)} onSave={loadData} />

      {/* Detail Modal */}
      <WODetailModal wo={showDetailModal} onClose={() => setShowDetailModal(null)}
        onStatusChange={handleStatusChange} />
    </motion.div>
  )
}

function StatCard({ labelKey, value, color }: { labelKey: string; value: string; color: string }) {
  const { t } = useTranslation()
  return (
    <div className="phopy-card p-4">
      <p className="text-sm text-[var(--fg-3)] mb-1">{t(labelKey)}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function CreateWOModal({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [productName, setProductName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [priority, setPriority] = useState('NORMAL')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState<{ materialId?: string; materialName: string; requiredQty: number; unit: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [boms, setBoms] = useState<any[]>([])
  const [selectedBomId, setSelectedBomId] = useState('')
  const [bomLoading, setBomLoading] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [stockMap, setStockMap] = useState<Record<string, { qty: number; unit: string }>>({})
  const [stockChecking, setStockChecking] = useState(false)
  const [creatingPR, setCreatingPR] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get('/bom').then(res => setBoms(res.data?.data || [])).catch(() => {})
  }, [open])

  // ตัวเลือก BOM สำหรับ SearchableDropdown (STEP 1)
  const bomOptions = useMemo(() => boms.map((bom: any) => ({
    id: bom.id,
    label: `${bom.product_name} (${bom.product_code} · v${bom.version})`,
    searchText: `${bom.product_name} ${bom.product_code}`,
  })), [boms])

  // รายชื่อสินค้าที่มีอยู่จริง (จาก BOM ทั้งหมด — ไม่มี endpoint /products แยกต่างหาก) ใช้เป็น autocomplete
  // ให้ช่องชื่อสินค้า (STEP 2) โดยยังคงพิมพ์ชื่อใหม่ที่ไม่อยู่ใน list ได้เสมอ
  const productNameOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    for (const b of boms) {
      if (b.product_name && !seen.has(b.product_name)) {
        seen.add(b.product_name)
        opts.push(b.product_name)
      }
    }
    return opts
  }, [boms])

  useEffect(() => {
    if (!open) {
      setProductName(''); setQuantity(1); setPriority('NORMAL')
      setDueDate(''); setAssignedTo(''); setNotes('')
      setMaterials([]); setSelectedBomId(''); setManualMode(false)
      setStockMap({}); setCreatingPR(false)
    }
  }, [open])

  const loadStockForMaterials = async (mats: { materialId?: string; unit: string }[]) => {
    const ids = mats.filter(m => m.materialId).map(m => m.materialId!)
    if (ids.length === 0) { setStockMap({}); return }
    setStockChecking(true)
    try {
      const res = await api.get('/stock')
      const items: any[] = res.data?.data || []
      const map: Record<string, { qty: number; unit: string }> = {}
      for (const item of items) {
        const mid = item.material_id || item.materialId
        if (mid && ids.includes(mid)) {
          map[mid] = { qty: Number(item.quantity ?? item.qty ?? 0), unit: item.unit || 'pcs' }
        }
      }
      setStockMap(map)
    } catch { setStockMap({}) }
    finally { setStockChecking(false) }
  }

  const loadBomMaterials = async (bomId: string, qty: number, fetchStock = false) => {
    setBomLoading(true)
    try {
      const res = await api.get(`/bom/explode/${bomId}?multiplier=${qty}`)
      const data = res.data?.data
      if (data?.materials?.length > 0) {
        const mats = data.materials.map((m: any) => ({
          materialId: m.materialId,
          materialName: m.materialName || m.materialCode || '',
          requiredQty: Number(m.quantity.toFixed(4)),
          unit: m.unit || 'pcs',
        }))
        setMaterials(mats)
        if (fetchStock) await loadStockForMaterials(mats)
      }
    } catch {}
    finally { setBomLoading(false) }
  }

  const handleBomSelect = async (bom: any) => {
    setSelectedBomId(bom.id)
    setProductName(bom.product_name || '')
    setManualMode(false)
    setStockMap({})
    await loadBomMaterials(bom.id, quantity, true)
  }

  const handleQuantityChange = async (newQty: number) => {
    setQuantity(newQty)
    if (selectedBomId && newQty > 0) await loadBomMaterials(selectedBomId, newQty, false)
  }

  const getStockStatus = (mat: { materialId?: string; requiredQty: number; unit: string }) => {
    if (!mat.materialId) return null
    const stock = stockMap[mat.materialId]
    if (!stock) return { type: 'unknown' as const }
    const sameUnit = stock.unit.toLowerCase() === mat.unit.toLowerCase()
    if (sameUnit) {
      const shortage = mat.requiredQty - stock.qty
      return shortage > 0
        ? { type: 'short' as const, shortage: Number(shortage.toFixed(4)), unit: mat.unit, stockQty: stock.qty }
        : { type: 'ok' as const, stockQty: stock.qty, unit: mat.unit }
    }
    return { type: 'mismatch' as const, stockQty: stock.qty, stockUnit: stock.unit }
  }

  const shortages = materials.filter(m => getStockStatus(m)?.type === 'short')

  const handleCreateAutoPR = async () => {
    if (shortages.length === 0) return
    setCreatingPR(true)
    try {
      const items = shortages.map(m => {
        const s = getStockStatus(m)
        const qty = s?.type === 'short' ? s.shortage : m.requiredQty
        return { material_id: m.materialId, material_name: m.materialName, quantity: qty, unit: m.unit }
      })
      await api.post('/purchase-requests', {
        reason: t('workOrders.create.prReason', { name: productName, quantity }),
        items,
      })
      alert(t('workOrders.create.prCreated', { count: items.length }))
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.create.prFailed'))
    } finally { setCreatingPR(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productName.trim()) return
    setSaving(true)
    try {
      const validMaterials = materials.filter(m => m.materialName.trim())
      await workOrderService.create({
        bomId: selectedBomId || undefined,
        productName, quantity, priority,
        dueDate: dueDate || undefined,
        assignedTo, notes,
        materials: validMaterials.length > 0 ? validMaterials : undefined,
      })
      onSave(); onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.error.create'))
    } finally { setSaving(false) }
  }

  const selectedBom = boms.find(b => b.id === selectedBomId)
  const priorityOptions = [
    { value: 'LOW', color: 'text-[var(--fg-3)] border-[var(--border-strong)] hover:border-[var(--border)]' },
    { value: 'NORMAL', color: 'text-blue-400 border-info/30 hover:border-blue-400' },
    { value: 'HIGH', color: 'text-warning border-warning/30 hover:border-orange-400' },
    { value: 'URGENT', color: 'text-danger border-danger/30 hover:border-red-400' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="phopy-card w-full max-w-2xl max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.create.title')}</h2>
                <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('workOrders.create.subtitle')}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-5">

                {/* STEP 1: BOM Picker */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">1</span>
                      {t('workOrders.create.step1')}
                    </p>
                    <button type="button" onClick={() => { setManualMode(true); setSelectedBomId(''); setProductName(''); setMaterials([]) }}
                      className={`text-xs px-2 py-1 rounded border transition-all ${manualMode ? 'border-phopy-indigo/50 text-[var(--primary)] bg-phopy-indigo/10' : 'border-[var(--border)] text-[var(--fg-4)] hover:text-[var(--fg-2)]'}`}>
                      {t('workOrders.create.manualEntry')}
                    </button>
                  </div>

                  {!manualMode ? (
                    <div>
                      <SearchableDropdown
                        value={selectedBomId}
                        onChange={(id) => { const bom = boms.find((b: any) => b.id === id); if (bom) handleBomSelect(bom) }}
                        options={bomOptions}
                        placeholder={boms.length === 0 ? t('workOrders.create.noBOMsPlaceholder') : t('workOrders.create.selectBomPlaceholder')}
                        disabled={boms.length === 0}
                      />
                      {selectedBom && (
                        <div className="mt-2 p-3 rounded-lg border border-phopy-indigo/40 bg-phopy-indigo/5">
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium text-[var(--fg-2)] leading-tight">{selectedBom.product_name}</p>
                            <CheckCircle className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                          </div>
                          <p className="text-xs text-[var(--fg-4)] mt-0.5">{selectedBom.product_code} · v{selectedBom.version}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${
                              selectedBom.status?.toUpperCase() === 'ACTIVE'
                                ? 'bg-success/10 text-success border-success-soft'
                                : 'bg-gray-500/10 text-[var(--fg-4)] border-gray-500/20'
                            }`}>{selectedBom.status}</span>
                            {selectedBom.is_semi_finished === 1 && (
                              <span className="text-xs text-purple-500">{t('workOrders.create.semiFinished')}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]/30 text-sm text-[var(--fg-3)]">
                      {t('workOrders.create.manualModeHint')}
                    </div>
                  )}
                </div>

                {/* STEP 2: Details */}
                <div>
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5 mb-3">
                    <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">2</span>
                    {t('workOrders.create.step2')}
                  </p>

                  <div className="space-y-3">
                    {/* Product + Qty side by side */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.productLabel')}</label>
                        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                          className="phopy-input w-full" placeholder={t('workOrders.create.productPlaceholder')} required
                          readOnly={!!selectedBomId && !manualMode}
                          list="wo-product-name-options" autoComplete="off"
                        />
                        {/* Autocomplete จากชื่อสินค้าที่มี BOM อยู่แล้ว — ยังพิมพ์ชื่อใหม่ที่ไม่อยู่ใน list ได้เสมอ (native <datalist>, ไม่บังคับเลือก) */}
                        <datalist id="wo-product-name-options">
                          {productNameOptions.map((name) => <option key={name} value={name} />)}
                        </datalist>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.quantityLabel')}</label>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => handleQuantityChange(Math.max(1, quantity - 1))}
                            className="w-8 h-9 flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] shrink-0">−</button>
                          <input type="number" value={quantity} onChange={(e) => handleQuantityChange(Number(e.target.value))}
                            className="phopy-input w-full text-center" min="1" required />
                          <button type="button" onClick={() => handleQuantityChange(quantity + 1)}
                            className="w-8 h-9 flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] shrink-0">+</button>
                        </div>
                      </div>
                    </div>

                    {/* Priority as button group */}
                    <div>
                      <label className="text-xs text-[var(--fg-4)] mb-1.5 block">{t('workOrders.create.priorityLabel')}</label>
                      <div className="flex gap-2">
                        {priorityOptions.map(opt => (
                          <button key={opt.value} type="button" onClick={() => setPriority(opt.value)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                              priority === opt.value
                                ? `${opt.color} bg-current/10`.replace('text-', 'bg-').replace('/10 bg-current/10', '/15 ') + opt.color
                                : 'border-[var(--border)]/30 text-[var(--fg-4)] hover:text-[var(--fg-2)]'
                            } ${priority === opt.value ? opt.color + ' border-current/40' : ''}`}>
                            {getPriorityConfig(t, opt.value).label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Due date + Assigned */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.dueDateLabel')}</label>
                        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="phopy-input w-full" />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.assignedToLabel')}</label>
                        <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                          className="phopy-input w-full" placeholder={t('workOrders.create.assignedToPlaceholder')} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 3: Materials */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">3</span>
                      {t('workOrders.create.step3')}
                      {(bomLoading || stockChecking) && <Loader2 className="w-3 h-3 animate-spin text-[var(--primary)]" />}
                    </p>
                    <button type="button"
                      onClick={() => setMaterials([...materials, { materialName: '', requiredQty: 1, unit: 'pcs' }])}
                      className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">
                      <Plus className="w-3 h-3" /> {t('common.add')}
                    </button>
                  </div>

                  {/* Stock summary banner */}
                  {materials.length > 0 && Object.keys(stockMap).length > 0 && !stockChecking && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2 border ${
                      shortages.length > 0
                        ? 'bg-[var(--danger-soft)] border-danger/20 text-danger'
                        : 'bg-[var(--success-soft)] border-success/20 text-success'
                    }`}>
                      {shortages.length > 0 ? (
                        <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('workOrders.create.stockShortage', { count: shortages.length })}</>
                      ) : (
                        <><PackageCheck className="w-3.5 h-3.5 shrink-0" /> {t('workOrders.create.stockSufficient')}</>
                      )}
                    </div>
                  )}

                  {materials.length === 0 ? (
                    <div className="text-center py-5 bg-[var(--surface-2)] rounded-lg border border-dashed border-[var(--border)]/40">
                      <p className="text-xs text-[var(--fg-4)]">
                        {selectedBomId ? (bomLoading ? t('common.loading') : t('workOrders.create.bomNoMaterials')) : t('workOrders.create.noMaterialsSelected')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {materials.map((mat, idx) => {
                        const ss = getStockStatus(mat)
                        return (
                          <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                            ss?.type === 'short' ? 'border-danger/20 bg-[var(--danger-soft)]'
                            : mat.materialId ? 'border-phopy-indigo/15 bg-phopy-indigo/5'
                            : 'border-[var(--border)]/20 bg-[var(--surface-2)]'
                          }`}>
                            {mat.materialId && <CheckCircle className={`w-3.5 h-3.5 shrink-0 ${ss?.type === 'short' ? 'text-danger' : 'text-[var(--primary)]'}`} />}
                            <input value={mat.materialName} onChange={(e) => {
                              const u = [...materials]; u[idx].materialName = e.target.value; setMaterials(u)
                            }} className="flex-1 bg-transparent text-sm text-[var(--fg-2)] outline-none placeholder-gray-600 min-w-0"
                              placeholder={t('workOrders.create.materialPlaceholder')} />
                            <input type="number" value={mat.requiredQty} onChange={(e) => {
                              const u = [...materials]; u[idx].requiredQty = Number(e.target.value); setMaterials(u)
                            }} className="w-20 bg-transparent text-sm text-success text-right outline-none border-b border-[var(--border)]/30 focus:border-phopy-indigo"
                              min="0.001" step="any" />
                            <input value={mat.unit} onChange={(e) => {
                              const u = [...materials]; u[idx].unit = e.target.value; setMaterials(u)
                            }} className="w-12 bg-transparent text-xs text-[var(--fg-4)] outline-none border-b border-[var(--border)]/30 focus:border-phopy-indigo"
                              placeholder={t('workOrders.create.unitPlaceholder')} />
                            {/* Stock status badge */}
                            {mat.materialId && (() => {
                              if (stockChecking) return <Loader2 key="spin" className="w-3 h-3 animate-spin text-[var(--fg-4)] shrink-0" />
                              if (!ss || ss.type === 'unknown') return <span key="unk" className="text-xs text-[var(--fg-4)] shrink-0 w-16 text-right">?</span>
                              if (ss.type === 'ok') return <span key="ok" className="text-xs text-success shrink-0 w-16 text-right font-medium"><Check className="w-3 h-3 inline" /> {ss.stockQty} {ss.unit}</span>
                              if (ss.type === 'short') return <span key="sh" className="text-xs text-danger shrink-0 w-16 text-right font-semibold">-{ss.shortage} {ss.unit}</span>
                              return <span key="mm" className="text-xs text-warning shrink-0 w-16 text-right">{ss.stockQty} {ss.stockUnit}</span>
                            })()}
                            <button type="button" onClick={() => setMaterials(materials.filter((_, i) => i !== idx))}
                              className="text-[var(--fg-4)] hover:text-danger shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )
                      })}
                      <p className="text-xs text-[var(--fg-4)] text-right">{t('workOrders.create.itemsCount', { count: materials.length })}</p>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('common.notes')}</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    className="phopy-input w-full text-sm" rows={2} placeholder={t('workOrders.create.notesPlaceholder')} />
                </div>
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-[var(--border)] shrink-0 space-y-3">
                {/* Auto-PR row — shown only when shortages exist */}
                {shortages.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2.5 bg-[var(--danger-soft)] border border-danger/20 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-danger">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span dangerouslySetInnerHTML={{ __html: t('workOrders.create.shortageSummary', { count: shortages.length }) }} />
                    </div>
                    <button type="button" onClick={handleCreateAutoPR} disabled={creatingPR}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-danger text-white rounded-lg hover:bg-danger/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                      {creatingPR ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                      {t('workOrders.create.createPR')}
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--fg-4)]">
                    {selectedBom ? (
                      <span className="flex items-center gap-1 text-[var(--primary)]">
                        <CheckCircle className="w-3 h-3" /> {t('workOrders.create.bomSelected', { name: selectedBom.product_name })}
                      </span>
                    ) : manualMode ? t('workOrders.create.manualEntrySelected') : t('workOrders.create.noBOMSelected')}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)]">
                      {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={saving || bomLoading || !productName.trim()}
                      className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {t('workOrders.create.createButton')}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function WODetailModal({ wo, onClose, onStatusChange }: {
  wo: WorkOrder | null; onClose: () => void; onStatusChange: (id: string, status: string) => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [contracts, setContracts] = useState<Subcontract[]>([])
  const [contractsLoading, setContractsLoading] = useState(false)
  const [showAddContract, setShowAddContract] = useState(false)
  const [payingContract, setPayingContract] = useState<Subcontract | null>(null)
  const [issuingContract, setIssuingContract] = useState<Subcontract | null>(null)
  const [receivingContract, setReceivingContract] = useState<Subcontract | null>(null)
  const [reconcileContract, setReconcileContract] = useState<Subcontract | null>(null)

  const loadContracts = async (woId: string) => {
    setContractsLoading(true)
    try {
      setContracts(await subcontractService.getAll({ work_order_id: woId }))
    } catch {
      setContracts([])
    } finally {
      setContractsLoading(false)
    }
  }

  useEffect(() => {
    if (wo) loadContracts(wo.id)
    else setContracts([])
  }, [wo?.id])

  if (!wo) return null
  const statusConf = getStatusConfig(t, wo.status)
  const priorityConf = getPriorityConfig(t, wo.priority)
  const progress = wo.quantity > 0 ? Math.round((wo.completed_qty / wo.quantity) * 100) : 0

  const nextStatus: Record<string, { label: string; status: string; color: string }> = {
    DRAFT: { label: t('workOrders.detail.planProduction'), status: 'PLANNED', color: 'bg-blue-500 text-white' },
    PLANNED: { label: t('workOrders.detail.startProduction'), status: 'IN_PROGRESS', color: 'bg-yellow-500 text-black' },
    IN_PROGRESS: { label: t('workOrders.detail.markComplete'), status: 'COMPLETED', color: 'bg-success text-black' },
  }

  const next = nextStatus[wo.status]

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
          onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-[var(--fg-1)]">{wo.wo_number}</h2>
              <p className="text-[var(--fg-3)] text-sm">{wo.product_name}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded text-xs font-semibold border ${priorityConf.color}`}>{priorityConf.label}</span>
              <span className={`status-badge ${statusConf.color}`}>{statusConf.label}</span>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg"><X className="w-5 h-5 text-[var(--fg-3)]" /></button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Status Flow */}
            <div className="flex items-center gap-2 text-sm overflow-x-auto py-2">
              {['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED'].map((s, i) => {
                const sc = getStatusConfig(t, s)
                return (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`px-3 py-1 rounded-full whitespace-nowrap ${
                      wo.status === s ? sc.color + ' font-semibold'
                      : ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED'].indexOf(wo.status) > i
                      ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'
                    }`}>
                      {sc.label}
                    </div>
                    {i < 3 && <ArrowRight className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0" />}
                  </div>
                )
              })}
            </div>

            {/* Progress */}
            <div className="bg-[var(--surface-2)] p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[var(--fg-3)] text-sm">{t('workOrders.detail.productionProgress')}</span>
                <span className="text-[var(--fg-2)] font-semibold">{wo.completed_qty} / {wo.quantity} {t('workOrders.detail.units')} ({progress}%)</span>
              </div>
              <div className="h-3 bg-[var(--bg)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  progress === 100 ? 'bg-success' : progress > 0 ? 'bg-phopy-indigo' : 'bg-gray-600'
                }`} style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">{t('workOrders.detail.assignedTo')}</p>
                <p className="text-[var(--fg-2)]">{wo.assigned_to || '-'}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">{t('workOrders.detail.dueDate')}</p>
                <p className="text-[var(--fg-2)]">{wo.due_date ? new Date(wo.due_date).toLocaleDateString('th-TH') : '-'}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">{t('workOrders.detail.estimatedCost')}</p>
                <p className="text-success font-semibold">฿{wo.estimated_cost.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">{t('workOrders.detail.actualCost')}</p>
                <p className="text-[var(--fg-2)]">฿{wo.actual_cost.toLocaleString()}</p>
              </div>
            </div>

            {/* Materials */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3">{t('workOrders.detail.materialsRequired')}</h3>
              {wo.materials && wo.materials.length > 0 ? (
                <div className="space-y-2">
                  {wo.materials.map((mat) => (
                    <div key={mat.id} className="flex justify-between items-center p-3 bg-[var(--surface-2)] rounded-lg">
                      <div>
                        <p className="text-[var(--fg-2)]">{mat.material_name || t('workOrders.detail.materialFallback')}</p>
                        <p className="text-[var(--fg-4)] text-xs">
                          {t('workOrders.detail.issued', { issued: mat.issued_qty, required: mat.required_qty, unit: mat.unit })}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        mat.status === 'ISSUED' ? 'bg-[var(--success-soft)] text-success' :
                        mat.status === 'PENDING' ? 'bg-[var(--warning-soft)] text-warning' :
                        'bg-[var(--surface-sunken)] text-[var(--fg-3)]'
                      }`}>
                        {mat.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--fg-4)]">{t('workOrders.detail.noMaterialsLinked')}</p>
              )}
            </div>

            {/* QC Status */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-[var(--primary)]" />
                {t('workOrders.detail.qcTitle')}
              </h3>
              {wo.inspections && wo.inspections.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {(() => {
                      const pass = wo.inspections!.filter(i => i.status === 'PASS').length
                      const fail = wo.inspections!.filter(i => i.status === 'FAIL').length
                      const pending = wo.inspections!.filter(i => i.status === 'PENDING').length
                      return (
                        <>
                          {pass > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[var(--success-soft)] text-success">
                              <CheckCircle className="w-3.5 h-3.5" /> {t('workOrders.detail.qcPass', { count: pass })}
                            </span>
                          )}
                          {fail > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[var(--danger-soft)] text-danger">
                              <XCircle className="w-3.5 h-3.5" /> {t('workOrders.detail.qcFail', { count: fail })}
                            </span>
                          )}
                          {pending > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[var(--warning-soft)] text-warning">
                              <Clock className="w-3.5 h-3.5" /> {t('workOrders.detail.qcPending', { count: pending })}
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  {wo.inspections.map(insp => (
                    <div key={insp.id} className="flex justify-between items-center p-3 bg-[var(--surface-2)] rounded-lg text-sm">
                      <div>
                        <p className="text-[var(--fg-2)]">{insp.checklist_name}</p>
                        <p className="text-[var(--fg-4)] text-xs">
                          {t('workOrders.detail.qcQty', { passed: insp.passed_qty, rejected: insp.rejected_qty, inspected: insp.inspected_qty })}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        insp.status === 'PASS' ? 'bg-[var(--success-soft)] text-success' :
                        insp.status === 'FAIL' ? 'bg-[var(--danger-soft)] text-danger' :
                        'bg-[var(--warning-soft)] text-warning'
                      }`}>
                        {insp.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--fg-4)]">{t('workOrders.detail.qcNone')}</p>
              )}
            </div>

            {/* Subcontract (Phase 2: จ้างเหมาค่าแรง) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-[var(--fg-2)] flex items-center gap-2">
                  <HardHat className="w-5 h-5 text-[var(--primary)]" />
                  {t('workOrders.subcontract.title')}
                </h3>
                <button onClick={() => setShowAddContract(true)}
                  className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> {t('workOrders.subcontract.add')}
                </button>
              </div>
              {contractsLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[var(--primary)]" /></div>
              ) : contracts.length === 0 ? (
                <p className="text-[var(--fg-4)]">{t('workOrders.subcontract.none')}</p>
              ) : (
                <div className="space-y-2">
                  {contracts.map((c) => {
                    const outstanding = Math.max(0, Math.round((c.labor_amount - c.paid_amount) * 100) / 100)
                    return (
                      <div key={c.id} className="p-3 bg-[var(--surface-2)] rounded-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[var(--fg-2)] font-medium flex items-center gap-1.5">
                              {c.contract_number}
                              {c.contract_type === 'OUTSOURCE' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-phopy-indigo/10 text-[var(--primary)]">
                                  {t('workOrders.subcontract.typeOutsource')}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[var(--fg-4)]">{c.supplier_name} · ฿{c.rate_per_unit}/{t('workOrders.detail.units')}</p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs ${
                            c.status === 'SETTLED' || c.status === 'RECEIVED' ? 'bg-[var(--success-soft)] text-success' :
                            c.status === 'CANCELLED' ? 'bg-[var(--surface-sunken)] text-[var(--fg-4)]' :
                            'bg-[var(--warning-soft)] text-warning'
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                          <div>
                            <p className="text-[var(--fg-4)]">{t('workOrders.subcontract.agreed')}</p>
                            <p className="text-[var(--fg-2)]">{c.agreed_qty}</p>
                          </div>
                          <div>
                            <p className="text-[var(--fg-4)]">
                              {c.contract_type === 'OUTSOURCE' ? t('workOrders.subcontract.received') : t('workOrders.subcontract.billed')}
                            </p>
                            <p className="text-[var(--fg-2)]">{c.contract_type === 'OUTSOURCE' ? c.received_qty : c.billed_qty}</p>
                          </div>
                          <div>
                            <p className="text-[var(--fg-4)]">{t('workOrders.subcontract.laborAmount')}</p>
                            <p className="text-[var(--fg-2)]">฿{c.labor_amount.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[var(--fg-4)]">{t('workOrders.subcontract.paid')}</p>
                            <p className="text-success">฿{c.paid_amount.toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 mt-2">
                          {c.contract_type === 'OUTSOURCE' && ['OPEN', 'MATERIAL_SENT', 'PARTIAL_RECEIVED'].includes(c.status) && (
                            <button onClick={() => setIssuingContract(c)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] hover:bg-phopy-indigo/20 flex items-center gap-1">
                              <PackageCheck className="w-3 h-3" /> {t('workOrders.subcontract.issueMaterials')}
                            </button>
                          )}
                          {c.contract_type === 'OUTSOURCE' && !['SETTLED', 'CANCELLED', 'CLOSED'].includes(c.status) && (
                            <button onClick={() => setReceivingContract(c)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] hover:bg-phopy-indigo/20 flex items-center gap-1">
                              <ClipboardCheck className="w-3 h-3" /> {t('workOrders.subcontract.receiveGoods')}
                            </button>
                          )}
                          {c.contract_type === 'OUTSOURCE' && (
                            <button onClick={() => setReconcileContract(c)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-2)] flex items-center gap-1">
                              <Eye className="w-3 h-3" /> {t('workOrders.subcontract.viewReconcile')}
                            </button>
                          )}
                          {outstanding > 0 && c.status !== 'CANCELLED' && (
                            <button onClick={() => setPayingContract(c)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] hover:bg-phopy-indigo/20 flex items-center gap-1">
                              <Banknote className="w-3 h-3" /> {t('workOrders.subcontract.pay')} (฿{outstanding.toLocaleString()})
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            {wo.notes && (
              <div className="bg-[var(--surface-2)] p-4 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">{t('common.notes')}</p>
                <p className="text-[var(--fg-2)] text-sm">{wo.notes}</p>
              </div>
            )}

            {wo.status === 'COMPLETED' && (
              <div className="p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-success" />
                <div>
                  <p className="text-success font-medium">{t('workOrders.detail.productionComplete')}</p>
                  <p className="text-[var(--fg-3)] text-sm">
                    {wo.completed_date ? t('workOrders.detail.completedOn', { date: new Date(wo.completed_date).toLocaleDateString('th-TH') }) : t('workOrders.detail.completed')}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              {wo.status === 'IN_PROGRESS' && (
                <button onClick={() => { onStatusChange(wo.id, 'ON_HOLD'); onClose() }}
                  className="px-4 py-2 border border-warning/30 text-warning rounded-lg hover:bg-[var(--warning-soft)] flex items-center gap-2">
                  <Pause className="w-4 h-4" /> {t('workOrders.detail.putOnHold')}
                </button>
              )}
              {wo.status === 'ON_HOLD' && (
                <button onClick={() => { onStatusChange(wo.id, 'IN_PROGRESS'); onClose() }}
                  className="px-4 py-2 border border-warning/30 text-warning rounded-lg hover:bg-[var(--warning-soft)] flex items-center gap-2">
                  <Play className="w-4 h-4" /> {t('workOrders.detail.resume')}
                </button>
              )}
              {wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                <button onClick={() => { onStatusChange(wo.id, 'CANCELLED'); onClose() }}
                  className="px-4 py-2 border border-danger/30 text-danger rounded-lg hover:bg-[var(--danger-soft)]">
                  {t('workOrders.detail.cancelOrder')}
                </button>
              )}
              {next && (
                <button onClick={() => { onStatusChange(wo.id, next.status); onClose() }}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${next.color}`}>
                  <ArrowRight className="w-4 h-4" />
                  {next.label}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>

      <AddSubcontractModal open={showAddContract} workOrderId={wo.id}
        onClose={() => setShowAddContract(false)} onSaved={() => loadContracts(wo.id)} />
      <PaySubcontractModal contract={payingContract}
        onClose={() => setPayingContract(null)} onPaid={() => loadContracts(wo.id)} />
      <IssueMaterialsModal contract={issuingContract}
        onClose={() => setIssuingContract(null)} onSaved={() => loadContracts(wo.id)} />
      <ReceiveGoodsModal contract={receivingContract}
        onClose={() => setReceivingContract(null)} onSaved={() => loadContracts(wo.id)} />
      <ReconcileModal contract={reconcileContract} onClose={() => setReconcileContract(null)} />
    </AnimatePresence>
  )
}

function AddSubcontractModal({ open, workOrderId, onClose, onSaved }: {
  open: boolean; workOrderId: string; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [contractType, setContractType] = useState<'PIECE_RATE' | 'OUTSOURCE'>('PIECE_RATE')
  const [ratePerUnit, setRatePerUnit] = useState<number>(0)
  const [agreedQty, setAgreedQty] = useState<number>(0)
  const [whtRate, setWhtRate] = useState<number>(3)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get('/suppliers').then(res => {
      const list: any[] = res.data?.data || []
      list.sort((a, b) => (a.type === 'SERVICE' ? -1 : 0) - (b.type === 'SERVICE' ? -1 : 0))
      setSuppliers(list)
    }).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) {
      setSupplierId(''); setContractType('PIECE_RATE'); setRatePerUnit(0); setAgreedQty(0); setWhtRate(3); setDueDate(''); setNotes('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId || ratePerUnit <= 0 || agreedQty <= 0) return
    setSaving(true)
    try {
      await subcontractService.create({
        work_order_id: workOrderId,
        supplier_id: supplierId,
        contract_type: contractType,
        rate_per_unit: ratePerUnit,
        agreed_qty: agreedQty,
        wht_rate: whtRate,
        due_date: dueDate || undefined,
        notes,
      })
      onSaved(); onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.subcontract.createFailed'))
    } finally { setSaving(false) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-md">
            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
              <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.subcontract.addTitle')}</h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.typeLabel')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setContractType('PIECE_RATE')}
                    className={`px-3 py-2 rounded-lg border text-xs flex flex-col items-center gap-0.5 ${
                      contractType === 'PIECE_RATE' ? 'border-phopy-indigo bg-phopy-indigo/10 text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)]'
                    }`}>
                    <span className="font-semibold">{t('workOrders.subcontract.typePieceRate')}</span>
                    <span className="text-[10px] text-[var(--fg-4)]">{t('workOrders.subcontract.typePieceRateDesc')}</span>
                  </button>
                  <button type="button" onClick={() => setContractType('OUTSOURCE')}
                    className={`px-3 py-2 rounded-lg border text-xs flex flex-col items-center gap-0.5 ${
                      contractType === 'OUTSOURCE' ? 'border-phopy-indigo bg-phopy-indigo/10 text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)]'
                    }`}>
                    <span className="font-semibold">{t('workOrders.subcontract.typeOutsource')}</span>
                    <span className="text-[10px] text-[var(--fg-4)]">{t('workOrders.subcontract.typeOutsourceDesc')}</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.supplierLabel')}</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="phopy-input w-full" required>
                  <option value="">{t('workOrders.subcontract.selectSupplier')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.type === 'SERVICE' ? ` (${t('workOrders.subcontract.serviceType')})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.rateLabel')}</label>
                  <input type="number" min="0" step="0.01" value={ratePerUnit}
                    onChange={(e) => setRatePerUnit(Number(e.target.value))} className="phopy-input w-full" required />
                </div>
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.agreedQtyLabel')}</label>
                  <input type="number" min="1" value={agreedQty}
                    onChange={(e) => setAgreedQty(Number(e.target.value))} className="phopy-input w-full" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.whtRateLabel')}</label>
                  <input type="number" min="0" max="100" step="0.5" value={whtRate}
                    onChange={(e) => setWhtRate(Number(e.target.value))} className="phopy-input w-full" />
                </div>
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.dueDateLabel')}</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="phopy-input w-full" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('common.notes')}</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="phopy-input w-full text-sm" rows={2} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {t('common.save')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PaySubcontractModal({ contract, onClose, onPaid }: {
  contract: Subcontract | null; onClose: () => void; onPaid: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [method, setMethod] = useState<'CASH' | 'BANK'>('BANK')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setMethod('BANK') }, [contract?.id])

  if (!contract) return null
  const outstanding = Math.max(0, Math.round((contract.labor_amount - contract.paid_amount) * 100) / 100)
  const whtAmount = Math.round(outstanding * (contract.wht_rate || 0)) / 100
  const netAmount = Math.round((outstanding - whtAmount) * 100) / 100

  const handlePay = async () => {
    setSaving(true)
    try {
      await subcontractService.pay(contract.id, { payment_method: method })
      onPaid(); onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.subcontract.payFailed'))
    } finally { setSaving(false) }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-sm">
          <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
            <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.subcontract.payTitle')}</h2>
            <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-[var(--fg-3)]">{contract.contract_number} — {contract.supplier_name}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setMethod('CASH')}
                className={`flex-1 py-2 rounded-lg border text-sm flex items-center justify-center gap-1.5 ${
                  method === 'CASH' ? 'border-phopy-indigo bg-phopy-indigo/10 text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)]'
                }`}>
                <Banknote className="w-4 h-4" /> {t('workOrders.subcontract.cash')}
              </button>
              <button type="button" onClick={() => setMethod('BANK')}
                className={`flex-1 py-2 rounded-lg border text-sm flex items-center justify-center gap-1.5 ${
                  method === 'BANK' ? 'border-phopy-indigo bg-phopy-indigo/10 text-[var(--primary)]' : 'border-[var(--border)] text-[var(--fg-3)]'
                }`}>
                <Landmark className="w-4 h-4" /> {t('workOrders.subcontract.bank')}
              </button>
            </div>
            <div className="bg-[var(--surface-2)] rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--fg-4)]">{t('workOrders.subcontract.outstanding')}</span>
                <span className="text-[var(--fg-2)]">฿{outstanding.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--fg-4)]">{t('workOrders.subcontract.whtDeduct', { rate: contract.wht_rate })}</span>
                <span className="text-danger">-฿{whtAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-[var(--border)]/30 pt-1">
                <span className="text-[var(--fg-2)]">{t('workOrders.subcontract.netPay')}</span>
                <span className="text-success">฿{netAmount.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={handlePay} disabled={saving || outstanding <= 0}
                className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                {t('workOrders.subcontract.confirmPay')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Phase 3: ส่งวัตถุดิบให้ผู้รับเหมา (OUTSOURCE)
function IssueMaterialsModal({ contract, onClose, onSaved }: {
  contract: Subcontract | null; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [stockItems, setStockItems] = useState<any[]>([])
  const [rows, setRows] = useState<Array<{ stock_item_id: string; quantity: number }>>([{ stock_item_id: '', quantity: 0 }])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!contract) return
    api.get('/stock').then(res => setStockItems(res.data?.data || [])).catch(() => setStockItems([]))
    setRows([{ stock_item_id: '', quantity: 0 }])
  }, [contract?.id])

  if (!contract) return null

  const updateRow = (i: number, patch: Partial<{ stock_item_id: string; quantity: number }>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  const addRow = () => setRows(prev => [...prev, { stock_item_id: '', quantity: 0 }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const items = rows.filter(r => r.stock_item_id && r.quantity > 0)
    if (items.length === 0) return
    setSaving(true)
    try {
      await subcontractService.issueMaterials(contract.id, { items })
      onSaved(); onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.subcontract.issueFailed'))
    } finally { setSaving(false) }
  }

  return (
    <AnimatePresence>
      {contract && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
              <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.subcontract.issueMaterialsTitle')}</h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3">
              <p className="text-sm text-[var(--fg-3)]">{contract.contract_number} — {contract.supplier_name}</p>
              <div className="space-y-2">
                {rows.map((row, i) => {
                  const selected = stockItems.find(s => s.id === row.stock_item_id)
                  return (
                    <div key={i} className="flex gap-2 items-start">
                      <select value={row.stock_item_id} onChange={(e) => updateRow(i, { stock_item_id: e.target.value })}
                        className="phopy-input flex-1 text-sm">
                        <option value="">{t('workOrders.subcontract.selectItem')}</option>
                        {stockItems.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.quantity} {s.unit})</option>
                        ))}
                      </select>
                      <input type="number" min="0" step="0.01" value={row.quantity || ''}
                        onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                        placeholder={t('workOrders.subcontract.quantity')}
                        className="phopy-input w-28 text-sm" />
                      <button type="button" onClick={() => removeRow(i)} disabled={rows.length <= 1}
                        className="p-2 text-danger disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                      {selected && row.quantity > selected.quantity && (
                        <span className="sr-only">{t('workOrders.subcontract.insufficientStock')}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={addRow}
                className="text-xs text-[var(--primary)] flex items-center gap-1"><Plus className="w-3 h-3" /> {t('workOrders.subcontract.addItem')}</button>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                  {t('common.save')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Phase 3: รับของกลับจากผู้รับเหมา (OUTSOURCE) + เคลียร์วัตถุดิบนอกบริษัท
function ReceiveGoodsModal({ contract, onClose, onSaved }: {
  contract: Subcontract | null; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [receivedQty, setReceivedQty] = useState<number>(0)
  const [scrapQty, setScrapQty] = useState<number>(0)
  const [shortageQty, setShortageQty] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [materialRows, setMaterialRows] = useState<Array<{
    stock_item_id: string; item_name: string; unit: string; outstanding: number
    consumed_qty: number; returned_qty: number; shortage_qty: number
  }>>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!contract) return
    setReceivedQty(0); setScrapQty(0); setShortageQty(0); setNotes('')
    setLoading(true)
    subcontractService.getSubconStock()
      .then(({ rows }) => {
        const forSupplier = rows.filter(r => r.supplier_id === contract.supplier_id)
        setMaterialRows(forSupplier.map(r => ({
          stock_item_id: r.stock_item_id, item_name: r.item_name, unit: r.unit, outstanding: r.quantity,
          consumed_qty: 0, returned_qty: 0, shortage_qty: 0,
        })))
      })
      .catch(() => setMaterialRows([]))
      .finally(() => setLoading(false))
  }, [contract?.id])

  if (!contract) return null

  const updateMaterial = (i: number, patch: Partial<{ consumed_qty: number; returned_qty: number; shortage_qty: number }>) => {
    setMaterialRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const materials = materialRows
        .filter(r => (r.consumed_qty + r.returned_qty + r.shortage_qty) > 0)
        .map(r => ({ stock_item_id: r.stock_item_id, consumed_qty: r.consumed_qty, returned_qty: r.returned_qty, shortage_qty: r.shortage_qty }))
      await subcontractService.receiveGoods(contract.id, {
        received_qty: receivedQty, scrap_qty: scrapQty, shortage_qty: shortageQty, materials, notes,
      })
      onSaved(); onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || t('workOrders.subcontract.receiveFailed'))
    } finally { setSaving(false) }
  }

  return (
    <AnimatePresence>
      {contract && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
              <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.subcontract.receiveGoodsTitle')}</h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <p className="text-sm text-[var(--fg-3)]">{contract.contract_number} — {contract.supplier_name}</p>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.receivedQty')}</label>
                  <input type="number" min="0" value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} className="phopy-input w-full" />
                </div>
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.scrapQty')}</label>
                  <input type="number" min="0" value={scrapQty} onChange={(e) => setScrapQty(Number(e.target.value))} className="phopy-input w-full" />
                </div>
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.subcontract.shortageQty')}</label>
                  <input type="number" min="0" value={shortageQty} onChange={(e) => setShortageQty(Number(e.target.value))} className="phopy-input w-full" />
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-[var(--fg-2)] mb-2">{t('workOrders.subcontract.materialsReconcileTitle')}</p>
                {loading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[var(--primary)]" /></div>
                ) : materialRows.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)]">{t('workOrders.subcontract.noMaterials')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          {[t('workOrders.subcontract.item'), t('workOrders.subcontract.outstandingAtSupplier'), t('workOrders.subcontract.consumedQty'), t('workOrders.subcontract.returnedQty'), t('workOrders.subcontract.materialShortageQty')].map(h => (
                            <th key={h} className="text-left text-[var(--fg-3)] py-1.5 pr-2 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {materialRows.map((r, i) => (
                          <tr key={r.stock_item_id} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-1.5 pr-2 text-[var(--fg-1)]">{r.item_name}</td>
                            <td className="py-1.5 pr-2 text-[var(--fg-2)]">{r.outstanding} {r.unit}</td>
                            <td className="py-1.5 pr-2">
                              <input type="number" min="0" value={r.consumed_qty || ''} onChange={(e) => updateMaterial(i, { consumed_qty: Number(e.target.value) })} className="phopy-input w-20 text-xs" />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="number" min="0" value={r.returned_qty || ''} onChange={(e) => updateMaterial(i, { returned_qty: Number(e.target.value) })} className="phopy-input w-20 text-xs" />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="number" min="0" value={r.shortage_qty || ''} onChange={(e) => updateMaterial(i, { shortage_qty: Number(e.target.value) })} className="phopy-input w-20 text-xs" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('common.notes')}</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="phopy-input w-full text-sm" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
                  {t('common.save')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Phase 3: ดู Reconcile ต่อสัญญา OUTSOURCE
function ReconcileModal({ contract, onClose }: { contract: Subcontract | null; onClose: () => void }) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!contract) { setData(null); return }
    setLoading(true)
    subcontractService.getReconcile(contract.id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [contract?.id])

  if (!contract) return null

  return (
    <AnimatePresence>
      {contract && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
              <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.subcontract.reconcileTitle')}</h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--fg-3)]">{contract.contract_number} — {contract.supplier_name}</p>
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" /></div>
              ) : !data ? (
                <p className="text-sm text-[var(--fg-4)]">{t('workOrders.subcontract.noMaterials')}</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: t('workOrders.subcontract.agreed'), value: data.pieces.agreed_qty },
                      { label: t('workOrders.subcontract.received'), value: data.pieces.received_qty },
                      { label: t('workOrders.subcontract.scrapQty'), value: data.pieces.scrap_qty },
                      { label: t('workOrders.subcontract.shortageQty'), value: data.pieces.shortage_qty },
                    ].map((k) => (
                      <div key={k.label} className="bg-[var(--surface-2)] rounded-lg p-3">
                        <p className="text-xs text-[var(--fg-4)]">{k.label}</p>
                        <p className="text-lg font-bold text-[var(--fg-1)]">{k.value}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-[var(--fg-2)] mb-2">{t('workOrders.subcontract.materialsReconcileTitle')}</p>
                    {data.materials.length === 0 ? (
                      <p className="text-xs text-[var(--fg-4)]">{t('workOrders.subcontract.noMaterials')}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-[var(--border)]">
                              {[t('workOrders.subcontract.item'), t('workOrders.subcontract.issuedQty'), t('workOrders.subcontract.consumedQty'), t('workOrders.subcontract.returnedQty'), t('workOrders.subcontract.materialShortageQty'), t('workOrders.subcontract.outstandingQty')].map(h => (
                                <th key={h} className="text-left text-[var(--fg-3)] py-1.5 pr-3 font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.materials.map((m: any) => (
                              <tr key={m.stock_item_id} className="border-b border-[var(--border)] last:border-0">
                                <td className="py-1.5 pr-3 text-[var(--fg-1)]">{m.item_name}</td>
                                <td className="py-1.5 pr-3 text-[var(--fg-2)]">{m.issued_qty} {m.unit}</td>
                                <td className="py-1.5 pr-3 text-[var(--fg-2)]">{m.consumed_qty}</td>
                                <td className="py-1.5 pr-3 text-[var(--fg-2)]">{m.returned_qty}</td>
                                <td className="py-1.5 pr-3 text-[var(--fg-2)]">{m.shortage_qty}</td>
                                <td className="py-1.5 font-semibold" style={{ color: m.outstanding_qty > 0 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)' }}>{m.outstanding_qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="flex justify-end pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                  {t('common.close')}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default WorkOrders
