import { describe, it, expect } from 'vitest'
import { calcWht, buildPurchaseRequestPayload } from './purchaseHelpers'

describe('calcWht', () => {
  it('rounds to satang', () => {
    expect(calcWht(1234.56, 3)).toBe(37.04)
    expect(calcWht(1070, 3)).toBe(32.1)
    expect(calcWht(0, 3)).toBe(0)
  })
})

describe('buildPurchaseRequestPayload', () => {
  it('sends camelCase fields the backend reads', () => {
    const p = buildPurchaseRequestPayload({
      department: 'A', required_date: '2026-11-01', priority: 'NORMAL', notes: '',
      items: [{ material_id: 'm1', description: 'x', quantity: 10, unit: 'kg', estimated_unit_price: 50, notes: '' },
        { material_id: '', description: '', quantity: 1, unit: '', estimated_unit_price: 0, notes: '' }],
    })
    expect(p.requiredDate).toBe('2026-11-01')
    expect(p.items).toHaveLength(1)
    expect(p.items[0]).toMatchObject({ materialId: 'm1', estimatedUnitPrice: 50, estimatedTotalPrice: 500 })
    expect(JSON.stringify(p)).not.toMatch(/_/)
  })
})
