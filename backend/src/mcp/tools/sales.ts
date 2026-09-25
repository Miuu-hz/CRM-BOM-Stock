import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { convertQuantityBidirectional, normalizeUnit } from '../../services/unitConversion.service'
import { gateOrCreate, recordAutoAction, CreateRequestArgs } from '../../services/approvalGate.service'
import { ok, matchStockItem as matchStock, bindingRow } from './shared'
import { deductStockForSO, restoreStockForSO, soStockAlreadyDeducted, createDeliveryOrderForSO, STOCK_DEDUCTED_STATUSES } from '../../routes/sales/shared'
import { formatDocumentNumber } from '../../utils/id'
import { calcDocTotals } from '../../utils/vat'
import { tenantVatInclusive } from '../../utils/vatSettings'

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
const computeTotals = (items: SalesItem[], discountAmount: number, taxRate: number, inclusive = false) => {
  const lines = items.map(i => ({ quantity: i.quantity, unitPrice: i.unitPrice, discountPercent: i.discountPercent }))
  const t = calcDocTotals(lines, { rate: taxRate, discountAmount, inclusive })
  return { subtotal: t.subtotal, taxAmount: t.taxAmount, totalAmount: t.totalAmount, inclusive }
}

const insertSoItems = (tenantId: string, soId: string, items: SalesItem[]): any[] => {
  const ins = db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '')
  `)
  const results: any[] = []
  let lineNo = 0
  for (const item of items) {
    lineNo++
    // ผูกให้เฉพาะชื่อตรงเป๊ะ — ไม่ตรงเป๊ะปล่อยว่างไว้ให้คนเลือกด้วย bind_document_item
    // (กติกาเดียวกับสายซื้อตั้งแต่เคส "ข้าวโพด" → "สลัดทูน่าข้าวโพด")
    const match = matchStock(tenantId, item.description)
    const unit = item.unit || match.exact?.unit || 'pcs'
    const lineTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100)
    ins.run(genId(), tenantId, soId, match.exact?.id ?? null, item.description, item.quantity, unit, item.unitPrice, item.discountPercent ?? 0, lineTotal)
    results.push({ บรรทัดที่: lineNo, ...bindingRow(item.description, match, unit), จำนวน: item.quantity, ราคาต่อหน่วย: item.unitPrice })
  }
  return results
}

/** หาลูกค้าจากชื่อ/รหัส ไม่เจอก็สร้างให้ — เดิมฝังอยู่ใน create_sales_order */
function resolveCustomer(tenantId: string, hintRaw?: string) {
  const hint = hintRaw || 'ลูกค้าทั่วไป'
  const now = new Date().toISOString()
  let customer = db.prepare(
    `SELECT id, name FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ?) AND status = 'ACTIVE'
     ORDER BY CASE WHEN name = ? OR code = ? THEN 0 WHEN name LIKE ? OR code LIKE ? THEN 1 ELSE 2 END, length(name)
     LIMIT 1`
  ).get(tenantId, `%${hint}%`, `%${hint}%`, hint, hint, `${hint}%`, `${hint}%`) as any
  if (customer) return { customer, created: false }

  const cusId = genId()
  let cusCode = formatDocumentNumber('CUS', tenantId, 'CUSTOMER', new Date().getFullYear(), 4)
  const codeTaken = db.prepare('SELECT 1 FROM customers WHERE tenant_id = ? AND code = ?')
  for (let i = 0; i < 50 && codeTaken.get(tenantId, cusCode); i++) {
    cusCode = formatDocumentNumber('CUS', tenantId, 'CUSTOMER', new Date().getFullYear(), 4)
  }
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, credit_limit, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'RETAIL', ?, '', '', '', 0, 'ACTIVE', ?, ?)
  `).run(cusId, tenantId, cusCode, hint, hint, now, now)
  return { customer: { id: cusId, name: hint }, created: true }
}

export function registerSalesTools(server: IMcpServer, tenantId: string, userId: string, callerName: string, callerRole: string): void {
  // ── create_quotation ────────────────────────────────────────────────────────
  // สาย MCP ออกได้แค่ "ใบเสนอราคา" เท่านั้นตามที่เจ้าของระบบกำหนด
  // ใบสั่งขาย/ใบแจ้งหนี้/รับชำระ ต้องทำในระบบเอง เพราะเป็นขั้นที่ตัดสต็อกและลงบัญชีจริง
  server.tool(
    'create_quotation',
    `สร้างใบเสนอราคา (QT) / Create a quotation.
ใช้เมื่อผู้ใช้ต้องการเสนอราคา ตีราคา หรือทำใบเสนอราคาให้ลูกค้า
⚠️ นี่คือเอกสารขายชนิดเดียวที่สร้างผ่าน AI ได้ — ใบสั่งขาย ใบแจ้งหนี้ และการรับชำระเงิน
ต้องทำในระบบเอง (ขั้นตอนเหล่านั้นตัดสต็อกและลงบัญชีจริง)
ตัวอย่าง: "เสนอราคาหมอน 50 ใบ ใบละ 250 ให้บริษัทเอบีซี" → create_quotation(items=[...], customer_hint="เอบีซี")`,
    {
      items: z.array(itemSchema).min(1).describe('รายการสินค้าที่เสนอราคา'),
      customer_hint: z.string().optional().describe('ชื่อลูกค้า — ถ้าไม่พบจะสร้างลูกค้าใหม่ให้ ถ้าไม่ระบุใช้ "ลูกค้าทั่วไป"'),
      expiry_date: z.string().optional().describe('วันหมดอายุใบเสนอราคา (YYYY-MM-DD)'),
      tax_rate: z.number().min(0).max(30).optional().describe('อัตราภาษี % (default: 0)'),
      discount_amount: z.number().min(0).optional().describe('ส่วนลดท้ายบิล (บาท)'),
      notes: z.string().optional().describe('หมายเหตุ'),
    },
    async (args) => {
      const { items, customer_hint, expiry_date, tax_rate = 0, discount_amount = 0, notes } = args
      const now = new Date().toISOString()
      const { customer, created } = resolveCustomer(tenantId, customer_hint)

      const inclusive = tenantVatInclusive(tenantId)
      const { subtotal, taxAmount, totalAmount } = computeTotals(items, discount_amount, tax_rate, inclusive)
      const id = genId()
      const qtNumber = formatDocumentNumber('QT', tenantId, 'QUOTATION', new Date().getFullYear(), 5)

      let resultItems: any[] = []
      db.transaction(() => {
        db.prepare(`
          INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
            subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive, status, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
        `).run(id, tenantId, qtNumber, customer.id, now, expiry_date ?? null,
          subtotal, discount_amount, tax_rate, taxAmount, totalAmount, inclusive ? 1 : 0, notes ?? '', now, now)

        const ins = db.prepare(`
          INSERT INTO quotation_items (id, tenant_id, quotation_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '')
        `)
        for (const item of items) {
          const match = matchStock(tenantId, item.description)
          const lineTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100)
          ins.run(genId(), tenantId, id, match.exact?.id ?? null, item.description,
            item.quantity, item.unit ?? '', item.unitPrice, item.discountPercent ?? 0, lineTotal)
          resultItems.push(bindingRow(item.description, match, item.unit ?? ''))
        }
      })()

      return ok({
        success: true,
        เลขที่ใบเสนอราคา: qtNumber,
        ลูกค้า: customer.name + (created ? ' (สร้างใหม่)' : ''),
        ยอดก่อนภาษี: subtotal,
        ภาษี: taxAmount,
        ยอดรวม: totalAmount,
        ราคารวมภาษีแล้ว: inclusive,
        รายการ: resultItems,
        message: `สร้างใบเสนอราคา ${qtNumber} ให้ ${customer.name} แล้ว ยอดรวม ฿${totalAmount.toLocaleString()} — ` +
          `ถ้าลูกค้าตกลง ให้เปิดใบสั่งขายในระบบต่อเอง (AI ออกให้ไม่ได้)`,
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

}
