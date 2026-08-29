import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { getLimits } from '../services/subscription.service'
import { randomUUID } from 'crypto'
import { isValidImageFile, isAllowedImageExt, isAllowedImageMimetype, getSafeImageExtension } from '../utils/upload'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit, getUnitDisplayName } from '../services/unitConversion.service'
import { roundQty, roundPackQty, isWholeQty } from '../utils/qty'
import { ACC, ACC_META } from '../config/accountCodes'
import { formatDocumentNumber } from '../utils/id'

// Multer config: store in uploads/stock-images/
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'stock-images')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, _file, cb) => {
    const ext = getSafeImageExtension(_file.originalname) || '.jpg'
    cb(null, `${req.params.id}-${Date.now()}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (isAllowedImageExt(ext) && isAllowedImageMimetype(file.mimetype)) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// stock_items.unit_cost MUST always be the price per 1 BASE UNIT (stock_items.base_unit),
// never per whatever unit a movement/receipt happened to be entered in — mirrors
// priceToBaseUnitCost() in purchase.routes.ts / mcp/tools/purchase.ts (same file family,
// duplicated locally rather than shared to avoid new cross-module coupling).
//   unit_cost = pricePerEnteredUnit / factor
// where factor = how many base units are in 1 entered unit.
function priceToBaseUnitCost(pricePerEnteredUnit: number, factor: number, context: string): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    console.warn(`[unit_cost] invalid conversion factor (${factor}) for ${context} — keeping price un-converted to avoid corrupting cost`)
    return pricePerEnteredUnit
  }
  return pricePerEnteredUnit / factor
}

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function getOrCreateAccount(tenantId: string, code: string, name: string, type: string, category: string, normalBalance: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code) as any
  if (existing) return existing.id
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`).run(id, tenantId, code, name, type, category, normalBalance)
  return id
}

/**
 * Base units contained in one display (pack) unit — e.g. 30 for a pack of eggs.
 * Returns null when the item has no separate pack unit, or when no conversion
 * rule links the two, which is exactly the case where a pack cannot be opened.
 */
function getPackFactor(item: any, tenantId: string): number | null {
  const baseUnit = item.base_unit || item.unit
  const displayUnit = item.display_unit || item.unit
  if (!baseUnit || !displayUnit) return null
  if (normalizeUnit(baseUnit) === normalizeUnit(displayUnit)) return null
  const converted = convertQuantityBidirectional(1, displayUnit, baseUnit, tenantId, item.id)
  if (!converted || !(converted.factor > 0)) return null
  return roundQty(converted.factor)
}

/** Enrich stock item with display quantity computed from base_unit ↔ display_unit */
function enrichStockItem(item: any, tenantId: string) {
  if (!item) return item
  const baseUnit = item.base_unit || item.unit
  const displayUnit = item.display_unit || item.unit
  item.base_unit = baseUnit
  item.display_unit = displayUnit
  item.sealed_qty = item.sealed_qty ?? 0

  if (displayUnit && baseUnit && displayUnit !== baseUnit) {
    const converted = convertQuantityBidirectional(item.quantity, baseUnit, displayUnit, tenantId, item.id)
    if (converted) {
      item.display_quantity = Number(converted.converted.toFixed(4))
    } else {
      item.display_quantity = item.quantity
    }
  } else {
    item.display_quantity = item.quantity
  }

  // Pack awareness: sealed_qty counts unopened packs whose contents are real
  // stock. Anything that looks only at `quantity` reports "out of stock" while
  // full packs sit on the shelf, so expose the pack size and the true total.
  const packFactor = getPackFactor(item, tenantId)
  item.pack_factor = packFactor
  item.available_total = roundQty(item.quantity + (packFactor ? item.sealed_qty * packFactor : 0))
  item.can_unpack = item.sealed_qty > 0 && packFactor !== null

  return item
}

// Get stock statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const totalItems = (db.prepare('SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?').get(tenantId) as any).count
    const stockItems = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ?').all(tenantId) as any[]

    // Count against what is actually usable — loose quantity plus whatever is
    // still sealed in packs — otherwise a shelf full of unopened packs is
    // reported as low stock and the owner reorders what they already have.
    const availableByItem = new Map<string, number>()
    for (const item of stockItems) {
      const packFactor = getPackFactor(item, tenantId)
      availableByItem.set(item.id, item.quantity + (packFactor ? (item.sealed_qty || 0) * packFactor : 0))
    }
    const availableOf = (item: any) => availableByItem.get(item.id) ?? item.quantity

    const lowStockCount = stockItems.filter(
      (item: any) => availableOf(item) <= item.min_stock
    ).length

    const criticalCount = stockItems.filter(
      (item: any) => availableOf(item) <= item.min_stock * 0.3
    ).length

    let totalValue = 0
    for (const item of stockItems) {
      if (item.material_id) {
        const material = db.prepare('SELECT unit_cost FROM materials WHERE id = ?').get(item.material_id) as any
        if (material) {
          totalValue += item.quantity * (material.unit_cost || 0)
        }
      }
    }

    res.json({
      success: true,
      data: {
        totalItems,
        lowStockCount,
        criticalCount,
        totalValue,
      },
    })
  } catch (error) {
    console.error('Get stock stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock stats' })
  }
})

// Get all stock items
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const stockItems = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE si.tenant_id = ?
      ORDER BY si.updated_at DESC
    `).all(tenantId) as any[]

    for (const item of stockItems) {
      item.movements = db.prepare(`
        SELECT * FROM stock_movements
        WHERE stock_item_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `).all(item.id)
      enrichStockItem(item, tenantId)
    }

    res.json({
      success: true,
      data: stockItems,
    })
  } catch (error) {
    console.error('Get stock items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock items' })
  }
})

// Get stock item by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const stock = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE si.id = ? AND si.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    stock.movements = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ?
      ORDER BY created_at DESC
    `).all(stock.id)

    enrichStockItem(stock, tenantId)

    res.json({
      success: true,
      data: stock,
    })
  } catch (error) {
    console.error('Get stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock item' })
  }
})

// Create stock item
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { sku, gs1Barcode, name, category, unit, baseUnit, saleUnit, displayUnit, quantity = 0, minStock = 0, maxStock = 100, location, isPosEnabled = false, unitCost, unitPrice, purchasePrice, purchaseUnit } = req.body

    if (!sku || !name || !unit) {
      return res.status(400).json({ success: false, message: 'SKU, name and unit are required' })
    }

    // Subscription: จำกัดจำนวนสินค้าตามแพ็กเกจ (MASTER bypass)
    // ponytail: gate เฉพาะ create path หลักนี้ — path อื่น (เช่น import) ยังไม่ถูกจำกัด
    if (req.user!.role !== 'MASTER') {
      const { maxProducts } = getLimits(tenantId)
      if (maxProducts !== null) {
        const count = (db.prepare('SELECT COUNT(*) as c FROM stock_items WHERE tenant_id = ?').get(tenantId) as any).c
        if (count >= maxProducts) {
          return res.status(403).json({
            success: false,
            code: 'PRODUCT_LIMIT',
            message: `แพ็กเกจนี้มีสินค้าได้สูงสุด ${maxProducts} รายการ กรุณาอัปเกรดแพ็กเกจ`,
          })
        }
      }
    }

    const id = generateId()
    const now = new Date().toISOString()
    const effectiveBaseUnit = normalizeUnit(baseUnit || unit)
    // `unit` (legacy column) is forced to equal base_unit on every write from now on — even
    // if the caller sent a different `unit` value — so the two columns can never drift apart
    // again (see "เลิกใช้ unit legacy" task). unitCost here is assumed to already be price per
    // base_unit: this is a direct admin form, not a purchase-unit conversion context (no
    // separate "purchased in X, priced per Y" concept exists on this endpoint).
    const normUnit = effectiveBaseUnit
    const effectiveDisplayUnit = normalizeUnit(displayUnit || unit)
    const effectiveSaleUnit = normalizeUnit(saleUnit || effectiveBaseUnit)

    // purchasePrice/purchaseUnit: what the shop owner actually knows ("1 pack = 133 บาท"),
    // as opposed to unitCost which is price-per-base-unit. When sent, this endpoint derives
    // unit_cost from them instead of trusting a caller-supplied unitCost directly. Legacy
    // callers that still send bare unitCost (no purchasePrice) keep working unchanged.
    let finalUnitCost = (unitCost !== undefined && unitCost !== null && unitCost !== '') ? Number(unitCost) : 0
    let finalPurchasePrice: number | null = null
    let finalPurchaseUnit: string | null = null

    if (purchasePrice !== undefined && purchasePrice !== null && purchasePrice !== '') {
      const purchasePriceNum = Number(purchasePrice)
      if (!Number.isFinite(purchasePriceNum) || purchasePriceNum < 0) {
        return res.status(400).json({ success: false, message: 'purchasePrice ต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0' })
      }
      const normPurchaseUnit = normalizeUnit(purchaseUnit || effectiveBaseUnit)
      finalPurchasePrice = purchasePriceNum
      finalPurchaseUnit = normPurchaseUnit

      if (normPurchaseUnit === effectiveBaseUnit) {
        finalUnitCost = purchasePriceNum
      } else {
        const converted = convertQuantityBidirectional(1, normPurchaseUnit, effectiveBaseUnit, tenantId, id)
        if (!converted || !(converted.factor > 0)) {
          return res.status(400).json({
            success: false,
            message: `ไม่พบอัตราแปลงหน่วย "${normPurchaseUnit}" → "${effectiveBaseUnit}" กรุณาไปตั้งค่าอัตราแปลงหน่วย (Unit Conversion) ก่อน แล้วค่อยกลับมากรอกราคาซื้ออีกครั้ง`,
          })
        }
        finalUnitCost = priceToBaseUnitCost(purchasePriceNum, converted.factor, `create stock item ${normPurchaseUnit}→${effectiveBaseUnit}`)
      }
    }

    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, gs1_barcode, name, category, quantity, unit, base_unit, sale_unit, display_unit, unit_cost, unit_price, purchase_price, purchase_unit, min_stock, max_stock, location, status, is_pos_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `).run(id, tenantId, sku, gs1Barcode || null, name, category, quantity, normUnit, effectiveBaseUnit, effectiveSaleUnit, effectiveDisplayUnit, finalUnitCost, unitPrice ? Number(unitPrice) : 0, finalPurchasePrice, finalPurchaseUnit, minStock, maxStock, location || 'Main Warehouse', isPosEnabled ? 1 : 0, now, now)

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id)
    
    res.status(201).json({
      success: true,
      data: enrichStockItem(item, tenantId),
    })
  } catch (error) {
    console.error('Create stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to create stock item' })
  }
})

// Update stock item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, gs1Barcode, category, unit, baseUnit, saleUnit, displayUnit, minStock, maxStock, location, isPosEnabled, unitCost, unitPrice, purchasePrice, purchaseUnit } = req.body

    let currentItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    // Fallback: if id is a material_id, find the linked stock item
    if (!currentItem) {
      currentItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    }
    if (!currentItem) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    const now = new Date().toISOString()

    // Keep `unit` (legacy) and `base_unit` (canonical) in lockstep: whichever of the two the
    // caller sends becomes the value written to BOTH columns — base_unit wins if both are
    // sent, since it's the source of truth going forward (see "เลิกใช้ unit legacy" task).
    // unitCost here is assumed to already be price per base_unit — same as the create
    // endpoint above (direct admin form field, no purchase-unit conversion context).
    const syncedUnit = (baseUnit || unit) ? normalizeUnit(baseUnit || unit) : undefined

    // เจ้าของร้านรู้แค่ราคาที่จ่ายจริงต่อหน่วยที่ซื้อมา ("ไข่ 1 แพ็ค 133 บาท") ไม่ใช่ราคาต่อฟอง
    // จึงเก็บ purchase_price/purchase_unit ตามที่กรอก แล้วหารเป็น unit_cost (ต่อ base_unit)
    // ให้เอง เพราะ BOM/ต้นทุนขายคำนวณจาก unit_cost เท่านั้น
    const effBaseUnit = syncedUnit || currentItem.base_unit || currentItem.unit
    let finalUnitCost: number | undefined = unitCost !== undefined ? Number(unitCost) : undefined
    let finalPurchasePrice: number | undefined = undefined
    let finalPurchaseUnit: string | undefined = undefined

    if (purchasePrice !== undefined && purchasePrice !== null && purchasePrice !== '') {
      const priceNum = Number(purchasePrice)
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ success: false, message: 'ราคาที่ซื้อมาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' })
      }
      const normPurchaseUnit = normalizeUnit(purchaseUnit || effBaseUnit)
      finalPurchasePrice = priceNum
      finalPurchaseUnit = normPurchaseUnit

      if (!effBaseUnit || normPurchaseUnit === normalizeUnit(effBaseUnit)) {
        finalUnitCost = priceNum
      } else {
        const converted = convertQuantityBidirectional(1, normPurchaseUnit, effBaseUnit, tenantId, currentItem.id)
        if (!converted || !(converted.factor > 0)) {
          // ห้ามเก็บมั่ว: ถ้าแปลงไม่ได้ ต้นทุนใน BOM จะผิดเงียบๆ แบบที่เคยเจอมาแล้ว
          return res.status(400).json({
            success: false,
            code: 'UNIT_CONVERSION_MISSING',
            message: `ไม่พบอัตราแปลงหน่วย ${getUnitDisplayName(normPurchaseUnit)} → ${getUnitDisplayName(effBaseUnit)} สำหรับ "${currentItem.name}" กรุณาตั้งค่าที่ ตั้งค่า > การแปลงหน่วย ก่อนบันทึกราคา`,
          })
        }
        finalUnitCost = priceToBaseUnitCost(priceNum, converted.factor, `update stock item ${normPurchaseUnit}→${effBaseUnit}`)
      }
    }

    db.prepare(`
      UPDATE stock_items SET
        name = COALESCE(?, name),
        gs1_barcode = COALESCE(?, gs1_barcode),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        base_unit = COALESCE(?, base_unit),
        sale_unit = COALESCE(?, sale_unit),
        display_unit = COALESCE(?, display_unit),
        unit_cost = COALESCE(?, unit_cost),
        unit_price = COALESCE(?, unit_price),
        purchase_price = COALESCE(?, purchase_price),
        purchase_unit = COALESCE(?, purchase_unit),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        location = COALESCE(?, location),
        is_pos_enabled = COALESCE(?, is_pos_enabled),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, gs1Barcode, category, syncedUnit, syncedUnit, saleUnit ? normalizeUnit(saleUnit) : undefined, displayUnit ? normalizeUnit(displayUnit) : undefined, finalUnitCost, unitPrice !== undefined ? Number(unitPrice) : undefined, finalPurchasePrice, finalPurchaseUnit, minStock, maxStock, location, isPosEnabled !== undefined ? (isPosEnabled ? 1 : 0) : undefined, now, req.params.id, tenantId)

    // Record price change in movements
    if (finalUnitCost !== undefined && currentItem && Number(finalUnitCost) !== Number(currentItem.unit_cost)) {
      const movId = generateId()
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'PRICE_CHANGE', 0, '', ?, ?, ?)
      `).run(movId, tenantId, req.params.id, `ราคาเปลี่ยนจาก ฿${currentItem.unit_cost || 0} → ฿${finalUnitCost}`, now, req.user!.email)
    }

    // Always get latest stock item after update
    const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id) as any
    const posPrice = stockItem?.unit_price || stockItem?.unit_cost || 0
    const costPrice = stockItem?.unit_cost || 0

    // Sync pos_price / cost_price whenever unitPrice or unitCost changes
    if (unitPrice !== undefined || finalUnitCost !== undefined) {
      db.prepare('UPDATE pos_menu_configs SET pos_price = ?, cost_price = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
        .run(posPrice, costPrice, now, req.params.id, tenantId)
    }

    // Sync with pos_menu_configs when POS enabled flag changes
    if (isPosEnabled !== undefined) {
      if (isPosEnabled) {
        // Upsert: create pos_menu_configs entry if not exists
        const existingPOS = db.prepare('SELECT id FROM pos_menu_configs WHERE product_id = ? AND tenant_id = ?').get(req.params.id, tenantId)
        if (!existingPOS) {
          const posId = generateId()
          db.prepare(`
            INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price, image_url, is_available, is_pos_enabled, display_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)
          `).run(posId, tenantId, req.params.id, posPrice, costPrice, stockItem?.image_url || null, now, now)
        } else {
          db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 1, is_available = 1, pos_price = ?, cost_price = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
            .run(posPrice, costPrice, now, req.params.id, tenantId)
        }
      } else {
        // Disable in pos_menu_configs
        db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
          .run(now, req.params.id, tenantId)
      }
    }

    res.json({
      success: true,
      data: enrichStockItem(stockItem, tenantId),
    })
  } catch (error) {
    console.error('Update stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to update stock item' })
  }
})

// Delete stock item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id, name, sku FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบสินค้านี้ในคลัง' })
    }

    // ตารางเหล่านี้อ้างถึง stock_items ด้วย foreign key แบบ NO ACTION — ถ้ามีแถวค้างอยู่
    // SQLite จะโยน constraint error ดิบออกมา กลายเป็น HTTP 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
    // เช็คเองก่อนลบ แล้วบอกให้ชัดว่าติดอยู่ที่ไหน จะได้ไปจัดการถูกที่
    // (stock_movements กับ pos_menu_configs เป็น CASCADE จึงไม่ต้องเช็ค)
    const REFERENCES: Array<{ label: string; sql: string }> = [
      { label: 'สูตรการผลิต (BOM) — เป็นวัตถุดิบ', sql: 'SELECT COUNT(*) c FROM bom_items WHERE material_id = ?' },
      { label: 'สูตรการผลิต (BOM) — เป็นสินค้าที่ผลิต', sql: 'SELECT COUNT(*) c FROM boms WHERE product_id = ?' },
      { label: 'สูตรเมนู POS', sql: 'SELECT COUNT(*) c FROM pos_menu_ingredients WHERE stock_item_id = ?' },
      { label: 'ประวัติตัดสต็อก POS', sql: 'SELECT COUNT(*) c FROM pos_stock_deductions WHERE stock_item_id = ?' },
      { label: 'ใบสั่งขาย', sql: 'SELECT COUNT(*) c FROM sales_order_items WHERE stock_item_id = ?' },
      { label: 'ใบเสนอราคา', sql: 'SELECT COUNT(*) c FROM quotation_items WHERE stock_item_id = ?' },
      { label: 'ใบแจ้งหนี้', sql: 'SELECT COUNT(*) c FROM invoice_items WHERE stock_item_id = ?' },
      { label: 'ใบสั่งซื้อ', sql: 'SELECT COUNT(*) c FROM purchase_order_items WHERE material_id = ?' },
      { label: 'ใบรับของ', sql: 'SELECT COUNT(*) c FROM goods_receipt_items WHERE material_id = ?' },
      { label: 'ใบสั่งผลิต', sql: 'SELECT COUNT(*) c FROM work_order_materials WHERE material_id = ?' },
      { label: 'รายการปรับสต็อก', sql: 'SELECT COUNT(*) c FROM stock_adjustments WHERE stock_item_id = ?' },
    ]

    const blockers: string[] = []
    for (const ref of REFERENCES) {
      try {
        const row = db.prepare(ref.sql).get(req.params.id) as any
        if (row && Number(row.c) > 0) blockers.push(ref.label + ' ' + row.c + ' รายการ')
      } catch (e) { /* ตารางยังไม่ถูก migrate — ข้าม */ }
    }

    if (blockers.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'STOCK_ITEM_IN_USE',
        message:
          'ลบ "' + existing.name + '" ไม่ได้ เพราะถูกใช้งานอยู่ใน ' + blockers.join(', ') +
          ' — ถ้าไม่ใช้แล้ว ให้เปลี่ยนสถานะเป็น "เลิกใช้" แทนการลบ',
        blockers,
      })
    }

    // กฎแปลงหน่วยไม่มี FK จึงต้องเก็บกวาดเอง ไม่งั้นจะค้างเป็นขยะ
    const removeItem = db.transaction(() => {
      db.prepare('DELETE FROM unit_conversions WHERE material_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM stock_items WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })
    removeItem()

    res.json({ success: true, message: 'ลบ "' + existing.name + '" ออกจากคลังแล้ว' })
  } catch (error: any) {
    console.error('Delete stock item error:', error)
    // กันเหนียว: ถ้ามีตารางอ้างถึงที่เช็คข้างบนไม่ครอบคลุม อย่าโยน 500 ดิบให้ผู้ใช้
    if (String(error?.code || '').indexOf('SQLITE_CONSTRAINT') !== -1) {
      return res.status(409).json({
        success: false,
        code: 'STOCK_ITEM_IN_USE',
        message: 'ลบสินค้านี้ไม่ได้ เพราะยังถูกอ้างถึงจากเอกสารหรือสูตรอื่นอยู่ — ให้เปลี่ยนสถานะเป็น "เลิกใช้" แทน',
      })
    }
    res.status(500).json({ success: false, message: 'ลบสินค้าไม่สำเร็จ' })
  }
})

// Record stock movement
router.post('/movement', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { stockItemId, type, quantity, unit, reference, notes, unitCost } = req.body
    const createdBy = req.user!.email

    if (!stockItemId || !type || quantity === undefined || quantity === null) {
      return res.status(400).json({ success: false, message: 'Missing required fields' })
    }

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!item) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    const baseUnit = item.base_unit || item.unit
    // Legacy `unit` fallback only kicks in when the caller omits `unit` in the request AND
    // base_unit itself hasn't been backfilled yet — otherwise this defaulted straight to the
    // legacy `unit` column even when it disagreed with base_unit (same class of bug as the
    // GR-confirm handlers in purchase.routes.ts).
    const movementUnit = unit || item.base_unit || item.unit
    let convertedQuantity = Number(quantity)
    // Base units per 1 `movementUnit` — also reused below to convert unitCost (which the
    // caller enters per movementUnit, same as quantity) into price-per-base-unit. Stays 1
    // when movementUnit already equals baseUnit, i.e. price is already per base unit — this
    // is also what happens when the caller doesn't send `unit` at all (see priceToBaseUnitCost
    // call below): no conversion, treated as already base-unit price.
    let qtyConversionFactor = 1

    // Convert movement unit to base unit if different
    if (movementUnit !== baseUnit) {
      const conversion = convertQuantityBidirectional(Number(quantity), movementUnit, baseUnit, tenantId, stockItemId)
      if (!conversion) {
        return res.status(400).json({
          success: false,
          message: `ไม่พบการแปลงหน่วยจาก "${movementUnit}" เป็น "${baseUnit}" กรุณาตั้งค่าการแปลงหน่วยใน Settings > การแปลงหน่วย`,
        })
      }
      convertedQuantity = conversion.converted
      qtyConversionFactor = conversion.factor
    }

    const now = new Date().toISOString()

    // ponytail: read-modify-write stock + movement + journal must be atomic.
    let updatedItem: any
    const recordMovement = db.transaction(() => {
      const currentItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!currentItem) {
        throw new Error('STOCK_ITEM_NOT_FOUND')
      }

      let newQuantity = currentItem.quantity
      let newSealedQty = currentItem.sealed_qty ?? 0

      if (type === 'IN') {
        newQuantity += convertedQuantity
      } else if (type === 'OUT') {
        // auto-unpack ถ้า quantity ไม่พอ แต่มี sealed_qty
        if (currentItem.quantity < convertedQuantity) {
          const unpack = autoUnpackIfNeeded(currentItem, convertedQuantity, tenantId)
          if (!unpack) {
            throw new Error('INSUFFICIENT_STOCK')
          }
          // บันทึก unpack movement
          if (unpack.unpackedPacks > 0) {
            // quantity ของ stock_movements ต้องเป็น base unit เสมอ (ตาม schema comment)
            // เดิมบันทึก unpack.unpackedPacks (จำนวนแพ็ค) ตรงๆ ซึ่งผิดหน่วย — ทำให้รายงาน/
            // reconcile ที่รวม quantity ของ movement ต่างชนิดกันปนหน่วยแพ็คกับหน่วยฐานเข้าด้วยกัน
            // ใส่ movement_unit/movement_quantity ไว้ด้วยเพื่อให้ตรงกับแกะแพ็คด้วยมือ (POST /:id/unpack)
            const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItemId,
              gained,
              currentItem.display_unit || null,
              unpack.unpackedPacks,
              reference || 'AUTO',
              `แกะอัตโนมัติ ${unpack.unpackedPacks} ${currentItem.display_unit} → ${gained} ${baseUnit}`,
              now, createdBy)
            db.prepare('UPDATE stock_items SET sealed_qty = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(unpack.sealed_qty, now, stockItemId, tenantId)
            newSealedQty = unpack.sealed_qty
            newQuantity = unpack.quantity
          }
        }
        if (newQuantity < convertedQuantity) {
          throw new Error('INSUFFICIENT_STOCK')
        }
        newQuantity -= convertedQuantity
      } else if (type === 'ADJUST') {
        newQuantity = convertedQuantity
      }

      if (type === 'IN' && unitCost !== undefined && unitCost !== null) {
        // unit_cost must be price per base_unit — caller enters unitCost per movementUnit
        // (the same unit `quantity` was entered in), so divide by the identical factor that
        // converted quantity → base_unit above. See priceToBaseUnitCost() for rationale.
        const newUnitCost = priceToBaseUnitCost(Number(unitCost), qtyConversionFactor, `movement ${movementUnit}→${baseUnit} (stock item ${stockItemId})`)
        db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(newQuantity, newUnitCost, now, stockItemId, tenantId)
      } else {
        db.prepare('UPDATE stock_items SET quantity = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?').run(newQuantity, now, stockItemId, tenantId)
      }

      const movementId = generateId()
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(movementId, tenantId, stockItemId, type, convertedQuantity, movementUnit, Number(quantity), reference || '', notes || '', now, createdBy)

      // Auto-journal for ADJUST stock movements
      if (type === 'ADJUST') {
        const oldQty = currentItem.quantity || 0
        const diffQty = newQuantity - oldQty
        const itemUnitCost = Number(currentItem.unit_cost || 0)
        const diffValue = diffQty * itemUnitCost
        if (Math.abs(diffValue) > 0.01) {
          try {
            const invAccId = getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
            const yr = new Date().getFullYear()
            const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
            const entryId = generateId()

            if (diffValue > 0) {
              // Adjust up: Dr Inventory / Cr Other Income
              const incomeAccId = getOrCreateAccount(tenantId, '4203', 'รายได้อื่น', 'REVENUE', 'OTHER_REVENUE', 'CREDIT')
              db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'STOCK_ADJUST', ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
                .run(entryId, tenantId, jvNumber, now.substring(0, 10), stockItemId, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue, diffValue, createdBy, now, now)
              db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
                .run(generateId(), tenantId, entryId, invAccId, 1, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue)
              db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
                .run(generateId(), tenantId, entryId, incomeAccId, 2, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue)
            } else {
              // Adjust down: Dr Stock Adjustment Expense / Cr Inventory
              const adjExpAccId = getOrCreateAccount(tenantId, '5901', 'ค่าใช้จ่ายปรับปรุงสต็อก', 'EXPENSE', 'OTHER_EXPENSE', 'DEBIT')
              const absValue = Math.abs(diffValue)
              db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'STOCK_ADJUST', ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
                .run(entryId, tenantId, jvNumber, now.substring(0, 10), stockItemId, `ปรับลดสต็อก ${currentItem.name}`, absValue, absValue, createdBy, now, now)
              db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
                .run(generateId(), tenantId, entryId, adjExpAccId, 1, `ปรับลดสต็อก ${currentItem.name}`, absValue)
              db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
                .run(generateId(), tenantId, entryId, invAccId, 2, `ปรับลดสต็อก ${currentItem.name}`, absValue)
            }
          } catch (journalErr) {
            console.error('⚠️ Stock adjust journal error:', journalErr)
          }
        }
      }

      updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
    })

    try {
      recordMovement()
    } catch (err: any) {
      if (err.message === 'STOCK_ITEM_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Stock item not found' })
      }
      if (err.message === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({ success: false, message: 'Insufficient stock' })
      }
      throw err
    }

    res.json({
      success: true,
      data: enrichStockItem(updatedItem, tenantId),
    })
  } catch (error) {
    console.error('Record movement error:', error)
    res.status(500).json({ success: false, message: 'Failed to record movement' })
  }
})

// Get movements for a stock item
router.get('/:id/movements', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const movements = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id, tenantId)
    res.json({ success: true, data: movements })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch movements' })
  }
})

// Upload image for stock item
router.post('/:id/image', (req: Request, res: Response, next: any) => {
  upload.single('image')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'ไฟล์ใหญ่เกินไป (สูงสุด 10MB)' })
    }
    if (err) return res.status(400).json({ success: false, message: err.message })
    next()
  })
}, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'No image file provided' })

    const existing = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Stock item not found' })

    // Reject files whose content does not match an allowed image type.
    const fullPath = path.join(uploadDir, file.filename)
    if (!isValidImageFile(fullPath)) {
      try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      return res.status(400).json({ success: false, message: 'Invalid image file' })
    }

    if (existing.image_url) {
      const baseDir = path.resolve(__dirname, '..', '..', 'uploads')
      const oldPath = path.resolve(baseDir, existing.image_url.replace(/^\//, ''))
      if (oldPath.startsWith(baseDir)) try { fs.unlinkSync(oldPath) } catch { /* file already gone */ }
    }

    const imageUrl = `/uploads/stock-images/${file.filename}`
    const now = new Date().toISOString()

    db.prepare('UPDATE stock_items SET image_url = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(imageUrl, now, req.params.id, tenantId)

    // Sync image to pos_menu_configs
    db.prepare('UPDATE pos_menu_configs SET image_url = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
      .run(imageUrl, now, req.params.id, tenantId)

    res.json({ success: true, data: { image_url: imageUrl } })
  } catch (error) {
    console.error('Upload image error:', error)
    res.status(500).json({ success: false, message: 'Failed to upload image' })
  }
})

// Delete image for stock item
router.delete('/:id/image', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Stock item not found' })

    if (existing.image_url) {
      const baseDir = path.resolve(__dirname, '..', '..', 'uploads')
      const filePath = path.resolve(baseDir, existing.image_url.replace(/^\//, ''))
      if (filePath.startsWith(baseDir)) try { fs.unlinkSync(filePath) } catch { /* file already gone */ }
    }

    const now = new Date().toISOString()
    db.prepare('UPDATE stock_items SET image_url = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?').run(now, req.params.id, tenantId)
    db.prepare('UPDATE pos_menu_configs SET image_url = NULL, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
      .run(now, req.params.id, tenantId)

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete image' })
  }
})

// ===================================================================
// POST /:id/unpack — แกะแพ็คด้วยมือ
// ===================================================================
// sealed_qty holds unopened packs; their contents only become usable stock
// once a pack is opened. Production, delivery and POS unpack automatically,
// but nothing let a human open a pack on purpose — so packs sat untouched
// while the item showed as out of stock.
router.post('/:id/unpack', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const stockItemId = req.params.id
    const packs = Number(req.body?.packs)

    if (!Number.isFinite(packs) || packs <= 0 || !isWholeQty(packs)) {
      return res.status(400).json({ success: false, message: 'จำนวนแพ็คที่จะแกะต้องเป็นจำนวนเต็มมากกว่า 0' })
    }

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!item) return res.status(404).json({ success: false, message: 'ไม่พบสินค้านี้ในคลัง' })

    const baseUnit = item.base_unit || item.unit
    const displayUnit = item.display_unit || item.unit

    if (!baseUnit || !displayUnit || normalizeUnit(baseUnit) === normalizeUnit(displayUnit)) {
      return res.status(400).json({
        success: false,
        message: `"${item.name}" ยังไม่ได้ตั้งหน่วยบรรจุ (เช่น แพ็ค/ลัง) ที่ต่างจากหน่วยฐาน จึงแกะแพ็คไม่ได้ — ตั้งค่าได้ที่คลังสินค้า > แก้ไขสินค้า`,
      })
    }

    const packFactor = getPackFactor(item, tenantId)
    if (packFactor === null) {
      return res.status(400).json({
        success: false,
        message: `ไม่พบอัตราแปลงหน่วย "${getUnitDisplayName(displayUnit)}" → "${getUnitDisplayName(baseUnit)}" สำหรับ "${item.name}" กรุณาตั้งค่าที่ Settings > การแปลงหน่วย`,
      })
    }

    const sealed = Number(item.sealed_qty || 0)
    if (packs > sealed) {
      return res.status(400).json({
        success: false,
        message: `มีแพ็คที่ยังไม่แกะเพียง ${sealed} ${getUnitDisplayName(displayUnit)} แกะ ${packs} ไม่ได้`,
      })
    }

    const now = new Date().toISOString()
    const gained = roundQty(packs * packFactor)
    let newQuantity = 0
    let newSealed = 0

    const doUnpack = db.transaction(() => {
      // Re-read inside the transaction: a concurrent receipt or sale may have
      // moved sealed_qty since the check above.
      const current = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!current) throw new Error('STOCK_ITEM_NOT_FOUND')
      const currentSealed = Number(current.sealed_qty || 0)
      if (packs > currentSealed) throw new Error('SEALED_CHANGED')

      newSealed = roundPackQty(currentSealed - packs, `manual unpack ${item.sku}`)
      newQuantity = roundQty(Number(current.quantity || 0) + gained)

      db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newQuantity, newSealed, now, stockItemId, tenantId)

      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), tenantId, stockItemId, gained, displayUnit, packs, 'MANUAL',
        `แกะแพ็ค: ${packs} ${getUnitDisplayName(displayUnit)} → +${gained} ${getUnitDisplayName(baseUnit)}`,
        now, req.user!.userId)
    })

    try {
      doUnpack()
    } catch (e: any) {
      if (e?.message === 'SEALED_CHANGED') {
        return res.status(409).json({ success: false, message: 'จำนวนแพ็คเปลี่ยนไประหว่างดำเนินการ กรุณาลองใหม่' })
      }
      if (e?.message === 'STOCK_ITEM_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'ไม่พบสินค้านี้ในคลัง' })
      }
      throw e
    }

    // Re-fetch and run through the same enrichStockItem() the list/detail
    // endpoints use, so the screen can apply this response to its state
    // directly (quantity, sealed_qty, available_total, can_unpack, ...)
    // without a refetch, and never drifts from what GET /stock reports.
    const updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    const enriched = enrichStockItem(updatedItem, tenantId)

    res.json({
      success: true,
      data: {
        ...enriched,
        id: stockItemId,
        unpackedPacks: packs,
        packFactor,
        baseUnit,
        baseLabel: getUnitDisplayName(baseUnit),
        displayUnit,
        displayLabel: getUnitDisplayName(displayUnit),
      },
    })
  } catch (error) {
    console.error('Unpack stock error:', error)
    res.status(500).json({ success: false, message: 'แกะแพ็คไม่สำเร็จ' })
  }
})

export default router
