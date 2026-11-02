import { useEffect, useState, useCallback, useId } from 'react'
import {
  Clock,
  MapPin,
  Calendar,
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Plus,
  Printer,
  RefreshCw,
  User,
  X,
  Send,
  Ban,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrService, {
  Employee,
  LeaveType,
  LeaveBalance,
  LeaveRequest,
  MyAttendance,
  PayrollRunLine,
  CheckinLocation,
  CheckinResult,
} from '../../services/hr.service'
import PayslipPrint from './PayslipPrint'

// ponytail: client-side formatted date helpers
const getTodayStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const fmt = (n: number | undefined | null) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtTime = (punchedAt?: string | null) => {
  if (!punchedAt) return '-'
  if (punchedAt.includes(' ')) {
    return punchedAt.split(' ')[1].slice(0, 5)
  }
  if (punchedAt.includes('T')) {
    return punchedAt.split('T')[1].slice(0, 5)
  }
  return punchedAt
}

export default function MyHr() {
  const selectLeaveTypeId = useId()
  const startDateInputId = useId()
  const endDateInputId = useId()
  const daysInputId = useId()
  const reasonInputId = useId()

  const [loading, setLoading] = useState(true)
  const [notLinked, setNotLinked] = useState(false)
  const [me, setMe] = useState<Employee | null>(null)

  // Live Thai clock
  // ponytail: local 1-second interval for display; server enforces real punch time
  const [currentTime, setCurrentTime] = useState<Date>(new Date())

  // Check-in state
  const [checkinLocation, setCheckinLocation] = useState<CheckinLocation | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkinSuccess, setCheckinSuccess] = useState<string | null>(null)
  const [checkinError, setCheckinError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)

  // Attendance, Leave, Slips state
  const [attendance, setAttendance] = useState<MyAttendance | null>(null)
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [slips, setSlips] = useState<PayrollRunLine[]>([])

  // Leave modal state
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [submittingLeave, setSubmittingLeave] = useState(false)
  const [leaveSuccessBanner, setLeaveSuccessBanner] = useState<string | null>(null)
  const [leaveForm, setLeaveForm] = useState({
    leave_type_id: '',
    start_date: getTodayStr(),
    end_date: getTodayStr(),
    days: '1',
    reason: '',
  })

  // Payslip print modal
  const [viewingSlip, setViewingSlip] = useState<PayrollRunLine | null>(null)

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Load employee and related data
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const meData = await hrService.getMe()
      setMe(meData)
      setNotLinked(false)

      // Concurrently load checkin location, attendance, leaves, slips
      const [loc, att, types, balances, requests, mySlips] = await Promise.all([
        hrService.getCheckinLocation().catch(() => null),
        hrService.getMyAttendance().catch(() => null),
        hrService.getLeaveTypes({ active: 1 }).catch(() => []),
        hrService.getLeaveBalances({ employee_id: meData.id }).catch(() => []),
        hrService.getLeaveRequests({ employee_id: meData.id }).catch(() => []),
        hrService.getMySlips().catch(() => []),
      ])

      setCheckinLocation(loc)
      setAttendance(att)
      setLeaveTypes(types || [])
      setLeaveBalances(balances || [])
      setLeaveRequests(requests || [])
      setSlips(mySlips || [])
    } catch (err: any) {
      if (err?.response?.status === 404 || err?.status === 404) {
        setNotLinked(true)
      } else {
        toast.error(err?.response?.data?.message || 'โหลดข้อมูลพนักงานไม่สำเร็จ')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Reload only attendance after punch
  const reloadAttendance = async () => {
    try {
      const att = await hrService.getMyAttendance()
      setAttendance(att)
    } catch {
      // non-blocking
    }
  }

  // Reload leaves
  const reloadLeaves = async (empId: string) => {
    try {
      const [balances, requests] = await Promise.all([
        hrService.getLeaveBalances({ employee_id: empId }),
        hrService.getLeaveRequests({ employee_id: empId }),
      ])
      setLeaveBalances(balances || [])
      setLeaveRequests(requests || [])
    } catch {
      // non-blocking
    }
  }

  // Handle Check-in button click
  const handleCheckin = () => {
    setCheckingIn(true)
    setCheckinError(null)
    setCheckinSuccess(null)
    setPermissionDenied(false)

    const sendPunch = async (geo: { lat?: number; lng?: number; accuracy?: number }) => {
      try {
        const res: CheckinResult = await hrService.checkin(geo)
        const timeStr = fmtTime(res.punched_at)
        const kindText = res.kind === 'IN' ? 'เข้างาน' : 'ออกงาน'
        const distText = res.distance_m != null ? ` · ห่างร้าน ${Math.round(res.distance_m)} ม.` : ''
        const bannerText = `${kindText} ${timeStr}${distText}`
        setCheckinSuccess(bannerText)
        toast.success(bannerText)
        reloadAttendance()
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'บันทึกเวลาไม่สำเร็จ'
        setCheckinError(msg)
        toast.error(msg)
      } finally {
        setCheckingIn(false)
      }
    }

    if (checkinLocation) {
      if (!navigator.geolocation) {
        setCheckingIn(false)
        setCheckinError('อุปกรณ์ของคุณไม่รองรับการระบุตำแหน่ง (GPS)')
        return
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          sendPunch({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
        },
        (geoErr) => {
          setCheckingIn(false)
          if (geoErr.code === 1 /* PERMISSION_DENIED */) {
            setPermissionDenied(true)
          } else if (geoErr.code === 3 /* TIMEOUT */) {
            setCheckinError('หมดเวลาค้นหาพิกัด GPS (10 วินาที) กรุณาลองใหม่อีกครั้ง')
          } else {
            setCheckinError('ไม่สามารถระบุตำแหน่ง GPS ได้ กรุณาลองใหม่อีกครั้ง')
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    } else {
      // No check-in location configured -> send without GPS
      sendPunch({})
    }
  }

  // Handle leave submit
  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!me) return
    if (!leaveForm.leave_type_id) {
      toast.error('กรุณาเลือกประเภทการลา')
      return
    }
    const daysNum = Number(leaveForm.days)
    if (!daysNum || daysNum <= 0 || daysNum % 0.5 !== 0) {
      toast.error('จำนวนวันลาต้องเป็นทวีคูณของ 0.5 และมากกว่า 0')
      return
    }

    setSubmittingLeave(true)
    try {
      await hrService.createLeaveRequest({
        employee_id: me.id,
        leave_type_id: leaveForm.leave_type_id,
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        days: daysNum,
        reason: leaveForm.reason.trim() || undefined,
      })
      setShowLeaveModal(false)
      const successMsg = 'ส่งคำขอแล้ว รอหัวหน้าอนุมัติ'
      setLeaveSuccessBanner(successMsg)
      toast.success(successMsg)
      reloadLeaves(me.id)
      setLeaveForm({
        leave_type_id: '',
        start_date: getTodayStr(),
        end_date: getTodayStr(),
        days: '1',
        reason: '',
      })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ส่งคำขอลาไม่สำเร็จ')
    } finally {
      setSubmittingLeave(false)
    }
  }

  // Handle leave cancel
  const handleCancelLeave = async (requestId: string) => {
    if (!confirm('ต้องการยกเลิกคำขอลานี้ใช่หรือไม่?')) return
    try {
      await hrService.cancelLeaveRequest(requestId)
      toast.success('ยกเลิกคำขอเรียบร้อยแล้ว')
      if (me) reloadLeaves(me.id)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกคำขอไม่สำเร็จ')
    }
  }

  // If user is not linked to an employee row (404)
  if (notLinked) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--fg-3)]">
            <AlertCircle className="w-8 h-8" />
          </div>
          <p className="text-[var(--fg)] font-medium text-lg">
            บัญชีนี้ยังไม่ได้ผูกกับพนักงาน ติดต่อฝ่ายบุคคล
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-[var(--fg-3)] flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        กำลังโหลดข้อมูลของฉัน...
      </div>
    )
  }

  const todayStr = getTodayStr()

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      {/* Header Profile */}
      {me && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-phopy-indigo/10 text-phopy-indigo flex items-center justify-center font-bold text-lg shrink-0">
              {me.first_name?.[0] || <User className="w-6 h-6" />}
            </div>
            <div>
              <div className="font-semibold text-base sm:text-lg text-[var(--fg)]">
                {me.first_name} {me.last_name || ''}
              </div>
              <div className="text-xs sm:text-sm text-[var(--fg-3)]">
                รหัส {me.code} {me.position ? `· ${me.position}` : ''} {me.org_unit_name ? `(${me.org_unit_name})` : ''}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={loadAll}
            title="รีเฟรชข้อมูล"
            className="p-2 rounded-xl text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. เช็คอิน Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Clock className="w-4 h-4 text-phopy-indigo" />
            <span>เช็คอิน (บันทึกเวลา)</span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--surface-2)] text-[var(--fg-3)]">
            {checkinLocation ? 'ต้องเปิด GPS' : 'ไม่ต้องใช้ GPS'}
          </span>
        </div>

        {/* Live Thai Clock Display */}
        <div className="text-center py-2 space-y-1">
          <div className="text-3xl sm:text-4xl font-extrabold tracking-tight font-mono text-[var(--fg)]">
            {currentTime.toLocaleTimeString('th-TH', { hour12: false })}
          </div>
          <div className="text-xs sm:text-sm text-[var(--fg-3)]">
            {currentTime.toLocaleDateString('th-TH', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>

        {/* Location Permission Denied Explanation */}
        {permissionDenied && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs sm:text-sm space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>ไม่สามารถเข้าถึงตำแหน่ง (GPS) ได้</span>
            </div>
            <p>
              กรุณาเปิดการเข้าถึงตำแหน่งในการตั้งค่าเบราว์เซอร์หรืออุปกรณ์ของคุณ เพื่อให้สามารถบันทึกเวลาเข้างานได้:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-[var(--fg-2)]">
              <li>บนมือถือ: ตรวจสอบว่าเปิด "บริการหาตำแหน่ง (Location Services)"</li>
              <li>บนเบราว์เซอร์: กดไอคอนรูปแม่กุญแจหน้า URL แล้วเลือก "อนุญาตตำแหน่ง"</li>
            </ul>
          </div>
        )}

        {/* Success Banner */}
        {checkinSuccess && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold text-center flex items-center justify-center gap-2 text-sm sm:text-base animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{checkinSuccess}</span>
          </div>
        )}

        {/* Error Banner */}
        {checkinError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs sm:text-sm font-medium text-center flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{checkinError}</span>
          </div>
        )}

        {/* Big Check-in Button */}
        <button
          type="button"
          onClick={handleCheckin}
          disabled={checkingIn}
          className="w-full min-h-[56px] py-3.5 px-6 rounded-xl font-bold text-lg bg-phopy-indigo text-white shadow-md active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {checkingIn ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>กำลังบันทึกเวลา...</span>
            </>
          ) : (
            <>
              <MapPin className="w-5 h-5" />
              <span>บันทึกเวลา</span>
            </>
          )}
        </button>

        {/* PDPA Note */}
        <p className="text-xs text-center text-[var(--fg-3)]">
          ระบบเก็บตำแหน่งเฉพาะตอนกดบันทึกเวลา
        </p>
      </div>

      {/* 2. เวลาของฉัน Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Calendar className="w-4 h-4 text-phopy-indigo" />
            <span>เวลาของฉัน</span>
          </div>
          <span className="text-xs text-[var(--fg-3)]">14 วันล่าสุด</span>
        </div>

        {attendance?.days && attendance.days.length > 0 ? (
          <div className="space-y-3">
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-2 px-2 font-medium">วันที่</th>
                    <th className="py-2 px-2 font-medium">เข้า</th>
                    <th className="py-2 px-2 font-medium">ออก</th>
                    <th className="py-2 px-2 font-medium">สาย นาที</th>
                    <th className="py-2 px-2 font-medium">OT รออนุมัติ</th>
                    <th className="py-2 px-2 font-medium">ขาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--fg-2)]">
                  {attendance.days.map((day) => (
                    <tr key={day.workDate} className="hover:bg-[var(--surface-2)]/50 transition">
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-[var(--fg)]">
                        {day.workDate}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-mono">
                        {day.in ? fmtTime(day.in) : '-'}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-mono">
                        {day.out ? fmtTime(day.out) : '-'}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-mono">
                        {day.lateMinutes > 0 ? (
                          <span className="text-amber-600 font-semibold">{day.lateMinutes}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-mono">
                        {day.otCandidateMinutes > 0 ? `${day.otCandidateMinutes} น.` : '-'}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {day.absent ? (
                          <span className="text-red-600 font-semibold">ขาด</span>
                        ) : day.missingOut ? (
                          <span className="text-amber-600">ไม่ครบ</span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Line */}
            {attendance.totals && (
              <div className="pt-3 border-t border-[var(--border)] text-xs sm:text-sm font-medium text-[var(--fg-2)] flex flex-wrap gap-x-3 gap-y-1">
                <span>ทำงาน {attendance.totals.daysWorked} วัน</span>
                <span>·</span>
                <span>ขาด {attendance.totals.absentDays} วัน</span>
                <span>·</span>
                <span>สาย {attendance.totals.lateMinutes} นาที</span>
                <span>·</span>
                <span>OT รออนุมัติ {attendance.totals.otCandidateMinutes} นาที</span>
                {attendance.totals.leaveDays !== undefined && (
                  <>
                    <span>·</span>
                    <span>ลา {attendance.totals.leaveDays} วัน</span>
                  </>
                )}
                {attendance.totals.holidayDays !== undefined && (
                  <>
                    <span>·</span>
                    <span>วันหยุด {attendance.totals.holidayDays} วัน</span>
                  </>
                )}
              </div>
            )}
          </div>
        ) : attendance?.logs && attendance.logs.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-[var(--fg-3)]">รายการบันทึกเวลาจริง (ยังไม่มีการกำหนดกะ)</div>
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-2 px-2 font-medium">วัน-เวลา</th>
                    <th className="py-2 px-2 font-medium">ช่องทาง</th>
                    <th className="py-2 px-2 font-medium">ระยะห่าง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--fg-2)]">
                  {attendance.logs.map((log, idx) => (
                    <tr key={`${log.punched_at}-${idx}`} className="hover:bg-[var(--surface-2)]/50 transition">
                      <td className="py-2 px-2 whitespace-nowrap font-mono text-[var(--fg)]">
                        {log.punched_at}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-xs bg-[var(--surface-2)] text-[var(--fg-3)]">
                          {log.source}
                        </span>
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-mono">
                        {log.distance_m != null ? `${Math.round(log.distance_m)} ม.` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs sm:text-sm text-[var(--fg-3)]">
            ยังไม่มีประวัติการบันทึกเวลา
          </div>
        )}
      </div>

      {/* 3. วันลา Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <FileText className="w-4 h-4 text-phopy-indigo" />
            <span>วันลา</span>
          </div>
          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            className="phopy-btn-primary px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 min-h-[36px]"
          >
            <Plus className="w-4 h-4" />
            <span>ขอลา</span>
          </button>
        </div>

        {/* Leave Success Banner */}
        {leaveSuccessBanner && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-semibold text-center flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{leaveSuccessBanner}</span>
          </div>
        )}

        {/* Balances Table */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--fg-3)]">สิทธิ์วันลาคงเหลือ</div>
          {leaveBalances.length > 0 ? (
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-2 px-2 font-medium">ประเภท</th>
                    <th className="py-2 px-2 font-medium text-right">โควตา</th>
                    <th className="py-2 px-2 font-medium text-right">ใช้แล้ว</th>
                    <th className="py-2 px-2 font-medium text-right">รออนุมัติ</th>
                    <th className="py-2 px-2 font-medium text-right">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--fg-2)]">
                  {leaveBalances.map((bal) => (
                    <tr key={bal.leave_type_id} className="hover:bg-[var(--surface-2)]/50 transition">
                      <td className="py-2 px-2 font-medium text-[var(--fg)]">
                        {bal.name}
                        <span className="block text-[10px] text-[var(--fg-3)]">
                          {bal.paid ? 'ได้รับค่าจ้าง' : 'ไม่ได้รับค่าจ้าง'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {bal.quota !== null ? `${bal.quota} วัน` : 'ไม่จำกัด'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{bal.used}</td>
                      <td className="py-2 px-2 text-right font-mono text-amber-600">{bal.pending}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-[var(--fg)]">
                        {bal.remaining !== null ? `${bal.remaining} วัน` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-[var(--fg-3)]">
              ยังไม่มีข้อมูลโควตาวันลา
            </div>
          )}
        </div>

        {/* My Requests List */}
        <div className="space-y-3 pt-3 border-t border-[var(--border)]">
          <div className="text-xs font-medium text-[var(--fg-3)]">ประวัติคำขอลาของฉัน</div>
          {leaveRequests.length > 0 ? (
            <div className="space-y-2.5">
              {leaveRequests.map((req) => {
                const canCancel =
                  req.status === 'PENDING' || (req.status === 'APPROVED' && req.start_date > todayStr)

                let statusBadge = 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                let statusLabel: string = req.status
                if (req.status === 'PENDING') {
                  statusBadge = 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  statusLabel = 'รออนุมัติ'
                } else if (req.status === 'APPROVED') {
                  statusBadge = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  statusLabel = 'อนุมัติแล้ว'
                } else if (req.status === 'REJECTED') {
                  statusBadge = 'bg-red-500/15 text-red-600 dark:text-red-400'
                  statusLabel = 'ไม่อนุมัติ'
                } else if (req.status === 'CANCELLED') {
                  statusBadge = 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                  statusLabel = 'ยกเลิกแล้ว'
                }

                return (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 space-y-2 text-xs sm:text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-[var(--fg)]">
                        {req.leave_type_name || 'การลา'}
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className="text-[var(--fg-2)] flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {req.start_date === req.end_date ? req.start_date : `${req.start_date} ถึง ${req.end_date}`}
                      </span>
                      <span>·</span>
                      <span className="font-semibold">{req.days} วัน</span>
                      {req.reason && (
                        <>
                          <span>·</span>
                          <span className="text-[var(--fg-3)] italic">"{req.reason}"</span>
                        </>
                      )}
                    </div>

                    {canCancel && (
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleCancelLeave(req.id)}
                          className="px-2.5 py-1 rounded-lg text-xs border border-red-300 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition flex items-center gap-1"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>ยกเลิกคำขอ</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-[var(--fg-3)]">
              ยังไม่มีรายการขอลา
            </div>
          )}
        </div>
      </div>

      {/* 4. สลิปเงินเดือน Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Printer className="w-4 h-4 text-phopy-indigo" />
            <span>สลิปเงินเดือน</span>
          </div>
        </div>

        {slips.length > 0 ? (
          <div className="space-y-2.5">
            {slips.map((slip) => (
              <div
                key={slip.id}
                className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 flex items-center justify-between gap-3 text-xs sm:text-sm"
              >
                <div>
                  <div className="font-semibold text-base text-[var(--fg)]">
                    งวด {slip.period || '-'}
                  </div>
                  <div className="text-[var(--fg-3)] text-xs">
                    {slip.pay_date ? `จ่ายเมื่อ ${slip.pay_date}` : 'รอบเงินเดือน'}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] text-[var(--fg-3)]">สุทธิ</div>
                    <div className="font-bold font-mono text-emerald-600 dark:text-emerald-400 text-sm sm:text-base">
                      {fmt(slip.net)} ฿
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewingSlip(slip)}
                    className="phopy-btn-secondary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 min-h-[36px]"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>พิมพ์</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs sm:text-sm text-[var(--fg-3)]">
            ยังไม่มีข้อมูลสลิปเงินเดือน
          </div>
        )}
      </div>

      {/* Leave Request Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-4 flex items-center justify-center">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="font-bold text-base sm:text-lg text-[var(--fg)] flex items-center gap-2">
                <FileText className="w-5 h-5 text-phopy-indigo" />
                <span>ขอลา</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLeaveSubmit} className="space-y-4">
              <div>
                <label htmlFor={selectLeaveTypeId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ประเภทการลา <span className="text-red-500">*</span>
                </label>
                <select
                  id={selectLeaveTypeId}
                  value={leaveForm.leave_type_id}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                >
                  <option value="">-- เลือกประเภทการลา --</option>
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code}) {t.paid ? '· รับค่าจ้าง' : '· ไม่รับค่าจ้าง'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={startDateInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่เริ่มต้น <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={startDateInputId}
                    type="date"
                    value={leaveForm.start_date}
                    onChange={(e) => {
                      const nextStart = e.target.value
                      setLeaveForm((prev) => ({
                        ...prev,
                        start_date: nextStart,
                        // ponytail: if end_date before start_date, advance it
                        end_date: prev.end_date < nextStart ? nextStart : prev.end_date,
                      }))
                    }}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                  />
                </div>
                <div>
                  <label htmlFor={endDateInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                    วันที่สิ้นสุด <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={endDateInputId}
                    type="date"
                    value={leaveForm.end_date}
                    min={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor={daysInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  จำนวนวันลา (ขั้นละ 0.5 วัน) <span className="text-red-500">*</span>
                </label>
                <input
                  id={daysInputId}
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={leaveForm.days}
                  onChange={(e) => setLeaveForm({ ...leaveForm, days: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                />
              </div>

              <div>
                <label htmlFor={reasonInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  เหตุผลการลา
                </label>
                <textarea
                  id={reasonInputId}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  rows={2}
                  placeholder="ระบุเหตุผล (ถ้ามี)"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submittingLeave}
                  className="phopy-btn-primary px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
                >
                  {submittingLeave ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>กำลังส่ง...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>ส่งคำขอลา</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payslip Print Modal using PayslipPrint */}
      {viewingSlip && (
        <PayslipPrint
          slips={[viewingSlip]}
          period={viewingSlip.period}
          payDate={viewingSlip.pay_date}
          onClose={() => setViewingSlip(null)}
        />
      )}
    </div>
  )
}
