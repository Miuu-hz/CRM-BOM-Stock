import { Fragment, useEffect, useState, useCallback, ChangeEvent, DragEvent, FormEvent } from 'react'
import {
  Clock,
  Upload,
  Link2,
  BarChart2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit2,
  RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  Shift,
  Employee,
  DaySummary,
  AttendanceImportRecord,
  AttendanceImportResult,
  UnmappedPin,
  EmployeeAttendanceSummary,
  NoShiftEmployee,
} from '../../services/hr.service'

type TabKey = 'summary' | 'import' | 'unmapped' | 'shifts'

const todayStr = () => new Date().toISOString().slice(0, 10)
const monthStartStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

interface ShiftFormState {
  name: string
  start_time: string
  end_time: string
  grace_minutes: string
  break_minutes: string
  is_active: boolean
}

const emptyShiftForm = (): ShiftFormState => ({
  name: '',
  start_time: '09:00',
  end_time: '18:00',
  grace_minutes: '0',
  break_minutes: '60',
  is_active: true,
})

function dayStatusLabel(d: DaySummary): string {
  if (d.absent) return 'ขาดงาน'
  if (d.missingOut) return 'ลงเวลาไม่ครบ'
  return 'มาทำงาน'
}

export default function Attendance() {
  const [activeTab, setActiveTab] = useState<TabKey>('summary')

  // Summary state
  const [fromDate, setFromDate] = useState(monthStartStr())
  const [toDate, setToDate] = useState(todayStr())
  const [summaryRows, setSummaryRows] = useState<EmployeeAttendanceSummary[]>([])
  const [noShiftRows, setNoShiftRows] = useState<NoShiftEmployee[]>([])
  const [expandedEmpIds, setExpandedEmpIds] = useState<Record<string, boolean>>({})
  const [loadingSummary, setLoadingSummary] = useState(false)

  // Import state
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<AttendanceImportResult | null>(null)
  const [recentImports, setRecentImports] = useState<AttendanceImportRecord[]>([])

  // Unmapped pins state
  const [unmappedPins, setUnmappedPins] = useState<UnmappedPin[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmpByPin, setSelectedEmpByPin] = useState<Record<string, string>>({})
  const [mappingPin, setMappingPin] = useState<string | null>(null)

  // Shifts state
  const [shifts, setShifts] = useState<Shift[]>([])
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [shiftForm, setShiftForm] = useState<ShiftFormState>(emptyShiftForm())
  const [savingShift, setSavingShift] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const res = await hrService.getAttendanceSummary({ from: fromDate, to: toDate })
      setSummaryRows(res?.employees || [])
      setNoShiftRows(res?.noShift || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดสรุปเวลาเข้าออกไม่สำเร็จ')
    } finally {
      setLoadingSummary(false)
    }
  }, [fromDate, toDate])

  const loadImports = useCallback(async () => {
    if (typeof hrService.getAttendanceImports !== 'function') return
    try {
      const list = await hrService.getAttendanceImports()
      setRecentImports(list || [])
    } catch {
      // ignore non-critical error
    }
  }, [])

  const loadUnmapped = useCallback(async () => {
    try {
      const [pins, emps] = await Promise.all([
        typeof hrService.getUnmappedPins === 'function' ? hrService.getUnmappedPins() : Promise.resolve([]),
        typeof hrService.getEmployees === 'function' ? hrService.getEmployees({ status: 'ACTIVE' }) : Promise.resolve([]),
      ])
      setUnmappedPins(pins || [])
      setEmployees(emps || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการรหัสเครื่องไม่สำเร็จ')
    }
  }, [])

  const loadShifts = useCallback(async () => {
    if (typeof hrService.getShifts !== 'function') return
    try {
      const list = await hrService.getShifts()
      setShifts(list || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดข้อมูลกะงานไม่สำเร็จ')
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'summary') loadSummary()
    else if (activeTab === 'import') loadImports()
    else if (activeTab === 'unmapped') loadUnmapped()
    else if (activeTab === 'shifts') loadShifts()
  }, [activeTab, loadSummary, loadImports, loadUnmapped, loadShifts])

  const toggleExpand = (empId: string) => {
    setExpandedEmpIds(prev => ({ ...prev, [empId]: !prev[empId] }))
  }

  const processFile = async (file: File) => {
    setImporting(true)
    try {
      const content = await file.text()
      const res = await hrService.importAttendance({ filename: file.name, content })
      setImportResult(res)
      toast.success(`นำเข้าสำเร็จ เพิ่มใหม่ ${res.inserted} รายการ`)
      loadImports()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'นำเข้าไฟล์เวลาไม่สำเร็จ')
    } finally {
      setImporting(false)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const handleAssignPin = async (pin: string) => {
    const empId = selectedEmpByPin[pin]
    if (!empId) {
      toast.error('กรุณาเลือกพนักงาน')
      return
    }
    setMappingPin(pin)
    try {
      await hrService.updateEmployee(empId, { device_pin: pin })
      toast.success(`ผูก PIN ${pin} สำเร็จ`)
      loadUnmapped()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ผูกรหัสเครื่องไม่สำเร็จ')
    } finally {
      setMappingPin(null)
    }
  }

  const openCreateShift = () => {
    setEditingShift(null)
    setShiftForm(emptyShiftForm())
    setShiftModalOpen(true)
  }

  const openEditShift = (sh: Shift) => {
    setEditingShift(sh)
    setShiftForm({
      name: sh.name,
      start_time: sh.start_time,
      end_time: sh.end_time,
      grace_minutes: String(sh.grace_minutes ?? 0),
      break_minutes: String(sh.break_minutes ?? 60),
      is_active: sh.is_active !== 0,
    })
    setShiftModalOpen(true)
  }

  const handleSaveShift = async (e: FormEvent) => {
    e.preventDefault()
    if (!shiftForm.name.trim()) {
      toast.error('กรุณาระบุชื่อกะงาน')
      return
    }
    setSavingShift(true)
    try {
      const payload = {
        name: shiftForm.name.trim(),
        start_time: shiftForm.start_time,
        end_time: shiftForm.end_time,
        grace_minutes: Number(shiftForm.grace_minutes) || 0,
        break_minutes: Number(shiftForm.break_minutes) || 0,
        is_active: shiftForm.is_active,
      }
      if (editingShift) {
        await hrService.updateShift(editingShift.id, payload)
        toast.success('แก้ไขกะงานสำเร็จ')
      } else {
        await hrService.createShift(payload)
        toast.success('เพิ่มกะงานสำเร็จ')
      }
      setShiftModalOpen(false)
      loadShifts()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกกะงานไม่สำเร็จ')
    } finally {
      setSavingShift(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">เวลาเข้าออก (Attendance)</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              นำเข้าเวลาสแกนนิ้ว จับคู่รหัสเครื่อง สรุปวันทำงาน/สาย/OT และจัดการกะงาน
            </p>
          </div>
        </div>
        <div>
          <a
            href="/hr/kiosk"
            className="phopy-btn-primary inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          >
            เปิดหน้าเช็คอินหน้าร้าน
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'import'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <Upload className="w-4 h-4" />
          นำเข้า
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('unmapped')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'unmapped'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <Link2 className="w-4 h-4" />
          จับคู่รหัสเครื่อง
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'summary'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          สรุป
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('shifts')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'shifts'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          กะงาน
        </button>
      </div>

      {/* Tab: Summary */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ตั้งแต่วันที่</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ถึงวันที่</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={loadSummary}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              ดูสรุป
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 font-medium w-10"></th>
                    <th className="px-4 py-3 font-medium">พนักงาน</th>
                    <th className="px-4 py-3 font-medium">กะงาน</th>
                    <th className="px-4 py-3 font-medium text-right">วันทำงาน</th>
                    <th className="px-4 py-3 font-medium text-right">สาย (นาที)</th>
                    <th className="px-4 py-3 font-medium text-right">กลับก่อน</th>
                    <th className="px-4 py-3 font-medium text-right">OT ที่รออนุมัติ (ชม.)</th>
                    <th className="px-4 py-3 font-medium text-right">ขาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {loadingSummary ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        กำลังโหลดข้อมูล...
                      </td>
                    </tr>
                  ) : summaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        ไม่พบข้อมูลสรุปเวลาทำงานในช่วงที่เลือก
                      </td>
                    </tr>
                  ) : (
                    summaryRows.map(row => {
                      const empId = row.employee?.id || row.id
                      const empCode = row.employee?.code || row.code
                      const empFirst = row.employee?.first_name || row.first_name
                      const empLast = row.employee?.last_name ?? row.last_name ?? ''
                      const shiftName = row.shift?.name || row.shift_name
                      const shiftStart = row.shift?.start || row.shift?.start_time || ''
                      const shiftEnd = row.shift?.end || row.shift?.end_time || ''
                      const expanded = !!expandedEmpIds[empId]
                      const otHours = (row.totals.otCandidateMinutes / 60).toFixed(2)
                      return (
                        <Fragment key={empId}>
                          <tr
                            onClick={() => toggleExpand(empId)}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                            data-testid={`summary-row-${empId}`}
                          >
                            <td className="px-4 py-3 text-gray-400">
                              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                              <span className="font-mono text-xs text-blue-600 dark:text-blue-400 mr-2">
                                {empCode}
                              </span>
                              {empFirst} {empLast}
                            </td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                              {shiftName} ({shiftStart}–{shiftEnd})
                            </td>
                            <td className="px-4 py-3 text-right font-medium">{row.totals.daysWorked}</td>
                            <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">
                              {row.totals.lateMinutes}
                            </td>
                            <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400">
                              {row.totals.earlyLeaveMinutes}
                            </td>
                            <td className="px-4 py-3 text-right text-blue-600 dark:text-blue-400">{otHours}</td>
                            <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                              {row.totals.absentDays}
                            </td>
                          </tr>
                          {expanded && (
                            <tr key={`${empId}-days`} className="bg-gray-50/70 dark:bg-gray-900/40">
                              <td colSpan={8} className="px-6 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-500 border-b border-gray-200 dark:border-gray-700">
                                      <th className="py-1.5 text-left">วันที่</th>
                                      <th className="py-1.5 text-left">สถานะ</th>
                                      <th className="py-1.5 text-left">เข้า</th>
                                      <th className="py-1.5 text-left">ออก</th>
                                      <th className="py-1.5 text-right">สาย (นาที)</th>
                                      <th className="py-1.5 text-right">กลับก่อน (นาที)</th>
                                      <th className="py-1.5 text-right">OT รออนุมัติ (นาที)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200/60 dark:divide-gray-700/60">
                                    {row.days.map((d: DaySummary) => (
                                      <tr key={d.workDate}>
                                        <td className="py-1.5 font-mono">{d.workDate}</td>
                                        <td className="py-1.5">{dayStatusLabel(d)}</td>
                                        <td className="py-1.5 font-mono">{d.in ? d.in.slice(11, 16) : '-'}</td>
                                        <td className="py-1.5 font-mono">{d.out ? d.out.slice(11, 16) : '-'}</td>
                                        <td className="py-1.5 text-right">{d.lateMinutes}</td>
                                        <td className="py-1.5 text-right">{d.earlyLeaveMinutes}</td>
                                        <td className="py-1.5 text-right">{d.otCandidateMinutes}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {noShiftRows.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
              <div className="font-semibold mb-1">พนักงานที่ยังไม่ได้กำหนดกะงาน ({noShiftRows.length} คน):</div>
              <div className="flex flex-wrap gap-2">
                {noShiftRows.map(emp => (
                  <span
                    key={emp.id}
                    className="px-2.5 py-1 rounded-md bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-xs"
                  >
                    {emp.code} — {emp.first_name} {emp.last_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Import */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <label
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 cursor-pointer hover:border-blue-500 transition"
            >
              <Upload className="w-10 h-10 text-blue-600 dark:text-blue-400 mb-2" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {importing ? 'กำลังนำเข้าไฟล์...' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์ (.dat, .txt, .csv)'}
              </span>
              <span className="text-xs text-gray-500 mt-1">ขนาดไฟล์สูงสุด 5 MB</span>
              <input
                type="file"
                accept=".dat,.txt,.csv"
                onChange={handleFileChange}
                disabled={importing}
                className="hidden"
              />
            </label>

            {importResult && (
              <div className="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-sm space-y-2">
                <div className="font-semibold text-gray-900 dark:text-white">ผลการนำเข้าล่าสุด</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>ทั้งหมด: <strong>{importResult.total}</strong></div>
                  <div className="text-emerald-600">เพิ่มใหม่: <strong>{importResult.inserted}</strong></div>
                  <div className="text-gray-600">ซ้ำ: <strong>{importResult.duplicates}</strong></div>
                  <div className="text-amber-600">ข้าม: <strong>{importResult.skipped.length}</strong></div>
                </div>
                {importResult.unmappedPins.length > 0 && (
                  <div className="text-amber-700 dark:text-amber-400 text-xs">
                    พบรหัสเครื่องที่ยังไม่ได้ผูกพนักงาน:{' '}
                    {importResult.unmappedPins.map(u => `${u.pin} (${u.count})`).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-sm text-gray-900 dark:text-white">
              ประวัติการนำเข้าล่าสุด
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-2.5">วันที่นำเข้า</th>
                  <th className="px-4 py-2.5">ไฟล์</th>
                  <th className="px-4 py-2.5 text-right">ทั้งหมด</th>
                  <th className="px-4 py-2.5 text-right">เพิ่มใหม่</th>
                  <th className="px-4 py-2.5 text-right">ซ้ำ</th>
                  <th className="px-4 py-2.5 text-right">ข้าม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {recentImports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      ยังไม่มีประวัติการนำเข้า
                    </td>
                  </tr>
                ) : (
                  recentImports.map(imp => (
                    <tr key={imp.id}>
                      <td className="px-4 py-2.5 font-mono text-xs">{imp.created_at}</td>
                      <td className="px-4 py-2.5">{imp.filename}</td>
                      <td className="px-4 py-2.5 text-right">{imp.total}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{imp.inserted}</td>
                      <td className="px-4 py-2.5 text-right">{imp.duplicates}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600">{imp.skipped}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Unmapped Pins */}
      {activeTab === 'unmapped' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3">รหัสเครื่อง (PIN)</th>
                <th className="px-4 py-3 text-right">จำนวนสแกน</th>
                <th className="px-4 py-3">ครั้งแรก</th>
                <th className="px-4 py-3">ครั้งล่าสุด</th>
                <th className="px-4 py-3">ผูกกับพนักงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {unmappedPins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    ไม่มีรหัสเครื่องที่ตกค้าง
                  </td>
                </tr>
              ) : (
                unmappedPins.map(item => (
                  <tr key={item.pin}>
                    <td className="px-4 py-3 font-mono font-semibold text-blue-600 dark:text-blue-400">{item.pin}</td>
                    <td className="px-4 py-3 text-right">{item.count}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.first_punch}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.last_punch}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedEmpByPin[item.pin] || ''}
                          onChange={e =>
                            setSelectedEmpByPin(prev => ({ ...prev, [item.pin]: e.target.value }))
                          }
                          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                        >
                          <option value="">-- เลือกพนักงาน --</option>
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.code} — {emp.first_name} {emp.last_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={mappingPin === item.pin}
                          onClick={() => handleAssignPin(item.pin)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
                        >
                          บันทึก
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Shifts */}
      {activeTab === 'shifts' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreateShift}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              เพิ่มกะงาน
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3">ชื่อกะงาน</th>
                  <th className="px-4 py-3">เวลาเข้า</th>
                  <th className="px-4 py-3">เวลาออก</th>
                  <th className="px-4 py-3 text-right">อนุโลมสาย (นาที)</th>
                  <th className="px-4 py-3 text-right">พัก (นาที)</th>
                  <th className="px-4 py-3 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {shifts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      ยังไม่มีกะงาน
                    </td>
                  </tr>
                ) : (
                  shifts.map(sh => (
                    <tr key={sh.id}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{sh.name}</td>
                      <td className="px-4 py-3 font-mono">{sh.start_time}</td>
                      <td className="px-4 py-3 font-mono">{sh.end_time}</td>
                      <td className="px-4 py-3 text-right">{sh.grace_minutes}</td>
                      <td className="px-4 py-3 text-right">{sh.break_minutes}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditShift(sh)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {shiftModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 space-y-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingShift ? 'แก้ไขกะงาน' : 'เพิ่มกะงานใหม่'}
                </h2>
                <form onSubmit={handleSaveShift} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">ชื่อกะงาน *</label>
                    <input
                      type="text"
                      required
                      value={shiftForm.name}
                      onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">เวลาเข้า (HH:mm)</label>
                      <input
                        type="time"
                        required
                        value={shiftForm.start_time}
                        onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">เวลาออก (HH:mm)</label>
                      <input
                        type="time"
                        required
                        value={shiftForm.end_time}
                        onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">อนุโลมสาย (นาที)</label>
                      <input
                        type="number"
                        min="0"
                        value={shiftForm.grace_minutes}
                        onChange={e => setShiftForm(f => ({ ...f, grace_minutes: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">เวลาพัก (นาที)</label>
                      <input
                        type="number"
                        min="0"
                        value={shiftForm.break_minutes}
                        onChange={e => setShiftForm(f => ({ ...f, break_minutes: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShiftModalOpen(false)}
                      className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={savingShift}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                    >
                      บันทึก
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
