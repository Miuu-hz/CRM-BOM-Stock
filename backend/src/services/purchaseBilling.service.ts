import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC, ACC_META, resolveBankAccountGL } from '../config/accountCodes'
import { getOrCreateAccount } from './accounting.service'

/**
 * ตรรกะ "ออกใบแจ้งหนี้ซื้อ" และ "จ่ายเงินผู้ขาย" ยกออกมาจาก routes/purchase.routes.ts
 * (ตัวที่ครบสุด — มี lock กันออกใบซ้ำ, รองรับหลาย GR ต่อใบแจ้งหนี้, ลง journal ครบ) เพื่อให้
 * routes/purchase.routes.ts (REST) และ mcp/tools/purchaseBilling.ts (MCP) เรียกตัวเดียวกัน
 * — ตามแพทเทิร์นของ goodsReceipt.service.ts (2026-09-13/14) ห้ามมีสำเนาที่สองของตรรกะนี้
 *
 * ส่วนที่เพิ่มเข้ามาใหม่ (ไม่มีใน route เดิม): เมื่อสร้างใบแจ้งหนี้โดยไม่ส่ง items มาแต่ระบุ
 * goodsReceiptIds มา จะ derive รายการ+ยอดจาก goods_receipt_items ของ GR เหล่านั้นเอง (join
 * ราคาจาก purchase_order_items) แทนการ fallback ไปใช้ po.subtotal (ยอดทั้ง PO) แบบเดิม —
 * จำเป็นสำหรับเคส "รับของหลายรอบ ออกใบแจ้งหนี้แยกตาม GR" ที่ MCP เป็นผู้เรียกหลัก (ผู้ใช้พูด
 * ผ่าน AI ไม่พิมพ์ items เอง) มิฉะนั้นยอดใบแจ้งหนี้จะผิด (เท่ากับยอดทั้ง PO ทุกครั้ง)
 */

export class PurchaseBillingError extends Error {
  constructor(
    public code:
      | 'PO_REQUIRED'
      | 'PO_NOT_FOUND'
      | 'GR_NOT_FOUND'
      | 'GR_MISMATCH_PO'
      | 'GR_NOT_CONFIRMED'
      | 'GR_ALREADY_INVOICED'
      | 'INVOICE_EXISTS_NO_GR'
      | 'SUPPLIER_REQUIRED'
      | 'AMOUNT_REQUIRED'
      | 'INVOICE_NOT_FOUND'
      | 'OVER_BALANCE'
  | 'PO_SUPPLIER_MISMATCH'
  | 'CR_ACCOUNT_INVALID'
  | 'PO_CANCELLED',
    message: string
  ) {
    super(message)
  }
}

export interface CreatePurchaseInvoiceItem {
  poItemId?: string
  materialId?: string | null
  quantity: number
  unitPrice: number
}

export interface CreatePurchaseInvoicePayload {
  purchaseOrderId: string
  goodsReceiptId?: string | null
  goodsReceiptIds?: string[]
  /** รวมหลายใบสั่งซื้อไว้ในบิลเดียว — ต้องเป็นผู้ขายรายเดียวกัน */
  purchaseOrderIds?: string[]
  supplierInvoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  notes?: string
  items?: CreatePurchaseInvoiceItem[]
  drAccountId?: string | null
  // บัญชีปลายทางของหนี้ (ฝั่ง Cr) — ไม่ส่งมา = ใช้เจ้าหนี้การค้าตามผังบัญชี
  crAccountId?: string | null
  taxRate?: number
}

/** รายการจาก GR (join ราคาจาก PO item) — ใช้ derive items เมื่อผู้เรียกไม่ส่ง items มา */
function deriveItemsFromGoodsReceipts(tenantId: string, grIds: string[]): CreatePurchaseInvoiceItem[] {
  if (grIds.length === 0) return []
  const placeholders = grIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT gri.purchase_order_item_id as poItemId, gri.material_id as materialId,
      gri.accepted_qty as quantity, poi.unit_price as unitPrice
    FROM goods_receipt_items gri
    JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    WHERE gri.goods_receipt_id IN (${placeholders}) AND gri.accepted_qty > 0
  `).all(...grIds) as CreatePurchaseInvoiceItem[]
}

/**
 * ดึงรายการสินค้าจากใบสั่งซื้อโดยตรง — ใช้เมื่อออกบิลคลุมทั้งใบ (ไม่ได้เจาะจงใบรับสินค้า)
 * ตรวจกับข้อมูลจริงแล้ว: purchase_orders.subtotal เท่ากับ SUM(items.total_price) ครบทั้ง 56 ใบ
 * (ตารางนี้ไม่มีคอลัมน์ส่วนลด) จึงใช้ผลรวมรายการเป็นยอดได้โดยไม่เพี้ยน
 */
function deriveItemsFromPurchaseOrders(tenantId: string, poIds: string[]): CreatePurchaseInvoiceItem[] {
  if (poIds.length === 0) return []
  const placeholders = poIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT id as poItemId, material_id as materialId, quantity, unit_price as unitPrice
    FROM purchase_order_items
    WHERE tenant_id = ? AND purchase_order_id IN (${placeholders}) AND quantity > 0
  `).all(tenantId, ...poIds) as CreatePurchaseInvoiceItem[]
}

/**
 * สร้างใบแจ้งหนี้ซื้อจากใบสั่งซื้อ + (ถ้ามี) ใบรับสินค้าที่ยืนยันแล้ว ลง journal ทันที
 * (Dr สต็อกวัตถุดิบ/บัญชีที่เลือก + Dr ภาษีซื้อ = Cr เจ้าหนี้การค้า) พร้อม vat_entries
 */
export function createPurchaseInvoice(tenantId: string, actorEmail: string, payload: CreatePurchaseInvoicePayload) {
  const { purchaseOrderId, supplierInvoiceNumber, invoiceDate, dueDate, notes, drAccountId, crAccountId, taxRate: reqTaxRate } = payload
  if (!purchaseOrderId) throw new PurchaseBillingError('PO_REQUIRED', 'Purchase order is required')

  const grIds: string[] = Array.isArray(payload.goodsReceiptIds) && payload.goodsReceiptIds.length > 0
    ? payload.goodsReceiptIds
    : (payload.goodsReceiptId ? [payload.goodsReceiptId] : [])

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
  if (!po) throw new PurchaseBillingError('PO_NOT_FOUND', 'Purchase order not found')

  // รวมหลายใบสั่งซื้อไว้ในบิลเดียวได้ แต่ต้องเป็นผู้ขายรายเดียวกันเท่านั้น
  // เพราะหนี้และใบกำกับภาษีต้องแยกตามนิติบุคคล — เทียบเลขผู้เสียภาษีก่อน ไม่ใช่ชื่อร้าน
  const extraPoIds: string[] = Array.isArray(payload.purchaseOrderIds)
    ? payload.purchaseOrderIds.filter((x: string) => x && x !== purchaseOrderId)
    : []
  const allPoIds = [purchaseOrderId, ...extraPoIds]
  let extraSubtotal = 0
  if (extraPoIds.length > 0) {
    const ph = extraPoIds.map(() => '?').join(',')
    const others = db.prepare(
      `SELECT id, po_number, supplier_id, subtotal, status FROM purchase_orders WHERE tenant_id = ? AND id IN (${ph})`
    ).all(tenantId, ...extraPoIds) as any[]
    if (others.length !== extraPoIds.length) {
      throw new PurchaseBillingError('PO_NOT_FOUND', 'มีใบสั่งซื้อบางใบที่เลือกไม่พบในระบบ')
    }
    const taxOf = (sid: string) =>
      ((db.prepare('SELECT tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(sid, tenantId) as any)?.tax_id || '').trim()
    const baseTax = taxOf(po.supplier_id)
    for (const o of others) {
      const sameParty = baseTax && taxOf(o.supplier_id)
        ? taxOf(o.supplier_id) === baseTax
        : o.supplier_id === po.supplier_id
      if (!sameParty) {
        throw new PurchaseBillingError(
          'PO_SUPPLIER_MISMATCH',
          `ใบสั่งซื้อ ${o.po_number} เป็นของผู้ขายคนละราย รวมเข้าบิลเดียวกันไม่ได้ — หนี้และใบกำกับภาษีต้องแยกตามนิติบุคคล`
        )
      }
      if (o.status === 'CANCELLED') {
        throw new PurchaseBillingError('PO_CANCELLED', `ใบสั่งซื้อ ${o.po_number} ถูกยกเลิกไปแล้ว`)
      }
      extraSubtotal += Number(o.subtotal) || 0
    }
  }
  const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(po.supplier_id, tenantId) as any

  // กันดึง GR เดิมมาออกใบแจ้งหนี้ซ้ำ — ต้องยืนยันแล้ว, อยู่ใน PO เดียวกัน, ยังไม่ถูกใช้ออกใบไปก่อน
  if (grIds.length > 0) {
    const placeholders = grIds.map(() => '?').join(',')
    const grRows = db.prepare(
      `SELECT id, status, invoiced_at, purchase_order_id FROM goods_receipts WHERE tenant_id = ? AND id IN (${placeholders})`
    ).all(tenantId, ...grIds) as any[]
    for (const grId of grIds) {
      const row = grRows.find((r: any) => r.id === grId)
      if (!row) throw new PurchaseBillingError('GR_NOT_FOUND', `ไม่พบใบรับสินค้า: ${grId}`)
      if (row.purchase_order_id !== purchaseOrderId) {
        throw new PurchaseBillingError('GR_MISMATCH_PO', 'ใบรับสินค้าที่เลือกไม่ตรงกับใบสั่งซื้อนี้')
      }
      if (row.status !== 'CONFIRMED') {
        throw new PurchaseBillingError('GR_NOT_CONFIRMED', 'ใบรับสินค้าต้องยืนยันแล้วก่อนสร้างใบแจ้งหนี้')
      }
      if (row.invoiced_at) {
        throw new PurchaseBillingError('GR_ALREADY_INVOICED', 'ใบรับสินค้านี้ถูกใช้สร้างใบแจ้งหนี้ไปแล้ว กรุณาเลือกใบอื่นหรือยกเลิกใบแจ้งหนี้เดิมก่อน')
      }
    }
  } else {
    // ไม่ได้เลือกใบรับสินค้า = ออกใบแจ้งหนี้คลุมทั้ง PO
    // ต้องล็อก GR ที่ยืนยันแล้วของ PO นั้นไปด้วย ไม่งั้น GR จะค้างสถานะ "ยังไม่ออกใบ" ตลอดไป
    // แล้ว PO จะโผล่ในตัวเลือกสร้างใบแจ้งหนี้ทั้งที่กดไปก็ถูกเด้งว่าซ้ำ (เจอจริงที่ PO-2026-00029)
    // ยอดยังคิดจาก PO เหมือนเดิม — id พวกนี้ใช้เพื่อล็อก/ปลดล็อกตอนยกเลิกเท่านั้น
    // ล็อกใบรับสินค้าของ "ทุกใบสั่งซื้อที่รวมอยู่ในบิลนี้" ไม่ใช่แค่ใบหลัก
    // เดิมล็อกเฉพาะใบหลัก ใบที่เอามารวมจึงค้างสถานะ "ยังไม่ออกใบ" แล้วโผล่ให้เลือกซ้ำได้ตลอด
    const poPlaceholders = allPoIds.map(() => '?').join(',')
    const confirmedGrs = db.prepare(
      `SELECT id, invoiced_at, purchase_order_id FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id IN (${poPlaceholders}) AND status = 'CONFIRMED'`
    ).all(tenantId, ...allPoIds) as any[]
    const freeGrs = confirmedGrs.filter((r: any) => !r.invoiced_at)

    if (freeGrs.length > 0) {
      for (const row of freeGrs) grIds.push(row.id)
    } else if (confirmedGrs.length > 0) {
      // ใบรับสินค้าทุกใบของ PO ที่เลือกถูกใช้ออกใบแจ้งหนี้ไปหมดแล้ว
      throw new PurchaseBillingError('GR_ALREADY_INVOICED', 'ใบรับสินค้าของใบสั่งซื้อที่เลือกถูกใช้สร้างใบแจ้งหนี้ไปหมดแล้ว')
    } else {
      // ไม่มีใบรับสินค้าเลยสักใบ — กันออกบิลคลุมซ้ำ ต้องดูทั้งใบหลักเดิมและลิสต์ใบที่รวมเข้ามา
      const dup = (db.prepare(
        `SELECT pi_number, purchase_order_id, purchase_order_ids FROM purchase_invoices WHERE tenant_id = ? AND status != 'CANCELLED'`
      ).all(tenantId) as any[]).find((inv: any) => {
        if (allPoIds.includes(inv.purchase_order_id)) return true
        try { return (JSON.parse(inv.purchase_order_ids || '[]') as string[]).some(x => allPoIds.includes(x)) } catch { return false }
      })
      if (dup) throw new PurchaseBillingError('INVOICE_EXISTS_NO_GR', `ใบสั่งซื้อที่เลือกมีใบแจ้งหนี้อยู่แล้ว (${dup.pi_number})`)
    }
  }

  // คำนวณหลัง grIds ครบแล้ว (สาย "คลุมทั้ง PO" เติม id เข้ามาทีหลัง)
  const grIdsJson = JSON.stringify(grIds)

  // ลำดับ fallback ยอด/รายการ: items ที่ผู้เรียกส่งมาก่อน > derive จาก GR ที่ระบุ > ยอดทั้ง PO (ไม่มี GR)
  const userPickedGrs = Array.isArray(payload.goodsReceiptIds) && payload.goodsReceiptIds.length > 0
    ? payload.goodsReceiptIds
    : (payload.goodsReceiptId ? [payload.goodsReceiptId] : [])
  // ที่มาของรายการสินค้า เรียงตามความเจาะจง:
  //   1. items ที่ผู้เรียกส่งมาเอง
  //   2. ใบรับสินค้าที่ผู้ใช้เจาะจงเลือก (คลุมเฉพาะใบสั่งซื้อหลัก)
  //   3. รายการจากใบสั่งซื้อทุกใบที่รวมอยู่ในบิล  <-- ทางนี้เพิ่งเพิ่ม
  // เดิมไม่มีข้อ 3 ใบแจ้งหนี้ที่สร้างจาก dropdown ใบสั่งซื้อจึงไม่มีรายการสินค้าเลยสักบรรทัด
  // (เช็คข้อมูลจริงแล้ว: 13 จาก 13 ใบว่างทั้งหมด) และยอดก็มาจาก po.subtotal ดิบ ๆ
  let items = (payload.items && payload.items.length > 0)
    ? payload.items
    : deriveItemsFromGoodsReceipts(tenantId, userPickedGrs)
  // รายการจากใบรับสินค้าคลุมแค่ใบหลัก ยอดใบที่รวมเข้ามาจึงต้องบวก extraSubtotal ต่างหาก
  // แต่รายการจากใบสั่งซื้อคลุมครบทุกใบอยู่แล้ว ถ้าบวกซ้ำจะได้ยอดเกิน
  let extraNeeded = true
  if (items.length === 0) {
    const poItems = deriveItemsFromPurchaseOrders(tenantId, allPoIds)
    if (poItems.length > 0) { items = poItems; extraNeeded = false }
  }

  const id = generateId()
  const piNumber = formatDocumentNumber('PI', tenantId, 'PURCHASE_INVOICE', new Date().getFullYear(), 5)
  const now = new Date().toISOString()

  const subtotal = items.length > 0
    ? items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0) + (extraNeeded ? extraSubtotal : 0)
    : po.subtotal + extraSubtotal

  const taxRate = reqTaxRate != null ? Number(reqTaxRate) : (po.tax_rate ?? 7)
  const taxAmount = subtotal * (taxRate / 100)
  const totalAmount = subtotal + taxAmount

  // Resolve accounts before transaction (auto-create if not yet in chart of accounts)
  const resolvedDrAccId = drAccountId
    ? (db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(drAccountId, tenantId) as any)?.id ?? null
    : null
  const inventoryAccId = resolvedDrAccId
    ?? getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
  // ปลายทางของหนี้: ถ้าผู้ใช้เลือกมาต้องเป็นบัญชีหนี้สินของ tenant นี้จริง ๆ
  // เลือกผิดประเภท (เช่นไปลงบัญชีรายได้) งบจะเพี้ยนเงียบ ๆ จึงเช็ค type ก่อนรับ
  const pickedCrAcc = crAccountId
    ? (db.prepare("SELECT id FROM accounts WHERE id = ? AND tenant_id = ? AND type = 'LIABILITY'").get(crAccountId, tenantId) as any)?.id ?? null
    : null
  if (crAccountId && !pickedCrAcc) {
    throw new PurchaseBillingError('CR_ACCOUNT_INVALID', 'บัญชีปลายทางของหนี้ที่เลือกไม่ใช่บัญชีหนี้สินของกิจการนี้')
  }
  const payableAccId = pickedCrAcc
    ?? getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
  const vatAccId = taxAmount > 0 ? getOrCreateAccount(tenantId, ACC.INPUT_VAT, ACC_META[ACC.INPUT_VAT]!.name, ACC_META[ACC.INPUT_VAT]!.type, ACC_META[ACC.INPUT_VAT]!.category, ACC_META[ACC.INPUT_VAT]!.normalBalance) : null
  const journalId = generateId()
  const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(invoiceDate || now).getFullYear(), 5)

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_invoice_number, purchase_order_id,
        supplier_id, goods_receipt_id, goods_receipt_ids, purchase_order_ids, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount,
        balance_amount, status, payment_status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', 'UNPAID', ?, ?, ?)
    `).run(id, tenantId, piNumber, supplierInvoiceNumber || '', purchaseOrderId, po.supplier_id,
      grIds[0] || null, grIdsJson, JSON.stringify(allPoIds), invoiceDate || now, dueDate || null, subtotal, taxRate, taxAmount,
      totalAmount, totalAmount, notes || '', now, now)

    if (items.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO purchase_invoice_items (id, tenant_id, purchase_invoice_id, purchase_order_item_id,
          material_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        const total = item.quantity * item.unitPrice
        // FK ผิดตาราง (ชี้ materials ทั้งที่ค่าจริงเป็น stock_items) ถูก migrate ออกแล้ว 2026-09-14
        // จึงเขียนค่าจริงได้ — GET /invoices/:id join คอลัมน์นี้กับ stock_items อยู่แล้ว
        insertItem.run(generateId(), tenantId, id, item.poItemId || null, item.materialId || null,
          item.quantity, item.unitPrice, total)
      }
    }

    // Lock the goods receipts this invoice draws on so they can't be pulled into another one
    if (grIds.length > 0) {
      const markInvoiced = db.prepare('UPDATE goods_receipts SET invoiced_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      for (const grId of grIds) markInvoiced.run(now, now, grId, tenantId)
    }

    // === POST JOURNAL ENTRY ===
    // Dr สต็อกวัตถุดิบ (1107, หรือบัญชีที่เลือก) + Dr ภาษีซื้อ (1110) ถ้ามี VAT
    // Cr เจ้าหนี้การค้า (2101)
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'PURCHASE_INVOICE', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(journalId, tenantId, journalNumber, (invoiceDate || now).substring(0, 10),
      id, `รับใบแจ้งหนี้ซื้อ ${piNumber}`, totalAmount, totalAmount, now, actorEmail, notes || null,
      actorEmail, now, now)

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let lineNo = 1
    const drAccLabel = resolvedDrAccId
      ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(resolvedDrAccId) as any)?.name ?? 'ค่าใช้จ่าย'
      : 'สต็อกวัตถุดิบ'
    insertLine.run(generateId(), tenantId, journalId, inventoryAccId, lineNo++, `${drAccLabel} - ${piNumber}`, subtotal, 0)
    if (vatAccId && taxAmount > 0) {
      insertLine.run(generateId(), tenantId, journalId, vatAccId, lineNo++, `ภาษีซื้อ - ${piNumber}`, taxAmount, 0)
    }
    insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${piNumber}`, 0, totalAmount)

    // VAT Entry (Input VAT)
    if (taxAmount > 0) {
      db.prepare(`
        INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
      `).run(generateId(), tenantId, 'PURCHASE_INVOICE', id, piNumber, (invoiceDate || now).substring(0, 10),
        supplier?.name || '', supplier?.tax_id || null,
        subtotal, taxRate, taxAmount, totalAmount, now)
    }
  })

  transaction()

  const invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const invoiceItems = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id)
  return { ...invoice, items: invoiceItems }
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
    if (amount > invoice.balance_amount) throw new PurchaseBillingError('OVER_BALANCE', 'Payment amount exceeds invoice balance')
  }

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
      const newPaid = invoice.paid_amount + amount
      const newBalance = invoice.total_amount - newPaid
      const newPaymentStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

      db.prepare(`
        UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, newPaymentStatus, now, purchaseInvoiceId, tenantId)
    }

    // === POST JOURNAL ENTRY ===
    // Dr เจ้าหนี้การค้า (2101)
    // Cr เงินสด/ธนาคาร (1101/1102) + Cr ภาษีหัก ณ ที่จ่าย (2105) ถ้ามี WHT
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'SUPPLIER_PAYMENT', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(journalId, tenantId, journalNumber, (paymentDate || now).substring(0, 10),
      id, `จ่ายชำระ ${paymentNumber}`, amount, amount, now, actorEmail, notes || null,
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
