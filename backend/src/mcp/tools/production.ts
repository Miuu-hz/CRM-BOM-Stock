import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'
import {
  restockCancelledWorkOrderMaterials, workOrderStatusError,
  woMaterialsIssued, WO_PRIVILEGED_ROLES, resolveWorkOrderCompletion, settleWorkOrderCost,
} from '../../services/stockMovement.service'
import {
  createWorkOrder, bomMaterials, assertMaterialsLinked, workOrderProductId, WorkOrderTransitionError,
} from '../../services/workOrderTransition.service'
import { ok } from './shared'

export function registerProductionTools(server: IMcpServer, tenantId: string, userId: string, callerRole: string): void {
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
      quantity: z.number().positive().describe('จำนวนที่ต้องการผลิต (ต้องมากกว่า 0)'),
      unit: z.string().optional().describe('หน่วยของ quantity (ถ้าไม่ระบุ ใช้หน่วยของสินค้าสำเร็จรูปจาก BOM)'),
      priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional().describe('ความสำคัญ (default: NORMAL)'),
      due_date: z.string().optional().describe('กำหนดเสร็จ (ISO date)'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { bom_id, product_name, quantity, unit, priority, due_date, notes } = args
      let wo: any
      try {
        wo = createWorkOrder(tenantId, {
          bomId: bom_id, productName: product_name, quantity, unit, priority, dueDate: due_date, notes,
          materials: bom_id ? bomMaterials(tenantId, bom_id, quantity, unit) : [],
        }, { notify: false })
      } catch (err: any) {
        if (err instanceof WorkOrderTransitionError) return ok({ success: false, message: err.message })
        throw err
      }
      const woNumber = wo.wo_number

      return ok({
        success: true,
        woNumber,
        woId: wo.id,
        status: 'DRAFT',
        productName: product_name,
        quantity,
        materialCount: wo.materials.length,
        estimatedCost: wo.estimated_cost,
        message: `สร้างใบสั่งผลิต ${woNumber} สำเร็จ (${wo.materials.length} รายการวัตถุดิบ)`,
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
      // ลิสต์ลำดับสถานะอยู่ที่ services/stockMovement.service.ts ที่เดียว ใช้ร่วมกับ REST
      const seqError = workOrderStatusError(wo.status, status)
      if (seqError) return ok({ success: false, message: seqError })

      // RBAC: เหมือน workOrder.routes.ts (REST) — CANCELLED คืนวัตถุดิบ / COMPLETED รับสินค้า
      // สำเร็จรูป ทั้งคู่แก้สต็อกจริง เดิมทาง MCP ไม่เช็ค role เลย (ดู project_erp_rbac_cancel_gap)
      if ((status === 'CANCELLED' || status === 'COMPLETED') && !WO_PRIVILEGED_ROLES.includes(callerRole)) {
        return ok({ success: false, message: `ไม่มีสิทธิ์${status === 'CANCELLED' ? 'ยกเลิก' : 'ปิด'}ใบสั่งผลิต — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}` })
      }

      const now = new Date().toISOString()
      const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(wo.id) as any[]

      // When starting production - deduct materials from stock. woMaterialsIssued() คือ
      // หลักฐานจริงจาก stock_movements — เดิมเช็คแค่ wo.status !== 'IN_PROGRESS' ซึ่งเป็นจริง
      // ตอน resume จาก ON_HOLD ด้วย ทำให้เบิกวัตถุดิบซ้ำรอบที่สอง (เบิกแค่ตอนเริ่มครั้งแรกจาก PLANNED)
      if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS' && woMaterialsIssued(tenantId, wo.wo_number)) {
        db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, wo.id, tenantId)
      } else if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
        // ทั้งก้อนต้อง atomic: เดิมถ้าวัตถุดิบตัวที่ 3 พัง ตัวที่ 1-2 ถูกตัดสต็อกไปแล้วและค้างอยู่
        const issueMaterials = db.transaction(() => {
        assertMaterialsLinked(tenantId, materials)
        const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
        const allowNegativeStock = negSetting?.allow_negative_stock === 1
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

            if (stock.quantity < needed && !allowNegativeStock) {
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
      } else if (status === 'COMPLETED' && wo.status !== 'COMPLETED') {
        // เดิมไม่เช็ค wo.status !== 'COMPLETED' เลย (ต่างจาก REST ที่แก้ไปแล้ว 2026-09-13) —
        // ยิง COMPLETED ซ้ำ (seqError อนุญาต from===to) บวกสินค้าสำเร็จรูปเข้าสต็อกซ้ำทุกครั้ง
        //
        // QC gate + จำนวนที่ปิดงานจริง — ใช้ฟังก์ชันร่วมกับ workOrder.routes.ts (REST) เดิม MCP
        // ไม่เช็ค QC gate เลยทั้งที่ REST บล็อกไว้ และปิดงานเต็ม wo.quantity เสมอไม่ว่า QC จะผ่าน
        // เท่าไหร่ (เดิม completed_qty = quantity ตรงๆ ที่ SQL ด้านล่าง)
        const qcResult = resolveWorkOrderCompletion(tenantId, wo.id, wo.quantity)
        if (qcResult.error) {
          return ok({ success: false, message: qcResult.error })
        }
        const finalCompletedQty = qcResult.completedQty

        // หาแปลงหน่วยผลผลิตให้เสร็จก่อนเขียน DB ใดๆ (ต่างจากเดิมที่ตั้ง status COMPLETED
        // ก่อนเสมอ) เพื่อไม่ให้ใบสั่งงานถูกปิดไปแล้วแต่สต็อกเข้าไม่ได้เพราะแปลงหน่วยไม่ได้
        let finishedStock: any = null
        let addQty = Number(finalCompletedQty)
        let movementUnit: string | null = null
        let movementQuantity: number | null = null

        const productId = workOrderProductId(tenantId, wo)
        finishedStock = productId ? db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, tenantId) as any : null
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

        db.transaction(() => {
          db.prepare("UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(status, now, finalCompletedQty, now, wo.id, tenantId)

          // Add finished product to stock
          if (finishedStock) {
            db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
              .run(addQty, now, finishedStock.id)
            db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)`)
              .run(randomUUID().replace(/-/g, '').substring(0, 25), tenantId, finishedStock.id, addQty, movementUnit, movementQuantity,
                `WO: ${wo.wo_number}`, 'Finished goods from production', now, userId)
          }
          // ต้นทุนวัตถุดิบที่เบิกไป → ต้นทุนสินค้าสำเร็จรูป (ฟังก์ชันร่วมกับ REST)
          settleWorkOrderCost(tenantId, userId, { id: wo.id, wo_number: wo.wo_number },
            finishedStock ? { id: finishedStock.id, addQty } : null)
        })()
      } else if (status === 'CANCELLED') {
        // เดิมยกเลิก WO ที่เบิกวัตถุดิบไปแล้ว (IN_PROGRESS) ตกเข้า else ท้ายสุด ไม่คืนสต็อกเลย
        // ใช้ฟังก์ชันร่วมกับ workOrder.routes.ts (services/stockMovement.service.ts) กันคืนซ้ำ
        // ด้วยหลักฐานใน stock_movements เอง ไม่ต้องพึ่ง validNext state machine ด้านบน
        db.transaction(() => {
          db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(status, now, wo.id, tenantId)
          restockCancelledWorkOrderMaterials(tenantId, userId, { id: wo.id, wo_number: wo.wo_number })
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
