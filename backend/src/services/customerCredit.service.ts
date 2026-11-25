import db from '../db/sqlite'
import { generateId, formatDocumentNumber, docYear, thaiDateStr } from '../utils/id'
import { ACC, ACC_META, resolveBankAccountGL, defaultBankAccountGL } from '../config/accountCodes'
import { getOrCreateAccount, postJournal, isHeaderAccountError, type JournalLineInput } from './accounting.service'
import { closedPeriodLabel } from '../routes/journal.routes'
import { isCashMethod } from './purchaseBilling.service'

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export type CreditSourceType = 'BUYBACK' | 'CREDIT_NOTE'

export class CustomerCreditError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function validateRealDateNotFuture(dateInput: unknown, label = 'วันที่'): string {
  if (dateInput === undefined || dateInput === null || dateInput === '') {
    return thaiDateStr()
  }
  const s = String(dateInput).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) {
    throw new CustomerCreditError(400, `${label}ต้องเป็นรูปแบบ YYYY-MM-DD`)
  }
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (y < 1900 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new CustomerCreditError(400, `${label}ไม่ถูกต้องตามปฏิทิน`)
  }
  const today = thaiDateStr()
  if (s > today) {
    throw new CustomerCreditError(400, `${label}ต้องไม่อยู่ในอนาคต`)
  }
  return s
}

export function assertOpenPeriod(tenantId: string, dateStr: string, actionLabel = 'ทำรายการ'): void {
  const closed = closedPeriodLabel(tenantId, dateStr)
  if (closed) {
    throw new CustomerCreditError(400, `งวด ${closed} ปิดแล้ว ${actionLabel}วันที่นี้ไม่ได้`)
  }
}

function actorLabel(actor: unknown): string {
  if (!actor) return 'system'
  if (typeof actor === 'string') return actor
  const a = actor as { email?: string; userId?: string; id?: string; name?: string }
  return a.email || a.userId || a.id || a.name || 'system'
}

export interface RegisterCreditInput {
  sourceType: CreditSourceType
  sourceId: string
  sourceNumber?: string | null
  customerId: string
  amount: number
}

export function registerCredit(tenantId: string, input: RegisterCreditInput): any | null {
  const amt = r2(input.amount)
  if (!(amt > 0)) return null
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO customer_credits (id, tenant_id, customer_id, source_type, source_id, source_number, amount, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, input.customerId, input.sourceType, input.sourceId, input.sourceNumber ?? null, amt, amt, now)
  return db.prepare('SELECT * FROM customer_credits WHERE id = ? AND tenant_id = ?').get(id, tenantId)
}

export function removeCredit(tenantId: string, sourceType: CreditSourceType, sourceId: string): void {
  const row = db.prepare(
    'SELECT * FROM customer_credits WHERE tenant_id = ? AND source_type = ? AND source_id = ?'
  ).get(tenantId, sourceType, sourceId) as any
  if (!row) return
  if (Number(row.balance) < Number(row.amount) - 0.005) {
    throw new CustomerCreditError(409, 'ใช้เครดิตไปแล้ว ยกเลิกใบหักกลบหนี้ก่อน')
  }
  db.prepare('DELETE FROM customer_credits WHERE id = ? AND tenant_id = ?').run(row.id, tenantId)
}

export interface ApplyOffsetLineInput {
  invoiceId: string
  amount: number
}

export interface ApplyOffsetInput {
  creditId: string
  date?: string
  lines: ApplyOffsetLineInput[]
  notes?: string | null
}

export function applyOffset(tenantId: string, actor: unknown, input: ApplyOffsetInput): any {
  if (!input?.creditId) {
    throw new CustomerCreditError(400, 'กรุณาเลือกเครดิตที่ต้องการใช้')
  }
  const offsetDate = validateRealDateNotFuture(input.date, 'วันที่หักกลบหนี้')
  assertOpenPeriod(tenantId, offsetDate, 'บันทึกหักกลบหนี้')

  const rawLines = Array.isArray(input.lines) ? input.lines : []
  if (rawLines.length === 0) {
    throw new CustomerCreditError(400, 'กรุณาระบุใบแจ้งหนี้ที่ต้องการหักกลบอย่างน้อย 1 รายการ')
  }

  const seenInvoices = new Set<string>()
  const lines: Array<{ invoiceId: string; amount: number }> = []
  let sum = 0
  for (const l of rawLines) {
    const invoiceId = String(l?.invoiceId || '').trim()
    const amount = r2(l?.amount)
    if (!invoiceId || !Number.isFinite(amount) || !(amount > 0)) {
      throw new CustomerCreditError(400, 'จำนวนเงินที่หักกลบในแต่ละใบแจ้งหนี้ต้องมากกว่า 0')
    }
    if (seenInvoices.has(invoiceId)) {
      throw new CustomerCreditError(400, 'ห้ามระบุใบแจ้งหนี้ซ้ำในใบหักกลบเดียวกัน')
    }
    seenInvoices.add(invoiceId)
    lines.push({ invoiceId, amount })
    sum = r2(sum + amount)
  }

  const actorStr = actorLabel(actor)
  let offsetId = ''

  const tx = db.transaction(() => {
    const credit = db.prepare('SELECT * FROM customer_credits WHERE id = ? AND tenant_id = ?')
      .get(input.creditId, tenantId) as any
    if (!credit) {
      throw new CustomerCreditError(404, 'ไม่พบเครดิตลูกค้าที่เลือก')
    }
    if (sum > Number(credit.balance) + 0.005) {
      throw new CustomerCreditError(400, `ยอดหักกลบรวม (฿${sum.toFixed(2)}) เกินเครดิตคงเหลือ (฿${Number(credit.balance).toFixed(2)})`)
    }

    const invoices = new Map<string, any>()
    for (const l of lines) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?')
        .get(l.invoiceId, tenantId) as any
      if (!inv) {
        throw new CustomerCreditError(404, 'ไม่พบใบแจ้งหนี้ในกิจการนี้')
      }
      if (inv.customer_id !== credit.customer_id) {
        throw new CustomerCreditError(400, `ใบแจ้งหนี้ ${inv.invoice_number} ไม่ใช่ของลูกค้ารายเดียวกับเครดิต`)
      }
      if (inv.status === 'CANCELLED') {
        throw new CustomerCreditError(400, `ใบแจ้งหนี้ ${inv.invoice_number} ถูกยกเลิกแล้ว หักกลบไม่ได้`)
      }
      if (inv.pos_bill_id != null) {
        throw new CustomerCreditError(400, `ใบกำกับภาษีจากบิล POS (${inv.invoice_number}) หักกลบหนี้ไม่ได้`)
      }
      if (l.amount > Number(inv.balance_amount) + 0.005) {
        throw new CustomerCreditError(400, `ยอดหักกลบ (฿${l.amount.toFixed(2)}) เกินยอดค้างของใบแจ้งหนี้ ${inv.invoice_number} (฿${Number(inv.balance_amount).toFixed(2)})`)
      }
      invoices.set(l.invoiceId, inv)
    }

    // All validations passed -> issue document number
    offsetId = generateId()
    const offsetNumber = formatDocumentNumber('OF', tenantId, 'CUSTOMER_OFFSET', docYear(offsetDate), 5, offsetDate)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO customer_offsets (id, tenant_id, offset_number, customer_id, offset_date, credit_id, kind, total_amount,
        payment_method, bank_account_id, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'APPLY', ?, NULL, NULL, 'POSTED', ?, ?, ?, ?)
    `).run(offsetId, tenantId, offsetNumber, credit.customer_id, offsetDate, credit.id, sum, input.notes || '', actorStr, now, now)

    const insertLine = db.prepare(`
      INSERT INTO customer_offset_lines (id, tenant_id, offset_id, invoice_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `)

    for (const l of lines) {
      const inv = invoices.get(l.invoiceId)!
      insertLine.run(generateId(), tenantId, offsetId, l.invoiceId, l.amount)

      const newPaid = r2((Number(inv.paid_amount) || 0) + l.amount)
      const newBalance = Math.max(0, r2((Number(inv.balance_amount) || 0) - l.amount))
      const paymentStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'
      const invoiceStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

      db.prepare(`
        UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, paymentStatus, invoiceStatus, now, inv.id, tenantId)

      if (inv.sales_order_id) {
        db.prepare('UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(paymentStatus, now, inv.sales_order_id, tenantId)
      }
    }

    const newCreditBalance = Math.max(0, r2(Number(credit.balance) - sum))
    db.prepare('UPDATE customer_credits SET balance = ? WHERE id = ? AND tenant_id = ?')
      .run(newCreditBalance, credit.id, tenantId)

    // Journal only for BUYBACK source: Dr ACC.AP / Cr ACC.AR sum; for CREDIT_NOTE source NO journal
    if (credit.source_type === 'BUYBACK') {
      postJournal({
        tenantId,
        date: offsetDate,
        referenceType: 'CUSTOMER_OFFSET',
        referenceId: offsetId,
        sourceNumber: offsetNumber,
        description: `หักกลบหนี้ ${offsetNumber} (จาก ${credit.source_number || 'รับซื้อคืน'})`,
        createdBy: actorStr,
        businessUnit: 'WHOLESALE',
        notes: input.notes || null,
        lines: [
          { code: ACC.AP, description: `ล้างเจ้าหนี้รับซื้อคืน - ${offsetNumber}`, debit: sum },
          { code: ACC.AR, description: `ตัดลูกหนี้การค้า - ${offsetNumber}`, credit: sum },
        ],
      })
    }
  })

  tx()
  return getOffsetById(tenantId, offsetId)
}

export interface RefundCreditInput {
  creditId: string
  date?: string
  amount: number
  paymentMethod?: string | null
  bankAccountId?: string | null
  notes?: string | null
}

export function refundCredit(tenantId: string, actor: unknown, input: RefundCreditInput): any {
  if (!input?.creditId) {
    throw new CustomerCreditError(400, 'กรุณาเลือกเครดิตที่ต้องการจ่ายคืน')
  }
  const offsetDate = validateRealDateNotFuture(input.date, 'วันที่จ่ายเงินคืน')
  assertOpenPeriod(tenantId, offsetDate, 'บันทึกจ่ายเงินคืน')

  const amount = r2(input.amount)
  if (!Number.isFinite(amount) || !(amount > 0)) {
    throw new CustomerCreditError(400, 'จำนวนเงินที่จ่ายคืนต้องมากกว่า 0')
  }

  const paymentMethod = input.paymentMethod || 'CASH'
  const bankAccountId = input.bankAccountId || null
  if (bankAccountId) {
    const bankRow = db.prepare('SELECT id FROM bank_accounts WHERE id = ? AND tenant_id = ? AND is_active = 1')
      .get(bankAccountId, tenantId)
    if (!bankRow) {
      throw new CustomerCreditError(400, 'ไม่พบบัญชีธนาคารที่เลือกในกิจการนี้')
    }
  }

  const actorStr = actorLabel(actor)
  let offsetId = ''

  const tx = db.transaction(() => {
    const credit = db.prepare('SELECT * FROM customer_credits WHERE id = ? AND tenant_id = ?')
      .get(input.creditId, tenantId) as any
    if (!credit) {
      throw new CustomerCreditError(404, 'ไม่พบเครดิตลูกค้าที่เลือก')
    }
    if (amount > Number(credit.balance) + 0.005) {
      throw new CustomerCreditError(400, `ยอดจ่ายคืน (฿${amount.toFixed(2)}) เกินเครดิตคงเหลือ (฿${Number(credit.balance).toFixed(2)})`)
    }

    const drCode = credit.source_type === 'BUYBACK' ? ACC.AP : ACC.AR
    const drAccId = getOrCreateAccount(tenantId, drCode, ACC_META[drCode]!.name, ACC_META[drCode]!.type, ACC_META[drCode]!.category, ACC_META[drCode]!.normalBalance)
    const cashCode = isCashMethod(paymentMethod) ? ACC.CASH : ACC.BANK
    const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId) || (cashCode === ACC.BANK ? defaultBankAccountGL(tenantId) : null)
    const cashAccId = linkedAccountId || getOrCreateAccount(
      tenantId, cashCode, ACC_META[cashCode]!.name, ACC_META[cashCode]!.type, ACC_META[cashCode]!.category, ACC_META[cashCode]!.normalBalance
    )

    offsetId = generateId()
    const offsetNumber = formatDocumentNumber('OF', tenantId, 'CUSTOMER_OFFSET', docYear(offsetDate), 5, offsetDate)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO customer_offsets (id, tenant_id, offset_number, customer_id, offset_date, credit_id, kind, total_amount,
        payment_method, bank_account_id, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'REFUND', ?, ?, ?, 'POSTED', ?, ?, ?, ?)
    `).run(offsetId, tenantId, offsetNumber, credit.customer_id, offsetDate, credit.id, amount, paymentMethod, bankAccountId, input.notes || '', actorStr, now, now)

    const newCreditBalance = Math.max(0, r2(Number(credit.balance) - amount))
    db.prepare('UPDATE customer_credits SET balance = ? WHERE id = ? AND tenant_id = ?')
      .run(newCreditBalance, credit.id, tenantId)

    postJournal({
      tenantId,
      date: offsetDate,
      referenceType: 'CUSTOMER_OFFSET',
      referenceId: offsetId,
      sourceNumber: offsetNumber,
      description: `จ่ายคืนเครดิตลูกค้า ${offsetNumber} (จาก ${credit.source_number || credit.source_type})`,
      createdBy: actorStr,
      businessUnit: 'WHOLESALE',
      notes: input.notes || null,
      lines: [
        { accountId: drAccId, description: `ล้างเครดิตลูกค้า - ${offsetNumber}`, debit: amount },
        { accountId: cashAccId, description: `จ่ายเงินคืนลูกค้า - ${offsetNumber}`, credit: amount },
      ],
    })
  })

  try {
    tx()
  } catch (e) {
    if (isHeaderAccountError(e)) throw new CustomerCreditError(400, (e as Error).message)
    throw e
  }

  return getOffsetById(tenantId, offsetId)
}

export function cancelOffset(tenantId: string, actor: unknown, id: string, reason: string): any {
  const cleanReason = typeof reason === 'string' ? reason.trim() : ''
  if (!cleanReason) {
    throw new CustomerCreditError(400, 'กรุณาระบุเหตุผลในการยกเลิก')
  }
  const today = thaiDateStr()
  assertOpenPeriod(tenantId, today, 'ยกเลิกใบหักกลบหนี้')

  const actorStr = actorLabel(actor)

  const tx = db.transaction(() => {
    const offset = db.prepare('SELECT * FROM customer_offsets WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any
    if (!offset) {
      throw new CustomerCreditError(404, 'ไม่พบใบหักกลบหนี้')
    }
    if (offset.status === 'CANCELLED') {
      throw new CustomerCreditError(409, `ใบหักกลบหนี้ ${offset.offset_number} ถูกยกเลิกไปแล้ว`)
    }

    const credit = db.prepare('SELECT * FROM customer_credits WHERE id = ? AND tenant_id = ?')
      .get(offset.credit_id, tenantId) as any
    if (!credit) {
      throw new CustomerCreditError(404, 'ไม่พบเครดิตต้นทางของใบหักกลบหนี้นี้')
    }

    const lines = db.prepare('SELECT * FROM customer_offset_lines WHERE offset_id = ? AND tenant_id = ?')
      .all(offset.id, tenantId) as any[]

    // Check no invoice is CANCELLED before mutating
    const invoices = new Map<string, any>()
    for (const l of lines) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?')
        .get(l.invoice_id, tenantId) as any
      if (!inv) {
        throw new CustomerCreditError(404, 'ไม่พบใบแจ้งหนี้ที่อ้างอิงในใบหักกลบหนี้')
      }
      if (inv.status === 'CANCELLED') {
        throw new CustomerCreditError(409, `ยกเลิกใบหักกลบหนี้ไม่ได้ เนื่องจากใบแจ้งหนี้ ${inv.invoice_number} ถูกยกเลิกไปแล้ว`)
      }
      invoices.set(l.invoice_id, inv)
    }

    // Reverse journal line by line with postJournal (if original had a journal)
    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CUSTOMER_OFFSET_CANCEL' AND reference_id = ?"
    ).get(tenantId, offset.id)
    if (alreadyReversed) {
      throw new CustomerCreditError(409, `ใบหักกลบหนี้ ${offset.offset_number} ถูกกลับรายการบัญชีไปแล้ว`)
    }

    const origJe = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CUSTOMER_OFFSET' AND reference_id = ?"
    ).get(tenantId, offset.id) as any

    const expectsJournal = offset.kind === 'REFUND' || credit.source_type === 'BUYBACK'
    if (expectsJournal && !origJe) {
      throw new CustomerCreditError(500, `ไม่พบรายการบัญชีต้นทางของใบหักกลบหนี้ ${offset.offset_number}`)
    }

    if (origJe) {
      const origLines = db.prepare(
        'SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ? ORDER BY line_number ASC'
      ).all(origJe.id, tenantId) as any[]
      if (origLines.length === 0) {
        throw new CustomerCreditError(500, `รายการบัญชีของใบหักกลบหนี้ ${offset.offset_number} ไม่มีบรรทัดรายการ`)
      }
      const revLines: JournalLineInput[] = origLines.map(l => ({
        accountId: l.account_id,
        description: `กลับรายการ: ${l.description || ''}`,
        debit: r2(l.credit || 0),
        credit: r2(l.debit || 0),
      }))
      postJournal({
        tenantId,
        date: today,
        referenceType: 'CUSTOMER_OFFSET_CANCEL',
        referenceId: offset.id,
        sourceNumber: offset.offset_number,
        description: `กลับรายการ (ยกเลิกใบหักกลบหนี้) - ${offset.offset_number}`,
        createdBy: actorStr,
        businessUnit: origJe.business_unit || 'WHOLESALE',
        notes: cleanReason,
        lines: revLines,
      })
    }

    const now = new Date().toISOString()

    // Restore invoices
    for (const l of lines) {
      const inv = invoices.get(l.invoice_id)!
      const amt = r2(l.amount)
      const newPaid = Math.max(0, r2((Number(inv.paid_amount) || 0) - amt))
      const newBalance = Math.min(Number(inv.total_amount), r2((Number(inv.balance_amount) || 0) + amt))
      // Restored invoice: balance>=total (or newPaid<=0) -> UNPAID with open status convention ('ISSUED'), else PARTIAL
      const isUnpaid = newBalance >= Number(inv.total_amount) - 0.005 || newPaid <= 0.005
      const paymentStatus = isUnpaid ? 'UNPAID' : 'PARTIAL'
      const newStatus = isUnpaid ? 'ISSUED' : 'PARTIAL'

      db.prepare(`
        UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, paymentStatus, newStatus, now, inv.id, tenantId)

      if (inv.sales_order_id) {
        db.prepare('UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(paymentStatus, now, inv.sales_order_id, tenantId)
      }
    }

    // Restore credit balance
    const restoredCreditBal = Math.min(Number(credit.amount), r2(Number(credit.balance) + Number(offset.total_amount)))
    db.prepare('UPDATE customer_credits SET balance = ? WHERE id = ? AND tenant_id = ?')
      .run(restoredCreditBal, credit.id, tenantId)

    db.prepare(`
      UPDATE customer_offsets SET status = 'CANCELLED', cancelled_reason = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(cleanReason, now, offset.id, tenantId)
  })

  tx()
  return getOffsetById(tenantId, id)
}

export function getOffsetById(tenantId: string, id: string): any | null {
  const offset = db.prepare(`
    SELECT o.*,
      c.name AS customer_name, c.code AS customer_code, c.tax_id AS customer_tax_id,
      c.address AS customer_address, c.phone AS customer_phone,
      cc.source_type AS credit_source_type, cc.source_id AS credit_source_id,
      cc.source_number AS credit_source_number, cc.amount AS credit_amount, cc.balance AS credit_balance,
      cc.source_type AS source_type, cc.source_number AS source_number
    FROM customer_offsets o
    LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    LEFT JOIN customer_credits cc ON cc.id = o.credit_id AND cc.tenant_id = o.tenant_id
    WHERE o.id = ? AND o.tenant_id = ?
  `).get(id, tenantId) as any
  if (!offset) return null

  const lines = db.prepare(`
    SELECT ol.*, i.invoice_number, i.invoice_date, i.total_amount AS invoice_total_amount, i.balance_amount AS invoice_balance_amount
    FROM customer_offset_lines ol
    LEFT JOIN invoices i ON i.id = ol.invoice_id AND i.tenant_id = ol.tenant_id
    WHERE ol.offset_id = ? AND ol.tenant_id = ?
    ORDER BY ol.rowid ASC
  `).all(id, tenantId)

  const customer = offset.customer_id
    ? db.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(offset.customer_id, tenantId)
    : null

  return {
    ...offset,
    customer,
    lines,
  }
}

export function getCustomerCreditsOverview(tenantId: string, opts: { customerId?: string; all?: boolean } = {}) {
  const customerId = opts.customerId?.trim() || undefined
  const custWhere = customerId ? 'AND cc.customer_id = ?' : ''
  const custArgs = customerId ? [customerId] : []
  const balWhere = opts.all ? '' : 'AND cc.balance > 0.005'

  const credits = db.prepare(`
    SELECT cc.*, c.name AS customer_name, c.code AS customer_code
    FROM customer_credits cc
    LEFT JOIN customers c ON c.id = cc.customer_id AND c.tenant_id = cc.tenant_id
    WHERE cc.tenant_id = ? ${custWhere} ${balWhere}
    ORDER BY cc.created_at DESC, cc.rowid DESC
  `).all(tenantId, ...custArgs) as any[]

  const offsetCustWhere = customerId ? 'AND o.customer_id = ?' : ''
  const offsets = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.code AS customer_code,
      cc.source_type AS credit_source_type, cc.source_number AS credit_source_number,
      cc.source_type AS source_type, cc.source_number AS source_number
    FROM customer_offsets o
    LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    LEFT JOIN customer_credits cc ON cc.id = o.credit_id AND cc.tenant_id = o.tenant_id
    WHERE o.tenant_id = ? ${offsetCustWhere}
    ORDER BY o.offset_date DESC, o.created_at DESC, o.rowid DESC
  `).all(tenantId, ...custArgs) as any[]

  if (offsets.length > 0) {
    const offsetIds = offsets.map(o => o.id)
    const ph = offsetIds.map(() => '?').join(',')
    const allLines = db.prepare(`
      SELECT ol.*, i.invoice_number, i.invoice_date, i.total_amount AS invoice_total_amount
      FROM customer_offset_lines ol
      LEFT JOIN invoices i ON i.id = ol.invoice_id AND i.tenant_id = ol.tenant_id
      WHERE ol.tenant_id = ? AND ol.offset_id IN (${ph})
      ORDER BY ol.rowid ASC
    `).all(tenantId, ...offsetIds) as any[]
    const linesByOffset = new Map<string, any[]>()
    for (const l of allLines) {
      let arr = linesByOffset.get(l.offset_id)
      if (!arr) { arr = []; linesByOffset.set(l.offset_id, arr) }
      arr.push(l)
    }
    for (const o of offsets) {
      o.lines = linesByOffset.get(o.id) || []
    }
  }

  const bbCustWhere = customerId ? 'AND bb.customer_id = ?' : ''
  const buybacks = db.prepare(`
    SELECT bb.*, c.name AS customer_name, c.code AS customer_code,
      cc.balance AS credit_balance
    FROM customer_buybacks bb
    LEFT JOIN customers c ON c.id = bb.customer_id AND c.tenant_id = bb.tenant_id
    LEFT JOIN customer_credits cc ON cc.source_type = 'BUYBACK' AND cc.source_id = bb.id AND cc.tenant_id = bb.tenant_id
    WHERE bb.tenant_id = ? ${bbCustWhere}
    ORDER BY bb.buyback_date DESC, bb.created_at DESC, bb.rowid DESC
  `).all(tenantId, ...custArgs) as any[]

  const invCustWhere = customerId ? 'AND i.customer_id = ?' : ''
  const openInvoices = db.prepare(`
    SELECT i.*, c.name AS customer_name, c.code AS customer_code
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ? ${invCustWhere}
      AND i.status != 'CANCELLED'
      AND i.pos_bill_id IS NULL
      AND i.balance_amount > 0.005
    ORDER BY i.invoice_date ASC, i.created_at ASC, i.rowid ASC
  `).all(tenantId, ...custArgs) as any[]

  return {
    credits,
    offsets,
    buybacks,
    openInvoices,
  }
}
