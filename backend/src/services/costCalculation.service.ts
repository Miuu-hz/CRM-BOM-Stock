/**
 * Cost Calculation Service
 * คำนวณต้นทุนการผลิตจาก BOM (Bill of Materials)
 */

export interface Material {
  id?: string
  name: string
  quantity: number
  unit?: string
  unitCost?: number
  unitPrice?: number // Alias for unitCost for flexibility
}

export interface BOMItem {
  id: string
  productId: string
  productName: string
  version: string
  materials: Material[]
  operatingCost?: number // ค่าแรง, ค่าไฟ, overhead
  scrapValue?: number // มูลค่าของเสีย
}

export interface CostBreakdown {
  rawMaterialCost: number
  operatingCost: number
  scrapValue: number
  totalCost: number
  costPerUnit: number
}

/**
 * คำนวณต้นทุนวัตถุดิบทั้งหมดจาก BOM
 */
export function calculateRawMaterialCost(materials: Material[]): number {
  return materials.reduce((total, material) => {
    const cost = material.unitCost || material.unitPrice || 0
    return total + (material.quantity * cost)
  }, 0)
}

/**
 * คำนวณต้นทุนการผลิตรวม
 * สูตร: Total Cost = Raw Material Cost + Operating Cost - Scrap Value
 */
export function calculateTotalProductionCost(bom: BOMItem): CostBreakdown {
  const rawMaterialCost = calculateRawMaterialCost(bom.materials)
  const operatingCost = bom.operatingCost || 0
  const scrapValue = bom.scrapValue || 0

  const totalCost = rawMaterialCost + operatingCost - scrapValue

  return {
    rawMaterialCost,
    operatingCost,
    scrapValue,
    totalCost,
    costPerUnit: totalCost, // สำหรับการผลิต 1 unit
  }
}

/**
 * คำนวณต้นทุนสำหรับการผลิตหลายชิ้น
 */
export function calculateBatchCost(
  bom: BOMItem,
  quantity: number
): CostBreakdown {
  const singleUnitCost = calculateTotalProductionCost(bom)

  return {
    ...singleUnitCost,
    totalCost: singleUnitCost.totalCost * quantity,
    costPerUnit: singleUnitCost.totalCost,
  }
}

/**
 * คำนวณต้นทุนแบบ Multi-level BOM (BOM ที่มีหลายชั้น)
 * ใช้ Post-order Traversal Algorithm
 */
export interface NestedBOM extends BOMItem {
  children?: NestedBOM[]
}

export function calculateNestedBOMCost(bom: NestedBOM): number {
  let totalCost = 0

  // 1. คำนวณต้นทุนของ child components ก่อน (Bottom-up)
  if (bom.children && bom.children.length > 0) {
    bom.children.forEach(child => {
      const childCost = calculateNestedBOMCost(child)
      // คูณด้วยจำนวนที่ต้องใช้
      const childMaterial = bom.materials.find(m => m.id === child.productId)
      const quantity = childMaterial?.quantity || 1
      totalCost += childCost * quantity
    })
  }

  // 2. บวกต้นทุนวัตถุดิบที่ระดับนี้
  totalCost += calculateRawMaterialCost(bom.materials)

  // 3. บวกค่าดำเนินการ
  totalCost += bom.operatingCost || 0

  // 4. หักมูลค่าของเสีย
  totalCost -= bom.scrapValue || 0

  return totalCost
}
