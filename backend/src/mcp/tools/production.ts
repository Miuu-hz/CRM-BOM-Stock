import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import {
  createWorkOrder, bomMaterials, transitionWorkOrder, recordWorkOrderLot, WorkOrderTransitionError,
} from '../../services/workOrderTransition.service'
import { ok } from './shared'

function findWorkOrderByIdOrNumber(tenantId: string, woIdOrNum: string): any {
  return (
    db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woIdOrNum, tenantId)
    || db.prepare('SELECT * FROM work_orders WHERE wo_number = ? AND tenant_id = ?').get(woIdOrNum, tenantId)
  )
}

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
สถานะที่เป็นไปได้: DRAFT → PLANNED → IN_PROGRESS → COMPLETED / CANCELLED / ON_HOLD
เมื่อเปลี่ยนเป็น IN_PROGRESS ระบบจะตรวจการผูกวัตถุดิบและกฎแปลงหน่วย โดยยังไม่ตัดสต็อกจนกว่าจะบันทึกผลิตด้วย record_work_order_lot
เมื่อเปลี่ยนเป็น COMPLETED ต้องบันทึกผลิตครบตามจำนวนแล้ว หรือส่ง close_short=true เพื่อปิดงานตามยอดที่ผลิตจริง
ตัวอย่าง: "เริ่มผลิต WO-00001" → update_work_order_status(wo_id="...", status="IN_PROGRESS")`,
    {
      wo_id: z.string().describe('ID หรือ WO number ของ work order'),
      status: z.enum(['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']).describe('สถานะใหม่'),
      close_short: z.boolean().optional().describe('ปิดใบสั่งผลิตตามจำนวนที่ผลิตแล้วโดยไม่ผลิตส่วนที่เหลือ (default: false)'),
    },
    async (args) => {
      const { wo_id, status, close_short } = args
      const wo = findWorkOrderByIdOrNumber(tenantId, wo_id)
      if (!wo) {
        return ok({ success: false, message: `ไม่พบ work order: ${wo_id}` })
      }

      try {
        // MCP อยู่ภายในเทแนนต์ของผู้เรียกเสมอ (isMaster: false)
        const updated = transitionWorkOrder(
          tenantId,
          wo.id,
          status,
          { email: userId, role: callerRole, isMaster: false },
          { notify: false, closeShort: Boolean(close_short) }
        )
        return ok({
          success: true,
          woId: wo.id,
          woNumber: wo.wo_number,
          status: updated.status,
          message: `เปลี่ยนสถานะ ${wo.wo_number} เป็น ${updated.status} สำเร็จ`,
        })
      } catch (err: any) {
        if (err instanceof WorkOrderTransitionError) return ok({ success: false, message: err.message })
        throw err
      }
    }
  )

  // ── 9b. record_work_order_lot ───────────────────────────────────────────────
  server.tool(
    'record_work_order_lot',
    `บันทึกการผลิตตามล็อต (Record production lot for an IN_PROGRESS work order).
ตัดวัตถุดิบตามสัดส่วนที่ผลิตได้จริงในล็อตนี้ รับสินค้าสำเร็จรูปเข้าสต็อก และคิดต้นทุนเข้าสินค้าสำเร็จรูป (หรือค่าใช้จ่ายถ้าไม่มีของดีเข้าคลัง)
หากยอดของดีรวมของเสียครบจำนวนสั่งผลิต (และผ่าน QC gate แล้ว) ระบบจะปิดใบสั่งผลิตเป็น COMPLETED ให้อัตโนมัติ`,
    {
      wo_id: z.string().describe('ID หรือเลขที่ใบสั่งผลิต (WO number)'),
      good_qty: z.number().min(0).describe('จำนวนของดีที่ผลิตได้ในล็อตนี้'),
      scrap_qty: z.number().min(0).optional().describe('จำนวนของเสียในล็อตนี้ (default: 0)'),
      lot_number: z.string().optional().describe('เลขล็อต (ถ้าไม่ระบุ ระบบสร้างให้อัตโนมัติ เช่น WO-00001-L01)'),
      notes: z.string().optional().describe('หมายเหตุของล็อต'),
    },
    async (args) => {
      const { wo_id, good_qty, scrap_qty, lot_number, notes } = args
      const wo = findWorkOrderByIdOrNumber(tenantId, wo_id)
      if (!wo) {
        return ok({ success: false, message: `ไม่พบ work order: ${wo_id}` })
      }

      try {
        const result = recordWorkOrderLot(
          tenantId,
          wo.id,
          { goodQty: good_qty, scrapQty: scrap_qty, lotNumber: lot_number, notes },
          { email: userId, role: callerRole, isMaster: false },
          { notify: false }
        )
        return ok({
          success: true,
          woId: wo.id,
          woNumber: wo.wo_number,
          lotNumber: result.lot.lot_number,
          goodQty: result.lot.good_qty,
          scrapQty: result.lot.scrap_qty,
          completedQty: result.workOrder.completed_qty,
          totalScrapQty: result.workOrder.scrap_qty,
          remainingQty: result.workOrder.remaining_qty,
          status: result.workOrder.status,
          autoCompleted: result.autoCompleted,
          qcBlockedCompletion: result.qcBlockedCompletion ?? null,
          materialCost: result.lot.material_cost,
          message: result.autoCompleted
            ? `บันทึกล็อต ${result.lot.lot_number} และปิดใบสั่งผลิต ${wo.wo_number} สำเร็จ`
            : `บันทึกล็อต ${result.lot.lot_number} สำเร็จ (เหลือ ${result.workOrder.remaining_qty})`,
        })
      } catch (err: any) {
        if (err instanceof WorkOrderTransitionError) return ok({ success: false, message: err.message })
        throw err
      }
    }
  )
}
