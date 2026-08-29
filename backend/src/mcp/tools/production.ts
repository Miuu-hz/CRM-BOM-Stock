import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'
import { ok } from './shared'

export function registerProductionTools(server: IMcpServer, tenantId: string, userId: string): void {
  // ── 8. create_work_order ────────────────────────────────────────────────────
  server.tool(
    'create_work_order',
    `สร้างใบสั่งผลิต (Work Order) / Create a work order for production.
ใช้เมื่อต้องการสั่งผลิตสินค้าตาม BOM หรือสั่งผลิตโดยตรง
ถ้ามี bom_id ระบบจะดึงวัตถุดิบจาก BOM อัตโนมัติ
ตัวอย่าง: "สั่งผลิตข้าวกะเพรา 20 จาน" → create_work_order(bom_id="...", product_name="ข้าวกะเพรา", quantity=20)`,
    {
      bom_id: z.string().optional().describe('ID ของ BOM (optional)'),
      product_name: z.string().describe('ชื่อสินค้าที่ต้องการผลิต'),
      quantity: z.number().describe('จำนวนที่ต้องการผลิต'),
      unit: z.string().optional().describe('หน่วยของ quantity (ถ้าไม่ระบุ ใช้หน่วยของสินค้าสำเร็จรูปจาก BOM)'),
      priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional().describe('ความสำคัญ (default: NORMAL)'),
      due_date: z.string().optional().describe('กำหนดเสร็จ (ISO date)'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { bom_id, product_name, quantity, unit, priority, due_date, notes } = args

      const id = randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ?').get(tenantId) as any).count
      const woNumber = `WO-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()

      let materials: any[] = []
      let estimatedCost = 0
      // ถ้าไม่ระบุ unit ใช้หน่วยของสินค้าสำเร็จรูปจาก BOM — ให้พฤติกรรมตรงกับ workOrder.routes.ts
      let woUnit: string | null = unit || null

      if (bom_id) {
        const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(bom_id, tenantId) as any
        if (!bom) {
          return ok({ success: false, message: `ไม่พบ BOM: ${bom_id}` })
        }
        if (!woUnit && bom.product_id) {
          const bomProduct = db.prepare('SELECT base_unit, unit FROM stock_items WHERE id = ?').get(bom.product_id) as any
          woUnit = bomProduct?.base_unit || bomProduct?.unit || null
        }
        const bomItems = db.prepare(`
          SELECT bi.*, m.name as material_name, m.unit as material_unit, m.unit_cost
          FROM bom_items bi
          LEFT JOIN stock_items m ON bi.material_id = m.id
          WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'
        `).all(bom_id) as any[]

        for (const bi of bomItems) {
          const requiredQty = bi.quantity * quantity
          materials.push({
            materialId: bi.material_id,
            materialName: bi.material_name,
            requiredQty: requiredQty,
            unit: bi.unit || bi.material_unit || 'pcs',
            unitCost: bi.unit_cost || 0,
          })
          estimatedCost += requiredQty * (bi.unit_cost || 0)
        }
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, priority, unit,
            due_date, notes, estimated_cost, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)
        `).run(id, tenantId, woNumber, bom_id || null, product_name, quantity,
          priority || 'NORMAL', woUnit, due_date || null, notes || '', estimatedCost, now, now)

        if (materials.length > 0) {
          const insertMaterial = db.prepare(`
            INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
          `)
          for (const m of materials) {
            insertMaterial.run(
              randomUUID().replace(/-/g, '').substring(0, 25),
              tenantId, id, m.materialId, m.materialName, m.requiredQty, m.unit
            )
          }
        }
      })()

      return ok({
        success: true,
        woNumber,
        woId: id,
        status: 'DRAFT',
        productName: product_name,
        quantity,
        materialCount: materials.length,
        estimatedCost,
        message: `สร้างใบสั่งผลิต ${woNumber} สำเร็จ (${materials.length} รายการวัตถุดิบ)`,
      })
    }
  )

  // ── 9. update_work_order_status ─────────────────────────────────────────────
  server.tool(
    'update_work_order_status',
    `เปลี่ยนสถานะใบสั่งผลิต / Update work order status.
สถานะที่เป็นไปได้: DRAFT → PLANNED → IN_PROGRESS → COMPLETED → CANCELLED
เมื่อเปลี่ยนเป็น IN_PROGRESS ระบบจะเบิกวัตถุดิบจากสต็อกอัตโนมัติ
เมื่อเปลี่ยนเป็น COMPLETED ระบบจะรับสินค้าสำเร็จรูปเข้าสต็อก
ตัวอย่าง: "เริ่มผลิต WO-00001" → update_work_order_status(wo_id="...", status="IN_PROGRESS")`,
    {
      wo_id: z.string().describe('ID หรือ WO number ของ work order'),
      status: z.enum(['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']).describe('สถานะใหม่'),
    },
    async (args) => {
      const { wo_id, status } = args

      let wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(wo_id, tenantId) as any
      if (!wo) {
        wo = db.prepare('SELECT * FROM work_orders WHERE wo_number = ? AND tenant_id = ?').get(wo_id, tenantId) as any
      }
      if (!wo) {
        return ok({ success: false, message: `ไม่พบ work order: ${wo_id}` })
      }

      // Enforce valid status transitions
      const validNext: Record<string, string[]> = {
        DRAFT:       ['PLANNED', 'CANCELLED'],
        PLANNED:     ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
        IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'ON_HOLD'],
        ON_HOLD:     ['IN_PROGRESS', 'CANCELLED'],
        COMPLETED:   [],
        CANCELLED:   [],
      }
      const allowed = validNext[wo.status] ?? []
      if (!allowed.includes(status)) {
        return ok({ success: false, message: `ไม่สามารถเปลี่ยนสถานะจาก ${wo.status} เป็น ${status} ได้ (อนุญาต: ${allowed.join(', ') || 'ไม่มี'})` })
      }

      const now = new Date().toISOString()
      const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(wo.id) as any[]

      // When starting production - deduct materials from stock
      if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
        // ทั้งก้อนต้อง atomic: เดิมถ้าวัตถุดิบตัวที่ 3 พัง ตัวที่ 1-2 ถูกตัดสต็อกไปแล้วและค้างอยู่
        const issueMaterials = db.transaction(() => {
        for (const m of materials) {
          if (m.material_id) {
            const stock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, tenantId) as any
            if (!stock) continue

            let deductQty = m.required_qty
            let movementNotes = `Material issued for work order ${wo.wo_number}`

            if (m.unit && m.unit !== stock.unit) {
              const converted = convertQuantityBidirectional(Number(m.required_qty), m.unit, stock.unit, tenantId, m.material_id)
              // เดิมถ้าแปลงไม่ได้จะเงียบแล้วตัดตัวเลขดิบข้ามหน่วย (เบิก 500 g กลายเป็นตัด 500 kg)
              // route หลัก workOrder.routes.ts throw ทิ้งไปแล้ว ที่นี่ต้องทำเหมือนกัน
              if (!converted) {
                throw new Error(`ไม่พบการแปลงหน่วย ${m.unit} → ${stock.unit} สำหรับ ${m.material_name} กรุณาตั้งค่า Unit Conversion ก่อน`)
              }
              deductQty = converted.converted
              movementNotes += ` (converted: ${m.required_qty} ${m.unit} → ${converted.converted.toFixed(4)} ${stock.unit}, factor: ${converted.factor})`
            }

            // เดิมใช้ Math.floor ทำให้หน่วยต่อเนื่องโดนตัดทิ้ง (ต้องเบิก 2.5 kg ตัดจริงแค่ 2 kg
            // สต็อกค้างเกินจริงสะสม) — ใช้ roundQty เหมือน workOrder.routes.ts
            const needed = roundQty(Number(deductQty))
            if (stock.quantity < needed && (stock.sealed_qty ?? 0) > 0) {
              const unpack = autoUnpackIfNeeded(stock, needed, tenantId)
              if (unpack && unpack.unpackedPacks > 0) {
                // quantity ต้องเป็น base unit เสมอ (ไม่ใช่จำนวนแพ็ค) — ดู stock.routes.ts /:id/unpack
                const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
                db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ?')
                  .run(unpack.sealed_qty, unpack.quantity, now, stock.id)
                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)`)
                  .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stock.id, gained, stock.display_unit || null, unpack.unpackedPacks,
                    `WO: ${wo.wo_number}`, `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stock.display_unit} → ${gained} ${stock.unit}`, now, userId)
                stock.quantity = unpack.quantity
              }
            }

            if (stock.quantity < needed) {
              throw new Error(`สต็อกไม่พอสำหรับ ${m.material_name}: ต้องการ ${needed} ${stock.unit} มี ${stock.quantity}`)
            }

            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(needed, now, stock.id)
            db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)`)
              .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, stock.id, needed,
                `WO: ${wo.wo_number}`, movementNotes, now, userId)
            db.prepare("UPDATE work_order_materials SET issued_qty = ?, status = 'ISSUED' WHERE id = ?")
              .run(m.required_qty, m.id)
          }
        }

        db.prepare("UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, wo.id, tenantId)
        })

        try {
          issueMaterials()
        } catch (err: any) {
          return ok({ success: false, message: err?.message || 'เบิกวัตถุดิบไม่สำเร็จ' })
        }
      } else if (status === 'COMPLETED') {
        // หาแปลงหน่วยผลผลิตให้เสร็จก่อนเขียน DB ใดๆ (ต่างจากเดิมที่ตั้ง status COMPLETED
        // ก่อนเสมอ) เพื่อไม่ให้ใบสั่งงานถูกปิดไปแล้วแต่สต็อกเข้าไม่ได้เพราะแปลงหน่วยไม่ได้
        let finishedStock: any = null
        let addQty = Number(wo.quantity)
        let movementUnit: string | null = null
        let movementQuantity: number | null = null

        if (wo.bom_id) {
          const bom = db.prepare('SELECT product_id FROM boms WHERE id = ?').get(wo.bom_id) as any
          if (bom?.product_id) {
            finishedStock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(bom.product_id, tenantId) as any
            if (finishedStock) {
              const stockUnit = finishedStock.base_unit || finishedStock.unit
              const woUnit = wo.unit || stockUnit
              // เดิมบวก wo.quantity เข้าสต็อกตรงๆ ไม่แปลงหน่วยเลย (เคส "ตัดผ้าเป็นเมตร
              // คนละ SKU จากม้วนผ้า" ผลิตได้คนละหน่วยกับที่กรอกใน WO)
              if (stockUnit && woUnit && normalizeUnit(woUnit) !== normalizeUnit(stockUnit)) {
                const converted = convertQuantityBidirectional(addQty, woUnit, stockUnit, tenantId, finishedStock.id)
                if (!converted) {
                  return ok({ success: false, message: `ไม่พบการแปลงหน่วย ${woUnit} → ${stockUnit} สำหรับสินค้าสำเร็จรูป "${finishedStock.name}" กรุณาตั้งค่า Unit Conversion ก่อนปิดใบสั่งงาน` })
                }
                movementUnit = woUnit
                movementQuantity = addQty
                addQty = converted.converted
              }
              addQty = roundQty(addQty)
            }
          }
        }

        db.transaction(() => {
          db.prepare("UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = quantity, updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(status, now, now, wo.id, tenantId)

          // Add finished product to stock
          if (finishedStock) {
            db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
              .run(addQty, now, finishedStock.id)
            db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)`)
              .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, finishedStock.id, addQty, movementUnit, movementQuantity,
                `WO: ${wo.wo_number}`, 'Finished goods from production', now, userId)
          }
        })()
      } else {
        db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, wo.id, tenantId)
      }

      const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(wo.id)
      return ok({ success: true, woId: wo.id, woNumber: wo.wo_number, status, message: `เปลี่ยนสถานะ ${wo.wo_number} เป็น ${status} สำเร็จ` })
    }
  )
}
