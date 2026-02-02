import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingCart,
  Plus,
  Search,
  Eye,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  Clock,
  Send,
  Package,
  FileText,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'
import purchaseOrderService, { PurchaseOrder, POStats } from '../services/purchaseOrder'
import supplierService, { Supplier } from '../services/supplier'
import materialService, { Material } from '../services/materials'
import { SearchableDropdown } from '../components/common/SearchableDropdown'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: FileText },
  SUBMITTED: { label: 'Submitted', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Send },
  APPROVED: { label: 'Approved', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: CheckCircle },
  RECEIVED: { label: 'Received', color: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30', icon: Package },
  PARTIAL: { label: 'Partial', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: Clock },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: X },
}

function PurchaseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [stats, setStats] = useState<POStats | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState<PurchaseOrder | null>(null)

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
      alert(err.response?.data?.message || 'Failed to update status')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this purchase order?')) return
    try {
      await purchaseOrderService.delete(id)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete')
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
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-cyber-primary animate-spin" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
            <span className="neon-text">Purchase Orders</span>
          </h1>
          <p className="text-gray-400">จัดการใบสั่งซื้อวัตถุดิบ</p>
        </div>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreateModal(true)} className="cyber-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" /> Create PO
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard label="Total POs" value={(stats?.totalOrders ?? 0).toString()} color="text-cyber-primary" />
        <StatCard label="Draft" value={(stats?.draftOrders ?? 0).toString()} color="text-gray-400" />
        <StatCard label="Pending" value={(stats?.pendingOrders ?? 0).toString()} color="text-yellow-400" />
        <StatCard label="Received" value={(stats?.receivedOrders ?? 0).toString()} color="text-cyber-green" />
        <StatCard label="Total Value" value={`฿${(stats?.totalValue ?? 0).toLocaleString()}`} color="text-cyber-purple" />
      </div>

      {/* Filters */}
      <div className="cyber-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search PO number or supplier..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="cyber-input pl-10 w-full" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'CANCELLED'].map((s) => (
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

      {/* PO List */}
      <div className="cyber-card p-6">
        <div className="overflow-x-auto">
          <table className="cyber-table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th>Items</th>
                <th>Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-500">No purchase orders found</td></tr>
              ) : (
                filtered.map((po, i) => {
                  const statusConf = STATUS_CONFIG[po.status] || STATUS_CONFIG.DRAFT
                  return (
                    <motion.tr key={po.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                      <td>
                        <span className="text-cyber-primary font-mono font-semibold">{po.po_number}</span>
                      </td>
                      <td>
                        <div>
                          <p className="text-gray-200">{po.supplier_name || '-'}</p>
                          <p className="text-gray-500 text-xs">{po.supplier_code}</p>
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${statusConf.color}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {statusConf.label}
                        </span>
                      </td>
                      <td><span className="text-gray-400 text-sm">{new Date(po.order_date).toLocaleDateString()}</span></td>
                      <td><span className="text-gray-400 text-sm">{po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '-'}</span></td>
                      <td><span className="text-gray-400">{po.item_count || 0}</span></td>
                      <td><span className="text-cyber-green font-semibold">฿{po.total_amount.toLocaleString()}</span></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleViewDetail(po)}
                            className="p-2 text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10 rounded-lg">
                            <Eye className="w-4 h-4" />
                          </button>
                          {po.status === 'DRAFT' && (
                            <button onClick={() => handleStatusChange(po.id, 'SUBMITTED')}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg" title="Submit">
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {po.status === 'SUBMITTED' && (
                            <button onClick={() => handleStatusChange(po.id, 'APPROVED')}
                              className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg" title="Approve">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {po.status === 'APPROVED' && (
                            <button onClick={() => handleStatusChange(po.id, 'RECEIVED')}
                              className="p-2 text-gray-400 hover:text-cyber-green hover:bg-cyber-green/10 rounded-lg" title="Mark Received">
                              <Package className="w-4 h-4" />
                            </button>
                          )}
                          {po.status === 'DRAFT' && (
                            <button onClick={() => handleDelete(po.id)}
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
      <CreatePOModal open={showCreateModal} suppliers={suppliers}
        onClose={() => setShowCreateModal(false)} onSave={loadData} />

      {/* Detail Modal */}
      <PODetailModal po={showDetailModal} onClose={() => setShowDetailModal(null)}
        onStatusChange={handleStatusChange} />
    </motion.div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="cyber-card p-4">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color} font-['Orbitron']`}>{value}</p>
    </div>
  )
}

function CreatePOModal({ open, suppliers, onClose, onSave }: {
  open: boolean; suppliers: Supplier[]; onClose: () => void; onSave: () => void
}) {
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
    if (!supplierId) { alert('Please select a supplier'); return }
    setSaving(true)
    try {
      await purchaseOrderService.create({ supplierId, expectedDate: expectedDate || undefined, notes, taxRate, items })
      onSave()
      onClose()
      setItems([{ description: '', quantity: 1, unitPrice: 0, unit: 'units' }])
      setSupplierId('')
    } catch (err) {
      alert('Failed to create PO')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="cyber-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-cyber-border flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-100">Create Purchase Order</h2>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Supplier *</label>
                  <SearchableDropdown
                    value={supplierId}
                    onChange={setSupplierId}
                    options={(suppliers || []).filter((s) => s.status === 'ACTIVE').map((s) => ({
                      id: s.id,
                      label: `${s.name} (${s.code})`,
                      searchText: `${s.name} ${s.code}`,
                    }))}
                    placeholder="-- Select Supplier --"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Expected Date</label>
                  <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="cyber-input w-full" />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm text-gray-400 font-semibold">Items</label>
                  <button type="button" onClick={addItem} className="text-sm text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1">
                    <Plus className="w-4 h-4" /> Add Item
                  </button>
                </div>
                <div className="space-y-3">
                  {(items || []).map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-cyber-darker p-3 rounded-lg">
                      <div className="col-span-4">
                        <label className="text-xs text-gray-500">Material/Item</label>
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
                            { id: '', label: '-- Custom Item --', searchText: '' },
                            ...materials.map((m) => ({
                              id: m.id,
                              label: `${m.code} - ${m.name} (฿${Number(m.unitCost).toLocaleString()}/${m.unit})`,
                              searchText: `${m.code} ${m.name}`,
                            })),
                          ]}
                          placeholder="Search material..."
                        />
                        {(!item.materialId || item.materialId === '') && (
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateItem(idx, 'description', e.target.value)}
                            className="cyber-input w-full text-sm mt-2"
                            placeholder="Enter custom item name"
                            required
                          />
                        )}
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500">Qty</label>
                        <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                          className="cyber-input w-full text-sm" min="1" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500">Unit Price</label>
                        <input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          className="cyber-input w-full text-sm" min="0" step="0.01" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500">Total</label>
                        <p className="text-cyber-green font-semibold text-sm py-2">฿{(item.quantity * item.unitPrice).toLocaleString()}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(idx)} className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-cyber-darker p-4 rounded-lg space-y-2">
                <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>฿{subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between text-gray-400 items-center">
                  <span>Tax</span>
                  <div className="flex items-center gap-2">
                    <input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}
                      className="cyber-input w-20 text-sm text-right" min="0" max="100" />
                    <span>% = ฿{taxAmount.toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-cyber-border pt-2">
                  <span className="text-gray-200">Total</span>
                  <span className="text-cyber-green">฿{total.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="cyber-input w-full" rows={2} />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose} className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400">Cancel</button>
                <button type="submit" disabled={saving} className="cyber-btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Purchase Order
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
  if (!po) return null
  const statusConf = STATUS_CONFIG[po.status] || STATUS_CONFIG.DRAFT

  // Status flow
  const nextStatus: Record<string, { label: string; status: string; color: string }> = {
    DRAFT: { label: 'Submit to Supplier', status: 'SUBMITTED', color: 'bg-blue-500 text-white' },
    SUBMITTED: { label: 'Approve', status: 'APPROVED', color: 'bg-yellow-500 text-black' },
    APPROVED: { label: 'Mark as Received', status: 'RECEIVED', color: 'bg-cyber-green text-black' },
  }

  const next = nextStatus[po.status]

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
          onClick={(e) => e.stopPropagation()} className="cyber-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-cyber-border flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-100">{po.po_number}</h2>
              <p className="text-gray-400 text-sm">{po.supplier_name}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`status-badge ${statusConf.color}`}>{statusConf.label}</span>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
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
                    ? 'bg-cyber-green/20 text-cyber-green' : 'bg-cyber-darker text-gray-500'
                  }`}>
                    {STATUS_CONFIG[s].label}
                  </div>
                  {i < 3 && <ArrowRight className="w-4 h-4 text-gray-600" />}
                </div>
              ))}
            </div>

            {/* Items */}
            <div>
              <h3 className="text-lg font-semibold text-gray-200 mb-3">Items</h3>
              {po.items && po.items.length > 0 ? (
                <div className="space-y-2">
                  {(po.items || []).map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-3 bg-cyber-darker rounded-lg">
                      <div>
                        <p className="text-gray-200">{item.description || 'Item'}</p>
                        <p className="text-gray-500 text-xs">{item.quantity} x ฿{item.unit_price.toLocaleString()}</p>
                      </div>
                      <p className="text-cyber-green font-semibold">฿{item.total_price.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No items</p>
              )}
            </div>

            {/* Totals */}
            <div className="bg-cyber-darker p-4 rounded-lg space-y-1">
              <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>฿{po.subtotal.toLocaleString()}</span></div>
              <div className="flex justify-between text-gray-400"><span>Tax ({po.tax_rate}%)</span><span>฿{po.tax_amount.toLocaleString()}</span></div>
              <div className="flex justify-between text-lg font-bold border-t border-cyber-border pt-2 mt-2">
                <span className="text-gray-200">Total</span><span className="text-cyber-green">฿{po.total_amount.toLocaleString()}</span>
              </div>
            </div>

            {po.status === 'RECEIVED' && (
              <div className="p-4 bg-cyber-green/10 border border-cyber-green/30 rounded-lg flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-cyber-green" />
                <div>
                  <p className="text-cyber-green font-medium">Received & Stock Updated</p>
                  <p className="text-gray-400 text-sm">Materials have been added to inventory</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {next && (
              <div className="flex justify-end gap-3 pt-4">
                {po.status !== 'RECEIVED' && (
                  <button onClick={() => { onStatusChange(po.id, 'CANCELLED'); onClose() }}
                    className="px-4 py-2 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10">
                    Cancel Order
                  </button>
                )}
                <button onClick={() => { onStatusChange(po.id, next.status); onClose() }}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${next.color}`}>
                  <ArrowRight className="w-4 h-4" />
                  {next.label}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default PurchaseOrders
