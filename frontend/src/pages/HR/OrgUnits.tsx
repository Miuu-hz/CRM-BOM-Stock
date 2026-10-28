import { useState, useEffect, useCallback, useMemo } from 'react'
import { Building2, Plus, Pencil, Trash2, X, CornerDownRight } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { BusinessUnit, Employee, OrgUnit, OrgUnitInput } from '../../services/hr.service'

const BUSINESS_UNIT_LABELS: Record<BusinessUnit, string> = {
  RETAIL: 'หน้าร้าน (POS)',
  WHOLESALE: 'ขายส่ง / ใบแจ้งหนี้',
  ONLINE: 'ขายออนไลน์ (แพลตฟอร์ม)',
  OTHER: 'อื่น ๆ',
}

interface TreeItem extends OrgUnit {
  depth: number
}

function buildTree(units: OrgUnit[]): TreeItem[] {
  const byParent = new Map<string | null, OrgUnit[]>()
  const idSet = new Set(units.map((u) => u.id))
  for (const u of units) {
    const pid = u.parent_id && idSet.has(u.parent_id) ? u.parent_id : null
    const list = byParent.get(pid) || []
    list.push(u)
    byParent.set(pid, list)
  }
  const result: TreeItem[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) || []
    for (const child of children) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

export default function OrgUnits() {
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<OrgUnit | null>(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [businessUnit, setBusinessUnit] = useState<string>('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [orgList, empList] = await Promise.all([
        hrService.getOrgUnits(),
        hrService.getEmployees({ status: 'ACTIVE' }),
      ])
      setUnits(orgList)
      setEmployees(empList)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'โหลดข้อมูลผังองค์กรไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const treeItems = useMemo(() => buildTree(units), [units])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setParentId('')
    setManagerId('')
    setBusinessUnit('')
    setIsActive(true)
    setModalOpen(true)
  }

  const openEdit = (unit: OrgUnit) => {
    setEditing(unit)
    setName(unit.name)
    setParentId(unit.parent_id || '')
    setManagerId(unit.manager_employee_id || '')
    setBusinessUnit(unit.business_unit || '')
    setIsActive(unit.is_active !== 0)
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('กรุณาระบุชื่อหน่วยงาน')
      return
    }
    setSaving(true)
    try {
      const payload: OrgUnitInput = {
        name: name.trim(),
        parent_id: parentId || null,
        manager_employee_id: managerId || null,
        business_unit: (businessUnit as BusinessUnit) || null,
        is_active: isActive ? 1 : 0,
      }
      if (editing) {
        await hrService.updateOrgUnit(editing.id, payload)
        toast.success('บันทึกหน่วยงานแล้ว')
      } else {
        await hrService.createOrgUnit(payload)
        toast.success('เพิ่มหน่วยงานแล้ว')
      }
      setModalOpen(false)
      await loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (unit: OrgUnit) => {
    if (!window.confirm(`ต้องการลบหน่วยงาน "${unit.name}" ใช่หรือไม่?`)) return
    try {
      await hrService.deleteOrgUnit(unit.id)
      toast.success('ลบหน่วยงานแล้ว')
      await loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'ไม่สามารถลบหน่วยงานได้')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
            <Building2 className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--fg-1)]">ผังองค์กร (Org Units)</h1>
            <p className="text-xs text-[var(--fg-3)]">โครงสร้างหน่วยงาน หัวหน้างาน และการผูกสายธุรกิจ (Business Unit) สำหรับต้นทุนเงินเดือน</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          เพิ่มหน่วยงาน
        </button>
      </div>

      <div className="phopy-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลด...</div>
        ) : treeItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีข้อมูลหน่วยงาน</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="phopy-table w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--fg-3)]">
                  <th className="py-3 px-4">ชื่อหน่วยงาน</th>
                  <th className="py-3 px-4">หัวหน้าหน่วยงาน</th>
                  <th className="py-3 px-4">สายธุรกิจ (Business Unit)</th>
                  <th className="py-3 px-4">สถานะ</th>
                  <th className="py-3 px-4 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {treeItems.map((unit) => {
                  const mgrName = unit.manager_first_name
                    ? `${unit.manager_first_name} ${unit.manager_last_name || ''}`.trim()
                    : '-'
                  return (
                    <tr key={unit.id} className="hover:bg-[var(--surface-2)]/60">
                      <td className="py-3 px-4 font-medium text-[var(--fg-1)]">
                        <div className="flex items-center gap-1.5" style={{ paddingLeft: `${unit.depth * 24}px` }}>
                          {unit.depth > 0 && <CornerDownRight className="w-4 h-4 text-[var(--fg-4)] shrink-0" />}
                          <span>{unit.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[var(--fg-2)]">{mgrName}</td>
                      <td className="py-3 px-4">
                        {unit.business_unit ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--primary-soft)] text-[var(--primary)]">
                            {BUSINESS_UNIT_LABELS[unit.business_unit] || unit.business_unit}
                          </span>
                        ) : (
                          <span className="text-[var(--fg-3)]">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            unit.is_active
                              ? 'bg-[var(--success-soft)] text-[var(--success)]'
                              : 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                          }`}
                        >
                          {unit.is_active ? 'ใช้งาน' : 'ปิด'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEdit(unit)}
                            title="แก้ไข"
                            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(unit)}
                            title="ลบ"
                            className="p-1.5 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-danger"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                {editing ? 'แก้ไขหน่วยงาน' : 'เพิ่มหน่วยงานใหม่'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded-lg hover:bg-[var(--surface-2)]">
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ชื่อหน่วยงาน *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น ฝ่ายผลิต, ฝ่ายขาย"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">สังกัดหน่วยงานแม่ (Parent Unit)</label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- ระดับสูงสุด (ไม่มีหน่วยงานแม่) --</option>
                  {units
                    .filter((u) => !editing || u.id !== editing.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">หัวหน้าหน่วยงาน (Manager)</label>
                <select
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} - {emp.first_name} {emp.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">สายธุรกิจ (Business Unit)</label>
                <select
                  value={businessUnit}
                  onChange={(e) => setBusinessUnit(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  <option value="RETAIL">หน้าร้าน (POS)</option>
                  <option value="WHOLESALE">ขายส่ง / ใบแจ้งหนี้</option>
                  <option value="ONLINE">ขายออนไลน์ (แพลตฟอร์ม)</option>
                  <option value="OTHER">อื่น ๆ</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="org_is_active"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <label htmlFor="org_is_active" className="text-sm text-[var(--fg-2)]">เปิดใช้งานหน่วยงานนี้</label>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
