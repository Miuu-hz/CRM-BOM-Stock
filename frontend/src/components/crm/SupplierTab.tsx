import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Truck,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Star,
  Loader2,
  Phone,
  Mail,
  MapPin,
  ShoppingCart,
  TrendingUp,
  Package,
  ChevronDown,
  ChevronUp,
  Pencil,
} from 'lucide-react'
import supplierService, { Supplier, SupplierStats } from '../../services/supplier'

export default function SupplierTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stats, setStats] = useState<SupplierStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [suppliersData, statsData] = await Promise.all([
        supplierService.getAll(),
        supplierService.getStats(),
      ])
      setSuppliers(suppliersData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load suppliers:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return
    try {
      await supplierService.delete(id)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete supplier')
    }
  }

  const filtered = (suppliers || []).filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchType = selectedType === 'all' || s.type === selectedType
    return matchSearch && matchType
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Suppliers" value={(stats?.totalSuppliers ?? 0).toString()} color="text-cyber-primary" />
        <StatCard label="Active" value={(stats?.activeSuppliers ?? 0).toString()} color="text-cyber-green" />
        <StatCard label="Purchase Orders" value={(stats?.totalPOs ?? 0).toString()} color="text-yellow-400" />
        <StatCard label="Total Spent" value={`฿${(stats?.totalSpent ?? 0).toLocaleString()}`} color="text-cyber-purple" />
      </div>

      {/* Toolbar */}
      <div className="cyber-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search suppliers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'RAW_MATERIAL', 'PACKAGING', 'SERVICE'].map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedType === t
                    ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
                    : 'bg-cyber-darker text-gray-400 border border-cyber-border'
                }`}
              >
                {t === 'all' ? 'All' : t === 'RAW_MATERIAL' ? 'Raw Material' : t === 'PACKAGING' ? 'Packaging' : 'Service'}
              </button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { setEditingSupplier(null); setShowModal(true) }}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" /> Add Supplier
          </motion.button>
        </div>
      </div>

      {/* Supplier List */}
      <div className="cyber-card p-6">
        <div className="overflow-x-auto">
          <table className="cyber-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Type</th>
                <th>Contact</th>
                <th>Payment Terms</th>
                <th>Rating</th>
                <th>Orders</th>
                <th>Total Spent</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-500">No suppliers found</td></tr>
              ) : (
                (filtered || []).map((supplier, i) => (
                  <motion.tr
                    key={supplier.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="cursor-pointer hover:bg-cyber-primary/5 transition-colors"
                    onClick={() => setDetailSupplier(supplier)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-cyber-purple/20 flex items-center justify-center">
                          <Truck className="w-5 h-5 text-cyber-purple" />
                        </div>
                        <div>
                          <p className="text-gray-200 font-medium hover:text-cyber-primary transition-colors">{supplier.name}</p>
                          <p className="text-gray-500 text-xs">{supplier.code}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${
                        supplier.type === 'RAW_MATERIAL' ? 'text-blue-400 bg-blue-500/20 border-blue-500/30' :
                        supplier.type === 'PACKAGING' ? 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' :
                        'text-purple-400 bg-purple-500/20 border-purple-500/30'
                      }`}>
                        {supplier.type === 'RAW_MATERIAL' ? 'Raw Material' : supplier.type === 'PACKAGING' ? 'Packaging' : 'Service'}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">
                        <p className="text-gray-300">{supplier.contact_name}</p>
                        <p className="text-gray-500 text-xs">{supplier.phone}</p>
                      </div>
                    </td>
                    <td><span className="text-gray-400 text-sm">{supplier.payment_terms}</span></td>
                    <td>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star key={star} className={`w-3.5 h-3.5 ${star <= supplier.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                        ))}
                      </div>
                    </td>
                    <td><span className="text-cyber-primary font-semibold">{supplier.total_orders || 0}</span></td>
                    <td><span className="text-cyber-green">฿{(supplier.total_spent || 0).toLocaleString()}</span></td>
                    <td>
                      <span className={`status-badge ${
                        supplier.status === 'ACTIVE' ? 'bg-cyber-green/20 text-cyber-green border-cyber-green/30' :
                        supplier.status === 'BLOCKED' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        'bg-gray-500/20 text-gray-400 border-gray-500/30'
                      }`}>
                        {supplier.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setEditingSupplier(supplier); setShowModal(true) }}
                          className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(supplier.id)}
                          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <SupplierModal
        open={showModal}
        supplier={editingSupplier}
        onClose={() => { setShowModal(false); setEditingSupplier(null) }}
        onSave={loadData}
      />

      {/* Detail Modal */}
      <AnimatePresence>
        {detailSupplier && (
          <SupplierDetailModal
            supplier={detailSupplier}
            onClose={() => setDetailSupplier(null)}
            onEdit={() => {
              setEditingSupplier(detailSupplier)
              setDetailSupplier(null)
              setShowModal(true)
            }}
            onDelete={async () => {
              try {
                await supplierService.delete(detailSupplier.id)
                setDetailSupplier(null)
                loadData()
              } catch (err: any) {
                alert(err.response?.data?.message || 'ไม่สามารถลบผู้จัดจำหน่ายได้')
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
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

function SupplierModal({ open, supplier, onClose, onSave }: {
  open: boolean; supplier: Supplier | null; onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({
    code: '', name: '', type: 'RAW_MATERIAL', contactName: '', email: '', phone: '',
    address: '', city: '', taxId: '', paymentTerms: 'NET30', notes: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (supplier) {
      setForm({
        code: supplier.code, name: supplier.name, type: supplier.type,
        contactName: supplier.contact_name, email: supplier.email, phone: supplier.phone,
        address: supplier.address || '', city: supplier.city || '', taxId: supplier.tax_id || '',
        paymentTerms: supplier.payment_terms, notes: supplier.notes || '',
      })
    } else {
      setForm({ code: '', name: '', type: 'RAW_MATERIAL', contactName: '', email: '', phone: '',
        address: '', city: '', taxId: '', paymentTerms: 'NET30', notes: '' })
    }
  }, [supplier, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (supplier) {
        await supplierService.update(supplier.id, form)
      } else {
        await supplierService.create(form)
      }
      onSave()
      onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="cyber-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-cyber-border flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-100">
                {supplier ? 'Edit Supplier' : 'New Supplier'}
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-cyber-dark rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Code *</label>
                  <input type="text" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="cyber-input w-full" required disabled={!!supplier}
                    placeholder="SUP-001" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Name *</label>
                  <input type="text" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="cyber-input w-full" required placeholder="Company Name" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="cyber-input w-full">
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="PACKAGING">Packaging</option>
                    <option value="SERVICE">Service</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Payment Terms</label>
                  <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                    className="cyber-input w-full">
                    <option value="COD">COD</option>
                    <option value="NET15">NET 15</option>
                    <option value="NET30">NET 30</option>
                    <option value="NET60">NET 60</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Contact Name *</label>
                  <input type="text" value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="cyber-input w-full" required />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Phone</label>
                  <input type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="cyber-input w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Email</label>
                <input type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="cyber-input w-full" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">City</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="cyber-input w-full" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Tax ID</label>
                  <input type="text" value={form.taxId}
                    onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                    className="cyber-input w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Notes</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="cyber-input w-full" rows={3} />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400">Cancel</button>
                <button type="submit" disabled={saving} className="cyber-btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {supplier ? 'Update' : 'Create'} Supplier
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Supplier Detail Modal ────────────────────────────────────────────────────

function SupplierDetailModal({ supplier, onClose, onEdit, onDelete }: {
  supplier: Supplier
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [activeTab, setActiveTab] = useState('overview')
  const [insights, setInsights] = useState<any>(null)
  const [loadingInsights, setLoadingInsights] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)

  useEffect(() => {
    supplierService.getInsights(supplier.id).then(data => {
      setInsights(data)
    }).catch(console.error).finally(() => setLoadingInsights(false))
  }, [supplier.id])

  const typeColor: Record<string, string> = {
    RAW_MATERIAL: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
    PACKAGING: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
    SERVICE: 'text-purple-400 bg-purple-500/20 border-purple-500/30',
    OTHER: 'text-gray-400 bg-gray-500/20 border-gray-500/30',
  }
  const typeLabel: Record<string, string> = {
    RAW_MATERIAL: 'Raw Material', PACKAGING: 'Packaging', SERVICE: 'Service', OTHER: 'Other',
  }
  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    INACTIVE: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    BLOCKED: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  const tabs = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'orders', label: 'คำสั่งซื้อ' },
    { id: 'materials', label: 'วัตถุดิบ' },
  ]

  const stats = insights?.stats

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[95vh] flex overflow-hidden rounded-2xl border border-cyber-border shadow-2xl"
      >
        {/* ── LEFT SIDEBAR ──────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 bg-cyber-card border-r border-cyber-border flex flex-col overflow-y-auto">
          {/* Avatar */}
          <div className="p-6 flex flex-col items-center text-center border-b border-cyber-border">
            <div className="w-20 h-20 rounded-2xl bg-cyber-purple/20 border border-cyber-purple/40 flex items-center justify-center mb-3">
              <Truck className="w-10 h-10 text-cyber-purple" />
            </div>
            <p className="text-lg font-bold text-gray-100 leading-tight">{supplier.name}</p>
            <p className="text-xs text-gray-500 mt-1 font-mono">{supplier.code}</p>
            <div className="flex gap-1.5 mt-3 flex-wrap justify-center">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColor[supplier.type] ?? 'text-gray-400 bg-gray-500/20 border-gray-500/30'}`}>
                {typeLabel[supplier.type] ?? supplier.type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor[supplier.status] ?? ''}`}>
                {supplier.status}
              </span>
            </div>

            {/* Edit / Delete */}
            <div className="mt-4 flex gap-2 w-full">
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-cyber-primary/10 text-cyber-primary border border-cyber-primary/30 text-xs hover:bg-cyber-primary/20 transition-colors"
              >
                <Pencil className="w-3 h-3" /> แก้ไข
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 text-xs hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> ลบ
                </button>
              ) : (
                <div className="flex-1 flex flex-col gap-1">
                  <button
                    onClick={onDelete}
                    className="w-full px-2 py-1 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs hover:bg-red-500/30"
                  >
                    ยืนยันลบ
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="w-full px-2 py-1 rounded-lg bg-cyber-darker text-gray-400 border border-cyber-border text-xs"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Contact Info */}
          <div className="p-4 border-b border-cyber-border space-y-2.5">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">ผู้ติดต่อ</p>
            {supplier.contact_name && (
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <span className="text-gray-500 text-xs">👤</span> {supplier.contact_name}
              </div>
            )}
            {supplier.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Phone className="w-3.5 h-3.5 text-cyber-primary" /> {supplier.phone}
              </div>
            )}
            {supplier.email && (
              <div className="flex items-center gap-2 text-sm text-gray-400 truncate">
                <Mail className="w-3.5 h-3.5 text-cyan-400" />
                <span className="truncate">{supplier.email}</span>
              </div>
            )}
            {supplier.city && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <MapPin className="w-3.5 h-3.5 text-red-400" /> {supplier.city}
              </div>
            )}
          </div>

          {/* Terms + Tax */}
          <div className="p-4 border-b border-cyber-border space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">เงื่อนไข</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Payment Terms</span>
              <span className="text-yellow-400 font-medium">{supplier.payment_terms || '-'}</span>
            </div>
            {supplier.tax_id && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Tax ID</span>
                <span className="text-gray-300 font-mono">{supplier.tax_id}</span>
              </div>
            )}
            <div className="flex gap-0.5 mt-1">
              {[1,2,3,4,5].map(s => (
                <Star key={s} className={`w-3.5 h-3.5 ${s <= supplier.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="p-4 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">สถิติ</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">คำสั่งซื้อ</span>
              <span className="text-cyber-primary font-bold">{supplier.total_orders || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">ยอดซื้อรวม</span>
              <span className="text-cyber-green font-bold">฿{(supplier.total_spent || 0).toLocaleString()}</span>
            </div>
            {stats?.avgOrderValue != null && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">เฉลี่ย/ออเดอร์</span>
                <span className="text-gray-300">฿{Math.round(stats.avgOrderValue).toLocaleString()}</span>
              </div>
            )}
            {stats?.daysSinceLastOrder != null && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">ล่าสุด</span>
                <span className="text-gray-400">{stats.daysSinceLastOrder} วันที่แล้ว</span>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1117]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-cyber-border bg-cyber-card/30">
            <div className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                    activeTab === tab.id
                      ? 'bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/40'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-cyber-border/20'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-cyber-border/30 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {loadingInsights ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-cyber-purple animate-spin" />
              </div>
            ) : (
              <>
                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <div className="space-y-5">
                    {/* Stats cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'คำสั่งซื้อทั้งหมด', value: stats?.totalOrders ?? 0, suffix: 'ครั้ง', color: 'text-cyber-primary' },
                        { label: 'ยอดซื้อรวม', value: `฿${(stats?.totalSpent ?? 0).toLocaleString()}`, suffix: '', color: 'text-cyber-green' },
                        { label: 'เฉลี่ย/ออเดอร์', value: `฿${Math.round(stats?.avgOrderValue ?? 0).toLocaleString()}`, suffix: '', color: 'text-yellow-400' },
                        { label: 'ห่างจากออเดอร์ล่าสุด', value: stats?.daysSinceLastOrder ?? '-', suffix: stats?.daysSinceLastOrder != null ? 'วัน' : '', color: 'text-cyber-purple' },
                      ].map((item, i) => (
                        <div key={i} className="cyber-card p-4">
                          <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                          <p className={`text-xl font-bold ${item.color}`}>
                            {item.value}{item.suffix && <span className="text-sm ml-1 font-normal">{item.suffix}</span>}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Spending Trend */}
                    {insights?.spendingTrend?.length > 0 && (
                      <div className="cyber-card p-4">
                        <p className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-cyber-purple" /> ยอดซื้อรายเดือน (12 เดือนล่าสุด)
                        </p>
                        <SpendingTrendBars trend={insights.spendingTrend} />
                      </div>
                    )}

                    {/* Notes */}
                    {supplier.notes && (
                      <div className="cyber-card p-4">
                        <p className="text-xs text-gray-500 mb-2">หมายเหตุ</p>
                        <p className="text-sm text-gray-300">{supplier.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ORDERS TAB */}
                {activeTab === 'orders' && (
                  <div className="space-y-3">
                    {!insights?.recentOrders?.length ? (
                      <div className="text-center py-12 text-gray-500">
                        <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>ยังไม่มีคำสั่งซื้อ</p>
                      </div>
                    ) : (
                      insights.recentOrders.map((order: any) => (
                        <div key={order.id} className="cyber-card overflow-hidden">
                          <div
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-cyber-border/10 transition-colors"
                            onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-cyber-primary font-mono text-sm font-bold">{order.poNumber}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                order.status === 'COMPLETED' ? 'bg-cyber-green/20 text-cyber-green border-cyber-green/30' :
                                order.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                order.status === 'APPROVED' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                                'bg-gray-500/20 text-gray-400 border-gray-500/30'
                              }`}>{order.status}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-xs text-gray-500">{order.orderDate?.slice(0, 10)}</span>
                              <span className="text-cyber-green font-bold text-sm">฿{(order.totalAmount ?? 0).toLocaleString()}</span>
                              {expandedOrder === order.id
                                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                                : <ChevronDown className="w-4 h-4 text-gray-400" />}
                            </div>
                          </div>
                          {expandedOrder === order.id && order.items?.length > 0 && (
                            <div className="border-t border-cyber-border bg-cyber-darker/50">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-cyber-border">
                                    <th className="px-4 py-2 text-left text-gray-500 font-medium">วัตถุดิบ</th>
                                    <th className="px-4 py-2 text-right text-gray-500 font-medium">จำนวน</th>
                                    <th className="px-4 py-2 text-right text-gray-500 font-medium">ราคา/หน่วย</th>
                                    <th className="px-4 py-2 text-right text-gray-500 font-medium">รวม</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.items.map((item: any, idx: number) => (
                                    <tr key={idx} className="border-b border-cyber-border/40 last:border-0">
                                      <td className="px-4 py-2 text-gray-300">{item.materialName || item.materialId || '-'}</td>
                                      <td className="px-4 py-2 text-right text-gray-400">{item.quantity}</td>
                                      <td className="px-4 py-2 text-right text-gray-400">฿{(item.unitPrice ?? 0).toLocaleString()}</td>
                                      <td className="px-4 py-2 text-right text-cyber-green">฿{(item.totalPrice ?? 0).toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* MATERIALS TAB */}
                {activeTab === 'materials' && (
                  <div className="space-y-4">
                    {!insights?.topMaterials?.length ? (
                      <div className="text-center py-12 text-gray-500">
                        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>ยังไม่มีข้อมูลวัตถุดิบ</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-gray-400 flex items-center gap-2">
                          <Package className="w-4 h-4 text-cyber-purple" /> วัตถุดิบที่สั่งซื้อบ่อย
                        </p>
                        <TopMaterialsChart materials={insights.topMaterials} />
                        <div className="cyber-card overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-cyber-border">
                                <th className="px-4 py-3 text-left text-gray-500 font-medium">วัตถุดิบ</th>
                                <th className="px-4 py-3 text-right text-gray-500 font-medium">จำนวนรวม</th>
                                <th className="px-4 py-3 text-right text-gray-500 font-medium">ราคาเฉลี่ย</th>
                                <th className="px-4 py-3 text-right text-gray-500 font-medium">ยอดรวม</th>
                              </tr>
                            </thead>
                            <tbody>
                              {insights.topMaterials.map((m: any, i: number) => (
                                <tr key={i} className="border-b border-cyber-border/40 last:border-0 hover:bg-cyber-border/10">
                                  <td className="px-4 py-3 text-gray-200 font-medium">{m.materialName || m.materialId || '-'}</td>
                                  <td className="px-4 py-3 text-right text-cyber-primary font-semibold">{m.totalQuantity}</td>
                                  <td className="px-4 py-3 text-right text-gray-400">฿{Math.round(m.avgUnitPrice ?? 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right text-cyber-green font-semibold">฿{(m.totalSpent ?? 0).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Spending Trend Bars (simple SVG-free bar chart) ──────────────────────────
function SpendingTrendBars({ trend }: { trend: { month: string; orderCount: number; totalAmount: number }[] }) {
  const max = Math.max(...trend.map(t => t.totalAmount), 1)
  return (
    <div className="flex items-end gap-1.5 h-28">
      {trend.map((t, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full rounded-t bg-cyber-purple/40 group-hover:bg-cyber-purple/70 transition-all cursor-default"
            style={{ height: `${Math.max((t.totalAmount / max) * 96, 4)}px` }}
          />
          <span className="text-[9px] text-gray-600 whitespace-nowrap">{t.month.slice(5)}</span>
          {/* Tooltip */}
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-cyber-card border border-cyber-border rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            <p className="text-gray-300">{t.month}</p>
            <p className="text-cyber-green">฿{t.totalAmount.toLocaleString()}</p>
            <p className="text-gray-500">{t.orderCount} ออเดอร์</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Top Materials Horizontal Bars ─────────────────────────────────────────────
const MATERIAL_COLORS = ['#a855f7','#06b6d4','#10b981','#f59e0b','#3b82f6','#ef4444','#8b5cf6','#14b8a6','#f97316','#6366f1']

function TopMaterialsChart({ materials }: { materials: any[] }) {
  const top5 = materials.slice(0, 5)
  const maxQty = Math.max(...top5.map(m => m.totalQuantity), 1)
  return (
    <div className="cyber-card p-4 space-y-3">
      {top5.map((m, i) => {
        const pct = Math.round((m.totalQuantity / maxQty) * 100)
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-300 font-medium">{m.materialName || m.materialId || `วัตถุดิบ ${i+1}`}</span>
              <span className="text-gray-500">{m.totalQuantity} หน่วย</span>
            </div>
            <div className="h-2 bg-cyber-darker rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="h-full rounded-full"
                style={{ backgroundColor: MATERIAL_COLORS[i] }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
