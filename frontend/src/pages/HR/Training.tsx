import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GraduationCap,
  BookOpen,
  Calendar,
  AlertCircle,
  Plus,
  X,
  Pencil,
  Trash2,
  Search,
  FileText,
  Clock,
  Filter,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  TrainingCourse,
  TrainingCourseInput,
  TrainingRecord,
  TrainingKind,
  Employee,
} from '../../services/hr.service'
import { PaymentAttachments } from '../../components/common/PaymentAttachments'

type TabKey = 'courses' | 'records' | 'expiring'

const todayStr = () => new Date().toISOString().slice(0, 10)

// ponytail: expiry badge thresholds: <0 expired, <=30 warning, >30 valid; ceiling is fixed 30-day cutoff, upgrade path is configurable alert window
export function renderExpiryPill(days_left: number | null | undefined) {
  if (days_left === null || days_left === undefined) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface-2)] text-[var(--fg-3)]">
        ไม่หมดอายุ
      </span>
    )
  }
  if (days_left < 0) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">
        หมดแล้ว {Math.abs(days_left)} วัน
      </span>
    )
  }
  if (days_left <= 30) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
        เหลือ {days_left} วัน
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface-2)] text-[var(--fg-2)]">
      เหลือ {days_left} วัน
    </span>
  )
}

export default function Training() {
  const [activeTab, setActiveTab] = useState<TabKey>('records')

  // Shared master data
  const [courses, setCourses] = useState<TrainingCourse[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])

  // Tab 1: Courses
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [courseModalOpen, setCourseModalOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<TrainingCourse | null>(null)
  const [courseName, setCourseName] = useState('')
  const [courseKind, setCourseKind] = useState<TrainingKind>('INTERNAL')
  const [courseMandatory, setCourseMandatory] = useState(false)
  const [courseValidityMonths, setCourseValidityMonths] = useState('')
  const [courseActive, setCourseActive] = useState(true)
  const [savingCourse, setSavingCourse] = useState(false)

  // Tab 2: Records
  const [records, setRecords] = useState<TrainingRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterCourseId, setFilterCourseId] = useState('')

  // Modal: Create round of training ("บันทึกรอบอบรม")
  const [createRoundOpen, setCreateRoundOpen] = useState(false)
  const [roundCourseId, setRoundCourseId] = useState('')
  const [roundTrainedOn, setRoundTrainedOn] = useState(todayStr())
  const [roundSelectedEmpIds, setRoundSelectedEmpIds] = useState<string[]>([])
  const [roundEmpSearch, setRoundEmpSearch] = useState('')
  const [roundProvider, setRoundProvider] = useState('')
  const [roundNotes, setRoundNotes] = useState('')
  const [roundExpiresOn, setRoundExpiresOn] = useState('')
  const [savingRound, setSavingRound] = useState(false)

  // Modal: Edit single record (from table row click)
  const [editingRecord, setEditingRecord] = useState<TrainingRecord | null>(null)
  const [editTrainedOn, setEditTrainedOn] = useState('')
  const [editExpiresOn, setEditExpiresOn] = useState('')
  const [editProvider, setEditProvider] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingRecord, setSavingRecord] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState(false)

  // Tab 3: Expiring
  const [expiringRecords, setExpiringRecords] = useState<TrainingRecord[]>([])
  const [loadingExpiring, setLoadingExpiring] = useState(false)

  // Load baseline courses
  const loadCourses = useCallback(async () => {
    setLoadingCourses(true)
    try {
      const list = await hrService.getTrainingCourses()
      setCourses(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดหลักสูตรไม่สำเร็จ')
    } finally {
      setLoadingCourses(false)
    }
  }, [])

  // Load active employees
  const loadEmployees = useCallback(async () => {
    try {
      const list = await hrService.getEmployees({ status: 'ACTIVE' })
      setEmployees(list || [])
    } catch {
      // non-critical employee list load error
    }
  }, [])

  // Load training records
  const loadRecords = useCallback(async () => {
    setLoadingRecords(true)
    try {
      const params: { employee_id?: string; course_id?: string } = {}
      if (filterEmployeeId) params.employee_id = filterEmployeeId
      if (filterCourseId) params.course_id = filterCourseId
      const list = await hrService.getTrainingRecords(params)
      setRecords(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดบันทึกการอบรมไม่สำเร็จ')
    } finally {
      setLoadingRecords(false)
    }
  }, [filterEmployeeId, filterCourseId])

  // Load expiring records (60 days)
  const loadExpiring = useCallback(async () => {
    setLoadingExpiring(true)
    try {
      const list = await hrService.getExpiringTraining(60)
      setExpiringRecords(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการใกล้หมดอายุไม่สำเร็จ')
    } finally {
      setLoadingExpiring(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadCourses()
    loadEmployees()
    loadExpiring()
  }, [loadCourses, loadEmployees, loadExpiring])

  // Tab switch effect
  useEffect(() => {
    if (activeTab === 'records') {
      loadRecords()
    } else if (activeTab === 'courses') {
      loadCourses()
    } else if (activeTab === 'expiring') {
      loadExpiring()
    }
  }, [activeTab, loadRecords, loadCourses, loadExpiring])

  // Course actions
  const openAddCourseModal = () => {
    setEditingCourse(null)
    setCourseName('')
    setCourseKind('INTERNAL')
    setCourseMandatory(false)
    setCourseValidityMonths('')
    setCourseActive(true)
    setCourseModalOpen(true)
  }

  const openEditCourseModal = (c: TrainingCourse) => {
    setEditingCourse(c)
    setCourseName(c.name)
    setCourseKind(c.kind)
    setCourseMandatory(c.mandatory)
    setCourseValidityMonths(c.validity_months !== null && c.validity_months !== undefined ? String(c.validity_months) : '')
    setCourseActive(c.is_active)
    setCourseModalOpen(true)
  }

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!courseName.trim()) {
      toast.error('กรุณาระบุชื่อหลักสูตร')
      return
    }

    setSavingCourse(true)
    try {
      const validity = courseValidityMonths.trim() === '' ? null : parseInt(courseValidityMonths, 10)
      if (editingCourse) {
        await hrService.updateTrainingCourse(editingCourse.id, {
          name: courseName.trim(),
          kind: courseKind,
          mandatory: courseMandatory,
          validity_months: validity,
          is_active: courseActive,
        })
        toast.success('แก้ไขหลักสูตรเรียบร้อย')
      } else {
        const input: TrainingCourseInput = {
          name: courseName.trim(),
          kind: courseKind,
          mandatory: courseMandatory,
          validity_months: validity,
        }
        await hrService.createTrainingCourse(input)
        toast.success('เพิ่มหลักสูตรเรียบร้อย')
      }
      setCourseModalOpen(false)
      loadCourses()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกหลักสูตรไม่สำเร็จ')
    } finally {
      setSavingCourse(false)
    }
  }

  // Create training round actions
  const openCreateRoundModal = () => {
    const activeCourses = courses.filter((c) => c.is_active)
    setRoundCourseId(activeCourses[0]?.id || courses[0]?.id || '')
    setRoundTrainedOn(todayStr())
    setRoundSelectedEmpIds([])
    setRoundEmpSearch('')
    setRoundProvider('')
    setRoundNotes('')
    setRoundExpiresOn('')
    setCreateRoundOpen(true)
  }

  const handleSaveRound = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roundCourseId) {
      toast.error('กรุณาเลือกหลักสูตร')
      return
    }
    if (!roundTrainedOn) {
      toast.error('กรุณาระบุวันที่อบรม')
      return
    }
    if (roundSelectedEmpIds.length === 0) {
      toast.error('กรุณาเลือกพนักงานอย่างน้อย 1 คน')
      return
    }

    setSavingRound(true)
    try {
      await hrService.createTrainingRecords({
        course_id: roundCourseId,
        employee_ids: roundSelectedEmpIds,
        trained_on: roundTrainedOn,
        expires_on: roundExpiresOn.trim() ? roundExpiresOn : undefined,
        provider: roundProvider.trim() || null,
        notes: roundNotes.trim() || null,
      })
      toast.success('บันทึกรอบอบรมเรียบร้อย')
      setCreateRoundOpen(false)
      loadRecords()
      loadExpiring()
      loadCourses()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกรอบอบรมไม่สำเร็จ')
    } finally {
      setSavingRound(false)
    }
  }

  // Edit single record actions
  const openEditRecordModal = (r: TrainingRecord) => {
    setEditingRecord(r)
    setEditTrainedOn(r.trained_on || '')
    setEditExpiresOn(r.expires_on || '')
    setEditProvider(r.provider || '')
    setEditNotes(r.notes || '')
  }

  const handleUpdateRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRecord) return
    if (!editTrainedOn) {
      toast.error('กรุณาระบุวันที่อบรม')
      return
    }

    setSavingRecord(true)
    try {
      await hrService.updateTrainingRecord(editingRecord.id, {
        trained_on: editTrainedOn,
        expires_on: editExpiresOn.trim() ? editExpiresOn : null,
        provider: editProvider.trim() || null,
        notes: editNotes.trim() || null,
      })
      toast.success('บันทึกข้อมูลเรียบร้อย')
      setEditingRecord(null)
      loadRecords()
      loadExpiring()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกข้อมูลไม่สำเร็จ')
    } finally {
      setSavingRecord(false)
    }
  }

  const handleDeleteRecord = async () => {
    if (!editingRecord) return
    if (!window.confirm('ยืนยันลบบันทึกการอบรมนี้?')) return

    setDeletingRecord(true)
    try {
      await hrService.deleteTrainingRecord(editingRecord.id)
      toast.success('ลบบันทึกอบรมสำเร็จ')
      setEditingRecord(null)
      loadRecords()
      loadExpiring()
      loadCourses()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ลบบันทึกอบรมไม่สำเร็จ')
    } finally {
      setDeletingRecord(false)
    }
  }

  // Filtered employees for round modal
  const filteredActiveEmployees = useMemo(() => {
    const q = roundEmpSearch.trim().toLowerCase()
    return employees.filter((emp) => {
      if (emp.status && emp.status !== 'ACTIVE') return false
      if (!q) return true
      const fullName = `${emp.first_name} ${emp.last_name || ''}`.toLowerCase()
      const code = (emp.code || '').toLowerCase()
      const nickname = (emp.nickname || '').toLowerCase()
      return fullName.includes(q) || code.includes(q) || nickname.includes(q)
    })
  }, [employees, roundEmpSearch])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">บันทึกอบรม</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              จัดการหลักสูตรการอบรม บันทึกรอบการฝึกอบรมของพนักงาน และติดตามใบรับรองที่ใกล้หมดอายุ
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('courses')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'courses'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          หลักสูตร
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('records')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'records'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <Calendar className="w-4 h-4" />
          บันทึกอบรม
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('expiring')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'expiring'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          <AlertCircle className="w-4 h-4" />
          <span>ใกล้หมดอายุ</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
              activeTab === 'expiring'
                ? 'bg-white/20 text-white'
                : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
            }`}
          >
            {expiringRecords.length}
          </span>
        </button>
      </div>

      {/* Tab 1: หลักสูตร (Courses) */}
      {activeTab === 'courses' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openAddCourseModal}
              className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              เพิ่มหลักสูตร
            </button>
          </div>

          <div className="phopy-card overflow-hidden">
            {loadingCourses ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดหลักสูตร...</div>
            ) : courses.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีหลักสูตรการอบรม</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">ชื่อหลักสูตร</th>
                      <th className="py-2.5 px-3">ภายใน/ภายนอก</th>
                      <th className="py-2.5 px-3 text-center">บังคับ</th>
                      <th className="py-2.5 px-3">อายุใบรับรอง</th>
                      <th className="py-2.5 px-3 text-right">จำนวนบันทึก</th>
                      <th className="py-2.5 px-3 text-center">สถานะ</th>
                      <th className="py-2.5 px-3 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {courses.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--surface-2)]/60">
                        <td className="py-2.5 px-3 font-medium text-[var(--fg-1)]">{c.name}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              c.kind === 'INTERNAL'
                                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                            }`}
                          >
                            {c.kind === 'INTERNAL' ? 'ภายใน' : 'ภายนอก'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {c.mandatory ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">
                              บังคับ
                            </span>
                          ) : (
                            <span className="text-[var(--fg-3)]">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)]">
                          {c.validity_months ? `${c.validity_months} เดือน` : 'ไม่หมดอายุ'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-[var(--fg-1)]">
                          {c.record_count}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              c.is_active
                                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                                : 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                            }`}
                          >
                            {c.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => openEditCourseModal(c)}
                            className="p-1 rounded hover:bg-[var(--surface-2)] text-blue-600 dark:text-blue-400 inline-flex items-center gap-1 text-xs"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>แก้ไข</span>
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

      {/* Tab 2: บันทึกอบรม (Records) */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {/* Filters & Action */}
          <div className="phopy-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label htmlFor="filter-employee" className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">
                  พนักงาน
                </label>
                <select
                  id="filter-employee"
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)] min-w-[160px]"
                >
                  <option value="">พนักงานทั้งหมด</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} - {emp.first_name} {emp.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-course" className="block text-[11px] font-medium text-[var(--fg-3)] mb-1">
                  หลักสูตร
                </label>
                <select
                  id="filter-course"
                  value={filterCourseId}
                  onChange={(e) => setFilterCourseId(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-1)] min-w-[160px]"
                >
                  <option value="">หลักสูตรทั้งหมด</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {(filterEmployeeId || filterCourseId) && (
                <div className="self-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterEmployeeId('')
                      setFilterCourseId('')
                    }}
                    className="text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] underline flex items-center gap-1"
                  >
                    <Filter className="w-3 h-3" />
                    ล้างตัวกรอง
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openCreateRoundModal}
              className="phopy-btn-primary px-4 py-2 text-sm rounded-lg font-semibold flex items-center justify-center gap-1.5 self-start md:self-end"
            >
              <Plus className="w-4 h-4" />
              บันทึกรอบอบรม
            </button>
          </div>

          {/* Table */}
          <div className="phopy-card overflow-hidden">
            {loadingRecords ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดบันทึกการอบรม...</div>
            ) : records.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่พบบันทึกการอบรม</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">วันที่อบรม</th>
                      <th className="py-2.5 px-3">หลักสูตร</th>
                      <th className="py-2.5 px-3">พนักงาน</th>
                      <th className="py-2.5 px-3">ผู้สอน/สถาบัน</th>
                      <th className="py-2.5 px-3">หมดอายุ</th>
                      <th className="py-2.5 px-3 text-center">ไฟล์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {records.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => openEditRecordModal(r)}
                        className="cursor-pointer hover:bg-[var(--surface-2)]/60 transition-colors"
                        title="คลิกเพื่อดูและแก้ไขบันทึก"
                      >
                        <td className="py-2.5 px-3 font-mono text-[var(--fg-1)]">{r.trained_on}</td>
                        <td className="py-2.5 px-3 font-medium text-[var(--fg-1)]">{r.course_name}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[var(--fg-1)]">{r.employee_name}</div>
                          <div className="text-[11px] text-[var(--fg-3)] font-mono">{r.employee_code}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)]">{r.provider || '-'}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[var(--fg-1)]">{r.expires_on || '-'}</span>
                            <div>{renderExpiryPill(r.days_left)}</div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 text-[var(--fg-2)] font-mono">
                            <FileText className="w-3.5 h-3.5 text-[var(--fg-3)]" />
                            {r.attachment_count}
                          </span>
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

      {/* Tab 3: ใกล้หมดอายุ (Expiring) */}
      {activeTab === 'expiring' && (
        <div className="space-y-4">
          <div className="phopy-card p-4 text-xs text-[var(--fg-2)] bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <span>แสดงรายการอบรมของพนักงานสถานะ ACTIVE ที่ใบรับรองใกล้หมดอายุใน 60 วัน หรือหมดอายุแล้ว</span>
          </div>

          <div className="phopy-card overflow-hidden">
            {loadingExpiring ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">กำลังโหลดรายการใกล้หมดอายุ...</div>
            ) : expiringRecords.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ไม่มีหลักสูตรอบรมที่ใกล้หมดอายุใน 60 วัน</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--fg-3)]">
                      <th className="py-2.5 px-3">วันที่อบรม</th>
                      <th className="py-2.5 px-3">หลักสูตร</th>
                      <th className="py-2.5 px-3">พนักงาน</th>
                      <th className="py-2.5 px-3">ผู้สอน/สถาบัน</th>
                      <th className="py-2.5 px-3">หมดอายุ</th>
                      <th className="py-2.5 px-3 text-center">สถานะ</th>
                      <th className="py-2.5 px-3 text-center">ไฟล์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {expiringRecords.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => openEditRecordModal(r)}
                        className="cursor-pointer hover:bg-[var(--surface-2)]/60 transition-colors"
                        title="คลิกเพื่อดูและแก้ไขบันทึก"
                      >
                        <td className="py-2.5 px-3 font-mono text-[var(--fg-1)]">{r.trained_on}</td>
                        <td className="py-2.5 px-3 font-medium text-[var(--fg-1)]">{r.course_name}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[var(--fg-1)]">{r.employee_name}</div>
                          <div className="text-[11px] text-[var(--fg-3)] font-mono">{r.employee_code}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--fg-2)]">{r.provider || '-'}</td>
                        <td className="py-2.5 px-3 font-mono text-[var(--fg-1)]">{r.expires_on || '-'}</td>
                        <td className="py-2.5 px-3 text-center">{renderExpiryPill(r.days_left)}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 text-[var(--fg-2)] font-mono">
                            <FileText className="w-3.5 h-3.5 text-[var(--fg-3)]" />
                            {r.attachment_count}
                          </span>
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

      {/* Modal: เพิ่ม/แก้ไขหลักสูตร */}
      {courseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">
                {editingCourse ? 'แก้ไขหลักสูตร' : 'เพิ่มหลักสูตร'}
              </h2>
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveCourse} className="space-y-4">
              <div>
                <label htmlFor="course-name" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ชื่อหลักสูตร *
                </label>
                <input
                  id="course-name"
                  type="text"
                  required
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="เช่น ความปลอดภัยในการทำงาน, ภาษาอังกฤษธุรกิจ"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="course-kind" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  รูปแบบการอบรม *
                </label>
                <select
                  id="course-kind"
                  value={courseKind}
                  onChange={(e) => setCourseKind(e.target.value as TrainingKind)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                >
                  <option value="INTERNAL">อบรมภายใน (INTERNAL)</option>
                  <option value="EXTERNAL">อบรมภายนอก (EXTERNAL)</option>
                </select>
              </div>

              <div>
                <label htmlFor="course-validity" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  อายุใบรับรอง (เดือน)
                </label>
                <input
                  id="course-validity"
                  type="number"
                  min="1"
                  max="120"
                  placeholder="ไม่หมดอายุ (ปล่อยว่าง)"
                  value={courseValidityMonths}
                  onChange={(e) => setCourseValidityMonths(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
                <span className="text-[11px] text-[var(--fg-3)]">
                  เว้นว่างไว้หากใบรับรองไม่มีวันหมดอายุ (1–120 เดือน)
                </span>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--fg-2)]">
                  <input
                    type="checkbox"
                    checked={courseMandatory}
                    onChange={(e) => setCourseMandatory(e.target.checked)}
                    className="rounded border-[var(--border)]"
                  />
                  <span>เป็นหลักสูตรบังคับ</span>
                </label>

                {editingCourse && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--fg-2)]">
                    <input
                      type="checkbox"
                      checked={courseActive}
                      onChange={(e) => setCourseActive(e.target.checked)}
                      className="rounded border-[var(--border)]"
                    />
                    <span>เปิดใช้งาน</span>
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setCourseModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingCourse}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingCourse ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: บันทึกรอบอบรม (Create Training Round) */}
      {createRoundOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--fg-1)]">บันทึกรอบอบรม</h2>
              <button
                type="button"
                onClick={() => setCreateRoundOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSaveRound} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="round-course" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    หลักสูตร *
                  </label>
                  <select
                    id="round-course"
                    required
                    value={roundCourseId}
                    onChange={(e) => setRoundCourseId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  >
                    <option value="">-- เลือกหลักสูตร --</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.kind === 'INTERNAL' ? 'ภายใน' : 'ภายนอก'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="round-trained-on" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่อบรม *
                  </label>
                  <input
                    id="round-trained-on"
                    type="date"
                    required
                    value={roundTrainedOn}
                    onChange={(e) => setRoundTrainedOn(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>
              </div>

              {/* Employee Multi-select with Search */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[var(--fg-2)]">
                    พนักงานที่เข้าอบรม * ({roundSelectedEmpIds.length} คนที่เลือก)
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setRoundSelectedEmpIds(filteredActiveEmployees.map((e) => e.id))}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      เลือกที่ค้นพบทั้งหมด
                    </button>
                    <span className="text-[var(--fg-3)]">·</span>
                    <button
                      type="button"
                      onClick={() => setRoundSelectedEmpIds([])}
                      className="text-[var(--fg-3)] hover:text-[var(--fg-1)] underline"
                    >
                      ล้างการเลือก
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--fg-3)]" />
                  <input
                    type="text"
                    placeholder="ค้นหาชื่อหรือรหัสพนักงาน..."
                    value={roundEmpSearch}
                    onChange={(e) => setRoundEmpSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>

                <div className="max-h-44 overflow-y-auto border border-[var(--border)] rounded-lg p-2 space-y-1 bg-[var(--surface-2)]/40">
                  {filteredActiveEmployees.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--fg-3)]">ไม่พบพนักงาน</div>
                  ) : (
                    filteredActiveEmployees.map((emp) => {
                      const isChecked = roundSelectedEmpIds.includes(emp.id)
                      return (
                        <label
                          key={emp.id}
                          htmlFor={`emp-chk-${emp.id}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-2)] cursor-pointer text-xs"
                        >
                          <input
                            id={`emp-chk-${emp.id}`}
                            type="checkbox"
                            checked={isChecked}
                            aria-label={`เลือก ${emp.code} ${emp.first_name}`}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setRoundSelectedEmpIds((prev) => [...prev, emp.id])
                              } else {
                                setRoundSelectedEmpIds((prev) => prev.filter((id) => id !== emp.id))
                              }
                            }}
                            className="rounded border-[var(--border)]"
                          />
                          <span className="font-mono text-[var(--fg-3)]">{emp.code}</span>
                          <span className="font-medium text-[var(--fg-1)]">
                            {emp.first_name} {emp.last_name || ''}
                          </span>
                          {emp.nickname && <span className="text-[var(--fg-3)]">({emp.nickname})</span>}
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="round-provider" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    ผู้สอน / สถาบัน
                  </label>
                  <input
                    id="round-provider"
                    type="text"
                    placeholder="เช่น สมาคมความปลอดภัย..."
                    value={roundProvider}
                    onChange={(e) => setRoundProvider(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>

                <div>
                  <label htmlFor="round-expires-on" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันหมดอายุ (ระบุเอง)
                  </label>
                  <input
                    id="round-expires-on"
                    type="date"
                    value={roundExpiresOn}
                    onChange={(e) => setRoundExpiresOn(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <span className="text-[11px] text-[var(--fg-3)]">
                    ปล่อยว่างเพื่อคำนวณอายุอัตโนมัติตามหลักสูตร
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="round-notes" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  หมายเหตุ
                </label>
                <textarea
                  id="round-notes"
                  rows={2}
                  placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                  value={roundNotes}
                  onChange={(e) => setRoundNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setCreateRoundOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingRound}
                  className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingRound ? 'กำลังบันทึก...' : 'บันทึกรอบอบรม'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: แก้ไขบันทึกอบรม (Row click edit modal) */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="phopy-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-base font-bold text-[var(--fg-1)]">แก้ไขบันทึกการอบรม</h2>
                <p className="text-xs text-[var(--fg-3)] mt-0.5">
                  {editingRecord.course_name} · {editingRecord.employee_name} ({editingRecord.employee_code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)]"
              >
                <X className="w-4 h-4 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleUpdateRecord} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-trained-on" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่อบรม *
                  </label>
                  <input
                    id="edit-trained-on"
                    type="date"
                    required
                    value={editTrainedOn}
                    onChange={(e) => setEditTrainedOn(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                </div>

                <div>
                  <label htmlFor="edit-expires-on" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันหมดอายุ
                  </label>
                  <input
                    id="edit-expires-on"
                    type="date"
                    value={editExpiresOn}
                    onChange={(e) => setEditExpiresOn(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                  />
                  <span className="text-[11px] text-[var(--fg-3)]">เว้นว่างไว้หากไม่หมดอายุ</span>
                </div>
              </div>

              <div>
                <label htmlFor="edit-provider" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ผู้สอน / สถาบัน
                </label>
                <input
                  id="edit-provider"
                  type="text"
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              <div>
                <label htmlFor="edit-notes" className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  หมายเหตุ
                </label>
                <textarea
                  id="edit-notes"
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)]"
                />
              </div>

              {/* Certificate Attachments via PaymentAttachments */}
              <div className="pt-2 border-t border-[var(--border)]">
                <label className="block text-xs font-semibold text-[var(--fg-2)] mb-2">
                  ไฟล์ใบรับรอง / หลักฐานการอบรม
                </label>
                <PaymentAttachments refType="TRAINING_RECORD" refId={editingRecord.id} dense />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  disabled={deletingRecord}
                  onClick={handleDeleteRecord}
                  className="px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-500/10 rounded-lg flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deletingRecord ? 'กำลังลบ...' : 'ลบบันทึก'}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRecord(null)}
                    className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={savingRecord}
                    className="phopy-btn-primary px-4 py-2 text-xs rounded-lg font-semibold disabled:opacity-50"
                  >
                    {savingRecord ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
