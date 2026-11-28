import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hrTrip.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/hrTrip.service')>()
  return {
    ...actual,
    default: {
      getTrips: vi.fn(),
      retryRoute: vi.fn(),
      getVehicles: vi.fn(),
      createVehicle: vi.fn(),
      updateVehicle: vi.fn(),
    },
  }
})

vi.mock('../../services/hr.service', () => ({
  default: {
    getEmployees: vi.fn(),
  },
}))

import hrTripService, { HrVehicle, ManagerCarTrip } from '../../services/hrTrip.service'
import hrService from '../../services/hr.service'
import CarTrips from './CarTrips'

const mockTripService = hrTripService as unknown as {
  getTrips: ReturnType<typeof vi.fn>
  retryRoute: ReturnType<typeof vi.fn>
  getVehicles: ReturnType<typeof vi.fn>
  createVehicle: ReturnType<typeof vi.fn>
  updateVehicle: ReturnType<typeof vi.fn>
}

const mockHrService = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
}

const sampleVehicles: HrVehicle[] = [
  {
    id: 'veh-1',
    plate_no: 'กก 1234',
    label: 'Toyota Hilux',
    is_active: true,
    notes: 'รถส่งของหลัก',
    last_end_odometer: 45120,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-24T00:00:00Z',
  },
]

const sampleTrips: ManagerCarTrip[] = [
  {
    id: 'trip-1',
    employee_id: 'emp-1',
    employee_code: 'EMP-001',
    employee_name: 'สมชาย ใจดี',
    vehicle_id: 'veh-1',
    car_type: 'COMPANY',
    plate_no: 'กก 1234',
    vehicle_label: 'Toyota Hilux',
    purpose: 'ส่งสินค้าสาขา',
    status: 'COMPLETED',
    started_at: '2026-11-24T08:00:00Z',
    start_odometer: 45000,
    start_lat: 13.75,
    start_lng: 100.5,
    start_accuracy_m: 10,
    ended_at: '2026-11-24T09:00:00Z',
    end_odometer: 45030,
    end_lat: 13.8,
    end_lng: 100.6,
    end_accuracy_m: 12,
    odometer_km: 30,
    duration_sec: 3600,
    map_distance_km: null,
    map_duration_sec: null,
    route_status: 'FAILED',
    close_reason: null,
    stops: [
      {
        id: 'stop-1',
        seq: 1,
        lat: 13.77,
        lng: 100.55,
        accuracy_m: 15,
        note: 'ลูกค้า A',
        recorded_at: '2026-11-24T08:30:00Z',
        map_url: 'https://www.google.com/maps/search/?api=1&query=13.77,100.55',
      },
    ],
    start_map_url: 'https://www.google.com/maps/search/?api=1&query=13.75,100.5',
    end_map_url: 'https://www.google.com/maps/search/?api=1&query=13.8,100.6',
    route_map_url: 'https://www.google.com/maps/dir/?api=1&origin=13.75,100.5&destination=13.8,100.6',
    flags: ['ODOMETER_MISMATCH', 'POOR_GPS'],
    prev_vehicle_end_odometer: 45000,
    route_error: 'HTTP_500',
    route_fetched_at: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockTripService.getTrips.mockResolvedValue(sampleTrips)
  mockTripService.getVehicles.mockResolvedValue(sampleVehicles)
  mockHrService.getEmployees.mockResolvedValue([
    { id: 'emp-1', code: 'EMP-001', first_name: 'สมชาย', last_name: 'ใจดี' },
  ])
})

describe('CarTrips (/hr/trips & /hr/vehicles)', () => {
  it('mode="trips" renders trips, flags, Google Maps links, without internal tab bar, and passes filter params to API', async () => {
    render(<CarTrips mode="trips" />)

    expect(await screen.findByText('สมชาย ใจดี')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'ประวัติการใช้รถ' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'บันทึกการเดินทาง' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'รถบริษัท' })).toBeNull()

    expect(screen.getByText('ระยะไมล์ต่างจากแผนที่ >20%')).toBeTruthy()
    expect(screen.getByText('ความแม่นยำ GPS ต่ำ (>150 ม.)')).toBeTruthy()
    expect(screen.getByText('คำนวณแผนที่ไม่สำเร็จ')).toBeTruthy()

    const routeLink = screen.getByRole('link', { name: 'เส้นทาง' }) as HTMLAnchorElement
    expect(routeLink.getAttribute('href')).toBe(sampleTrips[0].route_map_url)
    expect(routeLink.getAttribute('target')).toBe('_blank')
    expect(routeLink.getAttribute('rel')).toBe('noopener noreferrer')

    expect(screen.getByRole('link', { name: 'จุดแวะ 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'จุดจบ' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ลบ/ })).toBeNull()

    // Filter by flaggedOnly checkbox
    fireEvent.click(screen.getByLabelText('เฉพาะรายการผิดปกติ'))
    await waitFor(() => {
      expect(mockTripService.getTrips).toHaveBeenLastCalledWith(
        expect.objectContaining({ flagged: 1 })
      )
    })
  })

  it('calls retryRoute when clicking คำนวณใหม่ and updates the row', async () => {
    mockTripService.retryRoute.mockResolvedValue({
      ...sampleTrips[0],
      route_status: 'OK',
      map_distance_km: 29.4,
      map_duration_sec: 2400,
      flags: [],
      route_error: null,
    })

    render(<CarTrips mode="trips" />)

    const retryBtn = await screen.findByRole('button', { name: 'คำนวณใหม่' })
    const row = retryBtn.closest('tr')!
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(mockTripService.retryRoute).toHaveBeenCalledWith('trip-1')
    })

    expect(await within(row).findByText('29.4 กม.')).toBeTruthy()
    expect(within(row).getByText('คำนวณแล้ว')).toBeTruthy()
  })

  it('mode="vehicles" renders company vehicles table and add/edit modal without calling getTrips', async () => {
    mockTripService.createVehicle.mockResolvedValue({
      ...sampleVehicles[0],
      id: 'veh-2',
      plate_no: 'ขข 5678',
      label: 'Isuzu D-Max',
      last_end_odometer: null,
    })
    mockTripService.updateVehicle.mockResolvedValue({
      ...sampleVehicles[0],
      is_active: false,
    })

    render(<CarTrips mode="vehicles" />)

    expect(await screen.findByRole('heading', { name: 'รถของบริษัท' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'บันทึกการเดินทาง' })).toBeNull()
    expect(mockTripService.getTrips).not.toHaveBeenCalled()
    expect(mockHrService.getEmployees).not.toHaveBeenCalled()

    expect(await screen.findByText('กก 1234')).toBeTruthy()
    expect(screen.getByText('45,120')).toBeTruthy()

    // Create vehicle
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรถบริษัท' }))
    fireEvent.change(screen.getByLabelText(/ทะเบียนรถ/), { target: { value: 'ขข 5678' } })
    fireEvent.change(screen.getByLabelText(/ชื่อเรียก/), { target: { value: 'Isuzu D-Max' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockTripService.createVehicle).toHaveBeenCalledWith({
        plate_no: 'ขข 5678',
        label: 'Isuzu D-Max',
        notes: null,
      })
    })

    // Edit existing vehicle
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }))
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: 'เข้าศูนย์เดือนหน้า' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockTripService.updateVehicle).toHaveBeenCalledWith('veh-1', {
        plate_no: 'กก 1234',
        label: 'Toyota Hilux',
        notes: 'เข้าศูนย์เดือนหน้า',
        is_active: true,
      })
    })
  })
})
