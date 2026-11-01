import { describe, it, expect, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import posBillService from './pos-bill.service'

const mockApi = api as unknown as {
  patch: ReturnType<typeof vi.fn>
}

describe('posBillService.updateItemPrice', () => {
  it('calls PATCH /pos/bills/:billId/items/:itemId/price with unit_price and reason', async () => {
    mockApi.patch.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 'item-1',
          unit_price: 75,
          original_price: 100,
          total_price: 150,
        },
      },
    })

    const res = await posBillService.updateItemPrice('bill-1', 'item-1', {
      unit_price: 75,
      reason: 'ราคาพิเศษลูกค้าประจำ',
    })

    expect(mockApi.patch).toHaveBeenCalledWith(
      '/pos/bills/bill-1/items/item-1/price',
      { unit_price: 75, reason: 'ราคาพิเศษลูกค้าประจำ' }
    )
    expect(res.success).toBe(true)
    expect(res.data.unit_price).toBe(75)
    expect(res.data.original_price).toBe(100)
  })
})
