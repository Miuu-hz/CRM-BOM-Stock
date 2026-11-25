import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber, thaiDateStr, docYear } from '../../utils/id'
import { ACC, ACC_META } from '../../config/accountCodes'
import { getOrCreateAccount, issuedBasePerUnit, reverseSalesJournalByRef, invoiceServiceShare } from './shared'
import { isServiceItem } from '../../services/stockItem.service'
import { gateSalesCancel, pendingCancelBody, SalesCancelError } from '../../services/salesCancel.service'
import { recordAutoAction } from '../../services/approvalGate.service'
import { postJournal, JournalError, isVatRegistered } from '../../services/accounting.service'
import { convertQuantityBidirectional, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'
import { calcVat } from '../../utils/vat'
import { closedPeriodLabel } from '../journal.routes'
import { registerCredit, removeCredit, CustomerCreditError } from '../../services/customerCredit.service'

const router = Router()

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** เหตุผลตามกฎหมายในการออกใบลดหนี้ (ประมวลรัษฎากร มาตรา 82/10) */
export const LEGAL_REASON_CODES: Record<string, string> = {
  DEFECTIVE: 'สินค้าชำรุด/บกพร่อง',
  NOT_AS_AGREED: 'ไม่ตรงตามที่ตกลง/ตัวอย่าง',
  AGREED_RETURN: 'คืนตามข้อตกลงทางการค้า',
  PRICE_ERROR: 'คำนวณราคาสูงกว่าความจริง',
  SHORT_DELIVERY: 'ส่งขาดจำนวน',
  OTHER_LEGAL: 'เหตุอื่นตาม ม.82/10',
}

/** ตรวจรูปแบบวันที่ YYYY-MM-DD ที่เป็นวันที่ปฏิทินจริง */
function isRealYmd(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return y >= 1000 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** จำนวนวันระหว่างสองวันที่ YYYY-MM-DD (b - a) */
function diffDaysYmd(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split('-').map(Number)
  const [by, bm, bd] = bYmd.split('-').map(Number)
  const utcA = Date.UTC(ay, am - 1, ad)
  const utcB = Date.UTC(by, bm - 1, bd)
  return Math.round((utcB - utcA) / 86400000)
}

/**
 * ตรวจวันที่ใบลดหนี้ (credit_date):
 * - ต้องเป็นวันที่ปฏิทินจริง YYYY-MM-DD
 * - ห้ามก่อนวันที่ใบแจ้งหนี้เดิม
 * - ห้ามเป็นวันในอนาคต (เทียบเวลาไทย)
 * - ห้ามอยู่ในงวดภาษีที่ปิดแล้ว (400 พร้อมระบุชื่อเดือน/ปี)
 */
function validateCreditDate(tenantId: string, creditDateYmd: string, invoiceDateRaw: string | null | undefined): string | null {
  if (!isRealYmd(creditDateYmd)) {
    return 'รูปแบบวันที่ใบลดหนี้ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD ที่เป็นวันจริงในปฏิทิน)'
  }
  const todayYmd = thaiDateStr()
  if (creditDateYmd > todayYmd) {
    return 'วันที่ใบลดหนี้ห้ามเป็นวันในอนาคต'
  }
  if (invoiceDateRaw) {
    const invYmd = thaiDateStr(invoiceDateRaw)
    if (creditDateYmd < invYmd) {
      return `วันที่ใบลดหนี้ (${creditDateYmd}) ห้ามก่อนวันที่ใบแจ้งหนี้เดิม (${invYmd})`
    }
  }
  const closed = closedPeriodLabel(tenantId, creditDateYmd)
  if (closed) {
    return `งวด ${closed} ปิดแล้ว ไม่สามารถออกใบลดหนี้ในงวดนี้ได้`
  }
  return null
}

/**
 * คำนวณราคาต่อหน่วยและจำนวนที่ยังลดหนี้ได้ของแต่ละบรรทัดในใบแจ้งหนี้ (ข้อ 4d):
 * - บรรทัดค่าขนส่ง/ค่าบริการเพิ่มเติมส่วนหัว (extra_charge) แยกออก ไม่นำมาปันส่วนลดท้ายบิล และไม่ให้ติ๊กคืนสินค้า
 * - ราคาบรรทัดสินค้า = ยอดสุทธิหลังส่วนลดรายบรรทัด (ii.total_price) หักส่วนลดท้ายบิล (invoices.discount_amount)
 *   ที่ปันส่วนตามสัดส่วนยอดสินค้า โดยบรรทัดสินค้าตัวสุดท้ายรับเศษปัดทศนิยม
 * - คืนครบทุกบรรทัดสินค้าจะได้ยอดรวมเท่ากับยอดสินค้าสุทธิหลังหักส่วนลดท้ายบิลพอดี และไม่เกินยอดใบแจ้งหนี้
 */
export function computeInvoiceItemsCreditable(tenantId: string, invoice: any, rawItems: any[]) {
  const extraAmt = r2(invoice.extra_charge_amount || 0)
  const extraLabel = invoice.extra_charge_label || 'ค่าขนส่ง'
  const headerDiscount = r2(invoice.discount_amount || 0)

  // ระบุบรรทัด extra charge (สร้างจาก createInvoiceFromSO / createInvoiceFromPosBill: sales_order_item_id IS NULL, stock_item_id IS NULL)
  let extraMatched = false
  const isExtraLine = (it: any): boolean => {
    if (extraAmt <= 0 || extraMatched) return false
    if (!it.sales_order_item_id && !it.stock_item_id && it.product_name === extraLabel && Math.abs(r2(it.total_price) - extraAmt) < 0.005) {
      extraMatched = true
      return true
    }
    return false
  }

  const flags = rawItems.map(it => isExtraLine(it))
  const goodsIndices: number[] = []
  rawItems.forEach((_, idx) => { if (!flags[idx]) goodsIndices.push(idx) })

  const goodsGross = r2(goodsIndices.reduce((s, idx) => s + r2(rawItems[idx].total_price), 0))
  const applicableDiscount = Math.min(headerDiscount, goodsGross)
  const targetNetGoods = r2(goodsGross - applicableDiscount)

  // ปันส่วนลดท้ายบิลให้แต่ละบรรทัดสินค้า (บรรทัดสุดท้ายรับเศษเพื่อให้ผลรวมตรง targetNetGoods เป๊ะ)
  const lineNetTotal = new Map<number, number>()
  let allocatedNet = 0
  goodsIndices.forEach((idx, pos) => {
    const lineGross = r2(rawItems[idx].total_price)
    const net = (pos === goodsIndices.length - 1 || goodsGross <= 0)
      ? r2(targetNetGoods - allocatedNet)
      : r2(lineGross - r2(applicableDiscount * lineGross / goodsGross))
    allocatedNet = r2(allocatedNet + net)
    lineNetTotal.set(idx, Math.max(0, net))
  })

  // จำนวนที่เคยออกใบลดหนี้ไปแล้วต่อบรรทัด (ไม่รวมใบที่ยกเลิก)
  const creditedRows = db.prepare(`
    SELECT cni.invoice_item_id, COALESCE(SUM(cni.quantity), 0) AS qty
    FROM credit_note_items cni
    JOIN credit_notes cn ON cn.id = cni.credit_note_id AND cn.tenant_id = cni.tenant_id
    WHERE cn.invoice_id = ? AND cni.tenant_id = ? AND cn.status != 'CANCELLED'
    GROUP BY cni.invoice_item_id
  `).all(invoice.id, tenantId) as { invoice_item_id: string; qty: number }[]
  const creditedMap = new Map(creditedRows.map(r => [r.invoice_item_id, Number(r.qty) || 0]))

  return rawItems.map((it, idx) => {
    if (flags[idx]) {
      return {
        ...it,
        creditable_unit_price: 0,
        creditable_qty: 0,
        creditable_line_total: 0,
      }
    }
    const soldQty = Number(it.quantity) || 0
    const alreadyQty = creditedMap.get(it.id) || 0
    const remQty = Math.max(0, roundQty(soldQty - alreadyQty))
    const netTotal = lineNetTotal.get(idx) ?? 0
    const unitPrice = soldQty > 0 ? r2(netTotal / soldQty) : 0
    return {
      ...it,
      creditable_unit_price: unitPrice,
      creditable_qty: remQty,
      creditable_line_total: netTotal,
    }
  })
}

/**
 * ฐานภาษีเดิมของใบแจ้งหนี้ (ไม่รวม VAT) ตามที่ออกใบกำกับ
 * = total_amount - tax_amount (สอดคล้องกับ calcVat ทั้งโหมดรวมและแยก VAT หลังหักส่วนลดท้ายบิลแล้ว)
 */
function invoiceIssuedBaseExVat(inv: any): number {
  if (!inv) return 0
  const total = Number(inv.total_amount || 0)
  const tax = Number(inv.tax_amount || 0)
  return r2(total - tax)
}

/**
 * เติมข้อมูลสำหรับพิมพ์ใบลดหนี้ตามประกาศอธิบดีกรมสรรพากร ป.80/2542 (ข้อ 4g):
 * - original_invoice_date: วันที่ใบกำกับภาษีเดิม
 * - original_value: มูลค่าสินค้า/บริการเดิมตามใบกำกับ (ไม่รวม VAT) หลังหักใบลดหนี้ที่ออก (ISSUED/APPLIED) ก่อนหน้าใบนี้
 * - correct_value: มูลค่าที่ถูกต้อง = original_value - subtotal ของใบลดหนี้นี้
 * - difference: ผลต่างที่ลดหนี้ครั้งนี้ = subtotal ของใบลดหนี้นี้
 * - vat: ยอดภาษีมูลค่าเพิ่มที่ลด = tax_amount
 * - reason_code: รหัสเหตุผลตาม ม.82/10
 */
function enrichCreditNotesForPrint(tenantId: string, rows: any[]): any[] {
  if (rows.length === 0) return rows
  const invIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))]
  const invMap = new Map<string, any>()
  for (const invId of invIds) {
    const inv = db.prepare('SELECT id, invoice_date, subtotal, discount_amount, extra_charge_amount, tax_amount, total_amount FROM invoices WHERE id = ? AND tenant_id = ?')
      .get(invId, tenantId) as any
    if (inv) invMap.set(invId, inv)
  }

  // ดึงใบลดหนี้ที่ออกแล้ว (ISSUED/APPLIED) ของใบแจ้งหนี้เดียวกัน เรียงตามลำดับการสร้าง
  const issuedCnsByInv = new Map<string, any[]>()
  for (const invId of invIds) {
    const cns = db.prepare(`
      SELECT id, subtotal, created_at, cn_number
      FROM credit_notes
      WHERE tenant_id = ? AND invoice_id = ? AND status IN ('ISSUED', 'APPLIED')
      ORDER BY created_at ASC, cn_number ASC, id ASC
    `).all(tenantId, invId) as any[]
    issuedCnsByInv.set(invId, cns)
  }

  return rows.map(cn => {
    const inv = invMap.get(cn.invoice_id)
    const baseExVat = invoiceIssuedBaseExVat(inv)
    const siblings = issuedCnsByInv.get(cn.invoice_id) || []
    let earlierSubtotal = 0
    for (const sib of siblings) {
      if (sib.id === cn.id) break
      // ถ้า cn นี้ยังเป็น DRAFT หรือ CANCELLED ให้หักเฉพาะใบที่ ISSUED ก่อนเวลาสร้างของ cn นี้
      if (!['ISSUED', 'APPLIED'].includes(cn.status)) {
        if (String(sib.created_at || '') > String(cn.created_at || '')) continue
      }
      earlierSubtotal = r2(earlierSubtotal + Number(sib.subtotal || 0))
    }
    const originalValue = Math.max(0, r2(baseExVat - earlierSubtotal))
    const diff = r2(cn.subtotal || 0)
    const correctValue = r2(originalValue - diff)
    const vat = r2(cn.tax_amount || 0)
    return {
      ...cn,
      original_invoice_date: inv?.invoice_date ? thaiDateStr(inv.invoice_date) : null,
      original_value: originalValue,
      correct_value: correctValue,
      difference: diff,
      vat,
      reason_code: cn.reason_code ?? null,
    }
  })
}

/** ออกใบลดหนี้ไม่ได้ด้วยเหตุที่ผู้ใช้แก้เองได้ (ข้อความไทยส่งถึงหน้าจอตรง ๆ) */
class CreditNoteIssueError extends Error {}

// ─── Accounting: post reversing GL journal entry when a credit note is ISSUED ──
// Dr Revenue (reduce revenue) + Dr VAT-output (reduce output VAT liability)
// Cr Accounts Receivable (reduce AR) — mirrors createSalesJournal's INVOICE
// posting in shared.ts but in reverse. Idempotent: guarded by a lookup on
// (tenant_id, reference_type='CREDIT_NOTE', reference_id).
function postCreditNoteJournal(tenantId: string, cn: any, dateStr: string): string | null {
  const existing = db.prepare(
    "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE' AND reference_id = ?"
  ).get(tenantId, cn.id) as { id: string } | undefined
  if (existing) return existing.id // already posted — avoid double-posting

  const now = new Date().toISOString()
  const yr = docYear(dateStr)
  const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5, dateStr)

  const arMeta = ACC_META[ACC.AR]!
  const revMeta = ACC_META[ACC.REVENUE_PRODUCT]!
  const vatMeta = ACC_META[ACC.OUTPUT_VAT]!

  const arId = getOrCreateAccount(tenantId, ACC.AR, arMeta.name, arMeta.type, arMeta.category, arMeta.normalBalance)
  const revId = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, revMeta.name, revMeta.type, revMeta.category, revMeta.normalBalance)
  const vatId = getOrCreateAccount(tenantId, ACC.OUTPUT_VAT, vatMeta.name, vatMeta.type, vatMeta.category, vatMeta.normalBalance)

  const subtotal = r2(cn.subtotal || 0)
  const taxAmount = r2(cn.tax_amount || 0)
  const totalAmount = r2(cn.total_amount || 0)
  const entryId = generateId()
  const description = `ลดหนี้ CN ${cn.cn_number}`

  db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
    VALUES (?, ?, ?, ?, 'CREDIT_NOTE', ?, ?, NULL, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
    .run(entryId, tenantId, jvNumber, dateStr, cn.id, cn.cn_number || null, description, totalAmount, totalAmount, now, now)

  let lineNum = 1
  // Dr Revenue — reduces previously recognized revenue
  // แบ่ง 4101/4201 ตามสัดส่วนเดียวกับตอนลงใบแจ้งหนี้ (createSalesJournal) ไม่งั้นรายได้ค่าบริการค้างสูงเกิน
  const serviceRevenue = cn.invoice_id ? r2(subtotal * invoiceServiceShare(tenantId, cn.invoice_id)) : 0
  if (subtotal - serviceRevenue !== 0 || serviceRevenue === 0) {
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(generateId(), tenantId, entryId, revId, lineNum++, description, r2(subtotal - serviceRevenue))
  }
  if (serviceRevenue !== 0) {
    const svcMeta = ACC_META[ACC.REVENUE_SERVICE]!
    const svcId = getOrCreateAccount(tenantId, ACC.REVENUE_SERVICE, svcMeta.name, svcMeta.type, svcMeta.category, svcMeta.normalBalance)
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(generateId(), tenantId, entryId, svcId, lineNum++, `${description} (ค่าบริการ)`, serviceRevenue)
  }
  // Dr Output VAT — reduces VAT liability owed on the original sale
  if (taxAmount > 0) {
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(generateId(), tenantId, entryId, vatId, lineNum++, `ภาษีขาย - ${description}`, taxAmount)
  }
  // Cr Accounts Receivable — reduces amount owed by customer
  db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
    .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)

  return entryId
}

/** บันทึกแถวภาษีขายติดลบใน vat_entries ตอนออกใบลดหนี้ (เฉพาะกิจการจด VAT และมียอดภาษี > 0) */
function postCreditNoteVatEntry(tenantId: string, cn: any, dateStr: string, journalEntryId: string | null, now: string) {
  const taxAmount = r2(cn.tax_amount || 0)
  if (!(taxAmount > 0) || !isVatRegistered(tenantId)) return
  const existing = db.prepare(
    "SELECT id FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE' AND document_id = ?"
  ).get(tenantId, cn.id)
  if (existing) return

  const customer = cn.customer_id
    ? (db.prepare('SELECT name, tax_id FROM customers WHERE id = ? AND tenant_id = ?').get(cn.customer_id, tenantId) as any)
    : null

  db.prepare(`
    INSERT INTO vat_entries (
      id, tenant_id, document_type, document_id, document_number, document_date,
      party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
      is_input_vat, is_output_vat, journal_entry_id, created_at
    ) VALUES (?, ?, 'CREDIT_NOTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).run(
    generateId(), tenantId, cn.id, cn.cn_number, dateStr,
    customer?.name || 'ลูกค้า', customer?.tax_id || null,
    -r2(cn.subtotal || 0), Number(cn.tax_rate) || 7, -taxAmount, -r2(cn.total_amount || 0),
    journalEntryId, now
  )
}

/**
 * ยกเลิกภาษีขายของใบลดหนี้เมื่อใบลดหนี้ถูกยกเลิก (ข้อ 4e):
 * - ถ้างวดภาษีของ credit_date ยังไม่ถูกยื่น/ปิด (OPEN หรือยังไม่มีงวด): ลบแถว vat_entries และ tax_transactions ออก
 * - ถ้างวดภาษีถูกยื่น/ปิดแล้ว (status != 'OPEN'): คงแถวเดิมไว้ และเพิ่มแถวกลับรายการเป็นบวก (CREDIT_NOTE_CANCEL) ลงวันที่วันนี้
 */
function reverseCreditNoteVatOnCancel(tenantId: string, cn: any, now: string) {
  if (!isVatRegistered(tenantId)) return
  const creditDateYmd = thaiDateStr(cn.credit_date || cn.created_at)
  const [year, month] = creditDateYmd.split('-').map(Number)
  const period = (year && month)
    ? (db.prepare('SELECT id, status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?').get(tenantId, year, month) as { id: string; status: string } | undefined)
    : undefined
  const isPeriodLocked = !!period && period.status !== 'OPEN'
  const today = thaiDateStr()

  // 1. vat_entries
  const origVat = db.prepare(
    "SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE' AND document_id = ?"
  ).get(tenantId, cn.id) as any
  if (origVat) {
    if (!isPeriodLocked) {
      db.prepare("DELETE FROM vat_entries WHERE id = ? AND tenant_id = ?").run(origVat.id, tenantId)
    } else {
      const alreadyRev = db.prepare(
        "SELECT 1 FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE_CANCEL' AND document_id = ?"
      ).get(tenantId, cn.id)
      if (!alreadyRev) {
        db.prepare(`
          INSERT INTO vat_entries (
            id, tenant_id, document_type, document_id, document_number, document_date,
            party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
            is_input_vat, is_output_vat, created_at
          ) VALUES (?, ?, 'CREDIT_NOTE_CANCEL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
        `).run(
          generateId(), tenantId, cn.id, cn.cn_number, today,
          origVat.party_name, origVat.party_tax_id,
          Math.abs(r2(origVat.base_amount)), origVat.vat_rate, Math.abs(r2(origVat.vat_amount)), Math.abs(r2(origVat.total_amount)),
          now
        )
      }
    }
  }

  // 2. tax_transactions (กรณีเคยรัน sync ไปแล้วก่อนยกเลิก)
  const origTx = db.prepare(`
    SELECT t.*, p.status AS period_status
    FROM tax_transactions t
    LEFT JOIN tax_periods p ON p.id = t.period_id AND p.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND t.source_type = 'CREDIT_NOTE' AND t.source_id = ?
  `).get(tenantId, cn.id) as any
  if (origTx) {
    const txLocked = (origTx.period_status && origTx.period_status !== 'OPEN') || isPeriodLocked
    if (!txLocked) {
      db.prepare('DELETE FROM tax_transactions WHERE id = ? AND tenant_id = ?').run(origTx.id, tenantId)
    } else {
      const alreadyTxRev = db.prepare(
        "SELECT 1 FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE_CANCEL' AND source_id = ?"
      ).get(tenantId, cn.id)
      if (!alreadyTxRev) {
        const [ty, tm] = today.split('-').map(Number)
        let todayPeriod = db.prepare('SELECT id FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?').get(tenantId, ty, tm) as { id: string } | undefined
        if (!todayPeriod) {
          const pid = generateId()
          const ym = `${ty}-${String(tm).padStart(2, '0')}`
          const lastDay = new Date(ty, tm, 0).getDate()
          const nextM = new Date(ty, tm, 15)
          const vatDue = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-15`
          const whtDue = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-07`
          db.prepare(`
            INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, vat_due_date, wht_due_date, status)
            VALUES (?, ?, ?, ?, 'MONTHLY', ?, ?, ?, ?, 'OPEN')
          `).run(pid, tenantId, ty, tm, `${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`, vatDue, whtDue)
          todayPeriod = { id: pid }
        }
        db.prepare(`
          INSERT INTO tax_transactions (
            id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
            partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount, tax_rate, is_deductible
          ) VALUES (?, ?, ?, 'VAT_OUTPUT', 'CREDIT_NOTE_CANCEL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
          generateId(), tenantId, todayPeriod.id, cn.id, origTx.document_number, today,
          origTx.partner_id, origTx.partner_name, origTx.partner_tax_id,
          `ปรับเพิ่มภาษีขาย ยกเลิกใบลดหนี้ ${cn.cn_number} (งวดเดิมยื่นแล้ว)`,
          Math.abs(r2(origTx.base_amount)), Math.abs(r2(origTx.tax_amount)), Math.abs(r2(origTx.total_amount)), origTx.tax_rate
        )
      }
    }
  }
}

// ─── Stock: restore inventory when a credit note (ISSUED) has actual return
// line items ─────────────────────────────────────────────────────────────
// credit_note_items only has rows when the caller supplies `items` (product_id +
// quantity) — today's create-credit-note modal in Sales.tsx never does, it only
// posts { invoiceId, reason, creditDate } (header only, no line items), so an
// ordinary discount/price-adjustment credit note naturally has zero items and
// this restores nothing — correct, since nothing physically came back.
// `reason` is free text with no fixed vocabulary (confirmed via schema: no
// type/kind column on credit_notes or credit_note_items), so there is no
// reliable way to parse "is this a return" out of it — restocking is gated on
// concrete item data instead, the same signal deliveryOrders.ts uses to decide
// stock must move, never on the free-text reason.
// Conceptually mirrors deliveryOrders.ts's DELIVERED stock-deduction / shared.ts's
// restoreStockForSO, but resolves the stock row via invoice_items.stock_item_id
// (not product_id — verified vestigial/always-NULL throughout this schema's real
// sales data) and the return unit via sales_order_items.unit (credit_note_items has
// no unit column), then converts to base_unit via convertQuantityBidirectional and
// records stock_movements exactly like those two. Idempotent: guarded by checking
// for a movement already tagged with this credit note's reference (re-issuing / a
// retried request restores nothing twice).
// ล้มได้ (เช่น ไม่มีการแปลงหน่วย) → ผู้เรียกต้องห่อใน transaction เดียวกับการเปลี่ยนสถานะ ISSUED + ลงบัญชี
// ให้ทั้งใบล้มพร้อมกัน — เดิมกลืน error แล้วออกใบลดหนี้ได้ทั้งที่ของไม่ได้กลับเข้าคลัง (ลูกค้าได้เงินคืน สต็อกหาย)
function restoreCreditNoteStock(tenantId: string, cn: any, userId: string, now: string, creditDateStr: string) {
  const items = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ? AND tenant_id = ?').all(cn.id, tenantId) as any[]
  if (items.length === 0) return // nothing returned — pure price/billing adjustment, stock must not move

  const reference = `CN: ${cn.cn_number}`
  const already = db.prepare('SELECT 1 FROM stock_movements WHERE tenant_id = ? AND reference = ? LIMIT 1').get(tenantId, reference)
  if (already) return // already restored once — never double count on re-issue/retry

  // Valued at the cost the goods were ISSUED at (sales_order_items.issued_unit_cost,
  // frozen at the moment shared.ts's deductStockForSO cut the stock) — not at
  // stock_items.unit_cost today, which may have moved since the original sale.
  let totalReturnCost = 0

  // Wrapped in a transaction, same as shared.ts's restoreStockForSO — all lines of this
  // credit note restore atomically or not at all (a mid-loop unit-conversion throw must
  // not leave some stock rows already bumped while others aren't).
  const restore = db.transaction(() => {
    for (const item of items) {
      if (!(item.quantity > 0)) continue

      // credit_note_items.product_id doesn't reliably resolve a stock row in this
      // schema — product_id is vestigial throughout the real sales pipeline (verified:
      // invoice_items.product_id and sales_order_items.product_id are NULL on every real
      // row; stock_items.product_id is NULL on all 492 rows too). The link that's actually
      // populated is stock_item_id, so walk back through the invoice line this credit note
      // item was issued against to find the exact stock item — and sales_order_items.unit
      // for the unit that sale was recorded in, since credit_note_items has no unit column.
      const invItem = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND tenant_id = ?').get(item.invoice_item_id, tenantId) as any
      let stockItem: any = null
      if (invItem?.stock_item_id) {
        stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(invItem.stock_item_id, tenantId)
      }
      if (!stockItem && item.product_id) {
        // Fallback for legacy/edge-case rows that do carry a real product_id link.
        stockItem = db.prepare('SELECT * FROM stock_items WHERE product_id = ? AND tenant_id = ?').get(item.product_id, tenantId)
      }
      if (!stockItem || isServiceItem(stockItem)) continue   // ค่าขนส่ง/ค่าแพ็ค ไม่มีของรับคืนเข้าคลัง

      let cnUnit = ''
      let issuedUnitCost = 0
      if (invItem?.sales_order_item_id) {
        const soItem = db.prepare('SELECT unit, issued_unit_cost FROM sales_order_items WHERE id = ?').get(invItem.sales_order_item_id) as any
        cnUnit = soItem?.unit || ''
        issuedUnitCost = Number(soItem?.issued_unit_cost || 0)
      }
      // stock_items.quantity is stored in base_unit, not the legacy `unit` column —
      // fall back to `unit` only when base_unit is empty (old rows), same as
      // deliveryOrders.ts / restoreStockForSO.
      const stockUnit = stockItem.base_unit || stockItem.unit || ''
      let addQty = Number(item.quantity)
      let movementNotes = `Returned by customer (CN ${cn.cn_number})`

      // คืนด้วยตัวคูณเดิมตอนตัดสต็อกจริง (movement OUT ของบรรทัดนี้ ทั้งตัดตอนยืนยัน SO และตอนส่งของผ่าน DO)
      // — แก้ตัวคูณชื่อเรียกแทน/กฎแปลงหน่วยทีหลังแล้วไม่เพี้ยน
      const issuedPer = invItem?.sales_order_item_id && cnUnit && stockUnit && normalizeUnit(cnUnit) !== normalizeUnit(stockUnit)
        ? issuedBasePerUnit(tenantId, invItem.sales_order_item_id) : null
      if (issuedPer !== null) {
        addQty = Number(item.quantity) * issuedPer
        movementNotes = `Returned by customer (as issued: ${item.quantity} ${cnUnit} → ${addQty.toFixed(4)} ${stockUnit})`
      } else if (cnUnit && stockUnit && normalizeUnit(cnUnit) !== normalizeUnit(stockUnit)) {
        const converted = convertQuantityBidirectional(addQty, cnUnit, stockUnit, tenantId, stockItem.id, invItem?.product_name)
        if (!converted) {
          throw new CreditNoteIssueError(`ออกใบลดหนี้ไม่ได้: ไม่พบการแปลงหน่วย ${cnUnit} → ${stockUnit} ของสินค้า "${stockItem.name}" จึงคืนสต็อกไม่ได้ — ไปตั้งที่ Settings > การแปลงหน่วย แล้วออกใบลดหนี้อีกครั้ง`)
        }
        addQty = converted.converted
        movementNotes = `Returned by customer (converted: ${item.quantity} ${cnUnit} → ${converted.converted.toFixed(4)} ${stockUnit}, factor: ${converted.factor})`
      }

      const gained = roundQty(addQty)
      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(gained, now, stockItem.id, tenantId)

      // type 'RETURN' matches shared.ts's restoreStockForSO — the established
      // convention in this codebase for "stock coming back because a sale is being
      // undone", as opposed to a fresh 'IN' (new stock received).
      // ผูกบรรทัด SO + จำนวนในหน่วยของบรรทัด → ตัวคูณรายบรรทัด (issuedBasePerUnit) หักส่วนที่คืนแล้วได้ตรงสัดส่วน
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, source_line_id, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), tenantId, stockItem.id, gained, cnUnit || null, Number(item.quantity), invItem?.sales_order_item_id || null,
        reference, movementNotes, now, userId)

      // ไม่มี issued_unit_cost (เอกสารเก่า/ไม่ได้ผูก SO) = ไม่รู้ต้นทุนจริง ข้ามไป
      // แทนการเดา — ไม่งั้นได้ตัวเลขที่ผู้ตรวจสอบย้อนกลับไปเอกสารต้นทางไม่ได้
      totalReturnCost += gained * issuedUnitCost
    }
  })
  restore()

  // รับคืนสินค้าเข้าสต็อก → กลับรายการต้นทุนขายด้วย Dr สต็อก / Cr ต้นทุนขาย เดียวกับที่
  // deductStockForSO ลงไว้ตอนขาย (shared.ts, ACC.COGS_PRODUCT / ACC.RAW_MATERIAL) มูลค่าตาม
  // ต้นทุน ณ ตอนขายจริง (issued_unit_cost) ไม่ใช่ unit_cost ปัจจุบันของสต็อก
  if (totalReturnCost > 0.005) {
    postJournal({
      tenantId,
      date: creditDateStr,
      referenceType: 'CREDIT_NOTE_COGS',
      referenceId: cn.id,
      description: `รับคืนสินค้าเข้าสต็อก - CN ${cn.cn_number}`,
      lines: [
        { code: ACC.RAW_MATERIAL, description: `รับคืนสินค้าเข้าสต็อก - CN ${cn.cn_number}`, debit: totalReturnCost },
        { code: ACC.COGS_PRODUCT, description: `กลับรายการต้นทุนขาย - CN ${cn.cn_number}`, credit: totalReturnCost },
      ],
      createdBy: userId,
      businessUnit: 'WHOLESALE',
      sourceNumber: cn.cn_number,
    })
  }
}

// ─── Invoice balance: หักยอดค้างเฉพาะตอน ISSUED · คืนเมื่อยกเลิกใบที่หักไปแล้ว ─────
// credit_notes.balance_applied = ยอดที่หักจาก invoices.balance_amount ไปแล้วจริง (หลัง clamp ที่ 0)
// NULL = ใบเก่าก่อนมีคอลัมน์ — โค้ดเดิมหักตั้งแต่ตอนสร้าง (แม้ยัง DRAFT) จึงถือว่าหักไปแล้วเต็ม total_amount
const appliedOf = (cn: any) => Number(cn.balance_applied ?? cn.total_amount ?? 0)

// ─── ยอดลดหนี้รวม ต้องไม่เกินมูลค่าใบแจ้งหนี้เอง (ป.รัษฎากร ม.82/10 / ม.86/10) ──────────────
// ใบลดหนี้ลดมูลค่าใบแจ้งหนี้ ไม่ใช่ยอดค้างชำระ — ลูกค้าจ่ายครบแล้วก็ยังออกได้ (กลายเป็นเงินคืน)
// แต่ผลรวมใบลดหนี้ที่ไม่ถูกยกเลิกทั้งหมดของใบแจ้งหนี้ใบเดียวกัน (รวม DRAFT เพราะจะถูกออกจริง)
// ต้องไม่เกิน invoices.total_amount ใช้ helper เดียวกันทั้งตอนสร้าง (POST /) และตอน DRAFT→ISSUED
export function creditNoteCreditableRemaining(tenantId: string, invoiceId: string, excludeCnId?: string): number {
  const inv = db.prepare('SELECT total_amount FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
  const invoiceTotal = Number(inv?.total_amount || 0)
  const row = db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as sum FROM credit_notes
     WHERE invoice_id = ? AND tenant_id = ? AND status != 'CANCELLED'` + (excludeCnId ? ' AND id != ?' : '')
  ).get(...(excludeCnId ? [invoiceId, tenantId, excludeCnId] : [invoiceId, tenantId])) as any
  return Math.round((invoiceTotal - Number(row?.sum || 0)) * 100) / 100
}

function applyCreditNoteBalance(tenantId: string, cn: any, now: string): number {
  if (appliedOf(cn) > 0) return 0 // หักไปแล้ว (รวมใบเก่า NULL)
  const inv = db.prepare('SELECT balance_amount, paid_amount, status, payment_status, sales_order_id FROM invoices WHERE id = ? AND tenant_id = ?').get(cn.invoice_id, tenantId) as any
  if (!inv) return 0
  const before = Number(inv.balance_amount || 0)
  const total = Number(cn.total_amount || 0)
  const after = Math.max(0, Math.round((before - total) * 100) / 100)
  const nextPayStatus = after <= 0 ? 'PAID' : (inv.payment_status || 'UNPAID')
  const nextInvStatus = after <= 0 ? 'PAID' : inv.status
  db.prepare('UPDATE invoices SET balance_amount = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .run(after, nextPayStatus, nextInvStatus, now, cn.invoice_id, tenantId)
  if (inv.sales_order_id && after <= 0) {
    db.prepare('UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run('PAID', now, inv.sales_order_id, tenantId)
  }
  db.prepare('UPDATE credit_notes SET balance_applied = ? WHERE id = ? AND tenant_id = ?')
    .run(Math.round((before - after) * 100) / 100, cn.id, tenantId)
  const refundDue = Math.max(0, Math.round((total - before) * 100) / 100)
  if (refundDue > 0) {
    registerCredit(tenantId, {
      sourceType: 'CREDIT_NOTE',
      sourceId: cn.id,
      sourceNumber: cn.cn_number,
      customerId: cn.customer_id,
      amount: refundDue,
    })
  }
  return refundDue
}

function restoreCreditNoteBalance(tenantId: string, cn: any, now: string) {
  const applied = appliedOf(cn)
  if (applied > 0 && cn.invoice_id) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(cn.invoice_id, tenantId) as any
    if (inv) {
      // คืนไม่เกินยอดรวมใบแจ้งหนี้ — แบบเดียวกับ voidReceipt
      const newBalance = Math.min(Number(inv.total_amount || 0), r2(Number(inv.balance_amount || 0) + applied))
      const total = Number(inv.total_amount || 0)
      const paid = Number(inv.paid_amount || 0)
      const paymentStatus = newBalance <= 0 ? 'PAID' : (newBalance >= total - 0.005 && paid <= 0) ? 'UNPAID' : 'PARTIAL'
      const newStatus = inv.status === 'CANCELLED'
        ? 'CANCELLED'
        : newBalance <= 0
        ? 'PAID'
        : paymentStatus === 'UNPAID'
        ? (inv.status === 'DRAFT' || inv.status === 'OVERDUE' ? inv.status : 'ISSUED')
        : 'PARTIAL'
      db.prepare('UPDATE invoices SET balance_amount = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newBalance, paymentStatus, newStatus, now, cn.invoice_id, tenantId)
      if (inv.sales_order_id) {
        db.prepare('UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(paymentStatus, now, inv.sales_order_id, tenantId)
      }
    }
  }
  db.prepare('UPDATE credit_notes SET balance_applied = 0 WHERE id = ? AND tenant_id = ?').run(cn.id, tenantId)
}

// ─── สิทธิ์ใบลดหนี้: ADMIN/MANAGER (+ MASTER/OWNER ที่อยู่เหนือกว่า) เท่านั้น — เจ้าของสั่ง 2026-10-22 ───
// ใบลดหนี้ = ลดรายได้/คืนเงินลูกค้า เดิมใครล็อกอินได้ก็สร้าง/ออก/ยกเลิกได้
const CREDIT_NOTE_ROLES = ['ADMIN', 'MANAGER', 'MASTER', 'OWNER']
const canManageCreditNotes = (role: string) => CREDIT_NOTE_ROLES.includes(role)
const CN_FORBIDDEN = { success: false, message: 'ไม่มีสิทธิ์จัดการใบลดหนี้ — ต้องเป็น ADMIN/MANAGER' }

// ─── ยกเลิกใบลดหนี้ ─────────────────────────────────────────────────────────────
// ใบที่ออกแล้ว (ISSUED/APPLIED): ตรวจ/ลบเครดิตลูกค้าก่อน (409 ถ้าใช้ไปแล้ว), กลับ journal ลดหนี้ + journal รับคืนต้นทุน,
// เอาของที่รับคืนออกจากสต็อก (movement OUT ผูกบรรทัด SO เดิม → ยอดสุทธิรายบรรทัด/ใบลดหนี้ใบถัดไปถูกต้อง) แล้วคืนยอดค้างใบแจ้งหนี้
// ใบ DRAFT: แค่เปลี่ยนสถานะ (+ คืนยอดของใบเก่าที่หักไว้ตั้งแต่สร้าง) — เรียกจากประตูอนุมัติ (approval.routes.ts)
export function cancelCreditNoteNow(tenantId: string, cnId: string, userId: string) {
  const cn = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(cnId, tenantId) as any
  if (!cn) throw new SalesCancelError(404, 'Credit note not found')
  if (cn.status === 'CANCELLED') throw new SalesCancelError(409, `ใบลดหนี้ ${cn.cn_number} ถูกยกเลิกไปแล้ว`)
  const now = new Date().toISOString()
  db.transaction(() => {
    if (cn.status !== 'DRAFT') {
      try {
        removeCredit(tenantId, 'CREDIT_NOTE', cn.id)
      } catch (e) {
        if (e instanceof CustomerCreditError) throw new SalesCancelError(e.status, e.message)
        throw e
      }
      reverseSalesJournalByRef(tenantId, 'CREDIT_NOTE', 'CREDIT_NOTE_CANCEL', cn.id, `กลับรายการ (ยกเลิกใบลดหนี้) - ${cn.cn_number}`)
      reverseSalesJournalByRef(tenantId, 'CREDIT_NOTE_COGS', 'CREDIT_NOTE_COGS_CANCEL', cn.id, `กลับรายการรับคืนสินค้า (ยกเลิกใบลดหนี้) - ${cn.cn_number}`)
      reverseCreditNoteVatOnCancel(tenantId, cn, now)
      const setting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
      const returns = db.prepare("SELECT * FROM stock_movements WHERE tenant_id = ? AND type = 'RETURN' AND reference = ?")
        .all(tenantId, `CN: ${cn.cn_number}`) as any[]
      for (const m of returns) {
        const si = db.prepare('SELECT name, quantity FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.stock_item_id, tenantId) as any
        if (!si) continue
        if (Number(si.quantity) < Number(m.quantity) - 1e-9 && setting?.allow_negative_stock !== 1) {
          throw new SalesCancelError(409, `ยกเลิกใบลดหนี้ไม่ได้: สต็อก "${si.name}" เหลือ ${si.quantity} น้อยกว่าที่รับคืนไว้ ${m.quantity}`)
        }
        db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(m.quantity, now, m.stock_item_id, tenantId)
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, source_line_id, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?)`).run(generateId(), tenantId, m.stock_item_id, m.quantity, m.movement_unit,
          m.movement_quantity, m.source_line_id, `CN-CANCEL: ${cn.cn_number}`, `ยกเลิกใบลดหนี้ ${cn.cn_number} - เอาของที่รับคืนออก`, now, userId)
      }
    }
    db.prepare("UPDATE credit_notes SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?").run(now, cn.id, tenantId)
    // ใบ DRAFT ใหม่ไม่เคยหักยอด (balance_applied = 0) → ไม่คืนอะไร · ใบที่ออกแล้ว/ใบเก่า (NULL) หักไปแล้ว → คืน
    restoreCreditNoteBalance(tenantId, cn, now)
  })()
  return db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(cnId, tenantId) as any
}

function gateCreditNoteCancel(req: Request, res: Response, cn: any) {
  const tenantId = req.user!.tenantId
  // ถ้าเครดิตลูกค้าถูกนำไปใช้แล้ว บล็อกตั้งแต่ก่อนสร้างคำขออนุมัติ (409)
  if (cn.status !== 'DRAFT') {
    const usedCredit = db.prepare(
      "SELECT amount, balance FROM customer_credits WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE' AND source_id = ?"
    ).get(tenantId, cn.id) as { amount: number; balance: number } | undefined
    if (usedCredit && Number(usedCredit.balance) < Number(usedCredit.amount) - 0.005) {
      return res.status(409).json({ success: false, message: 'ใช้เครดิตไปแล้ว ยกเลิกใบหักกลบหนี้ก่อน' })
    }
  }
  const { pending, gateArgs } = gateSalesCancel({
    tenantId, user: req.user! as any, kind: 'credit_note', refId: cn.id, docNumber: cn.cn_number,
    docDate: cn.credit_date || cn.created_at, amount: cn.total_amount, reason: req.body?.reason,
  })
  if (pending) return res.status(202).json(pendingCancelBody(pending, cn.cn_number))
  const creditNote = cancelCreditNoteNow(tenantId, cn.id, req.user!.userId)
  recordAutoAction(gateArgs)
  return res.json({ success: true, data: creditNote })
}

// GET all credit notes
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManageCreditNotes(req.user!.role)) return res.status(403).json(CN_FORBIDDEN)
    
    const creditNotes = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        c.tax_id as customer_tax_id, c.address as customer_address,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id AND c.tenant_id = cn.tenant_id
      LEFT JOIN invoices i ON cn.invoice_id = i.id AND i.tenant_id = cn.tenant_id
      WHERE cn.tenant_id = ?
      ORDER BY cn.created_at DESC
    `).all(tenantId) as any[]

    const enriched = enrichCreditNotesForPrint(tenantId, creditNotes)
    res.json({ success: true, data: enriched })
  } catch (error) {
    console.error('Get credit notes error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit notes' })
  }
})

// GET single credit note
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManageCreditNotes(req.user!.role)) return res.status(403).json(CN_FORBIDDEN)
    
    const creditNote = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        c.tax_id as customer_tax_id, c.address as customer_address,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id AND c.tenant_id = cn.tenant_id
      LEFT JOIN invoices i ON cn.invoice_id = i.id AND i.tenant_id = cn.tenant_id
      WHERE cn.id = ? AND cn.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' })
    }

    // product_id is nullable/unpopulated for real return rows (see migrations.ts's
    // credit_note_items rebuild note) — the item's actual product name/code lives on
    // the invoice line it was returned against (invoice_items.product_name, and
    // stock_items.sku via stock_item_id — invoice_items has no product_code column),
    // so join through invoice_items/stock_items instead of the disconnected products table.
    const items = db.prepare(`
      SELECT cni.*, ii.product_name as product_name, si.sku as product_code
      FROM credit_note_items cni
      LEFT JOIN invoice_items ii ON cni.invoice_item_id = ii.id AND ii.tenant_id = cni.tenant_id
      LEFT JOIN stock_items si ON ii.stock_item_id = si.id AND si.tenant_id = cni.tenant_id
      WHERE cni.credit_note_id = ? AND cni.tenant_id = ?
    `).all(req.params.id, tenantId)

    const [enriched] = enrichCreditNotesForPrint(tenantId, [creditNote])
    res.json({ success: true, data: { ...enriched, items } })
  } catch (error) {
    console.error('Get credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit note' })
  }
})

// POST create credit note
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManageCreditNotes(req.user!.role)) return res.status(403).json(CN_FORBIDDEN)
    const { invoiceId, reason, reasonCode, notes, creditDate, amount } = req.body
    let { items } = req.body
    
    if (!invoiceId || !reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'Invoice and reason are required' })
    }
    if (!reasonCode || typeof reasonCode !== 'string' || !LEGAL_REASON_CODES[reasonCode]) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกเหตุผลตามกฎหมาย (ม.82/10)' })
    }
    // ลูกค้า/อัตรา VAT/โหมดรวม VAT ยึดตามใบแจ้งหนี้ต้นทาง — เดิมอ่าน customerId จาก body
    // ที่หน้าเว็บไม่เคยส่งมา (bind undefined → 500) และ taxRate 0 กลายเป็น 7 เพราะ `|| 7`
    const srcInvoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?')
      .get(invoiceId, tenantId) as any
    if (!srcInvoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }
    if (srcInvoice.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว ออกใบลดหนี้ไม่ได้' })
    }
    // ใบกำกับจากบิล POS เป็นเอกสารล้วน (ไม่มี journal/ลูกหนี้ของตัวเอง) — ลดหนี้ที่นี่จะกลับรายได้ที่ไม่เคยลงผ่านใบนี้
    // คืนเงิน/คืนของของบิล POS ให้ยกเลิกที่บิล POS (ต้องยกเลิกใบกำกับก่อน)
    if (srcInvoice.pos_bill_id != null) {
      return res.status(400).json({ success: false, message: 'ใบกำกับภาษีที่ออกจากบิล POS ออกใบลดหนี้ไม่ได้ — ยกเลิกใบกำกับแล้วยกเลิก/คืนเงินที่บิล POS แทน' })
    }

    // ตรวจวันที่ใบลดหนี้ (ข้อ 4c)
    const creditDateValue = (creditDate !== undefined && creditDate !== null && creditDate !== '')
      ? String(creditDate)
      : thaiDateStr()
    const dateErr = validateCreditDate(tenantId, creditDateValue, srcInvoice.invoice_date)
    if (dateErr) {
      return res.status(400).json({ success: false, message: dateErr })
    }

    if (items != null && !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'ข้อมูลรายการสินค้าที่คืนไม่ถูกต้อง' })
    }
    const hasItems = Array.isArray(items) && items.length > 0
    // โหมด "ลดราคา" ไม่มีรายการ → ต้องระบุยอด (ฐานเดียวกับราคาบนใบแจ้งหนี้) ไม่งั้นได้ใบลดหนี้ ฿0
    const discountBase = Math.round((Number(amount) || 0) * 100) / 100
    if (!hasItems && !(Number.isFinite(discountBase) && discountBase > 0)) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุยอดลดหนี้' })
    }

    // ─── Validate return items don't exceed what was actually sold (ข้อ 4d) ────
    let lineTotal = discountBase
    if (hasItems) {
      const qtyByLine = new Map<string, number>()
      for (const item of items) {
        const q = Number(item?.quantity)
        if (!item?.invoiceItemId || !Number.isFinite(q) || q <= 0) {
          return res.status(400).json({ success: false, message: 'ข้อมูลรายการสินค้าที่คืนไม่ถูกต้อง' })
        }
        qtyByLine.set(item.invoiceItemId, (qtyByLine.get(item.invoiceItemId) || 0) + q)
      }

      const rawInvItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? AND tenant_id = ?')
        .all(invoiceId, tenantId) as any[]
      const creditableItems = computeInvoiceItemsCreditable(tenantId, srcInvoice, rawInvItems)
      const creditableById = new Map(creditableItems.map(it => [it.id, it]))

      for (const [invItemId, requested] of qtyByLine.entries()) {
        const cred = creditableById.get(invItemId)
        if (!cred) {
          return res.status(400).json({ success: false, message: 'ไม่พบรายการสินค้านี้ในใบแจ้งหนี้ที่เลือก' })
        }
        const remainingQty = Number(cred.creditable_qty)
        if (requested > remainingQty + 1e-9) {
          return res.status(400).json({
            success: false,
            message: `จำนวนที่คืน (${requested}) เกินจำนวนที่ขายจริง — คืนได้อีกไม่เกิน ${remainingQty} หน่วย สำหรับ "${cred.product_name || 'สินค้า'}"`,
          })
        }
      }

      const resolved: any[] = []
      let sumLines = 0
      // คำนวณยอดแต่ละบรรทัด: ถ้าคืนครบทั้งบรรทัด (และยังไม่เคยคืนมาก่อน) ใช้ creditable_line_total ตรง ๆ เพื่อไม่ให้เศษปัดราคาต่อหน่วยทำให้ยอดรวมคลาดเคลื่อน
      const remainingToReturnByLine = new Map(qtyByLine)
      for (const item of items) {
        const cred = creditableById.get(item.invoiceItemId)!
        const q = Number(item.quantity)
        const soldQty = Number(cred.quantity) || 0
        const unitPrice = Number(cred.creditable_unit_price) || 0
        const totalRequestedForLine = qtyByLine.get(item.invoiceItemId) || 0
        const leftForLine = remainingToReturnByLine.get(item.invoiceItemId) || 0
        let itemTotal: number
        if (Math.abs(totalRequestedForLine - soldQty) < 1e-9 && Math.abs(q - leftForLine) < 1e-9 && Math.abs(totalRequestedForLine - q) < 1e-9) {
          itemTotal = r2(cred.creditable_line_total)
        } else {
          itemTotal = r2(q * unitPrice)
        }
        remainingToReturnByLine.set(item.invoiceItemId, roundQty(leftForLine - q))
        resolved.push({
          ...item,
          quantity: q,
          unitPrice,
          totalPrice: itemTotal,
        })
        sumLines = r2(sumLines + itemTotal)
      }
      items = resolved
      lineTotal = sumLines
    }

    // Calculate totals
    const tax = Number(srcInvoice.tax_rate ?? 7)
    const { subtotal, taxAmount, totalAmount } = calcVat(lineTotal, { rate: tax, inclusive: srcInvoice.vat_inclusive === 1 })
    const customerId = srcInvoice.customer_id
    if (!(totalAmount > 0)) {
      return res.status(400).json({ success: false, message: 'ยอดลดหนี้ต้องมากกว่า 0' })
    }

    // ยอดลดหนี้รวม (รวมใบนี้) ต้องไม่เกินมูลค่าใบแจ้งหนี้ — เช็คก่อนกันเลขเอกสาร (formatDocumentNumber
    // ต้องมาหลังการตรวจทุกอย่าง) ไม่ให้คำขอที่ถูกปฏิเสธเผาเลขทิ้ง ครอบคลุมทั้งโหมดลดราคาและคืนสินค้า
    // (โหมดคืนสินค้ากันด้วยจำนวนอยู่แล้ว อันนี้กันซ้ำด้วยมูลค่า)
    const remaining = creditNoteCreditableRemaining(tenantId, invoiceId)
    if (totalAmount > remaining + 0.005) {
      return res.status(400).json({ success: false, message: `ยอดลดหนี้รวมเกินมูลค่าใบแจ้งหนี้ — ลดได้อีกไม่เกิน ฿${remaining.toFixed(2)}` })
    }

    // คำเตือนเมื่อใบแจ้งหนี้เดิมออกมาแล้วเกิน 90 วัน (ไม่บล็อกการสร้าง — ข้อ 4b)
    const warnings: string[] = []
    if (srcInvoice.invoice_date) {
      const invYmd = thaiDateStr(srcInvoice.invoice_date)
      const ageDays = diffDaysYmd(invYmd, creditDateValue)
      if (ageDays > 90) {
        warnings.push(`ใบแจ้งหนี้เดิมออกมาแล้ว ${ageDays} วัน — การคืนควรอยู่ในเวลาอันสมควร`)
      }
    }

    const id = generateId()
    const now = new Date().toISOString()
    let cnNumber = ''

    const transaction = db.transaction(() => {
      cnNumber = formatDocumentNumber('CN', tenantId, 'CREDIT_NOTE', docYear(creditDateValue), 5, creditDateValue)
      db.prepare(`
        INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, reason_code,
          subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at, balance_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 0)
      `).run(id, tenantId, cnNumber, invoiceId, customerId, creditDateValue, reason, reasonCode,
        subtotal, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.totalPrice !== undefined ? item.totalPrice : r2(item.quantity * item.unitPrice)
          insertItem.run(generateId(), tenantId, id, item.invoiceItemId, item.productId ?? null,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }
      // ยอดค้างของใบแจ้งหนี้ยังไม่ถูกหักตอน DRAFT — หักตอน ISSUED (applyCreditNoteBalance)
    })

    transaction()

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    const creditNoteItems = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ? AND tenant_id = ?').all(id, tenantId)
    const [enriched] = enrichCreditNotesForPrint(tenantId, [creditNote])

    res.status(201).json({
      success: true,
      data: { ...enriched, items: creditNoteItems },
      warnings,
    })
  } catch (error) {
    console.error('Create credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to create credit note' })
  }
})

// PUT update credit note status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManageCreditNotes(req.user!.role)) return res.status(403).json(CN_FORBIDDEN)
    const { status } = req.body
    const validStatuses = ['DRAFT', 'ISSUED', 'APPLIED', 'CANCELLED']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const cn = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cn) {
      return res.status(404).json({ success: false, message: 'Credit note not found' })
    }

    // ยกเลิกใบลดหนี้ (ทั้ง DRAFT ที่ได้เลขแล้ว และใบที่ออกแล้ว) ต้องขออนุมัติ — อนุมัติแล้วระบบเรียก cancelCreditNoteNow
    if (status === 'CANCELLED') {
      if (cn.status === 'CANCELLED') return res.status(409).json({ success: false, message: `ใบลดหนี้ ${cn.cn_number} ถูกยกเลิกไปแล้ว` })
      return gateCreditNoteCancel(req, res, cn)
    }

    // ออกใบได้จาก DRAFT เท่านั้น — กันออกซ้ำ (ลงบัญชี/คืนสต็อก/หักยอดค้างซ้ำ)
    if (status === 'ISSUED' && cn.status !== 'DRAFT') {
      return res.status(409).json({ success: false, message: `ออกใบลดหนี้ได้เฉพาะสถานะ DRAFT (ตอนนี้: ${cn.status})` })
    }
    // ทางเดียวที่เหลือคือ DRAFT → ISSUED (ยกเลิกแยกไปทางขออนุมัติด้านบน) — ห้ามถอยสถานะ/ข้ามไป APPLIED
    if (cn.status !== 'DRAFT' || status !== 'ISSUED') {
      return res.status(409).json({ success: false, message: `เปลี่ยนสถานะใบลดหนี้จาก ${cn.status} เป็น ${status} ไม่ได้` })
    }
    const srcInv = db.prepare('SELECT status, invoice_date FROM invoices WHERE id = ? AND tenant_id = ?').get(cn.invoice_id, tenantId) as any
    if (!srcInv || srcInv.status === 'CANCELLED') {
      return res.status(409).json({ success: false, message: 'ใบแจ้งหนี้ต้นทางถูกยกเลิกแล้ว ออกใบลดหนี้ไม่ได้' })
    }

    // ตรวจวันที่ใบลดหนี้ซ้ำตอนกดออก ISSUED (ข้อ 4c — งวดภาษีอาจถูกปิดไประหว่างที่เป็น DRAFT)
    const creditDateYmd = thaiDateStr(cn.credit_date || cn.created_at)
    const dateErr = validateCreditDate(tenantId, creditDateYmd, srcInv.invoice_date)
    if (dateErr) {
      return res.status(400).json({ success: false, message: dateErr })
    }

    // อีกใบ DRAFT บนใบแจ้งหนี้เดียวกันอาจถูกออก (ISSUED) แซงไปก่อนระหว่างที่ใบนี้ยังเป็น DRAFT —
    // เช็คซ้ำด้วย helper เดียวกับตอนสร้าง ไม่ใช่เชื่อผลเช็คตอน POST เพียงครั้งเดียว
    if (status === 'ISSUED') {
      const remaining = creditNoteCreditableRemaining(tenantId, cn.invoice_id, cn.id)
      if (Number(cn.total_amount || 0) > remaining + 0.005) {
        return res.status(409).json({ success: false, message: `ยอดลดหนี้รวมเกินมูลค่าใบแจ้งหนี้ — ลดได้อีกไม่เกิน ฿${remaining.toFixed(2)}` })
      }
    }

    const now = new Date().toISOString()
    let refundDue = 0
    // เปลี่ยนสถานะ + ลงบัญชีลดหนี้ + ลงทะเบียนภาษีขายติดลบ + คืนสต็อก/กลับต้นทุน + หักยอดค้าง/ลงเครดิตลูกค้า ในทรานแซกชันเดียว
    db.transaction(() => {
      db.prepare('UPDATE credit_notes SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(status, now, req.params.id, tenantId)

      if (status === 'ISSUED') {
        const updated = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
        const jvId = postCreditNoteJournal(tenantId, updated, creditDateYmd)
        postCreditNoteVatEntry(tenantId, updated, creditDateYmd, jvId, now)
        restoreCreditNoteStock(tenantId, updated, req.user!.userId, now, creditDateYmd)
        refundDue = applyCreditNoteBalance(tenantId, updated, now)
      }
    })()

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    const [enriched] = enrichCreditNotesForPrint(tenantId, [creditNote])
    res.json({ success: true, data: enriched, refundDue })
  } catch (error) {
    if (error instanceof CreditNoteIssueError || error instanceof JournalError) {
      return res.status(422).json({ success: false, message: error.message })
    }
    if (error instanceof CustomerCreditError) return res.status(error.status).json({ success: false, message: error.message })
    if (error instanceof SalesCancelError) return res.status(error.status).json({ success: false, message: error.message })
    console.error('Update credit note status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update credit note status' })
  }
})

// DELETE credit note (DRAFT only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManageCreditNotes(req.user!.role)) return res.status(403).json(CN_FORBIDDEN)
    const cn = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' })
    if (cn.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบลดหนี้สถานะ DRAFT เท่านั้น' })
    // ได้เลขเอกสารไปแล้ว = ห้ามหาย → ยกเลิกแทนการลบ (cancelCreditNoteNow) และต้องขออนุมัติเหมือนการยกเลิก
    return gateCreditNoteCancel(req, res, cn)
  } catch (error) {
    if (error instanceof SalesCancelError) return res.status(error.status).json({ success: false, message: error.message })
    res.status(500).json({ success: false, message: 'Failed to delete credit note' })
  }
})

export default router
