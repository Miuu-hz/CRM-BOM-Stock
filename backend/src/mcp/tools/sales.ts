import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional } from '../../services/unitConversion.service'
import { ok } from './shared'

const genId = () => randomUUID().replace(/-/g, '').substring(0, 25)

const genNumber = (prefix: string, tenantId: string, table: string): string => {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE tenant_id = ?`).get(tenantId) as { c: number }).c
  return `${prefix}-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
}

const findSalesOrder = (soId: string, tenantId: string): any => {
  let so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) so = db.prepare('SELECT * FROM sales_orders WHERE so_number = ? AND tenant_id = ?').get(soId, tenantId) as any
  return so
}

// ตัดสต็อกเมื่อยืนยัน SO — คัดลอก logic จาก sales.routes.ts (deductStockForSO)
const deductStockForSO = (tenantId: string, soId: string, soNumber: string, userId: string): void => {
  const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]
  for (const item of items) {
    const stockItemId = item.stock_item_id
    if (!stockItemId) continue
    let qty = Number(item.quantity || 0)
    if (qty <= 0) continue

    const stockItem = db.prepare('SELECT unit FROM stock_items WHERE id = ?').get(stockItemId) as any
    const soUnit = item.unit || ''
    const stockUnit = stockItem?.unit || ''
    if (soUnit && stockUnit && soUnit !== stockUnit) {
      const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId)
      if (converted) qty = converted.converted
    }

    const deductQty = Math.floor(qty)
    const now = new Date().toISOString()
    db.prepare('UPDATE stock_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(deductQty, now, stockItemId, tenantId)
    db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)`).run(
      genId(), tenantId, stockItemId, deductQty, `SO: ${soNumber}`,
      `ขายสินค้า SO ${soNumber}${soUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${soUnit} → ${deductQty} ${stockUnit})` : ''}`,
      now, userId)
  }
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
    ORDER BY CASE WHEN category IN ('finished','FINISHED') THEN 0 ELSE 1 END
    LIMIT 1
  `).get(tenantId, `%${description}%`) as any

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

export function registerSalesTools(server: IMcpServer, tenantId: string, userId: string): void {
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
        `SELECT id, name FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE' LIMIT 1`
      ).get(tenantId, `%${hint}%`, `%${hint}%`) as any
      let customerCreated = false
      if (!customer) {
        const cusCount = (db.prepare('SELECT COUNT(*) as c FROM customers WHERE tenant_id = ?').get(tenantId) as any).c
        const cusId = genId()
        db.prepare(`
          INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, credit_limit, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'RETAIL', ?, '', '', '', 0, 'ACTIVE', ?, ?)
        `).run(cusId, tenantId, `CUS-${new Date().getFullYear()}-${String(cusCount + 1).padStart(4, '0')}`, hint, hint, now, now)
        customer = { id: cusId, name: hint }
        customerCreated = true
      }

      const id = genId()
      const soNumber = genNumber('SO', tenantId, 'sales_orders')
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
          `SELECT id FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE' LIMIT 1`
        ).get(tenantId, `%${customer_hint}%`, `%${customer_hint}%`) as any
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
      if (so.status === status) return ok({ success: false, message: `SO อยู่ในสถานะ ${status} อยู่แล้ว` })
      if (['COMPLETED', 'CANCELLED'].includes(so.status)) {
        return ok({ success: false, message: `ไม่สามารถเปลี่ยนสถานะได้ — SO ${so.status} ไปแล้ว` })
      }
      if (status === 'CONFIRMED' && so.status !== 'DRAFT') {
        return ok({ success: false, message: `ยืนยันได้เฉพาะ SO สถานะ DRAFT (ปัจจุบัน: ${so.status})` })
      }

      // เช็คสต็อกก่อนยืนยัน — แปลงหน่วยถ้าต่างกัน
      if (status === 'CONFIRMED') {
        const soItems = db.prepare(`
          SELECT soi.*, si.quantity as stock_qty, si.unit as stock_unit, COALESCE(soi.product_name, si.name) as item_name
          FROM sales_order_items soi
          LEFT JOIN stock_items si ON soi.stock_item_id = si.id
          WHERE soi.sales_order_id = ?
        `).all(so.id) as any[]

        const shortItems = soItems.filter(it => {
          if (!it.stock_item_id) return false
          let needQty = Number(it.quantity || 0)
          const soUnit = it.unit || ''
          const stockUnit = it.stock_unit || ''
          if (soUnit && stockUnit && soUnit !== stockUnit) {
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
      db.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(status, now, so.id, tenantId)

      if (status === 'CONFIRMED') {
        deductStockForSO(tenantId, so.id, so.so_number, userId)
      }

      return ok({
        success: true,
        soNumber: so.so_number,
        status,
        message: `เปลี่ยนสถานะ ${so.so_number} เป็น ${status} สำเร็จ${status === 'CONFIRMED' ? ' — ตัดสต็อกแล้ว' : ''}`,
      })
    }
  )
}
