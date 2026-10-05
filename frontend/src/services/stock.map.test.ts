import { describe, it, expect, vi } from 'vitest'

/**
 * 2026-10-05 — stock.ts mapStockItem ไม่เคยแปลง min_stock/max_stock/gs1_barcode
 * จาก snake_case ของ backend เป็น minStock/maxStock/gs1Barcode เลย (ไม่มีบรรทัดแม็ปพวกนี้มาก่อน)
 * หน้า Stock จึงอ่าน item.minStock ได้ undefined เสมอ ป้าย "ใกล้หมด" คำนวณผิด
 * mapStockItem ไม่ได้ export ตรง ๆ — เทสต์ผ่าน stockService.getAll() ที่ mock api แทน
 * ตามแม่แบบ ApprovalSettings.test.tsx / SourceDocSection.test.tsx
 */
vi.mock('../services/api', () => ({
  default: { get: vi.fn() },
  postWithAliasCheck: vi.fn(),
}))

import api from '../services/api'
import stockService from './stock'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

describe('stock.ts mapStockItem — min_stock/max_stock/gs1_barcode', () => {
  it('แปลง min_stock/max_stock เป็นตัวเลข และ gs1_barcode เป็น gs1Barcode', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'si-1',
          sku: 'SKU-1',
          name: 'สินค้าทดสอบ',
          category: 'raw',
          quantity: 50,
          unit: 'pcs',
          min_stock: '10',
          max_stock: '1000',
          gs1_barcode: '8851234567890',
          location: 'A1',
          status: 'active',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        }],
      },
    })

    const [item] = await stockService.getAll()

    expect(item.minStock).toBe(10)
    expect(item.maxStock).toBe(1000)
    expect(typeof item.minStock).toBe('number')
    expect(typeof item.maxStock).toBe('number')
    expect(item.gs1Barcode).toBe('8851234567890')
  })
})
