import { useState, useEffect, useCallback, useRef, useId } from 'react'
import {
  Car,
  MapPin,
  Navigation,
  Flag,
  History,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  ExternalLink,
  Clock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrTripService, {
  CarType,
  CarTripBase,
  MyTripsStatus,
  TRIP_PDPA_NOTICE_TEXT,
  TRIP_STATUS_LABELS,
  ROUTE_STATUS_LABELS,
} from '../../services/hrTrip.service'

type TabKey = 'record' | 'history'
type GpsAction = 'start' | 'stop' | 'end'

interface GpsReading {
  lat: number
  lng: number
  accuracy_m: number | null
}

interface GpsErrorInfo {
  permissionDenied: boolean
  message: string
  retryAction: GpsAction | null
}

const fmtDateTime = (iso?: string | null): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const fmtDuration = (sec?: number | null): string => {
  if (sec == null || !Number.isFinite(sec)) return '-'
  const totalMin = Math.max(0, Math.round(sec / 60))
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours > 0) return `${hours} ชม. ${mins} น.`
  return `${mins} น.`
}

const validateOdometerInput = (raw: string): { ok: true; value: number } | { ok: false; message: string } => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, message: 'เลขไมล์ต้องเป็นตัวเลขตั้งแต่ 0 ถึง 9,999,999' }
  }
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num < 0 || num > 9_999_999) {
    return { ok: false, message: 'เลขไมล์ต้องเป็นตัวเลขตั้งแต่ 0 ถึง 9,999,999' }
  }
  return { ok: true, value: num }
}

const readHighAccuracyGps = (): Promise<GpsReading> =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject({ permissionDenied: false, message: 'อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ GPS' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: typeof acc === 'number' && Number.isFinite(acc) ? acc : null,
        })
      },
      (err) => {
        if (err?.code === 1) {
          reject({
            permissionDenied: true,
            message: 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS)',
          })
          return
        }
        if (err?.code === 3) {
          reject({
            permissionDenied: false,
            message: 'จับพิกัด GPS ไม่ทันเวลา กรุณาอยู่ในที่โล่งแล้วลองใหม่อีกครั้ง',
          })
          return
        }
        reject({
          permissionDenied: false,
          message: 'ไม่สามารถอ่านพิกัด GPS ได้ กรุณาเปิดบริการตำแหน่งแล้วลองใหม่',
        })
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  })

const STATUS_BADGE: Record<CarTripBase['status'], string> = {
  OPEN: 'bg-[var(--info-soft)] text-[var(--primary)]',
  COMPLETED: 'bg-[var(--success-soft)] text-[var(--success-strong)]',
  INCOMPLETE: 'bg-[var(--warning-soft)] text-[var(--warning-strong)]',
}

export default function MyTrips() {
  const vehicleSelectId = useId()
  const plateInputId = useId()
  const startOdoId = useId()
  const purposeId = useId()
  const stopNoteId = useId()
  const endOdoId = useId()
  const fromDateId = useId()
  const toDateId = useId()

  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const initialTab: TabKey = searchParams.get('tab') === 'history' ? 'history' : 'record'
  const shouldFocusStop = searchParams.get('action') === 'stop'

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [loading, setLoading] = useState(true)
  const [notLinked, setNotLinked] = useState(false)
  const [status, setStatus] = useState<MyTripsStatus | null>(null)

  // Consent state
  const [consentChecked, setConsentChecked] = useState(false)
  const [acceptingConsent, setAcceptingConsent] = useState(false)

  // Start trip form state
  const [carType, setCarType] = useState<CarType>('COMPANY')
  const [vehicleId, setVehicleId] = useState('')
  const [plateNo, setPlateNo] = useState('')
  const [startOdometer, setStartOdometer] = useState('')
  const [purpose, setPurpose] = useState('')

  // Open trip / stop / end state
  const [justStarted, setJustStarted] = useState(false)
  const [stopNote, setStopNote] = useState('')
  const [endOdometer, setEndOdometer] = useState('')
  const [lastCompletedTrip, setLastCompletedTrip] = useState<CarTripBase | null>(null)
  const stopNoteRef = useRef<HTMLInputElement | null>(null)

  // Submission & GPS state
  const [submittingAction, setSubmittingAction] = useState<GpsAction | null>(null)
  const [lastGpsAccuracy, setLastGpsAccuracy] = useState<number | null>(null)
  const [gpsError, setGpsError] = useState<GpsErrorInfo | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // History state
  const [trips, setTrips] = useState<CarTripBase[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const data = await hrTripService.getMyStatus()
      setStatus(data)
      setNotLinked(false)
      if (data.vehicles.length > 0) {
        setVehicleId((prev) => (prev && data.vehicles.some((v) => v.id === prev) ? prev : data.vehicles[0].id))
      } else {
        setCarType((prev) => (prev === 'COMPANY' ? 'PRIVATE' : prev))
      }
    } catch (err: any) {
      if (err?.response?.status === 404 || err?.status === 404) {
        setNotLinked(true)
      } else {
        toast.error(err?.response?.data?.message || 'โหลดข้อมูลการใช้งานรถยนต์ไม่สำเร็จ')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const list = await hrTripService.getMyTrips({
        from: historyFrom || undefined,
        to: historyTo || undefined,
      })
      setTrips(Array.isArray(list) ? list : [])
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        toast.error(err?.response?.data?.message || 'โหลดประวัติการเดินทางไม่สำเร็จ')
      }
      setTrips([])
    } finally {
      setLoadingHistory(false)
    }
  }, [historyFrom, historyTo])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (activeTab === 'history' && !notLinked) {
      loadHistory()
    }
  }, [activeTab, notLinked, loadHistory])

  useEffect(() => {
    if (shouldFocusStop && status?.open_trip && activeTab === 'record') {
      stopNoteRef.current?.focus()
    }
  }, [shouldFocusStop, status?.open_trip, activeTab])

  const handleAcceptConsent = async () => {
    if (!consentChecked || !status) return
    setAcceptingConsent(true)
    setFormError(null)
    try {
      const consent = await hrTripService.acceptConsent(status.consent.version || '1.0')
      setStatus((prev) => (prev ? { ...prev, consent } : prev))
      toast.success('บันทึกความยินยอมเรียบร้อยแล้ว')
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'บันทึกความยินยอมไม่สำเร็จ'
      setFormError(msg)
      toast.error(msg)
    } finally {
      setAcceptingConsent(false)
    }
  }

  const handleApiError = async (err: any, fallback: string) => {
    const code = err?.response?.data?.code
    const msg = err?.response?.data?.message || err?.message || fallback
    setFormError(msg)
    toast.error(msg)
    if (code === 'CONSENT_REQUIRED' || err?.response?.status === 409) {
      await loadStatus()
    }
  }

  const executeStartTrip = async () => {
    setFormError(null)
    setGpsError(null)

    if (carType === 'COMPANY' && !vehicleId) {
      setFormError('กรุณาเลือกรถบริษัท')
      return
    }
    if (carType === 'PRIVATE' && !plateNo.trim()) {
      setFormError('กรุณาระบุทะเบียนรถ')
      return
    }
    const odoCheck = validateOdometerInput(startOdometer)
    if (!odoCheck.ok) {
      setFormError(odoCheck.message)
      return
    }

    setSubmittingAction('start')
    let gps: GpsReading
    try {
      gps = await readHighAccuracyGps()
      setLastGpsAccuracy(gps.accuracy_m)
    } catch (gErr: any) {
      setGpsError({
        permissionDenied: Boolean(gErr?.permissionDenied),
        message: gErr?.message || 'ไม่สามารถอ่านพิกัด GPS ได้',
        retryAction: 'start',
      })
      setSubmittingAction(null)
      return
    }

    try {
      const created = await hrTripService.startTrip({
        car_type: carType,
        vehicle_id: carType === 'COMPANY' ? vehicleId : null,
        plate_no: carType === 'PRIVATE' ? plateNo.trim() : undefined,
        start_odometer: odoCheck.value,
        purpose: purpose.trim() || undefined,
        lat: gps.lat,
        lng: gps.lng,
        accuracy_m: gps.accuracy_m,
      })
      setStatus((prev) => (prev ? { ...prev, open_trip: created } : prev))
      setJustStarted(true)
      setLastCompletedTrip(null)
      setStartOdometer('')
      setPurpose('')
      setPlateNo('')
      toast.success('บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ')
    } catch (err: any) {
      await handleApiError(err, 'เริ่มทริปไม่สำเร็จ')
    } finally {
      setSubmittingAction(null)
    }
  }

  const executeAddStop = async () => {
    const openTrip = status?.open_trip
    if (!openTrip) return
    setFormError(null)
    setGpsError(null)

    const maxStops = status?.max_stops ?? 10
    if (openTrip.stops.length >= maxStops) {
      setFormError(`แวะจุดได้สูงสุด ${maxStops} จุดต่อทริป`)
      return
    }

    setSubmittingAction('stop')
    let gps: GpsReading
    try {
      gps = await readHighAccuracyGps()
      setLastGpsAccuracy(gps.accuracy_m)
    } catch (gErr: any) {
      setGpsError({
        permissionDenied: Boolean(gErr?.permissionDenied),
        message: gErr?.message || 'ไม่สามารถอ่านพิกัด GPS ได้',
        retryAction: 'stop',
      })
      setSubmittingAction(null)
      return
    }

    try {
      const updated = await hrTripService.addStop(openTrip.id, {
        lat: gps.lat,
        lng: gps.lng,
        accuracy_m: gps.accuracy_m,
        note: stopNote.trim() || undefined,
      })
      setStatus((prev) => (prev ? { ...prev, open_trip: updated } : prev))
      setStopNote('')
      toast.success(`บันทึกจุดแวะที่ ${updated.stops.length} แล้ว`)
    } catch (err: any) {
      await handleApiError(err, 'บันทึกจุดแวะไม่สำเร็จ')
    } finally {
      setSubmittingAction(null)
    }
  }

  const executeEndTrip = async () => {
    const openTrip = status?.open_trip
    if (!openTrip) return
    setFormError(null)
    setGpsError(null)

    const odoCheck = validateOdometerInput(endOdometer)
    if (!odoCheck.ok) {
      setFormError(odoCheck.message)
      return
    }
    if (odoCheck.value < openTrip.start_odometer) {
      setFormError('เลขไมล์สิ้นสุดต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น')
      return
    }

    setSubmittingAction('end')
    let gps: GpsReading
    try {
      gps = await readHighAccuracyGps()
      setLastGpsAccuracy(gps.accuracy_m)
    } catch (gErr: any) {
      setGpsError({
        permissionDenied: Boolean(gErr?.permissionDenied),
        message: gErr?.message || 'ไม่สามารถอ่านพิกัด GPS ได้',
        retryAction: 'end',
      })
      setSubmittingAction(null)
      return
    }

    try {
      const ended = await hrTripService.endTrip(openTrip.id, {
        end_odometer: odoCheck.value,
        lat: gps.lat,
        lng: gps.lng,
        accuracy_m: gps.accuracy_m,
      })
      setStatus((prev) => (prev ? { ...prev, open_trip: null } : prev))
      setJustStarted(false)
      setEndOdometer('')
      setLastCompletedTrip(ended)
      toast.success('บันทึกจบทริปเรียบร้อยแล้ว')
    } catch (err: any) {
      await handleApiError(err, 'จบทริปไม่สำเร็จ')
    } finally {
      setSubmittingAction(null)
    }
  }

  const handleRetryGps = () => {
    const action = gpsError?.retryAction
    if (action === 'start') executeStartTrip()
    else if (action === 'stop') executeAddStop()
    else if (action === 'end') executeEndTrip()
  }

  if (notLinked) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
        <a href="/hr/me" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--link)]">
          <ArrowLeft className="w-4 h-4" />
          <span>← กลับหน้าของฉัน</span>
        </a>
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
        <span>กำลังโหลดข้อมูลการใช้งานรถยนต์...</span>
      </div>
    )
  }

  const consentAccepted = Boolean(status?.consent?.accepted)
  const openTrip = status?.open_trip ?? null
  const vehicles = status?.vehicles ?? []
  const maxStops = status?.max_stops ?? 10
  const stopLimitReached = openTrip ? openTrip.stops.length >= maxStops : false

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <a
          href="/hr/me"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--link)]"
        >
          <span>← กลับหน้าของฉัน</span>
        </a>
        <button
          type="button"
          onClick={() => (activeTab === 'history' ? loadHistory() : loadStatus())}
          title="รีเฟรชข้อมูล"
          className="p-2 rounded-xl text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Header */}
      <div className="phopy-card p-4 sm:p-5 flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
          <Car className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[var(--fg-1)]">ใช้งานรถยนต์</h1>
          <p className="text-xs sm:text-sm text-[var(--fg-3)]">
            บันทึกเลขไมล์และพิกัด GPS เฉพาะตอนเริ่มทริป แวะจุด และจบทริป
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('record')}
          className={`phopy-tab justify-center ${activeTab === 'record' ? 'active' : ''}`}
        >
          <Navigation className="w-4 h-4" />
          <span>บันทึกทริป</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`phopy-tab justify-center ${activeTab === 'history' ? 'active' : ''}`}
        >
          <History className="w-4 h-4" />
          <span>ประวัติทริป</span>
        </button>
      </div>

      {activeTab === 'record' && (
        <div className="space-y-4">
          {/* Last GPS Accuracy Indicator */}
          {lastGpsAccuracy != null && (
            <div className="px-3.5 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--fg-2)] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>ความแม่นยำ GPS ล่าสุด</span>
              </span>
              <span className="font-mono font-semibold text-[var(--fg-1)]">±{Math.round(lastGpsAccuracy)} ม.</span>
            </div>
          )}

          {/* GPS Error & Permission Instructions */}
          {gpsError && (
            <div className="p-4 rounded-xl bg-[var(--warning-soft)] border border-[var(--border)] text-[var(--warning-strong)] text-xs sm:text-sm space-y-2">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{gpsError.message}</span>
              </div>
              {gpsError.permissionDenied && (
                <ul className="list-disc list-inside space-y-0.5 text-xs text-[var(--fg-2)]">
                  <li>บนมือถือ: ตรวจสอบว่าเปิด "บริการหาตำแหน่ง (Location Services)"</li>
                  <li>บนเบราว์เซอร์: กดไอคอนรูปแม่กุญแจหน้า URL แล้วเลือก "อนุญาตตำแหน่ง"</li>
                </ul>
              )}
              {gpsError.retryAction && (
                <div>
                  <button
                    type="button"
                    onClick={handleRetryGps}
                    className="phopy-btn-secondary px-3 py-1.5 min-h-[36px] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>ลองจับพิกัดอีกครั้ง</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* General Form Error */}
          {formError && (
            <div className="p-3.5 rounded-xl bg-[var(--danger-soft)] border border-[var(--border)] text-[var(--danger-strong)] text-xs sm:text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* PDPA Consent Gate */}
          {!consentAccepted ? (
            <div className="phopy-card p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-1)]">
                <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
                <span>ความยินยอมการบันทึกตำแหน่ง (PDPA)</span>
              </div>

              <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs sm:text-sm text-[var(--fg-2)] leading-relaxed">
                {status?.consent?.notice_text || TRIP_PDPA_NOTICE_TEXT}
              </div>

              <label className="flex items-start gap-3 text-xs sm:text-sm text-[var(--fg-1)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--border)] text-[var(--primary)]"
                />
                <span>ข้าพเจ้ายินยอมให้ระบบบันทึกตำแหน่ง GPS ตามเงื่อนไขข้างต้น</span>
              </label>

              <button
                type="button"
                onClick={handleAcceptConsent}
                disabled={!consentChecked || acceptingConsent}
                className="phopy-btn-primary w-full text-sm disabled:opacity-50"
              >
                {acceptingConsent ? 'กำลังบันทึก...' : 'ยินยอมและดำเนินการต่อ'}
              </button>
            </div>
          ) : openTrip ? (
            /* Open Trip View */
            <div className="space-y-4">
              {justStarted && (
                <div className="p-4 rounded-xl bg-[var(--success-soft)] border border-[var(--border)] text-[var(--success-strong)] font-semibold text-sm sm:text-base flex items-center justify-center gap-2 text-center">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ</span>
                </div>
              )}

              {/* Current Trip Summary */}
              <div className="phopy-card p-5 sm:p-6 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-base text-[var(--fg-1)] flex items-center gap-2">
                    <Car className="w-4 h-4 text-[var(--primary)]" />
                    <span>{openTrip.plate_no}</span>
                    {openTrip.vehicle_label && (
                      <span className="text-xs font-normal text-[var(--fg-3)]">({openTrip.vehicle_label})</span>
                    )}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[openTrip.status]}`}>
                    {TRIP_STATUS_LABELS[openTrip.status]}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm text-[var(--fg-2)]">
                  <div>
                    <span className="text-[var(--fg-3)] block text-[11px]">ประเภท</span>
                    <span className="font-medium">{openTrip.car_type === 'COMPANY' ? 'รถบริษัท' : 'รถส่วนตัว'}</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)] block text-[11px]">เวลาเริ่ม</span>
                    <span className="font-mono font-medium">{fmtDateTime(openTrip.started_at)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)] block text-[11px]">เลขไมล์เริ่ม</span>
                    <span className="font-mono font-semibold text-[var(--fg-1)]">{openTrip.start_odometer.toLocaleString('th-TH')}</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-3)] block text-[11px]">ความแม่นยำ GPS เริ่ม</span>
                    <span className="font-mono">
                      {openTrip.start_accuracy_m != null ? `±${Math.round(openTrip.start_accuracy_m)} ม.` : '-'}
                    </span>
                  </div>
                </div>

                {openTrip.purpose && (
                  <div className="text-xs sm:text-sm text-[var(--fg-2)] pt-1 border-t border-[var(--border-subtle)]">
                    <span className="text-[var(--fg-3)]">วัตถุประสงค์: </span>
                    <span>{openTrip.purpose}</span>
                  </div>
                )}

                <div className="pt-1">
                  <a
                    href={openTrip.start_map_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--link)]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>ดูจุดเริ่มบน Google Maps</span>
                  </a>
                </div>
              </div>

              {/* Stops Card */}
              <div className="phopy-card p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[var(--fg-1)] flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[var(--primary)]" />
                    <span>จุดแวะ ({openTrip.stops.length}/{maxStops})</span>
                  </h2>
                </div>

                {openTrip.stops.length > 0 && (
                  <div className="space-y-2">
                    {openTrip.stops.map((stop) => (
                      <div
                        key={stop.id}
                        className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 text-xs sm:text-sm flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-semibold text-[var(--fg-1)]">
                            จุดแวะ #{stop.seq} {stop.note ? `· ${stop.note}` : ''}
                          </div>
                          <div className="text-xs text-[var(--fg-3)] flex items-center gap-2">
                            <span className="font-mono">{fmtDateTime(stop.recorded_at)}</span>
                            {stop.accuracy_m != null && (
                              <span className="font-mono">±{Math.round(stop.accuracy_m)} ม.</span>
                            )}
                          </div>
                        </div>
                        <a
                          href={stop.map_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[var(--link)] inline-flex items-center gap-1 shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>แผนที่</span>
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    executeAddStop()
                  }}
                  className="space-y-3 pt-2 border-t border-[var(--border-subtle)]"
                >
                  <div>
                    <label htmlFor={stopNoteId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                      บันทึกจุดแวะ (ถ้ามี)
                    </label>
                    <input
                      id={stopNoteId}
                      ref={stopNoteRef}
                      type="text"
                      maxLength={200}
                      value={stopNote}
                      onChange={(e) => setStopNote(e.target.value)}
                      disabled={stopLimitReached || submittingAction !== null}
                      placeholder="เช่น ส่งของลูกค้า A, เติมน้ำมัน"
                      className="phopy-input w-full text-sm"
                    />
                  </div>
                  {stopLimitReached && (
                    <p className="text-xs text-[var(--warning-strong)]">
                      แวะจุดครบสูงสุด {maxStops} จุดแล้ว
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={stopLimitReached || submittingAction !== null}
                    className="phopy-btn-secondary w-full text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>{submittingAction === 'stop' ? 'กำลังบันทึกจุดแวะ...' : 'แวะจุด'}</span>
                  </button>
                </form>
              </div>

              {/* End Trip Card */}
              <div className="phopy-card p-5 sm:p-6 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--fg-1)] flex items-center gap-2">
                  <Flag className="w-4 h-4 text-[var(--primary)]" />
                  <span>จบทริป</span>
                </h2>
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    executeEndTrip()
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label htmlFor={endOdoId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                      เลขไมล์สิ้นสุด <span className="text-[var(--danger)]">*</span>
                    </label>
                    <input
                      id={endOdoId}
                      type="number"
                      step="0.1"
                      min={openTrip.start_odometer}
                      max={9999999}
                      value={endOdometer}
                      onChange={(e) => setEndOdometer(e.target.value)}
                      disabled={submittingAction !== null}
                      placeholder={`ไม่น้อยกว่า ${openTrip.start_odometer}`}
                      className="phopy-input w-full text-sm font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submittingAction !== null}
                    className="phopy-btn-primary w-full text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Flag className="w-4 h-4" />
                    <span>{submittingAction === 'end' ? 'กำลังจบทริป...' : 'จบทริป'}</span>
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* Start Trip Form */
            <div className="space-y-4">
              {lastCompletedTrip && (
                <div className="p-4 rounded-xl bg-[var(--success-soft)] border border-[var(--border)] text-[var(--success-strong)] text-xs sm:text-sm space-y-1">
                  <div className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>บันทึกจบทริปเรียบร้อยแล้ว ({lastCompletedTrip.plate_no})</span>
                  </div>
                  <div className="text-[var(--fg-2)] flex flex-wrap gap-x-3 gap-y-1">
                    <span>ระยะทางตามไมล์: {lastCompletedTrip.odometer_km ?? '-'} กม.</span>
                    <span>
                      แผนที่:{' '}
                      {lastCompletedTrip.map_distance_km != null
                        ? `${lastCompletedTrip.map_distance_km.toFixed(1)} กม.`
                        : ROUTE_STATUS_LABELS[lastCompletedTrip.route_status]}
                    </span>
                    <span>เวลา: {fmtDuration(lastCompletedTrip.duration_sec)}</span>
                  </div>
                </div>
              )}

              <div className="phopy-card p-5 sm:p-6 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--fg-1)] flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-[var(--primary)]" />
                  <span>เริ่มทริปใหม่</span>
                </h2>

                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    executeStartTrip()
                  }}
                  className="space-y-4"
                >
                  <div>
                    <span className="block text-xs font-medium text-[var(--fg-2)] mb-1.5">ประเภทรถ</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCarType('COMPANY')}
                        className={`py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-semibold transition ${
                          carType === 'COMPANY'
                            ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
                            : 'border-[var(--border)] bg-[var(--surface-2)]/40 text-[var(--fg-2)]'
                        }`}
                      >
                        รถบริษัท
                      </button>
                      <button
                        type="button"
                        onClick={() => setCarType('PRIVATE')}
                        className={`py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-semibold transition ${
                          carType === 'PRIVATE'
                            ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
                            : 'border-[var(--border)] bg-[var(--surface-2)]/40 text-[var(--fg-2)]'
                        }`}
                      >
                        รถส่วนตัว
                      </button>
                    </div>
                  </div>

                  {carType === 'COMPANY' ? (
                    <div>
                      <label htmlFor={vehicleSelectId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                        เลือกรถบริษัท <span className="text-[var(--danger)]">*</span>
                      </label>
                      {vehicles.length > 0 ? (
                        <select
                          id={vehicleSelectId}
                          value={vehicleId}
                          onChange={(e) => setVehicleId(e.target.value)}
                          className="phopy-input w-full text-sm"
                        >
                          <option value="">-- เลือกรถบริษัท --</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.plate_no}
                              {v.label ? ` (${v.label})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-[var(--fg-3)] p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                          ยังไม่มีรายการรถบริษัทในระบบ กรุณาติดต่อ HR หรือเลือก "รถส่วนตัว"
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label htmlFor={plateInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                        ทะเบียนรถ <span className="text-[var(--danger)]">*</span>
                      </label>
                      <input
                        id={plateInputId}
                        type="text"
                        maxLength={30}
                        value={plateNo}
                        onChange={(e) => setPlateNo(e.target.value)}
                        placeholder="เช่น กข 1234 กรุงเทพ"
                        className="phopy-input w-full text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor={startOdoId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                      เลขไมล์เริ่มต้น <span className="text-[var(--danger)]">*</span>
                    </label>
                    <input
                      id={startOdoId}
                      type="number"
                      step="0.1"
                      min="0"
                      max="9999999"
                      value={startOdometer}
                      onChange={(e) => setStartOdometer(e.target.value)}
                      placeholder="เช่น 45210"
                      className="phopy-input w-full text-sm font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor={purposeId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                      วัตถุประสงค์การเดินทาง (ถ้ามี)
                    </label>
                    <input
                      id={purposeId}
                      type="text"
                      maxLength={500}
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      placeholder="เช่น ส่งสินค้าลูกค้า, ประชุมนอกสถานที่"
                      className="phopy-input w-full text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submittingAction !== null}
                    className="phopy-btn-primary w-full text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Navigation className="w-4 h-4" />
                    <span>{submittingAction === 'start' ? 'กำลังจับพิกัดและเริ่มทริป...' : 'เริ่มทริป'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="phopy-card p-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={fromDateId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                ตั้งแต่
              </label>
              <input
                id={fromDateId}
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
                className="phopy-input w-full text-xs sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor={toDateId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                ถึง
              </label>
              <input
                id={toDateId}
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
                className="phopy-input w-full text-xs sm:text-sm"
              />
            </div>
          </div>

          {loadingHistory ? (
            <div className="phopy-card p-8 text-center text-sm text-[var(--fg-3)] flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>กำลังโหลดประวัติทริป...</span>
            </div>
          ) : trips.length === 0 ? (
            <div className="phopy-card p-8 text-center text-sm text-[var(--fg-3)]">
              ยังไม่มีประวัติการใช้งานรถยนต์
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="phopy-card p-4 space-y-2.5 text-xs sm:text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[var(--fg-1)] flex items-center gap-1.5">
                      <Car className="w-4 h-4 text-[var(--primary)]" />
                      <span>{trip.plate_no}</span>
                      {trip.vehicle_label && (
                        <span className="text-xs font-normal text-[var(--fg-3)]">({trip.vehicle_label})</span>
                      )}
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[trip.status]}`}>
                      {TRIP_STATUS_LABELS[trip.status]}
                    </span>
                  </div>

                  {trip.purpose && <div className="text-[var(--fg-2)]">{trip.purpose}</div>}

                  <div className="text-xs text-[var(--fg-3)] flex flex-wrap gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      {fmtDateTime(trip.started_at)}
                      {trip.ended_at ? ` – ${fmtDateTime(trip.ended_at)}` : ''}
                    </span>
                    <span>แวะ {trip.stops.length} จุด</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
                    <div>
                      <span className="text-[var(--fg-3)] block">เลขไมล์</span>
                      <span className="font-mono text-[var(--fg-1)] font-medium">
                        {trip.start_odometer} → {trip.end_odometer ?? '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--fg-3)] block">ระยะทาง (ไมล์ / แผนที่)</span>
                      <span className="font-mono text-[var(--fg-1)] font-medium">
                        {trip.odometer_km != null ? `${trip.odometer_km.toFixed(1)} กม.` : '-'}
                        {' / '}
                        {trip.map_distance_km != null
                          ? `${trip.map_distance_km.toFixed(1)} กม.`
                          : ROUTE_STATUS_LABELS[trip.route_status]}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--fg-3)] block">ระยะเวลา</span>
                      <span className="font-mono text-[var(--fg-1)] font-medium">{fmtDuration(trip.duration_sec)}</span>
                    </div>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center gap-3 text-xs">
                    <a
                      href={trip.route_map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[var(--link)]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>เส้นทาง Google Maps</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
