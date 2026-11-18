import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProduceShortfallDialog } from './ProduceShortfallDialog'
import salesService, { type ProductionPlan } from '../../services/sales.service'

vi.mock('../../services/sales.service', () => ({
  default: {
    getProductionPlan: vi.fn(),
    produceShortfall: vi.fn(),
    updateSOStatus: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('ProduceShortfallDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders blockers in warning box and disables button when plan.ok is false', () => {
    const blockedPlan: ProductionPlan = {
      ok: false,
      allowNegativeStock: false,
      items: [
        {
          soItemId: 'so-item-1',
          stockItemId: 'stock-item-1',
          name: 'ที่นอนยางพารา 6 ฟุต',
          unit: 'หลัง',
          orderedQty: 5,
          stockQty: 2,
          shortQty: 3,
          produceQty: 3,
          bomId: null,
          problem: 'ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน',
        },
      ],
      materials: [
        {
          materialId: 'mat-1',
          name: 'น้ำยางพาราข้น',
          unit: 'kg',
          requiredQty: 60,
          stockQty: 20,
          shortQty: 40,
          problem: null,
        },
      ],
      blockers: [
        'ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน สำหรับ ที่นอนยางพารา 6 ฟุต',
        'วัตถุดิบ น้ำยางพาราข้น ไม่เพียงพอ (ขาด 40 kg)',
      ],
    }

    render(
      <ProduceShortfallDialog
        salesOrderId="so-1"
        soNumber="SO-2026-0001"
        onClose={vi.fn()}
        initialPlan={blockedPlan}
      />
    )

    // Check warning box and blockers
    expect(screen.getByText('ไม่สามารถสั่งผลิตอัตโนมัติได้')).toBeTruthy()
    expect(
      screen.getByText('ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน สำหรับ ที่นอนยางพารา 6 ฟุต')
    ).toBeTruthy()
    expect(
      screen.getByText('วัตถุดิบ น้ำยางพาราข้น ไม่เพียงพอ (ขาด 40 kg)')
    ).toBeTruthy()

    // Check tables rendered
    expect(screen.getByText('สินค้าที่ต้องผลิต')).toBeTruthy()
    expect(screen.getByText('ที่นอนยางพารา 6 ฟุต')).toBeTruthy()
    expect(screen.getByText('ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน')).toBeTruthy()

    expect(screen.getByText('วัตถุดิบที่ต้องใช้')).toBeTruthy()
    expect(screen.getByText('น้ำยางพาราข้น')).toBeTruthy()
    expect(screen.getByText('ไม่พอ')).toBeTruthy()

    // Check button is disabled
    const submitBtn = screen.getByRole('button', { name: /สั่งผลิตและยืนยันใบขาย/ }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)
  })

  it('renders tables and enables button when plan.ok is true', () => {
    const okPlan: ProductionPlan = {
      ok: true,
      allowNegativeStock: false,
      items: [
        {
          soItemId: 'so-item-2',
          stockItemId: 'stock-item-2',
          name: 'ผ้าปูที่นอน King Size',
          unit: 'ผืน',
          orderedQty: 10,
          stockQty: 4,
          shortQty: 6,
          produceQty: 6,
          bomId: 'bom-1',
          problem: null,
        },
      ],
      materials: [
        {
          materialId: 'mat-cotton',
          name: 'ผ้าคอตตอน 100%',
          unit: 'm',
          requiredQty: 30,
          stockQty: 50,
          shortQty: 0,
          problem: null,
        },
      ],
      blockers: [],
    }

    render(
      <ProduceShortfallDialog
        salesOrderId="so-2"
        soNumber="SO-2026-0002"
        onClose={vi.fn()}
        initialPlan={okPlan}
      />
    )

    // Check no warning box
    expect(screen.queryByText('ไม่สามารถสั่งผลิตอัตโนมัติได้')).toBeNull()

    // Check tables rendered
    expect(screen.getByText('ผ้าปูที่นอน King Size')).toBeTruthy()
    expect(screen.getByText('ผ้าคอตตอน 100%')).toBeTruthy()
    expect(screen.getByText('พอ')).toBeTruthy()

    // Check button is enabled
    const submitBtn = screen.getByRole('button', { name: /สั่งผลิตและยืนยันใบขาย/ }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(false)
  })

  it('loads production plan via API when initialPlan is not provided', async () => {
    const apiPlan: ProductionPlan = {
      ok: true,
      allowNegativeStock: false,
      items: [
        {
          soItemId: 'so-item-3',
          stockItemId: 'stock-item-3',
          name: 'หมอนหนุนใยสังเคราะห์',
          unit: 'ใบ',
          orderedQty: 2,
          stockQty: 0,
          shortQty: 2,
          produceQty: 2,
          bomId: 'bom-pillow',
          problem: null,
        },
      ],
      materials: [],
      blockers: [],
    }

    vi.mocked(salesService.getProductionPlan).mockResolvedValueOnce(apiPlan)

    render(
      <ProduceShortfallDialog
        salesOrderId="so-3"
        soNumber="SO-2026-0003"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('หมอนหนุนใยสังเคราะห์')).toBeTruthy()
    })

    const submitBtn = screen.getByRole('button', { name: /สั่งผลิตและยืนยันใบขาย/ }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(false)
  })
})
