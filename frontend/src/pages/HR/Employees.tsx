import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Search, Pencil, UserMinus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, { Employee, EmployeeInput, EmployeeStatus, EmploymentType, OrgUnit } from '../../services/hr.service'

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  HOURLY: 'รายชั่วโมง',
}

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'ทำงานอยู่',
  RESIGNED: 'ลาออก',
  TERMINATED: 'เลิกจ้าง',
}

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  ACTIVE: 'bg-[var(--success-soft)] text-[var(--success)]',
  RESIGNED: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
  TERMINATED: 'bg-[var(--danger-soft)] text-danger',
}

interface FormState {
  code: string
  first_name: string
  last_name: string
  nickname: string
  org_unit_id: string
  position: string
  employment_type: EmploymentType
  base_wage: string
  start_date: string
  national_id: string
  bank_name: string
  bank_account: string
  phone: string
  email: string
  address: string
  sso_enrolled: boolean
  device_pin: string
  notes: string
}

const todayStr = () => new Date().toISOString().slice(0, 10)

const emptyForm = (): FormState => ({
  code: '',
  first_name: '',
  last_name: '',
  nickname: '',
  org_unit_id: '',
  position: '',
  employment_type: 'MONTHLY',
  base_wage: '0',
  start_date: todayStr(),
  national_id: '',
  bank_name: '',
  bank_account: '',
  phone: '',
  email: '',
  address: '',
  sso_enrolled: true,
  device_pin: '',
  notes: '',
})

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterOrgUnit, setFilterOrgUnit] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  const [offboardTarget, setOffboardTarget] = useState<Employee | null>(null)
  const [offboardDate, setOffboardDate] = useState(todayStr())
  const [offboardStatus, setOffboardStatus] = useState<'RESIGNED' | 'TERMINATED'>('RESIGNED')
  const [offboarding, setOffboarding] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, units] = await Promise.all([
        hrService.getEmployees({
          status: filterStatus || undefined,
          org_unit_id: filterOrgUnit || undefined,
          q: search.trim() || undefined,
        }),
        hrService.getOrgUnits(),
      ])
      setEmployees(emps)
      setOrgUnits(units)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'โหลดข้อมูลพนักงานไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterOrgUnit, search])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  const openEdit = (emp: Employee) => {
    setEditing(emp)
    setForm({
      code: emp.code || '',
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      nickname: emp.nickname || '',
      org_unit_id: emp.org_unit_id || '',
      position: emp.position || '',
      employment_type: emp.employment_type || 'MONTHLY',
      base_wage: emp.base_wage !== undefined && emp.base_wage !== null ? String(emp.base_wage) : '0',
      start_date: emp.start_date || todayStr(),
      national_id: emp.national_id || '',
      bank_name: emp.bank_name || '',
      bank_account: emp.bank_account || '',
      phone: emp.phone || '',
      email: emp.email || '',
      address: emp.address || '',
      sso_enrolled: emp.sso_enrolled !== 0,
      device_pin: emp.device_pin || '',
      notes: emp.notes || '',
    })
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.first_name.trim()) {
      toast.error('กรุณาระบุชื่อพนักงาน')
      return
    }
    setSaving(true)
    try {
      const payload: EmployeeInput = {
        code: form.code.trim() || undefined,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim() || null,
        nickname: form.nickname.trim() || null,
        org_unit_id: form.org_unit_id || null,
        position: form.position.trim() || null,
        employment_type: form.employment_type,
        base_wage: Number(form.base_wage || 0),
        start_date: form.start_date,
        national_id: form.national_id.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account: form.bank_account.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        sso_enrolled: form.sso_enrolled ? 1 : 0,
        device_pin: form.device_pin.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await hrService.updateEmployee(editing.id, payload)
        toast.success('บันทึกข้อมูลพนักงานแล้ว')
      } else {
        await hrService.createEmployee(payload)
        toast.success('เพิ่มพนักงานแล้ว')
      }
      setModalOpen(false)
      await loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'บันทึกข้อมูลไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const handleOffboard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!offboardTarget) return
    setOffboarding(true)
    try {
      await hrService.offboardEmployee(offboardTarget.id, {
        end_date: offboardDate,
        status: offboardStatus,
      })
      toast.success('บันทึกการพ้นสภาพพนักงานแล้ว')
      setOffboardTarget(null)
      await loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'บันทึกไม่สำเร็จ')
    } finally {
      setOffboarding(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
            <Users className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--fg-1)]">ทะเบียนพนักงาน</h1>
            <p className="text-xs text-[var(--fg-3)]">จัดการข้อมูลพนักงาน สังกัด อัตราค่าจ้าง และบัญชีรับเงินเดือน</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="phopy-btn-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          เพิ่มพนักงาน
        </button>
      </div>

      {/* Filters */}
      <div className="phopy-card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[var(--fg-3)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหารหัส ชื่อ นามสกุล หรือชื่อเล่น..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
          />
        </div>
        <select
          value={filterOrgUnit}
          onChange={(e) => setFilterOrgUnit(e.target.value)}
          aria-label="กรองตามหน่วยงาน"
          className="px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
        >
          <option value="">ทุกหน่วยงาน</option>
          {orgUnits.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="กรองตามสถานะ"
          className="px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
        >
          <option value="">ทุกสถานะ</option>
          <option value="ACTIVE">ทำงานอยู่</option>
          <option value="RESIGNED">ลาออก</option>
          <option value="TERMINATED">เลิกจ้าง</option>
        </select>
      </div>

      {/* Table */}
      <div className="phopy-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลด...</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบข้อมูลพนักงาน</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="phopy-table w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--fg-3)]">
                  <th className="py-3 px-4">รหัส</th>
                  <th className="py-3 px-4">ชื่อ-นามสกุล</th>
                  <th className="py-3 px-4">หน่วยงาน / ตำแหน่ง</th>
                  <th className="py-3 px-4">ประเภทการจ้าง</th>
                  <th className="py-3 px-4 text-right">ค่าจ้างฐาน</th>
                  <th className="py-3 px-4">เลขบัญชีธนาคาร</th>
                  <th className="py-3 px-4">สถานะ</th>
                  <th className="py-3 px-4 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-[var(--surface-2)]/60">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[var(--fg-2)]">{emp.code}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[var(--fg-1)]">
                        {emp.first_name} {emp.last_name || ''}
                        {emp.nickname ? <span className="ml-1 text-xs text-[var(--fg-3)]">({emp.nickname})</span> : null}
                      </div>
                      {emp.phone && <div className="text-xs text-[var(--fg-3)]">{emp.phone}</div>}
                    </td>
                    <td className="py-3 px-4 text-[var(--fg-2)]">
                      <div>{emp.org_unit_name || '-'}</div>
                      {emp.position && <div className="text-xs text-[var(--fg-3)]">{emp.position}</div>}
                    </td>
                    <td className="py-3 px-4 text-[var(--fg-2)]">
                      {EMPLOYMENT_TYPE_LABELS[emp.employment_type] || emp.employment_type}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[var(--fg-1)]">
                      {emp.base_wage !== undefined && emp.base_wage !== null
                        ? emp.base_wage.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                        : null}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[var(--fg-2)]" data-testid={`bank-account-${emp.id}`}>
                      {emp.bank_account ? `${emp.bank_name ? emp.bank_name + ' ' : ''}${emp.bank_account}` : null}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[emp.status] || ''}`}>
                        {STATUS_LABELS[emp.status] || emp.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(emp)}
                          title="แก้ไข"
                          className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {emp.status === 'ACTIVE' && (
                          <button
                            onClick={() => {
                              setOffboardTarget(emp)
                              setOffboardDate(todayStr())
                              setOffboardStatus('RESIGNED')
                            }}
                            title="แจ้งพ้นสภาพ"
                            className="p-1.5 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-danger"
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                {editing ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded-lg hover:bg-[var(--surface-2)]">
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">รหัสพนักงาน (เว้นว่างเพื่อรันอัตโนมัติ)</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="EMP-001"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ชื่อ *</label>
                  <input
                    type="text"
                    required
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">นามสกุล</label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ชื่อเล่น</label>
                  <input
                    type="text"
                    value={form.nickname}
                    onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">หน่วยงาน (Org Unit)</label>
                  <select
                    value={form.org_unit_id}
                    onChange={(e) => setForm({ ...form, org_unit_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {orgUnits.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ตำแหน่ง</label>
                  <input
                    type="text"
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ประเภทการจ้าง *</label>
                  <select
                    value={form.employment_type}
                    onChange={(e) => setForm({ ...form, employment_type: e.target.value as EmploymentType })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="MONTHLY">รายเดือน (MONTHLY)</option>
                    <option value="DAILY">รายวัน (DAILY)</option>
                    <option value="HOURLY">รายชั่วโมง (HOURLY)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">อัตราค่าจ้างฐาน (฿)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.base_wage}
                    onChange={(e) => setForm({ ...form, base_wage: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">วันที่เริ่มงาน *</label>
                  <input
                    type="date"
                    required
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เลขบัตรประชาชน</label>
                  <input
                    type="text"
                    value={form.national_id}
                    onChange={(e) => setForm({ ...form, national_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ธนาคาร</label>
                  <input
                    type="text"
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    placeholder="เช่น KBANK, SCB"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เลขบัญชีธนาคาร</label>
                  <input
                    type="text"
                    value={form.bank_account}
                    onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เบอร์โทรศัพท์</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">อีเมล</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">รหัสสแกน/PIN เครื่องลงเวลา</label>
                  <input
                    type="text"
                    value={form.device_pin}
                    onChange={(e) => setForm({ ...form, device_pin: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="sso_enrolled"
                  type="checkbox"
                  checked={form.sso_enrolled}
                  onChange={(e) => setForm({ ...form, sso_enrolled: e.target.checked })}
                />
                <label htmlFor="sso_enrolled" className="text-sm text-[var(--fg-2)]">ขึ้นทะเบียนประกันสังคม (SSO)</label>
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

      {/* Offboard Modal */}
      {offboardTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                แจ้งพ้นสภาพพนักงาน: {offboardTarget.first_name} {offboardTarget.last_name || ''}
              </h2>
              <button onClick={() => setOffboardTarget(null)} className="p-1 rounded-lg hover:bg-[var(--surface-2)]">
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>
            <form onSubmit={handleOffboard} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ประเภทการพ้นสภาพ *</label>
                <select
                  value={offboardStatus}
                  onChange={(e) => setOffboardStatus(e.target.value as 'RESIGNED' | 'TERMINATED')}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="RESIGNED">ลาออก (RESIGNED)</option>
                  <option value="TERMINATED">เลิกจ้าง (TERMINATED)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">วันที่มีผล (End Date) *</label>
                <input
                  type="date"
                  required
                  value={offboardDate}
                  onChange={(e) => setOffboardDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOffboardTarget(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={offboarding}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50"
                >
                  {offboarding ? 'กำลังบันทึก...' : 'ยืนยันพ้นสภาพ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
