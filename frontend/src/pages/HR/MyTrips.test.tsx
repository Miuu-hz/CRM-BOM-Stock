import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hrTrip.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/hrTrip.service')>()
  return {
    ...actual,
    default: {
      getMyStatus: vi.fn(),
      getMyVehicles: vi.fn(),
      acceptConsent: vi.fn(),
      startTrip: vi.fn(),
      addStop: vi.fn(),
      endTrip: vi.fn(),
      getMyTrips: vi.fn(),
    },
  }
})

import hrTripService, { CarTripBase, MyTripsStatus, TRIP_PDPA_NOTICE_TEXT } from '../../services/hrTrip.service'
import MyTrips from './MyTrips'

const mockTripService = hrTripService as unknown as {
  getMyStatus: ReturnType<typeof vi.fn>
  getMyVehicles: ReturnType<typeof vi.fn>
  acceptConsent: ReturnType<typeof vi.fn>
  startTrip: ReturnType<typeof vi.fn>
  addStop: ReturnType<typeof vi.fn>
  endTrip: ReturnType<typeof vi.fn>
  getMyTrips: ReturnType<typeof vi.fn>
}

const makeTrip = (overrides: Partial<CarTripBase> = {}): CarTripBase => ({
  id: 'trip-1',
  employee_id: 'emp-1',
  employee_code: 'EMP-001',
  employee_name: 'สมชาย ใจดี',
  vehicle_id: 'veh-1',
  car_type: 'COMPANY',
  plate_no: 'กก 1234',
  vehicle_label: 'Toyota Hilux',
  purpose: 'ส่งของลูกค้า',
  status: 'OPEN',
  started_at: '2026-11-24T08:00:00.000Z',
  start_odometer: 45000,
  start_lat: 13.75,
  start_lng: 100.5,
  start_accuracy_m: 12,
  ended_at: null,
  end_odometer: null,
  end_lat: null,
  end_lng: null,
  end_accuracy_m: null,
  odometer_km: null,
  duration_sec: null,
  map_distance_km: null,
  map_duration_sec: null,
  route_status: 'NONE',
  close_reason: null,
  stops: [],
  start_map_url: 'https://www.google.com/maps/search/?api=1&query=13.75,100.5',
  end_map_url: null,
  route_map_url: 'https://www.google.com/maps/search/?api=1&query=13.75,100.5',
  ...overrides,
})

const makeStatus = (overrides: Partial<MyTripsStatus> = {}): MyTripsStatus => ({
  consent: {
    accepted: true,
    version: '1.0',
    accepted_at: '2026-11-24T07:00:00.000Z',
    notice_text: TRIP_PDPA_NOTICE_TEXT,
  },
  open_trip: null,
  vehicles: [{ id: 'veh-1', plate_no: 'กก 1234', label: 'Toyota Hilux' }],
  max_stops: 10,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/hr/me/trips')
  mockTripService.getMyTrips.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MyTrips (/hr/me/trips)', () => {
  it('consent gate blocks start form until checkbox is checked and accepted', async () => {
    mockTripService.getMyStatus.mockResolvedValue(
      makeStatus({
        consent: {
          accepted: false,
          version: '1.0',
          accepted_at: null,
          notice_text: TRIP_PDPA_NOTICE_TEXT,
        },
      })
    )
    mockTripService.acceptConsent.mockResolvedValue({
      accepted: true,
      version: '1.0',
      accepted_at: '2026-11-24T08:00:00.000Z',
      notice_text: TRIP_PDPA_NOTICE_TEXT,
    })

    render(<MyTrips />)

    expect(await screen.findByText(TRIP_PDPA_NOTICE_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'เริ่มทริป' })).toBeNull()

    const acceptBtn = screen.getByRole('button', { name: 'ยินยอมและดำเนินการต่อ' }) as HTMLButtonElement
    expect(acceptBtn.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(acceptBtn.disabled).toBe(false)

    fireEvent.click(acceptBtn)

    await waitFor(() => {
      expect(mockTripService.acceptConsent).toHaveBeenCalledWith('1.0')
    })

    expect(await screen.findByRole('button', { name: 'เริ่มทริป' })).toBeTruthy()
  })

  it('reads high-accuracy GPS, starts trip, and displays post-start banner', async () => {
    mockTripService.getMyStatus.mockResolvedValue(makeStatus())
    mockTripService.startTrip.mockResolvedValue(makeTrip())

    const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
      success({ coords: { latitude: 13.75, longitude: 100.5, accuracy: 12 } })
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyTrips />)

    const odoInput = await screen.findByLabelText(/เลขไมล์เริ่มต้น/)
    fireEvent.change(odoInput, { target: { value: '45000' } })
    fireEvent.change(screen.getByLabelText(/วัตถุประสงค์การเดินทาง/), { target: { value: 'ส่งของลูกค้า' } })

    fireEvent.click(screen.getByRole('button', { name: 'เริ่มทริป' }))

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      )
      expect(mockTripService.startTrip).toHaveBeenCalledWith({
        car_type: 'COMPANY',
        vehicle_id: 'veh-1',
        plate_no: undefined,
        start_odometer: 45000,
        purpose: 'ส่งของลูกค้า',
        lat: 13.75,
        lng: 100.5,
        accuracy_m: 12,
      })
    })

    expect(await screen.findByText('บันทึกเริ่มทริปแล้ว — ออกเดินทางได้เลยครับ')).toBeTruthy()
    expect(screen.getAllByText('±12 ม.').length).toBeGreaterThanOrEqual(1)
  })

  it('shows Thai permission instructions and retry button when GPS permission is denied', async () => {
    mockTripService.getMyStatus.mockResolvedValue(makeStatus())
    const mockGetCurrentPosition = vi.fn().mockImplementation((_success, err) => {
      err({ code: 1, message: 'User denied Geolocation' })
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyTrips />)

    const odoInput = await screen.findByLabelText(/เลขไมล์เริ่มต้น/)
    fireEvent.change(odoInput, { target: { value: '45000' } })
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มทริป' }))

    expect(await screen.findByText('ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS)')).toBeTruthy()
    expect(screen.getByText(/บริการหาตำแหน่ง/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ลองจับพิกัดอีกครั้ง' })).toBeTruthy()
    expect(mockTripService.startTrip).not.toHaveBeenCalled()
  })

  it('disables add-stop button when trip already has 10 stops', async () => {
    const tenStops = Array.from({ length: 10 }, (_, idx) => ({
      id: `stop-${idx + 1}`,
      seq: idx + 1,
      lat: 13.75,
      lng: 100.5,
      accuracy_m: 10,
      note: `จุดที่ ${idx + 1}`,
      recorded_at: '2026-11-24T09:00:00.000Z',
      map_url: 'https://www.google.com/maps/search/?api=1&query=13.75,100.5',
    }))
    mockTripService.getMyStatus.mockResolvedValue(makeStatus({ open_trip: makeTrip({ stops: tenStops }) }))

    render(<MyTrips />)

    expect(await screen.findByText('จุดแวะ (10/10)')).toBeTruthy()
    expect(screen.getByText('แวะจุดครบสูงสุด 10 จุดแล้ว')).toBeTruthy()
    const stopBtn = screen.getByRole('button', { name: 'แวะจุด' }) as HTMLButtonElement
    expect(stopBtn.disabled).toBe(true)
  })

  it('rejects end trip when end odometer is less than start odometer without calling GPS or API', async () => {
    mockTripService.getMyStatus.mockResolvedValue(makeStatus({ open_trip: makeTrip({ start_odometer: 45000 }) }))
    const mockGetCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyTrips />)

    const endOdoInput = await screen.findByLabelText(/เลขไมล์สิ้นสุด/)
    fireEvent.change(endOdoInput, { target: { value: '44900' } })
    fireEvent.click(screen.getByRole('button', { name: 'จบทริป' }))

    expect(await screen.findByText('เลขไมล์สิ้นสุดต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น')).toBeTruthy()
    expect(mockGetCurrentPosition).not.toHaveBeenCalled()
    expect(mockTripService.endTrip).not.toHaveBeenCalled()
  })

  it('ends trip with valid odometer and GPS', async () => {
    mockTripService.getMyStatus.mockResolvedValue(makeStatus({ open_trip: makeTrip({ start_odometer: 45000 }) }))
    mockTripService.endTrip.mockResolvedValue(
      makeTrip({
        status: 'COMPLETED',
        ended_at: '2026-11-24T10:00:00.000Z',
        end_odometer: 45040,
        odometer_km: 40,
        map_distance_km: 38.5,
        duration_sec: 7200,
        route_status: 'OK',
      })
    )
    const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
      success({ coords: { latitude: 13.8, longitude: 100.6, accuracy: 15 } })
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyTrips />)

    const endOdoInput = await screen.findByLabelText(/เลขไมล์สิ้นสุด/)
    fireEvent.change(endOdoInput, { target: { value: '45040' } })
    fireEvent.click(screen.getByRole('button', { name: 'จบทริป' }))

    await waitFor(() => {
      expect(mockTripService.endTrip).toHaveBeenCalledWith('trip-1', {
        end_odometer: 45040,
        lat: 13.8,
        lng: 100.6,
        accuracy_m: 15,
      })
    })

    expect(await screen.findByText(/บันทึกจบทริปเรียบร้อยแล้ว/)).toBeTruthy()
  })

  it('renders own trips in history tab', async () => {
    mockTripService.getMyStatus.mockResolvedValue(makeStatus())
    mockTripService.getMyTrips.mockResolvedValue([
      makeTrip({
        id: 'trip-hist-1',
        status: 'COMPLETED',
        plate_no: 'ขข 9999',
        start_odometer: 1000,
        end_odometer: 1025,
        odometer_km: 25,
        map_distance_km: 24.2,
        route_status: 'OK',
      }),
    ])

    render(<MyTrips />)

    const historyTab = await screen.findByRole('button', { name: 'ประวัติทริป' })
    fireEvent.click(historyTab)

    expect(await screen.findByText('ขข 9999')).toBeTruthy()
    expect(screen.getByText('จบแล้ว')).toBeTruthy()
    expect(screen.getByText(/25\.0 กม\. \/ 24\.2 กม\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'เส้นทาง Google Maps' })).toBeTruthy()
  })
})
