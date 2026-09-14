import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, normalizeUnit } from '../../services/unitConversion.service'
import { gateOrCreate, recordAutoAction, CreateRequestArgs } from '../../services/approvalGate.service'
import { ok } from './shared'
import { deductStockForSO, restoreStockForSO, soStockAlreadyDeducted, createDeliveryOrderForSO, STOCK_DEDUCTED_STATUSES } from '../../routes/sales/shared'
import { formatDocumentNumber } from '../../utils/id'

const genId = () => randomUUID().replace(/-/g, '').substring(0, 25)

const findSalesOrder = (soId: string, tenantId: string): any => {
  let so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) so = db.prepare('SELECT * FROM sales_orders WHERE so_number = ? AND tenant_id = ?').get(soId, tenantId) as any
  return so
}

const itemSchema = z.object({
  description: z.string().describe('ชื่อสินค้า/เมนู'),
  quantity: z.number().positive(),
  unit: z.string().optional().describe('หน่วย เช่น pcs, kg, box — ถ้าไม่ระบุใช้หน่วยของ stock item ที่ match ได้'),
  unitPrice: z.number().min(0).describe('ราคาขายต่อหน่วย (บาท)'),
  discountPercent: z.number().min(0).max(100).optional().describe('ส่วนลด % ต่อรายการ'),
})

type SalesItem = z.infer<typeof itemSchema>

// จับคู่รายการขายกับ stock item — เมนู/สินค้าสำเร็จรูปมาก่อน
const matchStockItem = (tenantId: string, description: string): any =>
  db.prepare(`
    SELECT id, name, unit, quantity FROM stock_items
    WHERE tenant_id = ? AND name LIKE ? AND status = 'ACTIVE'
    ORDER BY
      CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END,
      CASE WHEN category IN ('finished','FINISHED') THEN 0 ELSE 1 END,
      length(name)
    LIMIT 1
  `).get(tenantId, `%${description}%`, description, `${description}%`) as any

const computeTotals = (items: SalesItem[], discountAmount: number, taxRate: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice * (1 - (i.discountPercent ?? 0) / 100), 0)
  const afterDiscount = subtotal - discountAmount
  const taxAmount = afterDiscount * (taxRate / 100)
  return { subtotal, taxAmount, totalAmount: afterDiscount + taxAmount }
}

const insertSoItems = (tenantId: string, soId: string, items: SalesItem[]): { description: string; matched: boolean; unit: string }[] => {
  const ins = db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '')
  `)
  const results: { description: string; matched: boolean; unit: string }[] = []
  for (const item of items) {
    const found = matchStockItem(tenantId, item.description)
    const unit = item.unit || found?.unit || 'pcs'
    const lineTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100)
    ins.run(genId(), tenantId, soId, found?.id ?? null, item.description, item.quantity, unit, item.unitPrice, item.discountPercent ?? 0, lineTotal)
    results.push({ description: item.description, matched: !!found, unit })
  }
  return results
}

export function registerSalesTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  // ── create_sales_order ──────────────────────────────────────────────────────
  server.tool(
    'create_sales_order',
    `สร้างใบสั่งขาย (SO) / Create a sales order.
ใช้เมื่อผู้ใช้ต้องการบันทึกการขาย เปิดออเดอร์ขาย หรือขายสินค้าให้ลูกค้า
ระบบจะสร้าง SO สถานะ DRAFT — ยืนยันด้วย update_sales_order_status(status="CONFIRMED") เพื่อตัดสต็อก
ตัวอย่าง: "ขายข้าวกะเพรา 3 จาน จานละ 60 ให้คุณสมชาย" → create_sales_order(items=[...], customer_hint="สมชาย")`,
    {
      items: z.array(itemSchema).min(1).describe('รายการสินค้าที่ขาย'),
      customer_hint: z.string().optional().describe('ชื่อลูกค้า — ถ้าไม่พบจะสร้างลูกค้าใหม่ให้ ถ้าไม่ระบุใช้ "ลูกค้าทั่วไป"'),
      delivery_date: z.string().optional().describe('วันที่ส่งมอบ (YYYY-MM-DD)'),
      tax_rate: z.number().min(0).max(30).optional().describe('อัตราภาษี % (default: 0)'),
      discount_amount: z.number().min(0).optional().describe('ส่วนลดท้ายบิล (บาท)'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { items, customer_hint, delivery_date, tax_rate = 0, discount_amount = 0, notes } = args
      const now = new Date().toISOString()

      // ── หาหรือสร้างลูกค้า ────────────────────────────────────────────────────
      const hint = customer_hint || 'ลูกค้าทั่วไป'
      let customer = db.prepare(
        `SELECT id, name FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE'
         ORDER BY CASE WHEN name = ? OR code = ? THEN 0 WHEN name LIKE ? OR code LIKE ? THEN 1 ELSE 2 END, length(name)
         LIMIT 1`
      ).get(tenantId, `%${hint}%`, `%${hint}%`, hint, hint, `${hint}%`, `${hint}%`) as any
      let customerCreated = false
      if (!customer) {
        const cusId = genId()
        const cusCode = formatDocumentNumber('CUS', tenantId, 'CUSTOMER', new Date().getFullYear(), 4)
        db.prepare(`
          INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, credit_limit, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'RETAIL', ?, '', '', '', 0, 'ACTIVE', ?, ?)
        `).run(cusId, tenantId, cusCode, hint, hint, now, now)
        customer = { id: cusId, name: hint }
        customerCreated = true
      }

      const id = genId()
      const soNumber = formatDocumentNumber('SO', tenantId, 'SALES_ORDER', new Date().getFullYear(), 5)
      const { subtotal, taxAmount, totalAmount } = computeTotals(items, discount_amount, tax_rate)

      let resultItems: { description: string; matched: boolean; unit: string }[] = []
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
            subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?)
        `).run(id, tenantId, soNumber, customer.id, now, delivery_date ?? null,
          subtotal, discount_amount, tax_rate, taxAmount, totalAmount, notes ?? '', now, now)
        resultItems = insertSoItems(tenantId, id, items)
      })()

      const unmatched = resultItems.filter(r => !r.matched)
      return ok({
        soNumber,
        soId: id,
        status: 'DRAFT',
        customer: { id: customer.id, name: customer.name, isNew: customerCreated },
        itemCount: items.length,
        totalAmount,
        items: resultItems,
        message: [
          `สร้างใบสั่งขาย ${soNumber} แล้ว (${items.length} รายการ มูลค่า ฿${totalAmount.toLocaleString()})`,
          customerCreated ? `— สร้างลูกค้า "${customer.name}" ใหม่` : '',
          unmatched.length > 0 ? `⚠️ ${unmatched.length} รายการไม่ตรงกับสต็อก (${unmatched.map(u => u.description).join(', ')}) — จะไม่ถูกตัดสต็อกตอนยืนยัน` : '',
          'ยืนยันด้วย update_sales_order_status(status="CONFIRMED") เพื่อตัดสต็อก',
        ].filter(Boolean).join(' '),
      })
    }
  )

  // ── get_sales_orders ────────────────────────────────────────────────────────
  server.tool(
    'get_sales_orders',
    `ดูรายการใบสั่งขาย (SO) / List sales orders with status filter.
ใช้เมื่อถามว่า "มีออเดอร์ขายอะไรบ้าง" "SO ไหนยังไม่ส่งของ" หรือหาเลข SO ก่อนแก้ไข/ยืนยัน
status: DRAFT=ร่าง, CONFIRMED=ยืนยันแล้ว(ตัดสต็อกแล้ว), PROCESSING/READY/PARTIAL/DELIVERED/COMPLETED, CANCELLED=ยกเลิก`,
    {
      status: z.enum(['DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'PARTIAL', 'DELIVERED', 'COMPLETED', 'CANCELLED']).optional()
        .describe('กรองตามสถานะ ถ้าไม่ระบุแสดงทั้งหมด'),
      limit: z.number().optional().describe('จำนวนสูงสุด (default: 20)'),
    },
    async (args) => {
      const { status, limit = 20 } = args
      const where = status ? 'AND so.status = ?' : ''
      const params: any[] = status ? [tenantId, status, limit] : [tenantId, limit]

      const rows = db.prepare(`
        SELECT so.id, so.so_number, so.status, so.payment_status, so.order_date, so.delivery_date,
               so.total_amount, so.notes, c.name as customer_name,
               (SELECT COUNT(*) FROM sales_order_items WHERE sales_order_id = so.id) as item_count
        FROM sales_orders so
        LEFT JOIN customers c ON so.customer_id = c.id
        WHERE so.tenant_id = ? ${where}
        ORDER BY so.created_at DESC
        LIMIT ?
      `).all(...params)

      return ok({ count: (rows as any[]).length, items: rows })
    }
  )

  // ── update_sales_order ──────────────────────────────────────────────────────
  server.tool(
    'update_sales_order',
    `แก้ไขใบสั่งขาย (SO) ที่สถานะ DRAFT — ใช้เมื่อข้อมูลผิดพลาดหรือต้องการแก้ไขรายการ
so_id รับได้ทั้ง UUID หรือเลขที่ SO เช่น "SO-2026-00001"
items ถ้าส่งมาจะแทนที่รายการทั้งหมด`,
    {
      so_id: z.string().describe('ID หรือเลขที่ SO เช่น SO-2026-00001'),
      customer_hint: z.string().optional().describe('ชื่อหรือรหัสลูกค้าเพื่อค้นหาและเปลี่ยน'),
      delivery_date: z.string().optional().describe('วันที่ส่งมอบ (YYYY-MM-DD)'),
      tax_rate: z.number().min(0).max(30).optional().describe('อัตราภาษี %'),
      discount_amount: z.number().min(0).optional().describe('ส่วนลดท้ายบิล (บาท)'),
      notes: z.string().optional().describe('หมายเหตุ'),
      items: z.array(itemSchema).optional().describe('รายการสินค้า — ถ้าส่งจะแทนที่รายการทั้งหมด'),
    },
    async (args) => {
      const { so_id, customer_hint, delivery_date, tax_rate, discount_amount, notes, items } = args
      const so = findSalesOrder(so_id, tenantId)
      if (!so) return ok({ success: false, message: `ไม่พบ SO: ${so_id}` })
      if (so.status !== 'DRAFT') return ok({ success: false, message: `ไม่สามารถแก้ไขได้ — SO สถานะ ${so.status} (ต้องเป็น DRAFT เท่านั้น)` })

      let customerId: string | null = null
      if (customer_hint) {
        const cus = db.prepare(
          `SELECT id FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE'
           ORDER BY CASE WHEN name = ? OR code = ? THEN 0 WHEN name LIKE ? OR code LIKE ? THEN 1 ELSE 2 END, length(name)
           LIMIT 1`
        ).get(tenantId, `%${customer_hint}%`, `%${customer_hint}%`, customer_hint, customer_hint, `${customer_hint}%`, `${customer_hint}%`) as any
        if (!cus) return ok({ success: false, message: `ไม่พบลูกค้า: ${customer_hint}` })
        customerId = cus.id
      }

      const now = new Date().toISOString()
      const taxPct = tax_rate ?? so.tax_rate ?? 0
      const discount = discount_amount ?? so.discount_amount ?? 0

      let resultItems: { description: string; matched: boolean; unit: string }[] | null = null
      db.transaction(() => {
        if (items) {
          const { subtotal, taxAmount, totalAmount } = computeTotals(items, discount, taxPct)
          db.prepare('DELETE FROM sales_order_items WHERE sales_order_id = ?').run(so.id)
          resultItems = insertSoItems(tenantId, so.id, items)
          db.prepare(`
            UPDATE sales_orders SET subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total_amount = ?, updated_at = ?
            WHERE id = ?
          `).run(subtotal, discount, taxPct, taxAmount, totalAmount, now, so.id)
        }
        db.prepare(`
          UPDATE sales_orders
          SET customer_id = COALESCE(?, customer_id), delivery_date = COALESCE(?, delivery_date),
              notes = COALESCE(?, notes), updated_at = ?
          WHERE id = ?
        `).run(customerId, delivery_date ?? null, notes ?? null, now, so.id)
      })()

      const updated = db.prepare(`
        SELECT so.*, c.name as customer_name FROM sales_orders so
        LEFT JOIN customers c ON so.customer_id = c.id WHERE so.id = ?
      `).get(so.id) as any
      const updatedItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(so.id)
      return ok({ message: `แก้ไข ${updated.so_number} สำเร็จ`, so: updated, items: updatedItems, matchResults: resultItems })
    }
  )

  // ── update_sales_order_status ───────────────────────────────────────────────
  server.tool(
    'update_sales_order_status',
    `เปลี่ยนสถานะใบสั่งขาย (SO) / Update sales order status.
CONFIRMED = ยืนยันออเดอร์ → เช็คสต็อกและตัดสต็อกทันที (จาก DRAFT เท่านั้น)
DELIVERED/COMPLETED = ส่งมอบ/จบงาน | CANCELLED = ยกเลิก
ตัวอย่าง: "ยืนยันออเดอร์ SO-2026-00001" → update_sales_order_status(so_id="SO-2026-00001", status="CONFIRMED")`,
    {
      so_id: z.string().describe('ID หรือเลขที่ SO'),
      status: z.enum(['CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'COMPLETED', 'CANCELLED'])
        .describe('สถานะใหม่'),
    },
    async (args) => {
      const { so_id, status } = args
      const so = findSalesOrder(so_id, tenantId)
      if (!so) return ok({ success: false, message: `ไม่พบ SO: ${so_id}` })
      // เดิมไม่เช็ค role เลย — REST (salesOrders.ts PUT /:id/status) บล็อก CANCELLED ไว้แค่
      // ADMIN/MANAGER/MASTER อยู่แล้ว ผู้ใช้ทั่วไปยกเลิกออเดอร์ (คืนสต็อก) ผ่าน MCP ได้ไม่ควร
      if (status === 'CANCELLED' && !['ADMIN', 'MANAGER', 'MASTER'].includes(callerRole)) {
        return ok({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกคำสั่งขาย — ต้องเป็น ADMIN/MANAGER/MASTER' })
      }
      if (so.status === status) return ok({ success: false, message: `SO อยู่ในสถานะ ${status} อยู่แล้ว` })
      if (['COMPLETED', 'CANCELLED'].includes(so.status)) {
        return ok({ success: false, message: `ไม่สามารถเปลี่ยนสถานะได้ — SO ${so.status} ไปแล้ว` })
      }
      if (status === 'CONFIRMED' && so.status !== 'DRAFT') {
        return ok({ success: false, message: `ยืนยันได้เฉพาะ SO สถานะ DRAFT (ปัจจุบัน: ${so.status})` })
      }

      // ── Approval gate: CONFIRMED transition ─────────────────────────────────
      // ประตูกลางรู้จัก ADMIN/MASTER อยู่แล้ว (คืน false/true ให้เอง) ไม่ต้องกันด้วย
      // callerRole !== 'MASTER'/'ADMIN' ซ้ำเองแบบเดิม — เก็บ gateArgs ไว้ยิง recordAutoAction
      // หลังตัดสต็อกสำเร็จด้านล่าง ถ้าผ่านมาได้เพราะ bypass (ไม่ใช่เพราะหมวดปิดอยู่)
      let confirmGateArgs: CreateRequestArgs | null = null
      if (status === 'CONFIRMED') {
        const amount = so.total_amount || 0
        const gateArgs: CreateRequestArgs = {
          tenantId,
          user: { userId, email: callerName, role: callerRole },
          category: 'sales_order',
          refType: 'sales_orders',
          refId: so.id,
          amount,
          description: `ขออนุมัติยืนยัน SO ${so.so_number} ยอด ฿${amount.toLocaleString()}`,
        }
        const pending = gateOrCreate(gateArgs)
        if (pending) {
          db.prepare("UPDATE sales_orders SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(new Date().toISOString(), so.id, tenantId)

          return ok({
            success: true,
            pending_approval: true,
            soNumber: so.so_number,
            message: `ส่งคำขออนุมัติแล้ว กรุณารอ Approver ยืนยัน (${so.so_number})`,
          })
        }
        confirmGateArgs = gateArgs
      }

      // เช็คสต็อกก่อนยืนยัน — แปลงหน่วยถ้าต่างกัน
      if (status === 'CONFIRMED') {
        const soItems = db.prepare(`
          SELECT soi.*, si.quantity as stock_qty, si.unit as stock_unit, si.base_unit as stock_base_unit,
                 COALESCE(soi.product_name, si.name) as item_name
          FROM sales_order_items soi
          LEFT JOIN stock_items si ON soi.stock_item_id = si.id
          WHERE soi.sales_order_id = ?
        `).all(so.id) as any[]

        const shortItems = soItems.filter(it => {
          if (!it.stock_item_id) return false
          let needQty = Number(it.quantity || 0)
          const soUnit = it.unit || ''
          // stock_qty (si.quantity) is in base_unit — compare/convert against base_unit,
          // not the legacy `unit` column, so the check isn't fooled the way deduction was.
          const stockUnit = it.stock_base_unit || it.stock_unit || ''
          if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
            const converted = convertQuantityBidirectional(needQty, soUnit, stockUnit, tenantId, it.stock_item_id)
            if (converted) needQty = converted.converted
          }
          return (it.stock_qty ?? 0) < needQty
        })
        if (shortItems.length > 0) {
          const details = shortItems.map((it: any) =>
            `${it.item_name || 'สินค้า'}: ต้องการ ${it.quantity} ${it.unit || ''} มีในสต็อก ${it.stock_qty ?? 0} ${it.stock_unit || ''}`).join(', ')
          return ok({ success: false, message: `สต็อกไม่เพียงพอ: ${details}` })
        }
      }

      const now = new Date().toISOString()
      const previousStatus = so.status
      db.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(status, now, so.id, tenantId)

      let stockDeducted = false
      if (status === 'CONFIRMED' && !soStockAlreadyDeducted(tenantId, so.so_number)) {
        try {
          // ใช้ deductStockForSO ตัวจริงจาก routes/sales/shared (atomic, ปัดเศษ roundQty,
          // throw เมื่อแปลงหน่วยไม่ได้/ของไม่พอ, แกะแพ็คอัตโนมัติ) — เดิม MCP มีสำเนาของตัวเอง
          // ที่หย่อนกว่า (เงียบเมื่อแปลงหน่วยไม่ได้, floor ปัดเศษหาย, ไม่ atomic)
          deductStockForSO(tenantId, so.id, so.so_number)
          stockDeducted = true
        } catch (err: any) {
          // ตัวจริง throw แทนที่จะเงียบ — ย้อนสถานะกลับที่เดิม (previousStatus คือค่าก่อนยืนยัน
          // เพราะเช็คไปแล้วว่าต้องเป็น DRAFT ก่อนเข้ามาถึงตรงนี้) ไม่ให้ SO ค้าง CONFIRMED
          // ทั้งที่ไม่เคยตัดสต็อกจริง
          db.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(previousStatus, new Date().toISOString(), so.id, tenantId)
          return ok({ success: false, message: `ยืนยันไม่สำเร็จ: ${err?.message || 'ตัดสต็อกไม่ได้'}` })
        }
        if (confirmGateArgs) recordAutoAction(confirmGateArgs)
      }

      // คืนสต็อกเมื่อยกเลิก SO ที่เคยตัดสต็อกไปแล้ว — REST (salesOrders.ts PUT /:id/status)
      // ทำอยู่แล้ว แต่ MCP เดิมแค่เปลี่ยนสถานะเฉยๆ ไม่คืนสต็อก ยกเลิกผ่าน AI แล้วสต็อกค้างหาย
      let stockRestored = false
      if (status === 'CANCELLED' && STOCK_DEDUCTED_STATUSES.includes(previousStatus)) {
        restoreStockForSO(tenantId, so.id, so.so_number)
        stockRestored = true
      }

      // ออกใบส่งของอัตโนมัติเมื่อส่งของ/จบงาน — ให้ตรงกับ REST เดิม MCP ไม่เคยเรียกเลย
      // SO ที่ยืนยัน+ส่งของผ่าน AI ทั้งเส้นจะไม่มีใบส่งของเกิดขึ้นเลยแม้แต่ใบเดียว
      if (status === 'DELIVERED' || status === 'COMPLETED') {
        try {
          createDeliveryOrderForSO(tenantId, so.id, {
            createdBy: userId,
            notes: `ออกอัตโนมัติเมื่อคำสั่งขาย ${so.so_number} เปลี่ยนเป็น${status === 'COMPLETED' ? 'เสร็จสิ้น' : 'ส่งของแล้ว'}`,
          })
        } catch (e) {
          // ออกใบไม่สำเร็จต้องไม่ทำให้การเปลี่ยนสถานะล้มไปด้วย สถานะสำคัญกว่าตัวเอกสาร
          console.error('auto delivery order failed:', e)
        }
      }

      return ok({
        success: true,
        soNumber: so.so_number,
        status,
        message: `เปลี่ยนสถานะ ${so.so_number} เป็น ${status} สำเร็จ${stockDeducted ? ' — ตัดสต็อกแล้ว' : ''}${stockRestored ? ' — คืนสต็อกแล้ว' : ''}`,
      })
    }
  )
}
