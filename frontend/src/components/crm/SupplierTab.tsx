import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {Truck, Plus, Search, Edit2, Trash2, X, Star, Loader2, Phone, Mail, MapPin, ShoppingCart, TrendingUp, Package, ChevronDown, ChevronUp, Pencil, User} from 'lucide-react'
import supplierService, { Supplier, SupplierStats } from '../../services/supplier'
import { useTranslation } from 'react-i18next'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

export default function SupplierTab() {
  const { t } = useTranslation()
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
    if (!confirm(t('crm.suppliers.confirmDelete', { defaultValue: 'Are you sure you want to delete this supplier?' }))) return
    try {
      await supplierService.delete(id)
      loadData()
    } catch (err: any) {
      alert(err.response?.data?.message || t('crm.suppliers.deleteFailed'))
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
        <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label={t('crm.suppliers.stats.totalSuppliers')} value={(stats?.totalSuppliers ?? 0).toString()} color="text-[var(--primary)]" />
        <StatCard label={t('crm.suppliers.stats.active')} value={(stats?.activeSuppliers ?? 0).toString()} color="text-success" />
        <StatCard label={t('crm.suppliers.stats.purchaseOrders')} value={(stats?.totalPOs ?? 0).toString()} color="text-warning" />
        <StatCard label={t('crm.suppliers.stats.totalSpent')} value={`฿${(stats?.totalSpent ?? 0).toLocaleString()}`} color="text-[var(--primary)]" />
      </div>

      {/* Toolbar */}
      <div className="phopy-card p-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
            <input
              type="text"
              placeholder={t('crm.suppliers.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="phopy-input pl-10 w-full"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'RAW_MATERIAL', 'PACKAGING', 'SERVICE'].map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedType === type
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
                    : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)]'
                }`}
              >
                {type === 'all' ? t('crm.suppliers.type.all') : type === 'RAW_MATERIAL' ? t('crm.suppliers.supplierType.rawMaterial') : type === 'PACKAGING' ? t('crm.suppliers.supplierType.packaging') : t('crm.suppliers.supplierType.service')}
              </button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { setEditingSupplier(null); setShowModal(true) }}
            className="phopy-btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" /> {t('crm.suppliers.addSupplier')}</motion.button>
        </div>
      </div>

      {/* Supplier List */}
      <div className="phopy-card p-6">
        <div className="overflow-x-auto">
          <table className="phopy-table">
            <thead>
              <tr>
                <th>{t('crm.suppliers.table.supplier')}</th>
                <th>{t('crm.suppliers.table.type')}</th>
                <th>{t('crm.suppliers.table.contact')}</th>
                <th>{t('crm.suppliers.table.paymentTerms')}</th>
                <th>{t('crm.suppliers.table.rating')}</th>
                <th>{t('crm.suppliers.table.orders')}</th>
                <th>{t('crm.suppliers.stats.totalSpent')}</th>
                <th>{t('crm.suppliers.table.status')}</th>
                <th>{t('crm.suppliers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-[var(--fg-4)]">{t('crm.suppliers.noSuppliers')}</td></tr>
              ) : (
                (filtered || []).map((supplier, i) => (
                  <motion.tr
                    key={supplier.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="cursor-pointer hover:bg-phopy-indigo/5 transition-colors"
                    onClick={() => setDetailSupplier(supplier)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/20 flex items-center justify-center">
                          <Truck className="w-5 h-5 text-[var(--primary)]" />
                        </div>
                        <div>
                          <p className="text-[var(--fg-2)] font-medium hover:text-[var(--primary)] transition-colors">{supplier.name}</p>
                          <p className="text-[var(--fg-4)] text-xs">{supplier.code}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${
                        supplier.type === 'RAW_MATERIAL' ? 'text-blue-400 bg-[var(--info-soft)] border-info/30' :
                        supplier.type === 'PACKAGING' ? 'text-warning bg-[var(--warning-soft)] border-warning/30' :
                        'text-purple-400 bg-[var(--primary)]/20 border-purple-500/30'
                      }`}>
                        {t(`crm.suppliers.supplierType.${supplier.type.toLowerCase()}`)}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">
                        <p className="text-[var(--fg-2)]">{supplier.contact_name}</p>
                        <p className="text-[var(--fg-4)] text-xs">{supplier.phone}</p>
                      </div>
                    </td>
                    <td><span className="text-[var(--fg-3)] text-sm">{supplier.payment_terms}</span></td>
                    <td>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star key={star} className={`w-3.5 h-3.5 ${star <= supplier.rating ? 'text-warning fill-warning' : 'text-[var(--fg-4)]'}`} />
                        ))}
                      </div>
                    </td>
                    <td><span className="text-[var(--primary)] font-semibold">{supplier.total_orders || 0}</span></td>
                    <td><span className="text-success">฿{(supplier.total_spent || 0).toLocaleString()}</span></td>
                    <td>
                      <span className={`status-badge ${
                        supplier.status === 'ACTIVE' ? 'bg-[var(--success-soft)] text-success border-success/30' :
                        supplier.status === 'BLOCKED' ? 'bg-[var(--danger-soft)] text-danger border-danger/30' :
                        'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]'
                      }`}>
                        {t(`crm.suppliers.status.${supplier.status.toLowerCase()}`, { defaultValue: supplier.status })}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setEditingSupplier(supplier); setShowModal(true) }}
                          className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(supplier.id)}
                          className="p-2 text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] rounded-lg">
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
                alert(err.response?.data?.message || t('crm.suppliers.deleteFailed'))
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const { t } = useTranslation()
  return (
    <div className="phopy-card p-4">
      <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function SupplierModal({ open, supplier, onClose, onSave }: {
  open: boolean; supplier: Supplier | null; onClose: () => void; onSave: () => void
}) {
  const { t } = useTranslation()
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
      alert(err.response?.data?.message || t('crm.suppliers.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                {supplier ? t('crm.suppliers.modal.editSupplier') : t('crm.suppliers.modal.newSupplier')}
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg">
                <X className="w-5 h-5 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.code')}</label>
                  <input type="text" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="phopy-input w-full" required disabled={!!supplier}
                    placeholder={t('crm.suppliers.modal.codePlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.name')}</label>
                  <input type="text" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="phopy-input w-full" required placeholder={t('crm.suppliers.modal.namePlaceholder')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.table.type')}</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="phopy-input w-full">
                    <option value="RAW_MATERIAL">{t('crm.suppliers.supplierType.rawMaterial')}</option>
                    <option value="PACKAGING">{t('crm.suppliers.supplierType.packaging')}</option>
                    <option value="SERVICE">{t('crm.suppliers.supplierType.service')}</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.table.paymentTerms')}</label>
                  <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                    className="phopy-input w-full">
                    <option value="COD">COD</option>
                    <option value="NET15">NET 15</option>
                    <option value="NET30">NET 30</option>
                    <option value="NET60">NET 60</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">Contact Name *</label>
                  <input type="text" value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="phopy-input w-full" required />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.phone')}</label>
                  <input type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="phopy-input w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.email')}</label>
                <input type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="phopy-input w-full" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.city')}</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="phopy-input w-full" />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.taxId')}</label>
                  <input type="text" value={form.taxId}
                    onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                    className="phopy-input w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-2">{t('crm.suppliers.modal.notes')}</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="phopy-input w-full" rows={3} />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)]">{t('crm.suppliers.modal.cancel')}</button>
                <button type="submit" disabled={saving} className="phopy-btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {supplier ? t('crm.suppliers.modal.updateSupplier') : t('crm.suppliers.modal.createSupplier')}
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
  const { t } = useTranslation()
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
    RAW_MATERIAL: 'text-blue-400 bg-[var(--info-soft)] border-info/30',
    PACKAGING: 'text-warning bg-[var(--warning-soft)] border-warning/30',
    SERVICE: 'text-purple-400 bg-[var(--primary)]/20 border-purple-500/30',
    OTHER: 'text-[var(--fg-3)] bg-[var(--surface-sunken)] border-[var(--border-strong)]',
  }
  const typeLabel: Record<string, string> = {
    RAW_MATERIAL: 'crm.suppliers.supplierType.rawMaterial', PACKAGING: 'crm.suppliers.supplierType.packaging', SERVICE: 'crm.suppliers.supplierType.service', OTHER: 'crm.suppliers.supplierType.other',
  }
  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-[var(--success-soft)] text-success border-success/30',
    INACTIVE: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]',
    BLOCKED: 'bg-[var(--danger-soft)] text-danger border-danger/30',
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
      className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[95vh] flex overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl"
      >
        {/* ── LEFT SIDEBAR ──────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col overflow-y-auto">
          {/* Avatar */}
          <div className="p-6 flex flex-col items-center text-center border-b border-[var(--border)]">
            <div className="w-20 h-20 rounded-2xl bg-[var(--primary)]/20 border border-[var(--primary)]/40 flex items-center justify-center mb-3">
              <Truck className="w-10 h-10 text-[var(--primary)]" />
            </div>
            <p className="text-lg font-bold text-[var(--fg-1)] leading-tight">{supplier.name}</p>
            <p className="text-xs text-[var(--fg-4)] mt-1 font-mono">{supplier.code}</p>
            <div className="flex gap-1.5 mt-3 flex-wrap justify-center">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColor[supplier.type] ?? 'text-[var(--fg-3)] bg-[var(--surface-sunken)] border-[var(--border-strong)]'}`}>
                {t(typeLabel[supplier.type] ?? supplier.type)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor[supplier.status] ?? ''}`}>
                {t(`crm.suppliers.status.${supplier.status.toLowerCase()}`, { defaultValue: supplier.status })}
              </span>
            </div>

            {/* Edit / Delete */}
            <div className="mt-4 flex gap-2 w-full">
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] border border-phopy-indigo/30 text-xs hover:bg-[var(--primary-soft)] transition-colors"
              >
                <Pencil className="w-3 h-3" /> แก้ไข
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--danger-soft)] text-danger border border-danger/30 text-xs hover:bg-[var(--danger-soft)] transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> ลบ
                </button>
              ) : (
                <div className="flex-1 flex flex-col gap-1">
                  <button
                    onClick={onDelete}
                    className="w-full px-2 py-1 rounded-lg bg-[var(--danger-soft)] text-danger border border-danger/40 text-xs hover:bg-[var(--danger-soft)]"
                  >
                    ยืนยันลบ
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="w-full px-2 py-1 rounded-lg bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)] text-xs"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Contact Info */}
          <div className="p-4 border-b border-[var(--border)] space-y-2.5">
            <p className="text-xs text-[var(--fg-4)] uppercase tracking-widest mb-1">{t('crm.suppliers.detail.contact')}</p>
            {supplier.contact_name && (
              <div className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
                <span className="text-[var(--fg-4)] text-xs"><User className="w-4 h-4" /></span> {supplier.contact_name}
              </div>
            )}
            {supplier.phone && (
              <div className="flex items-center gap-2 text-sm text-[var(--fg-3)]">
                <Phone className="w-3.5 h-3.5 text-[var(--primary)]" /> {supplier.phone}
              </div>
            )}
            {supplier.email && (
              <div className="flex items-center gap-2 text-sm text-[var(--fg-3)] truncate">
                <Mail className="w-3.5 h-3.5 text-cyan-400" />
                <span className="truncate">{supplier.email}</span>
              </div>
            )}
            {supplier.city && (
              <div className="flex items-center gap-2 text-sm text-[var(--fg-3)]">
                <MapPin className="w-3.5 h-3.5 text-danger" /> {supplier.city}
              </div>
            )}
          </div>

          {/* Terms + Tax */}
          <div className="p-4 border-b border-[var(--border)] space-y-2">
            <p className="text-xs text-[var(--fg-4)] uppercase tracking-widest mb-1">{t('crm.suppliers.detail.terms')}</p>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--fg-4)]">{t('crm.suppliers.table.paymentTerms')}</span>
              <span className="text-warning font-medium">{supplier.payment_terms || '-'}</span>
            </div>
            {supplier.tax_id && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-4)]">{t('crm.suppliers.modal.taxId')}</span>
                <span className="text-[var(--fg-2)] font-mono">{supplier.tax_id}</span>
              </div>
            )}
            <div className="flex gap-0.5 mt-1">
              {[1,2,3,4,5].map(s => (
                <Star key={s} className={`w-3.5 h-3.5 ${s <= supplier.rating ? 'text-warning fill-warning' : 'text-[var(--fg-4)]'}`} />
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="p-4 space-y-2">
            <p className="text-xs text-[var(--fg-4)] uppercase tracking-widest mb-1">{t('crm.suppliers.detail.stats')}</p>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--fg-4)]">{t('crm.suppliers.detail.tabs.orders')}</span>
              <span className="text-[var(--primary)] font-bold">{supplier.total_orders || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--fg-4)]">{t('crm.suppliers.detail.totalSpent')}</span>
              <span className="text-success font-bold">฿{(supplier.total_spent || 0).toLocaleString()}</span>
            </div>
            {stats?.avgOrderValue != null && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-4)]">{t('crm.suppliers.detail.avgPerOrder')}</span>
                <span className="text-[var(--fg-2)]">฿{Math.round(stats.avgOrderValue).toLocaleString()}</span>
              </div>
            )}
            {stats?.daysSinceLastOrder != null && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-4)]">{t('crm.suppliers.detail.latest')}</span>
                <span className="text-[var(--fg-3)]">{stats.daysSinceLastOrder} วันที่แล้ว</span>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--surface)]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <div className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                    activeTab === tab.id
                      ? 'bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/40'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--border)]/20'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-[var(--border)]/30 rounded-lg">
              <X className="w-5 h-5 text-[var(--fg-3)]" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {loadingInsights ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
              </div>
            ) : (
              <>
                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <div className="space-y-5">
                    {/* Stats cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'คำสั่งซื้อทั้งหมด', value: stats?.totalOrders ?? 0, suffix: 'ครั้ง', color: 'text-[var(--primary)]' },
                        { label: 'ยอดซื้อรวม', value: `฿${(stats?.totalSpent ?? 0).toLocaleString()}`, suffix: '', color: 'text-success' },
                        { label: 'เฉลี่ย/ออเดอร์', value: `฿${Math.round(stats?.avgOrderValue ?? 0).toLocaleString()}`, suffix: '', color: 'text-warning' },
                        { label: 'ห่างจากออเดอร์ล่าสุด', value: stats?.daysSinceLastOrder ?? '-', suffix: stats?.daysSinceLastOrder != null ? 'วัน' : '', color: 'text-[var(--primary)]' },
                      ].map((item, i) => (
                        <div key={i} className="phopy-card p-4">
                          <p className="text-xs text-[var(--fg-4)] mb-1">{item.label}</p>
                          <p className={`text-xl font-bold ${item.color}`}>
                            {item.value}{item.suffix && <span className="text-sm ml-1 font-normal">{item.suffix}</span>}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Spending Trend */}
                    {insights?.spendingTrend?.length > 0 && (
                      <div className="phopy-card p-4">
                        <p className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-[var(--primary)]" /> ยอดซื้อรายเดือน (12 เดือนล่าสุด)
                        </p>
                        <SpendingTrendBars trend={insights.spendingTrend} />
                      </div>
                    )}

                    {/* Notes */}
                    {supplier.notes && (
                      <div className="phopy-card p-4">
                        <p className="text-xs text-[var(--fg-4)] mb-2">{t('crm.suppliers.detail.notes')}</p>
                        <p className="text-sm text-[var(--fg-2)]">{supplier.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ORDERS TAB */}
                {activeTab === 'orders' && (
                  <div className="space-y-3">
                    {!insights?.recentOrders?.length ? (
                      <div className="text-center py-12 text-[var(--fg-4)]">
                        <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>{t('crm.suppliers.detail.noOrders')}</p>
                      </div>
                    ) : (
                      insights.recentOrders.map((order: any) => (
                        <div key={order.id} className="phopy-card overflow-hidden">
                          <div
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-[var(--border)]/10 transition-colors"
                            onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-[var(--primary)] font-mono text-sm font-bold">{order.poNumber}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                order.status === 'COMPLETED' ? 'bg-[var(--success-soft)] text-success border-success/30' :
                                order.status === 'PENDING' ? 'bg-[var(--warning-soft)] text-warning border-warning/30' :
                                order.status === 'APPROVED' ? 'bg-[var(--info-soft)] text-blue-400 border-info/30' :
                                'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]'
                              }`}>{order.status}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-xs text-[var(--fg-4)]">{order.orderDate?.slice(0, 10)}</span>
                              <span className="text-success font-bold text-sm">฿{(order.totalAmount ?? 0).toLocaleString()}</span>
                              {expandedOrder === order.id
                                ? <ChevronUp className="w-4 h-4 text-[var(--fg-3)]" />
                                : <ChevronDown className="w-4 h-4 text-[var(--fg-3)]" />}
                            </div>
                          </div>
                          {expandedOrder === order.id && order.items?.length > 0 && (
                            <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/50">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-[var(--border)]">
                                    <th className="px-4 py-2 text-left text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.material')}</th>
                                    <th className="px-4 py-2 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.quantity')}</th>
                                    <th className="px-4 py-2 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.unitPrice')}</th>
                                    <th className="px-4 py-2 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.total')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.items.map((item: any, idx: number) => (
                                    <tr key={idx} className="border-b border-[var(--border)]/40 last:border-0">
                                      <td className="px-4 py-2 text-[var(--fg-2)]">{item.materialName || item.materialId || '-'}</td>
                                      <td className="px-4 py-2 text-right text-[var(--fg-3)]">{item.quantity}</td>
                                      <td className="px-4 py-2 text-right text-[var(--fg-3)]">฿{(item.unitPrice ?? 0).toLocaleString()}</td>
                                      <td className="px-4 py-2 text-right text-success">฿{(item.totalPrice ?? 0).toLocaleString()}</td>
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
                      <div className="text-center py-12 text-[var(--fg-4)]">
                        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>{t('crm.suppliers.detail.noMaterials')}</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-[var(--fg-3)] flex items-center gap-2">
                          <Package className="w-4 h-4 text-[var(--primary)]" /> วัตถุดิบที่สั่งซื้อบ่อย
                        </p>
                        <TopMaterialsChart materials={insights.topMaterials} />
                        <div className="phopy-card overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[var(--border)]">
                                <th className="px-4 py-3 text-left text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.material')}</th>
                                <th className="px-4 py-3 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.totalQuantity')}</th>
                                <th className="px-4 py-3 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.avgPrice')}</th>
                                <th className="px-4 py-3 text-right text-[var(--fg-4)] font-medium">{t('crm.suppliers.detail.totalSpentShort')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {insights.topMaterials.map((m: any, i: number) => (
                                <tr key={i} className="border-b border-[var(--border)]/40 last:border-0 hover:bg-[var(--border)]/10">
                                  <td className="px-4 py-3 text-[var(--fg-2)] font-medium">{m.materialName || m.materialId || '-'}</td>
                                  <td className="px-4 py-3 text-right text-[var(--primary)] font-semibold">{m.totalQuantity}</td>
                                  <td className="px-4 py-3 text-right text-[var(--fg-3)]">฿{Math.round(m.avgUnitPrice ?? 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right text-success font-semibold">฿{(m.totalSpent ?? 0).toLocaleString()}</td>
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

// -- Spending Trend (monthly purchase amount) --------------------------------
function SpendingTrendBars({ trend }: { trend: { month: string; orderCount: number; totalAmount: number }[] }) {
  const fmtK = (v: number) =>
    v >= 1_000_000 ? `฿${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `฿${Math.round(v / 1000)}k` : `฿${v}`
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={(m: string) => (m ? m.slice(2) : '')}
          tick={{ fill: 'var(--fg-4)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
        />
        <YAxis
          tickFormatter={fmtK}
          tick={{ fill: 'var(--fg-4)', fontSize: 11 }}
          width={52}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--fg-2)' }}
          formatter={(v: number, _n: any, pl: any) => [`฿${v.toLocaleString()} · ${pl?.payload?.orderCount ?? 0} ออเดอร์`, 'ยอดซื้อ']}
        />
        <Bar dataKey="totalAmount" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Top Materials Horizontal Bars ─────────────────────────────────────────────
const MATERIAL_COLORS = ['#3949E5','#16A34A','#F5A524','#8B5CF6','#EC4899','#0EA5E9','#EF4444','#64748B','#14B8A6','#A855F7']  // distinct categorical hues

function TopMaterialsChart({ materials }: { materials: any[] }) {
  const top5 = materials.slice(0, 5)
  const maxQty = Math.max(...top5.map(m => m.totalQuantity), 1)
  return (
    <div className="phopy-card p-4 space-y-3">
      {top5.map((m, i) => {
        const pct = Math.round((m.totalQuantity / maxQty) * 100)
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--fg-2)] font-medium">{m.materialName || m.materialId || `วัตถุดิบ ${i+1}`}</span>
              <span className="text-[var(--fg-4)]">{m.totalQuantity} หน่วย</span>
            </div>
            <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
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
