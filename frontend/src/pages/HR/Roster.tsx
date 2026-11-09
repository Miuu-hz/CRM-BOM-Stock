import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  RosterWeek,
  RosterShift,
  RosterAssignmentInput,
  ShiftSwap,
  ShiftSwapStatus,
} from '../../services/hr.service'

type TabKey = 'roster' | 'swaps'
type SwapFilterStatus = 'ALL' | 'PEER_PENDING' | 'PENDING' | 'APPROVED' | 'REJECTED_CANCELLED'

// ponytail: plain local Date math for Monday start and YYYY-MM-DD formatting, avoiding toISOString UTC shift
function formatYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYMD(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(ymd: string, n: number): string {
  const d = parseYMD(ymd)
  d.setDate(d.getDate() + n)
  return formatYMD(d)
}

function getMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  date.setDate(date.getDate() + diff)
  return date
}

function formatThaiDateRange(startDateStr: string, endDateStr: string): string {
  const start = parseYMD(startDateStr)
  const end = parseYMD(endDateStr)
  const startText = start.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const endText = end.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${startText} - ${endText}`
}

function formatThaiDate(dateStr: string): string {
  return parseYMD(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

const THAI_DAY_NAMES = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

const fmt = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ponytail: soft color palette cycle by shift index; simple static array without extra color libs
const SHIFT_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800',
  'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
]

const SWAP_STATUS_LABELS: Record<ShiftSwapStatus, string> = {
  PEER_PENDING: 'รอเพื่อนตอบ',
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  DECLINED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก',
}

const SWAP_STATUS_BADGE: Record<ShiftSwapStatus, string> = {
  PEER_PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  PENDING: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
  DECLINED: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
  CANCELLED: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30',
}

const SWAP_FILTER_CHIPS: Array<{ key: SwapFilterStatus; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PEER_PENDING', label: 'รอเพื่อนตอบ' },
  { key: 'PENDING', label: 'รออนุมัติ' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว' },
  { key: 'REJECTED_CANCELLED', label: 'ไม่อนุมัติ/ปฏิเสธ/ยกเลิก' },
]

interface CellEdit {
  employee_id: string
  work_date: string
  shift_id: string | null
  clear?: boolean
  selectValue: string
}

export default function Roster() {
  const [activeTab, setActiveTab] = useState<TabKey>('roster')

  // Week navigation state (default to Monday of current local week)
  const [weekStart, setWeekStart] = useState<string>(() => formatYMD(getMonday(new Date())))
  const [roster, setRoster] = useState<RosterWeek | null>(null)
  const [loadingRoster, setLoadingRoster] = useState<boolean>(true)

  // Track edits only: key = `${employee_id}:${work_date}`
  const [edits, setEdits] = useState<Map<string, CellEdit>>(new Map())
  const [saving, setSaving] = useState<boolean>(false)

  // Week change confirmation modal (when unsaved edits exist)
  const [confirmWeekChangeOpen, setConfirmWeekChangeOpen] = useState<boolean>(false)
  const [pendingWeek, setPendingWeek] = useState<string | null>(null)

  // Copy previous week modal
  const [copyModalOpen, setCopyModalOpen] = useState<boolean>(false)
  const [overwrite, setOverwrite] = useState<boolean>(false)
  const [copying, setCopying] = useState<boolean>(false)

  // Tab 2: Shift swaps
  const [swaps, setSwaps] = useState<ShiftSwap[]>([])
  const [loadingSwaps, setLoadingSwaps] = useState<boolean>(false)
  const [swapFilter, setSwapFilter] = useState<SwapFilterStatus>('ALL')
  const [cancelSwapModalOpen, setCancelSwapModalOpen] = useState<boolean>(false)
  const [swapToCancel, setSwapToCancel] = useState<ShiftSwap | null>(null)
  const [cancellingSwap, setCancellingSwap] = useState<boolean>(false)

  // Load roster
  const loadRoster = useCallback(async () => {
    setLoadingRoster(true)
    try {
      const data = await hrService.getRoster(weekStart)
      setRoster(data)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดตารางกะไม่สำเร็จ')
    } finally {
      setLoadingRoster(false)
    }
  }, [weekStart])

  useEffect(() => {
    if (activeTab === 'roster') {
      loadRoster()
    }
  }, [activeTab, loadRoster])

  // Load swaps
  const loadSwaps = useCallback(async () => {
    setLoadingSwaps(true)
    try {
      const data = await hrService.getShiftSwaps()
      setSwaps(data || [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดคำขอแลกกะไม่สำเร็จ')
    } finally {
      setLoadingSwaps(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'swaps') {
      loadSwaps()
    }
  }, [activeTab, loadSwaps])

  // Week navigation handlers
  const handleNavigateWeek = (targetWeekStart: string) => {
    if (edits.size > 0) {
      setPendingWeek(targetWeekStart)
      setConfirmWeekChangeOpen(true)
    } else {
      setWeekStart(targetWeekStart)
    }
  }

  const handlePrevWeek = () => handleNavigateWeek(addDays(weekStart, -7))
  const handleNextWeek = () => handleNavigateWeek(addDays(weekStart, 7))
  const handleThisWeek = () => handleNavigateWeek(formatYMD(getMonday(new Date())))

  const handleConfirmWeekChange = () => {
    if (pendingWeek) {
      setEdits(new Map())
      setWeekStart(pendingWeek)
      setPendingWeek(null)
    }
    setConfirmWeekChangeOpen(false)
  }

  // Active shifts list for select dropdown
  const activeShifts = useMemo(() => {
    return roster?.shifts.filter((s) => Number(s.is_active) === 1) || []
  }, [roster?.shifts])

  // Cell edit change handler
  const handleCellChange = (employee_id: string, work_date: string, val: string) => {
    setEdits((prev) => {
      const next = new Map(prev)
      const key = `${employee_id}:${work_date}`
      if (val === '__OFF__') {
        next.set(key, { employee_id, work_date, shift_id: null, selectValue: '__OFF__' })
      } else if (val === '__DEFAULT__') {
        next.set(key, { employee_id, work_date, shift_id: null, clear: true, selectValue: '__DEFAULT__' })
      } else {
        next.set(key, { employee_id, work_date, shift_id: val, selectValue: val })
      }
      return next
    })
  }

  // Save edited cells
  const handleSaveAssignments = async () => {
    if (edits.size === 0) return
    setSaving(true)
    try {
      const items: RosterAssignmentInput[] = Array.from(edits.values()).map((e) => {
        const item: RosterAssignmentInput = {
          employee_id: e.employee_id,
          work_date: e.work_date,
          shift_id: e.shift_id,
        }
        if (e.clear) {
          item.clear = true
        }
        return item
      })
      await hrService.saveRosterAssignments(items)
      toast.success('บันทึกตารางกะสำเร็จ')
      setEdits(new Map())
      loadRoster()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกตารางกะไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // Copy previous week handler
  const handleCopyWeek = async () => {
    if (!roster) return
    setCopying(true)
    try {
      const prevMonday = addDays(roster.week_start, -7)
      const res = await hrService.copyRosterWeek(prevMonday, roster.week_start, overwrite)
      toast.success(`คัดลอกแล้ว ${res.copied} ช่อง (ข้าม ${res.skipped})`)
      setCopyModalOpen(false)
      setEdits(new Map())
      loadRoster()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'คัดลอกตารางกะไม่สำเร็จ')
    } finally {
      setCopying(false)
    }
  }

  // Cancel shift swap handler
  const handleConfirmCancelSwap = async () => {
    if (!swapToCancel) return
    setCancellingSwap(true)
    try {
      await hrService.cancelShiftSwap(swapToCancel.id)
      toast.success('ยกเลิกคำขอแลกกะสำเร็จ')
      setCancelSwapModalOpen(false)
      setSwapToCancel(null)
      loadSwaps()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกคำขอแลกกะไม่สำเร็จ')
    } finally {
      setCancellingSwap(false)
    }
  }

  // Filtered shift swaps
  // ponytail: client-side filter for swap request status chips to avoid redundant re-fetches
  const filteredSwaps = useMemo(() => {
    return swaps.filter((s) => {
      if (swapFilter === 'ALL') return true
      if (swapFilter === 'REJECTED_CANCELLED') {
        return s.status === 'REJECTED' || s.status === 'DECLINED' || s.status === 'CANCELLED'
      }
      return s.status === swapFilter
    })
  }, [swaps, swapFilter])

  // Check if a day has any employee marked as holiday
  const isHolidayDate = useCallback(
    (dateStr: string) => {
      if (!roster) return false
      return roster.employees.some((e) => e.cells.some((c) => c.date === dateStr && c.holiday))
    },
    [roster]
  )

  const targetPct = roster?.settings?.laborCostTargetPct ?? 25

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Title & Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]">ตารางกะ</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            จัดตารางกะการทำงานรายวัน คำนวณต้นทุนค่าแรงเทียบยอดขาย และจัดการคำขอแลกกะ
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('roster')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeTab === 'roster'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          ตารางกะ
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('swaps')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            activeTab === 'swaps'
              ? 'bg-blue-600 text-white'
              : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
          }`}
        >
          คำขอแลกกะ
        </button>
      </div>

      {/* TAB 1: ตารางกะ */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Week Navigation & Action Bar */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-[var(--surface)] p-3 rounded-xl border border-[var(--border)] shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                <ChevronLeft className="w-4 h-4" />
                ‹ สัปดาห์ก่อน
              </button>
              <span className="text-sm font-semibold text-[var(--fg)] min-w-[200px] text-center px-2">
                {formatThaiDateRange(weekStart, addDays(weekStart, 6))}
              </span>
              <button
                type="button"
                onClick={handleNextWeek}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                สัปดาห์ถัดไป ›
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleThisWeek}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg-2)] transition ml-1"
              >
                สัปดาห์นี้
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setOverwrite(false)
                  setCopyModalOpen(true)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                <Copy className="w-4 h-4 text-blue-600" />
                คัดลอกสัปดาห์ก่อน
              </button>

              <button
                type="button"
                onClick={handleSaveAssignments}
                disabled={edits.size === 0 || saving}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  edits.size > 0
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                }`}
              >
                <Check className="w-4 h-4" />
                บันทึก ({edits.size})
              </button>

              {edits.size > 0 && (
                <button
                  type="button"
                  onClick={() => setEdits(new Map())}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] text-sm font-medium hover:bg-[var(--surface-2)] transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  ยกเลิกการแก้ไข
                </button>
              )}
            </div>
          </div>

          {/* Grid Table */}
          {loadingRoster ? (
            <div className="text-center py-16 text-[var(--fg-muted)] bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              กำลังโหลดตารางกะ...
            </div>
          ) : !roster || roster.employees.length === 0 ? (
            <div className="text-center py-16 text-[var(--fg-muted)] bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              ไม่พบข้อมูลพนักงาน
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-[var(--fg-2)] text-xs font-semibold border-b border-[var(--border)]">
                      <th className="p-3 w-56 sticky left-0 bg-[var(--surface-2)] z-10">
                        พนักงาน
                      </th>
                      {roster.dates.map((dStr, idx) => {
                        const dayNum = parseYMD(dStr).getDate()
                        const dayName = THAI_DAY_NAMES[idx]
                        const isHol = isHolidayDate(dStr)
                        return (
                          <th key={dStr} className="p-2 min-w-[130px] text-center border-l border-[var(--border)]">
                            <div className="font-semibold text-sm text-[var(--fg)]">
                              {dayName} {dayNum}
                            </div>
                            {isHol && (
                              <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium">
                                วันหยุด
                              </span>
                            )}
                          </th>
                        )
                      })}
                      <th className="p-3 w-24 text-right border-l border-[var(--border)]">ชม. รวม</th>
                      <th className="p-3 w-28 text-right border-l border-[var(--border)]">ค่าแรงรวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.employees.map((emp) => {
                      return (
                        <tr
                          key={emp.id}
                          className="border-b border-[var(--border)] hover:bg-[var(--surface-2)]/40 transition-colors"
                        >
                          {/* Employee Info */}
                          <td className="p-3 sticky left-0 bg-[var(--surface)] z-10 border-r border-[var(--border)]">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-[var(--fg)]">{emp.name}</span>
                              {emp.warnings && emp.warnings.length > 0 && (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium"
                                  title={emp.warnings.join(', ')}
                                >
                                  ⚠ {emp.warnings.length}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--fg-muted)] mt-0.5">
                              {emp.code}
                              {emp.org_unit_name ? ` · ${emp.org_unit_name}` : ''}
                            </div>
                          </td>

                          {/* 7 Days Cells */}
                          {roster.dates.map((dateStr, dayIdx) => {
                            const cell = emp.cells[dayIdx]
                            const edit = edits.get(`${emp.id}:${dateStr}`)

                            // Determine effective values
                            let currentVal = '__OFF__'
                            if (edit) {
                              currentVal = edit.selectValue
                            } else if (cell?.source === 'ASSIGNED') {
                              currentVal = cell.shift_id ?? '__OFF__'
                            } else if (cell?.source === 'DEFAULT') {
                              currentVal = cell.shift_id ?? '__OFF__'
                            }

                            const isDefault = edit ? Boolean(edit.clear) : cell?.source === 'DEFAULT'
                            const onLeave = Boolean(cell?.on_leave)

                            // Resolve shift for coloring
                            let effectiveShiftId: string | null = null
                            if (edit) {
                              effectiveShiftId = edit.clear ? emp.default_shift_id : edit.shift_id
                            } else {
                              effectiveShiftId = cell?.shift_id ?? null
                            }

                            let colorClass =
                              'bg-gray-100/70 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700'
                            if (effectiveShiftId) {
                              const shiftIdx = roster.shifts.findIndex((s) => s.id === effectiveShiftId)
                              if (shiftIdx >= 0) {
                                colorClass = SHIFT_COLORS[shiftIdx % SHIFT_COLORS.length]
                              }
                            }

                            // If cell has inactive shift assigned previously
                            const inactiveCurrentShift =
                              effectiveShiftId &&
                              roster.shifts.find((s) => s.id === effectiveShiftId && Number(s.is_active) === 0)

                            return (
                              <td key={dateStr} className="p-1.5 border-l border-[var(--border)] text-center">
                                {onLeave ? (
                                  <select
                                    aria-label={`กะ ${emp.name} วันที่ ${dateStr}`}
                                    disabled
                                    value="__LEAVE__"
                                    className="w-full text-xs font-medium py-1.5 px-2 rounded-lg border bg-rose-50/60 text-rose-500 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 cursor-not-allowed"
                                  >
                                    <option value="__LEAVE__">ลา</option>
                                  </select>
                                ) : (
                                  <select
                                    aria-label={`กะ ${emp.name} วันที่ ${dateStr}`}
                                    value={currentVal}
                                    onChange={(e) => handleCellChange(emp.id, dateStr, e.target.value)}
                                    className={`w-full text-xs font-medium py-1.5 px-2 rounded-lg border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${colorClass} ${
                                      isDefault ? 'opacity-70 border-dashed' : ''
                                    } ${edit ? 'ring-2 ring-blue-500/40' : ''}`}
                                  >
                                    <option value="__OFF__">หยุด</option>
                                    <option value="__DEFAULT__">ใช้กะประจำ</option>
                                    {activeShifts.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name} {s.start_time}–{s.end_time}
                                      </option>
                                    ))}
                                    {inactiveCurrentShift && (
                                      <option value={inactiveCurrentShift.id}>
                                        {inactiveCurrentShift.name} (ปิดใช้งาน)
                                      </option>
                                    )}
                                  </select>
                                )}
                              </td>
                            )
                          })}

                          {/* Total Hours */}
                          <td className="p-3 text-right font-medium text-[var(--fg)] border-l border-[var(--border)]">
                            {emp.hours} ชม.
                          </td>

                          {/* Labor Cost */}
                          <td className="p-3 text-right font-medium text-[var(--fg)] border-l border-[var(--border)]">
                            {fmt(emp.labor_cost)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>

                  {/* Summary Rows */}
                  <tfoot>
                    {/* Row 1: Staff count */}
                    <tr className="bg-[var(--surface-2)]/60 text-xs border-t-2 border-[var(--border)] font-medium">
                      <td className="p-2.5 sticky left-0 bg-[var(--surface-2)] font-semibold text-[var(--fg)] border-r border-[var(--border)]">
                        คนเข้ากะ
                      </td>
                      {roster.days.map((day) => (
                        <td key={day.date} className="p-2 text-center border-l border-[var(--border)]">
                          {day.staff} คน
                        </td>
                      ))}
                      <td className="p-2 border-l border-[var(--border)]"></td>
                      <td className="p-2 border-l border-[var(--border)]"></td>
                    </tr>

                    {/* Row 2: Labor Cost */}
                    <tr className="bg-[var(--surface-2)]/60 text-xs border-t border-[var(--border)] font-medium">
                      <td className="p-2.5 sticky left-0 bg-[var(--surface-2)] font-semibold text-[var(--fg)] border-r border-[var(--border)]">
                        ค่าแรง
                      </td>
                      {roster.days.map((day) => (
                        <td key={day.date} className="p-2 text-center border-l border-[var(--border)]">
                          {fmt(day.labor_cost)}
                        </td>
                      ))}
                      <td className="p-2 border-l border-[var(--border)]"></td>
                      <td className="p-2 text-right font-semibold text-[var(--fg)] border-l border-[var(--border)]">
                        {fmt(roster.days.reduce((sum, d) => sum + (d.labor_cost || 0), 0))}
                      </td>
                    </tr>

                    {/* Row 3: Avg POS sales (4 weeks) */}
                    <tr className="bg-[var(--surface-2)]/60 text-xs border-t border-[var(--border)] font-medium">
                      <td className="p-2.5 sticky left-0 bg-[var(--surface-2)] font-semibold text-[var(--fg)] border-r border-[var(--border)]">
                        ยอดขายเฉลี่ย POS 4 สัปดาห์
                      </td>
                      {roster.days.map((day) => (
                        <td key={day.date} className="p-2 text-center border-l border-[var(--border)] text-[var(--fg-muted)]">
                          {day.avg_sales !== null && day.avg_sales !== undefined ? fmt(day.avg_sales) : '—'}
                        </td>
                      ))}
                      <td className="p-2 border-l border-[var(--border)]"></td>
                      <td className="p-2 border-l border-[var(--border)]"></td>
                    </tr>

                    {/* Row 4: Labor % Pill */}
                    <tr className="bg-[var(--surface-2)]/60 text-xs border-t border-[var(--border)] font-medium">
                      <td className="p-2.5 sticky left-0 bg-[var(--surface-2)] font-semibold text-[var(--fg)] border-r border-[var(--border)]">
                        ค่าแรง / ยอดขาย
                      </td>
                      {roster.days.map((day) => {
                        if (day.labor_pct === null || day.labor_pct === undefined) {
                          return (
                            <td key={day.date} className="p-2 text-center border-l border-[var(--border)] text-[var(--fg-muted)]">
                              —
                            </td>
                          )
                        }

                        let pillClass =
                          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                        if (day.labor_pct > targetPct + 5) {
                          pillClass = 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                        } else if (day.labor_pct > targetPct) {
                          pillClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                        }

                        return (
                          <td key={day.date} className="p-2 text-center border-l border-[var(--border)]">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${pillClass}`}>
                              {day.labor_pct}%
                            </span>
                          </td>
                        )
                      })}
                      <td className="p-2 border-l border-[var(--border)]"></td>
                      <td className="p-2 border-l border-[var(--border)]"></td>
                    </tr>

                    {/* Row 5: Day Warnings */}
                    <tr className="bg-[var(--surface-2)]/60 text-xs border-t border-[var(--border)]">
                      <td className="p-2.5 sticky left-0 bg-[var(--surface-2)] font-semibold text-[var(--fg)] border-r border-[var(--border)]">
                        คำเตือนรายวัน
                      </td>
                      {roster.days.map((day) => (
                        <td key={day.date} className="p-2 text-center border-l border-[var(--border)] align-top">
                          {day.warnings && day.warnings.length > 0 ? (
                            <div className="space-y-0.5">
                              {day.warnings.map((w, wIdx) => (
                                <div key={wIdx} className="text-xs text-rose-600 dark:text-rose-400 font-medium leading-tight">
                                  {w}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[var(--fg-muted)]">—</span>
                          )}
                        </td>
                      ))}
                      <td className="p-2 border-l border-[var(--border)]"></td>
                      <td className="p-2 border-l border-[var(--border)]"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Legal Warnings Section */}
          {roster && roster.employees.some((e) => e.warnings && e.warnings.length > 0) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                คำเตือนตามกฎหมายแรงงาน
              </h3>
              <ul className="space-y-1 text-sm">
                {roster.employees
                  .filter((e) => e.warnings && e.warnings.length > 0)
                  .map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-[var(--fg)]">{e.name}:</span>
                      <span className="text-amber-700 dark:text-amber-400">
                        {e.warnings.join(' · ')}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* Note Line */}
          <p className="text-xs text-[var(--fg-muted)] pt-1">
            ค่าแรงต่อวัน: รายเดือน ÷ 30 · รายวันเต็มวัน · รายชั่วโมง × ชั่วโมงกะ · ตั้งคนขั้นต่ำ/เป้า % ได้ที่หน้าตั้งค่าเงินเดือน
          </p>
        </div>
      )}

      {/* TAB 2: คำขอแลกกะ */}
      {activeTab === 'swaps' && (
        <div className="space-y-4">
          {/* Status Filter Chips */}
          <div className="flex flex-wrap gap-2">
            {SWAP_FILTER_CHIPS.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setSwapFilter(chip.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  swapFilter === chip.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Swaps Table */}
          {loadingSwaps ? (
            <div className="text-center py-16 text-[var(--fg-muted)] bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              กำลังโหลดคำขอแลกกะ...
            </div>
          ) : filteredSwaps.length === 0 ? (
            <div className="text-center py-16 text-[var(--fg-muted)] bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              ไม่พบคำขอแลกกะ
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-[var(--fg-2)] text-xs font-semibold border-b border-[var(--border)]">
                      <th className="p-3 w-32">วันที่</th>
                      <th className="p-3">ผู้ขอ + กะ</th>
                      <th className="p-3">แลกกับ + กะ</th>
                      <th className="p-3">เหตุผล</th>
                      <th className="p-3 w-32">สถานะ</th>
                      <th className="p-3 w-28 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSwaps.map((swap) => {
                      const canCancel = swap.status === 'PEER_PENDING' || swap.status === 'PENDING'
                      return (
                        <tr
                          key={swap.id}
                          className="border-b border-[var(--border)] hover:bg-[var(--surface-2)]/40 transition-colors"
                        >
                          <td className="p-3 font-medium text-[var(--fg)]">
                            {formatThaiDate(swap.work_date)}
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-[var(--fg)]">{swap.requester_name}</div>
                            <div className="text-xs text-[var(--fg-muted)]">
                              {swap.requester_shift
                                ? `${swap.requester_shift.name} (${swap.requester_shift.start_time}–${swap.requester_shift.end_time})`
                                : 'ไม่มีกะ / หยุด'}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-[var(--fg)]">{swap.target_name}</div>
                            <div className="text-xs text-[var(--fg-muted)]">
                              {swap.target_shift
                                ? `${swap.target_shift.name} (${swap.target_shift.start_time}–${swap.target_shift.end_time})`
                                : 'ไม่มีกะ / หยุด'}
                            </div>
                          </td>
                          <td className="p-3 text-[var(--fg-2)]">
                            {swap.reason || '—'}
                          </td>
                          <td className="p-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                SWAP_STATUS_BADGE[swap.status] || ''
                              }`}
                            >
                              {SWAP_STATUS_LABELS[swap.status] || swap.status}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSwapToCancel(swap)
                                  setCancelSwapModalOpen(true)
                                }}
                                className="px-2.5 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-medium transition dark:border-rose-900 dark:hover:bg-rose-950/30"
                              >
                                ยกเลิก
                              </button>
                            ) : (
                              <span className="text-[var(--fg-muted)] text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: Confirm week change with unsaved edits */}
      {confirmWeekChangeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-[var(--fg)]">ละทิ้งการแก้ไข?</h3>
            </div>
            <p className="text-sm text-[var(--fg-2)]">
              คุณมีการแก้ไขตารางกะที่ยังไม่ได้บันทึก {edits.size} รายการ หากเปลี่ยนสัปดาห์ข้อมูลที่แก้ไขจะไม่ถูกบันทึก ต้องการดำเนินการต่อหรือไม่?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmWeekChangeOpen(false)
                  setPendingWeek(null)
                }}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmWeekChange}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition"
              >
                เปลี่ยนสัปดาห์
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Copy previous week modal */}
      {copyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--fg)] flex items-center gap-2">
                <Copy className="w-5 h-5 text-blue-600" />
                คัดลอกสัปดาห์ก่อน
              </h3>
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                className="text-[var(--fg-muted)] hover:text-[var(--fg)] p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-[var(--fg-2)]">
              คัดลอกตารางกะจากสัปดาห์ก่อนหน้า ({formatThaiDate(addDays(weekStart, -7))}) มายังสัปดาห์นี้ ({formatThaiDate(weekStart)})
            </p>

            <label className="flex items-center gap-2 cursor-pointer pt-2">
              <input
                type="checkbox"
                id="overwrite-checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="rounded border-[var(--border)] text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="text-sm font-medium text-[var(--fg)]">ทับช่องที่จัดไว้แล้ว</span>
            </label>

            <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                disabled={copying}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleCopyWeek}
                disabled={copying}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {copying ? 'กำลังคัดลอก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Cancel shift swap modal */}
      {cancelSwapModalOpen && swapToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-[var(--fg)]">ยืนยันการยกเลิกคำขอแลกกะ</h3>
            </div>
            <p className="text-sm text-[var(--fg-2)]">
              คุณต้องการยกเลิกคำขอแลกกะของ <span className="font-semibold text-[var(--fg)]">{swapToCancel.requester_name}</span> กับ{' '}
              <span className="font-semibold text-[var(--fg)]">{swapToCancel.target_name}</span> วันที่ {formatThaiDate(swapToCancel.work_date)} หรือไม่?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCancelSwapModalOpen(false)
                  setSwapToCancel(null)
                }}
                disabled={cancellingSwap}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] text-[var(--fg)] transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelSwap}
                disabled={cancellingSwap}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {cancellingSwap ? 'กำลังยกเลิก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
