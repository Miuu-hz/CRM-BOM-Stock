import db from '../db/sqlite'

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
    // Get menu details with BOM info
    const menuStmt = db.prepare(`
      SELECT pmc.*, p.name as product_name
      FROM pos_menu_configs pmc
      JOIN products p ON pmc.product_id = p.id
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
          si.name as stock_item_name,
          si.quantity as current_stock,
          si.unit,
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
          si.unit
        FROM pos_menu_ingredients pmi
        JOIN stock_items si ON pmi.stock_item_id = si.id
        WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
      `)
      ingredients = ingStmt.all(menuId, tenantId) as any[]
    }

    // Calculate max available quantity
    let maxAvailable = Infinity
    const stockDetails: IngredientStockCheck[] = ingredients.map((ing) => {
      const requiredQty = ing.quantity_used * requestedQty
      const available = ing.current_stock || 0
      const canMake = ing.quantity_used > 0 
        ? Math.floor(available / ing.quantity_used) 
        : Infinity

      if (!ing.is_optional && canMake < maxAvailable) {
        maxAvailable = canMake
      }

      return {
        ingredientId: ing.ingredient_id,
        stockItemId: ing.stock_item_id,
        stockItemName: ing.stock_item_name,
        unit: ing.unit,
        quantityUsed: ing.quantity_used,
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
  ): Promise<{ success: boolean; deductions: any[]; errors: string[] }> {
    const errors: string[] = []
    const deductions: any[] = []

    try {
      // Check tenant setting: pos_bom_deduct (default ON)
      const setting = db.prepare('SELECT pos_bom_deduct FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
      const bomDeductEnabled = !setting || setting.pos_bom_deduct !== 0
      if (!bomDeductEnabled) {
        return { success: true, deductions: [], errors: [] }
      }

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
      const itemsStmt = db.prepare(`
        SELECT bi.*, pmc.id as menu_config_id, pmc.bom_id, pmc.product_id
        FROM pos_bill_items bi
        JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
        WHERE bi.bill_id = ? AND bi.tenant_id = ?
      `)
      const items = itemsStmt.all(billId, tenantId) as any[]

      // Process each item
      for (const item of items) {
        // Get ingredients - ใช้ BOM ถ้ามี bom_id ไม่งันใช้ pos_menu_ingredients
        let ingredients: any[] = []

        if (item.bom_id) {
          // ดึงวัตถุดิบจาก BOM items
          const ingStmt = db.prepare(`
            SELECT
              bi.id,
              bi.material_id as stock_item_id,
              bi.quantity as quantity_used
            FROM bom_items bi
            WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
          `)
          ingredients = ingStmt.all(item.bom_id, tenantId) as any[]
        } else {
          // ใช้ pos_menu_ingredients (แบบเก่า)
          const ingStmt = db.prepare(`
            SELECT * FROM pos_menu_ingredients
            WHERE pos_menu_id = ? AND tenant_id = ?
          `)
          ingredients = ingStmt.all(item.pos_menu_id, tenantId) as any[]
        }

        // ถ้าไม่มี ingredient เลย ให้ตัด stock จาก product_id โดยตรง (1 ชิ้นต่อ 1 ครั้งขาย)
        if (ingredients.length === 0 && item.product_id) {
          ingredients = [{ stock_item_id: item.product_id, quantity_used: 1, unit_id: null }]
        }

        for (const ing of ingredients) {
          const deductQty = ing.quantity_used * item.quantity

          // Check if enough stock
          const stockStmt = db.prepare('SELECT quantity, name FROM stock_items WHERE id = ?')
          const stock = stockStmt.get(ing.stock_item_id) as any

          if (!stock || stock.quantity < deductQty) {
            errors.push(`Insufficient stock for ${stock?.name || 'Unknown'} (need ${deductQty}, have ${stock?.quantity || 0})`)
            continue
          }

          // 1. Update stock quantity
          const updateStock = db.prepare(`
            UPDATE stock_items 
            SET quantity = quantity - ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?
          `)
          updateStock.run(deductQty, now(), ing.stock_item_id, tenantId)

          // 2. Record stock movement
          const movementId = generateId()
          const movementStmt = db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_by, created_at)
            VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?)
          `)
          movementStmt.run(
            movementId,
            tenantId,
            ing.stock_item_id,
            -deductQty,
            bill.bill_number,
            `POS Sale - ${item.product_name}`,
            userId,
            now()
          )

          // 3. Record deduction
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
            deductQty,
            ing.unit_id || null,
            now()
          )

          deductions.push({
            deductionId: deductId,
            stockItemId: ing.stock_item_id,
            stockItemName: stock.name,
            quantityDeducted: deductQty,
            remainingStock: stock.quantity - deductQty
          })
        }
      }

      return {
        success: errors.length === 0,
        deductions,
        errors
      }
    } catch (error: any) {
      return {
        success: false,
        deductions,
        errors: [error.message || 'Unknown error occurred']
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
    const errors: string[] = []
    const returns: any[] = []

    try {
      // Get bill info
      const billStmt = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ?')
      const bill = billStmt.get(billId) as any

      if (!bill) {
        throw new Error('Bill not found')
      }

      // Get all deductions for this bill
      const deductionsStmt = db.prepare(`
        SELECT psd.*, bi.bill_number, bi.product_name
        FROM pos_stock_deductions psd
        JOIN pos_bill_items bi ON psd.bill_item_id = bi.id
        WHERE bi.bill_id = ? AND psd.returned = 0
      `)
      const deductions = deductionsStmt.all(billId) as any[]

      for (const deduction of deductions) {
        try {
          // 1. Return stock
          const returnStock = db.prepare(`
            UPDATE stock_items 
            SET quantity = quantity + ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?
          `)
          returnStock.run(deduction.quantity_deducted, now(), deduction.stock_item_id, tenantId)

          // 2. Record return movement
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

          // 3. Mark deduction as returned
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
        } catch (error: any) {
          errors.push(`Failed to return stock for item ${deduction.id}: ${error.message}`)
        }
      }

      return {
        success: errors.length === 0,
        returns,
        errors
      }
    } catch (error: any) {
      return {
        success: false,
        returns,
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
        si.min_stock,
        bi.quantity as quantity_used
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
        si.min_stock,
        pmi.quantity_used
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
          si.quantity as current_stock
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
          si.quantity as current_stock
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
      if (ing.quantity_used <= 0) continue
      const canMake = Math.floor(ing.current_stock / ing.quantity_used)
      if (canMake < maxCanMake) {
        maxCanMake = canMake
      }
    }

    return maxCanMake === Infinity ? 999 : maxCanMake
  }
}

export default new POSStockService()
