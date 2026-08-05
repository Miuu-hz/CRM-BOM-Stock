import { describe, it, expect } from 'vitest'
import {
  calculateRawMaterialCost,
  calculateTotalProductionCost,
  calculateBatchCost,
  calculateNestedBOMCost,
  type BOMItem,
  type NestedBOM,
} from './costCalculation.service'

describe('calculateRawMaterialCost', () => {
  it('sums quantity * unitCost across materials', () => {
    const cost = calculateRawMaterialCost([
      { name: 'Flour', quantity: 2, unitCost: 15 },
      { name: 'Sugar', quantity: 1, unitCost: 20 },
    ])
    expect(cost).toBe(50)
  })

  it('falls back to unitPrice when unitCost is missing', () => {
    const cost = calculateRawMaterialCost([{ name: 'Egg', quantity: 3, unitPrice: 5 }])
    expect(cost).toBe(15)
  })

  it('treats a material with no cost fields as zero cost instead of NaN/throwing', () => {
    const cost = calculateRawMaterialCost([{ name: 'Water', quantity: 10 }])
    expect(cost).toBe(0)
  })
})

describe('calculateTotalProductionCost', () => {
  it('applies Total = RawMaterial + Operating - Scrap', () => {
    const bom: BOMItem = {
      id: 'b1', productId: 'p1', productName: 'Cake', version: '1',
      materials: [{ name: 'Flour', quantity: 2, unitCost: 15 }], // 30
      operatingCost: 10,
      scrapValue: 4,
    }
    const result = calculateTotalProductionCost(bom)
    expect(result.rawMaterialCost).toBe(30)
    expect(result.totalCost).toBe(36) // 30 + 10 - 4
    expect(result.costPerUnit).toBe(36)
  })

  it('treats missing operatingCost/scrapValue as zero', () => {
    const bom: BOMItem = {
      id: 'b1', productId: 'p1', productName: 'Plain', version: '1',
      materials: [{ name: 'Flour', quantity: 1, unitCost: 20 }],
    }
    expect(calculateTotalProductionCost(bom).totalCost).toBe(20)
  })
})

describe('calculateBatchCost', () => {
  it('multiplies single-unit total cost by batch quantity, keeps costPerUnit at single-unit price', () => {
    const bom: BOMItem = {
      id: 'b1', productId: 'p1', productName: 'Cake', version: '1',
      materials: [{ name: 'Flour', quantity: 1, unitCost: 10 }],
    }
    const result = calculateBatchCost(bom, 5)
    expect(result.totalCost).toBe(50)
    expect(result.costPerUnit).toBe(10)
  })
})

describe('calculateNestedBOMCost (multi-level BOM, bottom-up)', () => {
  it('sums child cost * quantity-used plus this level materials/operating/scrap', () => {
    const child: NestedBOM = {
      id: 'c1', productId: 'child-product', productName: 'Sub-assembly', version: '1',
      materials: [{ name: 'Sugar', quantity: 2, unitCost: 5 }], // 10
    }
    const parent: NestedBOM = {
      id: 'p1', productId: 'p1', productName: 'Parent', version: '1',
      materials: [{ id: 'child-product', name: 'Sub-assembly', quantity: 3, unitCost: 0 }],
      operatingCost: 2,
      scrapValue: 1,
      children: [child],
    }
    // child cost 10 * qty 3 = 30, + this-level materials (0) + operating 2 - scrap 1
    expect(calculateNestedBOMCost(parent)).toBe(31)
  })

  it('defaults child quantity-used to 1 when no matching material line is found', () => {
    const child: NestedBOM = {
      id: 'c1', productId: 'orphan-child', productName: 'Orphan', version: '1',
      materials: [{ name: 'X', quantity: 1, unitCost: 4 }], // childCost = 4
    }
    const parent: NestedBOM = {
      id: 'p1', productId: 'p1', productName: 'Parent', version: '1',
      materials: [],
      children: [child],
    }
    expect(calculateNestedBOMCost(parent)).toBe(4) // 4 * 1 (default qty)
  })
})
