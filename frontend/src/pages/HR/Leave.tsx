import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Plus,
  X,
  Sparkles,
  Pencil,
  Trash2,
  AlertCircle,
  Clock,
  CheckCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  LeaveRequest,
  LeaveType,
  LeaveBalance,
  PublicHoliday,
  Employee,
  LeaveStatus,
} from '../../services/hr.service'

type TabKey = 'requests' | 'balances' | 'types' | 'holidays'

const todayStr = () => new Date().toISOString().slice(0, 10)
const currentYear = () => new Date().getFullYear()

// ponytail: simplified calendar day count diff (d2 - d1); assumes full day range, user can adjust to 0.5
function calcCalendarDays(start: string, end: string): number {
  if (!start || !end) return 1
  const d1 = new Date(start).getTime()
  const d2 = new Date(end).getTime()
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return 1
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1
}

const STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
}

const STATUS_BADGE: Record<LeaveStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-600',
  APPROVED: 'bg-[var(--success-soft)] text-[var(--success)]',
  REJECTED: 'bg-[var(--danger-soft)] text-danger',
  CANCELLED: 'bg-[var(--surface-2)] text-[var(--fg-3)]',
}

export default function Leave() {
  const [activeTab, setActiveTab] = useState<TabKey>('requests')

  // Shared data
  const [employees, setEmployees] = useState<Employee[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])

  // Tab 1: Requests
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')

  // Modal: Create request on behalf of employee
  const [createReqOpen, setCreateReqOpen] = useState(false)
  const [reqEmpId, setReqEmpId] = useState('')
  const [reqTypeId, setReqTypeId] = useState('')
  const [reqStartDate, setReqStartDate] = useState(todayStr())
  const [reqEndDate, setReqEndDate] = useState(todayStr())
  const [reqDays, setReqDays] = useState('1')
  const [reqReason, setReqReason] = useState('')
  const [submittingReq, setSubmittingReq] = useState(false)

  // Tab 2: Balances
  const [selectedBalanceEmpId, setSelectedBalanceEmpId] = useState('')
  const [balanceYear, setBalanceYear] = useState<number>(currentYear())
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [loadingBalances, setLoadingBalances] = useState(false)

  // Tab 3: Leave Types
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [typeModalOpen, setTypeModalOpen] = useState(false)
  const [editingType, setEditingType] = useState<LeaveType | null>(null)
  const [typeCode, setTypeCode] = useState('')
  const [typeName, setTypeName] = useState('')
  const [typePaid, setTypePaid] = useState(true)
  const [typeDaysPerYear, setTypeDaysPerYear] = useState('')
  const [typeActive, setTypeActive] = useState(true)
  const [savingType, setSavingType] = useState(false)
  const [creatingStarter, setCreatingStarter] = useState(false)

  // Tab 4: Holidays
  const [holidayYear, setHolidayYear] = useState<number>(currentYear())
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])
  const [loadingHolidays, setLoadingHolidays] = useState(false)
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayName, setNewHolidayName] = useState('')
  const [addingHoliday, setAddingHoliday] = useState(false)

  // Load baseline employees & leave types
  const loadInitialData = useCallback(async () => {
    try {
      const [emps, types] = await Promise.all([
        hrService.getEmployees({ status: 'ACTIVE' }),
        hrService.getLeaveTypes(),
      ])
      setEmployees(emps || [])
      setLeaveTypes(types || [])
    } catch {
      // non-critical initial load error handled gracefully
    }
  }, [])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  // Load Requests
  const loadRequests = useCallback(async () => {
    setLoadingRequests(true)
    try {
      const params: { status?: LeaveStatus; from?: string; to?: string } = {}
      if (filterStatus) params.status = filterStatus as LeaveStatus
      if (filterFrom) params.from = filterFrom
      if (filterTo) params.to = filterTo
      const list = await hrService.getLeaveRequests(params)
      setRequests(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการคำขอลาไม่สำเร็จ')
    } finally {
      setLoadingRequests(false)
    }
  }, [filterStatus, filterFrom, filterTo])

  // Load Balances
  const loadBalances = useCallback(async () => {
    if (!selectedBalanceEmpId) {
      setBalances([])
      return
    }
    setLoadingBalances(true)
    try {
      const list = await hrService.getLeaveBalances({
        employee_id: selectedBalanceEmpId,
        year: balanceYear,
      })
      setBalances(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดยอดวันลาคงเหลือไม่สำเร็จ')
    } finally {
      setLoadingBalances(false)
    }
  }, [selectedBalanceEmpId, balanceYear])

  // Load Types
  const loadTypes = useCallback(async () => {
    setLoadingTypes(true)
    try {
      const list = await hrService.getLeaveTypes()
      setLeaveTypes(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดประเภทการลาไม่สำเร็จ')
    } finally {
      setLoadingTypes(false)
    }
  }, [])

  // Load Holidays
  const loadHolidays = useCallback(async () => {
    setLoadingHolidays(true)
    try {
      const list = await hrService.getHolidays(holidayYear)
      setHolidays(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดวันหยุดบริษัทไม่สำเร็จ')
    } finally {
      setLoadingHolidays(false)
    }
  }, [holidayYear])

  useEffect(() => {
    if (activeTab === 'requests') loadRequests()
    else if (activeTab === 'balances') loadBalances()
    else if (activeTab === 'types') loadTypes()
    else if (activeTab === 'holidays') loadHolidays()
  }, [activeTab, loadRequests, loadBalances, loadTypes, loadHolidays])

  // Handle Cancel Request
  const handleCancelRequest = async (id: string) => {
    if (!window.confirm('ยืนยันยกเลิกคำขอลานี้?')) return
    try {
      await hrService.cancelLeaveRequest(id)
      toast.success('ยกเลิกคำขอลาสำเร็จ')
      loadRequests()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกคำขอลาไม่สำเร็จ')
    }
  }

  // Open Create Request Modal
  const openCreateRequestModal = () => {
    const defaultEmp = employees[0]?.id || ''
    const activeTypes = leaveTypes.filter((t) => t.is_active)
    const defaultType = activeTypes[0]?.id || ''
    setReqEmpId(defaultEmp)
    setReqTypeId(defaultType)
    setReqStartDate(todayStr())
    setReqEndDate(todayStr())
    setReqDays('1')
    setReqReason('')
    setCreateReqOpen(true)
  }

  const handleStartDateChange = (val: string) => {
    setReqStartDate(val)
    const nextEnd = reqEndDate < val ? val : reqEndDate
    if (reqEndDate < val) setReqEndDate(val)
    setReqDays(String(calcCalendarDays(val, nextEnd)))
  }

  const handleEndDateChange = (val: string) => {
    setReqEndDate(val)
    setReqDays(String(calcCalendarDays(reqStartDate, val)))
  }

  const handleSaveRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reqEmpId) {
      toast.error('กรุณาเลือกพนักงาน')
      return
    }
    if (!reqTypeId) {
      toast.error('กรุณาเลือกประเภทการลา')
      return
    }
    const daysNum = parseFloat(reqDays)
    if (isNaN(daysNum) || daysNum <= 0) {
      toast.error('จำนวนวันลาต้องมากกว่า 0')
      return
    }

    setSubmittingReq(true)
    try {
      await hrService.createLeaveRequest({
        employee_id: reqEmpId,
        leave_type_id: reqTypeId,
        start_date: reqStartDate,
        end_date: reqEndDate,
        days: daysNum,
        reason: reqReason.trim() || undefined,
      })
      toast.success('บันทึกคำขอลาเรียบร้อย')
      setCreateReqOpen(false)
      loadRequests()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกคำขอลาไม่สำเร็จ')
    } finally {
      setSubmittingReq(false)
    }
  }

  // Leave Type actions
  const openCreateTypeModal = () => {
    setEditingType(null)
    setTypeCode('')
    setTypeName('')
    setTypePaid(true)
    setTypeDaysPerYear('')
    setTypeActive(true)
    setTypeModalOpen(true)
  }

  const openEditTypeModal = (item: LeaveType) => {
    setEditingType(item)
    setTypeCode(item.code)
    setTypeName(item.name)
    setTypePaid(item.paid)
    setTypeDaysPerYear(item.days_per_year !== null && item.days_per_year !== undefined ? String(item.days_per_year) : '')
    setTypeActive(item.is_active)
    setTypeModalOpen(true)
  }

  const handleSaveType = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!typeName.trim()) {
      toast.error('กรุณาระบุชื่อประเภทลา')
      return
    }

    setSavingType(true)
    try {
      const quotaVal = typeDaysPerYear.trim() === '' ? null : parseFloat(typeDaysPerYear)
      if (editingType) {
        await hrService.updateLeaveType(editingType.id, {
          name: typeName.trim(),
          paid: typePaid,
          days_per_year: quotaVal,
          is_active: typeActive,
        })
        toast.success('แก้ไขประเภทลาสำเร็จ')
      } else {
        if (!typeCode.trim()) {
          toast.error('กรุณาระบุรหัสประเภทลา')
          setSavingType(false)
          return
        }
        await hrService.createLeaveType({
          code: typeCode.trim().toUpperCase(),
          name: typeName.trim(),
          paid: typePaid,
          days_per_year: quotaVal,
          is_active: typeActive,
        })
        toast.success('เพิ่มประเภทลาสำเร็จ')
      }
      setTypeModalOpen(false)
      loadTypes()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกประเภทลาไม่สำเร็จ')
    } finally {
      setSavingType(false)
    }
  }

  const handleCreateStarterTypes = async () => {
    setCreatingStarter(true)
    try {
      const res = await hrService.createStarterLeaveTypes()
      toast.success(`สร้างประเภทลาตามกฎหมายแล้ว ${res.created} รายการ`)
      loadTypes()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'สร้างประเภทลาตามกฎหมายไม่สำเร็จ')
    } finally {
      setCreatingStarter(false)
    }
  }

  // Holiday actions
  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHolidayDate) {
      toast.error('กรุณาระบุวันที่วันหยุด')
      return
    }
    if (!newHolidayName.trim()) {
      toast.error('กรุณาระบุชื่อวันหยุด')
      return
    }

    setAddingHoliday(true)
    try {
      await hrService.createHoliday({
        date: newHolidayDate,
        name: newHolidayName.trim(),
      })
      toast.success('เพิ่มวันหยุดเรียบร้อย')
      setNewHolidayName('')
      loadHolidays()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'เพิ่มวันหยุดไม่สำเร็จ')
    } finally {
      setAddingHoliday(false)
    }
  }

  const handleDeleteHoliday = async (id: string, name: string) => {
    if (!window.confirm(`ยืนยันลบวันหยุด "${name}"?`)) return
    try {
      await hrService.deleteHoliday(id)
      toast.success('ลบวันหยุดแล้ว')
      loadHolidays()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ลบวันหยุดไม่สำเร็จ')
    }
  }

  // Today string for cancellation logic: PENDING or future APPROVED
  // ponytail: status cancellation check uses client local date as approximation; server validates Thai TZ
  const today = todayStr()
  const canCancel = (req: LeaveRequest) => {
    if (req.status === 'PENDING') return true
    if (req.status === 'APPROVED' && req.start_date > today) return true
    return false
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">การลาและวันหยุด (Leave)</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              จัดการคำขอลา ตรวจสอบยอดวันลาคงเหลือ กำหนดประเภทการลา และปฏิทินวันหยุดบริษัท
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'requests'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Clock className="w-4 h-4" />
          คำขอลา
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('balances')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'balances'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          ยอดคงเหลือ
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('types')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'types'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          ประเภทลา
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('holidays')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'holidays'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Calendar className="w-4 h-4" />
          วันหยุดบริษัท
        </button>
      </div>

      {/* Tab 1: คำขอลา */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Info note */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--fg-2)]">
            <span>การพิจารณาอนุมัติคำขอลา ดำเนินการผ่านระบบอนุมัติเอกสาร</span>
            <Link to="/approvals" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
              ไปยังกล่องอนุมัติ →
            </Link>
          </div>

          {/* Filters & Action */}
          <div className="phopy-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">สถานะ</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="PENDING">รออนุมัติ</option>
                  <option value="APPROVED">อนุมัติ</option>
                  <option value="REJECTED">ไม่อนุมัติ</option>
                  <option value="CANCELLED">ยกเลิก</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">ตั้งแต่วันที่</label>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">ถึงวันที่</label>
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              {(filterStatus || filterFrom || filterTo) && (
                <div className="self-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatus('')
                      setFilterFrom('')
                      setFilterTo('')
                    }}
                    className="text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] underline"
                  >
                    ล้างตัวกรอง
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openCreateRequestModal}
              className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center justify-center gap-1.5 self-start md:self-end"
            >
              <Plus className="w-4 h-4" />
              บันทึกลาแทนพนักงาน
            </button>
          </div>

          {/* Table */}
          <div className="phopy-card overflow-hidden">
            {loadingRequests ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดรายการคำขอลา...</div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบคำขอลาตามเงื่อนไขที่เลือก</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">พนักงาน</th>
                      <th className="py-2.5 px-3">แผนก</th>
                      <th className="py-2.5 px-3">ประเภท</th>
                      <th className="py-2.5 px-3">ช่วงวันที่</th>
                      <th className="py-2.5 px-3 text-right">วัน</th>
                      <th className="py-2.5 px-3">เหตุผล</th>
                      <th className="py-2.5 px-3 text-center">สถานะ</th>
                      <th className="py-2.5 px-3 text-center">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {requests.map((r) => (
                      <tr key={r.id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[var(--fg-1)]">{r.employee_name}</div>
                          <div className="text-[11px] text-[var(--fg-3)]">{r.employee_code}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)]">{r.org_unit_name || '-'}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-medium text-[var(--fg-1)]">{r.leave_type_name}</span>
                          {!r.paid && <span className="ml-1.5 text-[10px] text-amber-600">(ไม่รับค่าจ้าง)</span>}
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)] font-mono">
                          {r.start_date === r.end_date ? r.start_date : `${r.start_date} ถึง ${r.end_date}`}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-[var(--fg-1)]">
                          {r.days}
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)] max-w-xs truncate" title={r.reason || ''}>
                          {r.reason || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              STATUS_BADGE[r.status] || 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                            }`}
                          >
                            {STATUS_LABELS[r.status] || r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {canCancel(r) ? (
                            <button
                              type="button"
                              onClick={() => handleCancelRequest(r.id)}
                              className="text-xs text-red-600 hover:text-red-700 hover:underline font-medium"
                            >
                              ยกเลิก
                            </button>
                          ) : (
                            <span className="text-[var(--fg-3)]">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: ยอดคงเหลือ */}
      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="phopy-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เลือกพนักงาน</label>
              <select
                value={selectedBalanceEmpId}
                onChange={(e) => setSelectedBalanceEmpId(e.target.value)}
                className="w-full sm:w-80 px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              >
                <option value="">-- กรุณาเลือกพนักงาน --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} - {emp.first_name} {emp.last_name || ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ประจำปี</label>
              <input
                type="number"
                min="2000"
                max="2100"
                value={balanceYear}
                onChange={(e) => setBalanceYear(parseInt(e.target.value, 10) || currentYear())}
                className="w-28 px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
              />
            </div>
          </div>

          <div className="phopy-card overflow-hidden">
            {!selectedBalanceEmpId ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">
                กรุณาเลือกพนักงานเพื่อดูยอดวันลาคงเหลือ
              </div>
            ) : loadingBalances ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดยอดวันลาคงเหลือ...</div>
            ) : balances.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">
                ไม่พบข้อมูลยอดวันลาคงเหลือสำหรับพนักงานนี้
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-4">ประเภท</th>
                      <th className="py-2.5 px-4 text-right">โควตา</th>
                      <th className="py-2.5 px-4 text-right">ใช้แล้ว</th>
                      <th className="py-2.5 px-4 text-right">รออนุมัติ</th>
                      <th className="py-2.5 px-4 text-right">คงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {balances.map((b) => (
                      <tr key={b.leave_type_id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2.5 px-4">
                          <span className="font-medium text-[var(--fg-1)]">{b.name}</span>
                          <span className="ml-2 text-[11px] text-[var(--fg-3)]">({b.code})</span>
                          {!b.paid && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface-2)] text-[var(--fg-3)]">
                              ไม่รับค่าจ้าง
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--fg-1)]">
                          {b.quota !== null && b.quota !== undefined ? `${b.quota} วัน` : 'ไม่จำกัด'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--fg-1)]">
                          {b.used} วัน
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-amber-600">
                          {b.pending} วัน
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-[var(--fg-1)]">
                          {b.remaining !== null && b.remaining !== undefined ? `${b.remaining} วัน` : 'ไม่จำกัด'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: ประเภทลา */}
      {activeTab === 'types' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--fg-3)]">
              กำหนดสิทธิและโควตาวันลาต่อปีของพนักงาน (เว้นว่างโควตาเพื่อไม่จำกัดจำนวนวัน)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={creatingStarter}
                onClick={handleCreateStarterTypes}
                className="px-3 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--fg-1)] hover:bg-[var(--surface-2)] flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                {creatingStarter ? 'กำลังสร้าง...' : 'สร้างประเภทลาตามกฎหมาย'}
              </button>
              <button
                type="button"
                onClick={openCreateTypeModal}
                className="phopy-btn-primary px-3 py-2 text-xs rounded-lg font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                เพิ่มประเภทลา
              </button>
            </div>
          </div>

          <div className="phopy-card overflow-hidden">
            {loadingTypes ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดประเภทการลา...</div>
            ) : leaveTypes.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">
                ยังไม่มีประเภทการลา กดปุ่ม &ldquo;สร้างประเภทลาตามกฎหมาย&rdquo; เพื่อเริ่มต้นอย่างรวดเร็ว
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-4">รหัส</th>
                      <th className="py-2.5 px-4">ชื่อประเภทลา</th>
                      <th className="py-2.5 px-4 text-center">ได้รับค่าจ้าง</th>
                      <th className="py-2.5 px-4 text-right">โควตาต่อปี</th>
                      <th className="py-2.5 px-4 text-center">สถานะ</th>
                      <th className="py-2.5 px-4 text-right">แก้ไข</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {leaveTypes.map((t) => (
                      <tr key={t.id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2.5 px-4 font-mono font-medium text-[var(--fg-1)]">{t.code}</td>
                        <td className="py-2.5 px-4 font-medium text-[var(--fg-1)]">{t.name}</td>
                        <td className="py-2.5 px-4 text-center">
                          {t.paid ? (
                            <span className="text-[var(--success)] font-medium">ได้รับค่าจ้าง</span>
                          ) : (
                            <span className="text-[var(--fg-3)]">ไม่ได้รับค่าจ้าง</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--fg-1)]">
                          {t.days_per_year !== null && t.days_per_year !== undefined
                            ? `${t.days_per_year} วัน`
                            : 'ไม่จำกัด'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              t.is_active
                                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                : 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                            }`}
                          >
                            {t.is_active ? 'ใช้งาน' : 'ปิดการใช้งาน'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openEditTypeModal(t)}
                            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                            title="แก้ไข"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: วันหยุดบริษัท */}
      {activeTab === 'holidays' && (
        <div className="space-y-4">
          <div className="phopy-card p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-[var(--fg-2)]">ปีปฏิทิน</label>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={holidayYear}
                  onChange={(e) => setHolidayYear(parseInt(e.target.value, 10) || currentYear())}
                  className="w-24 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] font-mono"
                />
              </div>

              {/* Warning pill: N < 13 */}
              {holidays.length < 13 && (
                <div className="bg-amber-500/15 text-amber-600 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>ปีนี้มี {holidays.length} วัน ต้องไม่น้อยกว่า 13 วัน รวมวันแรงงาน (ม.29)</span>
                </div>
              )}
            </div>

            {/* Inline Add Holiday Form */}
            <form onSubmit={handleAddHoliday} className="pt-2 border-t border-[var(--border)] flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">วันที่ *</label>
                <input
                  type="date"
                  required
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex-1 min-w-[200px]">
                <label className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">ชื่อวันหยุด *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น วันขึ้นปีใหม่, วันแรงงานแห่งชาติ"
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <button
                type="submit"
                disabled={addingHoliday}
                className="phopy-btn-primary px-3 py-1.5 text-xs rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {addingHoliday ? 'กำลังเพิ่ม...' : 'เพิ่มวันหยุด'}
              </button>
            </form>
          </div>

          <div className="phopy-card overflow-hidden">
            {loadingHolidays ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดวันหยุดบริษัท...</div>
            ) : holidays.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">
                ยังไม่มีวันหยุดประจำปี {holidayYear}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-4">วันที่</th>
                      <th className="py-2.5 px-4">ชื่อวันหยุด</th>
                      <th className="py-2.5 px-4 text-right">ลบ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {holidays.map((h) => (
                      <tr key={h.id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2.5 px-4 font-mono font-medium text-[var(--fg-1)]">{h.date}</td>
                        <td className="py-2.5 px-4 font-medium text-[var(--fg-1)]">{h.name}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteHoliday(h.id, h.name)}
                            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--danger)]"
                            title="ลบวันหยุด"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: บันทึกลาแทนพนักงาน */}
      {createReqOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">บันทึกลาแทนพนักงาน</h2>
              <button
                type="button"
                onClick={() => setCreateReqOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">พนักงาน *</label>
                <select
                  required
                  value={reqEmpId}
                  onChange={(e) => setReqEmpId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- กรุณาเลือกพนักงาน --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} - {e.first_name} {e.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ประเภทการลา *</label>
                <select
                  required
                  value={reqTypeId}
                  onChange={(e) => setReqTypeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="">-- กรุณาเลือกประเภทลา --</option>
                  {leaveTypes
                    .filter((t) => t.is_active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code}) {t.paid ? '' : '· ไม่รับค่าจ้าง'}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เริ่มวันที่ *</label>
                  <input
                    type="date"
                    required
                    value={reqStartDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ถึงวันที่ *</label>
                  <input
                    type="date"
                    required
                    min={reqStartDate}
                    value={reqEndDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  จำนวนวันลา * (ทีละ 0.5 วัน)
                </label>
                <input
                  type="number"
                  required
                  step="0.5"
                  min="0.5"
                  value={reqDays}
                  onChange={(e) => setReqDays(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">เหตุผลการลา</label>
                <textarea
                  rows={3}
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  placeholder="ระบุเหตุผลการลา (ถ้ามี)"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setCreateReqOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submittingReq}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingReq ? 'กำลังบันทึก...' : 'บันทึกคำขอลา'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: เพิ่ม/แก้ไขประเภทลา */}
      {typeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                {editingType ? 'แก้ไขประเภทการลา' : 'เพิ่มประเภทการลาใหม่'}
              </h2>
              <button
                type="button"
                onClick={() => setTypeModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveType} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  รหัสประเภทลา (Code) * {editingType && <span className="text-[var(--fg-3)]">(แก้ไขไม่ได้)</span>}
                </label>
                <input
                  type="text"
                  required
                  disabled={!!editingType}
                  placeholder="เช่น SICK, VACATION, UNPAID"
                  value={typeCode}
                  onChange={(e) => setTypeCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] disabled:opacity-50 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">ชื่อประเภทลา *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ลาป่วย, ลาพักร้อน"
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  โควตาวันลาต่อปี (วัน) <span className="text-[var(--fg-3)]">(เว้นว่าง = ไม่จำกัด)</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="เว้นว่าง = ไม่จำกัด"
                  value={typeDaysPerYear}
                  onChange={(e) => setTypeDaysPerYear(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="type_paid"
                  type="checkbox"
                  checked={typePaid}
                  onChange={(e) => setTypePaid(e.target.checked)}
                />
                <label htmlFor="type_paid" className="text-sm text-[var(--fg-2)] cursor-pointer">
                  ได้รับค่าจ้างระหว่างลา (Paid Leave)
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="type_active"
                  type="checkbox"
                  checked={typeActive}
                  onChange={(e) => setTypeActive(e.target.checked)}
                />
                <label htmlFor="type_active" className="text-sm text-[var(--fg-2)] cursor-pointer">
                  เปิดใช้งานประเภทลานี้
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setTypeModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--fg-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingType}
                  className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingType ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
