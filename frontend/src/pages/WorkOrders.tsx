import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
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
  Pencil,
  Plus,
  Printer,
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
import workOrderService, { WorkOrder, WOStats, MaterialDraft, MaterialCheck } from '../services/workOrder'
import { useOpenFromSearch } from '../hooks/useOpenFromSearch'
import subcontractService, { Subcontract } from '../services/subcontract'
import api from '../services/api'
import { useModalClose } from '../hooks/useModalClose'
import { SearchableDropdown } from '../components/common/SearchableDropdown'
import { UnitPicker } from '../components/common/UnitPicker'
import { RowMenu } from '../components/common/DocRow'
import { printBill } from '../utils/printBill'
import { unitLabel } from '../hooks/useUnits'
import { normalizeUnit } from '../utils/unitNormalize'

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

/** ยังไม่เริ่มผลิต = แก้ไข/ลบได้ (backend เช็คซ้ำ รวมถึงสิทธิ์) */
const isEditable = (status: string) => status === 'DRAFT' || status === 'PLANNED'

const roundQty = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6
const fmtQty = (v: number) => (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })
const woProduced = (wo: WorkOrder) => roundQty(wo.produced_qty ?? wo.completed_qty ?? 0)
const woScrap = (wo: WorkOrder) => roundQty(wo.lot_scrap_qty ?? wo.scrap_qty ?? 0)
const woRemaining = (wo: WorkOrder) =>
  wo.remaining_qty !== undefined
    ? roundQty(wo.remaining_qty)
    : roundQty(Math.max(0, (Number(wo.quantity) || 0) - woProduced(wo) - woScrap(wo)))

function WorkOrders() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [stats, setStats] = useState<WOStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<WorkOrder | null>(null)
  const [recordLotWo, setRecordLotWo] = useState<WorkOrder | null>(null)
  const [editing, setEditing] = useState<WorkOrder | null>(null)
  // คลิกสองใบเร็ว ๆ — คำตอบของใบเก่าที่มาช้าต้องทิ้ง ไม่เปิดซ้อน
  const openReq = useRef(0)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
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

  const handleStatusChange = async (id: string, status: string, opts?: { closeShort?: boolean }) => {
    if (status === 'CANCELLED' && !confirm(t('workOrders.confirmCancel'))) return
    try {
      await workOrderService.updateStatus(id, status, opts)
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.error.updateStatus'))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('workOrders.confirmDelete'))) return
    try {
      await workOrderService.delete(id)
      setShowDetailModal(null)
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.error.delete'))
    }
  }

  const handleViewDetail = async (wo: WorkOrder) => {
    const req = ++openReq.current
    try {
      const detail = await workOrderService.getById(wo.id)
      if (req === openReq.current) setShowDetailModal(detail)
    } catch (err: any) {
      if (req === openReq.current) toast.error(err.response?.data?.message || t('workOrders.error.loadDetail'))
    }
  }

  const handleEdit = async (id: string) => {
    const req = ++openReq.current
    try {
      const detail = await workOrderService.getById(id)
      if (req !== openReq.current) return
      setShowDetailModal(null)
      setEditing(detail)
      setShowCreateModal(true)
    } catch (err: any) {
      if (req === openReq.current) toast.error(err.response?.data?.message || t('workOrders.error.loadDetail'))
    }
  }

  // ส่ง Promise เข้าไปเลย — printBill เปิดหน้าต่างก่อนรอ ไม่งั้น pop-up โดนบล็อก
  const handlePrint = (id: string, format: 'a4' | 'a5') => {
    printBill('wo', workOrderService.getById(id), format)
      .catch((err: any) => toast.error(err.response?.data?.message || t('workOrders.error.loadDetail')))
  }
  useOpenFromSearch((_type, id) => { handleViewDetail({ id } as WorkOrder) })

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
          onClick={() => { openReq.current++; setShowCreateModal(true) }} className="phopy-btn-primary flex items-center gap-2">
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
                  const produced = woProduced(wo)
                  const scrap = woScrap(wo)
                  const progress = wo.quantity > 0 ? Math.min(100, Math.round((produced / wo.quantity) * 100)) : 0
                  const isOverdue = wo.due_date && new Date(wo.due_date) < new Date() && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'

                  return (
                    <motion.tr key={wo.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                      onClick={() => handleViewDetail(wo)} className="cursor-pointer hover:bg-[var(--bg)]">
                      <td>
                        <button type="button" onClick={e => { e.stopPropagation(); handleViewDetail(wo) }}
                          className="text-[var(--primary)] font-mono font-semibold hover:underline whitespace-nowrap text-left">{wo.wo_number}</button>
                        {wo.so_number && (
                          <div className="mt-0.5">
                            <span className="inline-block text-[10px] text-[var(--fg-4)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded font-mono">
                              จาก {wo.so_number}
                            </span>
                          </div>
                        )}
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
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[var(--fg-3)]">
                            {fmtQty(produced)}/{fmtQty(wo.quantity)} {wo.unit ? unitLabel(wo.unit) : ''}
                          </span>
                          {scrap > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--danger-soft)] text-danger">
                              {t('workOrders.lot.scrapShort', { qty: fmtQty(scrap) })}
                            </span>
                          )}
                        </div>
                      </td>
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
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handlePrint(wo.id, 'a4')} title={t('workOrders.actions.printA4')} aria-label={t('workOrders.actions.printA4')}
                            className="p-2 text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-phopy-indigo/10 rounded-lg">
                            <Printer className="w-4 h-4" />
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
                          {wo.status === 'IN_PROGRESS' && woRemaining(wo) > 0 && (
                            <button onClick={() => setRecordLotWo(wo)}
                              className="p-2 text-[var(--fg-3)] hover:text-success hover:bg-success/10 rounded-lg"
                              title={t('workOrders.lot.recordButton')} aria-label={t('workOrders.lot.recordButton')}>
                              <PackageCheck className="w-4 h-4" />
                            </button>
                          )}
                          <RowMenu label={t('workOrders.actions.menu')} items={[
                            { label: t('workOrders.actions.view'), onClick: () => handleViewDetail(wo) },
                            { label: t('workOrders.actions.printA4'), onClick: () => handlePrint(wo.id, 'a4') },
                            { label: t('workOrders.actions.printA5'), onClick: () => handlePrint(wo.id, 'a5') },
                            ...(isEditable(wo.status) ? [
                              { label: t('workOrders.actions.edit'), onClick: () => handleEdit(wo.id) },
                              { label: t('workOrders.actions.delete'), onClick: () => handleDelete(wo.id), danger: true },
                            ] : []),
                            ...(!['COMPLETED', 'CANCELLED'].includes(wo.status) ? [
                              { label: t('workOrders.actions.cancel'), onClick: () => handleStatusChange(wo.id, 'CANCELLED'), danger: true },
                            ] : []),
                          ]} />
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
      <CreateWOModal open={showCreateModal} editing={editing}
        onClose={() => { setShowCreateModal(false); setEditing(null) }} onSave={loadData} />

      {/* Detail Modal */}
      <WODetailModal wo={showDetailModal} onClose={() => setShowDetailModal(null)}
        onStatusChange={handleStatusChange} onPrint={handlePrint} onEdit={handleEdit} onDelete={handleDelete}
        onRecordLot={(w) => setRecordLotWo(w)} />

      {/* Record Lot Modal */}
      {/* เมานต์เฉพาะตอนเปิด — ไม่งั้นค้างบนสุดของ stack ปุ่ม Esc ปิดหน้ารายละเอียดไม่ได้ */}
      {recordLotWo && <RecordLotModal wo={recordLotWo} onClose={() => setRecordLotWo(null)}
        onRecorded={(updatedWo) => {
          loadData()
          if (showDetailModal && showDetailModal.id === updatedWo.id) {
            setShowDetailModal(updatedWo)
          }
        }} />}
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

function CreateWOModal({ open, editing, onClose, onSave }: {
  open: boolean; editing: WorkOrder | null; onClose: () => void; onSave: () => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [quantity, setQuantity] = useState(1)
  // หน่วยของจำนวนผลิต — default ตามหน่วยของสินค้าที่เลือก ผู้ใช้แก้เองได้
  const [unit, setUnit] = useState('')
  const [unitTouched, setUnitTouched] = useState(false)
  const [priority, setPriority] = useState('NORMAL')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState<MaterialDraft[]>([])
  // ผู้ใช้แก้รายการวัตถุดิบเองแล้ว → เปลี่ยนจำนวนผลิตจะไม่โหลด BOM ทับให้เอง แต่ขึ้นปุ่มให้กด
  const [materialsTouched, setMaterialsTouched] = useState(false)
  const [materialsFor, setMaterialsFor] = useState('')
  const [saving, setSaving] = useState(false)
  const [boms, setBoms] = useState<any[]>([])
  const [stockItems, setStockItems] = useState<any[]>([])
  const [selectedBomId, setSelectedBomId] = useState('')
  const [bomLoading, setBomLoading] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [checks, setChecks] = useState<MaterialCheck[]>([])
  const [stockChecking, setStockChecking] = useState(false)
  const [creatingPR, setCreatingPR] = useState(false)
  // ตอบกลับช้ากว่าคำขอใหม่ต้องทิ้ง — พิมพ์จำนวน 1→10→100 เร็ว ๆ คำตอบของ 10 เคยมาทับของ 100 ได้
  const bomReq = useRef(0)
  // MASTER แก้ใบของร้านอื่น ต้องดึงคลัง/BOM ของร้านนั้น (backend เมินค่านี้ถ้าไม่ใช่ MASTER)
  const tenantId = editing?.tenant_id

  useEffect(() => {
    if (!open) return
    const scope = { params: { tenantId } }
    api.get('/bom', scope).then(res => setBoms(res.data?.data || [])).catch(() => {})
    api.get('/stock', scope).then(res => setStockItems(res.data?.data || [])).catch(() => toast.error(t('workOrders.create.stockLoadFailed')))
  }, [open, tenantId])

  useEffect(() => {
    bomReq.current++
    setBomLoading(false)
    const e = open ? editing : null
    setProductId(e?.bom_id ? '' : e?.product_id || '')
    setProductName(e?.product_name || '')
    setQuantity(e?.quantity ?? 1)
    setUnit(e?.unit ? normalizeUnit(e.unit) : '')
    setUnitTouched(!!e?.unit)
    setPriority(e?.priority || 'NORMAL')
    setDueDate(e?.due_date?.slice(0, 10) || '')
    setAssignedTo(e?.assigned_to || '')
    setNotes(e?.notes || '')
    setMaterials((e?.materials || []).map(m => ({
      materialId: m.material_id || '', materialName: m.material_name || '', requiredQty: m.required_qty, unit: normalizeUnit(m.unit || ''),
    })))
    setMaterialsTouched(!!e)
    setMaterialsFor(e ? `${e.quantity}|${e.unit ? normalizeUnit(e.unit) : ''}` : '')
    setSelectedBomId(e?.bom_id || '')
    setManualMode(!!e && !e.bom_id)
    setChecks([]); setCreatingPR(false); setSaving(false)
  }, [open, editing])

  // ตัวเลือก BOM สำหรับ SearchableDropdown (STEP 1)
  const bomOptions = useMemo(() => boms.map((bom: any) => ({
    id: bom.id,
    label: `${bom.product_name} (${bom.product_code} · v${bom.version})`,
    searchText: `${bom.product_name} ${bom.product_code}`,
  })), [boms])

  // วัตถุดิบเลือกจากคลังเท่านั้น — ผูกด้วย stock_items.id
  const stockById = useMemo(() => new Map<string, any>(stockItems.map(item => [item.id, item])), [stockItems])
  const category = (item: any) => String(item.category || '').trim().toUpperCase()
  const toOption = (item: any) => ({
    id: item.id as string,
    label: `${item.name}${item.sku ? ` (${item.sku})` : ''} · ${Number(item.quantity || 0).toLocaleString()} ${unitLabel(item.unit || '')}`,
    searchText: `${item.name} ${item.sku || ''}`,
  })
  const materialOptions = useMemo(() => stockItems.filter(item => category(item) !== 'SERVICE').map(toOption), [stockItems])
  const productOptions = useMemo(() => stockItems.filter(item => ['FINISHED', 'WIP'].includes(category(item))).map(toOption), [stockItems])

  const selectedUnitBase = (() => {
    if (selectedBomId) {
      const bom = boms.find((b: any) => b.id === selectedBomId) as any
      return bom?.product_base_unit || bom?.product_unit || ''
    }
    const product = stockById.get(productId)
    return product?.base_unit || product?.unit || ''
  })()

  useEffect(() => {
    if (!unitTouched && selectedUnitBase) setUnit(normalizeUnit(selectedUnitBase))
  }, [selectedUnitBase, unitTouched])

  // เทียบสต็อกที่ backend (แปลงหน่วย + รวมแพ็คที่ยังไม่แกะ)
  useEffect(() => {
    if (!open || materials.length === 0) { setChecks([]); setStockChecking(false); return }
    let stale = false
    setStockChecking(true)
    const timer = setTimeout(() => {
      workOrderService.checkMaterials(materials, tenantId)
        .then(r => { if (!stale) setChecks(r) })
        .catch(() => { if (!stale) setChecks([]) })
        .finally(() => { if (!stale) setStockChecking(false) })
    }, 350)
    return () => { stale = true; clearTimeout(timer) }
  }, [open, materials, tenantId])

  const loadBomMaterials = async (bomId: string, qty: number, u: string) => {
    const req = ++bomReq.current
    setBomLoading(true)
    try {
      const mats = await workOrderService.bomMaterials(bomId, qty, u, tenantId)
      if (req !== bomReq.current) return
      setMaterials(mats)
      setMaterialsTouched(false)
      setMaterialsFor(`${qty}|${u}`)
    } catch (err: any) {
      if (req === bomReq.current) {
        setMaterials([])
        setMaterialsFor('')
        toast.error(err.response?.data?.message || t('workOrders.create.bomLoadFailed'))
      }
    } finally {
      if (req === bomReq.current) setBomLoading(false)
    }
  }

  const handleBomSelect = (bom: any) => {
    const u = normalizeUnit(bom.product_base_unit || bom.product_unit || '')
    setSelectedBomId(bom.id)
    setProductId('')
    setProductName(bom.product_name || '')
    setManualMode(false)
    setUnit(u)
    setUnitTouched(false)
    if (quantity > 0) loadBomMaterials(bom.id, quantity, u)
  }

  const handleProductSelect = (id: string) => {
    setProductId(id)
    const product = stockById.get(id)
    if (!product) return
    setProductName(product.name || '')
    setUnit(normalizeUnit(product.base_unit || product.unit || ''))
    setUnitTouched(false)
  }

  const handleQuantityChange = (newQty: number) => {
    setQuantity(newQty)
    if (selectedBomId && !materialsTouched && newQty > 0) loadBomMaterials(selectedBomId, newQty, unit)
  }

  const handleUnitChange = (u: string) => {
    setUnit(u)
    setUnitTouched(true)
    if (selectedBomId && !materialsTouched && quantity > 0) loadBomMaterials(selectedBomId, quantity, u)
  }

  const editMaterials = (next: MaterialDraft[]) => { setMaterials(next); setMaterialsTouched(true) }
  const patchMaterial = (idx: number, patch: Partial<MaterialDraft>) =>
    editMaterials(materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  const handleMaterialSelect = (idx: number, id: string) => {
    const item = stockById.get(id)
    patchMaterial(idx, item
      ? { materialId: id, materialName: item.name, unit: normalizeUnit(item.unit || '') }
      : { materialId: '', materialName: '' })
  }

  const needsRecalc = !!selectedBomId && materialsTouched && materialsFor !== `${quantity}|${unit}` && quantity > 0
  const checksFresh = checks.length === materials.length
  const shortages = checksFresh
    ? materials.map((m, i) => ({ m, c: checks[i] })).filter(x => x.c.stockStatus === 'short')
    : []
  const allSufficient = checksFresh && materials.length > 0 && checks.every(c => c.stockStatus === 'ok')

  const handleCreateAutoPR = async () => {
    if (shortages.length === 0) return
    setCreatingPR(true)
    try {
      // วัตถุดิบเดียวกันหลายบรรทัดรวมเป็นรายการเดียว · จำนวนเป็นหน่วยสต็อก
      const merged = new Map<string, { material_id: string; material_name: string; quantity: number; unit: string }>()
      for (const { m, c } of shortages) {
        const row = merged.get(m.materialId)
        if (row) row.quantity = Number((row.quantity + c.shortQty).toFixed(6))
        else merged.set(m.materialId, { material_id: m.materialId, material_name: m.materialName, quantity: c.shortQty, unit: c.stockUnit })
      }
      const items = [...merged.values()]
      await api.post('/purchase-requests', {
        reason: t('workOrders.create.prReason', { name: productName, quantity }),
        items,
      })
      toast.success(t('workOrders.create.prCreated', { count: items.length }))
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.create.prFailed'))
    } finally { setCreatingPR(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productName.trim()) return
    const unlinked = materials.find(m => !m.materialId)
    if (unlinked) {
      toast.error(t('workOrders.create.notLinked', { name: unlinked.materialName || '-' }))
      return
    }
    setSaving(true)
    try {
      const payload = {
        bomId: selectedBomId || null,
        productId: selectedBomId ? null : productId || null,
        productName: productName.trim(), quantity, priority,
        // ไม่ส่งเลยถ้ายังไม่ได้เลือก/ยังไม่ default ได้ — backend จะ fallback เป็นหน่วยของสินค้าเอง
        unit: unit || undefined,
        dueDate: dueDate || null,
        assignedTo, notes, materials,
      }
      if (editing) await workOrderService.update(editing.id, payload)
      else await workOrderService.create(payload)
      onSave(); onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.error.create'))
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
                <h2 className="text-lg font-bold text-[var(--fg-1)]">{editing ? `${t('workOrders.create.editTitle')} ${editing.wo_number}` : t('workOrders.create.title')}</h2>
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
                    <button type="button" onClick={() => { bomReq.current++; setBomLoading(false); setManualMode(true); setSelectedBomId('') }}
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
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <SearchableDropdown className="flex-1 min-w-0" value={productId} onChange={handleProductSelect}
                          options={productOptions} placeholder={t('workOrders.create.selectProduct')} />
                        <button type="button" onClick={() => { setManualMode(false); setProductId('') }}
                          className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--fg-4)] hover:text-[var(--fg-2)] shrink-0">
                          {t('workOrders.create.step1')}
                        </button>
                      </div>
                    </div>
                  )}
                  {!selectedBomId && !productId && productName.trim() && (
                    <p className="flex items-center gap-1.5 text-xs text-warning mt-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('workOrders.create.productNotLinked')}
                    </p>
                  )}
                </div>

                {/* STEP 2: Details */}
                <div>
                  <p className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider flex items-center gap-1.5 mb-3">
                    <span className="w-4 h-4 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] text-xs flex items-center justify-center font-bold">2</span>
                    {t('workOrders.create.step2')}
                  </p>

                  <div className="space-y-3">
                    {/* Product + Qty + Unit */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="col-span-4">
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.productLabel')}</label>
                        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                          className="phopy-input w-full" placeholder={t('workOrders.create.productPlaceholder')} required
                          readOnly={!!selectedBomId || !!productId} autoComplete="off"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.quantityLabel')}</label>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => handleQuantityChange(Math.max(1, quantity - 1))}
                            className="w-8 h-9 flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] shrink-0">−</button>
                          <input type="number" value={quantity} onChange={(e) => handleQuantityChange(Number(e.target.value))}
                            className="phopy-input w-full text-center" min="0.001" step="any" required />
                          <button type="button" onClick={() => handleQuantityChange(quantity + 1)}
                            className="w-8 h-9 flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] shrink-0">+</button>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.create.unitLabel')}</label>
                        <UnitPicker
                          value={unit}
                          onChange={handleUnitChange}
                          materialId={productId || boms.find((b: any) => b.id === selectedBomId)?.product_id}
                          baseUnit={selectedUnitBase || undefined}
                          hideUnreachableHint
                          placeholder={t('workOrders.create.unitPlaceholder')}
                        />
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
                                ? 'bg-[var(--surface-2)] font-bold'
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
                      onClick={() => editMaterials([...materials, { materialId: '', materialName: '', requiredQty: 1, unit: '' }])}
                      className="text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">
                      <Plus className="w-3 h-3" /> {t('common.add')}
                    </button>
                  </div>

                  {/* Stock summary banner */}
                  {needsRecalc && (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs mb-2 border bg-[var(--warning-soft)] border-warning/30 text-warning">
                      <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('workOrders.create.qtyChanged')}</span>
                      <button type="button" onClick={() => loadBomMaterials(selectedBomId, quantity, unit)} className="underline font-semibold shrink-0">
                        {t('workOrders.create.recalc')}
                      </button>
                    </div>
                  )}
                  {(shortages.length > 0 || allSufficient) && !stockChecking && (
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
                        const c = checksFresh ? checks[idx] : undefined
                        const item = stockById.get(mat.materialId)
                        const short = c?.stockStatus === 'short'
                        return (
                          <div key={idx} className={`flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2 rounded-lg border ${
                            short ? 'border-danger/20 bg-[var(--danger-soft)]'
                            : mat.materialId ? 'border-phopy-indigo/15 bg-phopy-indigo/5'
                            : 'border-warning/40 bg-[var(--warning-soft)]'
                          }`}>
                            <div className="w-full sm:flex-1 min-w-0">
                              <SearchableDropdown value={mat.materialId} onChange={(id) => handleMaterialSelect(idx, id)}
                                options={materialOptions}
                                placeholder={mat.materialName || t('workOrders.create.selectMaterial')} />
                              {!mat.materialId && mat.materialName && (
                                <p className="text-xs text-warning mt-1">{t('workOrders.create.notLinked', { name: mat.materialName })}</p>
                              )}
                            </div>
                            <input type="number" value={mat.requiredQty} onChange={(e) => patchMaterial(idx, { requiredQty: Number(e.target.value) })}
                              className="phopy-input w-24 text-sm text-right" min="0.000001" step="any" required />
                            <div className="w-28 shrink-0">
                              <UnitPicker size="sm" value={mat.unit} onChange={(u) => patchMaterial(idx, { unit: u })}
                                materialId={mat.materialId || null} baseUnit={item?.unit || undefined} hideUnreachableHint
                                placeholder={t('workOrders.create.unitPlaceholder')} />
                            </div>
                            <div className="w-24 shrink-0 text-right text-xs">
                              {stockChecking ? <Loader2 className="w-3 h-3 animate-spin text-[var(--fg-4)] inline" />
                                : !c || c.stockStatus === 'unknown' ? <span className="text-[var(--fg-4)]">-</span>
                                : c.stockStatus === 'ok' ? <span className="text-success font-medium"><Check className="w-3 h-3 inline" /> {c.stockQty.toLocaleString()} {unitLabel(c.stockUnit)}</span>
                                : short ? <span className="text-danger font-semibold">{t('workOrders.detail.short', { qty: c.shortQty.toLocaleString(), unit: unitLabel(c.stockUnit) })}</span>
                                : <span className="text-warning">{t('workOrders.create.mismatch')}</span>}
                            </div>
                            <button type="button" onClick={() => editMaterials(materials.filter((_, i) => i !== idx))} aria-label={t('workOrders.actions.delete')}
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
                    <button type="submit" disabled={saving || bomLoading || !productName.trim() || !(quantity > 0)}
                      className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      {editing ? t('workOrders.create.saveButton') : t('workOrders.create.createButton')}
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

export function WODetailModal({ wo, onClose, onStatusChange, onPrint, onEdit, onDelete, onRecordLot }: {
  wo: WorkOrder | null; onClose: () => void; onStatusChange: (id: string, status: string, opts?: { closeShort?: boolean }) => void
  onPrint: (id: string, format: 'a4' | 'a5') => void; onEdit: (id: string) => void; onDelete: (id: string) => void
  onRecordLot?: (wo: WorkOrder) => void
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
  const produced = woProduced(wo)
  const scrap = woScrap(wo)
  const remaining = woRemaining(wo)
  const progress = wo.quantity > 0 ? Math.min(100, Math.round((produced / wo.quantity) * 100)) : 0

  const nextStatus: Record<string, { label: string; status: string; color: string }> = {
    DRAFT: { label: t('workOrders.detail.planProduction'), status: 'PLANNED', color: 'bg-blue-500 text-white' },
    PLANNED: { label: t('workOrders.detail.startProduction'), status: 'IN_PROGRESS', color: 'bg-yellow-500 text-black' },
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
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-[var(--fg-1)]">{wo.wo_number}</h2>
                {wo.so_number && (
                  <span className="text-xs text-[var(--fg-4)] bg-[var(--surface-2)] border border-[var(--border)] px-2 py-0.5 rounded font-mono">
                    จาก {wo.so_number}
                  </span>
                )}
              </div>
              <p className="text-[var(--fg-3)] text-sm">{wo.product_name}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded text-xs font-semibold border ${priorityConf.color}`}>{priorityConf.label}</span>
              <span className={`status-badge ${statusConf.color}`}>{statusConf.label}</span>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg"><X className="w-5 h-5 text-[var(--fg-3)]" /></button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* พิมพ์ / แก้ไข / ลบ */}
            <div className="flex flex-wrap gap-2">
              {(['a4', 'a5'] as const).map(f => (
                <button key={f} type="button" onClick={() => onPrint(wo.id, f)}
                  className="px-3 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)] flex items-center gap-2">
                  <Printer className="w-4 h-4" /> {t(f === 'a4' ? 'workOrders.actions.printA4' : 'workOrders.actions.printA5')}
                </button>
              ))}
              {isEditable(wo.status) && (<>
                <button type="button" onClick={() => onEdit(wo.id)}
                  className="px-3 py-2 text-sm border border-phopy-indigo/30 rounded-lg text-[var(--primary)] hover:bg-phopy-indigo/10 flex items-center gap-2">
                  <Pencil className="w-4 h-4" /> {t('workOrders.actions.edit')}
                </button>
                <button type="button" onClick={() => onDelete(wo.id)}
                  className="px-3 py-2 text-sm border border-danger/30 rounded-lg text-danger hover:bg-[var(--danger-soft)] flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> {t('workOrders.actions.delete')}
                </button>
              </>)}
            </div>

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
              <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                <span className="text-[var(--fg-3)] text-sm">{t('workOrders.detail.productionProgress')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--fg-2)] font-semibold">
                    {fmtQty(produced)} / {fmtQty(wo.quantity)} {wo.unit ? unitLabel(wo.unit) : t('workOrders.detail.units')} ({progress}%)
                  </span>
                  {scrap > 0 && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--danger-soft)] text-danger">
                      {t('workOrders.lot.scrapShort', { qty: fmtQty(scrap) })}
                    </span>
                  )}
                </div>
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
                          {t('workOrders.detail.issued', { issued: fmtQty(mat.issued_qty), required: fmtQty(mat.required_qty), unit: unitLabel(mat.unit || '') })}{mat.sku ? ` · ${mat.sku}` : ''}
                        </p>
                        {mat.stockStatus === 'short' ? (
                          <p className="text-danger text-xs">{t('workOrders.detail.short', { qty: mat.shortQty?.toLocaleString(), unit: unitLabel(mat.stockUnit || '') })}</p>
                        ) : mat.stockStatus === 'ok' ? (
                          <p className="text-success text-xs">{t('workOrders.detail.inStock', { qty: mat.stockQty?.toLocaleString(), unit: unitLabel(mat.stockUnit || '') })}</p>
                        ) : mat.stockStatus === 'mismatch' ? (
                          <p className="text-warning text-xs">{t('workOrders.create.mismatch')}</p>
                        ) : mat.stockStatus === 'unknown' ? (
                          <p className="text-warning text-xs">{t('workOrders.detail.matNotLinked')}</p>
                        ) : null}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${
                        mat.status === 'ISSUED' ? 'bg-[var(--success-soft)] text-success' :
                        mat.status === 'PARTIAL' ? 'bg-[var(--info-soft)] text-blue-400' :
                        mat.status === 'PENDING' ? 'bg-[var(--warning-soft)] text-warning' :
                        'bg-[var(--surface-sunken)] text-[var(--fg-3)]'
                      }`}>
                        {mat.status === 'ISSUED' ? t('workOrders.detail.matIssued') : mat.status === 'PENDING' ? t('workOrders.detail.matPending') : mat.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--fg-4)]">{t('workOrders.detail.noMaterialsLinked')}</p>
              )}
            </div>

            {/* Lot History */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-[var(--primary)]" />
                {t('workOrders.lot.historyTitle')}
              </h3>
              {wo.lots && wo.lots.length > 0 ? (
                <div className="overflow-x-auto bg-[var(--surface-2)] rounded-lg p-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--fg-4)]">
                        <th className="text-left py-1.5 pr-3 font-medium">{t('workOrders.lot.colLotNumber')}</th>
                        <th className="text-right py-1.5 pr-3 font-medium">{t('workOrders.lot.colGood')}</th>
                        <th className="text-right py-1.5 pr-3 font-medium">{t('workOrders.lot.colScrap')}</th>
                        <th className="text-right py-1.5 pr-3 font-medium">{t('workOrders.lot.colCost')}</th>
                        <th className="text-left py-1.5 pr-3 font-medium">{t('workOrders.lot.colDate')}</th>
                        <th className="text-left py-1.5 font-medium">{t('workOrders.lot.colNotes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wo.lots.map((lot) => (
                        <tr key={lot.id} className="border-b border-[var(--border)]/50 last:border-0">
                          <td className="py-2 pr-3 font-mono text-[var(--fg-1)]">{lot.lot_number}</td>
                          <td className="py-2 pr-3 text-right font-semibold text-success">
                            {fmtQty(lot.good_qty)} {wo.unit ? unitLabel(wo.unit) : ''}
                          </td>
                          <td className="py-2 pr-3 text-right text-danger">
                            {lot.scrap_qty > 0 ? `${fmtQty(lot.scrap_qty)} ${wo.unit ? unitLabel(wo.unit) : ''}` : '-'}
                          </td>
                          <td className="py-2 pr-3 text-right text-[var(--fg-2)]">
                            ฿{Number(lot.material_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 pr-3 text-[var(--fg-3)]">
                            {lot.created_at ? new Date(lot.created_at).toLocaleString('th-TH') : '-'}
                            {lot.recorded_by ? <span className="block text-[10px] text-[var(--fg-4)]">{lot.recorded_by}</span> : null}
                          </td>
                          <td className="py-2 text-[var(--fg-3)]">{lot.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[var(--fg-4)] text-sm">{t('workOrders.lot.empty')}</p>
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
            <div className="flex flex-wrap justify-end gap-3 pt-4">
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
              {wo.status === 'IN_PROGRESS' && remaining > 0 && onRecordLot && (
                <button type="button" onClick={() => onRecordLot(wo)}
                  className="phopy-btn-primary px-4 py-2 rounded-lg font-semibold flex items-center gap-2">
                  <PackageCheck className="w-4 h-4" />
                  {t('workOrders.lot.recordButton')}
                </button>
              )}
              {wo.status === 'IN_PROGRESS' && (
                remaining > 0 ? (
                  <button type="button" onClick={() => {
                    if (confirm(t('workOrders.lot.confirmCloseShort', {
                      completed: fmtQty(produced),
                      scrap: fmtQty(scrap),
                      quantity: fmtQty(wo.quantity),
                      remaining: fmtQty(remaining),
                    }))) {
                      onStatusChange(wo.id, 'COMPLETED', { closeShort: true })
                      onClose()
                    }
                  }}
                    className="px-4 py-2 rounded-lg font-semibold border border-success/40 text-success hover:bg-success/10 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {t('workOrders.lot.closeShortButton')}
                  </button>
                ) : (
                  <button type="button" onClick={() => { onStatusChange(wo.id, 'COMPLETED'); onClose() }}
                    className="px-4 py-2 rounded-lg font-semibold bg-success text-black flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {t('workOrders.detail.markComplete')}
                  </button>
                )
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

  // ของเกินสต็อกที่มีจริง — ใช้ทั้งโชว์คำเตือน (เดิม sr-only มองไม่เห็น) และบล็อกปุ่มส่ง
  // (เดิมไม่บล็อก กดส่งทะลุ insufficient stock ได้เงียบๆ)
  const isRowShort = (row: { stock_item_id: string; quantity: number }) => {
    const selected = stockItems.find(s => s.id === row.stock_item_id)
    return !!selected && row.quantity > selected.quantity
  }
  const hasShortRow = rows.some(isRowShort)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const items = rows.filter(r => r.stock_item_id && r.quantity > 0)
    if (items.length === 0 || hasShortRow) return
    setSaving(true)
    try {
      await subcontractService.issueMaterials(contract.id, { items })
      onSaved(); onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.subcontract.issueFailed'))
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
                  const short = isRowShort(row)
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex gap-2 items-start">
                        <select value={row.stock_item_id} onChange={(e) => updateRow(i, { stock_item_id: e.target.value })}
                          className="phopy-input flex-1 text-sm">
                          <option value="">{t('workOrders.subcontract.selectItem')}</option>
                          {stockItems.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} ({s.quantity} {unitLabel(s.unit)})</option>
                          ))}
                        </select>
                        <input type="number" min="0" step="0.01" value={row.quantity || ''}
                          onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                          placeholder={t('workOrders.subcontract.quantity')}
                          className="phopy-input w-28 text-sm" />
                        <button type="button" onClick={() => removeRow(i)} disabled={rows.length <= 1}
                          className="p-2 text-danger disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {short && (
                        <div className="flex items-center gap-1.5 text-xs text-danger bg-[var(--danger-soft)] border border-danger/20 rounded-lg px-3 py-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {t('workOrders.subcontract.insufficientStock')} ({selected?.quantity} {unitLabel(selected?.unit)})
                        </div>
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
                <button type="submit" disabled={saving || hasShortRow} className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
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
                            <td className="py-1.5 pr-2 text-[var(--fg-2)]">{r.outstanding} {unitLabel(r.unit)}</td>
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
                                <td className="py-1.5 pr-3 text-[var(--fg-2)]">{m.issued_qty} {unitLabel(m.unit)}</td>
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

export function RecordLotModal({ wo, onClose, onRecorded }: {
  wo: WorkOrder | null; onClose: () => void; onRecorded: (updatedWo: WorkOrder) => void
}) {
  const { t } = useTranslation()
  useModalClose(onClose)
  const [detail, setDetail] = useState<WorkOrder | null>(wo)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [goodQty, setGoodQty] = useState('')
  const [scrapQty, setScrapQty] = useState('0')
  const [lotNumber, setLotNumber] = useState('')
  const [notes, setNotes] = useState('')
  const fetchReq = useRef(0)

  useEffect(() => {
    if (!wo) {
      setDetail(null)
      return
    }
    setDetail(wo)
    setGoodQty('')
    setScrapQty('0')
    setLotNumber('')
    setNotes('')
    const req = ++fetchReq.current
    setLoading(true)
    workOrderService.getById(wo.id)
      .then((fresh) => {
        if (req === fetchReq.current && fresh) setDetail(fresh)
      })
      .catch((err: any) => {
        if (req === fetchReq.current) toast.error(err.response?.data?.message || t('workOrders.error.loadDetail'))
      })
      .finally(() => {
        if (req === fetchReq.current) setLoading(false)
      })
  }, [wo?.id])

  if (!wo || !detail) return null

  const produced = woProduced(detail)
  const scrap = woScrap(detail)
  const remaining = woRemaining(detail)
  const unitText = detail.unit ? unitLabel(detail.unit) : t('workOrders.detail.units')
  const defaultLot = `${detail.wo_number}-L${String((detail.lots?.length || 0) + 1).padStart(2, '0')}`

  const g = roundQty(Number(goodQty || 0))
  const s = roundQty(Number(scrapQty || 0))
  const lotTotal = roundQty(g + s)
  const isLastLot = lotTotal > 0 && lotTotal >= remaining - 1e-6

  const materials = detail.materials || []
  const allPreIssued = materials.length > 0 && materials.every(m => m.status === 'ISSUED')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!Number.isFinite(g) || !Number.isFinite(s) || g < 0 || s < 0 || lotTotal <= 0) {
      toast.error(t('workOrders.lot.errorZeroQty'))
      return
    }
    if (lotTotal > remaining + 1e-6) {
      toast.error(t('workOrders.lot.errorOverRemaining', { remaining: fmtQty(remaining) }))
      return
    }
    setSaving(true)
    try {
      const res = await workOrderService.recordLot(detail.id, {
        goodQty: g,
        scrapQty: s,
        lotNumber: lotNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      if (res.autoCompleted) {
        toast.success(t('workOrders.lot.autoCompletedSuccess', { lotNumber: res.lot.lot_number }))
      } else if (res.qcBlockedCompletion) {
        toast.success(t('workOrders.lot.qcBlockedNotice', { lotNumber: res.lot.lot_number }))
      } else {
        toast.success(t('workOrders.lot.recordSuccess', { lotNumber: res.lot.lot_number }))
      }
      onRecorded(res.workOrder)
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('workOrders.lot.errorRecord'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-[65] p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-xl max-h-[92vh] flex flex-col">
          <div className="p-5 border-b border-[var(--border)] flex justify-between items-center shrink-0">
            <div>
              <h2 className="text-lg font-bold text-[var(--fg-1)]">{t('workOrders.lot.modalTitle')}</h2>
              <p className="text-xs text-[var(--fg-4)] mt-0.5">{detail.wo_number} · {detail.product_name}</p>
            </div>
            <button type="button" onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg text-[var(--fg-3)]">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5">
                <p className="text-[11px] text-[var(--fg-4)]">{t('workOrders.lot.orderedQty')}</p>
                <p className="text-base font-bold text-[var(--fg-1)]">{fmtQty(detail.quantity)} <span className="text-xs font-normal">{unitText}</span></p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5">
                <p className="text-[11px] text-[var(--fg-4)]">{t('workOrders.lot.completedGood')}</p>
                <p className="text-base font-bold text-success">{fmtQty(produced)} <span className="text-xs font-normal">{unitText}</span></p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5">
                <p className="text-[11px] text-[var(--fg-4)]">{t('workOrders.lot.completedScrap')}</p>
                <p className="text-base font-bold text-danger">{fmtQty(scrap)} <span className="text-xs font-normal">{unitText}</span></p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-2.5 border border-[var(--primary)]/30">
                <p className="text-[11px] text-[var(--fg-4)]">{t('workOrders.lot.remainingQty')}</p>
                <p className="text-base font-bold text-[var(--primary)]">{fmtQty(remaining)} <span className="text-xs font-normal">{unitText}</span></p>
              </div>
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[var(--fg-4)]">{t('workOrders.lot.goodQtyLabel')}</label>
                  {remaining > 0 && (
                    <button type="button" onClick={() => setGoodQty(String(remaining))}
                      className="text-xs text-[var(--primary)] hover:underline">
                      {t('workOrders.lot.fillRemaining')}
                    </button>
                  )}
                </div>
                <input type="number" min="0" max={remaining} step="any" value={goodQty}
                  onChange={(e) => setGoodQty(e.target.value)}
                  placeholder="0" className="phopy-input w-full" />
              </div>
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.lot.scrapQtyLabel')}</label>
                <input type="number" min="0" max={Math.max(0, roundQty(remaining - g))} step="any" value={scrapQty}
                  onChange={(e) => setScrapQty(e.target.value)}
                  placeholder="0" className="phopy-input w-full" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.lot.lotNumberLabel')}</label>
                <input type="text" maxLength={60} value={lotNumber} onChange={(e) => setLotNumber(e.target.value)}
                  placeholder={t('workOrders.lot.lotNumberPlaceholder', { defaultLot })} className="phopy-input w-full" />
              </div>
              <div>
                <label className="text-xs text-[var(--fg-4)] mb-1 block">{t('workOrders.lot.notesLabel')}</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('workOrders.lot.notesPlaceholder')} className="phopy-input w-full" />
              </div>
            </div>

            {/* Material Usage Preview */}
            <div>
              <p className="text-xs font-semibold text-[var(--fg-3)] mb-2 flex items-center gap-2">
                {t('workOrders.lot.materialPreviewTitle')}
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--primary)]" />}
              </p>
              {allPreIssued ? (
                <div className="p-3 rounded-lg bg-[var(--info-soft)] border border-info/30 text-xs text-blue-400">
                  {t('workOrders.lot.materialPreIssuedNotice')}
                </div>
              ) : materials.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {materials.map((m) => {
                    const req = roundQty(Number(m.required_qty) || 0)
                    const issued = roundQty(Number(m.issued_qty) || 0)
                    const matRem = roundQty(Math.max(0, req - issued))
                    const previewQty = lotTotal <= 0
                      ? 0
                      : isLastLot
                        ? matRem
                        : roundQty(Math.min(matRem, detail.quantity > 0 ? req * (lotTotal / detail.quantity) : 0))
                    const mUnit = unitLabel(m.unit || '')
                    return (
                      <div key={m.id} className="flex justify-between items-center px-3 py-2 bg-[var(--surface-2)] rounded-lg text-xs">
                        <div>
                          <p className="text-[var(--fg-2)] font-medium">{m.material_name}</p>
                          <p className="text-[var(--fg-4)]">
                            {t('workOrders.lot.previewIssued', { issued: fmtQty(issued), required: fmtQty(req), unit: mUnit })}
                          </p>
                        </div>
                        <span className="font-semibold text-[var(--primary)]">
                          {t('workOrders.lot.previewThisLot', { qty: fmtQty(previewQty), unit: mUnit })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--fg-4)]">{t('workOrders.detail.noMaterialsLinked')}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--fg-3)]">
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={saving || loading}
                className="phopy-btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                {t('workOrders.lot.submitButton')}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default WorkOrders
