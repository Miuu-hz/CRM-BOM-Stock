import api from './api'

export type CarType = 'COMPANY' | 'PRIVATE'
export type TripStatus = 'OPEN' | 'COMPLETED' | 'INCOMPLETE'
export type RouteStatus = 'NONE' | 'PENDING' | 'OK' | 'FAILED' | 'UNAVAILABLE' | 'SKIPPED'
export type TripFlagCode = 'ODOMETER_MISMATCH' | 'DURATION_EXCESSIVE' | 'ODOMETER_ROLLBACK' | 'POOR_GPS'

export interface HrVehicle {
  id: string
  plate_no: string
  label: string | null
  is_active: boolean
  notes: string | null
  last_end_odometer: number | null
  created_at: string
  updated_at: string
}

export interface CarTripStop {
  id: string
  seq: number
  lat: number
  lng: number
  accuracy_m: number | null
  note: string | null
  recorded_at: string
  map_url: string
}

export interface CarTripBase {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  vehicle_id: string | null
  car_type: CarType
  plate_no: string
  vehicle_label: string | null
  purpose: string | null
  status: TripStatus
  started_at: string
  start_odometer: number
  start_lat: number
  start_lng: number
  start_accuracy_m: number | null
  ended_at: string | null
  end_odometer: number | null
  end_lat: number | null
  end_lng: number | null
  end_accuracy_m: number | null
  odometer_km: number | null
  duration_sec: number | null
  map_distance_km: number | null
  map_duration_sec: number | null
  route_status: RouteStatus
  close_reason: string | null
  stops: CarTripStop[]
  start_map_url: string
  end_map_url: string | null
  route_map_url: string
}

export interface ManagerCarTrip extends CarTripBase {
  flags: TripFlagCode[]
  prev_vehicle_end_odometer: number | null
  route_error: string | null
  route_fetched_at: string | null
}

export interface ManagerTripsFilter {
  from?: string
  to?: string
  employee_id?: string
  vehicle_id?: string
  car_type?: CarType
  plate?: string
  status?: TripStatus
  flagged?: 1
}

export interface CreateVehicleInput {
  plate_no: string
  label?: string | null
  notes?: string | null
}

export interface UpdateVehicleInput {
  plate_no?: string
  label?: string | null
  is_active?: boolean
  notes?: string | null
}

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  OPEN: 'กำลังเดินทาง',
  COMPLETED: 'จบแล้ว',
  INCOMPLETE: 'ไม่สมบูรณ์ (เกิน 12 ชม.)',
}

export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  NONE: '-',
  OK: 'คำนวณแล้ว',
  PENDING: 'รอคำนวณ',
  UNAVAILABLE: 'ยังไม่ตั้งค่าแผนที่',
  FAILED: 'คำนวณแผนที่ไม่สำเร็จ',
  SKIPPED: 'ไม่คำนวณ (ไม่สมบูรณ์)',
}

export const TRIP_FLAG_LABELS: Record<TripFlagCode, string> = {
  ODOMETER_MISMATCH: 'ระยะไมล์ต่างจากแผนที่ >20%',
  DURATION_EXCESSIVE: 'ใช้เวลานานกว่าแผนที่มาก',
  ODOMETER_ROLLBACK: 'ไมล์เริ่มต่ำกว่าไมล์จบครั้งก่อน',
  POOR_GPS: 'ความแม่นยำ GPS ต่ำ (>150 ม.)',
}

export const hrTripService = {
  async getTrips(params?: ManagerTripsFilter): Promise<ManagerCarTrip[]> {
    const res = await api.get('/hr/trips', { params })
    return res.data.data || []
  },

  async retryRoute(tripId: string): Promise<ManagerCarTrip> {
    const res = await api.post(`/hr/trips/${tripId}/retry-route`)
    return res.data.data
  },

  async getVehicles(params?: { active?: 1 }): Promise<HrVehicle[]> {
    const res = await api.get('/hr/vehicles', { params })
    return res.data.data || []
  },

  async createVehicle(data: CreateVehicleInput): Promise<HrVehicle> {
    const res = await api.post('/hr/vehicles', data)
    return res.data.data
  },

  async updateVehicle(id: string, data: UpdateVehicleInput): Promise<HrVehicle> {
    const res = await api.put(`/hr/vehicles/${id}`, data)
    return res.data.data
  },
}

export default hrTripService
