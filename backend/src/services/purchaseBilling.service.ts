import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC, ACC_META, resolveBankAccountGL } from '../config/accountCodes'
import { getOrCreateAccount, isVatRegistered, rememberContactVatMode, postJournal, type JournalLineInput } from './accounting.service'
import { calcVat } from '../utils/vat'
import { closedPeriodLabel } from '../routes/journal.routes'

/**
 * ตรรกะ "ออกใบแจ้งหนี้ซื้อ" / "แก้ไขใบแจ้งหนี้ซื้อ" และ "จ่ายเงินผู้ขาย" ยกออกมาจาก
 * routes/purchase.routes.ts (ตัวที่ครบสุด — มี lock กันออกใบซ้ำ, รองรับหลาย GR ต่อใบแจ้งหนี้,
 * ลง journal ครบ) เพื่อให้ routes/purchase.routes.ts (REST) และ mcp/tools/purchaseBilling.ts
 * (MCP) เรียกตัวเดียวกัน — ตามแพทเทิร์นของ goodsReceipt.service.ts (2026-09-13/14) ห้ามมีสำเนา
 * ที่สองของตรรกะนี้
 *
 * ยกเครื่อง 2026-09-29 (รวม PO หลายใบ + ห้ามออกบิลไม่มี GR + แก้ไขใบแจ้งหนี้ได้):
 *   เดิมใบแจ้งหนี้เป็น "PO-centric" (purchaseOrderId หลัก + purchaseOrderIds เสริม) เลือก GR
 *   ได้แค่ของ PO หลัก ส่วน PO เสริมบวกยอดดิบจาก po.subtotal แล้ว GR ของมันไม่ถูกล็อกเลย
 *   (ออกซ้ำได้ + 2109 ค้างตลอดไป) และยังออกบิลได้โดยไม่มี GR เลย (ถ้า GR ตามมาทีหลังจะ
 *   Dr สต็อกซ้ำ) — ตอนนี้ใบแจ้งหนี้เป็น "GR-centric": ต้องมี GR เสมอ (หรือ derive มาจาก
 *   PO ให้อัตโนมัติแบบ backward-compat) และ GR แต่ละใบจะพา PO ของมันเข้ามารวมเองไม่จำกัดจำนวน
 *   PO ตราบใดที่เป็นผู้ขายรายเดียวกัน — ล็อกครบทุก GR ที่ใช้เสมอ
 */

export class PurchaseBillingError extends Error {
  constructor(
    public code:
      | 'PO_REQUIRED'
      | 'GR_NOT_FOUND'
      | 'GR_NOT_CONFIRMED'
      | 'GR_ALREADY_INVOICED'
      | 'NO_GR'
      | 'PO_SUPPLIER_MISMATCH'
      | 'SUPPLIER_REQUIRED'
      | 'AMOUNT_REQUIRED'
      | 'INVOICE_NOT_FOUND'
      | 'INVOICE_CANCELLED'
      | 'ITEM_NOT_FOUND'
      | 'OVER_BALANCE'
      | 'OVER_PAID'
      | 'CR_ACCOUNT_INVALID'
      | 'PERIOD_CLOSED',
    message: string
  ) {
    super(message)
  }
}

export interface CreatePurchaseInvoiceItemOverride {
  /** goods_receipt_items.id — ใช้จับคู่กับรายการที่ derive จาก GR เพื่อแก้ราคา/จำนวนให้ตรงบิลผู้ขาย */
  grItemId: string
  unitPrice?: number
  quantity?: number
}

export interface CreatePurchaseInvoicePayload {
  /** ส่วนลดท้ายบิล — ไม่ระบุจะสืบทอดเป็นผลรวมส่วนลดของทุกใบสั่งซื้อที่เกี่ยวข้อง */
  discountAmount?: number
  /** legacy/optional — ใช้ตอน goodsReceiptIds ว่างเพื่อ backward-compat เท่านั้น ปกติไม่ต้องส่ง */
  purchaseOrderId?: string
  purchaseOrderIds?: string[]
  goodsReceiptId?: string | null
  goodsReceiptIds?: string[]
  supplierInvoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  notes?: string
  /** override ราคา/จำนวนรายบรรทัด ผูกกับ GR item ไม่ใช่ป้อนรายการใหม่เอง */
  items?: CreatePurchaseInvoiceItemOverride[]
  drAccountId?: string | null
  // บัญชีปลายทางของหนี้ (ฝั่ง Cr) — ไม่ส่งมา = ใช้เจ้าหนี้การค้าตามผังบัญชี
  crAccountId?: string | null
  taxRate?: number
  autoPay?: boolean
  paymentMethod?: string
  paymentReference?: string
  bankAccountId?: string | null
}

interface DerivedGrItem {
  grItemId: string
  poItemId: string | null
  materialId: string | null
  quantity: number
  unitPrice: number
}

/** รายการจาก GR (join ราคาจาก PO item) ของ GR ทุกใบที่ระบุ — ใช้ derive items ของใบแจ้งหนี้ */
function deriveItemsFromGoodsReceipts(grIds: string[]): DerivedGrItem[] {
  if (grIds.length === 0) return []
  const placeholders = grIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT gri.id as grItemId, gri.purchase_order_item_id as poItemId, gri.material_id as materialId,
      gri.accepted_qty as quantity, poi.unit_price as unitPrice
    FROM goods_receipt_items gri
    JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    WHERE gri.goods_receipt_id IN (${placeholders}) AND gri.accepted_qty > 0
  `).all(...grIds) as DerivedGrItem[]
}

interface PurchaseInvoiceTotals {
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  resolvedDrAccId: string | null
  inventoryAccId: string
  payableAccId: string
  vatAccId: string | null
  vatClaimable: boolean
}

/**
 * คำนวณยอด VAT/ส่วนลด + resolve บัญชีปลายทางทั้งหมด — ทำนอก transaction เสมอ (auto-create
 * บัญชีในผังบัญชีถ้ายังไม่มี + throw ก่อนแตะ DB ถ้าบัญชีปลายทางที่เลือกไม่ถูกต้อง)
 */
function calcPurchaseInvoiceTotals(
  tenantId: string,
  subtotalRaw: number,
  taxRate: number,
  discountAmount: number,
  inclusive: boolean,
  drAccountId?: string | null,
  crAccountId?: string | null
): PurchaseInvoiceTotals {
  const piCalc = calcVat(subtotalRaw, { rate: taxRate, discountAmount, inclusive })
  const { taxAmount, totalAmount, discount } = piCalc
  const subtotal = piCalc.subtotal

  const resolvedDrAccId = drAccountId
    ? (db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(drAccountId, tenantId) as any)?.id ?? null
    : null
  const inventoryAccId = resolvedDrAccId
    ?? getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
  // ปลายทางของหนี้: ถ้าผู้ใช้เลือกมาต้องเป็นบัญชีหนี้สินของ tenant นี้จริง ๆ
  const pickedCrAcc = crAccountId
    ? (db.prepare("SELECT id FROM accounts WHERE id = ? AND tenant_id = ? AND type = 'LIABILITY'").get(crAccountId, tenantId) as any)?.id ?? null
    : null
  if (crAccountId && !pickedCrAcc) {
    throw new PurchaseBillingError('CR_ACCOUNT_INVALID', 'บัญชีปลายทางของหนี้ที่เลือกไม่ใช่บัญชีหนี้สินของกิจการนี้')
  }
  const payableAccId = pickedCrAcc
    ?? getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
  // ยังไม่จด VAT: ภาษีที่จ่ายผู้ขายขอคืนไม่ได้ → Dr บัญชีเดียวกับตัวของ (รวมเป็นต้นทุน) และไม่ลงทะเบียนภาษีซื้อ
  const vatClaimable = isVatRegistered(tenantId)
  const vatAccId = taxAmount > 0 ? (vatClaimable ? getOrCreateAccount(tenantId, ACC.INPUT_VAT, ACC_META[ACC.INPUT_VAT]!.name, ACC_META[ACC.INPUT_VAT]!.type, ACC_META[ACC.INPUT_VAT]!.category, ACC_META[ACC.INPUT_VAT]!.normalBalance) : inventoryAccId) : null

  return { subtotal, discount, taxAmount, totalAmount, resolvedDrAccId, inventoryAccId, payableAccId, vatAccId, vatClaimable }
}

/**
 * ลง journal_entries + journal_lines + vat_entries ของใบแจ้งหนี้ซื้อ — ส่วน "โพสต์บัญชี" ที่
 * createPurchaseInvoice และ updatePurchaseInvoice เรียกร่วมกัน (ต้องเรียกอยู่ใน db.transaction
 * ของผู้เรียกเสมอ ตัวมันเองไม่เปิด transaction ซ้ำ)
 */
function postPurchaseInvoiceJournal(
  tenantId: string,
  actorEmail: string,
  params: {
    piId: string
    piNumber: string
    invoiceDate: string
    notes?: string | null
    grIds: string[]
    totals: PurchaseInvoiceTotals
    taxRate: number
    supplierName?: string | null
    supplierTaxId?: string | null
  }
) {
  const { piId, piNumber, invoiceDate, notes, grIds, totals, taxRate, supplierName, supplierTaxId } = params
  const { subtotal, taxAmount, totalAmount, resolvedDrAccId, inventoryAccId, payableAccId, vatAccId, vatClaimable } = totals
  const now = new Date().toISOString()
  const r2 = (n: number) => Math.round(n * 100) / 100
  const drAccLabel = resolvedDrAccId
    ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(resolvedDrAccId) as any)?.name ?? 'ค่าใช้จ่าย'
    : 'สต็อกวัตถุดิบ'
  // ของที่ใบนี้อ้างอิงถูกตั้งค้างรับไว้แล้วตอนยืนยันใบรับสินค้า (Dr สต็อก / Cr 2109)
  // ใบแจ้งหนี้จึงมาปิด 2109 ไม่ใช่ Dr สต็อกซ้ำอีกรอบ — grIds ตรงนี้ต้องเป็น "ทุก GR" ที่ใบนี้อ้างอิง
  // (รวม PO หลายใบ) ไม่ใช่แค่ GR ของ PO หลัก ไม่งั้นยอดปิด 2109 จะขาดเป็นส่วนของ PO ที่เอามารวม
  const accruedForGRs = grIds.length > 0
    ? (db.prepare(`
        SELECT COALESCE(SUM(l.credit), 0) AS total
        FROM journal_lines l
        JOIN journal_entries je ON je.id = l.journal_entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE je.tenant_id = ? AND je.reference_type = 'GOODS_RECEIPT' AND a.code = ?
          AND je.reference_id IN (${grIds.map(() => '?').join(', ')})
      `).get(tenantId, ACC.GRNI, ...grIds) as any).total as number
    : 0
  // ลงบัญชีเป็นสตางค์เสมอ แล้วให้ฝั่งเดบิตของสินค้า = เจ้าหนี้ − ภาษี พอดี (ไม่ใช้ subtotal ตรง ๆ)
  // เพราะ calcVat โหมดแยก VAT คืน subtotal แบบไม่ปัด (เช่น 168.585) แต่ total ปัดแล้ว (180.39)
  // เดิม Dr 168.58 + 11.80 ≠ Cr 180.39 (PI-025-021026) / Dr 976.916 (PI-018-021026) — เศษสตางค์
  // ที่เหลือหลังปิด 2109 ลงบัญชีสต็อก/บัญชีที่เลือก ไม่ทิ้งหาย (และ subtotal ฝั่ง EXCLUSIVE คือยอดก่อนหัก
  // ส่วนลดท้ายบิล ถ้าใช้ตรง ๆ จะไม่ดุลทุกครั้งที่มีส่วนลด)
  const payableTotal = r2(totalAmount)
  const vatDebit = vatAccId && taxAmount > 0 ? r2(taxAmount) : 0
  const goodsDebit = r2(payableTotal - vatDebit)
  const grniPortion = Math.max(0, Math.min(r2(accruedForGRs), goodsDebit))
  const inventoryPortion = r2(goodsDebit - grniPortion)

  const lines: JournalLineInput[] = []
  if (grniPortion > 0.005) {
    lines.push({ accountId: getOrCreateAccount(tenantId, ACC.GRNI), description: `ปิดค้างรับของ - ${piNumber}`, debit: grniPortion })
  }
  if (inventoryPortion > 0.005) {
    lines.push({ accountId: inventoryAccId, description: `${drAccLabel} - ${piNumber}`, debit: inventoryPortion })
  }
  if (vatDebit > 0) {
    lines.push({ accountId: vatAccId!, description: `${vatClaimable ? 'ภาษีซื้อ' : 'ภาษีซื้อที่ขอคืนไม่ได้ (ยังไม่จด VAT)'} - ${piNumber}`, debit: vatDebit })
  }
  lines.push({ accountId: payableAccId, description: `เจ้าหนี้การค้า - ${piNumber}`, credit: payableTotal })

  // postJournal ปัดทุกบรรทัด, หัวรายการ = ผลรวมบรรทัด และ throw ถ้าเดบิต ≠ เครดิต (> 0.005)
  const journalId = postJournal({
    tenantId, date: invoiceDate.substring(0, 10), referenceType: 'PURCHASE_INVOICE', referenceId: piId,
    description: `รับใบแจ้งหนี้ซื้อ ${piNumber}`, lines, createdBy: actorEmail, notes: notes || null,
  })
  const journalNumber = (db.prepare('SELECT entry_number FROM journal_entries WHERE id = ?').get(journalId) as any)?.entry_number as string

  // VAT Entry (Input VAT) — เฉพาะกิจการที่จด VAT แล้ว
  if (taxAmount > 0 && vatClaimable) {
    db.prepare(`
      INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, journal_entry_id, created_at)
      VALUES (?, ?, 'PURCHASE_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(generateId(), tenantId, piId, piNumber, invoiceDate.substring(0, 10),
      supplierName || '', supplierTaxId || null,
      subtotal, taxRate, taxAmount, totalAmount, journalId, now)
  }

  return { journalId, journalNumber }
}

/**
 * สร้างใบแจ้งหนี้ซื้อจากใบรับสินค้า (GR) ที่ยืนยันแล้วเท่านั้น ลง journal ทันที
 * (Dr สต็อกวัตถุดิบ/บัญชีที่เลือก + Dr ภาษีซื้อ (ถ้ามี) = Cr เจ้าหนี้การค้า) พร้อม vat_entries
 *
 * GR ที่ระบุมาไม่จำเป็นต้องมาจาก PO เดียวกัน — รวมได้หลาย PO ในบิลเดียวตราบใดที่เป็นผู้ขาย
 * รายเดียวกันทุกใบ (เทียบเลขผู้เสียภาษีก่อนชื่อ/id) purchase_order_id ของใบแจ้งหนี้ = PO ของ
 * GR ใบแรกที่ระบุมา, purchase_order_ids = PO ทุกใบที่เกี่ยวข้อง (distinct)
 */
export function createPurchaseInvoice(tenantId: string, actorEmail: string, payload: CreatePurchaseInvoicePayload) {
  const { supplierInvoiceNumber, invoiceDate, dueDate, notes, drAccountId, crAccountId, taxRate: reqTaxRate } = payload

  // ── 1) ตกลง GR ที่จะใช้ — ไม่มีมาให้ backward-compat ขยายจาก purchaseOrderId/purchaseOrderIds ──
  let grIds: string[] = Array.isArray(payload.goodsReceiptIds) && payload.goodsReceiptIds.length > 0
    ? [...new Set(payload.goodsReceiptIds)]
    : (payload.goodsReceiptId ? [payload.goodsReceiptId] : [])

  if (grIds.length === 0) {
    const poIds = [...new Set([
      ...(payload.purchaseOrderId ? [payload.purchaseOrderId] : []),
      ...(Array.isArray(payload.purchaseOrderIds) ? payload.purchaseOrderIds : []),
    ])]
    if (poIds.length === 0) throw new PurchaseBillingError('PO_REQUIRED', 'ต้องระบุใบรับสินค้า (GR) หรือใบสั่งซื้อ')
    const poPh = poIds.map(() => '?').join(',')
    const freeGrs = db.prepare(
      `SELECT id FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id IN (${poPh}) AND status = 'CONFIRMED' AND invoiced_at IS NULL`
    ).all(tenantId, ...poIds) as any[]
    if (freeGrs.length === 0) {
      throw new PurchaseBillingError('NO_GR', 'ต้องยืนยันรับของ (GR) ก่อนออกใบแจ้งหนี้ — ใบแจ้งหนี้ออกจากของที่รับจริงเท่านั้น')
    }
    grIds = freeGrs.map((r: any) => r.id)
  }

  // ── 2) โหลด+ตรวจ GR ทุกใบ (join PO เอา supplier/tax_rate/vat_inclusive/discount/is_paid มาด้วย) ──
  const grPh = grIds.map(() => '?').join(',')
  const grRowsRaw = db.prepare(`
    SELECT gr.id, gr.gr_number, gr.status, gr.invoiced_at, gr.purchase_order_id,
      po.po_number, po.supplier_id, po.tax_rate as po_tax_rate, po.vat_inclusive as po_vat_inclusive,
      po.discount_amount as po_discount_amount, po.is_paid as po_is_paid
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    WHERE gr.tenant_id = ? AND gr.id IN (${grPh})
  `).all(tenantId, ...grIds) as any[]

  const orderedGrRows = grIds.map(grId => {
    const row = grRowsRaw.find(r => r.id === grId)
    if (!row) throw new PurchaseBillingError('GR_NOT_FOUND', `ไม่พบใบรับสินค้า: ${grId}`)
    if (row.status !== 'CONFIRMED') throw new PurchaseBillingError('GR_NOT_CONFIRMED', `ใบรับสินค้า ${row.gr_number} ต้องยืนยันแล้วก่อนสร้างใบแจ้งหนี้`)
    if (row.invoiced_at) throw new PurchaseBillingError('GR_ALREADY_INVOICED', `ใบรับสินค้า ${row.gr_number} ถูกใช้สร้างใบแจ้งหนี้ไปแล้ว กรุณาเลือกใบอื่นหรือยกเลิกใบแจ้งหนี้เดิมก่อน`)
    return row
  })

  // ── 3) ทุก GR ต้องเป็นผู้ขายรายเดียวกัน — เทียบเลขผู้เสียภาษีก่อน (ไม่ใช่ชื่อร้าน) ──
  const taxIdOf = (sid: string) => ((db.prepare('SELECT tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(sid, tenantId) as any)?.tax_id || '').trim()
  const baseSupplierId = orderedGrRows[0].supplier_id
  const baseTaxId = taxIdOf(baseSupplierId)
  for (const row of orderedGrRows.slice(1)) {
    const rowTaxId = taxIdOf(row.supplier_id)
    const sameParty = baseTaxId && rowTaxId ? rowTaxId === baseTaxId : row.supplier_id === baseSupplierId
    if (!sameParty) {
      throw new PurchaseBillingError(
        'PO_SUPPLIER_MISMATCH',
        `ใบรับสินค้า ${row.gr_number} (${row.po_number}) เป็นของผู้ขายคนละราย รวมเข้าบิลเดียวกันไม่ได้ — หนี้และใบกำกับภาษีต้องแยกตามนิติบุคคล`
      )
    }
  }

  const purchaseOrderId = orderedGrRows[0].purchase_order_id
  const allPoIds = [...new Set(orderedGrRows.map(r => r.purchase_order_id))]
  const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(baseSupplierId, tenantId) as any

  // ── 4) รายการสินค้า — derive จาก goods_receipt_items ของทุก GR แล้ว override ราคา/จำนวนตาม grItemId ถ้าผู้เรียกส่งมา ──
  const derivedItems = deriveItemsFromGoodsReceipts(grIds)
  const overrideByGrItem = new Map((payload.items || []).map(o => [o.grItemId, o]))
  const items = derivedItems.map(d => {
    const ov = overrideByGrItem.get(d.grItemId)
    return {
      poItemId: d.poItemId,
      materialId: d.materialId,
      quantity: ov?.quantity != null ? Number(ov.quantity) : d.quantity,
      unitPrice: ov?.unitPrice != null ? Number(ov.unitPrice) : d.unitPrice,
    }
  })
  const subtotalRaw = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)

  // ── 5) VAT/ส่วนลด สืบทอดจาก PO — อัตราภาษี/โหมดรวม VAT จาก PO ของ GR ใบแรก, ส่วนลดรวมทุก PO ที่เกี่ยวข้อง ──
  const taxRate = reqTaxRate != null ? Number(reqTaxRate) : (orderedGrRows[0].po_tax_rate ?? 7)
  const inclusive = orderedGrRows[0].po_vat_inclusive === 1
  const discountAmount = payload.discountAmount != null
    ? Number(payload.discountAmount)
    : allPoIds.reduce((sum, poId) => sum + (Number(orderedGrRows.find(r => r.purchase_order_id === poId)!.po_discount_amount) || 0), 0)

  // งวดปิดบัญชี — กติกาเดียวกับ updatePurchaseInvoice (ห้ามลง journal ย้อนเข้างวดที่ปิดแล้ว)
  const finalInvoiceDate = invoiceDate || new Date().toISOString()
  const closedLabel = closedPeriodLabel(tenantId, finalInvoiceDate)
  if (closedLabel) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${closedLabel} ปิดแล้ว บันทึกใบแจ้งหนี้วันที่นี้ไม่ได้`)

  // ── ตรวจครบทุกอย่างมาถึงตรงนี้แล้ว — เพิ่งเบิร์นเลขที่เอกสาร ไม่งั้น request ที่ถูกปฏิเสธจะกินเลขไปเปล่า ๆ ──
  const id = generateId()
  const piNumber = formatDocumentNumber('PI', tenantId, 'PURCHASE_INVOICE', new Date().getFullYear(), 5)
  const now = new Date().toISOString()

  // Resolve บัญชีปลายทาง + คำนวณยอด — ทำนอก transaction (auto-create บัญชีในผังบัญชีถ้ายังไม่มี)
  const totals = calcPurchaseInvoiceTotals(tenantId, subtotalRaw, taxRate, discountAmount, inclusive, drAccountId, crAccountId)

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_invoice_number, purchase_order_id,
        supplier_id, goods_receipt_id, goods_receipt_ids, purchase_order_ids, invoice_date, due_date, subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive,
        balance_amount, status, payment_status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', 'UNPAID', ?, ?, ?)
    `).run(id, tenantId, piNumber, supplierInvoiceNumber || '', purchaseOrderId, baseSupplierId,
      grIds[0], JSON.stringify(grIds), JSON.stringify(allPoIds), finalInvoiceDate, dueDate || null,
      totals.subtotal, totals.discount, taxRate, totals.taxAmount, totals.totalAmount, inclusive ? 1 : 0,
      totals.totalAmount, notes || '', now, now)

    if (items.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO purchase_invoice_items (id, tenant_id, purchase_invoice_id, purchase_order_item_id,
          material_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        insertItem.run(generateId(), tenantId, id, item.poItemId || null, item.materialId || null,
          item.quantity, item.unitPrice, item.quantity * item.unitPrice)
      }
    }

    // Lock ทุก GR ที่ใบนี้ใช้ — กันดึงไปออกใบซ้ำ
    const markInvoiced = db.prepare('UPDATE goods_receipts SET invoiced_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    for (const grId of grIds) markInvoiced.run(now, now, grId, tenantId)

    postPurchaseInvoiceJournal(tenantId, actorEmail, {
      piId: id, piNumber, invoiceDate: finalInvoiceDate, notes, grIds, totals, taxRate,
      supplierName: supplier?.name, supplierTaxId: supplier?.tax_id,
    })
  })

  transaction()

  // จำโหมด VAT ของใบนี้ไว้กับผู้ขายรายนี้ — ใบแจ้งหนี้ซื้อถัดไปจะ default ให้ถูกโดยไม่ต้องเลือกใหม่
  rememberContactVatMode(tenantId, 'supplier', baseSupplierId, taxRate, inclusive)

  let invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const primaryPo = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any

  // Auto-settle payment if autoPay is requested, or if every PO involved was already paid (is_paid === 1)
  const posPaidPh = allPoIds.map(() => '?').join(',')
  const unpaidPoCount = (db.prepare(
    `SELECT COUNT(*) as c FROM purchase_orders WHERE tenant_id = ? AND id IN (${posPaidPh}) AND is_paid != 1`
  ).get(tenantId, ...allPoIds) as any).c
  const shouldAutoPay = payload.autoPay !== undefined ? payload.autoPay : (unpaidPoCount === 0)

  let paymentResult: any = null
  if (shouldAutoPay && invoice && invoice.balance_amount > 0) {
    try {
      paymentResult = paySupplier(tenantId, actorEmail, {
        supplierId: baseSupplierId,
        purchaseInvoiceId: id,
        paymentDate: finalInvoiceDate,
        paymentMethod: payload.paymentMethod || primaryPo?.payment_method || 'TRANSFER',
        paymentReference: payload.paymentReference || primaryPo?.payment_reference || '',
        bankAccountId: payload.bankAccountId || primaryPo?.bank_account_id || null,
        amount: invoice.total_amount,
        notes: `[Auto-Settle from ${primaryPo?.po_number || ''}] ${notes || ''}`.trim(),
      })
      invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    } catch (payErr) {
      console.error('Auto-settle payment failed for invoice', id, payErr)
    }
  }

  const invoiceItems = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id)
  return { ...invoice, items: invoiceItems, payment: paymentResult }
}

/**
 * กลับรายการ journal + vat_entries ปัจจุบันของใบแจ้งหนี้ซื้อ — ใช้เฉพาะตอนแก้ไข (updatePurchaseInvoice)
 * ต่างจาก reverseJournalEntryForReference ของ routes/purchase.routes.ts (ที่ใช้ตอนยกเลิก) ตรงที่
 * ต้อง "กลับได้ซ้ำหลายรอบ" (แก้ไขซ้ำได้เรื่อย ๆ ไม่ใช่ครั้งเดียวจบแบบยกเลิก) — ตัวนั้นกันออกซ้ำด้วยการ
 * เช็คว่ามี reversal อยู่แล้วหรือไม่ (ใช้ไม่ได้กับที่นี่เพราะจะบล็อกการแก้ไขครั้งที่ 2 เป็นต้นไป)
 * จึง relabel journal/vat_entries เดิมเป็น _SUPERSEDED ทันทีหลังกลับรายการ เพื่อให้รอบถัดไป (ทั้ง
 * การแก้ไขซ้ำและปุ่มยกเลิกในอนาคต) query reference_type/document_type = 'PURCHASE_INVOICE' เจอ
 * แถวปัจจุบันแถวเดียวเสมอ ไม่มีของเก่าค้างมาปนให้กลับซ้ำหรือกลับผิดตัว
 */
function reverseCurrentPurchaseInvoiceJournal(tenantId: string, actorEmail: string, piId: string, piNumber: string, dateStr: string) {
  const now = new Date().toISOString()

  const original = db.prepare(
    "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
  ).get(tenantId, piId) as any
  if (original) {
    const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ?').all(original.id) as any[]
    const journalId = generateId()
    const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(dateStr).getFullYear(), 5)

    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'PURCHASE_INVOICE_EDIT', ?, ?, ?, ?, 1, 1, ?, ?, NULL, ?, ?, ?)
    `).run(journalId, tenantId, journalNumber, dateStr, piId,
      `แก้ไขใบแจ้งหนี้ซื้อ ${piNumber} — กลับรายการเดิม`, original.total_credit, original.total_debit,
      now, actorEmail, actorEmail, now, now)

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let lineNo = 1
    for (const line of lines) {
      insertLine.run(generateId(), tenantId, journalId, line.account_id, lineNo++, `กลับรายการ: ${line.description || ''}`, line.credit, line.debit)
    }

    // relabel journal เดิม — ไม่งั้นรอบถัดไป (แก้ไขซ้ำ/ยกเลิก) จะ query reference_type='PURCHASE_INVOICE'
    // เจอ 2 แถว (เดิม + ที่โพสต์ใหม่) แล้วหยิบผิดตัว
    db.prepare("UPDATE journal_entries SET reference_type = 'PURCHASE_INVOICE_SUPERSEDED' WHERE id = ?").run(original.id)
  }

  const vatEntry = db.prepare(
    "SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'PURCHASE_INVOICE' AND document_id = ?"
  ).get(tenantId, piId) as any
  if (vatEntry) {
    db.prepare(`
      INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
        party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
      VALUES (?, ?, 'PURCHASE_INVOICE_EDIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
    `).run(generateId(), tenantId, piId, piNumber, dateStr,
      vatEntry.party_name, vatEntry.party_tax_id, -vatEntry.base_amount, vatEntry.vat_rate,
      -vatEntry.vat_amount, -vatEntry.total_amount, now)
    db.prepare("UPDATE vat_entries SET document_type = 'PURCHASE_INVOICE_SUPERSEDED' WHERE id = ?").run(vatEntry.id)
  }
}

export interface UpdatePurchaseInvoiceItemInput {
  /** purchase_invoice_items.id ที่มีอยู่แล้ว — แก้ไขไม่เปลี่ยนชุด GR/รายการ เปลี่ยนได้แค่ราคา/จำนวน */
  id: string
  unitPrice?: number
  quantity?: number
}

export interface UpdatePurchaseInvoicePayload {
  // ── ฟิลด์หัวบิล — แก้แล้วไม่แตะ journal ──
  supplierInvoiceNumber?: string
  dueDate?: string
  notes?: string
  // ── ฟิลด์การเงิน — แก้แล้ว reverse journal เดิมทั้งใบ + ลงใหม่ทั้งใบ ──
  items?: UpdatePurchaseInvoiceItemInput[]
  invoiceDate?: string
  taxRate?: number
  discountAmount?: number
  drAccountId?: string | null
  crAccountId?: string | null
}

/**
 * แก้ไขใบแจ้งหนี้ซื้อที่ออกไปแล้ว (รวมใบที่จ่ายเงินแล้วบางส่วน/เต็มจำนวน) — ชุด GR ที่ผูกไว้แก้ไม่ได้
 * (ยกเลิกแล้วออกใหม่แทน) เปลี่ยนได้แค่ราคา/จำนวนต่อบรรทัด วันที่ อัตราภาษี ส่วนลด และบัญชีปลายทาง
 *
 * ฟิลด์หัวบิลอย่างเดียว (supplierInvoiceNumber/dueDate/notes) → UPDATE ตรง ๆ ไม่แตะ journal
 * ฟิลด์การเงินตัวใดตัวหนึ่ง → reverse journal+vat_entries เดิมทั้งใบ แล้วโพสต์ใหม่ทั้งใบด้วยตัวเลขใหม่
 * (ใช้ postPurchaseInvoiceJournal ตัวเดียวกับตอนสร้าง — ไม่มีสำเนาที่สอง)
 */
export function updatePurchaseInvoice(tenantId: string, actorEmail: string, id: string, payload: UpdatePurchaseInvoicePayload) {
  const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!pi) throw new PurchaseBillingError('INVOICE_NOT_FOUND', 'ไม่พบใบแจ้งหนี้ซื้อ')
  if (pi.status === 'CANCELLED') throw new PurchaseBillingError('INVOICE_CANCELLED', 'ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว แก้ไขไม่ได้')

  const now = new Date().toISOString()
  const hasFinancialChange = payload.items !== undefined || payload.invoiceDate !== undefined
    || payload.taxRate !== undefined || payload.discountAmount !== undefined
    || payload.drAccountId !== undefined || payload.crAccountId !== undefined

  // งวดปิดบัญชี: เช็คทั้งวันที่เดิมของใบ (แก้ใบเก่าที่อยู่ในงวดปิดไม่ได้เลย) และวันที่ใหม่ถ้าเปลี่ยน
  const oldClosed = closedPeriodLabel(tenantId, pi.invoice_date)
  if (oldClosed) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${oldClosed} ปิดแล้ว แก้ไขใบแจ้งหนี้นี้ไม่ได้`)
  const newInvoiceDate = payload.invoiceDate || pi.invoice_date
  if (hasFinancialChange) {
    const newClosed = closedPeriodLabel(tenantId, newInvoiceDate)
    if (newClosed) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${newClosed} ปิดแล้ว บันทึกวันที่นี้ไม่ได้`)
  }

  if (!hasFinancialChange) {
    db.prepare(`
      UPDATE purchase_invoices SET supplier_invoice_number = COALESCE(?, supplier_invoice_number),
        due_date = COALESCE(?, due_date), notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(payload.supplierInvoiceNumber ?? null, payload.dueDate ?? null, payload.notes ?? null, now, id, tenantId)
    return {
      ...db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId),
      items: db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id),
    }
  }

  // ── ฟิลด์การเงิน — คำนวณยอดใหม่ก่อน แล้วค่อยตรวจ over-paid ก่อนแตะ DB ──
  const existingItems = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id) as any[]
  const overrideById = new Map((payload.items || []).map(o => [o.id, o]))
  for (const ov of payload.items || []) {
    if (!existingItems.find(e => e.id === ov.id)) {
      throw new PurchaseBillingError('ITEM_NOT_FOUND', `ไม่พบรายการ ${ov.id} ในใบแจ้งหนี้นี้`)
    }
  }
  const newItems = existingItems.map(e => {
    const ov = overrideById.get(e.id)
    return {
      poItemId: e.purchase_order_item_id,
      materialId: e.material_id,
      quantity: ov?.quantity != null ? Number(ov.quantity) : e.quantity,
      unitPrice: ov?.unitPrice != null ? Number(ov.unitPrice) : e.unit_price,
    }
  })
  const subtotalRaw = newItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)

  const taxRate = payload.taxRate != null ? Number(payload.taxRate) : pi.tax_rate
  const discountAmount = payload.discountAmount != null ? Number(payload.discountAmount) : pi.discount_amount
  const inclusive = pi.vat_inclusive === 1
  const drAccountId = payload.drAccountId !== undefined ? payload.drAccountId : undefined
  const crAccountId = payload.crAccountId !== undefined ? payload.crAccountId : undefined

  const totals = calcPurchaseInvoiceTotals(tenantId, subtotalRaw, taxRate, discountAmount, inclusive, drAccountId, crAccountId)

  if (totals.totalAmount < (pi.paid_amount || 0) - 0.005) {
    throw new PurchaseBillingError(
      'OVER_PAID',
      `ยอดใหม่ (฿${totals.totalAmount.toLocaleString()}) น้อยกว่ายอดที่จ่ายไปแล้ว (฿${(pi.paid_amount || 0).toLocaleString()}) — กรุณายกเลิกการจ่ายเงินก่อนแล้วค่อยแก้ไขยอด`
    )
  }

  const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(pi.supplier_id, tenantId) as any
  let grIds: string[] = []
  try { grIds = JSON.parse(pi.goods_receipt_ids || '[]') } catch { grIds = [] }
  if (grIds.length === 0 && pi.goods_receipt_id) grIds = [pi.goods_receipt_id]

  const transaction = db.transaction(() => {
    reverseCurrentPurchaseInvoiceJournal(tenantId, actorEmail, pi.id, pi.pi_number, now.substring(0, 10))

    db.prepare('DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = ?').run(id)
    const insertItem = db.prepare(`
      INSERT INTO purchase_invoice_items (id, tenant_id, purchase_invoice_id, purchase_order_item_id, material_id, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const it of newItems) {
      insertItem.run(generateId(), tenantId, id, it.poItemId || null, it.materialId || null, it.quantity, it.unitPrice, it.quantity * it.unitPrice)
    }

    const paidAmount = pi.paid_amount || 0
    const newBalance = Math.round((totals.totalAmount - paidAmount) * 100) / 100
    const newPaymentStatus = newBalance <= 0.005 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
    db.prepare(`
      UPDATE purchase_invoices SET supplier_invoice_number = COALESCE(?, supplier_invoice_number),
        due_date = COALESCE(?, due_date), notes = COALESCE(?, notes),
        invoice_date = ?, tax_rate = ?, discount_amount = ?, subtotal = ?, tax_amount = ?, total_amount = ?,
        balance_amount = ?, payment_status = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(payload.supplierInvoiceNumber ?? null, payload.dueDate ?? null, payload.notes ?? null,
      newInvoiceDate, taxRate, totals.discount, totals.subtotal, totals.taxAmount, totals.totalAmount,
      newBalance, newPaymentStatus, now, id, tenantId)

    postPurchaseInvoiceJournal(tenantId, actorEmail, {
      piId: id, piNumber: pi.pi_number, invoiceDate: newInvoiceDate, notes: payload.notes ?? pi.notes,
      grIds, totals, taxRate, supplierName: supplier?.name, supplierTaxId: supplier?.tax_id,
    })
  })
  transaction()

  // จำโหมด VAT ของใบนี้ไว้กับผู้ขายรายนี้ — เฉพาะรอบที่มีการเปลี่ยนแปลงทางการเงินจริง (hasFinancialChange)
  rememberContactVatMode(tenantId, 'supplier', pi.supplier_id, taxRate, inclusive)

  return {
    ...db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId),
    items: db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id),
  }
}

export interface PaySupplierPayload {
  supplierId: string
  purchaseInvoiceId?: string | null
  paymentDate?: string
  paymentMethod?: string
  paymentReference?: string
  amount: number
  withholdingTax?: number
  notes?: string
  bankAccountId?: string | null
}

/**
 * บันทึกจ่ายเงินผู้ขาย (รองรับจ่ายบางส่วน + ภาษีหัก ณ ที่จ่าย) ลง journal
 * Dr เจ้าหนี้การค้า = Cr เงินสด/ธนาคาร + Cr ภาษีหัก ณ ที่จ่าย (ถ้ามี)
 */
export function paySupplier(tenantId: string, actorEmail: string, payload: PaySupplierPayload) {
  const { supplierId, purchaseInvoiceId, paymentDate, paymentMethod, paymentReference, amount, notes, bankAccountId } = payload
  if (!supplierId) throw new PurchaseBillingError('SUPPLIER_REQUIRED', 'Supplier and amount are required')
  if (!amount) throw new PurchaseBillingError('AMOUNT_REQUIRED', 'Supplier and amount are required')

  let invoice: any = null
  if (purchaseInvoiceId) {
    invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
    if (!invoice) throw new PurchaseBillingError('INVOICE_NOT_FOUND', 'Purchase invoice not found')
    // เดิมเช็คแค่ใน MCP tool — REST จ่ายใบที่ยกเลิกแล้วได้ ย้ายมาไว้ที่ service ให้ทุกทางเข้าโดนเหมือนกัน
    if (invoice.status === 'CANCELLED') throw new PurchaseBillingError('INVOICE_CANCELLED', 'ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว จ่ายเงินไม่ได้')
    // เผื่อเศษ float ครึ่งสตางค์ (เช่นยอดคงค้าง 180.38999999 แต่จ่าย 180.39)
    if (amount > (invoice.balance_amount || 0) + 0.005) throw new PurchaseBillingError('OVER_BALANCE', 'Payment amount exceeds invoice balance')
  }

  // งวดปิดบัญชี — กติกาเดียวกับ updatePurchaseInvoice
  const closedLabel = closedPeriodLabel(tenantId, paymentDate || new Date().toISOString())
  if (closedLabel) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${closedLabel} ปิดแล้ว บันทึกการจ่ายเงินวันที่นี้ไม่ได้`)

  const id = generateId()
  const paymentNumber = formatDocumentNumber('SP', tenantId, 'SUPPLIER_PAYMENT', new Date().getFullYear(), 5)
  const now = new Date().toISOString()
  const wht = payload.withholdingTax || 0
  const netAmount = amount - wht

  // Resolve accounts before transaction
  const payableAccId = getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
  // Dr/Cr บัญชีธนาคารที่เลือกโดยตรงถ้ามี ไม่งั้น fallback ตาม paymentMethod (CASH -> 1101, อื่นๆ -> 1102)
  const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId)
  const cashAccId = linkedAccountId || getOrCreateAccount(
    tenantId,
    (paymentMethod || 'TRANSFER') === 'CASH' ? ACC.CASH : ACC.BANK,
    (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.name : ACC_META[ACC.BANK]!.name,
    (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.type : ACC_META[ACC.BANK]!.type,
    (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.category : ACC_META[ACC.BANK]!.category,
    (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.normalBalance : ACC_META[ACC.BANK]!.normalBalance
  )
  const whtAccId = wht > 0 ? getOrCreateAccount(tenantId, ACC.WHT_PAYABLE, ACC_META[ACC.WHT_PAYABLE]!.name, ACC_META[ACC.WHT_PAYABLE]!.type, ACC_META[ACC.WHT_PAYABLE]!.category, ACC_META[ACC.WHT_PAYABLE]!.normalBalance) : null
  const journalId = generateId()
  const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(paymentDate || now).getFullYear(), 5)

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
        payment_date, payment_method, payment_reference, amount, withholding_tax, net_amount, notes, bank_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, paymentNumber, supplierId, purchaseInvoiceId || null, paymentDate || now,
      paymentMethod || 'TRANSFER', paymentReference || '', amount, wht, netAmount, notes || '', bankAccountId || null, now, now)

    if (invoice) {
      const r2 = (n: number) => Math.round(n * 100) / 100
      const newPaid = r2((invoice.paid_amount || 0) + amount)
      const newBalance = Math.max(0, r2(invoice.total_amount - newPaid))
      const newPaymentStatus = newBalance <= 0.005 ? 'PAID' : 'PARTIAL'

      db.prepare(`
        UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, newPaymentStatus, now, purchaseInvoiceId, tenantId)
    }

    // === POST JOURNAL ENTRY ===
    // Dr เจ้าหนี้การค้า (2101)
    // Cr เงินสด/ธนาคาร (1101/1102) + Cr ภาษีหัก ณ ที่จ่าย (2105) ถ้ามี WHT
    // หัวรายการ = ผลรวมของบรรทัดจริง (ไม่ใช่ amount ตรง ๆ) — บรรทัดเครดิตคือ netAmount + wht
    const headerDebit = Math.round(amount * 100) / 100
    const headerCredit = Math.round((netAmount + (whtAccId && wht > 0 ? wht : 0)) * 100) / 100
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'SUPPLIER_PAYMENT', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(journalId, tenantId, journalNumber, (paymentDate || now).substring(0, 10),
      id, `จ่ายชำระ ${paymentNumber}`, headerDebit, headerCredit, now, actorEmail, notes || null,
      actorEmail, now, now)

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let lineNo = 1
    insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${paymentNumber}`, amount, 0)
    insertLine.run(generateId(), tenantId, journalId, cashAccId, lineNo++, `จ่ายเงิน - ${paymentNumber}`, 0, netAmount)
    if (whtAccId && wht > 0) {
      insertLine.run(generateId(), tenantId, journalId, whtAccId, lineNo++, `ภาษีหัก ณ ที่จ่าย - ${paymentNumber}`, 0, wht)
    }
  })

  transaction()

  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const updatedInvoice = purchaseInvoiceId
    ? db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
    : null
  return { ...payment, invoice: updatedInvoice }
}
