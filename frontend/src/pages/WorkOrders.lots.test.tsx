import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecordLotModal, WODetailModal } from './WorkOrders'
import workOrderService, { type WorkOrder } from '../services/workOrder'
import toast from 'react-hot-toast'

vi.mock('../services/workOrder', () => ({
  default: {
    getById: vi.fn(),
    recordLot: vi.fn(),
    updateStatus: vi.fn(),
  },
}))

vi.mock('../services/subcontract', () => ({
  default: {
    getAll: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      if (!opts) return key
      return `${key}:${JSON.stringify(opts)}`
    },
  }),
}))

vi.mock('../hooks/useModalClose', () => ({
  useModalClose: vi.fn(),
}))

vi.mock('../hooks/useUnits', () => ({
  unitLabel: (u: string) => u,
}))

const baseWO: WorkOrder = {
  id: 'wo-1',
  wo_number: 'WO-2026-00001',
  bom_id: 'bom-1',
  product_id: 'fg-1',
  product_name: 'หมอนข้าง',
  quantity: 10,
  unit: 'pcs',
  completed_qty: 4,
  scrap_qty: 0,
  produced_qty: 4,
  lot_scrap_qty: 0,
  remaining_qty: 6,
  status: 'IN_PROGRESS',
  priority: 'NORMAL',
  start_date: '2026-11-25',
  due_date: '2026-11-30',
  completed_date: null,
  assigned_to: 'ทีมเย็บ',
  notes: '',
  estimated_cost: 100,
  actual_cost: 40,
  created_at: '2026-11-25T00:00:00Z',
  materials: [
    {
      id: 'm1',
      material_id: 'mat-1',
      material_name: 'ใยโพลี',
      required_qty: 10,
      issued_qty: 4,
      unit: 'kg',
      status: 'PARTIAL',
    },
  ],
  lots: [
    {
      id: 'lot-1',
      work_order_id: 'wo-1',
      lot_number: 'WO-2026-00001-L01',
      good_qty: 4,
      scrap_qty: 0,
      material_cost: 40,
      unit_cost: 10,
      notes: 'กะเช้า',
      recorded_by: 'staff@test.com',
      created_at: '2026-11-25T08:00:00Z',
    },
  ],
}

describe('RecordLotModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workOrderService.getById).mockResolvedValue(baseWO)
  })

  it('แสดงจำนวนคงเหลือ คำนวณวัตถุดิบตามสัดส่วน และใช้ยอดคงเหลือเมื่อกรอกเต็มส่วนที่เหลือ', async () => {
    render(<RecordLotModal wo={baseWO} onClose={vi.fn()} onRecorded={vi.fn()} />)

    await waitFor(() => {
      expect(workOrderService.getById).toHaveBeenCalledWith('wo-1')
    })

    // คงเหลือ = 6
    expect(screen.getByText('workOrders.lot.remainingQty')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()

    // กรอกของดี 3 (30% ของ 10 = 3 kg)
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '3' } })
    expect(screen.getByText(/workOrders\.lot\.previewThisLot.*"qty":"3"/)).toBeTruthy()

    // กด "ใส่ที่เหลือทั้งหมด" -> 6 -> ล็อตสุดท้ายตัดส่วนที่เหลือ (10 - 4 = 6 kg)
    fireEvent.click(screen.getByText('workOrders.lot.fillRemaining'))
    expect(screen.getByText(/workOrders\.lot\.previewThisLot.*"qty":"6"/)).toBeTruthy()
  })

  it('ตรวจ validation เมื่อ goodQty + scrapQty เกิน remainingQty และส่ง recordLot เมื่อถูกต้อง', async () => {
    const onRecorded = vi.fn()
    const onClose = vi.fn()
    vi.mocked(workOrderService.recordLot).mockResolvedValue({
      lot: { ...baseWO.lots![0], id: 'lot-2', lot_number: 'WO-2026-00001-L02', good_qty: 4, scrap_qty: 1 },
      workOrder: { ...baseWO, produced_qty: 8, lot_scrap_qty: 1, remaining_qty: 1 },
      autoCompleted: false,
      qcBlockedCompletion: null,
    })

    render(<RecordLotModal wo={baseWO} onClose={onClose} onRecorded={onRecorded} />)
    await waitFor(() => expect(workOrderService.getById).toHaveBeenCalled())

    const inputs = screen.getAllByRole('spinbutton')
    // เกินคงเหลือ (5 + 2 = 7 > 6)
    fireEvent.change(inputs[0], { target: { value: '5' } })
    fireEvent.change(inputs[1], { target: { value: '2' } })
    fireEvent.submit(inputs[0].closest('form')!)

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('workOrders.lot.errorOverRemaining'))
    expect(workOrderService.recordLot).not.toHaveBeenCalled()

    // ถูกต้อง (4 + 1 = 5 <= 6)
    fireEvent.change(inputs[0], { target: { value: '4' } })
    fireEvent.change(inputs[1], { target: { value: '1' } })
    fireEvent.submit(inputs[0].closest('form')!)

    await waitFor(() => {
      expect(workOrderService.recordLot).toHaveBeenCalledWith('wo-1', {
        goodQty: 4,
        scrapQty: 1,
        lotNumber: undefined,
        notes: undefined,
      })
      expect(onRecorded).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})

describe('WODetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('แสดงประวัติล็อตและถามยืนยัน close-short เมื่อยังมีจำนวนคงเหลือ', () => {
    const onStatusChange = vi.fn()
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <WODetailModal
        wo={baseWO}
        onClose={onClose}
        onStatusChange={onStatusChange}
        onPrint={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRecordLot={vi.fn()}
      />
    )

    expect(screen.getByText('WO-2026-00001-L01')).toBeTruthy()
    expect(screen.getByText('กะเช้า')).toBeTruthy()

    fireEvent.click(screen.getByText('workOrders.lot.closeShortButton'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith('wo-1', 'COMPLETED', { closeShort: true })
    expect(onClose).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
