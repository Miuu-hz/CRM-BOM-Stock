import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import {
  Car,
  Plus,
  Pencil,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Filter,
  X,
  Navigation,
} from 'lucide-react'
import toast from 'react-hot-toast'
import hrTripService, {
  HrVehicle,
  ManagerCarTrip,
  TripStatus,
  TRIP_STATUS_LABELS,
  ROUTE_STATUS_LABELS,
  TRIP_FLAG_LABELS,
} from '../../services/hrTrip.service'
import hrService, { Employee } from '../../services/hr.service'

type TabKey = 'trips' | 'vehicles'

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

const STATUS_BADGE: Record<TripStatus, string> = {
  OPEN: 'bg-[var(--info-soft)] text-[var(--primary)]',
  COMPLETED: 'bg-[var(--success-soft)] text-[var(--success-strong)]',
  INCOMPLETE: 'bg-[var(--warning-soft)] text-[var(--warning-strong)]',
}

export default function CarTrips() {
  const fromFilterId = useId()
  const toFilterId = useId()
  const empFilterId = useId()
  const vehFilterId = useId()
  const statusFilterId = useId()
  const plateInputId = useId()
  const labelInputId = useId()
  const notesInputId = useId()

  const [activeTab, setActiveTab] = useState<TabKey>('trips')

  // Trips state
  const [trips, setTrips] = useState<ManagerCarTrip[]>([])
  const [loadingTrips, setLoadingTrips] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  // Filters
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterVehicleId, setFilterVehicleId] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | TripStatus>('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  // Shared options
  const [employees, setEmployees] = useState<Employee[]>([])
  const [vehicles, setVehicles] = useState<HrVehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(false)

  // Vehicle modal state
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<HrVehicle | null>(null)
  const [vPlateNo, setVPlateNo] = useState('')
  const [vLabel, setVLabel] = useState('')
  const [vNotes, setVNotes] = useState('')
  const [vActive, setVActive] = useState(true)
  const [savingVehicle, setSavingVehicle] = useState(false)

  const loadTrips = useCallback(async () => {
    setLoadingTrips(true)
    try {
      const list = await hrTripService.getTrips({
        from: filterFrom || undefined,
        to: filterTo || undefined,
        employee_id: filterEmployeeId || undefined,
        vehicle_id: filterVehicleId || undefined,
        status: filterStatus || undefined,
        flagged: flaggedOnly ? 1 : undefined,
      })
      setTrips(Array.isArray(list) ? list : [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการเดินทางไม่สำเร็จ')
      setTrips([])
    } finally {
      setLoadingTrips(false)
    }
  }, [filterFrom, filterTo, filterEmployeeId, filterVehicleId, filterStatus, flaggedOnly])

  const loadVehicles = useCallback(async () => {
    setLoadingVehicles(true)
    try {
      const list = await hrTripService.getVehicles()
      setVehicles(Array.isArray(list) ? list : [])
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'โหลดรายการรถบริษัทไม่สำเร็จ')
    } finally {
      setLoadingVehicles(false)
    }
  }, [])

  const loadEmployees = useCallback(async () => {
    try {
      const list = await hrService.getEmployees()
      setEmployees(Array.isArray(list) ? list : [])
    } catch {
      setEmployees([])
    }
  }, [])

  useEffect(() => {
    loadTrips()
  }, [loadTrips])

  useEffect(() => {
    loadVehicles()
    loadEmployees()
  }, [loadVehicles, loadEmployees])

  const summary = useMemo(() => {
    const total = trips.length
    const totalOdoKm = trips.reduce((acc, t) => acc + (t.odometer_km ?? 0), 0)
    const totalMapKm = trips.reduce((acc, t) => acc + (t.map_distance_km ?? 0), 0)
    const flaggedCount = trips.filter((t) => t.flags && t.flags.length > 0).length
    return { total, totalOdoKm, totalMapKm, flaggedCount }
  }, [trips])

  const handleRetryRoute = async (tripId: string) => {
    setRetryingId(tripId)
    try {
      const updated = await hrTripService.retryRoute(tripId)
      setTrips((prev) => prev.map((t) => (t.id === tripId ? updated : t)))
      if (updated.route_status === 'OK') {
        toast.success('คำนวณระยะทางแผนที่สำเร็จ')
      } else {
        toast.error('คำนวณระยะทางแผนที่ไม่สำเร็จ')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'คำนวณระยะทางแผนที่ไม่สำเร็จ')
    } finally {
      setRetryingId(null)
    }
  }

  const openAddVehicleModal = () => {
    setEditingVehicle(null)
    setVPlateNo('')
    setVLabel('')
    setVNotes('')
    setVActive(true)
    setVehicleModalOpen(true)
  }

  const openEditVehicleModal = (veh: HrVehicle) => {
    setEditingVehicle(veh)
    setVPlateNo(veh.plate_no)
    setVLabel(veh.label || '')
    setVNotes(veh.notes || '')
    setVActive(veh.is_active)
    setVehicleModalOpen(true)
  }

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault()
    const plate = vPlateNo.trim()
    if (!plate) {
      toast.error('กรุณาระบุทะเบียนรถ')
      return
    }
    setSavingVehicle(true)
    try {
      if (editingVehicle) {
        await hrTripService.updateVehicle(editingVehicle.id, {
          plate_no: plate,
          label: vLabel.trim() || null,
          notes: vNotes.trim() || null,
          is_active: vActive,
        })
        toast.success('แก้ไขข้อมูลรถบริษัทแล้ว')
      } else {
        await hrTripService.createVehicle({
          plate_no: plate,
          label: vLabel.trim() || null,
          notes: vNotes.trim() || null,
        })
        toast.success('เพิ่มรถบริษัทเรียบร้อยแล้ว')
      }
      setVehicleModalOpen(false)
      await loadVehicles()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'บันทึกข้อมูลรถบริษัทไม่สำเร็จ')
    } finally {
      setSavingVehicle(false)
    }
  }

  const handleToggleVehicleActive = async (veh: HrVehicle) => {
    try {
      await hrTripService.updateVehicle(veh.id, { is_active: !veh.is_active })
      toast.success(veh.is_active ? 'ปิดใช้งานรถเรียบร้อยแล้ว' : 'เปิดใช้งานรถเรียบร้อยแล้ว')
      await loadVehicles()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'อัปเดตสถานะรถไม่สำเร็จ')
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--fg-1)]">ใช้งานรถยนต์</h1>
            <p className="text-sm text-[var(--fg-3)]">
              ตรวจสอบบันทึกการเดินทาง เลขไมล์ ระยะทางแผนที่ และจัดการรถบริษัท
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('trips')}
          className={`phopy-tab ${activeTab === 'trips' ? 'active' : ''}`}
        >
          <Navigation className="w-4 h-4" />
          <span>บันทึกการเดินทาง</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('vehicles')}
          className={`phopy-tab ${activeTab === 'vehicles' ? 'active' : ''}`}
        >
          <Car className="w-4 h-4" />
          <span>รถบริษัท</span>
        </button>
      </div>

      {activeTab === 'trips' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="phopy-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-3)]">
              <Filter className="w-4 h-4" />
              <span>ตัวกรอง</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label htmlFor={fromFilterId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                  ตั้งแต่วันที่
                </label>
                <input
                  id={fromFilterId}
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="phopy-input w-full text-xs sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor={toFilterId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                  ถึงวันที่
                </label>
                <input
                  id={toFilterId}
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="phopy-input w-full text-xs sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor={empFilterId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                  พนักงาน
                </label>
                <select
                  id={empFilterId}
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                  className="phopy-input w-full text-xs sm:text-sm"
                >
                  <option value="">ทั้งหมด</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.first_name} {e.last_name || ''} ({e.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={vehFilterId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                  รถบริษัท
                </label>
                <select
                  id={vehFilterId}
                  value={filterVehicleId}
                  onChange={(e) => setFilterVehicleId(e.target.value)}
                  className="phopy-input w-full text-xs sm:text-sm"
                >
                  <option value="">ทั้งหมด</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate_no}
                      {v.label ? ` (${v.label})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={statusFilterId} className="block text-xs font-medium text-[var(--fg-3)] mb-1">
                  สถานะ
                </label>
                <select
                  id={statusFilterId}
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as '' | TripStatus)}
                  className="phopy-input w-full text-xs sm:text-sm"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="OPEN">{TRIP_STATUS_LABELS.OPEN}</option>
                  <option value="COMPLETED">{TRIP_STATUS_LABELS.COMPLETED}</option>
                  <option value="INCOMPLETE">{TRIP_STATUS_LABELS.INCOMPLETE}</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-[var(--fg-2)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={flaggedOnly}
                  onChange={(e) => setFlaggedOnly(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--primary)]"
                />
                <span>เฉพาะรายการผิดปกติ</span>
              </label>

              <button
                type="button"
                onClick={loadTrips}
                className="phopy-btn-secondary px-3 py-1.5 min-h-[36px] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>รีเฟรช</span>
              </button>
            </div>
          </div>

          {/* Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="phopy-card p-4">
              <div className="text-xs text-[var(--fg-3)]">จำนวนทริป</div>
              <div className="text-xl font-bold text-[var(--fg-1)] font-mono mt-1">{summary.total}</div>
            </div>
            <div className="phopy-card p-4">
              <div className="text-xs text-[var(--fg-3)]">ระยะทางตามไมล์รวม</div>
              <div className="text-xl font-bold text-[var(--fg-1)] font-mono mt-1">
                {summary.totalOdoKm.toFixed(1)} กม.
              </div>
            </div>
            <div className="phopy-card p-4">
              <div className="text-xs text-[var(--fg-3)]">ระยะทางแผนที่รวม</div>
              <div className="text-xl font-bold text-[var(--fg-1)] font-mono mt-1">
                {summary.totalMapKm.toFixed(1)} กม.
              </div>
            </div>
            <div className="phopy-card p-4">
              <div className="text-xs text-[var(--fg-3)]">รายการที่พบความผิดปกติ</div>
              <div className="text-xl font-bold text-[var(--warning-strong)] font-mono mt-1">
                {summary.flaggedCount}
              </div>
            </div>
          </div>

          {/* Trips Table */}
          <div className="phopy-card overflow-hidden">
            {loadingTrips ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>กำลังโหลดบันทึกการเดินทาง...</span>
              </div>
            ) : trips.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีบันทึกการเดินทาง</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table text-xs">
                  <thead>
                    <tr>
                      <th>วันที่ / เวลา</th>
                      <th>พนักงาน</th>
                      <th>รถ / วัตถุประสงค์</th>
                      <th>สถานะ</th>
                      <th>เลขไมล์ (กม.)</th>
                      <th>ระยะทางแผนที่</th>
                      <th>เวลาเดินทาง</th>
                      <th>ความผิดปกติ</th>
                      <th>แผนที่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => (
                      <tr key={trip.id}>
                        <td className="whitespace-nowrap font-mono">
                          <div className="text-[var(--fg-1)]">{fmtDateTime(trip.started_at)}</div>
                          <div className="text-[11px] text-[var(--fg-3)]">
                            {trip.ended_at ? `จบ ${fmtDateTime(trip.ended_at)}` : '-'}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium text-[var(--fg-1)]">{trip.employee_name}</div>
                          <div className="text-[11px] text-[var(--fg-3)] font-mono">{trip.employee_code}</div>
                        </td>
                        <td>
                          <div className="font-medium text-[var(--fg-1)]">
                            {trip.plate_no}
                            {trip.vehicle_label ? ` (${trip.vehicle_label})` : ''}
                          </div>
                          <div className="text-[11px] text-[var(--fg-3)]">
                            {trip.car_type === 'COMPANY' ? 'รถบริษัท' : 'รถส่วนตัว'}
                            {trip.purpose ? ` · ${trip.purpose}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_BADGE[trip.status]}`}>
                            {TRIP_STATUS_LABELS[trip.status]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap font-mono">
                          <div className="text-[var(--fg-1)]">
                            {trip.start_odometer} → {trip.end_odometer ?? '-'}
                          </div>
                          <div className="text-[11px] text-[var(--fg-3)]">
                            {trip.odometer_km != null ? `${trip.odometer_km.toFixed(1)} กม.` : '-'}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {trip.route_status === 'OK' && trip.map_distance_km != null ? (
                            <div>
                              <span className="font-mono font-semibold text-[var(--fg-1)]">
                                {trip.map_distance_km.toFixed(1)} กม.
                              </span>
                              <div className="text-[11px] text-[var(--success-strong)]">
                                {ROUTE_STATUS_LABELS.OK}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[var(--surface-2)] text-[var(--fg-2)]">
                                {ROUTE_STATUS_LABELS[trip.route_status]}
                              </span>
                              {trip.status === 'COMPLETED' && trip.route_status !== 'OK' && (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => handleRetryRoute(trip.id)}
                                    disabled={retryingId === trip.id}
                                    className="text-[11px] font-semibold text-[var(--primary)] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${retryingId === trip.id ? 'animate-spin' : ''}`} />
                                    <span>คำนวณใหม่</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap font-mono">
                          <div className="text-[var(--fg-1)]">{fmtDuration(trip.duration_sec)}</div>
                          <div className="text-[11px] text-[var(--fg-3)]">
                            แผนที่ {fmtDuration(trip.map_duration_sec)}
                          </div>
                        </td>
                        <td>
                          {trip.flags && trip.flags.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {trip.flags.map((flag) => (
                                <span
                                  key={flag}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--danger-soft)] text-[var(--danger-strong)] whitespace-nowrap"
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span>{TRIP_FLAG_LABELS[flag] || flag}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[var(--fg-3)]">-</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <a
                              href={trip.route_map_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[var(--link)] font-medium"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>เส้นทาง</span>
                            </a>
                            <a
                              href={trip.start_map_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[var(--link)]"
                            >
                              <span>จุดเริ่ม</span>
                            </a>
                            {trip.stops.map((stop) => (
                              <a
                                key={stop.id}
                                href={stop.map_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[var(--link)]"
                              >
                                <span>จุดแวะ {stop.seq}</span>
                              </a>
                            ))}
                            {trip.end_map_url && (
                              <a
                                href={trip.end_map_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[var(--link)]"
                              >
                                <span>จุดจบ</span>
                              </a>
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
        </div>
      )}

      {activeTab === 'vehicles' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openAddVehicleModal}
              className="phopy-btn-primary px-4 py-2 text-sm flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มรถบริษัท</span>
            </button>
          </div>

          <div className="phopy-card overflow-hidden">
            {loadingVehicles ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>กำลังโหลดรายการรถบริษัท...</span>
              </div>
            ) : vehicles.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--fg-3)]">ยังไม่มีข้อมูลรถบริษัท</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="phopy-table text-xs sm:text-sm">
                  <thead>
                    <tr>
                      <th>ทะเบียนรถ</th>
                      <th>ชื่อเรียก / รุ่น</th>
                      <th>เลขไมล์ล่าสุด</th>
                      <th>สถานะ</th>
                      <th>หมายเหตุ</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((veh) => (
                      <tr key={veh.id}>
                        <td className="font-semibold text-[var(--fg-1)] font-mono">{veh.plate_no}</td>
                        <td className="text-[var(--fg-2)]">{veh.label || '-'}</td>
                        <td className="font-mono text-[var(--fg-1)]">
                          {veh.last_end_odometer != null ? veh.last_end_odometer.toLocaleString('th-TH') : '-'}
                        </td>
                        <td>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              veh.is_active
                                ? 'bg-[var(--success-soft)] text-[var(--success-strong)]'
                                : 'bg-[var(--surface-2)] text-[var(--fg-3)]'
                            }`}
                          >
                            {veh.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                          </span>
                        </td>
                        <td className="text-[var(--fg-2)]">{veh.notes || '-'}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditVehicleModal(veh)}
                              className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--fg-2)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>แก้ไข</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleVehicleActive(veh)}
                              className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                            >
                              {veh.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
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
        </div>
      )}

      {/* Add / Edit Vehicle Modal */}
      {vehicleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-center justify-center">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="font-bold text-base sm:text-lg text-[var(--fg-1)] flex items-center gap-2">
                <Car className="w-5 h-5 text-[var(--primary)]" />
                <span>{editingVehicle ? 'แก้ไขรถบริษัท' : 'เพิ่มรถบริษัท'}</span>
              </h2>
              <button
                type="button"
                onClick={() => setVehicleModalOpen(false)}
                aria-label="ปิด"
                className="p-1 rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="space-y-4">
              <div>
                <label htmlFor={plateInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ทะเบียนรถ <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  id={plateInputId}
                  type="text"
                  maxLength={30}
                  required
                  value={vPlateNo}
                  onChange={(e) => setVPlateNo(e.target.value)}
                  placeholder="เช่น กก 1234"
                  className="phopy-input w-full text-sm"
                />
              </div>

              <div>
                <label htmlFor={labelInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  ชื่อเรียก / รุ่นรถ
                </label>
                <input
                  id={labelInputId}
                  type="text"
                  maxLength={100}
                  value={vLabel}
                  onChange={(e) => setVLabel(e.target.value)}
                  placeholder="เช่น Toyota Hilux Revo สีขาว"
                  className="phopy-input w-full text-sm"
                />
              </div>

              <div>
                <label htmlFor={notesInputId} className="block text-xs font-medium text-[var(--fg-2)] mb-1">
                  หมายเหตุ
                </label>
                <textarea
                  id={notesInputId}
                  rows={2}
                  maxLength={500}
                  value={vNotes}
                  onChange={(e) => setVNotes(e.target.value)}
                  placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                  className="phopy-input w-full text-sm"
                />
              </div>

              {editingVehicle && (
                <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-[var(--fg-2)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vActive}
                    onChange={(e) => setVActive(e.target.checked)}
                    className="rounded border-[var(--border)] text-[var(--primary)]"
                  />
                  <span>เปิดใช้งานรถคันนี้</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="phopy-btn-secondary px-4 py-2 min-h-[38px] text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingVehicle}
                  className="phopy-btn-primary px-5 py-2 min-h-[38px] text-sm disabled:opacity-50"
                >
                  {savingVehicle ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
