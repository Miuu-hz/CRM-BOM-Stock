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
} from 'lucide-react'
import workOrderService, { WorkOrder, WOStats } from '../services/workOrder'
import api from '../services/api'
import { useModalClose } from '../hooks/useModalClose'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: FileText },
  PLANNED: { label: 'Planned', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Clock },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Play },
  ON_HOLD: { label: 'On Hold', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: Pause },
  COMPLETED: { label: 'Completed', color: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30', icon: CheckCircle },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: X },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  URGENT: { label: 'Urgent', color: 'text-red-400 bg-red-500/20 border-red-500/30' },
  HIGH: { label: 'High', color: 'text-orange-400 bg-orange-500/20 border-orange-500/30' },
  NORMAL: { label: 'Normal', color: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
  LOW: { label: 'Low', color: 'text-gray-400 bg-gray-500/20 border-gray-500/30' },
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
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-cyber-primary animate-spin" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">
            <span className="neon-text">Work Orders</span>
          </h1>
          <p className="text-gray-400">จัดการใบสั่งผลิตและติดตามสถานะ</p>
        </div>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreateModal(true)} className="cyber-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" /> Create Work Order
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard label="Total WOs" value={(stats?.totalOrders ?? 0).toString()} color="text-cyber-primary" />
        <StatCard label="Planned" value={(stats?.planned ?? 0).toString()} color="text-blue-400" />
        <StatCard label="In Progress" value={(stats?.inProgress ?? 0).toString()} color="text-yellow-400" />
        <StatCard label="Completed" value={(stats?.completed ?? 0).toString()} color="text-cyber-green" />
        <StatCard label="Total Produced" value={(stats?.totalProduced ?? 0).toLocaleString()} color="text-cyber-purple" />
      </div>

      {/* Filters */}
      <div className="cyber-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search WO number, product, or assignee..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="cyber-input pl-10 w-full" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  statusFilter === s ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                    : 'bg-cyber-darker text-gray-400 border border-cyber-border'
                }`}>
                {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* WO List */}
      <div className="cyber-card p-6">
        <div className="overflow-x-auto">
          <table className="cyber-table">
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
                <tr><td colSpan={9} className="text-center py-8 text-gray-500">No work orders found</td></tr>
              ) : (
                filtered.map((wo, i) => {
                  const statusConf = STATUS_CONFIG[wo.status] || STATUS_CONFIG.DRAFT
                  const priorityConf = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.NORMAL
                  const progress = wo.quantity > 0 ? Math.round((wo.completed_qty / wo.quantity) * 100) : 0
                  const isOverdue = wo.due_date && new Date(wo.due_date) < new Date() && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'

                  return (
                    <motion.tr key={wo.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                      <td>
                        <span className="text-cyber-primary font-mono font-semibold">{wo.wo_number}</span>
                      </td>
                      <td>
                        <div>
                          <p className="text-gray-200">{wo.product_name || '-'}</p>
                          <p className="text-gray-500 text-xs">{wo.material_count || 0} materials</p>
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
                      <td><span className="text-gray-400">{wo.completed_qty}/{wo.quantity}</span></td>
                      <td>
                        <div className="w-24">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-cyber-darker rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              progress === 100 ? 'bg-cyber-green' : progress > 0 ? 'bg-cyber-primary' : 'bg-gray-600'
                            }`} style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          {isOverdue && <AlertTriangle className="w-3 h-3 text-red-400" />}
                          <span className={`text-sm ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
                            {wo.due_date ? new Date(wo.due_date).toLocaleDateString() : '-'}
                          </span>
                        </div>
                      </td>
                      <td><span className="text-gray-400 text-sm">{wo.assigned_to || '-'}</span></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleViewDetail(wo)}
                            className="p-2 text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10 rounded-lg">
                            <Eye className="w-4 h-4" />
                          </button>
                          {wo.status === 'DRAFT' && (
                            <button onClick={() => handleStatusChange(wo.id, 'PLANNED')}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg" title="Plan">
                              <Clock className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'PLANNED' && (
                            <button onClick={() => handleStatusChange(wo.id, 'IN_PROGRESS')}
                              className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg" title="Start Production">
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'IN_PROGRESS' && (
                            <button onClick={() => handleStatusChange(wo.id, 'COMPLETED')}
                              className="p-2 text-gray-400 hover:text-cyber-green hover:bg-cyber-green/10 rounded-lg" title="Mark Complete">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {wo.status === 'DRAFT' && (
                            <button onClick={() => handleDelete(wo.id)}
                              className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg">
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
    <div className="cyber-card p-4">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
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

  useEffect(() => {
    if (!open) return
    api.get('/bom').then(res => setBoms(res.data?.data || [])).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) {
      setProductName(''); setQuantity(1); setPriority('NORMAL')
      setDueDate(''); setAssignedTo(''); setNotes('')
      setMaterials([]); setSelectedBomId(''); setManualMode(false)
    }
  }, [open])

  const loadBomMaterials = async (bomId: string, qty: number) => {
    setBomLoading(true)
    try {
      const res = await api.get(`/bom/explode/${bomId}?multiplier=${qty}`)
      const data = res.data?.data
      if (data?.materials?.length > 0) {
        setMaterials(data.materials.map((m: any) => ({
          materialId: m.materialId,
          materialName: m.materialName || m.materialCode || '',
          requiredQty: Number(m.quantity.toFixed(4)),
          unit: m.unit || 'pcs',
        })))
      }
    } catch {}
    finally { setBomLoading(false) }
  }

  const handleBomSelect = async (bom: any) => {
    setSelectedBomId(bom.id)
    setProductName(bom.product_name || '')
    setManualMode(false)
    await loadBomMaterials(bom.id, quantity)
  }

  const handleQuantityChange = async (newQty: number) => {
    setQuantity(newQty)
    if (selectedBomId && newQty > 0) await loadBomMaterials(selectedBomId, newQty)
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
    { value: 'LOW', label: 'Low', color: 'text-gray-400 border-gray-500/30 hover:border-gray-400' },
    { value: 'NORMAL', label: 'Normal', color: 'text-blue-400 border-blue-500/30 hover:border-blue-400' },
    { value: 'HIGH', label: 'High', color: 'text-orange-400 border-orange-500/30 hover:border-orange-400' },
    { value: 'URGENT', label: 'Urgent', color: 'text-red-400 border-red-500/30 hover:border-red-400' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="cyber-card w-full max-w-2xl max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="p-5 border-b border-cyber-border flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-100">Create Work Order</h2>
                <p className="text-xs text-gray-500 mt-0.5">เลือก BOM เพื่อ auto-fill วัตถุดิบ</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg text-gray-400"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-5">

                {/* STEP 1: BOM Picker */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-cyber-primary/20 text-cyber-primary text-xs flex items-center justify-center font-bold">1</span>
                      เลือก BOM
                    </p>
                    <button type="button" onClick={() => { setManualMode(true); setSelectedBomId(''); setProductName(''); setMaterials([]) }}
                      className={`text-xs px-2 py-1 rounded border transition-all ${manualMode ? 'border-cyber-primary/50 text-cyber-primary bg-cyber-primary/10' : 'border-cyber-border text-gray-500 hover:text-gray-300'}`}>
                      Manual entry
                    </button>
                  </div>

                  {!manualMode ? (
                    <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                      {boms.length === 0 ? (
                        <div className="col-span-2 text-center py-6 text-gray-500 text-sm bg-cyber-darker rounded-lg">
                          ยังไม่มี BOM — ใช้ Manual entry แทน
                        </div>
                      ) : boms.map((bom) => (
                        <button key={bom.id} type="button" onClick={() => handleBomSelect(bom)}
                          className={`text-left p-3 rounded-lg border transition-all ${
                            selectedBomId === bom.id
                              ? 'border-cyber-primary bg-cyber-primary/10'
                              : 'border-cyber-border/40 bg-cyber-darker hover:border-cyber-border hover:bg-cyber-dark/50'
                          }`}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium text-gray-200 leading-tight">{bom.product_name}</p>
                            {selectedBomId === bom.id && <CheckCircle className="w-3.5 h-3.5 text-cyber-primary shrink-0 mt-0.5" />}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{bom.product_code} · v{bom.version}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${
                              bom.status?.toUpperCase() === 'ACTIVE'
                                ? 'bg-cyber-green/10 text-cyber-green border-cyber-green/20'
                                : 'bg-gray-500/10 text-gray-500 border-gray-500/20'
                            }`}>{bom.status}</span>
                            {bom.is_semi_finished === 1 && (
                              <span className="text-xs text-cyber-purple">Semi-finished</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-cyber-darker rounded-lg border border-cyber-border/30 text-sm text-gray-400">
                      กรอกข้อมูลเองด้านล่าง
                    </div>
                  )}
                </div>

                {/* STEP 2: Details */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                    <span className="w-4 h-4 rounded-full bg-cyber-primary/20 text-cyber-primary text-xs flex items-center justify-center font-bold">2</span>
                    รายละเอียด
                  </p>

                  <div className="space-y-3">
                    {/* Product + Qty side by side */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500 mb-1 block">ชื่อสินค้า *</label>
                        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                          className="cyber-input w-full" placeholder="ชื่อสินค้าที่ผลิต" required
                          readOnly={!!selectedBomId && !manualMode}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">จำนวนผลิต *</label>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => handleQuantityChange(Math.max(1, quantity - 1))}
                            className="w-8 h-9 flex items-center justify-center bg-cyber-darker border border-cyber-border rounded-lg text-gray-400 hover:text-gray-200 shrink-0">−</button>
                          <input type="number" value={quantity} onChange={(e) => handleQuantityChange(Number(e.target.value))}
                            className="cyber-input w-full text-center" min="1" required />
                          <button type="button" onClick={() => handleQuantityChange(quantity + 1)}
                            className="w-8 h-9 flex items-center justify-center bg-cyber-darker border border-cyber-border rounded-lg text-gray-400 hover:text-gray-200 shrink-0">+</button>
                        </div>
                      </div>
                    </div>

                    {/* Priority as button group */}
                    <div>
                      <label className="text-xs text-gray-500 mb-1.5 block">Priority</label>
                      <div className="flex gap-2">
                        {priorityOptions.map(opt => (
                          <button key={opt.value} type="button" onClick={() => setPriority(opt.value)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                              priority === opt.value
                                ? `${opt.color} bg-current/10`.replace('text-', 'bg-').replace('/10 bg-current/10', '/15 ') + opt.color
                                : 'border-cyber-border/30 text-gray-500 hover:text-gray-300'
                            } ${priority === opt.value ? opt.color + ' border-current/40' : ''}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Due date + Assigned */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">วันกำหนดเสร็จ</label>
                        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="cyber-input w-full" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">ผู้รับผิดชอบ</label>
                        <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                          className="cyber-input w-full" placeholder="ทีม / ชื่อ" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 3: Materials */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-cyber-primary/20 text-cyber-primary text-xs flex items-center justify-center font-bold">3</span>
                      วัตถุดิบที่ต้องใช้
                      {bomLoading && <Loader2 className="w-3 h-3 animate-spin text-cyber-primary" />}
                    </p>
                    <button type="button"
                      onClick={() => setMaterials([...materials, { materialName: '', requiredQty: 1, unit: 'pcs' }])}
                      className="text-xs text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1">
                      <Plus className="w-3 h-3" /> เพิ่ม
                    </button>
                  </div>

                  {materials.length === 0 ? (
                    <div className="text-center py-5 bg-cyber-darker rounded-lg border border-dashed border-cyber-border/40">
                      <p className="text-xs text-gray-500">
                        {selectedBomId ? (bomLoading ? 'กำลังโหลด...' : 'BOM นี้ไม่มี raw materials') : 'เลือก BOM เพื่อ auto-fill หรือกด "+ เพิ่ม"'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {materials.map((mat, idx) => (
                        <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                          mat.materialId ? 'border-cyber-primary/15 bg-cyber-primary/5' : 'border-cyber-border/20 bg-cyber-darker'
                        }`}>
                          {mat.materialId && <CheckCircle className="w-3.5 h-3.5 text-cyber-primary shrink-0" />}
                          <input value={mat.materialName} onChange={(e) => {
                            const u = [...materials]; u[idx].materialName = e.target.value; setMaterials(u)
                          }} className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder-gray-600 min-w-0"
                            placeholder="ชื่อวัตถุดิบ" />
                          <input type="number" value={mat.requiredQty} onChange={(e) => {
                            const u = [...materials]; u[idx].requiredQty = Number(e.target.value); setMaterials(u)
                          }} className="w-20 bg-transparent text-sm text-cyber-green text-right outline-none border-b border-cyber-border/30 focus:border-cyber-primary"
                            min="0.001" step="any" />
                          <input value={mat.unit} onChange={(e) => {
                            const u = [...materials]; u[idx].unit = e.target.value; setMaterials(u)
                          }} className="w-12 bg-transparent text-xs text-gray-500 outline-none border-b border-cyber-border/30 focus:border-cyber-primary"
                            placeholder="unit" />
                          <button type="button" onClick={() => setMaterials(materials.filter((_, i) => i !== idx))}
                            className="text-gray-600 hover:text-red-400 shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-gray-600 text-right">{materials.length} รายการ</p>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    className="cyber-input w-full text-sm" rows={2} placeholder="หมายเหตุหรือคำสั่งพิเศษ..." />
                </div>
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-cyber-border flex items-center justify-between shrink-0">
                <div className="text-xs text-gray-500">
                  {selectedBom ? (
                    <span className="flex items-center gap-1 text-cyber-primary">
                      <CheckCircle className="w-3 h-3" /> ใช้ BOM: {selectedBom.product_name}
                    </span>
                  ) : manualMode ? 'Manual entry' : 'ยังไม่ได้เลือก BOM'}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-cyber-border rounded-lg text-gray-400 hover:text-gray-200">
                    ยกเลิก
                  </button>
                  <button type="submit" disabled={saving || bomLoading || !productName.trim()}
                    className="cyber-btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    สร้าง Work Order
                  </button>
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
    IN_PROGRESS: { label: 'Mark Complete', status: 'COMPLETED', color: 'bg-cyber-green text-black' },
  }

  const next = nextStatus[wo.status]

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
          onClick={(e) => e.stopPropagation()} className="cyber-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-cyber-border flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-100">{wo.wo_number}</h2>
              <p className="text-gray-400 text-sm">{wo.product_name}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded text-xs font-semibold border ${priorityConf.color}`}>{priorityConf.label}</span>
              <span className={`status-badge ${statusConf.color}`}>{statusConf.label}</span>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
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
                    ? 'bg-cyber-green/20 text-cyber-green' : 'bg-cyber-darker text-gray-500'
                  }`}>
                    {STATUS_CONFIG[s].label}
                  </div>
                  {i < 3 && <ArrowRight className="w-4 h-4 text-gray-600 flex-shrink-0" />}
                </div>
              ))}
            </div>

            {/* Progress */}
            <div className="bg-cyber-darker p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 text-sm">Production Progress</span>
                <span className="text-gray-200 font-semibold">{wo.completed_qty} / {wo.quantity} units ({progress}%)</span>
              </div>
              <div className="h-3 bg-cyber-dark rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  progress === 100 ? 'bg-cyber-green' : progress > 0 ? 'bg-cyber-primary' : 'bg-gray-600'
                }`} style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-cyber-darker p-3 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Assigned To</p>
                <p className="text-gray-200">{wo.assigned_to || '-'}</p>
              </div>
              <div className="bg-cyber-darker p-3 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Due Date</p>
                <p className="text-gray-200">{wo.due_date ? new Date(wo.due_date).toLocaleDateString() : '-'}</p>
              </div>
              <div className="bg-cyber-darker p-3 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Estimated Cost</p>
                <p className="text-cyber-green font-semibold">฿{wo.estimated_cost.toLocaleString()}</p>
              </div>
              <div className="bg-cyber-darker p-3 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Actual Cost</p>
                <p className="text-gray-200">฿{wo.actual_cost.toLocaleString()}</p>
              </div>
            </div>

            {/* Materials */}
            <div>
              <h3 className="text-lg font-semibold text-gray-200 mb-3">Materials Required</h3>
              {wo.materials && wo.materials.length > 0 ? (
                <div className="space-y-2">
                  {wo.materials.map((mat) => (
                    <div key={mat.id} className="flex justify-between items-center p-3 bg-cyber-darker rounded-lg">
                      <div>
                        <p className="text-gray-200">{mat.material_name || 'Material'}</p>
                        <p className="text-gray-500 text-xs">
                          Issued: {mat.issued_qty}/{mat.required_qty} {mat.unit}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        mat.status === 'ISSUED' ? 'bg-cyber-green/20 text-cyber-green' :
                        mat.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {mat.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No materials linked</p>
              )}
            </div>

            {/* Notes */}
            {wo.notes && (
              <div className="bg-cyber-darker p-4 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Notes</p>
                <p className="text-gray-300 text-sm">{wo.notes}</p>
              </div>
            )}

            {wo.status === 'COMPLETED' && (
              <div className="p-4 bg-cyber-green/10 border border-cyber-green/30 rounded-lg flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-cyber-green" />
                <div>
                  <p className="text-cyber-green font-medium">Production Complete</p>
                  <p className="text-gray-400 text-sm">
                    {wo.completed_date ? `Completed on ${new Date(wo.completed_date).toLocaleDateString()}` : 'Completed'}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              {wo.status === 'IN_PROGRESS' && (
                <button onClick={() => { onStatusChange(wo.id, 'ON_HOLD'); onClose() }}
                  className="px-4 py-2 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/10 flex items-center gap-2">
                  <Pause className="w-4 h-4" /> Put On Hold
                </button>
              )}
              {wo.status === 'ON_HOLD' && (
                <button onClick={() => { onStatusChange(wo.id, 'IN_PROGRESS'); onClose() }}
                  className="px-4 py-2 border border-yellow-500/30 text-yellow-400 rounded-lg hover:bg-yellow-500/10 flex items-center gap-2">
                  <Play className="w-4 h-4" /> Resume
                </button>
              )}
              {wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                <button onClick={() => { onStatusChange(wo.id, 'CANCELLED'); onClose() }}
                  className="px-4 py-2 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10">
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
