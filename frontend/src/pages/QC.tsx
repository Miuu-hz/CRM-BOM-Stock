import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {ClipboardCheck, Plus, X, CheckCircle, XCircle, Clock, Trash2, RefreshCw, ChevronRight, Edit2, AlertTriangle, ListChecks, Activity, Gauge, Check} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { useModalClose } from '../hooks/useModalClose'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CheckItem {
  id: string
  name: string
  type: 'passfail' | 'measurement'
  expected: string
  unit: string
}

interface QCChecklist {
  id: string
  name: string
  description: string
  check_items: CheckItem[]
  created_at: string
}

interface InspectionResult {
  item_id: string
  item_name: string
  type: string
  expected: string
  unit: string
  result: 'PENDING' | 'PASS' | 'FAIL' | 'NA'
  actual_value: string
  notes: string
}

interface QCInspection {
  id: string
  checklist_name: string
  checklist_id: string
  work_order_ref: string
  batch_number: string
  product_name: string
  inspector_name: string
  status: 'PENDING' | 'PASS' | 'FAIL'
  results: InspectionResult[]
  notes: string
  created_at: string
  completed_at: string | null
}

interface QCStats { total: number; passed: number; failed: number; pending: number; templates: number; passRate: number }

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS = {
  PASS:    { label: 'ผ่าน',    icon: CheckCircle,   color: 'text-success', bg: 'bg-[var(--success-soft)]' },
  FAIL:    { label: 'ไม่ผ่าน', icon: XCircle,       color: 'text-danger',  bg: 'bg-[var(--danger-soft)]'  },
  PENDING: { label: 'รอตรวจ',  icon: Clock,         color: 'text-warning', bg: 'bg-[var(--warning-soft)]' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.PENDING
  const Icon = s.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color} ${s.bg}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function QCPage() {
  const [tab, setTab] = useState<'overview' | 'checklists' | 'inspections'>('overview')
  const [stats, setStats] = useState<QCStats | null>(null)
  const [checklists, setChecklists] = useState<QCChecklist[]>([])
  const [inspections, setInspections] = useState<QCInspection[]>([])
  const [loading, setLoading] = useState(true)

  const [editChecklist, setEditChecklist] = useState<QCChecklist | null>(null)
  const [showChecklistModal, setShowChecklistModal] = useState(false)
  const [showCreateInsp, setShowCreateInsp] = useState(false)
  const [runInspection, setRunInspection] = useState<QCInspection | null>(null)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [s, c, i] = await Promise.all([
        api.get('/qc/stats'),
        api.get('/qc/checklists'),
        api.get('/qc/inspections'),
      ])
      setStats(s.data.data)
      setChecklists(c.data.data)
      setInspections(i.data.data)
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  const tabBtn = (key: typeof tab, label: string, Icon: any) => (
    <button onClick={() => setTab(key)}
      className={`flex items-center gap-2 px-5 py-3 rounded-t-lg font-semibold transition-all text-sm ${
        tab === key
          ? 'bg-[var(--primary-soft)] text-[var(--primary)] border-b-2 border-phopy-indigo'
          : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
      }`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-[var(--primary)]" /> Quality Control
          </h1>
          <p className="text-sm text-[var(--fg-3)] mt-0.5">ตรวจสอบคุณภาพสินค้าและบันทึกผล</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadAll} className="p-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-2)] rounded-lg transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowCreateInsp(true)}
            className="phopy-btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> ตรวจสอบใหม่
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {tabBtn('overview', 'ภาพรวม', Activity)}
        {tabBtn('checklists', 'แม่แบบตรวจ', ListChecks)}
        {tabBtn('inspections', 'การตรวจสอบ', Gauge)}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'ทั้งหมด', value: stats?.total ?? 0, color: 'text-[var(--fg-1)]' },
              { label: 'ผ่าน', value: stats?.passed ?? 0, color: 'text-success' },
              { label: 'ไม่ผ่าน', value: stats?.failed ?? 0, color: 'text-danger' },
              { label: 'รอตรวจ', value: stats?.pending ?? 0, color: 'text-warning' },
              { label: 'อัตราผ่าน', value: `${stats?.passRate ?? 0}%`, color: 'text-[var(--primary)]' },
            ].map(s => (
              <div key={s.label} className="phopy-card p-4 text-center">
                <p className="text-xs text-[var(--fg-3)] mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Recent inspections */}
          <div className="phopy-card overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <p className="font-semibold text-[var(--fg-1)] text-sm">การตรวจล่าสุด</p>
            </div>
            {inspections.slice(0, 10).length === 0 ? (
              <div className="py-10 text-center text-[var(--fg-3)] text-sm">ยังไม่มีการตรวจสอบ</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border)]">
                  <tr>
                    {['แม่แบบ', 'สินค้า/Batch', 'ผู้ตรวจ', 'วันที่', 'ผล', ''].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[var(--fg-3)] font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspections.slice(0, 10).map(i => (
                    <tr key={i.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--fg-1)]">{i.checklist_name}</td>
                      <td className="px-4 py-3 text-[var(--fg-2)]">{i.product_name || i.batch_number || '-'}</td>
                      <td className="px-4 py-3 text-[var(--fg-3)]">{i.inspector_name || '-'}</td>
                      <td className="px-4 py-3 text-[var(--fg-3)]">{fmtDate(i.created_at)}</td>
                      <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                      <td className="px-4 py-3">
                        <button onClick={() => setRunInspection(i)}
                          className="text-[var(--primary)] hover:underline text-xs flex items-center gap-1">
                          ดูผล <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Checklists */}
      {tab === 'checklists' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setEditChecklist(null); setShowChecklistModal(true) }}
              className="phopy-btn-secondary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> สร้างแม่แบบใหม่
            </button>
          </div>
          {checklists.length === 0 ? (
            <div className="phopy-card py-16 text-center">
              <ListChecks className="w-12 h-12 mx-auto mb-3 text-[var(--fg-4)]" />
              <p className="text-[var(--fg-3)]">ยังไม่มีแม่แบบการตรวจ</p>
              <button onClick={() => { setEditChecklist(null); setShowChecklistModal(true) }}
                className="mt-4 phopy-btn-primary text-sm">
                สร้างแม่แบบแรก
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {checklists.map(cl => (
                <div key={cl.id} className="phopy-card p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-bold text-[var(--fg-1)]">{cl.name}</p>
                      {cl.description && <p className="text-sm text-[var(--fg-3)] mt-0.5">{cl.description}</p>}
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button onClick={() => { setEditChecklist(cl); setShowChecklistModal(true) }}
                        className="p-1.5 text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--primary-soft)] rounded transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={async () => {
                        if (!confirm('ลบแม่แบบนี้?')) return
                        await api.delete(`/qc/checklists/${cl.id}`)
                        setChecklists(prev => prev.filter(c => c.id !== cl.id))
                        toast.success('ลบแล้ว')
                      }} className="p-1.5 text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] rounded transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {cl.check_items.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm text-[var(--fg-2)]">
                        <span className="text-[var(--fg-4)] text-xs w-5 text-right">{idx + 1}.</span>
                        <span>{item.name}</span>
                        {item.type === 'measurement' && item.expected && (
                          <span className="text-xs text-[var(--fg-4)]">({item.expected} {item.unit})</span>
                        )}
                      </div>
                    ))}
                    {cl.check_items.length === 0 && <p className="text-sm text-[var(--fg-4)]">ยังไม่มีรายการตรวจ</p>}
                  </div>
                  <p className="text-xs text-[var(--fg-4)]">{cl.check_items.length} รายการตรวจ · สร้าง {fmtDate(cl.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inspections */}
      {tab === 'inspections' && (
        <div className="phopy-card overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] flex justify-between items-center">
            <p className="font-semibold text-[var(--fg-1)] text-sm">ประวัติการตรวจสอบ ({inspections.length})</p>
          </div>
          {inspections.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-[var(--fg-4)]" />
              <p className="text-[var(--fg-3)]">ยังไม่มีการตรวจสอบ</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border)]">
                  <tr>
                    {['แม่แบบ', 'สินค้า', 'Batch', 'ผู้ตรวจ', 'วันที่', 'ผล', 'จัดการ'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[var(--fg-3)] font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspections.map(i => (
                    <tr key={i.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--fg-1)]">{i.checklist_name}</td>
                      <td className="px-4 py-3 text-[var(--fg-2)]">{i.product_name || '-'}</td>
                      <td className="px-4 py-3 text-[var(--fg-3)] font-mono text-xs">{i.batch_number || '-'}</td>
                      <td className="px-4 py-3 text-[var(--fg-3)]">{i.inspector_name || '-'}</td>
                      <td className="px-4 py-3 text-[var(--fg-3)] text-xs">{fmtDate(i.created_at)}</td>
                      <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setRunInspection(i)}
                            className="p-1.5 text-[var(--primary)] hover:bg-[var(--primary-soft)] rounded transition-colors"
                            title={i.status === 'PENDING' ? 'ตรวจสอบ' : 'ดูผล'}>
                            <ClipboardCheck className="w-4 h-4" />
                          </button>
                          <button onClick={async () => {
                            if (!confirm('ลบรายการตรวจนี้?')) return
                            await api.delete(`/qc/inspections/${i.id}`)
                            setInspections(prev => prev.filter(x => x.id !== i.id))
                            toast.success('ลบแล้ว')
                          }} className="p-1.5 text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] rounded transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showChecklistModal && (
          <ChecklistModal
            initial={editChecklist}
            onClose={() => setShowChecklistModal(false)}
            onSaved={(cl) => {
              if (editChecklist) setChecklists(prev => prev.map(c => c.id === cl.id ? cl : c))
              else setChecklists(prev => [cl, ...prev])
              setShowChecklistModal(false)
            }}
          />
        )}
        {showCreateInsp && (
          <CreateInspectionModal
            checklists={checklists}
            onClose={() => setShowCreateInsp(false)}
            onCreated={(insp) => {
              setInspections(prev => [insp, ...prev])
              setShowCreateInsp(false)
              setRunInspection(insp)
            }}
          />
        )}
        {runInspection && (
          <RunInspectionModal
            inspection={runInspection}
            onClose={() => setRunInspection(null)}
            onCompleted={(updated) => {
              setInspections(prev => prev.map(i => i.id === updated.id ? updated : i))
              setRunInspection(null)
              loadAll()
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Checklist Create/Edit Modal ───────────────────────────────────────────────
function ChecklistModal({ initial, onClose, onSaved }: {
  initial: QCChecklist | null
  onClose: () => void
  onSaved: (cl: QCChecklist) => void
}) {
  useModalClose(onClose)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [items, setItems] = useState<CheckItem[]>(initial?.check_items ?? [])
  const [saving, setSaving] = useState(false)

  const addItem = () => setItems(prev => [...prev, { id: Date.now().toString(), name: '', type: 'passfail', expected: '', unit: '' }])
  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id))
  const updateItem = (id: string, field: keyof CheckItem, value: string) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))

  const save = async () => {
    if (!name.trim()) return toast.error('ใส่ชื่อแม่แบบก่อน')
    if (items.some(i => !i.name.trim())) return toast.error('ใส่ชื่อรายการตรวจให้ครบ')
    setSaving(true)
    try {
      const payload = { name: name.trim(), description, check_items: items }
      const res = initial
        ? await api.put(`/qc/checklists/${initial.id}`, payload)
        : await api.post('/qc/checklists', payload)
      onSaved(initial ? { ...initial, ...payload } : res.data.data)
      toast.success(initial ? 'อัพเดทแล้ว' : 'สร้างแม่แบบสำเร็จ')
    } catch { toast.error('บันทึกไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
          <h2 className="font-bold text-[var(--fg-1)] flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-[var(--primary)]" />
            {initial ? 'แก้ไขแม่แบบ' : 'สร้างแม่แบบการตรวจ'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg">
            <X className="w-4 h-4 text-[var(--fg-3)]" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-sm text-[var(--fg-3)] mb-1 block">ชื่อแม่แบบ *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="phopy-input w-full" placeholder="เช่น QC สินค้าสำเร็จรูป" />
          </div>
          <div>
            <label className="text-sm text-[var(--fg-3)] mb-1 block">คำอธิบาย</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="phopy-input w-full" placeholder="รายละเอียดเพิ่มเติม" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm text-[var(--fg-3)]">รายการตรวจ</label>
              <button onClick={addItem} className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> เพิ่มรายการ
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-start p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                  <span className="text-[var(--fg-4)] text-xs mt-2.5 w-4 shrink-0">{idx + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <input value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)}
                      className="phopy-input w-full text-sm" placeholder="ชื่อรายการตรวจ *" />
                    <div className="flex gap-2">
                      <select value={item.type} onChange={e => updateItem(item.id, 'type', e.target.value)}
                        className="phopy-input text-sm flex-1">
                        <option value="passfail">ผ่าน/ไม่ผ่าน</option>
                        <option value="measurement">วัดค่า</option>
                      </select>
                      {item.type === 'measurement' && (
                        <>
                          <input value={item.expected} onChange={e => updateItem(item.id, 'expected', e.target.value)}
                            className="phopy-input text-sm w-24" placeholder="ค่าเป้าหมาย" />
                          <input value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)}
                            className="phopy-input text-sm w-16" placeholder="หน่วย" />
                        </>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="p-1 text-[var(--fg-4)] hover:text-danger mt-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <button onClick={addItem}
                  className="w-full py-6 border-2 border-dashed border-[var(--border)] rounded-lg text-[var(--fg-4)] hover:border-phopy-indigo/40 hover:text-[var(--primary)] transition-colors text-sm">
                  + เพิ่มรายการตรวจแรก
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="p-5 border-t border-[var(--border)] flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:bg-[var(--surface-2)] text-sm transition-colors">
            ยกเลิก
          </button>
          <button onClick={save} disabled={saving} className="flex-1 phopy-btn-primary text-sm flex items-center justify-center gap-2">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            บันทึก
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Create Inspection Modal ───────────────────────────────────────────────────
function CreateInspectionModal({ checklists, onClose, onCreated }: {
  checklists: QCChecklist[]
  onClose: () => void
  onCreated: (insp: QCInspection) => void
}) {
  useModalClose(onClose)
  const [form, setForm] = useState({ checklist_id: '', product_name: '', batch_number: '', work_order_ref: '', inspector_name: '' })
  const [saving, setSaving] = useState(false)

  const create = async () => {
    if (!form.checklist_id) return toast.error('เลือกแม่แบบก่อน')
    setSaving(true)
    try {
      const res = await api.post('/qc/inspections', form)
      onCreated(res.data.data)
      toast.success('สร้างการตรวจสอบแล้ว')
    } catch { toast.error('สร้างไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
          <h2 className="font-bold text-[var(--fg-1)] flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[var(--primary)]" /> เริ่มตรวจสอบใหม่
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg">
            <X className="w-4 h-4 text-[var(--fg-3)]" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {checklists.length === 0 ? (
            <div className="text-center py-6">
              <AlertTriangle className="w-10 h-10 mx-auto mb-2 text-warning" />
              <p className="text-[var(--fg-2)] font-medium">ยังไม่มีแม่แบบการตรวจ</p>
              <p className="text-sm text-[var(--fg-3)] mt-1">สร้างแม่แบบก่อนในแท็บ "แม่แบบตรวจ"</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm text-[var(--fg-3)] mb-1 block">แม่แบบการตรวจ *</label>
                <select value={form.checklist_id} onChange={e => setForm(f => ({ ...f, checklist_id: e.target.value }))}
                  className="phopy-input w-full">
                  <option value="">-- เลือกแม่แบบ --</option>
                  {checklists.map(c => <option key={c.id} value={c.id}>{c.name} ({c.check_items.length} รายการ)</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-[var(--fg-3)] mb-1 block">ชื่อสินค้า</label>
                  <input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                    className="phopy-input w-full" placeholder="เช่น หมอนยางพารา" />
                </div>
                <div>
                  <label className="text-sm text-[var(--fg-3)] mb-1 block">Batch / Lot</label>
                  <input value={form.batch_number} onChange={e => setForm(f => ({ ...f, batch_number: e.target.value }))}
                    className="phopy-input w-full" placeholder="เช่น LOT-001" />
                </div>
                <div>
                  <label className="text-sm text-[var(--fg-3)] mb-1 block">อ้างอิง Work Order</label>
                  <input value={form.work_order_ref} onChange={e => setForm(f => ({ ...f, work_order_ref: e.target.value }))}
                    className="phopy-input w-full" placeholder="WO-00001" />
                </div>
                <div>
                  <label className="text-sm text-[var(--fg-3)] mb-1 block">ผู้ตรวจ</label>
                  <input value={form.inspector_name} onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))}
                    className="phopy-input w-full" placeholder="ชื่อผู้ตรวจ" />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] text-sm hover:bg-[var(--surface-2)] transition-colors">
            ยกเลิก
          </button>
          {checklists.length > 0 && (
            <button onClick={create} disabled={saving} className="flex-1 phopy-btn-primary text-sm flex items-center justify-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              เริ่มตรวจ
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Run Inspection Modal ──────────────────────────────────────────────────────
function RunInspectionModal({ inspection, onClose, onCompleted }: {
  inspection: QCInspection
  onClose: () => void
  onCompleted: (updated: QCInspection) => void
}) {
  useModalClose(onClose)
  const [results, setResults] = useState<InspectionResult[]>(inspection.results.map(r => ({ ...r })))
  const [notes, setNotes] = useState(inspection.notes)
  const [saving, setSaving] = useState(false)
  const isCompleted = inspection.status !== 'PENDING'

  const updateResult = (itemId: string, field: keyof InspectionResult, value: string) =>
    setResults(prev => prev.map(r => r.item_id === itemId ? { ...r, [field]: value } : r))

  const complete = async () => {
    if (results.some(r => r.result === 'PENDING')) {
      if (!confirm('ยังมีรายการที่ยังไม่ได้ตรวจ ต้องการส่งผลเลยไหม?')) return
    }
    setSaving(true)
    try {
      const res = await api.post(`/qc/inspections/${inspection.id}/complete`, { results, notes })
      onCompleted({ ...inspection, results, notes, status: res.data.data.status, completed_at: new Date().toISOString() })
      toast.success(`ผลการตรวจ: ${res.data.data.status === 'PASS' ? '<Check className="w-4 h-4" /> ผ่าน' : '<X className="w-4 h-4" /> ไม่ผ่าน'}`)
    } catch { toast.error('บันทึกผลไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const passCount  = results.filter(r => r.result === 'PASS').length
  const failCount  = results.filter(r => r.result === 'FAIL').length
  const pendCount  = results.filter(r => r.result === 'PENDING').length

  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-start">
          <div>
            <h2 className="font-bold text-[var(--fg-1)] flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[var(--primary)]" />
              {inspection.checklist_name}
            </h2>
            <div className="flex gap-3 mt-1 text-xs text-[var(--fg-3)]">
              {inspection.product_name && <span>สินค้า: {inspection.product_name}</span>}
              {inspection.batch_number && <span>Batch: {inspection.batch_number}</span>}
              {inspection.inspector_name && <span>ผู้ตรวจ: {inspection.inspector_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={inspection.status} />
            <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg">
              <X className="w-4 h-4 text-[var(--fg-3)]" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center gap-4 text-sm">
          <span className="text-success font-medium"><Check className="w-4 h-4" /> {passCount}</span>
          <span className="text-danger font-medium"><X className="w-4 h-4" /> {failCount}</span>
          <span className="text-[var(--fg-4)] flex items-center gap-1"><Clock className="w-3 h-3" /> {pendCount} รอตรวจ</span>
          <div className="flex-1 h-2 bg-[var(--surface)] rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full transition-all" style={{ width: `${results.length ? (passCount / results.length) * 100 : 0}%` }} />
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-3">
          {results.map((r, idx) => (
            <div key={r.item_id} className={`p-4 rounded-xl border transition-colors ${
              r.result === 'PASS' ? 'border-success/30 bg-[var(--success-soft)]'
              : r.result === 'FAIL' ? 'border-danger/30 bg-[var(--danger-soft)]'
              : 'border-[var(--border)] bg-[var(--surface-2)]'
            }`}>
              <div className="flex items-start gap-3">
                <span className="text-xs text-[var(--fg-4)] mt-1 w-5 shrink-0 text-right">{idx + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-[var(--fg-1)] text-sm">{r.item_name}</p>
                    {r.type === 'measurement' && r.expected && (
                      <span className="text-xs text-[var(--fg-4)]">เป้าหมาย: {r.expected} {r.unit}</span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {(['PASS', 'FAIL', 'NA'] as const).map(v => (
                      <button key={v} disabled={isCompleted}
                        onClick={() => updateResult(r.item_id, 'result', v)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          r.result === v
                            ? v === 'PASS' ? 'bg-success text-white border-success'
                              : v === 'FAIL' ? 'bg-danger text-white border-danger'
                              : 'bg-[var(--surface)] text-[var(--fg-2)] border-[var(--border-strong)]'
                            : 'border-[var(--border)] text-[var(--fg-3)] hover:border-[var(--fg-3)]'
                        } disabled:cursor-default`}>
                        {v === 'PASS' ? '<Check className="w-4 h-4" /> ผ่าน' : v === 'FAIL' ? '<X className="w-4 h-4" /> ไม่ผ่าน' : 'N/A'}
                      </button>
                    ))}
                    {r.type === 'measurement' && (
                      <input value={r.actual_value} disabled={isCompleted}
                        onChange={e => updateResult(r.item_id, 'actual_value', e.target.value)}
                        className="phopy-input text-xs py-1 w-28" placeholder="ค่าที่วัดได้" />
                    )}
                  </div>
                  {!isCompleted && (
                    <input value={r.notes} onChange={e => updateResult(r.item_id, 'notes', e.target.value)}
                      className="phopy-input w-full text-xs mt-2" placeholder="หมายเหตุ (ถ้ามี)" />
                  )}
                  {isCompleted && r.notes && <p className="text-xs text-[var(--fg-3)] mt-1">{r.notes}</p>}
                </div>
              </div>
            </div>
          ))}

          <div>
            <label className="text-sm text-[var(--fg-3)] mb-1 block">หมายเหตุรวม</label>
            <textarea value={notes} disabled={isCompleted} onChange={e => setNotes(e.target.value)}
              className="phopy-input w-full resize-none" rows={2} placeholder="สรุปผลการตรวจ" />
          </div>
        </div>

        <div className="p-5 border-t border-[var(--border)] flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] text-sm hover:bg-[var(--surface-2)] transition-colors">
            {isCompleted ? 'ปิด' : 'ยกเลิก'}
          </button>
          {!isCompleted && (
            <button onClick={complete} disabled={saving}
              className="flex-1 phopy-btn-primary text-sm flex items-center justify-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              บันทึกผลการตรวจ
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
