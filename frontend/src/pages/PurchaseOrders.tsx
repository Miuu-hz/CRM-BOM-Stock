import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useModalClose } from '../hooks/useModalClose'

import { motion, AnimatePresence } from 'framer-motion'

import {

  AlertCircle,

  AlertTriangle,

  ArrowRight,

  CheckCircle,

  Clock,

  Eye,

  FileText,

  Loader2,

  Package,

  Pencil,

  Plus,

  Search,

  Send,

  ShoppingCart,

  Trash2,

  X,

} from 'lucide-react'

import purchaseOrderService, { PurchaseOrder, POStats } from '../services/purchaseOrder'

import supplierService, { Supplier } from '../services/supplier'

import materialService, { Material } from '../services/materials'

import { SearchableDropdown } from '../components/common/SearchableDropdown'



const STATUS_CONFIG: Record<string, { labelKey: string; color: string; icon: any }> = {

  DRAFT: { labelKey: 'purchaseOrders.status.draft', color: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]', icon: FileText },

  SUBMITTED: { labelKey: 'purchaseOrders.status.submitted', color: 'bg-[var(--info-soft)] text-blue-400 border-info/30', icon: Send },

  APPROVED: { labelKey: 'purchaseOrders.status.approved', color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: CheckCircle },

  RECEIVED: { labelKey: 'purchaseOrders.status.received', color: 'bg-[var(--success-soft)] text-success border-success/30', icon: Package },

  PARTIAL: { labelKey: 'purchaseOrders.status.partial', color: 'bg-[var(--warning-soft)] text-warning border-warning/30', icon: Clock },

  CANCELLED: { labelKey: 'purchaseOrders.status.cancelled', color: 'bg-[var(--danger-soft)] text-danger border-danger/30', icon: X },

}



function PurchaseOrders() {
  const { t } = useTranslation()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])

  const [stats, setStats] = useState<POStats | null>(null)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [loading, setLoading] = useState(true)

  const [searchTerm, setSearchTerm] = useState('')

  const [statusFilter, setStatusFilter] = useState('all')

  const [showCreateModal, setShowCreateModal] = useState(false)

  const [showDetailModal, setShowDetailModal] = useState<PurchaseOrder | null>(null)

  const [showEditModal, setShowEditModal] = useState<PurchaseOrder | null>(null)



  useEffect(() => { loadData() }, [])



  const loadData = async () => {

    setLoading(true)

    try {

      const [ordersData, statsData, suppliersData] = await Promise.all([

        purchaseOrderService.getAll(),

        purchaseOrderService.getStats(),

        supplierService.getAll(),

      ])

      setOrders(ordersData)

      setStats(statsData)

      setSuppliers(suppliersData)

    } catch (err) {

      console.error('Failed to load PO data:', err)

    } finally {

      setLoading(false)

    }

  }



  const handleStatusChange = async (id: string, status: string) => {

    try {

      await purchaseOrderService.updateStatus(id, status)

      loadData()

    } catch (err: any) {

      alert(err.response?.data?.message || t("purchaseOrders.failedStatus"))

    }

  }



  const handleDelete = async (id: string) => {

    if (!confirm(t("purchaseOrders.deleteConfirm"))) return

    try {

      await purchaseOrderService.delete(id)

      loadData()

    } catch (err: any) {

      alert(err.response?.data?.message || t("purchaseOrders.failedDelete"))

    }

  }



  const handleViewDetail = async (po: PurchaseOrder) => {

    try {

      const detail = await purchaseOrderService.getById(po.id)

      setShowDetailModal(detail)

    } catch (err) {

      console.error(err)

    }

  }



  const filtered = (orders || []).filter((o) => {

    const matchSearch = o.po_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||

      (o.supplier_name || '').toLowerCase().includes(searchTerm.toLowerCase())

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

          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">{t("purchaseOrders.title")}</h1>
          <p className="text-[var(--fg-3)]">{t("purchaseOrders.subtitle")}</p>

        </div>

        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}

          onClick={() => setShowCreateModal(true)} className="phopy-btn-primary flex items-center gap-2">

          <Plus className="w-5 h-5" /> {t("purchaseOrders.createPO")}

        </motion.button>

      </div>



      {/* Stats */}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

        <StatCard label={t("purchaseOrders.totalPOs")} value={(stats?.totalOrders ?? 0).toString()} color="text-[var(--primary)]" />

        <StatCard label={t("purchaseOrders.draft")} value={(stats?.draftOrders ?? 0).toString()} color="text-[var(--fg-3)]" />

        <StatCard label={t("purchaseOrders.pending")} value={(stats?.pendingOrders ?? 0).toString()} color="text-warning" />

        <StatCard label={t("purchaseOrders.received")} value={(stats?.receivedOrders ?? 0).toString()} color="text-success" />

        <StatCard label={t("purchaseOrders.totalValue")} value={`฿${(stats?.totalValue ?? 0).toLocaleString()}`} color="text-purple-500" />

      </div>



      {/* Filters */}

      <div className="phopy-card p-4">

        <div className="flex flex-col lg:flex-row gap-4 items-center">

          <div className="flex-1 relative">

            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />

            <input type="text" placeholder={t("purchaseOrders.searchPlaceholder")}

              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="phopy-input pl-10 w-full" />

          </div>

          <div className="flex gap-2 flex-wrap">

            {['all', 'DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'CANCELLED'].map((s) => (

              <button key={s} onClick={() => setStatusFilter(s)}

                className={`px-3 py-2 rounded-lg text-sm transition-all ${

                  statusFilter === s ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'

                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)]'

                }`}>

                {s === 'all' ? t('common.all') : STATUS_CONFIG[s] ? t(STATUS_CONFIG[s].labelKey) : s}

              </button>

            ))}

          </div>

        </div>

      </div>



      {/* PO List */}

      <div className="phopy-card p-6">

        <div className="overflow-x-auto">

          <table className="phopy-table">

            <thead>

              <tr>

                <th>{t("purchaseOrders.poNumber")}</th>

                <th>{t("purchaseOrders.supplier")}</th>

                <th>{t("common.status")}</th>

                <th>{t("purchaseOrders.orderDate")}</th>

                <th>{t("purchaseOrders.expected")}</th>

                <th>{t("purchaseOrders.items")}</th>

                <th>{t("common.total")}</th>

                <th>{t("common.actions")}</th>

              </tr>

            </thead>

            <tbody>

              {filtered.length === 0 ? (

                <tr><td colSpan={8} className="text-center py-8 text-[var(--fg-4)]">{t("purchaseOrders.noOrders")}</td></tr>

              ) : (

                filtered.map((po, i) => {

                  const statusConf = STATUS_CONFIG[po.status] || STATUS_CONFIG.DRAFT

                  return (

                    <motion.tr key={po.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>

                      <td>

                        <span className="text-[var(--primary)] font-mono font-semibold">{po.po_number}</span>

                      </td>

                      <td>

                        <div>

                          <p className="text-[var(--fg-2)]">{po.supplier_name || '-'}</p>

                          <p className="text-[var(--fg-4)] text-xs">{po.supplier_code}</p>

                        </div>

                      </td>

                      <td>

                        <span className={`status-badge ${statusConf.color}`}>

                          <span className="w-1.5 h-1.5 rounded-full bg-current" />

                          {t(statusConf.labelKey)}

                        </span>

                      </td>

                      <td><span className="text-[var(--fg-3)] text-sm">{new Date(po.order_date).toLocaleDateString()}</span></td>

                      <td><span className="text-[var(--fg-3)] text-sm">{po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '-'}</span></td>

                      <td><span className="text-[var(--fg-3)]">{po.item_count || 0}</span></td>

                      <td><span className="text-success font-semibold">฿{po.total_amount.toLocaleString()}</span></td>

                      <td>

                        <div className="flex items-center gap-1">

                          <button onClick={() => handleViewDetail(po)}

                            className="p-2 text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-phopy-indigo/10 rounded-lg">

                            <Eye className="w-4 h-4" />

                          </button>

                          {po.status === 'DRAFT' && (

                            <button onClick={() => setShowEditModal(po)}

                              className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg" title={t("purchaseOrders.editDraft")}>

                              <Pencil className="w-4 h-4" />

                            </button>

                          )}

                          {po.status === 'DRAFT' && (

                            <button onClick={() => handleStatusChange(po.id, 'SUBMITTED')}

                              className="p-2 text-[var(--fg-3)] hover:text-blue-400 hover:bg-blue-400/10 rounded-lg" title={t("common.submit")}>

                              <Send className="w-4 h-4" />

                            </button>

                          )}

                          {po.status === 'SUBMITTED' && (

                            <button onClick={() => handleStatusChange(po.id, 'APPROVED')}

                              className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg" title={t("common.approve")}>

                              <CheckCircle className="w-4 h-4" />

                            </button>

                          )}

                          {po.status === 'APPROVED' && (

                            <button onClick={() => handleStatusChange(po.id, 'RECEIVED')}

                              className="p-2 text-[var(--fg-3)] hover:text-success hover:bg-success/10 rounded-lg" title={t("purchaseOrders.markReceived")}>

                              <Package className="w-4 h-4" />

                            </button>

                          )}

                          {po.status === 'DRAFT' && (

                            <button onClick={() => handleDelete(po.id)}

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

      <CreatePOModal open={showCreateModal} suppliers={suppliers}

        onClose={() => setShowCreateModal(false)} onSave={loadData} />



      {/* Detail Modal */}

      <PODetailModal po={showDetailModal} onClose={() => setShowDetailModal(null)}

        onStatusChange={handleStatusChange} />



      {/* Edit Modal */}

      <EditPOModal po={showEditModal} suppliers={suppliers}

        onClose={() => setShowEditModal(null)} onSave={loadData} />

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



function CreatePOModal({ open, suppliers, onClose, onSave }: {
  open: boolean; suppliers: Supplier[]; onClose: () => void; onSave: () => void

}) {
  const { t } = useTranslation()

  useModalClose(onClose)

  const [supplierId, setSupplierId] = useState('')

  const [expectedDate, setExpectedDate] = useState('')

  const [notes, setNotes] = useState('')

  const [taxRate, setTaxRate] = useState(7)

  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; unit: string; materialId?: string }[]>([

    { description: '', quantity: 1, unitPrice: 0, unit: 'units' },

  ])

  const [materials, setMaterials] = useState<Material[]>([])

  const [saving, setSaving] = useState(false)



  // Load materials when modal opens

  useEffect(() => {

    if (open) {

      loadMaterials()

    }

  }, [open])



  const loadMaterials = async () => {

    try {

      const data = await materialService.getAll()

      setMaterials(data)

    } catch (err) {

      console.error('Failed to load materials:', err)

    }

  }



  const addItem = () => setItems([...items, { description: '', quantity: 1, unitPrice: 0, unit: 'units' }])

  const removeItem = (idx: number) => setItems((items || []).filter((_, i) => i !== idx))

  const updateItem = (idx: number, field: string, value: any) => {

    const updated = [...items]

    ;(updated[idx] as any)[field] = value

    setItems(updated)

  }



  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)

  const taxAmount = subtotal * (taxRate / 100)

  const total = subtotal + taxAmount



  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault()

    if (!supplierId) { alert(t("purchaseOrders.supplierRequired")); return }

    setSaving(true)

    try {

      await purchaseOrderService.create({ supplierId, expectedDate: expectedDate || undefined, notes, taxRate, items })

      onSave()

      onClose()

      setItems([{ description: '', quantity: 1, unitPrice: 0, unit: 'units' }])

      setSupplierId('')

    } catch (err) {

      alert(t("purchaseOrders.failedCreate"))

    } finally {

      setSaving(false)

    }

  }



  return (

    <AnimatePresence>

      {open && (

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}

          className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>

          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}

            onClick={(e) => e.stopPropagation()}

            className="phopy-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">

            <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">

              <h2 className="text-xl font-bold text-[var(--fg-1)]">{t("purchaseOrders.createPurchaseOrder")}</h2>

              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg"><X className="w-5 h-5 text-[var(--fg-3)]" /></button>

            </div>



            <form onSubmit={handleSubmit} className="p-6 space-y-4">

              <div className="grid grid-cols-2 gap-4">

                <div>

                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.supplier")} *</label>

                  <SearchableDropdown

                    value={supplierId}

                    onChange={setSupplierId}

                    options={(suppliers || []).filter((s) => s.status === 'ACTIVE').map((s) => ({

                      id: s.id,

                      label: `${s.name} (${s.code})`,

                      searchText: `${s.name} ${s.code}`,

                    }))}

                    placeholder={t("purchaseOrders.selectSupplier")}

                  />

                </div>

                <div>

                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.expectedDate")}</label>

                  <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="phopy-input w-full" />

                </div>

              </div>



              {/* Items */}

              <div>

                <div className="flex justify-between items-center mb-3">

                  <label className="text-sm text-[var(--fg-3)] font-semibold">{t("purchaseOrders.items")}</label>

                  <button type="button" onClick={addItem} className="text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">

                    <Plus className="w-4 h-4" /> {t("purchaseOrders.addItem")}

                  </button>

                </div>

                <div className="space-y-3">

                  {(items || []).map((item, idx) => (

                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-[var(--surface-2)] p-3 rounded-lg">

                      <div className="col-span-4">

                        <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.materialItem")}</label>

                        <SearchableDropdown

                          value={item.materialId || ''}

                          onChange={(value) => {

                            const selectedMaterial = materials.find((m) => m.id === value)

                            if (selectedMaterial) {

                              updateItem(idx, 'description', selectedMaterial.name)

                              updateItem(idx, 'unitPrice', Number(selectedMaterial.unitCost))

                              updateItem(idx, 'unit', selectedMaterial.unit)

                              updateItem(idx, 'materialId', value)

                            } else {

                              updateItem(idx, 'materialId', '')

                              updateItem(idx, 'description', '')

                            }

                          }}

                          options={[

                            { id: '', label: t("purchaseOrders.customItem"), searchText: '' },

                            ...materials.map((m) => ({

                              id: m.id,

                              label: `${m.code} - ${m.name} (฿${Number(m.unitCost).toLocaleString()}/${m.unit})`,

                              searchText: `${m.code} ${m.name}`,

                            })),

                          ]}

                          placeholder={t("purchaseOrders.searchMaterial")}

                        />

                        {(!item.materialId || item.materialId === '') && (

                          <input

                            type="text"

                            value={item.description}

                            onChange={(e) => updateItem(idx, 'description', e.target.value)}

                            className="phopy-input w-full text-sm mt-2"

                            placeholder={t("purchaseOrders.enterCustomItemName")}

                            required

                          />

                        )}

                      </div>

                      <div className="col-span-2">

                        <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.qty")}</label>

                        <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}

                          className="phopy-input w-full text-sm" min="1" required />

                      </div>

                      <div className="col-span-2">

                        <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.unitPrice")}</label>

                        <input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}

                          className="phopy-input w-full text-sm" min="0" step="0.01" required />

                      </div>

                      <div className="col-span-2">

                        <label className="text-xs text-[var(--fg-4)]">{t("common.total")}</label>

                        <p className="text-success font-semibold text-sm py-2">฿{(item.quantity * item.unitPrice).toLocaleString()}</p>

                      </div>

                      <div className="col-span-2 text-right">

                        {items.length > 1 && (

                          <button type="button" onClick={() => removeItem(idx)} className="p-2 text-danger hover:bg-[var(--danger-soft)] rounded-lg">

                            <X className="w-4 h-4" />

                          </button>

                        )}

                      </div>

                    </div>

                  ))}

                </div>

              </div>



              {/* Totals */}

              <div className="bg-[var(--surface-2)] p-4 rounded-lg space-y-2">

                <div className="flex justify-between text-[var(--fg-3)]"><span>{t("purchaseOrders.subtotal")}</span><span>฿{subtotal.toLocaleString()}</span></div>

                <div className="flex justify-between text-[var(--fg-3)] items-center">

                  <span>{t("purchaseOrders.tax")}</span>

                  <div className="flex items-center gap-2">

                    <input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}

                      className="phopy-input w-20 text-sm text-right" min="0" max="100" />

                    <span>% = ฿{taxAmount.toLocaleString()}</span>

                  </div>

                </div>

                <div className="flex justify-between text-lg font-bold border-t border-[var(--border)] pt-2">

                  <span className="text-[var(--fg-2)]">{t("common.total")}</span>

                  <span className="text-success">฿{total.toLocaleString()}</span>

                </div>

              </div>



              <div>

                <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.notes")}</label>

                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="phopy-input w-full" rows={2} />

              </div>



              <div className="flex justify-end gap-3 pt-4">

                <button type="button" onClick={onClose} className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)]">{t("common.cancel")}</button>

                <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2">

                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}

                  {t("purchaseOrders.submit")}

                </button>

              </div>

            </form>

          </motion.div>

        </motion.div>

      )}

    </AnimatePresence>

  )

}



function PODetailModal({ po, onClose, onStatusChange }: {
  po: PurchaseOrder | null; onClose: () => void; onStatusChange: (id: string, status: string) => void

}) {
  const { t } = useTranslation()

  useModalClose(onClose)

  if (!po) return null

  const statusConf = STATUS_CONFIG[po.status] || STATUS_CONFIG.DRAFT



  // Status flow

  const nextStatus: Record<string, { labelKey: string; status: string; color: string }> = {

    DRAFT: { labelKey: 'purchaseOrders.submitToSupplier', status: 'SUBMITTED', color: 'bg-blue-500 text-white' },

    SUBMITTED: { labelKey: 'purchaseOrders.approve', status: 'APPROVED', color: 'bg-yellow-500 text-black' },

    APPROVED: { labelKey: 'purchaseOrders.markAsReceived', status: 'RECEIVED', color: 'bg-success text-black' },

  }



  const next = nextStatus[po.status]



  return (

    <AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}

        className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>

        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}

          onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">

          <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">

            <div>

              <h2 className="text-xl font-bold text-[var(--fg-1)]">{po.po_number}</h2>

              <p className="text-[var(--fg-3)] text-sm">{po.supplier_name}</p>

            </div>

            <div className="flex items-center gap-3">

              <span className={`status-badge ${statusConf.color}`}>{t(statusConf.labelKey)}</span>

              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg"><X className="w-5 h-5 text-[var(--fg-3)]" /></button>

            </div>

          </div>



          <div className="p-6 space-y-4">

            {/* Status Flow */}

            <div className="flex items-center gap-2 text-sm overflow-x-auto py-2">

              {['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED'].map((s, i) => (

                <div key={s} className="flex items-center gap-2">

                  <div className={`px-3 py-1 rounded-full ${

                    po.status === s ? STATUS_CONFIG[s].color + ' font-semibold'

                    : ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED'].indexOf(po.status) > i

                    ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'

                  }`}>

                    {t(STATUS_CONFIG[s].labelKey)}

                  </div>

                  {i < 3 && <ArrowRight className="w-4 h-4 text-[var(--fg-4)]" />}

                </div>

              ))}

            </div>



            {/* Items */}

            <div>

              <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3">{t("purchaseOrders.items")}</h3>

              {po.items && po.items.length > 0 ? (

                <div className="space-y-2">

                  {(po.items || []).map((item) => (

                    <div key={item.id} className="flex justify-between items-center p-3 bg-[var(--surface-2)] rounded-lg">

                      <div>

                        <p className="text-[var(--fg-2)]">{item.description || t("purchaseOrders.itemFallback")}</p>

                        <p className="text-[var(--fg-4)] text-xs">{item.quantity} x ฿{item.unit_price.toLocaleString()}</p>

                      </div>

                      <p className="text-success font-semibold">฿{item.total_price.toLocaleString()}</p>

                    </div>

                  ))}

                </div>

              ) : (

                <p className="text-[var(--fg-4)]">{t("purchaseOrders.noItems")}</p>

              )}

            </div>



            {/* Totals */}

            <div className="bg-[var(--surface-2)] p-4 rounded-lg space-y-1">

              <div className="flex justify-between text-[var(--fg-3)]"><span>{t("purchaseOrders.subtotal")}</span><span>฿{po.subtotal.toLocaleString()}</span></div>

              <div className="flex justify-between text-[var(--fg-3)]"><span>{t("purchaseOrders.tax")} ({po.tax_rate}%)</span><span>฿{po.tax_amount.toLocaleString()}</span></div>

              <div className="flex justify-between text-lg font-bold border-t border-[var(--border)] pt-2 mt-2">

                <span className="text-[var(--fg-2)]">{t("common.total")}</span><span className="text-success">฿{po.total_amount.toLocaleString()}</span>

              </div>

            </div>



            {po.status === 'RECEIVED' && (

              <div className="p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3">

                <CheckCircle className="w-6 h-6 text-success" />

                <div>

                  <p className="text-success font-medium">{t("purchaseOrders.receivedStockUpdated")}</p>

                  <p className="text-[var(--fg-3)] text-sm">{t("purchaseOrders.materialsAddedToInventory")}</p>

                </div>

              </div>

            )}



            {/* Action Buttons */}

            {next && (

              <div className="flex justify-end gap-3 pt-4">

                {po.status !== 'RECEIVED' && (

                  <button onClick={() => { onStatusChange(po.id, 'CANCELLED'); onClose() }} className="px-4 py-2 border border-danger/30 text-danger rounded-lg hover:bg-[var(--danger-soft)]">{t("purchaseOrders.cancelOrder")}</button>

                )}

                <button onClick={() => { onStatusChange(po.id, next.status); onClose() }}

                  className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${next.color}`}>

                  <ArrowRight className="w-4 h-4" />

                  {t(next.labelKey)}

                </button>

              </div>

            )}

          </div>

        </motion.div>

      </motion.div>

    </AnimatePresence>

  )

}



function EditPOModal({ po, suppliers, onClose, onSave }: {
  po: PurchaseOrder | null; suppliers: Supplier[]; onClose: () => void; onSave: () => void

}) {
  const { t } = useTranslation()

  useModalClose(onClose)

  const [supplierId, setSupplierId] = useState('')

  const [expectedDate, setExpectedDate] = useState('')

  const [notes, setNotes] = useState('')

  const [taxRate, setTaxRate] = useState(7)

  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; unit: string; materialId?: string }[]>([])

  const [materials, setMaterials] = useState<Material[]>([])

  const [saving, setSaving] = useState(false)



  useEffect(() => {

    if (!po) return

    setSupplierId(po.supplier_id ?? '')

    setExpectedDate(po.expected_date ? po.expected_date.slice(0, 10) : '')

    setNotes(po.notes ?? '')

    setTaxRate(po.tax_rate ?? 7)

    setItems(

      (po.items ?? []).map((i) => ({

        description: i.description ?? '',

        quantity: i.quantity,

        unitPrice: i.unit_price,

        unit: i.unit ?? 'units',

        materialId: i.material_id ?? '',

      }))

    )

    materialService.getAll().then(setMaterials).catch(() => {})

  }, [po])



  if (!po) return null



  const addItem = () => setItems([...items, { description: '', quantity: 1, unitPrice: 0, unit: 'units' }])

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx))

  const updateItem = (idx: number, field: string, value: any) => {

    const updated = [...items]; (updated[idx] as any)[field] = value; setItems(updated)

  }



  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  const taxAmount = subtotal * (taxRate / 100)

  const total = subtotal + taxAmount



  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault()

    setSaving(true)

    try {

      await purchaseOrderService.update(po.id, { supplierId, expectedDate: expectedDate || undefined, notes, taxRate, items })

      onSave()

      onClose()

    } catch {

      alert(t("purchaseOrders.failedUpdate"))

    } finally {

      setSaving(false)

    }

  }



  return (

    <AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}

        className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>

        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}

          onClick={(e) => e.stopPropagation()}

          className="phopy-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">



          <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">

            <div>

              <h2 className="text-xl font-bold text-[var(--fg-1)]">{t("purchaseOrders.editDraftPO")}</h2>

              <p className="text-sm text-[var(--fg-3)] font-mono">{po.po_number}</p>

              {po.notes?.startsWith('[AI Draft]') && (

                <p className="text-xs text-warning mt-1"><AlertTriangle className="w-3.5 h-3.5 inline" /> {t("purchaseOrders.aiDraftWarning")}</p>

              )}

            </div>

            <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg">

              <X className="w-5 h-5 text-[var(--fg-3)]" />

            </button>

          </div>



          <form onSubmit={handleSubmit} className="p-6 space-y-4">

            <div className="grid grid-cols-2 gap-4">

              <div>

                <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.supplier")}</label>

                <SearchableDropdown

                  value={supplierId}

                  onChange={setSupplierId}

                  options={[

                    { id: '', label: t("purchaseOrders.selectSupplier"), searchText: '' },

                    ...(suppliers || []).filter((s) => s.status === 'ACTIVE').map((s) => ({

                      id: s.id, label: `${s.name} (${s.code})`, searchText: `${s.name} ${s.code}`,

                    })),

                  ]}

                  placeholder={t("purchaseOrders.selectSupplier")}

                />

              </div>

              <div>

                <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.expectedDate")}</label>

                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="phopy-input w-full" />

              </div>

            </div>



            {/* Items */}

            <div>

              <div className="flex justify-between items-center mb-3">

                <label className="text-sm text-[var(--fg-3)] font-semibold">{t("purchaseOrders.items")}</label>

                <button type="button" onClick={addItem} className="text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1">

                  <Plus className="w-4 h-4" /> {t("purchaseOrders.addItem")}

                </button>

              </div>

              <div className="space-y-3">

                {items.map((item, idx) => (

                  <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-[var(--surface-2)] p-3 rounded-lg">

                    <div className="col-span-4">

                      <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.materialItem")}</label>

                      <SearchableDropdown

                        value={item.materialId || ''}

                        onChange={(value) => {

                          const m = materials.find((m) => m.id === value)

                          if (m) {

                            updateItem(idx, 'description', m.name)

                            updateItem(idx, 'unitPrice', Number(m.unitCost))

                            updateItem(idx, 'unit', m.unit)

                            updateItem(idx, 'materialId', value)

                          } else {

                            updateItem(idx, 'materialId', '')

                          }

                        }}

                        options={[

                          { id: '', label: t("purchaseOrders.customItem"), searchText: '' },

                          ...materials.map((m) => ({

                            id: m.id,

                            label: `${m.code} - ${m.name} (฿${Number(m.unitCost).toLocaleString()}/${m.unit})`,

                            searchText: `${m.code} ${m.name}`,

                          })),

                        ]}

                        placeholder={t("purchaseOrders.searchMaterial")}

                      />

                      {(!item.materialId || item.materialId === '') && (

                        <input type="text" value={item.description}

                          onChange={(e) => updateItem(idx, 'description', e.target.value)}

                          className="phopy-input w-full text-sm mt-2" placeholder={t("purchaseOrders.enterItemName")} required />

                      )}

                    </div>

                    <div className="col-span-2">

                      <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.qty")}</label>

                      <input type="number" value={item.quantity}

                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}

                        className="phopy-input w-full text-sm" min="0.01" step="0.01" required />

                    </div>

                    <div className="col-span-2">

                      <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.unit")}</label>

                      <input type="text" value={item.unit}

                        onChange={(e) => updateItem(idx, 'unit', e.target.value)}

                        className="phopy-input w-full text-sm" placeholder={t("purchaseOrders.unitPlaceholder")} />

                    </div>

                    <div className="col-span-2">

                      <label className="text-xs text-[var(--fg-4)]">{t("purchaseOrders.unitPrice")}</label>

                      <input type="number" value={item.unitPrice}

                        onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}

                        className="phopy-input w-full text-sm" min="0" step="0.01" required />

                    </div>

                    <div className="col-span-1">

                      <label className="text-xs text-[var(--fg-4)]">{t("common.total")}</label>

                      <p className="text-success font-semibold text-sm py-2">฿{(item.quantity * item.unitPrice).toLocaleString()}</p>

                    </div>

                    <div className="col-span-1 text-right">

                      {items.length > 1 && (

                        <button type="button" onClick={() => removeItem(idx)}

                          className="p-2 text-danger hover:bg-[var(--danger-soft)] rounded-lg">

                          <X className="w-4 h-4" />

                        </button>

                      )}

                    </div>

                  </div>

                ))}

              </div>

            </div>



            {/* Totals */}

            <div className="bg-[var(--surface-2)] p-4 rounded-lg space-y-2">

              <div className="flex justify-between text-[var(--fg-3)]"><span>{t("purchaseOrders.subtotal")}</span><span>฿{subtotal.toLocaleString()}</span></div>

              <div className="flex justify-between text-[var(--fg-3)] items-center">

                <span>{t("purchaseOrders.tax")}</span>

                <div className="flex items-center gap-2">

                  <input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}

                    className="phopy-input w-20 text-sm text-right" min="0" max="100" />

                  <span>% = ฿{taxAmount.toLocaleString()}</span>

                </div>

              </div>

              <div className="flex justify-between text-lg font-bold border-t border-[var(--border)] pt-2">

                <span className="text-[var(--fg-2)]">{t("common.total")}</span>

                <span className="text-success">฿{total.toLocaleString()}</span>

              </div>

            </div>



            <div>

              <label className="block text-sm text-[var(--fg-3)] mb-2">{t("purchaseOrders.notes")}</label>

              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="phopy-input w-full" rows={2} />

            </div>



            <div className="flex justify-end gap-3 pt-4">

              <button type="button" onClick={onClose} className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)]">{t("common.cancel")}</button>

              <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} {t("purchaseOrders.saveChanges")}</button>

            </div>

          </form>

        </motion.div>

      </motion.div>

    </AnimatePresence>

  )

}



export default PurchaseOrders

