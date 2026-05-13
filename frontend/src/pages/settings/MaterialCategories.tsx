import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Tag, Plus, Trash2, Edit2, Search, X, Save, Package, Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import materialsService, { MaterialCategory } from '../../services/materials'
import { UNIT_LABELS } from '../../hooks/useUnits'

const ul = (u: string) => UNIT_LABELS[u] ? `${u} (${UNIT_LABELS[u]})` : u

const VALID_UNITS = Object.keys(UNIT_LABELS)

export default function MaterialCategories() {
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<MaterialCategory | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Form state
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [defaultUnit, setDefaultUnit] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    try {
      const data = await materialsService.getCategories()
      setCategories(data ?? [])
    } catch {
      toast.error('โหลดข้อมูลหมวดหมู่ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditTarget(null)
    setCode('')
    setName('')
    setDefaultUnit('')
    setDescription('')
    setShowForm(true)
  }

  const openEdit = (c: MaterialCategory) => {
    setEditTarget(c)
    setCode(c.code)
    setName(c.name)
    setDefaultUnit(c.defaultUnit)
    setDescription(c.description || '')
    setShowForm(true)
  }

  const closeForm = () => { setShowForm(false); setEditTarget(null) }

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || !defaultUnit) {
      return toast.error('กรุณากรอก Code, ชื่อหมวดหมู่ และหน่วยเริ่มต้น')
    }
    setSaving(true)
    try {
      if (editTarget) {
        await materialsService.updateCategory(editTarget.id, {
          name: name.trim(),
          defaultUnit,
          description: description.trim() || undefined,
        })
        toast.success('บันทึกแล้ว')
      } else {
        await materialsService.createCategory({
          code: code.trim(),
          name: name.trim(),
          defaultUnit,
          description: description.trim() || undefined,
        })
        toast.success('เพิ่มหมวดหมู่แล้ว')
      }
      closeForm()
      fetchAll()
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`ลบหมวดหมู่ "${label}" ใช่หรือไม่?`)) return
    try {
      await materialsService.deleteCategory(id)
      toast.success('ลบแล้ว')
      setCategories(prev => prev.filter(c => c.id !== id))
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'ลบไม่สำเร็จ')
    }
  }

  const filtered = !searchTerm
    ? categories
    : categories.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.defaultUnit.toLowerCase().includes(searchTerm.toLowerCase())
      )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-phopy-indigo-50 rounded-lg">
            <Tag className="w-5 h-5 text-phopy-indigo" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--fg-1)]">หมวดหมู่วัตถุดิบ</h2>
            <p className="text-xs text-[var(--fg-3)]">จัดการหมวดหมู่และหน่วยเริ่มต้นสำหรับวัตถุดิบใน BOM</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="phopy-btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          เพิ่มหมวดหมู่
        </button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-phopy-indigo/5 border border-phopy-indigo-50 rounded-lg">
        <Info className="w-4 h-4 text-phopy-indigo mt-0.5 flex-shrink-0" />
        <p className="text-xs text-[var(--fg-3)]">
          หมวดหมู่ถูกใช้ในการจัดกลุ่มวัตถุดิบและกำหนดหน่วยนับเริ่มต้นอัตโนมัติ เมื่อสร้างวัตถุดิบใหม่ใน BOM จะไม่สามารถเปลี่ยนหมวดหมู่ได้ภายหลัง
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" />
        <input
          type="text"
          placeholder="ค้นหาหมวดหมู่ หรือรหัส..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="phopy-input w-full pl-9 pr-4"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Categories List */}
      <div className="phopy-card overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] flex items-center gap-2">
          <Package className="w-4 h-4 text-phopy-indigo" />
          <span className="text-sm font-medium text-[var(--fg-2)]">รายการหมวดหมู่</span>
          <span className="px-2 py-0.5 bg-phopy-indigo-50 text-phopy-indigo text-xs rounded-full">
            {categories.length} รายการ
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-[var(--fg-4)] text-sm">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center">
            <Tag className="w-10 h-10 text-[var(--fg-4)] mx-auto mb-2" />
            <p className="text-[var(--fg-4)] text-sm">ยังไม่มีหมวดหมู่วัตถุดิบ</p>
            <p className="text-[var(--fg-4)] text-xs mt-1">เพิ่มหมวดหมู่แรก เช่น วัตถุดิบทั่วไป, สารเคมี, อุปกรณ์</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/30">
            {filtered.map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-phopy-indigo/10 flex items-center justify-center flex-shrink-0">
                    <Tag className="w-4 h-4 text-phopy-indigo" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--fg-2)] font-medium text-sm">{c.name}</span>
                      <span className="px-2 py-0.5 bg-phopy-indigo-50 border border-phopy-indigo/30 rounded text-[11px] text-phopy-indigo font-mono font-bold tracking-wide">{c.code}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--fg-4)] mt-0.5">
                      <span>หน่วยเริ่มต้น: <span className="text-phopy-indigo font-medium">{ul(c.defaultUnit)}</span></span>
                      {c.description && <span className="truncate max-w-[200px]">· {c.description}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEdit(c)}
                    className="p-1.5 text-[var(--fg-3)] hover:text-phopy-indigo hover:bg-phopy-indigo/10 rounded-lg transition-colors"
                    title="แก้ไข"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id, c.name)}
                    className="p-1.5 text-[var(--fg-3)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="ลบ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── MODAL FORM ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeForm}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="phopy-card w-full max-w-md"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-phopy-indigo" />
                  <h3 className="font-semibold text-[var(--fg-1)]">
                    {editTarget ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่วัตถุดิบ'}
                  </h3>
                </div>
                <button onClick={closeForm} className="text-[var(--fg-3)] hover:text-[var(--fg-2)] transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">รหัส (Code) *</label>
                    <input
                      type="text"
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      disabled={!!editTarget}
                      placeholder="เช่น RAW, CHEM"
                      className="phopy-input w-full disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">หน่วยเริ่มต้น *</label>
                    <select
                      value={defaultUnit}
                      onChange={e => setDefaultUnit(e.target.value)}
                      className="phopy-input w-full"
                    >
                      <option value="">เลือกหน่วย</option>
                      {VALID_UNITS.map(u => (
                        <option key={u} value={u}>{ul(u)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">ชื่อหมวดหมู่ *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="เช่น วัตถุดิบทั่วไป, สารเคมี"
                    className="phopy-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">คำอธิบาย (ไม่บังคับ)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="เช่น ใช้สำหรับวัตถุดิบหลักในการผลิต"
                    className="phopy-input w-full"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={closeForm} className="flex-1 py-2.5 border border-[var(--border)] text-[var(--fg-2)] hover:text-[var(--fg-1)] rounded-lg text-sm transition-colors">
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 py-2.5 bg-phopy-indigo hover:bg-phopy-indigo-600 disabled:opacity-50 text-black rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {saving ? <span className="animate-pulse">กำลังบันทึก...</span> : <><Save className="w-4 h-4" />บันทึก</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
