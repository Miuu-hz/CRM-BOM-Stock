import { useState, useEffect, useRef } from 'react'
import { Clock, Delete, RotateCcw } from 'lucide-react'
import hrService, { CheckinGeo, CheckinPinInput } from '../../services/hr.service'

export default function CheckinKiosk() {
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [employeeCode, setEmployeeCode] = useState('')
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [geo, setGeo] = useState<CheckinGeo>({})

  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Geolocation: get once on mount and reuse; send without it if unavailable
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeo({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
        },
        () => {
          // ponytail: geolocation denied or unavailable; proceed without coords
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }, [])

  // Cleanup banner timer
  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
    }
  }, [])

  const handleKeypadPress = (digit: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit)
    }
  }

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1))
  }

  const handleClear = () => {
    setPin('')
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmedCode = employeeCode.trim()
    if (!trimmedCode || pin.length < 4 || submitting) return

    setSubmitting(true)
    try {
      const payload: CheckinPinInput = {
        employee_code: trimmedCode,
        pin,
        ...(geo.lat !== undefined ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : {}),
      }

      const result = await hrService.checkinWithPin(payload)

      // Time string formatted as HH:mm
      let timeStr = ''
      if (result.punched_at && result.punched_at.length >= 16) {
        timeStr = result.punched_at.slice(11, 16)
      } else {
        timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
      }
      const actionText = result.kind === 'IN' ? 'เข้างาน' : 'ออกงาน'
      const bannerMsg = `${result.employee_name} · ${actionText} ${timeStr}`

      setBanner({ type: 'success', message: bannerMsg })

      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
      bannerTimerRef.current = setTimeout(() => {
        setBanner(null)
        setEmployeeCode('')
        setPin('')
      }, 5000)
    } catch (err: any) {
      // 429 or other server message
      const errMsg = err?.response?.data?.message || err?.message || 'บันทึกเวลาไม่สำเร็จ'
      setBanner({ type: 'error', message: errMsg })

      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
      bannerTimerRef.current = setTimeout(() => {
        setBanner(null)
        setEmployeeCode('')
        setPin('')
      }, 5000)
    } finally {
      setSubmitting(false)
    }
  }

  const timeString = currentTime.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const dateString = currentTime.toLocaleDateString('th-TH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center p-4 sm:p-6 bg-[var(--bg)] text-[var(--fg-1)]">
      <div className="w-full max-w-md phopy-card p-6 sm:p-8 space-y-6 shadow-xl">
        {/* Big Thai Clock + Date */}
        <div className="text-center space-y-1">
          <div className="text-4xl sm:text-5xl font-mono font-bold tracking-wider text-[var(--fg-1)]">
            {timeString}
          </div>
          <div className="text-sm sm:text-base text-[var(--fg-3)] font-medium">
            {dateString}
          </div>
        </div>

        {/* Result banner (green / red) */}
        {banner && (
          <div
            role="alert"
            data-testid="kiosk-banner"
            className={`p-4 rounded-xl text-center font-bold text-base transition-all ${
              banner.type === 'success'
                ? 'bg-[var(--success-soft)] text-[var(--success-strong)] border border-[var(--success)]/30'
                : 'bg-[var(--danger-soft)] text-[var(--danger-strong)] border border-[var(--danger)]/30'
            }`}
          >
            {banner.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Employee Code Input */}
          <div className="space-y-1.5">
            <label htmlFor="employee-code" className="block text-xs font-semibold text-[var(--fg-2)]">
              รหัสพนักงาน
            </label>
            <input
              id="employee-code"
              data-testid="employee-code-input"
              type="text"
              autoComplete="off"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="เช่น EMP-001"
              className="w-full px-4 py-3 text-base text-center font-mono font-semibold rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          {/* Masked PIN Display & hidden input */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--fg-2)] text-center">
              PIN เช็คอิน (4–6 หลัก)
            </label>
            <div
              className="flex items-center justify-center gap-3 py-2 cursor-pointer"
              data-testid="pin-dots"
            >
              {[0, 1, 2, 3, 4, 5].map((index) => {
                const isFilled = index < pin.length
                return (
                  <span
                    key={index}
                    className={`w-3.5 h-3.5 rounded-full transition-all ${
                      isFilled
                        ? 'bg-[var(--primary)] scale-110 shadow-sm'
                        : 'border-2 border-[var(--border-strong)] bg-transparent'
                    }`}
                  />
                )
              })}
            </div>
            {/* Input allows direct typing (keyboard/barcode/test) */}
            <input
              type="password"
              data-testid="pin-input"
              aria-label="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="sr-only"
            />
          </div>

          {/* Numeric Keypad for PIN */}
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeypadPress(digit)}
                className="py-3 text-xl font-bold font-mono rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-sunken)] active:scale-95 text-[var(--fg-1)] border border-[var(--border)] transition shadow-sm"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="py-3 text-sm font-semibold rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-sunken)] active:scale-95 text-[var(--fg-3)] border border-[var(--border)] transition flex items-center justify-center gap-1"
            >
              <RotateCcw className="w-4 h-4" />
              ล้าง
            </button>
            <button
              type="button"
              onClick={() => handleKeypadPress('0')}
              className="py-3 text-xl font-bold font-mono rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-sunken)] active:scale-95 text-[var(--fg-1)] border border-[var(--border)] transition shadow-sm"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="ลบ"
              className="py-3 text-sm font-semibold rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-sunken)] active:scale-95 text-[var(--fg-3)] border border-[var(--border)] transition flex items-center justify-center gap-1"
            >
              <Delete className="w-4 h-4" />
              ลบ
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            data-testid="submit-checkin-btn"
            disabled={submitting || !employeeCode.trim() || pin.length < 4}
            className="w-full phopy-btn-primary py-3.5 text-base font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition shadow-md mt-2"
          >
            <Clock className="w-5 h-5" />
            {submitting ? 'กำลังบันทึก...' : 'บันทึกเวลา'}
          </button>
        </form>
      </div>
    </div>
  )
}
