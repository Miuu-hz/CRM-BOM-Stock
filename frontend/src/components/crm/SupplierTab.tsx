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
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-cyber-purple/20 flex items-center justify-center">
                          <Truck className="w-5 h-5 text-cyber-purple" />
                        </div>
                        <div>
                          <p className="text-gray-200 font-medium">{supplier.name}</p>
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
                      <div className="flex items-center gap-1">
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

      {/* Modal */}
      <SupplierModal
        open={showModal}
        supplier={editingSupplier}
        onClose={() => { setShowModal(false); setEditingSupplier(null) }}
        onSave={loadData}
      />
    </div>
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
