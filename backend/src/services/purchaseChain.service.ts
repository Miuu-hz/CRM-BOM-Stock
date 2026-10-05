import db from '../db/sqlite'
import { closedPeriodLabel } from '../routes/journal.routes'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from './goodsReceipt.service'
import { createPurchaseInvoice, paySupplier } from './purchaseBilling.service'
import { poNotReceivableMessage } from './purchaseOrderUpdate.service'

/**
 * เดินบิลซื้อให้ครบสาย PO → GR → ใบแจ้งหนี้ซื้อ (PI) → บันทึกจ่ายเงิน (เฉพาะ PO ที่ is_paid)
 *
 * ที่มา (2026-10-06): create_draft_po ของ MCP เก็บข้อมูลการจ่ายเงินไว้ที่ PO แต่ไม่มีอะไรพาไปต่อ —
 * บิลที่ AI ป้อนจึงค้างเป็น PO DRAFT ไม่มี GR/PI/ใบจ่ายเงิน (สต็อกไม่เข้า เจ้าหนี้/เงินออกไม่ลงบัญชี)
 * ตัวนี้เรียก service ตัวเดียวกับหน้าเว็บทุกขั้น (ไม่มีสำเนาตรรกะ) ใช้ทั้ง MCP complete_purchase_bill
 * และสคริปต์ซ่อม scripts/repair-mcp-bills-2026-10-06.ts
 *
 * วันที่ของทุกเอกสารในสาย = วันที่สั่งซื้อของ PO (= วันที่บนบิล) — เลขที่เอกสารจึงตามวันบนบิลด้วย
 * ทำต่อจากจุดที่ค้าง (ยืนยัน GR ร่างที่มีอยู่, ออก PI จาก GR ที่ยังไม่ออก, จ่ายยอดค้างของ PI เดิม) เรียกซ้ำได้
 * สิทธิ์ (อนุมัติ PO / แตะเงิน) ผู้เรียกต้องเช็คเอง — service ไม่รู้จัก caller
 */

export interface PurchaseChainResult {
  poId: string
  poNumber: string
  /** ขั้นที่ทำไปแล้ว (dryRun = ขั้นที่จะทำ) */
  steps: string[]
  /** เหตุที่ไปต่อไม่ได้ — ขั้นก่อนหน้าที่ทำไปแล้วยังคงอยู่ */
  blocker: string | null
  complete: boolean
}

/** สถานะ PO ที่ต้องอนุมัติก่อนรับของ */
export const PO_NEEDS_APPROVAL = ['DRAFT', 'SUBMITTED']

function openInvoicesOfPo(tenantId: string, poId: string): any[] {
  return db.prepare(`
    SELECT id, pi_number, balance_amount FROM purchase_invoices
    WHERE tenant_id = ? AND status != 'CANCELLED' AND balance_amount > 0.005
      AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)
  `).all(tenantId, poId, `%"${poId}"%`) as any[]
}

/**
 * ยอดที่ PO บอกว่าจ่ายไปแล้ว แต่ใบแจ้งหนี้ยังไม่ได้บันทึกจ่าย
 * is_paid + paid_amount น้อยกว่ายอด PO = จ่ายบางส่วน → จ่ายแค่ paid_amount ส่วนที่เหลือค้างเป็นเจ้าหนี้
 * is_paid + paid_amount ว่าง/0/ครบยอด = จ่ายเต็มยอดค้างของใบแจ้งหนี้
 * หักยอดที่ใบแจ้งหนี้ของ PO นี้จ่ายไปแล้ว — เรียกซ้ำแล้วไม่จ่ายซ้ำ
 */
export function poPaymentTarget(tenantId: string, po: any): { partial: boolean; remaining: number } {
  if (po.is_paid !== 1) return { partial: false, remaining: 0 }
  const paid = Number(po.paid_amount) || 0
  const partial = paid > 0.005 && paid < (Number(po.total_amount) || 0) - 0.005
  if (!partial) return { partial: false, remaining: Infinity }
  const already = (db.prepare(`
    SELECT COALESCE(SUM(paid_amount), 0) AS s FROM purchase_invoices
    WHERE tenant_id = ? AND status != 'CANCELLED' AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)
  `).get(tenantId, po.id, `%"${po.id}"%`) as any).s as number
  return { partial: true, remaining: Math.max(0, Math.round((paid - already) * 100) / 100) }
}

function freeGoodsReceipts(tenantId: string, poId: string): any[] {
  return db.prepare(
    "SELECT id, gr_number FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? AND status = 'CONFIRMED' AND invoiced_at IS NULL"
  ).all(tenantId, poId) as any[]
}

export function completePurchaseChain(
  tenantId: string,
  actor: string,
  userId: string,
  poId: string,
  opts: { dryRun?: boolean } = {}
): PurchaseChainResult {
  const dry = !!opts.dryRun
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(poId, tenantId) as any
  if (!po) throw new Error(`ไม่พบ PO: ${poId}`)

  const res: PurchaseChainResult = { poId: po.id, poNumber: po.po_number, steps: [], blocker: null, complete: false }
  const block = (msg: string) => { res.blocker = msg; return res }
  const isPaid = po.is_paid === 1
  const docDate = String(po.order_date || new Date().toISOString()).slice(0, 10)

  // ── ตรวจทุกอย่างก่อนเขียนอะไรลง DB ──
  if (po.status === 'CANCELLED') return block('PO ถูกยกเลิกแล้ว')
  if (!po.supplier_id) return block('PO ยังไม่ระบุผู้ขาย — แก้ PO ให้มีผู้ขายก่อน')
  const closed = closedPeriodLabel(tenantId, docDate)
  if (closed) return block(`งวด ${closed} ปิดบัญชีแล้ว ลงเอกสารวันที่ ${docDate} ไม่ได้`)
  const pending = getPendingPoItems(tenantId, po.id)
  if (pending.length > 0) {
    const notReceivable = poNotReceivableMessage(tenantId, po.id)
    if (notReceivable) return block(notReceivable)
  }

  const run = (label: string, fn: () => string | void) => {
    if (dry) { res.steps.push(label); return }
    const detail = fn()
    res.steps.push(detail ? `${label}: ${detail}` : label)
  }

  try {
    if (PO_NEEDS_APPROVAL.includes(po.status)) {
      run(`อนุมัติ ${po.po_number}`, () => {
        const now = new Date().toISOString()
        db.prepare("UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(userId, now, now, po.id, tenantId)
      })
    }

    const draftGr = db.prepare("SELECT id, gr_number FROM goods_receipts WHERE purchase_order_id = ? AND tenant_id = ? AND status = 'DRAFT'")
      .get(po.id, tenantId) as any
    if (draftGr) run(`ยืนยันใบรับสินค้าร่าง ${draftGr.gr_number}`, () => { confirmGoodsReceipt(tenantId, userId, draftGr.id) })

    // dry-run ยืนยัน GR ร่างไม่ได้จริง — ถือว่ายังค้างตาม PO ปัจจุบัน (ถ้ามีร่างอยู่ ร่างจะกินส่วนนี้ไป)
    const stillPending = dry ? (draftGr ? [] : pending) : getPendingPoItems(tenantId, po.id)
    if (stillPending.length > 0) {
      run(`รับสินค้าที่ค้าง ${stillPending.length} รายการ (วันที่ ${docDate})`, () => {
        const gr = createGoodsReceipt(tenantId, actor, {
          purchaseOrderId: po.id,
          receiptDate: docDate,
          deliveryNoteNo: po.payment_reference || null,
          notes: `[ปิดสายบิล ${po.po_number}]`,
          items: stillPending.map(p => ({
            poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty,
          })),
        }) as any
        confirmGoodsReceipt(tenantId, userId, gr.id)
        return gr.gr_number
      })
    }

    const grs = freeGoodsReceipts(tenantId, po.id)
    if (grs.length > 0 || (dry && (draftGr || stillPending.length > 0))) {
      run(`ออกใบแจ้งหนี้ซื้อ (วันที่ ${docDate})`, () => {
        // autoPay: false — จ่ายแยกขั้นถัดไป เพราะ auto-settle ใน createPurchaseInvoice กลืน error เงียบ
        const pi = createPurchaseInvoice(tenantId, actor, {
          goodsReceiptIds: grs.map(g => g.id),
          invoiceDate: docDate,
          supplierInvoiceNumber: po.payment_reference || '',
          autoPay: false,
        }) as any
        return `${pi.pi_number} ฿${pi.total_amount}`
      })
    }

    if (isPaid) {
      const target = poPaymentTarget(tenantId, po)
      let left = target.remaining
      const note = target.partial ? ` (จ่ายบางส่วนตามบิล ฿${po.paid_amount} ที่เหลือค้างเป็นเจ้าหนี้)` : ''
      if (dry) {
        // ใบแจ้งหนี้ใหม่ยังไม่เกิด — บอกตามยอด PO · ใบเดิมที่ค้างอยู่ก็นับด้วย (เดิมขึ้นขั้นจ่ายเงินทั้งที่จ่ายครบแล้ว)
        const willInvoice = res.steps.some(st => st.startsWith('ออกใบแจ้งหนี้ซื้อ'))
        const openBal = openInvoicesOfPo(tenantId, po.id).reduce((a, i) => a + Number(i.balance_amount), 0)
          + (willInvoice ? Number(po.total_amount) || 0 : 0)
        const amt = Math.min(left, openBal)
        if (amt > 0.005) res.steps.push(`บันทึกจ่ายเงิน ฿${Math.round(amt * 100) / 100}${note}`)
      } else {
        for (const inv of openInvoicesOfPo(tenantId, po.id)) {
          const amount = Math.round(Math.min(left, Number(inv.balance_amount)) * 100) / 100
          if (amount <= 0.005) break
          run(`จ่ายเงิน ${inv.pi_number}${note}`, () => {
            const pay = paySupplier(tenantId, actor, {
              supplierId: po.supplier_id,
              purchaseInvoiceId: inv.id,
              paymentDate: docDate,
              paymentMethod: po.payment_method || 'TRANSFER',
              paymentReference: po.payment_reference || '',
              bankAccountId: po.bank_account_id || null,
              amount,
              notes: `[ปิดสายบิล ${po.po_number}]`,
            }) as any
            return `${pay.payment_number} ฿${pay.amount}`
          })
          left -= amount
        }
      }
    }
  } catch (e: any) {
    return block(e?.message || String(e))
  }

  res.complete = !dry
  return res
}

/**
 * PO ที่ป้อนผ่าน MCP (create_draft_po ใส่ notes '[AI Draft]' เสมอ) แล้วยังเดินไม่ครบสาย:
 * ยังมีของค้างรับ / มี GR ยังไม่ออกใบแจ้งหนี้ / จ่ายแล้วตามบิลแต่ใบแจ้งหนี้ยังค้างจ่าย หรือยังไม่มีใบแจ้งหนี้เลย
 */
export function findStuckMcpPurchaseOrders(tenantId?: string): any[] {
  const rows = db.prepare(`
    SELECT po.* FROM purchase_orders po
    WHERE po.notes LIKE '[AI Draft]%' AND po.status != 'CANCELLED' ${tenantId ? 'AND po.tenant_id = ?' : ''}
    ORDER BY po.tenant_id, po.order_date
  `).all(...(tenantId ? [tenantId] : [])) as any[]
  return rows.filter(po => {
    if (!db.prepare('SELECT 1 FROM purchase_order_items WHERE purchase_order_id = ? AND tenant_id = ?').get(po.id, po.tenant_id)) return false
    if (getPendingPoItems(po.tenant_id, po.id).length > 0) return true
    if (freeGoodsReceipts(po.tenant_id, po.id).length > 0) return true
    const hasInvoice = db.prepare(
      "SELECT 1 FROM purchase_invoices WHERE tenant_id = ? AND status != 'CANCELLED' AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)"
    ).get(po.tenant_id, po.id, `%"${po.id}"%`)
    if (!hasInvoice) return true
    const open = openInvoicesOfPo(po.tenant_id, po.id)
    return open.length > 0 && poPaymentTarget(po.tenant_id, po).remaining > 0.005
  })
}
