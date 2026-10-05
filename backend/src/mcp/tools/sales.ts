import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { randomUUID } from 'crypto'
import { normalizeUnit, convertQuantityBidirectional } from '../../services/unitConversion.service'
import { ok, matchStockItem as matchStock, bindingRow, StockMatch } from './shared'
import { findNonSellableLine, notSellableMessage } from '../../routes/sales/shared'
import { formatDocumentNumber } from '../../utils/id'
import { calcDocTotals } from '../../utils/vat'
import { tenantVatInclusive } from '../../utils/vatSettings'
import { isVatRegistered, rememberContactVatMode } from '../../services/accounting.service'

const genId = () => randomUUID().replace(/-/g, '').substring(0, 25)

/**
 * หน่วยเริ่มต้นเมื่อ AI ไม่ได้ระบุมา — ใช้หน่วยขาย/หน่วยฐานของสินค้าที่ผูกได้ ไม่ใช่คอลัมน์
 * `unit` เดิม (คอลัมน์เก่าก่อนย้ายมาเป็น base/sale/display unit อาจคนละหน่วยกับของจริง
 * ดู deductStockForSO ใน routes/sales/shared.ts — กับดักเดียวกัน) ไม่มี stock item ผูกไว้
 * (บรรทัด free text) fallback เป็น 'pcs'
 */
function defaultLineUnit(tenantId: string, stockItemId: string | null): string {
  if (!stockItemId) return 'pcs'
  const row = db.prepare('SELECT sale_unit, base_unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
  return row?.sale_unit || row?.base_unit || 'pcs'
}

const itemSchema = z.object({
  description: z.string().describe('ชื่อสินค้า/เมนู'),
  quantity: z.number().positive(),
  unit: z.string().optional().describe('หน่วย เช่น pcs, kg, box — ถ้าไม่ระบุใช้หน่วยของ stock item ที่ match ได้'),
  unitPrice: z.number().min(0).optional().describe('ราคาขายต่อหน่วย (บาท) — ถ้าไม่ระบุและบรรทัดนี้ผูกกับสินค้าในสต็อกได้ จะคิดให้จาก stock_items.unit_price (ต่อหน่วยฐาน) คูณตัวแปลงหน่วย; บรรทัดที่ไม่ผูกสินค้า (free text) ต้องระบุเอง'),
  discountPercent: z.number().min(0).max(100).optional().describe('ส่วนลด % ต่อรายการ'),
})

type SalesItem = z.infer<typeof itemSchema>
// หลังผ่านด่านเติมราคาเริ่มต้นแล้ว (ดู create_quotation) unitPrice การันตีว่าไม่ใช่ undefined
type PricedItem = SalesItem & { unitPrice: number }

// จับคู่รายการขายกับ stock item — เมนู/สินค้าสำเร็จรูปมาก่อน
const computeTotals = (items: PricedItem[], discountAmount: number, taxRate: number, inclusive = false) => {
  const lines = items.map(i => ({ quantity: i.quantity, unitPrice: i.unitPrice, discountPercent: i.discountPercent }))
  const t = calcDocTotals(lines, { rate: taxRate, discountAmount, inclusive })
  return { subtotal: t.subtotal, taxAmount: t.taxAmount, totalAmount: t.totalAmount, inclusive }
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

      // ยังไม่จด VAT = ห้ามเก็บ VAT จากลูกค้า (ม.85) · เช็คก่อนออกเลขเอกสาร ไม่งั้นโดนปฏิเสธแล้วเลขที่จองไว้หาย
      // (กติกาเดียวกับ routes/sales/quotations.ts — สาย MCP เดิมไม่มีการ์กนี้เลย)
      if (tax_rate > 0 && !isVatRegistered(tenantId)) {
        return ok({ success: false, code: 'VAT_NOT_REGISTERED', message: 'กิจการยังไม่จดทะเบียน VAT — ขายแบบมี VAT ไม่ได้ (เปลี่ยนได้ที่ ตั้งค่า > ข้อมูลบริษัท)' })
      }

      // จับคู่สินค้าทุกบรรทัดก่อนออกเลขเอกสาร — ผูกให้เฉพาะชื่อตรงเป๊ะ (กติกาเดียวกับสายซื้อ
      // ตั้งแต่เคส "ข้าวโพด" → "สลัดทูน่าข้าวโพด") แล้วเช็คว่าขายได้ไหมด้วยการ์ดเดียวกับ REST
      // (routes/sales/shared.ts findNonSellableLine) — ไม่งั้น AI ขายวัตถุดิบหลุดไปได้ทาง MCP
      // ทั้งที่ REST ปิดแล้ว (ดู [[project_erp_mcp_parity]])
      const matches: StockMatch[] = items.map((i: SalesItem) => matchStock(tenantId, i.description))
      const badLine = findNonSellableLine(tenantId, matches.map((m: StockMatch) => m.exact?.id ?? null))
      if (badLine) {
        return ok({ success: false, code: 'ITEM_NOT_SELLABLE', message: notSellableMessage(badLine.name, badLine.category) })
      }

      // unitPrice ไม่ระบุมา (AI ไม่รู้ราคา) → ถ้าบรรทัดผูกกับ stock item ได้ ตั้งราคาให้จาก
      // stock_items.unit_price (เก็บต่อ "หน่วยฐาน" เสมอ — ดู [[project_erp_unit_three_tier]])
      // คูณตัวแปลงหน่วยจากหน่วยที่ขาย (unit ของบรรทัด) ไปหน่วยฐาน เช่น 1 แพ็ค = 6 ชิ้น,
      // ฐาน 29/ชิ้น → 174/แพ็ค ใช้ resolver ตัวเดียวกับฝั่ง REST (convertQuantityBidirectional)
      // ไม่มีกฎแปลง → เดาเป็น factor 1 ไม่ได้ (ราคาเพี้ยนเงียบๆ) ต้องให้ผู้เรียกระบุ unitPrice เอง
      // บรรทัดไม่ผูกสินค้า (free text) ก็ยังต้องระบุ unitPrice เสมอ — ไม่มีฐานให้เดา
      const pricedItems: PricedItem[] = []
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        if (item.unitPrice != null) { pricedItems.push({ ...item, unitPrice: item.unitPrice }); continue }
        const stockItemId = matches[idx].exact?.id ?? null
        if (!stockItemId) {
          return ok({ success: false, code: 'UNIT_PRICE_REQUIRED', message: `"${item.description}" ไม่ได้ผูกกับสินค้าในสต็อก ต้องระบุ unitPrice เอง` })
        }
        const stockRow = db.prepare('SELECT unit_price, base_unit, sale_unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
        const lineUnit = normalizeUnit(item.unit || matches[idx].aliasUnit || defaultLineUnit(tenantId, stockItemId))
        const baseUnit = normalizeUnit(stockRow?.base_unit || stockRow?.sale_unit || lineUnit)
        let factor = 1
        if (lineUnit !== baseUnit) {
          // ส่งชื่อบรรทัดไปด้วย — ชื่อเรียกแทนที่ผูกหน่วยไว้ (แพ็คสิงห์ = 15 ขวด) ใช้ตัวคูณของตัวเอง
          const conv = convertQuantityBidirectional(1, lineUnit, baseUnit, tenantId, stockItemId, item.description)
          if (!conv) {
            return ok({ success: false, code: 'UNIT_PRICE_REQUIRED', message: `ไม่มีกฎแปลงหน่วย ${lineUnit} → ${baseUnit} ของ "${item.description}" — คิดราคาต่อ ${lineUnit} ให้ไม่ได้ ต้องระบุ unitPrice เอง` })
          }
          factor = conv.factor
        }
        pricedItems.push({ ...item, unitPrice: (stockRow?.unit_price ?? 0) * factor })
      }

      const inclusive = tenantVatInclusive(tenantId)
      const { subtotal, taxAmount, totalAmount } = computeTotals(pricedItems, discount_amount, tax_rate, inclusive)
      const id = genId()
      let qtNumber = ''

      let resultItems: any[] = []
      db.transaction(() => {
        // ออกเลขในทรานแซกชันเดียวกับการ insert — ถ้าล้มเหลวตัวนับต้องย้อนกลับไปด้วย ไม่เสียเลขเปล่าๆ
        qtNumber = formatDocumentNumber('QT', tenantId, 'QUOTATION', new Date().getFullYear(), 5)
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
        pricedItems.forEach((item: PricedItem, idx: number) => {
          const match = matches[idx]
          const stockItemId = match.exact?.id ?? null
          // ไม่ระบุหน่วยมา → ใช้หน่วยขาย/หน่วยฐานของสินค้าที่ผูกได้ ไม่ใช่คอลัมน์ unit เดิม
          // แล้ว normalize ให้เป็น code มาตรฐานเดียวกับที่ REST เก็บเสมอ (ไม่เก็บข้อความดิบจาก AI)
          const unit = normalizeUnit(item.unit || match.aliasUnit || defaultLineUnit(tenantId, stockItemId))
          const lineTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100)
          ins.run(genId(), tenantId, id, stockItemId, item.description,
            item.quantity, unit, item.unitPrice, item.discountPercent ?? 0, lineTotal)
          resultItems.push(bindingRow(item.description, match, unit))
        })
      })()

      // จำโหมด VAT ของใบนี้ไว้กับลูกค้ารายนี้ — ใบเสนอราคาถัดไป (ทั้งฝั่งเว็บและ AI) จะ default ให้ถูก
      rememberContactVatMode(tenantId, 'customer', customer.id, tax_rate, inclusive)

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
