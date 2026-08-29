import db from '../db/sqlite'
import { convertQuantityBidirectional, autoUnpackIfNeeded } from './unitConversion.service'
import { roundQty } from '../utils/qty'

// Helper: Generate ID (24-char hex)
const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

const now = () => new Date().toISOString()

class StockDeductionError extends Error {
  constructor(message: string, public issues: any[]) {
    super(message)
  }
}

export interface StockCheckResult {
  menuId: string
  menuName: string
  requestedQty: number
  canFulfill: boolean
  maxAvailable: number
  ingredients: IngredientStockCheck[]
}

export interface IngredientStockCheck {
  ingredientId: string
  stockItemId: string
  stockItemName: string
  unit: string
  quantityUsed: number
  requiredQty: number
  currentStock: number
  sufficient: boolean
  canMake: number
}

class POSStockService {
  /**
   * Check stock availability for a menu item
   */
  async checkStockAvailability(
    menuId: string,
    requestedQty: number = 1,
    tenantId: string
  ): Promise<StockCheckResult> {
    // Get menu details with BOM info + sale_unit
    const menuStmt = db.prepare(`
      SELECT pmc.*, p.name as product_name,
             si.base_unit as stock_base_unit, si.unit as stock_unit
      FROM pos_menu_configs pmc
      JOIN products p ON pmc.product_id = p.id
      LEFT JOIN stock_items si ON pmc.product_id = si.id AND pmc.tenant_id = si.tenant_id
      WHERE pmc.id = ? AND pmc.tenant_id = ?
    `)
    const menu = menuStmt.get(menuId, tenantId) as any

    if (!menu) {
      throw new Error('Menu not found')
    }

    // Get ingredients - ใช้ BOM items ถ้ามี bom_id
    let ingredients: any[] = []
    
    if (menu.bom_id) {
      // ดึงวัตถุดิบจาก BOM items
      const ingStmt = db.prepare(`
        SELECT 
          bi.id as ingredient_id,
          bi.material_id as stock_item_id,
          bi.quantity as quantity_used,
          bi.unit as ingredient_unit,
          si.name as stock_item_name,
          si.quantity as current_stock,
          si.unit as stock_unit,
          si.base_unit as stock_base_unit,
          0 as is_optional
        FROM bom_items bi
        JOIN stock_items si ON bi.material_id = si.id
        WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
      `)
      ingredients = ingStmt.all(menu.bom_id, tenantId) as any[]
    } else {
      // ใช้ pos_menu_ingredients (แบบเก่า)
      const ingStmt = db.prepare(`
        SELECT 
          pmi.id as ingredient_id,
          pmi.stock_item_id,
          pmi.quantity_used,
          pmi.unit_id,
          pmi.is_optional,
          si.name as stock_item_name,
          si.quantity as current_stock,
          si.unit as stock_unit,
          si.base_unit as stock_base_unit
        FROM pos_menu_ingredients pmi
        JOIN stock_items si ON pmi.stock_item_id = si.id
        WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
      `)
      ingredients = ingStmt.all(menuId, tenantId) as any[]
    }

    // Calculate max available quantity
    let maxAvailable = Infinity
    const stockDetails: IngredientStockCheck[] = ingredients.map((ing) => {
      const stockBaseUnit = ing.stock_base_unit || ing.stock_unit
      const ingredientUnit = ing.ingredient_unit || ing.unit_id || stockBaseUnit
      
      // Convert ingredient quantity to stock base unit if needed
      let quantityUsedInBase = Number(ing.quantity_used)
      if (ingredientUnit && ingredientUnit !== stockBaseUnit) {
        const conversion = convertQuantityBidirectional(
          Number(ing.quantity_used),
          ingredientUnit,
          stockBaseUnit,
          tenantId,
          ing.stock_item_id
        )
        if (conversion) {
          quantityUsedInBase = conversion.converted
        } else {
          console.warn(`[qty] POS stock check: no conversion ${ingredientUnit} → ${stockBaseUnit} for stock item ${ing.stock_item_id}; availability is unreliable`)
        }
      }

      const requiredQty = quantityUsedInBase * requestedQty
      const available = ing.current_stock || 0
      const canMake = quantityUsedInBase > 0 
        ? Math.floor(available / quantityUsedInBase) 
        : Infinity

      if (!ing.is_optional && canMake < maxAvailable) {
        maxAvailable = canMake
      }

      return {
        ingredientId: ing.ingredient_id,
        stockItemId: ing.stock_item_id,
        stockItemName: ing.stock_item_name,
        unit: stockBaseUnit,
        quantityUsed: quantityUsedInBase,
        requiredQty,
        currentStock: available,
        sufficient: available >= requiredQty,
        canMake
      }
    })

    if (maxAvailable === Infinity) maxAvailable = 999

    return {
      menuId,
      menuName: menu.product_name,
      requestedQty,
      canFulfill: maxAvailable >= requestedQty,
      maxAvailable,
      ingredients: stockDetails
    }
  }

  /**
   * Deduct stock when payment is processed
   */
  async deductStockOnPayment(
    billId: string,
    tenantId: string,
    userId: string
  ): Promise<{ success: boolean; deductions: any[]; errors: string[]; issues?: any[] }> {
    const deductions: any[] = []

    try {
      // Check tenant setting: pos_bom_deduct (default ON)
      const setting = db.prepare('SELECT pos_bom_deduct, allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
      const bomDeductEnabled = !setting || setting.pos_bom_deduct !== 0
      if (!bomDeductEnabled) {
        return { success: true, deductions: [], errors: [] }
      }
      // When enabled, oversell is allowed: still deduct (stock/quantity can go
      // negative) instead of blocking payment for missing product/material.
      const allowNegativeStock = !!setting && setting.allow_negative_stock === 1

      // Get bill details
      const billStmt = db.prepare(`
        SELECT bill_number, display_name 
        FROM pos_running_bills 
        WHERE id = ? AND tenant_id = ?
      `)
      const bill = billStmt.get(billId, tenantId) as any

      if (!bill) {
        throw new Error('Bill not found')
      }

      // Get all items with menu config (including bom_id and product_id)
      // เพิ่ม pmc.sale_unit + si.base_unit/si.unit ของ product เอง เพราะเคสเมนูไม่มีสูตร
      // (ingredients ว่าง) ด้านล่างต้องใช้ค่าจริงเหล่านี้ ไม่งั้น fallback 'pcs' จะบังคับ
      // ปลายทางผิดหน่วยเงียบๆ — bug เดิม: pos_bill_items ไม่มีคอลัมน์ sale_unit เลย (bi.*
      // ไม่มีติดมา) และ pmc.sale_unit ก็ไม่เคยถูก select ทำให้ item.sale_unit เป็น
      // undefined เสมอ โดยไม่มี error ใดๆ เตือน
      const itemsStmt = db.prepare(`
        SELECT bi.*, pmc.id as menu_config_id, pmc.bom_id, pmc.product_id,
               pmc.sale_unit as menu_sale_unit,
               si.base_unit as product_base_unit, si.unit as product_stock_unit
        FROM pos_bill_items bi
        JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
        LEFT JOIN stock_items si ON pmc.product_id = si.id AND pmc.tenant_id = si.tenant_id
        WHERE bi.bill_id = ? AND bi.tenant_id = ?
      `)
      const items = itemsStmt.all(billId, tenantId) as any[]

      const issues: any[] = []

      // ponytail: run all stock checks + updates in one transaction so concurrent
      // payments cannot over-deduct the same stock row.
      const deductTransaction = db.transaction(() => {
        for (const item of items) {
          // Get ingredients - ใช้ BOM ถ้ามี bom_id ไม่งันใช้ pos_menu_ingredients
          let ingredients: any[] = []

          if (item.bom_id) {
            const ingStmt = db.prepare(`
              SELECT
                bi.id,
                bi.material_id as stock_item_id,
                bi.quantity as quantity_used,
                bi.unit as ingredient_unit,
                si.base_unit as stock_base_unit,
                si.unit as stock_unit
              FROM bom_items bi
              JOIN stock_items si ON bi.material_id = si.id
              WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
            `)
            ingredients = ingStmt.all(item.bom_id, tenantId) as any[]
          } else {
            const ingStmt = db.prepare(`
              SELECT 
                pmi.*,
                si.base_unit as stock_base_unit,
                si.unit as stock_unit
              FROM pos_menu_ingredients pmi
              JOIN stock_items si ON pmi.stock_item_id = si.id
              WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
            `)
            ingredients = ingStmt.all(item.pos_menu_id, tenantId) as any[]
          }

          // เมนูไม่มีสูตร (ไม่มี BOM/pos_menu_ingredients) → ตัดสต็อกตรงจาก product เอง
          // ต้องแนบ stock_base_unit/stock_unit จริงมาด้วย ไม่งั้นบรรทัด stockBaseUnit
          // ด้านล่างจะ fallback ไปเป็น 'pcs' เสมอ ทำให้แปลงหน่วยผิดเป้าหมายเงียบๆ เมื่อ
          // base_unit จริงไม่ใช่ pcs (เช่น ML สำหรับวิปครีม ING-WPC)
          const saleUnit = item.menu_sale_unit || null
          if (ingredients.length === 0 && item.product_id) {
            ingredients = [{
              stock_item_id: item.product_id,
              quantity_used: 1,
              unit_id: saleUnit,
              stock_base_unit: item.product_base_unit || null,
              stock_unit: item.product_stock_unit || null
            }]
          }

          for (const ing of ingredients) {
            const stockBaseUnit = ing.stock_base_unit || ing.stock_unit || 'pcs'
            const ingredientUnit = ing.ingredient_unit || ing.unit_id || stockBaseUnit

            let deductQtyInBase = Number(ing.quantity_used) * item.quantity
            if (ingredientUnit && ingredientUnit !== stockBaseUnit) {
              const conversion = convertQuantityBidirectional(
                Number(ing.quantity_used) * item.quantity,
                ingredientUnit,
                stockBaseUnit,
                tenantId,
                ing.stock_item_id
              )
              if (conversion) {
                deductQtyInBase = conversion.converted
              } else {
                const s = db.prepare('SELECT id, name FROM stock_items WHERE id = ?').get(ing.stock_item_id) as any
                issues.push({
                  type: 'UNIT_CONVERSION_MISSING',
                  itemName: item.product_name || 'Unknown',
                  stockItemId: ing.stock_item_id,
                  stockItemName: s?.name || 'Unknown',
                  need: deductQtyInBase,
                  have: 0,
                  unit: stockBaseUnit,
                  action: 'SET_UNIT_CONVERSION',
                  link: '/settings/unit-conversion',
                  message: `ไม่พบการแปลงหน่วย ${ingredientUnit} → ${stockBaseUnit} สำหรับ "${s?.name || ing.stock_item_id}" กรุณาตั้งค่า Unit Conversion ก่อน (ยังไม่ได้ตัดสต็อกรายการนี้)`
                })
                continue
              }
            }

            const stockStmt = db.prepare('SELECT id, quantity, sealed_qty, name, base_unit, unit, display_unit FROM stock_items WHERE id = ?')
            let stock = stockStmt.get(ing.stock_item_id) as any

            if (stock && stock.quantity < deductQtyInBase && (stock.sealed_qty ?? 0) > 0) {
              const unpackResult = autoUnpackIfNeeded(stock, deductQtyInBase, tenantId)
              if (unpackResult && unpackResult.unpackedPacks > 0) {
                // roundQty กันเศษ floating-point ตอน packFactor เป็นทศนิยม (หน่วยต่อเนื่อง)
                const gained = roundQty(unpackResult.packFactor * unpackResult.unpackedPacks)
                const unpackUpdate = db.prepare(`
                  UPDATE stock_items
                  SET quantity = quantity + ?, sealed_qty = sealed_qty - ?, updated_at = ?
                  WHERE id = ? AND tenant_id = ?
                `)
                unpackUpdate.run(gained, unpackResult.unpackedPacks, now(), ing.stock_item_id, tenantId)
                // บันทึก UNPACK movement ให้ตรงกับจุดอื่น (เดิมจุดนี้ไม่ได้บันทึกเลย ทำให้
                // ยอดแกะแพ็คของ POS หายไปจากรายงาน stock_movements)
                db.prepare(`
                  INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_by, created_at)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  generateId(), tenantId, ing.stock_item_id, gained, stock.display_unit || null, unpackResult.unpackedPacks,
                  bill.bill_number, `แกะอัตโนมัติ (POS) ${unpackResult.unpackedPacks} ${stock.display_unit || ''} → ${gained} ${stockBaseUnit}`,
                  userId, now()
                )
                stock = stockStmt.get(ing.stock_item_id) as any
              }
            }

            if (!stock) {
              const issue = {
                type: 'INSUFFICIENT_STOCK',
                itemName: item.product_name || 'Unknown',
                stockItemId: ing.stock_item_id,
                stockItemName: 'Unknown',
                need: deductQtyInBase,
                have: 0,
                unit: stockBaseUnit,
                action: 'RESTOCK',
                link: null,
                message: `ไม่พบรายการสต็อกนี้ในระบบ (ยังไม่ได้ตัดสต็อกรายการนี้)`
              }
              issues.push(issue)
              continue
            }

            if (stock.quantity < deductQtyInBase && !allowNegativeStock) {
              const issue = {
                type: 'INSUFFICIENT_STOCK',
                itemName: item.product_name || 'Unknown',
                stockItemId: stock.id,
                stockItemName: stock.name || 'Unknown',
                need: deductQtyInBase,
                have: stock.quantity || 0,
                unit: stockBaseUnit,
                action: 'RESTOCK',
                link: `/stock/${stock.id}/edit`,
                message: `${stock.name || 'Unknown'} ไม่พอ (ต้องการ ${deductQtyInBase} ${stockBaseUnit} มี ${stock.quantity || 0} ${stock.base_unit || stock.unit || stockBaseUnit})`
              }
              issues.push(issue)
              continue
            }

            const updateStock = db.prepare(`
              UPDATE stock_items 
              SET quantity = quantity - ?, updated_at = ?
              WHERE id = ? AND tenant_id = ?
            `)
            updateStock.run(deductQtyInBase, now(), ing.stock_item_id, tenantId)

            const movementId = generateId()
            const movementStmt = db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_by, created_at)
              VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?)
            `)
            movementStmt.run(
              movementId,
              tenantId,
              ing.stock_item_id,
              deductQtyInBase,
              ingredientUnit,
              Number(ing.quantity_used) * item.quantity,
              bill.bill_number,
              `POS Sale - ${item.product_name}`,
              userId,
              now()
            )

            const deductId = generateId()
            const deductStmt = db.prepare(`
              INSERT INTO pos_stock_deductions (id, tenant_id, bill_item_id, stock_item_id, quantity_deducted, unit_id, deducted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            deductStmt.run(
              deductId,
              tenantId,
              item.id,
              ing.stock_item_id,
              deductQtyInBase,
              ing.unit_id || null,
              now()
            )

            deductions.push({
              deductionId: deductId,
              stockItemId: ing.stock_item_id,
              stockItemName: stock.name,
              quantityDeducted: deductQtyInBase,
              remainingStock: stock.quantity - deductQtyInBase
            })
          }
        }

        if (issues.length > 0) {
          throw new StockDeductionError('Insufficient stock for one or more items', issues)
        }
      })

      deductTransaction()

      return {
        success: issues.length === 0,
        deductions,
        errors: issues.map((i: any) => i.message),
        issues
      }
    } catch (error: any) {
      if (error instanceof StockDeductionError) {
        return {
          success: false,
          deductions,
          errors: error.issues.map((i: any) => i.message),
          issues: error.issues
        }
      }
      return {
        success: false,
        deductions,
        errors: [error.message || 'Unknown error occurred'],
        issues: [{ type: 'UNKNOWN_ERROR', message: error.message || 'Unknown error occurred' }]
      }
    }
  }

  /**
   * Return stock when bill is cancelled
   */
  async returnStockOnCancel(
    billId: string,
    tenantId: string,
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; returns: any[]; errors: string[] }> {
    try {
      // Get bill info
      const billStmt = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ?')
      const bill = billStmt.get(billId) as any

      if (!bill) {
        throw new Error('Bill not found')
      }

      // Get all deductions for this bill
      const deductionsStmt = db.prepare(`
        SELECT psd.*, bi.product_name
        FROM pos_stock_deductions psd
        JOIN pos_bill_items bi ON psd.bill_item_id = bi.id
        WHERE bi.bill_id = ? AND psd.returned = 0
      `)
      const deductions = deductionsStmt.all(billId) as any[]

      const returns: any[] = []

      // ponytail: return all stock atomically; partial failures roll back.
      const returnTransaction = db.transaction(() => {
        for (const deduction of deductions) {
          const returnStock = db.prepare(`
            UPDATE stock_items 
            SET quantity = quantity + ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?
          `)
          returnStock.run(deduction.quantity_deducted, now(), deduction.stock_item_id, tenantId)

          const movementId = generateId()
          const movementStmt = db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_by, created_at)
            VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, ?)
          `)
          movementStmt.run(
            movementId,
            tenantId,
            deduction.stock_item_id,
            deduction.quantity_deducted,
            bill.bill_number,
            `Cancelled - ${deduction.product_name}${reason ? ': ' + reason : ''}`,
            userId,
            now()
          )

          const markReturned = db.prepare(`
            UPDATE pos_stock_deductions 
            SET returned = 1, returned_at = ? 
            WHERE id = ?
          `)
          markReturned.run(now(), deduction.id)

          returns.push({
            deductionId: deduction.id,
            stockItemId: deduction.stock_item_id,
            quantityReturned: deduction.quantity_deducted
          })
        }
      })

      returnTransaction()

      return {
        success: true,
        returns,
        errors: []
      }
    } catch (error: any) {
      return {
        success: false,
        returns: [],
        errors: [error.message || 'Unknown error occurred']
      }
    }
  }

  /**
   * Get low stock items (for alerting) - รองรับทั้ง BOM และ pos_menu_ingredients
   */
  async getLowStockMenus(tenantId: string): Promise<any[]> {
    // ดึงข้อมูลจาก BOM
    const bomStmt = db.prepare(`
      SELECT 
        pmc.id as menu_id,
        p.name as product_name,
        pmc.pos_price,
        si.id as stock_item_id,
        si.name as stock_item_name,
        si.quantity as current_stock,
        si.min_stock
      FROM pos_menu_configs pmc
      JOIN products p ON pmc.product_id = p.id
      JOIN bom_items bi ON pmc.bom_id = bi.bom_id
      JOIN stock_items si ON bi.material_id = si.id
      WHERE pmc.tenant_id = ? 
        AND pmc.is_available = 1
        AND pmc.bom_id IS NOT NULL
        AND bi.item_type = 'MATERIAL'
        AND si.quantity <= si.min_stock
      ORDER BY si.quantity / si.min_stock ASC
    `)
    
    const bomResults = bomStmt.all(tenantId)
    
    // ดึงข้อมูลจาก pos_menu_ingredients (สำหรับเมนูที่ไม่มี BOM)
    const ingStmt = db.prepare(`
      SELECT 
        pmc.id as menu_id,
        p.name as product_name,
        pmc.pos_price,
        si.id as stock_item_id,
        si.name as stock_item_name,
        si.quantity as current_stock,
        si.min_stock
      FROM pos_menu_configs pmc
      JOIN products p ON pmc.product_id = p.id
      JOIN pos_menu_ingredients pmi ON pmc.id = pmi.pos_menu_id
      JOIN stock_items si ON pmi.stock_item_id = si.id
      WHERE pmc.tenant_id = ? 
        AND pmc.is_available = 1
        AND pmc.bom_id IS NULL
        AND pmi.is_optional = 0
        AND si.quantity <= si.min_stock
      ORDER BY si.quantity / si.min_stock ASC
    `)
    
    const ingResults = ingStmt.all(tenantId)
    
    return [...bomResults, ...ingResults]
  }

  /**
   * Get stock level for a menu (how many can be made)
   */
  async getMenuStockLevel(menuId: string, tenantId: string): Promise<number> {
    // ตรวจว่ามี BOM หรือไม่
    const menuStmt = db.prepare('SELECT bom_id FROM pos_menu_configs WHERE id = ? AND tenant_id = ?')
    const menu = menuStmt.get(menuId, tenantId) as any
    
    let ingredients: any[] = []
    
    if (menu?.bom_id) {
      // ดึงจาก BOM items
      const ingStmt = db.prepare(`
        SELECT 
          bi.quantity as quantity_used,
          bi.unit as ingredient_unit,
          si.quantity as current_stock,
          si.base_unit as stock_base_unit,
          si.unit as stock_unit
        FROM bom_items bi
        JOIN stock_items si ON bi.material_id = si.id
        WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
      `)
      ingredients = ingStmt.all(menu.bom_id, tenantId) as any[]
    } else {
      // ดึงจาก pos_menu_ingredients
      const ingStmt = db.prepare(`
        SELECT 
          pmi.quantity_used,
          pmi.unit_id as ingredient_unit,
          si.quantity as current_stock,
          si.base_unit as stock_base_unit,
          si.unit as stock_unit
        FROM pos_menu_ingredients pmi
        JOIN stock_items si ON pmi.stock_item_id = si.id
        WHERE pmi.pos_menu_id = ? 
          AND pmi.tenant_id = ?
          AND pmi.is_optional = 0
      `)
      ingredients = ingStmt.all(menuId, tenantId) as any[]
    }
    
    if (ingredients.length === 0) return 999 // No required ingredients

    let maxCanMake = Infinity
    for (const ing of ingredients) {
      const stockBaseUnit = ing.stock_base_unit || ing.stock_unit
      const ingredientUnit = ing.ingredient_unit || stockBaseUnit
      
      let quantityUsedInBase = Number(ing.quantity_used)
      if (ingredientUnit && ingredientUnit !== stockBaseUnit) {
        const conversion = convertQuantityBidirectional(
          Number(ing.quantity_used),
          ingredientUnit,
          stockBaseUnit,
          tenantId,
          ing.stock_item_id
        )
        if (conversion) {
          quantityUsedInBase = conversion.converted
        } else {
          console.warn(`[qty] POS canMake: no conversion ${ingredientUnit} → ${stockBaseUnit} for stock item ${ing.stock_item_id}; result is unreliable`)
        }
      }
      
      if (quantityUsedInBase <= 0) continue
      const canMake = Math.floor(ing.current_stock / quantityUsedInBase)
      if (canMake < maxCanMake) {
        maxCanMake = canMake
      }
    }

    return maxCanMake === Infinity ? 999 : maxCanMake
  }
}

export default new POSStockService()
