import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { formatDocumentNumber } from '../utils/id'
import { lineBotService } from '../services/line-bot.service'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../services/unitConversion.service'
import { roundQty, isPositiveQty } from '../utils/qty'
import {
  restockCancelledWorkOrderMaterials, workOrderStatusError,
  woMaterialsIssued, WO_PRIVILEGED_ROLES, resolveWorkOrderCompletion,
} from '../services/stockMovement.service'
import { resolveStockItemId, StockItemRefError } from '../services/stockItem.service'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function generateWONumber(tenantId: string) {
  return formatDocumentNumber('WO', tenantId, 'WORK_ORDER', undefined, 5)
}

// GET all work orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const queryTenant = req.query.tenantId ? String(req.query.tenantId) : undefined
    const tenantId = (isMaster && queryTenant && queryTenant !== 'all') ? queryTenant : req.user!.tenantId
    const filterAll = isMaster && queryTenant === 'all'

    const orders = filterAll
      ? db.prepare(`
          SELECT wo.*,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count
          FROM work_orders wo
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all()
      : db.prepare(`
          SELECT wo.*,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count
          FROM work_orders wo
          WHERE wo.tenant_id = ?
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all(tenantId)

    res.json({ success: true, data: orders })
  } catch (error) {
    console.error('Get work orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch work orders' })
  }
})

// GET work order stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const queryTenant = req.query.tenantId ? String(req.query.tenantId) : undefined
    const tenantId = (isMaster && queryTenant && queryTenant !== 'all') ? queryTenant : req.user!.tenantId
    const filterAll = isMaster && queryTenant === 'all'

    // ปรับคำสั่ง SQL ให้นับสถานะใบสั่งผลิตให้ครบทุกตัว (DRAFT, PLANNED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED)
    // เพื่อให้ totalOrders สอดคล้องกับสถานะจริง
    const row = filterAll
      ? db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN UPPER(status) = 'DRAFT' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN UPPER(status) = 'PLANNED' THEN 1 ELSE 0 END) as planned,
            SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN UPPER(status) = 'ON_HOLD' THEN 1 ELSE 0 END) as on_hold,
            SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN UPPER(status) = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty ELSE 0 END), 0) as total_produced
          FROM work_orders
          WHERE UPPER(status) IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')
        `).get() as any
      : db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN UPPER(status) = 'DRAFT' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN UPPER(status) = 'PLANNED' THEN 1 ELSE 0 END) as planned,
            SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN UPPER(status) = 'ON_HOLD' THEN 1 ELSE 0 END) as on_hold,
            SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN UPPER(status) = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty ELSE 0 END), 0) as total_produced
          FROM work_orders
          WHERE tenant_id = ? AND UPPER(status) IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')
        `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        totalOrders: row?.total || 0,
        draft: row?.draft || 0,
        planned: row?.planned || 0,
        inProgress: row?.in_progress || 0,
        onHold: row?.on_hold || 0,
        completed: row?.completed || 0,
        cancelled: row?.cancelled || 0,
        totalProduced: row?.total_produced || 0,
      },
    })
  } catch (error) {
    console.error('Work order stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// GET single work order with materials
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = req.user!.tenantId

    const wo = (isMaster
      ? db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    const effectiveTenantId = wo.tenant_id
    const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id)
    const inspections = db.prepare('SELECT * FROM qc_inspections WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at DESC').all(req.params.id, effectiveTenantId)

    res.json({ success: true, data: { ...wo, materials, inspections } })
  } catch (error) {
    console.error('Get work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch work order' })
  }
})

// POST create work order
router.post('/', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = (isMaster && (req.body.tenantId || req.query.tenantId))
      ? String(req.body.tenantId || req.query.tenantId)
      : req.user!.tenantId

    const { bomId, productName, quantity, priority, dueDate, assignedTo, notes, materials, unit } = req.body
    if (!isPositiveQty(quantity)) {
      return res.status(400).json({ success: false, message: 'จำนวนที่ต้องการผลิตต้องเป็นตัวเลขมากกว่า 0' })
    }
    try {
      for (const m of materials || []) m.materialId = resolveStockItemId(tenantId, m.materialId, m.materialName)
    } catch (e) {
      if (e instanceof StockItemRefError) return res.status(400).json({ success: false, message: e.message })
      throw e
    }
    const id = generateId()
    const woNumber = generateWONumber(tenantId)
    const now = new Date().toISOString()

    // Calculate estimated cost
    let estimatedCost = 0
    if (materials) {
      estimatedCost = materials.reduce((sum: number, m: any) => sum + (m.requiredQty * (m.unitCost || 0)), 0)
    }

    // ถ้าไม่ส่ง unit มา ใช้หน่วยของสินค้าสำเร็จรูปจาก BOM (base_unit ก่อน แล้ว fallback unit)
    // เพื่อให้ COMPLETED ตอนปิดงานมีหน่วยอ้างอิงเสมอแม้ผู้ใช้ไม่ได้เลือกเอง
    let woUnit: string | null = unit || null
    if (!woUnit && bomId) {
      const bomProduct = db.prepare(`
        SELECT p.base_unit, p.unit FROM boms b
        LEFT JOIN stock_items p ON b.product_id = p.id
        WHERE b.id = ? AND b.tenant_id = ?
      `).get(bomId, tenantId) as any
      woUnit = bomProduct?.base_unit || bomProduct?.unit || null
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, priority, unit,
          due_date, assigned_to, notes, estimated_cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, woNumber, bomId || null, productName || '', quantity, priority || 'NORMAL', woUnit,
        dueDate || null, assignedTo || '', notes || '', estimatedCost, now, now)

      if (materials && materials.length > 0) {
        const insertMaterial = db.prepare(`
          INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `)
        for (const m of materials) {
          let unit = m.unit || ''
          if (!unit && m.materialId) {
            const stockItem = db.prepare('SELECT unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.materialId, tenantId) as any
            unit = stockItem?.unit || ''
          }
          insertMaterial.run(generateId(), tenantId, id, m.materialId || null, m.materialName || '', m.requiredQty, unit)
        }
      }
    })

    transaction()

    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const woMaterials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(id)

    // Notify via LINE Bot independently
    lineBotService.notifyWorkOrderCreated(tenantId, wo).catch(e => console.error('LINE Bot error:', e))

    res.status(201).json({ success: true, data: { ...wo, materials: woMaterials } })
  } catch (error) {
    console.error('Create work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create work order' })
  }
})

// PUT update work order status (with stock deduction)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    let tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const wo = (isMaster
      ? db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    if (isMaster && wo.tenant_id) {
      tenantId = wo.tenant_id
    }

    // ตรวจลำดับสถานะด้วยลิสต์เดียวกับฝั่ง MCP — เดิม REST ยิงข้ามขั้นได้ (DRAFT -> COMPLETED
    // = ได้สินค้าสำเร็จรูปเข้าสต็อกโดยไม่เคยเบิกวัตถุดิบ)
    if (wo) {
      const seqError = workOrderStatusError(wo.status, status)
      if (seqError) return res.status(400).json({ success: false, message: seqError })
    }

    // RBAC: CANCELLED คืนวัตถุดิบเข้าสต็อก / COMPLETED รับสินค้าสำเร็จรูปเข้าสต็อก — ทั้งคู่
    // แก้ไขสต็อกจริง (MASTER bypasses always 100%)
    if ((status === 'CANCELLED' || status === 'COMPLETED') && !isMaster && !WO_PRIVILEGED_ROLES.includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: `ไม่มีสิทธิ์${status === 'CANCELLED' ? 'ยกเลิก' : 'ปิด'}ใบสั่งผลิต — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}` })
    }

    // ponytail: ความปลอดภัยจากยิงซ้ำ (double-click / double-request) ของทั้ง endpoint นี้
    // พึ่ง better-sqlite3 แบบ synchronous ในโปรเซสเดียว (ไม่มี await ก่อน db.prepare/transaction
    // ไหนเลยในแฮนด์เลอร์นี้ + pm2 รันโหมด fork ไม่ cluster) ทำให้สอง request เรียงคิวกันเดี่ยวๆ
    // ไม่สลับกันกลางทาง — ถ้าเปลี่ยนไปเป็น cluster mode หรือ async driver (เช่น better-sqlite3
    // เวอร์ชัน async หรือ Postgres) ต้องเพิ่ม `AND status = ?` (สถานะเดิมที่อ่านมา) เข้าไปใน
    // UPDATE work_orders ทุกจุดด้านล่าง เพื่อให้ race แพ้แล้ว rowCount=0 แทนที่จะเขียนทับกัน
    const now = new Date().toISOString()
    const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id) as any[]

    // When starting production (IN_PROGRESS) - deduct materials from stock.
    // woMaterialsIssued() คือหลักฐานจริงจาก stock_movements (ไม่ใช่เดาจาก wo.status) — เดิมเช็ค
    // แค่ wo.status !== 'IN_PROGRESS' ซึ่งเป็นจริงตอน resume จาก ON_HOLD ด้วย ทำให้เบิกวัตถุดิบซ้ำ
    // รอบที่สอง (ON_HOLD -> IN_PROGRESS ต้องไม่เบิกซ้ำ เบิกแค่ตอนเริ่มครั้งแรกจาก PLANNED)
    if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS' && woMaterialsIssued(tenantId, wo.wo_number)) {
      db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    } else if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
      // When enabled, issuing materials is allowed to push stock negative
      // instead of throwing "Insufficient stock" and blocking the status change.
      const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
      const allowNegativeStock = !!negSetting && negSetting.allow_negative_stock === 1

      // Check stock availability and deduct atomically inside one transaction
      const deductStock = db.transaction(() => {
        db.prepare("UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, req.params.id, tenantId)

        for (const m of materials) {
          if (m.material_id) {
            const stock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, tenantId) as any
            if (!stock) continue

            let deductQty = m.required_qty
            let movementNotes = `Material issued for work order`

            if (m.unit && m.unit !== stock.unit) {
              const converted = convertQuantityBidirectional(Number(m.required_qty), m.unit, stock.unit, tenantId, m.material_id)
              if (!converted) {
                throw new Error(`ไม่พบการแปลงหน่วย ${m.unit} → ${stock.unit} สำหรับ ${m.material_name} กรุณาตั้งค่า Unit Conversion ก่อน`)
              }
              deductQty = converted.converted
              movementNotes = `Material issued for work order (converted: ${m.required_qty} ${m.unit} → ${converted.converted.toFixed(4)} ${stock.unit}, factor: ${converted.factor})`
            }

            // auto-unpack ถ้า quantity ไม่พอ
            const needed = roundQty(Number(deductQty))
            if (stock.quantity < needed && (stock.sealed_qty ?? 0) > 0) {
              const unpack = autoUnpackIfNeeded(stock, needed, tenantId)
              if (unpack && unpack.unpackedPacks > 0) {
                // quantity ของ stock_movements ต้องเป็น base unit (ไม่ใช่จำนวนแพ็ค) —
                // ดู unitConversion.service.ts:autoUnpackIfNeeded และ stock.routes.ts /:id/unpack
                const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
                db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                  .run(unpack.sealed_qty, unpack.quantity, now, stock.id, tenantId)
                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, 'system')`)
                  .run(generateId(), tenantId, stock.id, gained, stock.display_unit || null, unpack.unpackedPacks, `WO: ${wo.wo_number}`,
                    `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stock.display_unit} → ${gained} ${stock.unit}`, now)
                stock.quantity = unpack.quantity
              }
            }

            if (stock.quantity < needed && !allowNegativeStock) {
              throw new Error(`Insufficient stock for ${m.material_name}. Need ${needed} ${stock.unit}, have ${stock.quantity}`)
            }

            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(needed, now, stock.id, tenantId)

            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')
            `).run(generateId(), tenantId, stock.id, needed, `WO: ${wo.wo_number}`, movementNotes, now)

            db.prepare("UPDATE work_order_materials SET issued_qty = ?, status = 'ISSUED' WHERE id = ?")
              .run(m.required_qty, m.id)
          }
        }
      })

      try {
        deductStock()
      } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message })
      }
    } else if (status === 'COMPLETED' && wo.status !== 'COMPLETED') {
      // เดิมเช็คแค่ status === 'COMPLETED' — ยิง PUT status=COMPLETED ซ้ำ (สถานะเดิมอยู่แล้ว)
      // ก็ไหลเข้ามาบวกสินค้าสำเร็จรูปเข้าสต็อกซ้ำทุกครั้ง เพิ่มเงื่อนไข wo.status !== 'COMPLETED'
      // ให้เหมือนแพทเทิร์นที่ใช้กับ IN_PROGRESS ด้านบน (idempotent ตาม status เดิม)
      // QC gate + จำนวนที่ปิดงานจริง — ยกเป็นฟังก์ชันร่วมกับ mcp/tools/production.ts
      // (เดิม MCP ไม่เช็ค QC gate เลย และ REST เองก็คำนวณ qcSum มาแล้วทิ้ง ใช้ wo.completed_qty
      // ซึ่งยังเป็น 0 ตอนนี้แทน ทำให้ปิดงานได้ 0 ชิ้นเงียบๆ ทุกครั้งที่มีข้อมูล QC)
      const qcResult = resolveWorkOrderCompletion(tenantId, req.params.id, wo.quantity)
      if (qcResult.error) {
        return res.status(400).json({ success: false, message: qcResult.error })
      }
      const finalCompletedQty = qcResult.completedQty

      const completeTransaction = db.transaction(() => {
        db.prepare("UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, finalCompletedQty, now, req.params.id, tenantId)

        // Add finished product to stock
        if (wo.bom_id) {
          const bom = db.prepare('SELECT product_id FROM boms WHERE id = ? AND tenant_id = ?').get(wo.bom_id, tenantId) as any
          if (bom?.product_id) {
            const finishedStock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(bom.product_id, tenantId) as any
            if (finishedStock) {
              const stockUnit = finishedStock.base_unit || finishedStock.unit
              const woUnit = wo.unit || stockUnit

              // เดิมบวก finalCompletedQty เข้าสต็อกสินค้าสำเร็จรูปตรงๆ โดยไม่แปลงหน่วยเลย
              // ทั้งที่ขาเบิกวัตถุดิบ (IN_PROGRESS ด้านบน) แปลงหน่วยครบแล้ว — เคส "ตัดผ้าเป็น
              // เมตร (คนละ SKU หน่วยเมตร) จากม้วนผ้า" ถ้า wo.unit ต่างจากหน่วยฐานของสินค้า
              // ต้องแปลงก่อน ไม่งั้นตัวเลขที่เข้าสต็อกจะผิดหน่วยแบบเงียบๆ
              let addQty = Number(finalCompletedQty)
              let movementUnit: string | null = null
              let movementQuantity: number | null = null
              if (stockUnit && woUnit && normalizeUnit(woUnit) !== normalizeUnit(stockUnit)) {
                const converted = convertQuantityBidirectional(addQty, woUnit, stockUnit, tenantId, finishedStock.id)
                if (!converted) {
                  throw new Error(`ไม่พบการแปลงหน่วย ${woUnit} → ${stockUnit} สำหรับสินค้าสำเร็จรูป "${finishedStock.name}" กรุณาตั้งค่า Unit Conversion ก่อนปิดใบสั่งงาน`)
                }
                movementUnit = woUnit
                movementQuantity = addQty
                addQty = converted.converted
              }
              addQty = roundQty(addQty)

              db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                .run(addQty, now, finishedStock.id, tenantId)
              db.prepare(`
                INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, 'system')
              `).run(generateId(), tenantId, finishedStock.id, addQty, movementUnit, movementQuantity, `WO: ${wo.wo_number}`, 'Finished goods from production', now)
            }
          }
        }
      })
      try {
        completeTransaction()
      } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message })
      }
    } else if (status === 'CANCELLED') {
      // ผลิตเสร็จแล้ว = สินค้าสำเร็จรูปเข้าสต็อกไปแล้ว ถ้าปล่อยให้ยกเลิกได้จะคืนวัตถุดิบ
      // ทั้งที่ของสำเร็จรูปยังอยู่ = ของงอกสองต่อ (MCP บล็อกด้วย validNext อยู่แล้ว REST ไม่มี)
      if (wo.status === 'COMPLETED') {
        return res.status(400).json({ success: false, message: 'ยกเลิกใบสั่งผลิตที่ผลิตเสร็จแล้วไม่ได้ — สินค้าสำเร็จรูปเข้าสต็อกไปแล้ว' })
      }
      // เดิมยกเลิก WO ที่เบิกวัตถุดิบไปแล้ว (IN_PROGRESS) ตกมาเข้า else ท้ายสุด ไม่คืนสต็อกเลย
      // ของหายถาวร — restockCancelledWorkOrderMaterials กันคืนซ้ำเองด้วยหลักฐานใน
      // stock_movements (ดู services/stockMovement.service.ts) จึงยิง CANCELLED ซ้ำได้ปลอดภัย
      const cancelTransaction = db.transaction(() => {
        db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, req.params.id, tenantId)
        restockCancelledWorkOrderMaterials(tenantId, 'system', { id: req.params.id, wo_number: wo.wo_number })
      })
      try {
        cancelTransaction()
      } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message })
      }
    } else {
      db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updated = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)

    // Notify via LINE Bot independently
    if (updated && status !== wo.status) {
      lineBotService.notifyWorkOrderStatusChanged(tenantId, updated).catch(e => console.error('LINE Bot status change error:', e))
    }

    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update WO status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// PUT update work order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    let tenantId = req.user!.tenantId
    const { productName, quantity, priority, dueDate, assignedTo, notes, unit } = req.body
    const now = new Date().toISOString()

    // Check if work order exists and belongs to tenant
    const existing = (isMaster
      ? db.prepare('SELECT id, tenant_id FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT id, tenant_id FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }
    if (isMaster && existing.tenant_id) {
      tenantId = existing.tenant_id
    }

    // หน่วยของ WO เดิมรับเฉพาะตอนสร้าง กรอกผิดแล้วแก้ไม่ได้เลย ต้องลบทิ้งสร้างใหม่
    // ทั้งที่หน่วยเป็นตัวกำหนดว่าตอนปิดงานจะบวกสต็อกเท่าไหร่ — จำกัดไว้ที่ DRAFT/PLANNED
    // ตาม WHERE เดิม จึงแก้หลังเบิกวัตถุดิบไปแล้วไม่ได้
    const normalizedUnit = unit === undefined || unit === null || unit === '' ? null : normalizeUnit(String(unit))

    db.prepare(`
      UPDATE work_orders SET product_name = COALESCE(?, product_name), quantity = COALESCE(?, quantity),
      priority = COALESCE(?, priority), due_date = ?, assigned_to = COALESCE(?, assigned_to),
      notes = COALESCE(?, notes), unit = COALESCE(?, unit), updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('DRAFT', 'PLANNED')
    `).run(productName, quantity, priority, dueDate || null, assignedTo, notes, normalizedUnit, now, req.params.id, tenantId)

    const updatedWo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updatedWo })
  } catch (error) {
    console.error('Update work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to update work order' })
  }
})

// DELETE work order (only DRAFT)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    let tenantId = req.user!.tenantId

    const wo = (isMaster
      ? db.prepare('SELECT status, tenant_id FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT status, tenant_id FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }
    if (wo.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Can only delete draft work orders' })
    }
    if (isMaster && wo.tenant_id) {
      tenantId = wo.tenant_id
    }

    db.prepare('DELETE FROM work_order_materials WHERE work_order_id = ?').run(req.params.id)
    db.prepare('DELETE FROM work_orders WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Work order deleted' })
  } catch (error) {
    console.error('Delete work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete work order' })
  }
})

export default router
