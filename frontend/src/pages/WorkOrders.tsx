import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Search,
  Eye,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  Clock,
  Play,
  Pause,
  FileText,
  ArrowRight,
  AlertTriangle,
  ShoppingCart,
  PackageCheck,
} from 'lucide-react'
import workOrderService, { WorkOrder, WOStats } from '../services/workOrder'
import api from '../services/api'
import { useModalClose } from '../hooks/useModalClose'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  DRAFT: { label: 'Draft', color: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]', icon: FileText },
  PLANNED: { label: 'Planned', color: 'bg-[var(--info-soft)] text-blue-400 border-info/30', icon: Clock },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: Play },
  ON_HOLD: { label: 'On Hold', color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: Pause },
  COMPLETED: { label: 'Completed', color: 'bg-[var(--success-soft)] text-success border-success/30', icon: CheckCircle },
  CANCELLED: { label: 'Cancelled', color: 'bg-[var(--danger-soft)] text-danger border-danger/30', icon: X },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  URGENT: { label: 'Urgent', color: 'text-danger bg-[var(--danger-soft)] border-danger/30' },
  HIGH: { label: 'High', color: 'text-warning bg-[var(--warning-soft)] border-warning/30' },
  NORMAL: { label: 'Normal', color: 'text-blue-400 bg-[var(--info-soft)] border-info/30' },
  LOW: { label: 'Low', color: 'text-[var(--fg-3)] bg-[var(--surface-sunken)] border-[var(--border-strong)]' },
}

function WorkOrders() {
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
      alert(err.response?.data?.message || 'Failed to update status')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this work order?')) return
    try {
      await workOrderService.delete(id)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete')
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
            <span className="text-[var(--fg-1)]">Work Orders</span>
          </h1>
          <p className="text-[var(--fg-3)]">จัดการใบสั่งผลิตและติดตามสถานะ</p>
        </div>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreateModal(true)} className="phopy-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" /> Create Work Order
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard label="Total WOs" value={(stats?.totalOrders ?? 0).toString()} color="text-[var(--primary)]" />
        <StatCard label="Planned" value={(stats?.planned ?? 0).toString()} color="text-blue-400" />
        <StatCard label="In Progress" value={(stats?.inProgress ?? 0).toString()} color="text-warning" />
        <StatCard label="Completed" value={(stats?.completed ?? 0).toString()} color="text-success" />
        <StatCard label="Total Produced" value={(stats?.totalProduced ?? 0).toLocaleString()} color="text-purple-500" />
      </div>

      {/* Filters */}
      <div className="phopy-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
            <input type="text" placeholder="Search WO number, product, or assignee..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="phopy-input pl-10 w-full" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  statusFilter === s ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)]'
                }`}>
                {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
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
                <th>WO Number</th>
                <th>Product</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Quantity</th>
                <th>Progress</th>
                <th>Due Date</th>
                <th>Assigned To</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-[var(--fg-4)]">No work orders found</td></tr>
              ) : (
                filtered.map((wo, i) => {
                  const statusConf = STATUS_CONFIG[wo.status] || STATUS_CONFIG.DRAFT
                  const priorityConf = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.NORMAL
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
                          <p className="text-[var(--fg-4)] text-xs">{wo.material_count || 0} materials</p>
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
                            {wo.due_date ? new Date(wo.due_date).toLocaleDateString() : '-'}
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
                              className="p-2 text-[var(--fg-3)] hover:text-blue-400 hover:bg-blue-400/10 rounded-lg" title="Plan">
                              <Clock className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'PLANNED' && (
                            <button onClick={() => handleStatusChange(wo.id, 'IN_PROGRESS')}
                              className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg" title="Start Production">
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'IN_PROGRESS' && (
                            <button onClick={() => handleStatusChange(wo.id, 'COMPLETED')}
                              className="p-2 text-[var(--fg-3)] hover:text-success hover:bg-success/10 rounded-lg" title="Mark Complete">
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

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="phopy-card p-4">
      <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function CreateWOModal({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: () => void
}) {
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
        reason: `ขาดวัตถุดิบสำหรับผลิต: ${productName} จำนวน ${quantity} หน่วย`,
        items,
      })
      alert(`สร้าง Purchase Request สำเร็จ — ${items.length} รายการ`)
    } catch (err: any) {
      alert(err.response?.data?.message || 'ไม่สามารถสร้าง PR ได้')
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
      alert(err.response?.data?.message || 'Failed to create work order')
    } finally { setSaving(false) }
  }

  const selectedBom = boms.find(b => b.id === selectedBomId)
  const priorityOptions = [
    { value: 'LOW', label: 'Low', color: 'text-[var(--fg-3)] border-[var(--border-strong)] hover:border-[var(--border)]' },
    { value: 'NORMAL', label: 'Normal', color: 'text-blue-400 border-info/30 hover:border-blue-400' },
    { value: 'HIGH', label: 'High', color: 'text-warning border-warning/30 hover:border-orange-400' },
    { value: 'URGENT', label: 'Urgent', color: 'text-danger border-danger/30 hover:border-red-400' },
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
                <h2 className="text-lg font-bold text-[var(--fg-1)]">Create Work Order</h2>
                <p className="text-xs text-[var(--fg-4)] mt-0.5">เลือก BOM เพื่อ auto-fill วัตถุดิบ</p>
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
                      เลือก BOM
                    </p>
                    <button type="button" onClick={() => { setManualMode(true); setSelectedBomId(''); setProductName(''); setMaterials([]) }}
                      className={`text-xs px-2 py-1 rounded border transition-all ${manualMode ? 'border-phopy-indigo/50 text-[var(--primary)] bg-phopy-indigo/10' : 'border-[var(--border)] text-[var(--fg-4)] hover:text-[var(--fg-2)]'}`}>
                      Manual entry
                    </button>
                  </div>

                  {!manualMode ? (
                    <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                      {boms.length === 0 ? (
                        <div className="col-span-2 text-center py-6 text-[var(--fg-4)] text-sm bg-[var(--surface-2)] rounded-lg">
                          ยังไม่มี BOM — ใช้ Manual entry แทน
                        </div>
                      ) : boms.map((bom) => (
                        <button key={bom.id} type="button" onClick={() => handleBomSelect(bom)}
                          className={`text-left p-3 rounded-lg border transition-all ${
                            selectedBomId === bom.id
                              ? 'border-phopy-indigo bg-phopy-indigo/10'
                              : 'border-[var(--border)]/40 bg-[var(--surface-2)] hover:border-[var(--border)] hover:bg-[var(--surface-2)]'
                          }`}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium text-[var(--fg-2)] leading-tight">{bom.product_name}</p>
                            {selectedBomId === bom.id && <CheckCircle className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />}
                          </div>
                          <p className="text-xs text-[var(--fg-4)] mt-0.5">{bom.product_code} · v{bom.version}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${
                              bom.status?.toUpperCase() === 'ACTIVE'
                                ? 'bg-success/10 text-success border-success-soft'
                                : 'bg-gray-500/10 text-[var(--fg-4)] border-gray-500/20'
                            }`}>{bom.status}</span>
                            {bom.is_semi_finished === 1 && (
                              <span className="text-xs text-purple-500">Semi-finished</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]/30 text-sm text-[var(--fg-3)]">
                      กรอกข้อมูลเองด้านล่าง
                    </div>
                  )}
                </div>

                {/* STEP 2: Details */}
                <div>
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5 mb-3">
                    <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">2</span>
                    รายละเอียด
                  </p>

                  <div className="space-y-3">
                    {/* Product + Qty side by side */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">ชื่อสินค้า *</label>
                        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                          className="phopy-input w-full" placeholder="ชื่อสินค้าที่ผลิต" required
                          readOnly={!!selectedBomId && !manualMode}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">จำนวนผลิต *</label>
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
                      <label className="text-xs text-[var(--fg-4)] mb-1.5 block">Priority</label>
                      <div className="flex gap-2">
                        {priorityOptions.map(opt => (
                          <button key={opt.value} type="button" onClick={() => setPriority(opt.value)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                              priority === opt.value
                                ? `${opt.color} bg-current/10`.replace('text-', 'bg-').replace('/10 bg-current/10', '/15 ') + opt.color
                                : 'border-[var(--border)]/30 text-[var(--fg-4)] hover:text-[var(--fg-2)]'
                            } ${priority === opt.value ? opt.color + ' border-current/40' : ''}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Due date + Assigned */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">วันกำหนดเสร็จ</label>
                        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="phopy-input w-full" />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">ผู้รับผิดชอบ</label>
                        <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                          className="phopy-input w-full" placeholder="ทีม / ชื่อ" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 3: Materials */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">3</span>
                      วัตถุดิบที่ต้องใช้
                      {(bomLoading || stockChecking) && <Loader2 className="w-3 h-3 animate-spin text-[var(--primary)]" />}
                    </p>
                    <button type="button"
                      onClick={() => setMaterials([...materials, { materialName: '', requiredQty: 1, unit: 'pcs' }])}
                      className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">
                      <Plus className="w-3 h-3" /> เพิ่ม
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
                        <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> ขาดวัตถุดิบ {shortages.length} รายการ — กดปุ่ม "สร้าง PR" ด้านล่างเพื่อสั่งซื้ออัตโนมัติ</>
                      ) : (
                        <><PackageCheck className="w-3.5 h-3.5 shrink-0" /> วัตถุดิบเพียงพอสำหรับการผลิตนี้ทั้งหมด</>
                      )}
                    </div>
                  )}

                  {materials.length === 0 ? (
                    <div className="text-center py-5 bg-[var(--surface-2)] rounded-lg border border-dashed border-[var(--border)]/40">
                      <p className="text-xs text-[var(--fg-4)]">
                        {selectedBomId ? (bomLoading ? 'กำลังโหลด...' : 'BOM นี้ไม่มี raw materials') : 'เลือก BOM เพื่อ auto-fill หรือกด "+ เพิ่ม"'}
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
                              placeholder="ชื่อวัตถุดิบ" />
                            <input type="number" value={mat.requiredQty} onChange={(e) => {
                              const u = [...materials]; u[idx].requiredQty = Number(e.target.value); setMaterials(u)
                            }} className="w-20 bg-transparent text-sm text-success text-right outline-none border-b border-[var(--border)]/30 focus:border-phopy-indigo"
                              min="0.001" step="any" />
                            <input value={mat.unit} onChange={(e) => {
                              const u = [...materials]; u[idx].unit = e.target.value; setMaterials(u)
                            }} className="w-12 bg-transparent text-xs text-[var(--fg-4)] outline-none border-b border-[var(--border)]/30 focus:border-phopy-indigo"
                              placeholder="unit" />
                            {/* Stock status badge */}
                            {mat.materialId && (() => {
                              if (stockChecking) return <Loader2 key="spin" className="w-3 h-3 animate-spin text-[var(--fg-4)] shrink-0" />
                              if (!ss || ss.type === 'unknown') return <span key="unk" className="text-xs text-[var(--fg-4)] shrink-0 w-16 text-right">?</span>
                              if (ss.type === 'ok') return <span key="ok" className="text-xs text-success shrink-0 w-16 text-right font-medium">✓ {ss.stockQty} {ss.unit}</span>
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
                      <p className="text-xs text-[var(--fg-4)] text-right">{materials.length} รายการ</p>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-[var(--fg-4)] mb-1 block">หมายเหตุ</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    className="phopy-input w-full text-sm" rows={2} placeholder="หมายเหตุหรือคำสั่งพิเศษ..." />
                </div>
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-[var(--border)] shrink-0 space-y-3">
                {/* Auto-PR row — shown only when shortages exist */}
                {shortages.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2.5 bg-[var(--danger-soft)] border border-danger/20 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-danger">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>ขาดวัตถุดิบ <strong>{shortages.length}</strong> รายการ</span>
                    </div>
                    <button type="button" onClick={handleCreateAutoPR} disabled={creatingPR}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-danger text-white rounded-lg hover:bg-danger/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                      {creatingPR ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                      สร้าง Purchase Request อัตโนมัติ
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--fg-4)]">
                    {selectedBom ? (
                      <span className="flex items-center gap-1 text-[var(--primary)]">
                        <CheckCircle className="w-3 h-3" /> ใช้ BOM: {selectedBom.product_name}
                      </span>
                    ) : manualMode ? 'Manual entry' : 'ยังไม่ได้เลือก BOM'}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)]">
                      ยกเลิก
                    </button>
                    <button type="submit" disabled={saving || bomLoading || !productName.trim()}
                      className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      สร้าง Work Order
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
  useModalClose(onClose)
  if (!wo) return null
  const statusConf = STATUS_CONFIG[wo.status] || STATUS_CONFIG.DRAFT
  const priorityConf = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.NORMAL
  const progress = wo.quantity > 0 ? Math.round((wo.completed_qty / wo.quantity) * 100) : 0

  const nextStatus: Record<string, { label: string; status: string; color: string }> = {
    DRAFT: { label: 'Plan Production', status: 'PLANNED', color: 'bg-blue-500 text-white' },
    PLANNED: { label: 'Start Production', status: 'IN_PROGRESS', color: 'bg-yellow-500 text-black' },
    IN_PROGRESS: { label: 'Mark Complete', status: 'COMPLETED', color: 'bg-success text-black' },
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
              {['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED'].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`px-3 py-1 rounded-full whitespace-nowrap ${
                    wo.status === s ? STATUS_CONFIG[s].color + ' font-semibold'
                    : ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED'].indexOf(wo.status) > i
                    ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'
                  }`}>
                    {STATUS_CONFIG[s].label}
                  </div>
                  {i < 3 && <ArrowRight className="w-4 h-4 text-[var(--fg-4)] flex-shrink-0" />}
                </div>
              ))}
            </div>

            {/* Progress */}
            <div className="bg-[var(--surface-2)] p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[var(--fg-3)] text-sm">Production Progress</span>
                <span className="text-[var(--fg-2)] font-semibold">{wo.completed_qty} / {wo.quantity} units ({progress}%)</span>
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
                <p className="text-xs text-[var(--fg-4)] mb-1">Assigned To</p>
                <p className="text-[var(--fg-2)]">{wo.assigned_to || '-'}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">Due Date</p>
                <p className="text-[var(--fg-2)]">{wo.due_date ? new Date(wo.due_date).toLocaleDateString() : '-'}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">Estimated Cost</p>
                <p className="text-success font-semibold">฿{wo.estimated_cost.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--surface-2)] p-3 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">Actual Cost</p>
                <p className="text-[var(--fg-2)]">฿{wo.actual_cost.toLocaleString()}</p>
              </div>
            </div>

            {/* Materials */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3">Materials Required</h3>
              {wo.materials && wo.materials.length > 0 ? (
                <div className="space-y-2">
                  {wo.materials.map((mat) => (
                    <div key={mat.id} className="flex justify-between items-center p-3 bg-[var(--surface-2)] rounded-lg">
                      <div>
                        <p className="text-[var(--fg-2)]">{mat.material_name || 'Material'}</p>
                        <p className="text-[var(--fg-4)] text-xs">
                          Issued: {mat.issued_qty}/{mat.required_qty} {mat.unit}
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
                <p className="text-[var(--fg-4)]">No materials linked</p>
              )}
            </div>

            {/* Notes */}
            {wo.notes && (
              <div className="bg-[var(--surface-2)] p-4 rounded-lg">
                <p className="text-xs text-[var(--fg-4)] mb-1">Notes</p>
                <p className="text-[var(--fg-2)] text-sm">{wo.notes}</p>
              </div>
            )}

            {wo.status === 'COMPLETED' && (
              <div className="p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-success" />
                <div>
                  <p className="text-success font-medium">Production Complete</p>
                  <p className="text-[var(--fg-3)] text-sm">
                    {wo.completed_date ? `Completed on ${new Date(wo.completed_date).toLocaleDateString()}` : 'Completed'}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              {wo.status === 'IN_PROGRESS' && (
                <button onClick={() => { onStatusChange(wo.id, 'ON_HOLD'); onClose() }}
                  className="px-4 py-2 border border-warning/30 text-warning rounded-lg hover:bg-[var(--warning-soft)] flex items-center gap-2">
                  <Pause className="w-4 h-4" /> Put On Hold
                </button>
              )}
              {wo.status === 'ON_HOLD' && (
                <button onClick={() => { onStatusChange(wo.id, 'IN_PROGRESS'); onClose() }}
                  className="px-4 py-2 border border-warning/30 text-warning rounded-lg hover:bg-[var(--warning-soft)] flex items-center gap-2">
                  <Play className="w-4 h-4" /> Resume
                </button>
              )}
              {wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                <button onClick={() => { onStatusChange(wo.id, 'CANCELLED'); onClose() }}
                  className="px-4 py-2 border border-danger/30 text-danger rounded-lg hover:bg-[var(--danger-soft)]">
                  Cancel Order
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
    </AnimatePresence>
  )
}

export default WorkOrders
