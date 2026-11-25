import db from '../db/sqlite'
import { generateId, formatDocumentNumber, docYear, thaiDateStr } from '../utils/id'
import { ACC } from '../config/accountCodes'
import { postJournal, isVatRegistered, type JournalLineInput } from './accounting.service'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'
import { roundQty } from '../utils/qty'
import { calcVat } from '../utils/vat'
import { isServiceItem } from './stockItem.service'
import {
  CustomerCreditError,
  registerCredit,
  removeCredit,
  applyOffset,
  validateRealDateNotFuture,
  assertOpenPeriod,
  type ApplyOffsetLineInput,
} from './customerCredit.service'

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export class CustomerBuybackError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function actorLabel(actor: unknown): string {
  if (!actor) return 'system'
  if (typeof actor === 'string') return actor
  const a = actor as { email?: string; userId?: string; id?: string; name?: string }
  return a.email || a.userId || a.id || a.name || 'system'
}

export interface BuybackItemInput {
  stockItemId: string
  quantity: number
  unit?: string | null
  unitPrice: number
  condition?: 'GOOD' | 'DAMAGED' | string
}

export interface CreateBuybackInput {
  customerId: string
  date?: string
  sellerVat?: boolean | number
  taxInvoiceNumber?: string | null
  taxInvoiceDate?: string | null
  taxRate?: number | null
  vatInclusive?: boolean | number | null
  approvedBy?: string | null
  sellerIdDoc?: string | null
  notes?: string | null
  items: BuybackItemInput[]
  applyTo?: ApplyOffsetLineInput[]
}

export function createCustomerBuyback(tenantId: string, actor: unknown, input: CreateBuybackInput): any {
  const customerId = String(input?.customerId || '').trim()
  if (!customerId) {
    throw new CustomerBuybackError(400, 'กรุณาเลือกลูกค้า')
  }

  let buybackDate: string
  try {
    buybackDate = validateRealDateNotFuture(input?.date, 'วันที่รับซื้อคืน')
    assertOpenPeriod(tenantId, buybackDate, 'บันทึกรับซื้อคืน')
  } catch (e) {
    if (e instanceof CustomerCreditError) throw new CustomerBuybackError(e.status, e.message)
    throw e
  }

  const sellerVat = input?.sellerVat === true || input?.sellerVat === 1
  let taxInvoiceNumber: string | null = null
  let taxInvoiceDate: string | null = null
  let taxRate = 0
  const vatInclusive = input?.vatInclusive === true || input?.vatInclusive === 1
  let approvedBy: string | null = typeof input?.approvedBy === 'string' && input.approvedBy.trim() ? input.approvedBy.trim() : null
  let sellerIdDoc: string | null = typeof input?.sellerIdDoc === 'string' && input.sellerIdDoc.trim() ? input.sellerIdDoc.trim() : null

  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?')
    .get(customerId, tenantId) as any
  if (!customer) {
    throw new CustomerBuybackError(404, 'ไม่พบข้อมูลลูกค้าในกิจการนี้')
  }

  if (sellerVat) {
    taxInvoiceNumber = typeof input?.taxInvoiceNumber === 'string' ? input.taxInvoiceNumber.trim() : ''
    if (!taxInvoiceNumber) {
      throw new CustomerBuybackError(400, 'ผู้ขายจด VAT ต้องระบุเลขที่ใบกำกับภาษีของผู้ขาย')
    }
    if (!input?.taxInvoiceDate || !String(input.taxInvoiceDate).trim()) {
      throw new CustomerBuybackError(400, 'ผู้ขายจด VAT ต้องระบุวันที่ใบกำกับภาษีของผู้ขาย')
    }
    try {
      taxInvoiceDate = validateRealDateNotFuture(input.taxInvoiceDate, 'วันที่ใบกำกับภาษีของผู้ขาย')
    } catch (e) {
      if (e instanceof CustomerCreditError) throw new CustomerBuybackError(e.status, e.message)
      throw e
    }
    const custTaxId = String(customer.tax_id || '').trim()
    if (!/^\d{13}$/.test(custTaxId)) {
      throw new CustomerBuybackError(400, 'ผู้ขายจด VAT ต้องมีเลขประจำตัวผู้เสียภาษี 13 หลักในข้อมูลลูกค้า')
    }
    const rawRate = input?.taxRate === undefined || input?.taxRate === null || input?.taxRate === ('' as any)
      ? 7
      : Number(input.taxRate)
    if (!Number.isFinite(rawRate) || !(rawRate > 0)) {
      throw new CustomerBuybackError(400, 'อัตราภาษีมูลค่าเพิ่มต้องมากกว่า 0')
    }
    taxRate = rawRate
  } else {
    taxRate = 0
    if (!approvedBy) {
      throw new CustomerBuybackError(400, 'รับซื้อคืนจากผู้ไม่จด VAT ต้องระบุผู้อนุมัติ (approvedBy)')
    }
    if (!sellerIdDoc) {
      throw new CustomerBuybackError(400, 'รับซื้อคืนจากผู้ไม่จด VAT ต้องระบุหลักฐานบัตรประชาชน/ผู้รับเงิน (sellerIdDoc)')
    }
  }

  const rawItems = Array.isArray(input?.items) ? input.items : []
  if (rawItems.length === 0) {
    throw new CustomerBuybackError(400, 'กรุณาระบุรายการสินค้าที่รับซื้อคืนอย่างน้อย 1 รายการ')
  }

  interface PreparedLine {
    stockItemId: string
    productName: string
    quantity: number
    unit: string
    unitPrice: number
    rawLineTotal: number
    condition: 'GOOD' | 'DAMAGED'
    baseQty: number
  }

  const preparedLines: PreparedLine[] = []
  let rawLinesSum = 0

  for (const it of rawItems) {
    const stockItemId = String(it?.stockItemId || '').trim()
    if (!stockItemId) {
      throw new CustomerBuybackError(400, 'กรุณาเลือกสินค้าในคลังสำหรับทุกรายการ')
    }
    const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?')
      .get(stockItemId, tenantId) as any
    if (!stockItem) {
      throw new CustomerBuybackError(400, 'ไม่พบสินค้าในรายการนี้ในกิจการนี้')
    }
    if (isServiceItem(stockItem)) {
      throw new CustomerBuybackError(400, `"${stockItem.name}" เป็นรายการบริการ รับซื้อคืนเข้าสต็อกไม่ได้`)
    }

    const quantity = Number(it?.quantity)
    const unitPrice = Number(it?.unitPrice)
    if (!Number.isFinite(quantity) || !(quantity > 0)) {
      throw new CustomerBuybackError(400, `จำนวนของ "${stockItem.name}" ต้องมากกว่า 0`)
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new CustomerBuybackError(400, `ราคาต่อหน่วยของ "${stockItem.name}" ต้องไม่ติดลบ`)
    }

    const conditionRaw = it?.condition ? String(it.condition).toUpperCase().trim() : 'GOOD'
    if (conditionRaw !== 'GOOD' && conditionRaw !== 'DAMAGED') {
      throw new CustomerBuybackError(400, 'สภาพสินค้าต้องเป็น GOOD หรือ DAMAGED เท่านั้น')
    }
    const condition = conditionRaw as 'GOOD' | 'DAMAGED'

    const baseUnit = stockItem.base_unit || stockItem.unit || ''
    const enteredUnit = (it?.unit && String(it.unit).trim()) ? String(it.unit).trim() : baseUnit
    let baseQty = roundQty(quantity)

    if (enteredUnit && baseUnit && normalizeUnit(enteredUnit) !== normalizeUnit(baseUnit)) {
      const conv = convertQuantityBidirectional(quantity, enteredUnit, baseUnit, tenantId, stockItem.id, stockItem.name)
      if (!conv || !(conv.converted > 0)) {
        throw new CustomerBuybackError(400, `ไม่พบการแปลงหน่วย ${enteredUnit} → ${baseUnit} สำหรับ "${stockItem.name}"`)
      }
      baseQty = roundQty(conv.converted)
    }

    const rawLineTotal = r2(quantity * unitPrice)
    rawLinesSum = r2(rawLinesSum + rawLineTotal)

    preparedLines.push({
      stockItemId: stockItem.id,
      productName: stockItem.name,
      quantity,
      unit: enteredUnit,
      unitPrice: r2(unitPrice),
      rawLineTotal,
      condition,
      baseQty,
    })
  }

  const vatTotals = sellerVat
    ? calcVat(rawLinesSum, { rate: taxRate, inclusive: vatInclusive })
    : { subtotal: r2(rawLinesSum), taxAmount: 0, totalAmount: r2(rawLinesSum) }

  const subtotal = r2(vatTotals.subtotal)
  const taxAmount = r2(vatTotals.taxAmount)
  const totalAmount = r2(vatTotals.totalAmount)

  if (!(totalAmount > 0)) {
    throw new CustomerBuybackError(400, 'ยอดรวมรับซื้อคืนต้องมากกว่า 0')
  }

  // Allocate net ex-VAT total_price and cost_value per line (last item takes rounding remainder)
  const tenantVatReg = isVatRegistered(tenantId)
  const claimInputVat = tenantVatReg && sellerVat && taxAmount > 0
  const targetCostTotal = claimInputVat ? subtotal : totalAmount

  let allocatedNet = 0
  let allocatedCost = 0
  const finalLines = preparedLines.map((l, idx) => {
    const isLast = idx === preparedLines.length - 1
    const netTotalPrice = isLast
      ? r2(subtotal - allocatedNet)
      : (rawLinesSum > 0 ? r2(subtotal * (l.rawLineTotal / rawLinesSum)) : 0)
    allocatedNet = r2(allocatedNet + netTotalPrice)

    const costValue = isLast
      ? r2(targetCostTotal - allocatedCost)
      : (rawLinesSum > 0 ? r2(targetCostTotal * (l.rawLineTotal / rawLinesSum)) : 0)
    allocatedCost = r2(allocatedCost + costValue)

    return {
      ...l,
      totalPrice: netTotalPrice,
      costValue,
    }
  })

  const applyTo = Array.isArray(input?.applyTo) ? input.applyTo.filter(a => a && (Number(a.amount) > 0 || a.invoiceId)) : []

  const actorStr = actorLabel(actor)
  let buybackId = ''
  let offsetResult: any = null

  const tx = db.transaction(() => {
    // Re-check duplicate active taxInvoiceNumber for the same customer inside transaction before issuing doc number
    if (sellerVat && taxInvoiceNumber) {
      const dup = db.prepare(`
        SELECT bb_number FROM customer_buybacks
        WHERE tenant_id = ? AND customer_id = ? AND status != 'CANCELLED'
          AND LOWER(TRIM(tax_invoice_number)) = LOWER(?)
        LIMIT 1
      `).get(tenantId, customerId, taxInvoiceNumber) as { bb_number: string } | undefined
      if (dup) {
        throw new CustomerBuybackError(
          400,
          `เลขที่ใบกำกับภาษี "${taxInvoiceNumber}" ซ้ำกับใบรับซื้อคืน ${dup.bb_number} ของลูกค้ารายนี้`
        )
      }
    }

    // Pre-validate applyTo lines before issuing BB document number so invalid offset never burns a BB number
    if (applyTo.length > 0) {
      const seenInv = new Set<string>()
      let applySum = 0
      for (const a of applyTo) {
        const invId = String(a?.invoiceId || '').trim()
        const amt = r2(a?.amount)
        if (!invId || !Number.isFinite(amt) || !(amt > 0)) {
          throw new CustomerBuybackError(400, 'จำนวนเงินที่หักกลบในแต่ละใบแจ้งหนี้ต้องมากกว่า 0')
        }
        if (seenInv.has(invId)) {
          throw new CustomerBuybackError(400, 'ห้ามระบุใบแจ้งหนี้ซ้ำในการหักกลบ')
        }
        seenInv.add(invId)
        applySum = r2(applySum + amt)
        const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invId, tenantId) as any
        if (!inv) {
          throw new CustomerBuybackError(404, 'ไม่พบใบแจ้งหนี้ในกิจการนี้')
        }
        if (inv.customer_id !== customerId) {
          throw new CustomerBuybackError(400, `ใบแจ้งหนี้ ${inv.invoice_number} ไม่ใช่ของลูกค้ารายนี้`)
        }
        if (inv.status === 'CANCELLED') {
          throw new CustomerBuybackError(400, `ใบแจ้งหนี้ ${inv.invoice_number} ถูกยกเลิกแล้ว หักกลบไม่ได้`)
        }
        if (inv.pos_bill_id != null) {
          throw new CustomerBuybackError(400, `ใบกำกับภาษีจากบิล POS (${inv.invoice_number}) หักกลบหนี้ไม่ได้`)
        }
        if (amt > Number(inv.balance_amount) + 0.005) {
          throw new CustomerBuybackError(400, `ยอดหักกลบ (฿${amt.toFixed(2)}) เกินยอดค้างของใบแจ้งหนี้ ${inv.invoice_number} (฿${Number(inv.balance_amount).toFixed(2)})`)
        }
      }
      if (applySum > totalAmount + 0.005) {
        throw new CustomerBuybackError(400, `ยอดหักกลบรวม (฿${applySum.toFixed(2)}) เกินยอดรับซื้อคืน (฿${totalAmount.toFixed(2)})`)
      }
    }

    buybackId = generateId()
    const bbNumber = formatDocumentNumber('BB', tenantId, 'CUSTOMER_BUYBACK', docYear(buybackDate), 5, buybackDate)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO customer_buybacks (
        id, tenant_id, bb_number, customer_id, buyback_date, seller_vat, tax_invoice_number, tax_invoice_date,
        subtotal, tax_rate, tax_amount, total_amount, status, approved_by, seller_id_doc, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?)
    `).run(
      buybackId, tenantId, bbNumber, customerId, buybackDate, sellerVat ? 1 : 0,
      taxInvoiceNumber, taxInvoiceDate, subtotal, taxRate, taxAmount, totalAmount,
      approvedBy, sellerIdDoc, input?.notes || '', actorStr, now, now
    )

    const insertItem = db.prepare(`
      INSERT INTO customer_buyback_items (
        id, tenant_id, buyback_id, stock_item_id, product_name, quantity, unit, unit_price, total_price, condition, base_qty, cost_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let goodDebitTotal = 0
    let damagedDebitTotal = 0

    for (const l of finalLines) {
      insertItem.run(
        generateId(), tenantId, buybackId, l.stockItemId, l.productName,
        l.quantity, l.unit, l.unitPrice, l.totalPrice, l.condition, l.baseQty, l.costValue
      )

      if (l.condition === 'GOOD') {
        goodDebitTotal = r2(goodDebitTotal + l.costValue)
        const curStock = db.prepare('SELECT quantity, unit_cost, base_unit, unit FROM stock_items WHERE id = ? AND tenant_id = ?')
          .get(l.stockItemId, tenantId) as any
        const curQty = Number(curStock?.quantity) || 0
        const oldPosQty = Math.max(0, curQty)
        const oldUnitCost = Number(curStock?.unit_cost) || 0
        const newQty = roundQty(curQty + l.baseQty)
        const newUnitCost = (oldPosQty + l.baseQty) > 0
          ? (oldPosQty * oldUnitCost + l.costValue) / (oldPosQty + l.baseQty)
          : oldUnitCost

        db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(newQty, newUnitCost, now, l.stockItemId, tenantId)

        db.prepare(`
          INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId(), tenantId, l.stockItemId, l.baseQty, l.unit || null, l.quantity,
          `BB: ${bbNumber}`, `รับซื้อคืนสินค้าจากลูกค้า (${bbNumber})`, now, actorStr
        )
      } else {
        damagedDebitTotal = r2(damagedDebitTotal + l.costValue)
      }
    }

    const journalLines: JournalLineInput[] = []
    if (goodDebitTotal > 0.005) {
      journalLines.push({
        code: ACC.RAW_MATERIAL,
        description: `รับซื้อคืนสินค้าสภาพดีเข้าสต็อก - ${bbNumber}`,
        debit: goodDebitTotal,
      })
    }
    if (damagedDebitTotal > 0.005) {
      journalLines.push({
        code: ACC.STOCK_ADJUSTMENT,
        description: `รับซื้อคืนสินค้าชำรุด - ${bbNumber}`,
        debit: damagedDebitTotal,
      })
    }
    if (claimInputVat) {
      journalLines.push({
        code: ACC.INPUT_VAT,
        description: `ภาษีซื้อรับซื้อคืน - ${taxInvoiceNumber}`,
        debit: taxAmount,
      })
    }
    journalLines.push({
      code: ACC.AP,
      description: `เจ้าหนี้รับซื้อคืนสินค้า - ${bbNumber}`,
      credit: totalAmount,
    })

    const journalId = postJournal({
      tenantId,
      date: buybackDate,
      referenceType: 'CUSTOMER_BUYBACK',
      referenceId: buybackId,
      sourceNumber: bbNumber,
      description: `รับซื้อคืนสินค้า ${bbNumber} จาก ${customer.name}`,
      createdBy: actorStr,
      businessUnit: 'WHOLESALE',
      notes: input?.notes || null,
      lines: journalLines,
    })

    if (claimInputVat) {
      db.prepare(`
        INSERT INTO vat_entries (
          id, tenant_id, document_type, document_id, document_number, document_date,
          party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount,
          is_input_vat, is_output_vat, journal_entry_id, created_at
        ) VALUES (?, ?, 'CUSTOMER_BUYBACK', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
      `).run(
        generateId(), tenantId, buybackId, taxInvoiceNumber!, taxInvoiceDate!,
        customer.name || '', customer.tax_id || null,
        subtotal, taxRate, taxAmount, totalAmount, journalId, now
      )
    }

    const credit = registerCredit(tenantId, {
      sourceType: 'BUYBACK',
      sourceId: buybackId,
      sourceNumber: bbNumber,
      customerId,
      amount: totalAmount,
    })

    if (applyTo.length > 0 && credit) {
      offsetResult = applyOffset(tenantId, actor, {
        creditId: credit.id,
        date: buybackDate,
        lines: applyTo,
        notes: input?.notes || `หักกลบอัตโนมัติพร้อมใบรับซื้อคืน ${bbNumber}`,
      })
    }
  })

  try {
    tx()
  } catch (e) {
    if (e instanceof CustomerCreditError) throw new CustomerBuybackError(e.status, e.message)
    throw e
  }

  const buyback = getCustomerBuybackById(tenantId, buybackId)
  return offsetResult ? { ...buyback, offset: offsetResult } : buyback
}

export function cancelCustomerBuyback(tenantId: string, actor: unknown, id: string, reason?: string): any {
  const cleanReason = typeof reason === 'string' ? reason.trim() : ''
  if (!cleanReason) {
    throw new CustomerBuybackError(400, 'กรุณาระบุเหตุผลในการยกเลิกใบรับซื้อคืน')
  }
  const today = thaiDateStr()
  try {
    assertOpenPeriod(tenantId, today, 'ยกเลิกใบรับซื้อคืน')
  } catch (e) {
    if (e instanceof CustomerCreditError) throw new CustomerBuybackError(e.status, e.message)
    throw e
  }

  const actorStr = actorLabel(actor)

  const tx = db.transaction(() => {
    const bb = db.prepare('SELECT * FROM customer_buybacks WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any
    if (!bb) {
      throw new CustomerBuybackError(404, 'ไม่พบใบรับซื้อคืนสินค้า')
    }
    if (bb.status === 'CANCELLED') {
      throw new CustomerBuybackError(409, `ใบรับซื้อคืน ${bb.bb_number} ถูกยกเลิกไปแล้ว`)
    }

    // 1. removeCredit first (refuses with 409 when used)
    removeCredit(tenantId, 'BUYBACK', bb.id)

    // 2. Check and reverse stock for GOOD items
    const items = db.prepare('SELECT * FROM customer_buyback_items WHERE buyback_id = ? AND tenant_id = ?')
      .all(bb.id, tenantId) as any[]
    const setting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?')
      .get(tenantId) as any
    const allowNegativeStock = !!setting && setting.allow_negative_stock === 1
    const now = new Date().toISOString()

    // Aggregate GOOD base_qty by stock_item_id to check total needed against available stock
    const neededByStock = new Map<string, number>()
    for (const it of items) {
      if (it.condition !== 'GOOD') continue
      const bq = roundQty(Number(it.base_qty) || 0)
      if (bq <= 0) continue
      neededByStock.set(it.stock_item_id, roundQty((neededByStock.get(it.stock_item_id) || 0) + bq))
    }

    for (const [stockItemId, neededQty] of neededByStock.entries()) {
      const si = db.prepare('SELECT id, name, quantity FROM stock_items WHERE id = ? AND tenant_id = ?')
        .get(stockItemId, tenantId) as any
      if (!si) {
        throw new CustomerBuybackError(404, 'ไม่พบสินค้าในคลังที่ต้องตัดคืน')
      }
      if (Number(si.quantity) < neededQty - 1e-9 && !allowNegativeStock) {
        throw new CustomerBuybackError(
          409,
          `ยกเลิกใบรับซื้อคืนไม่ได้: สต็อก "${si.name}" เหลือ ${si.quantity} น้อยกว่าที่รับซื้อคืนไว้ ${neededQty}`
        )
      }
    }

    for (const it of items) {
      if (it.condition !== 'GOOD') continue
      const bq = roundQty(Number(it.base_qty) || 0)
      if (bq <= 0) continue
      db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(bq, now, it.stock_item_id, tenantId)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(), tenantId, it.stock_item_id, bq, it.unit || null, it.quantity,
        `BB-CANCEL: ${bb.bb_number}`, `ยกเลิกใบรับซื้อคืน ${bb.bb_number} (${cleanReason})`, now, actorStr
      )
    }

    // 3. Reverse the journal by postJournal
    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CUSTOMER_BUYBACK_CANCEL' AND reference_id = ?"
    ).get(tenantId, bb.id)
    if (alreadyReversed) {
      throw new CustomerBuybackError(409, `ใบรับซื้อคืน ${bb.bb_number} ถูกกลับรายการบัญชีไปแล้ว`)
    }

    const origJe = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CUSTOMER_BUYBACK' AND reference_id = ?"
    ).get(tenantId, bb.id) as any
    if (!origJe) {
      throw new CustomerBuybackError(500, `ไม่พบรายการบัญชีต้นทางของใบรับซื้อคืน ${bb.bb_number}`)
    }
    const origLines = db.prepare(
      'SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ? ORDER BY line_number ASC'
    ).all(origJe.id, tenantId) as any[]
    if (origLines.length === 0) {
      throw new CustomerBuybackError(500, `รายการบัญชีของใบรับซื้อคืน ${bb.bb_number} ไม่มีบรรทัดรายการ`)
    }

    const revLines: JournalLineInput[] = origLines.map(l => ({
      accountId: l.account_id,
      description: `กลับรายการ: ${l.description || ''}`,
      debit: r2(l.credit || 0),
      credit: r2(l.debit || 0),
    }))

    const reversalId = postJournal({
      tenantId,
      date: today,
      referenceType: 'CUSTOMER_BUYBACK_CANCEL',
      referenceId: bb.id,
      sourceNumber: bb.bb_number,
      description: `กลับรายการ (ยกเลิกใบรับซื้อคืน) - ${bb.bb_number}`,
      createdBy: actorStr,
      businessUnit: origJe.business_unit || 'WHOLESALE',
      notes: cleanReason,
      lines: revLines,
    })

    // 4. ภาษีซื้อ: ลงแถวกลับรายการวันนี้ (ห้ามลบแถวเดิม — งวดนั้นอาจยื่นแล้ว และ GL กลับรายการวันนี้) แบบเดียวกับ PURCHASE_INVOICE_CANCEL
    db.prepare(`
      INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
        party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, journal_entry_id, created_at)
      SELECT ?, tenant_id, 'CUSTOMER_BUYBACK_CANCEL', document_id, document_number, ?,
        party_name, party_tax_id, -base_amount, vat_rate, -vat_amount, -total_amount, 1, 0, ?, ?
      FROM vat_entries WHERE tenant_id = ? AND document_type = 'CUSTOMER_BUYBACK' AND document_id = ?
    `).run(generateId(), today, reversalId, now, tenantId, bb.id)

    // 5. Status CANCELLED
    db.prepare("UPDATE customer_buybacks SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, bb.id, tenantId)
  })

  try {
    tx()
  } catch (e) {
    if (e instanceof CustomerCreditError) throw new CustomerBuybackError(e.status, e.message)
    throw e
  }

  return getCustomerBuybackById(tenantId, id)
}

export function listCustomerBuybacks(tenantId: string, opts: { customerId?: string } = {}): any[] {
  const customerId = opts.customerId?.trim() || undefined
  const custWhere = customerId ? 'AND bb.customer_id = ?' : ''
  const custArgs = customerId ? [customerId] : []

  return db.prepare(`
    SELECT bb.*, c.name AS customer_name, c.code AS customer_code, c.tax_id AS customer_tax_id,
      cc.id AS credit_id, cc.balance AS credit_balance
    FROM customer_buybacks bb
    LEFT JOIN customers c ON c.id = bb.customer_id AND c.tenant_id = bb.tenant_id
    LEFT JOIN customer_credits cc ON cc.source_type = 'BUYBACK' AND cc.source_id = bb.id AND cc.tenant_id = bb.tenant_id
    WHERE bb.tenant_id = ? ${custWhere}
    ORDER BY bb.buyback_date DESC, bb.created_at DESC, bb.rowid DESC
  `).all(tenantId, ...custArgs) as any[]
}

export function getCustomerBuybackById(tenantId: string, id: string): any | null {
  const bb = db.prepare(`
    SELECT bb.*, c.name AS customer_name, c.code AS customer_code, c.tax_id AS customer_tax_id,
      c.address AS customer_address, c.phone AS customer_phone,
      cc.id AS credit_id, cc.amount AS credit_amount, cc.balance AS credit_balance
    FROM customer_buybacks bb
    LEFT JOIN customers c ON c.id = bb.customer_id AND c.tenant_id = bb.tenant_id
    LEFT JOIN customer_credits cc ON cc.source_type = 'BUYBACK' AND cc.source_id = bb.id AND cc.tenant_id = bb.tenant_id
    WHERE bb.id = ? AND bb.tenant_id = ?
  `).get(id, tenantId) as any
  if (!bb) return null

  const items = db.prepare(`
    SELECT bbi.*, COALESCE(bbi.product_name, si.name) AS product_name, si.sku AS product_code
    FROM customer_buyback_items bbi
    LEFT JOIN stock_items si ON si.id = bbi.stock_item_id AND si.tenant_id = bbi.tenant_id
    WHERE bbi.buyback_id = ? AND bbi.tenant_id = ?
    ORDER BY bbi.rowid ASC
  `).all(id, tenantId)

  const customer = bb.customer_id
    ? db.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(bb.customer_id, tenantId)
    : null

  return {
    ...bb,
    customer,
    items,
  }
}
