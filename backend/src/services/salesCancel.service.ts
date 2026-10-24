import db from '../db/sqlite'
import { gateOrCreate, CreateRequestArgs, GateUser } from './approvalGate.service'
import { voidReceipt, reverseSalesJournal, restoreStockForSO, soHasOut, STOCK_DEDUCTED_STATUSES } from '../routes/sales/shared'

/**
 * ยกเลิก/void เอกสารขาย — เจ้าของสั่ง 2026-10-22 "ห้ามยกเลิกใบขายนอกจากการขออนุญาต"
 *
 * ทุกทาง (SO, ใบแจ้งหนี้, ใบเสร็จ, ใบลดหนี้) ผ่านประตูหมวด 'sales_cancel' ซึ่งต้องขออนุมัติเสมอ
 * (approvalGate.service ALWAYS_REQUIRED) — ADMIN/MASTER/OWNER ทำได้เลยแต่ถูกบันทึก (recordAutoAction)
 * คนอื่นได้ 202 + คำขอ แล้ว routes/approval.routes.ts เรียก executor ด้านล่างตอนอนุมัติ
 * ตรรกะยกเลิกจริงอยู่ที่นี่ที่เดียว ใช้ทั้งตอนทำเลย (ADMIN) และตอนอนุมัติ — ไม่มีสองชุด
 */

export type SalesCancelKind = 'sales_order' | 'invoice' | 'receipt' | 'credit_note'

/** ยกเลิกไม่ได้ด้วยเหตุทางธุรกิจ — status = HTTP status, message ภาษาไทยส่งถึงหน้าจอตรง ๆ */
export class SalesCancelError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const KIND_LABEL: Record<SalesCancelKind, string> = {
  sales_order: 'คำสั่งขาย', invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จรับเงิน', credit_note: 'ใบลดหนี้',
}
const KIND_REF_TYPE: Record<SalesCancelKind, string> = {
  sales_order: 'sales_orders', invoice: 'invoices', receipt: 'receipts', credit_note: 'credit_notes',
}

/** งวดภาษีของวันที่เอกสารถูกปิดแล้วหรือยัง — คืน 'เดือน/ปี' ถ้าปิด (ตรรกะเดียวกับ journal.routes closedPeriodLabel) */
export function closedTaxPeriodOf(tenantId: string, date: string | null | undefined): string | null {
  if (!date) return null
  const ymd = String(date).split('T')[0].split(' ')[0]
  const [year, month] = ymd.split('-').map(Number)
  if (!year || !month) return null
  const period = db.prepare('SELECT status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?')
    .get(tenantId, year, month) as { status: string } | undefined
  return period?.status === 'CLOSED' ? `${month}/${year}` : null
}

export interface SalesCancelGateInput {
  tenantId: string
  user: GateUser
  kind: SalesCancelKind
  refId: string
  docNumber: string
  docDate?: string | null
  amount?: number
  reason?: unknown
}

/**
 * ด่านยกเลิกเอกสารขาย — pending ไม่ใช่ null = ต้องตอบ 202 แล้วหยุด
 * pending = null (ผู้อนุมัติทำเอง) → ยกเลิกเลย แล้ว recordAutoAction(gateArgs)
 * งวดภาษีที่ปิดแล้วไม่มีทางลัด — ไปทางเดียวกัน แต่ผู้อนุมัติเห็นใน payload/คำอธิบาย
 */
export function gateSalesCancel(input: SalesCancelGateInput): { pending: any | null; gateArgs: CreateRequestArgs } {
  const closed = closedTaxPeriodOf(input.tenantId, input.docDate)
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
  const amount = Math.round(Math.abs(Number(input.amount) || 0) * 100) / 100
  const gateArgs: CreateRequestArgs = {
    tenantId: input.tenantId,
    user: input.user,
    category: 'sales_cancel',
    refType: KIND_REF_TYPE[input.kind],
    refId: input.refId,
    amount,
    description: `ขอยกเลิก${KIND_LABEL[input.kind]} ${input.docNumber} ยอด ฿${amount.toLocaleString()}`
      + (reason ? ` เนื่องจาก ${reason}` : '')
      + (closed ? ` ⚠️ เอกสารอยู่ในงวดภาษีที่ปิดแล้ว (${closed})` : ''),
    payload: {
      kind: input.kind, refId: input.refId, docNumber: input.docNumber, docDate: input.docDate || null,
      reason: reason || null, taxPeriodClosed: !!closed, taxPeriod: closed, severity: 'high',
    },
  }
  return { pending: gateOrCreate(gateArgs), gateArgs }
}

/** body ของคำตอบ 202 — รูปเดียวกับหมวดอื่น (pending_approval + request_number) */
export function pendingCancelBody(pending: any, docNumber: string) {
  return {
    success: true,
    pending_approval: true,
    request_id: pending.id,
    request_number: pending.request_number,
    message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) — ${docNumber} จะถูกยกเลิกเมื่อผู้อนุมัติยืนยัน`,
  }
}

// ─── คำสั่งขาย ────────────────────────────────────────────────────────────────

/** SO ที่มีใบแจ้งหนี้ (ยังไม่ยกเลิก) ห้ามยกเลิก — คืนสต็อก/ต้นทุนแล้วแต่รายได้ยังค้างในงบ */
export function assertSalesOrderCancellable(tenantId: string, so: any) {
  if (!so) throw new SalesCancelError(404, 'Sales order not found')
  if (so.status === 'CANCELLED') throw new SalesCancelError(409, `คำสั่งขาย ${so.so_number} ถูกยกเลิกไปแล้ว`)
  if (so.status === 'COMPLETED') throw new SalesCancelError(400, `คำสั่งขาย ${so.so_number} เสร็จสิ้นแล้ว ยกเลิกไม่ได้`)
  const inv = db.prepare("SELECT invoice_number FROM invoices WHERE tenant_id = ? AND sales_order_id = ? AND status != 'CANCELLED' LIMIT 1")
    .get(tenantId, so.id) as any
  if (inv) {
    throw new SalesCancelError(409, `คำสั่งขาย ${so.so_number} มีใบแจ้งหนี้ ${inv.invoice_number} อยู่ — ยกเลิกใบแจ้งหนี้ก่อน แล้วจึงยกเลิกคำสั่งขาย`)
  }
}

/** เปลี่ยนสถานะเป็น CANCELLED + คืนสต็อก/ต้นทุน ในทรานแซกชันเดียว */
export function cancelSalesOrderNow(tenantId: string, soId: string) {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  assertSalesOrderCancellable(tenantId, so)
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(new Date().toISOString(), soId, tenantId)
    // เคยตัดสต็อกแล้ว (สถานะหลังยืนยัน) หรือมี OUT จริงผ่านใบส่งของ → คืน (ไม่คืนของที่ไม่เคยตัด)
    if (STOCK_DEDUCTED_STATUSES.includes(so.status) || soHasOut(tenantId, so.id, so.so_number)) {
      restoreStockForSO(tenantId, so.id, so.so_number)
    }
  })()
  return db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
}

// ─── ใบแจ้งหนี้ ───────────────────────────────────────────────────────────────

/**
 * ยกเลิกไม่ได้ถ้า: ยกเลิกแล้ว · ชำระครบแล้ว (PAID เป็นสถานะสุดท้าย — ยกเลิกใบเสร็จก่อน; ยกเว้นใบกำกับจากบิล POS
 * ที่เกิดมาเป็น PAID และเป็นเอกสารล้วน) · มีใบลดหนี้ที่ออกแล้ว (journal ใบลดหนี้กลับรายได้ไปแล้วส่วนหนึ่ง
 * ถ้ากลับ journal ใบแจ้งหนี้ทั้งใบซ้ำอีก รายได้ถูกกลับเกินจริง)
 */
export function assertInvoiceCancellable(tenantId: string, inv: any) {
  if (!inv) throw new SalesCancelError(404, 'Invoice not found')
  if (inv.status === 'CANCELLED') throw new SalesCancelError(409, `ใบแจ้งหนี้ ${inv.invoice_number} ถูกยกเลิกไปแล้ว`)
  if (inv.status === 'PAID' && inv.pos_bill_id == null) {
    throw new SalesCancelError(409, `ใบแจ้งหนี้ ${inv.invoice_number} ชำระครบแล้ว ยกเลิกไม่ได้ — ยกเลิกใบเสร็จรับเงินก่อน`)
  }
  const cn = db.prepare("SELECT cn_number FROM credit_notes WHERE tenant_id = ? AND invoice_id = ? AND status NOT IN ('DRAFT', 'CANCELLED') LIMIT 1")
    .get(tenantId, inv.id) as any
  if (cn) {
    throw new SalesCancelError(409, `ใบแจ้งหนี้ ${inv.invoice_number} มีใบลดหนี้ ${cn.cn_number} ที่ออกแล้ว — ยกเลิกใบลดหนี้ก่อน ไม่งั้นรายได้ถูกกลับรายการซ้ำ`)
  }
}

/**
 * ยกเลิกใบแจ้งหนี้: void ใบเสร็จทุกใบ + กลับ journal (เฉพาะใบที่ไม่ได้มาจากบิล POS — ใบ POS เป็นเอกสารล้วน
 * ดูคอมเมนต์เดิมใน invoices.ts) + ยกเลิกใบลดหนี้ DRAFT ที่ค้าง (ยังไม่ลงบัญชี ปล่อยไว้จะออกทีหลังได้)
 */
export function cancelInvoiceNow(tenantId: string, invoiceId: string) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
  assertInvoiceCancellable(tenantId, inv)
  const now = new Date().toISOString()
  db.transaction(() => {
    // (ย้ายมาจาก invoices.ts PUT /:id/status) reverseSalesJournal() เป็น no-op ถ้าไม่เคยลง journal หรือกลับไปแล้ว
    // ⚠️ ใบที่ออกจากบิล POS (pos_bill_id ไม่เป็น null) เป็น "เอกสารล้วน" ไม่มี journal/vat_entries/
    // การตัดสต็อกของตัวเองเลย — ตอนปิดบิล POS ลงบัญชีไปครบแล้ว (ดู createInvoiceFromPosBill() ใน
    // services/salesBilling.service.ts) ถ้าอนาคตมีใครเผลอไปเพิ่ม journal ให้สายนี้ จะกลับรายการผิดตัวทันที
    // จึง reverse เฉพาะใบที่ไม่ได้มาจากบิล POS เท่านั้น ถ้าลูกค้าต้องคืนเงินจริงสำหรับบิล POS
    // ให้ไปยกเลิกที่บิล POS เอง (cancelPosBill() คืนสต็อก + กลับ journal ครบอยู่แล้ว)
    if (inv.pos_bill_id == null) {
      const so = inv.sales_order_id
        ? (db.prepare('SELECT so_number FROM sales_orders WHERE id = ? AND tenant_id = ?').get(inv.sales_order_id, tenantId) as any)
        : null
      const receiptRows = db.prepare('SELECT * FROM receipts WHERE invoice_id = ? AND tenant_id = ?').all(invoiceId, tenantId) as any[]
      for (const rc of receiptRows) voidReceipt(tenantId, rc)
      reverseSalesJournal(tenantId, invoiceId, inv.invoice_number, so?.so_number)
    }
    db.prepare("UPDATE credit_notes SET status = 'CANCELLED', updated_at = ? WHERE tenant_id = ? AND invoice_id = ? AND status = 'DRAFT'")
      .run(now, tenantId, invoiceId)
    db.prepare("UPDATE invoices SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?").run(now, invoiceId, tenantId)
  })()
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
}

// ─── ใบเสร็จรับเงิน ───────────────────────────────────────────────────────────

export function voidReceiptNow(tenantId: string, receiptId: string) {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND tenant_id = ?').get(receiptId, tenantId) as any
  if (!receipt) throw new SalesCancelError(404, 'Receipt not found')
  db.transaction(() => { voidReceipt(tenantId, receipt) })()
}
