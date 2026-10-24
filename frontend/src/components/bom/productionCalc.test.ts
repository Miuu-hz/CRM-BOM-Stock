import { describe, it, expect } from 'vitest'
import type { BOM } from '../../services/bom'
import {
  calculateBatches,
  adjustPrice,
  computeStockStatus,
  calculateShortage,
  computeRequirementRows,
  computeTotals,
  EPSILON,
} from './productionCalc'

describe('productionCalc — Pure calculation tests', () => {
  describe('scaling by quantity / outputQty (batches)', () => {
    it('scales batches correctly for valid inputs', () => {
      expect(calculateBatches(100, 10)).toBe(10)
      expect(calculateBatches(50, 2)).toBe(25)
      expect(calculateBatches(1, 1)).toBe(1)
    })

    it('handles outputQty <= 0 by defaulting to 1', () => {
      expect(calculateBatches(10, 0)).toBe(10)
      expect(calculateBatches(10, -5)).toBe(10)
    })

    it('returns 0 when quantity is 0 or negative', () => {
      expect(calculateBatches(0, 10)).toBe(0)
      expect(calculateBatches(-5, 10)).toBe(0)
    })
  })

  describe('4-decimal rounding of ±% adjustments', () => {
    it('rounds cheap materials (e.g. ฿0.0281) to 4 decimals instead of losing precision', () => {
      const cheapPrice = 0.0281
      // +5%: 0.0281 * 1.05 = 0.029505 -> 0.0295
      expect(adjustPrice(cheapPrice, 5)).toBe(0.0295)
      // +10%: 0.0281 * 1.1 = 0.03091 -> 0.0309
      expect(adjustPrice(cheapPrice, 10)).toBe(0.0309)
      // -10%: 0.0281 * 0.9 = 0.02529 -> 0.0253
      expect(adjustPrice(cheapPrice, -10)).toBe(0.0253)
      // -5%: 0.0281 * 0.95 = 0.026695 -> 0.0267
      expect(adjustPrice(cheapPrice, -5)).toBe(0.0267)
    })

    it('handles standard prices correctly', () => {
      // 100 + 10% = 110
      expect(adjustPrice(100, 10)).toBe(110)
      // 15.55 + 5% = 16.3275
      expect(adjustPrice(15.55, 5)).toBe(16.3275)
    })
  })

  describe('conversion factor', () => {
    it('converts recipe quantity to required stock quantity via factor', () => {
      const items = [
        {
          id: 'item-1',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-flour',
          quantity: 500, // 500 grams in recipe
          unit: 'g',
        },
      ]
      const materials = [
        {
          id: 'mat-flour',
          name: 'แป้งสาลี',
          unit: 'kg', // stock in kg
          unitCost: 40,
          currentStock: 10,
        },
      ]
      // 1 g = 0.001 kg
      const conversionFactors = {
        'mat-flour:g->kg': 0.001,
      }

      const rows = computeRequirementRows({
        items,
        batches: 2, // 2 batches = 1000g
        materials,
        boms: [],
        conversionFactors,
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].recipeQuantity).toBe(1000)
      expect(rows[0].requiredStockQty).toBe(1) // 1000 * 0.001 = 1 kg
      expect(rows[0].originalTotal).toBe(40) // 1 kg * 40 ฿/kg
    })
  })

  describe('stock status and shortage with epsilon', () => {
    it('detects shortage and status accurately', () => {
      expect(computeStockStatus(0, 10)).toBe('OUT_OF_STOCK')
      expect(computeStockStatus(5, 10)).toBe('INSUFFICIENT')
      expect(computeStockStatus(11, 10)).toBe('LOW') // < 10 * 1.2 = 12
      expect(computeStockStatus(15, 10)).toBe('OK')
    })

    it('calculates shortage accurately', () => {
      expect(calculateShortage(5, 10)).toBe(5)
      expect(calculateShortage(10, 10)).toBe(0)
      expect(calculateShortage(15, 10)).toBe(0)
    })

    it('respects float epsilon (1e-9) to prevent precision quirks', () => {
      // 0.1 + 0.2 = 0.30000000000000004
      const available = 0.3
      const required = 0.1 + 0.2
      expect(computeStockStatus(available, required)).toBe('LOW') // 0.3 is not < 0.3 within EPSILON
      expect(calculateShortage(available, required)).toBe(0)
    })

    it('sums required quantity when the same material appears twice in one BOM', () => {
      const items = [
        {
          id: 'item-1',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-sugar',
          quantity: 6,
          unit: 'kg',
        },
        {
          id: 'item-2',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-sugar',
          quantity: 6,
          unit: 'kg',
        },
      ]
      const materials = [
        {
          id: 'mat-sugar',
          name: 'น้ำตาลทราย',
          unit: 'kg',
          unitCost: 25,
          currentStock: 10, // Stock is 10 kg, total needed is 12 kg (6 + 6)
        },
      ]

      const rows = computeRequirementRows({
        items,
        batches: 1,
        materials,
        boms: [],
      })

      expect(rows).toHaveLength(2)
      // Both rows should have unique row keys
      expect(rows[0].rowKey).not.toBe(rows[1].rowKey)
      // Because total requirement is 12 kg > 10 kg available stock:
      expect(rows[0].status).toBe('INSUFFICIENT')
      expect(rows[1].status).toBe('INSUFFICIENT')
      expect(rows[0].shortage).toBe(2)
      expect(rows[1].shortage).toBe(2)
    })
  })

  describe('unconvertible row excluded from cost and can produce', () => {
    it('excludes unconvertible row from cost totals and from can produce decision', () => {
      const items = [
        {
          id: 'item-valid',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-1',
          quantity: 2,
          unit: 'kg',
        },
        {
          id: 'item-broken',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-2',
          quantity: 10,
          unit: 'box', // Cannot convert box to kg
        },
      ]
      const materials = [
        {
          id: 'mat-1',
          name: 'หมูสับ',
          unit: 'kg',
          unitCost: 100,
          currentStock: 50,
        },
        {
          id: 'mat-2',
          name: 'กล่องพิเศษ',
          unit: 'kg',
          unitCost: 200,
          currentStock: 0,
        },
      ]

      // Mark item-broken as unconvertible
      const brokenRowKey = 'mat:mat-2:item-broken'
      const rows = computeRequirementRows({
        items,
        batches: 1,
        materials,
        boms: [],
        unconvertibleKeys: { [brokenRowKey]: true },
      })

      const brokenRow = rows.find((r) => r.rowKey === brokenRowKey)
      expect(brokenRow).toBeDefined()
      expect(brokenRow?.unconvertible).toBe(true)
      expect(brokenRow?.status).toBe('UNCONVERTIBLE')
      expect(brokenRow?.originalTotal).toBe(0)

      const totals = computeTotals(rows, 1, false)
      // Cost should only include mat-1: 2 kg * 100 = 200
      expect(totals.originalTotal).toBe(200)
      expect(totals.simulatedTotal).toBe(200)
      // canProduce should be true because mat-1 is OK, and unconvertible row is excluded
      expect(totals.canProduce).toBe(true)
    })

    it('marks production as not ready when childBomShort is true', () => {
      const items = [
        {
          id: 'item-1',
          itemType: 'MATERIAL' as const,
          materialId: 'mat-1',
          quantity: 1,
          unit: 'kg',
        },
      ]
      const materials = [
        {
          id: 'mat-1',
          name: 'แป้ง',
          unit: 'kg',
          unitCost: 50,
          currentStock: 100,
        },
      ]
      const rows = computeRequirementRows({
        items,
        batches: 1,
        materials,
        boms: [],
      })
      const totals = computeTotals(rows, 1, true) // childBomShort = true
      expect(totals.canProduce).toBe(false)
    })

    it('computes child BOM rows correctly with BOM fixture', () => {
      const dummyChildBom = {
        id: 'child-1',
        productName: 'หมูสับปรุงรส',
        productCode: 'SEMI-001',
        totalCost: 50,
        outputUnit: 'กก.',
      } as unknown as BOM

      const rows = computeRequirementRows({
        items: [
          {
            id: 'item-child',
            itemType: 'CHILD_BOM' as const,
            childBomId: 'child-1',
            quantity: 2,
          },
        ],
        batches: 3,
        materials: [],
        boms: [dummyChildBom],
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].itemType).toBe('CHILD_BOM')
      expect(rows[0].recipeQuantity).toBe(6)
      expect(rows[0].originalUnitCost).toBe(50)
      expect(rows[0].originalTotal).toBe(300)
    })
  })
})
