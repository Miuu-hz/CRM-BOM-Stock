import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeftRight, Plus, Trash2, Edit2, Globe, Lock,
  Search, X, Save, ChevronDown, ChevronUp, Info, Package,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { invalidateUnitsCache } from '../../hooks/useUnits'

interface UnitConversion {
  id: string
  material_id: string | null
  from_unit: string
  to_unit: string
  conversion_factor: number
  is_global: number
  notes?: string
  material_name?: string
  material_sku?: string
}

interface StandardConversion {
  from_unit: string
  to_unit: string
  factor: number
}

interface StockItem {
  id: string
  name: string
  sku: string
  unit: string
}

const UNIT_LABELS: Record<string, string> = {
  pcs: 'ชิ้น', kg: 'กิโลกรัม', g: 'กรัม', mg: 'มิลลิกรัม',
  lb: 'ปอนด์', oz: 'ออนซ์', m: 'เมตร', cm: 'เซนติเมตร',
  mm: 'มิลลิเมตร', km: 'กิโลเมตร', inch: 'นิ้ว', ft: 'ฟุต',
  yard: 'หลา', l: 'ลิตร', ltr: 'ลิตร', ml: 'มิลลิลิตร',
  gallon: 'แกลลอน', roll: 'ม้วน', box: 'กล่อง', pack: 'แพ็ค',
  set: 'ชุด', pair: 'คู่', sheet: 'แผ่น', bottle: 'ขวด',
  bag: 'ถุง', sachet: 'ซอง', dozen: 'โหล', gross: 'กุรอส',
  case: 'ลัง', can: 'กระป๋อง', tube: 'หลอด', tablet: 'เม็ด',
}

const ul = (u: string) => UNIT_LABELS[u] ? `${u} (${UNIT_LABELS[u]})` : u
const unitLabel = (u: string) => UNIT_LABELS[u] ?? u

const STANDARD_GROUPS = [
  { label: 'น้ำหนัก', units: ['kg', 'g', 'mg', 'lb', 'oz'] },
  { label: 'ความยาว', units: ['m', 'cm', 'mm', 'km', 'inch', 'ft', 'yard'] },
  { label: 'ปริมาตร', units: ['l', 'ltr', 'ml', 'gallon'] },
  { label: 'หน่วยนับสากล', units: ['pcs', 'dozen', 'gross', 'pair'] },
]

export default function UnitConversions() {
  const [allConversions, setAllConversions] = useState<UnitConversion[]>([])
  const [standards, setStandards] = useState<StandardConversion[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<UnitConversion | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'น้ำหนัก': true, 'ความยาว': true, 'ปริมาตร': false, 'หน่วยนับสากล': true,
  })

  // Form state
  const [fromUnit, setFromUnit] = useState('')
  const [toUnit, setToUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Material selector state
  const [selectedMaterial, setSelectedMaterial] = useState<StockItem | null>(null)
  const [materialSearch, setMaterialSearch] = useState('')
  const [materialResults, setMaterialResults] = useState<StockItem[]>([])
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false)
  const [allStock, setAllStock] = useState<StockItem[]>([])
  const materialRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (materialRef.current && !materialRef.current.contains(e.target as Node)) {
        setShowMaterialDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [allRes, stdRes, stockRes] = await Promise.all([
        api.get('/materials/unit-conversions/all'),
        api.get('/materials/unit-conversions/standards'),
        api.get('/stock'),
      ])
      setAllConversions(allRes.data.data ?? [])
      setStandards(stdRes.data.data ?? [])
      setAllStock(stockRes.data.data ?? stockRes.data ?? [])
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const handleMaterialSearch = (val: string) => {
    setMaterialSearch(val)
    setShowMaterialDropdown(true)
    if (!val.trim()) {
      setMaterialResults(allStock.slice(0, 8))
      return
    }
    const q = val.toLowerCase()
    setMaterialResults(
      allStock.filter(s => s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)).slice(0, 8)
    )
  }

  const openCreate = () => {
    setEditTarget(null)
    setFromUnit('')
    setToUnit('')
    setFactor('')
    setNotes('')
    setSelectedMaterial(null)
    setMaterialSearch('')
    setShowForm(true)
  }

  const openEdit = (c: UnitConversion) => {
    setEditTarget(c)
    setFromUnit(c.from_unit)
    setToUnit(c.to_unit)
    setFactor(String(c.conversion_factor))
    setNotes(c.notes ?? '')
    setSelectedMaterial(c.material_id ? { id: c.material_id, name: c.material_name ?? '', sku: c.material_sku ?? '', unit: '' } : null)
    setMaterialSearch(c.material_name ?? '')
    setShowForm(true)
  }

  const closeForm = () => { setShowForm(false); setEditTarget(null) }

  const handleSave = async () => {
    if (!fromUnit.trim() || !toUnit.trim() || !factor) return toast.error('กรุณาระบุหน่วยและค่าแปลง')
    if (Number(factor) <= 0) return toast.error('ค่าแปลงต้องมากกว่า 0')
    if (fromUnit.trim() === toUnit.trim()) return toast.error('หน่วยต้นทางและปลายทางต้องไม่เหมือนกัน')
    setSaving(true)
    try {
      if (editTarget) {
        await api.put(`/materials/unit-conversions/${editTarget.id}`, {
          conversion_factor: Number(factor),
          notes: notes.trim() || undefined,
        })
        toast.success('บันทึกแล้ว')
      } else {
        await api.post('/materials/unit-conversions', {
          from_unit: fromUnit.trim().toLowerCase(),
          to_unit: toUnit.trim().toLowerCase(),
          conversion_factor: Number(factor),
          notes: notes.trim() || undefined,
          material_id: selectedMaterial?.id ?? undefined,
        })
        toast.success('เพิ่มการแปลงหน่วยแล้ว')
      }
      invalidateUnitsCache()
      closeForm()
      fetchAll()
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`ลบการแปลง "${label}" ใช่หรือไม่?`)) return
    try {
      await api.delete(`/materials/unit-conversions/${id}`)
      toast.success('ลบแล้ว')
      invalidateUnitsCache()
      setAllConversions(prev => prev.filter(c => c.id !== id))
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'ลบไม่สำเร็จ')
    }
  }

  // แยก global vs per-material
  const globalConversions = allConversions.filter(c => !c.material_id)
  const perMaterialConversions = allConversions.filter(c => !!c.material_id)

  // จัดกลุ่ม per-material ตามสินค้า
  const perMaterialGroups = perMaterialConversions.reduce<Record<string, { name: string; sku: string; items: UnitConversion[] }>>((acc, c) => {
    const key = c.material_id!
    if (!acc[key]) acc[key] = { name: c.material_name ?? key, sku: c.material_sku ?? '', items: [] }
    acc[key].items.push(c)
    return acc
  }, {})

  const filterConv = (list: UnitConversion[]) =>
    !searchTerm ? list : list.filter(c =>
      c.from_unit.includes(searchTerm.toLowerCase()) ||
      c.to_unit.includes(searchTerm.toLowerCase()) ||
      unitLabel(c.from_unit).includes(searchTerm) ||
      unitLabel(c.to_unit).includes(searchTerm) ||
      (c.material_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    )

  const toggleGroup = (label: string) =>
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }))

  const ConversionRow = ({ c }: { c: UnitConversion }) => (
    <motion.div
      key={c.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/20 transition-colors"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="px-2.5 py-1 bg-blue-500/15 text-blue-300 rounded-md text-sm font-mono whitespace-nowrap">
          1 {unitLabel(c.from_unit)}
        </span>
        <ArrowLeftRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        <span className="px-2.5 py-1 bg-green-500/15 text-green-300 rounded-md text-sm font-mono whitespace-nowrap">
          {c.conversion_factor} {unitLabel(c.to_unit)}
        </span>
        <span className="text-gray-600 text-xs font-mono hidden sm:block">
          ({c.from_unit} → {c.to_unit})
        </span>
      </div>
      {c.notes && <span className="text-gray-500 text-xs truncate max-w-[140px] hidden md:block">{c.notes}</span>}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => handleDelete(c.id, `${c.from_unit} → ${c.to_unit}`)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <ArrowLeftRight className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-100">การแปลงหน่วย</h2>
            <p className="text-xs text-gray-400">กำหนดอัตราแปลงระหว่างหน่วยนับ ทั่วไป หรือเฉพาะสินค้า</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          เพิ่มการแปลงหน่วย
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="ค้นหาหน่วย หรือชื่อสินค้า..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── SECTION 1: Global Conversions ── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="p-4 border-b border-gray-700/50 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-200">ทั่วไป (ใช้กับทุกสินค้า)</span>
          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full">
            {globalConversions.length} รายการ
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">กำลังโหลด...</div>
        ) : filterConv(globalConversions).length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-gray-500 text-sm">ยังไม่มีการแปลงหน่วยทั่วไป</p>
            <p className="text-gray-600 text-xs mt-1">ตัวอย่าง: 1 ลัง = 12 กล่อง</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/30">
            {filterConv(globalConversions).map(c => <ConversionRow key={c.id} c={c} />)}
          </div>
        )}
      </div>

      {/* ── SECTION 2: Per-Material Conversions ── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="p-4 border-b border-gray-700/50 flex items-center gap-2">
          <Package className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-gray-200">เฉพาะสินค้า (override per item)</span>
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded-full">
            {perMaterialConversions.length} รายการ
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">กำลังโหลด...</div>
        ) : Object.keys(perMaterialGroups).length === 0 ? (
          <div className="p-6 text-center">
            <Package className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">ยังไม่มีการแปลงเฉพาะสินค้า</p>
            <p className="text-gray-600 text-xs mt-1">ใช้เมื่อสินค้าแต่ละชิ้นมีขนาดบรรจุต่างกัน เช่น แป้ง A: 1 ถุง = 25 kg</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/30">
            {Object.entries(perMaterialGroups)
              .filter(([, g]) => !searchTerm || filterConv(g.items).length > 0)
              .map(([materialId, group]) => (
                <div key={materialId}>
                  <div className="px-4 py-2 bg-amber-500/5 flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-amber-400/70" />
                    <span className="text-xs font-medium text-amber-300">{group.name}</span>
                    {group.sku && <span className="text-xs text-gray-500 font-mono">{group.sku}</span>}
                    <span className="ml-auto text-xs text-gray-600">{group.items.length} รายการ</span>
                  </div>
                  {filterConv(group.items).map(c => <ConversionRow key={c.id} c={c} />)}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── SECTION 3: Built-in Standards ── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="p-4 border-b border-gray-700/50 flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-gray-200">มาตราสากล (Built-in)</span>
          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs rounded-full">{standards.length} รายการ</span>
          <div className="flex items-center gap-1 ml-2 text-xs text-gray-500">
            <Lock className="w-3 h-3" /><span>แก้ไขไม่ได้</span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
            <Info className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-400">
              ระบบรองรับมาตราสากลอัตโนมัติ เช่น kg↔g, inch↔cm, L↔ml, โหล=12ชิ้น, กุรอส=144ชิ้น
              ไม่ต้องตั้งค่าเพิ่มเติม ใช้งานได้ทันทีใน BOM และ Stock Movement
            </p>
          </div>

          {STANDARD_GROUPS.map(group => {
            const groupConversions = standards.filter(s =>
              group.units.includes(s.from_unit) && group.units.includes(s.to_unit)
            )
            const isOpen = expandedGroups[group.label]
            return (
              <div key={group.label} className="border border-gray-700/30 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-700/20 hover:bg-gray-700/30 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-300">{group.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{groupConversions.length} คู่</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </div>
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-2">
                        {groupConversions.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-700/20 rounded-lg text-xs">
                            <span className="text-gray-400 font-mono">1 {s.from_unit}</span>
                            <span className="text-gray-600">=</span>
                            <span className="text-emerald-400 font-mono">{s.factor} {s.to_unit}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
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
              className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-purple-400" />
                  <h3 className="font-semibold text-gray-100">
                    {editTarget ? 'แก้ไขการแปลงหน่วย' : 'เพิ่มการแปลงหน่วย'}
                  </h3>
                </div>
                <button onClick={closeForm} className="text-gray-400 hover:text-gray-200 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Preview */}
                {fromUnit && toUnit && factor && Number(factor) > 0 && (
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-center">
                    <span className="text-purple-300 font-medium">
                      1 {unitLabel(fromUnit) || fromUnit} = {factor} {unitLabel(toUnit) || toUnit}
                      {selectedMaterial && <span className="text-gray-400 ml-2 text-sm">({selectedMaterial.name})</span>}
                    </span>
                  </div>
                )}

                {/* Material selector (optional) */}
                {!editTarget && (
                  <div ref={materialRef}>
                    <label className="block text-xs text-gray-400 mb-1.5">
                      เฉพาะสินค้า <span className="text-gray-600">(ไม่เลือก = ใช้กับทุกสินค้า)</span>
                    </label>
                    <div className="relative">
                      <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                      <input
                        type="text"
                        value={materialSearch}
                        onChange={e => handleMaterialSearch(e.target.value)}
                        onFocus={() => { setShowMaterialDropdown(true); setMaterialResults(allStock.slice(0, 8)) }}
                        placeholder="ค้นหาสินค้า หรือเว้นว่างเพื่อใช้ทั่วไป..."
                        className="w-full pl-9 pr-8 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                      />
                      {selectedMaterial && (
                        <button
                          onClick={() => { setSelectedMaterial(null); setMaterialSearch('') }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {selectedMaterial && (
                      <div className="mt-1 flex items-center gap-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <Package className="w-3 h-3 text-amber-400" />
                        <span className="text-xs text-amber-300">{selectedMaterial.name}</span>
                        <span className="text-xs text-gray-500 font-mono">{selectedMaterial.sku}</span>
                      </div>
                    )}
                    <AnimatePresence>
                      {showMaterialDropdown && materialResults.length > 0 && !selectedMaterial && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto"
                          style={{ width: 'calc(100% - 2.5rem)' }}
                        >
                          {materialResults.map(s => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setSelectedMaterial(s)
                                setMaterialSearch(s.name)
                                setShowMaterialDropdown(false)
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-700/50 transition-colors text-left"
                            >
                              <Package className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                              <span className="text-sm text-gray-200 flex-1 truncate">{s.name}</span>
                              <span className="text-xs text-gray-500 font-mono">{s.sku}</span>
                              <span className="text-xs text-gray-600">{s.unit}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">หน่วยต้นทาง (from)</label>
                    <input
                      type="text"
                      value={fromUnit}
                      onChange={e => setFromUnit(e.target.value)}
                      disabled={!!editTarget}
                      placeholder="เช่น pack, ลัง, ซอง"
                      className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
                    />
                    {fromUnit && <p className="text-xs text-gray-500 mt-1">{unitLabel(fromUnit)}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">หน่วยปลายทาง (to)</label>
                    <input
                      type="text"
                      value={toUnit}
                      onChange={e => setToUnit(e.target.value)}
                      disabled={!!editTarget}
                      placeholder="เช่น pcs, ชิ้น, g"
                      className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
                    />
                    {toUnit && <p className="text-xs text-gray-500 mt-1">{unitLabel(toUnit)}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">
                    ค่าแปลง — 1 <span className="text-purple-300">{fromUnit || '?'}</span> = กี่ <span className="text-green-300">{toUnit || '?'}</span>
                  </label>
                  <input
                    type="number"
                    value={factor}
                    onChange={e => setFactor(e.target.value)}
                    placeholder="เช่น 24"
                    min="0.0000001"
                    step="any"
                    className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">หมายเหตุ (ไม่บังคับ)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="เช่น บรรจุภัณฑ์ไซส์ L"
                    className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={closeForm} className="flex-1 py-2.5 border border-gray-600 text-gray-300 hover:text-gray-100 rounded-lg text-sm transition-colors">
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
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
