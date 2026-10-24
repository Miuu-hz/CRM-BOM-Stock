import db from '../db/sqlite'
import { generateId, formatDocumentNumber, docYear } from '../utils/id'
import { ACC, ACC_META, resolveBankAccountGL } from '../config/accountCodes'
import { getOrCreateAccount, isVatRegistered, rememberContactVatMode, postJournal, type JournalLineInput } from './accounting.service'
import { calcVat, vatModeOf } from '../utils/vat'
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
      | 'PERIOD_CLOSED'
      | 'DUPLICATE_SUPPLIER_INVOICE'
      | 'POS_CASH_REQUIRED'
      | 'POS_CASH_NOT_FOUND'
      | 'POS_CASH_OVER'
      | 'VAT_MODE_MISMATCH'
      | 'WHT_INVALID'
      | 'SUPPLIER_MISMATCH',
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
  /**
   * ฝั่ง Cr = เงินจาก POS (1182) แทนเจ้าหนี้ — เงินออกจากลิ้นชักไปก่อนแล้ว บิลนี้มาจับคู่ฝั่ง Dr ให้
   * ใบปิดเป็นจ่ายแล้วทันที ไม่มีเจ้าหนี้ ไม่ต้องทำใบจ่ายเงิน
   */
  posCashMovementId?: string | null
}

interface DerivedGrItem {
  grItemId: string
  poItemId: string | null
  materialId: string | null
  quantity: number
  unitPrice: number
  skipStock: number
  expenseAccountId: string | null
}

/** รายการจาก GR (join ราคาจาก PO item) ของ GR ทุกใบที่ระบุ — ใช้ derive items ของใบแจ้งหนี้ */
function deriveItemsFromGoodsReceipts(grIds: string[]): DerivedGrItem[] {
  if (grIds.length === 0) return []
  const placeholders = grIds.map(() => '?').join(',')
  // คืนของก่อนออกใบแจ้งหนี้ (grni_return) ตัดออกจาก 2109 ไปแล้ว — ใบแจ้งหนี้คิดเฉพาะของที่เหลือ
  return (db.prepare(`
    SELECT gri.id as grItemId, gri.purchase_order_item_id as poItemId, gri.material_id as materialId,
      gri.accepted_qty - COALESCE((
        SELECT SUM(pri.po_unit_qty) FROM purchase_return_items pri
        JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
        WHERE pri.goods_receipt_item_id = gri.id AND pr.status = 'CONFIRMED' AND pr.grni_return = 1
      ), 0) as quantity,
      poi.unit_price as unitPrice, COALESCE(poi.skip_stock, 0) as skipStock,
      poi.expense_account_id as expenseAccountId
    FROM goods_receipt_items gri
    JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    WHERE gri.goods_receipt_id IN (${placeholders}) AND gri.accepted_qty > 0
  `).all(...grIds) as DerivedGrItem[]).filter(d => d.quantity > 1e-9)
}

/**
 * รวมมูลค่าดิบ (qty×unitPrice) ของบรรทัด skip_stock แยกตามบัญชีค่าใช้จ่ายที่เลือกต่อบรรทัด
 * (NULL = ยังไม่เลือก → รวมไว้ภายใต้ key null แล้วให้ calcPurchaseInvoiceTotals fallback ไป 5403)
 */
function buildSkipBuckets(items: { skipStock: any; expenseAccountId?: string | null; quantity: number; unitPrice: number }[]): { accountId: string | null; rawSubtotal: number }[] {
  const map = new Map<string | null, number>()
  for (const it of items) {
    if (!it.skipStock) continue
    const key = it.expenseAccountId || null
    map.set(key, (map.get(key) || 0) + it.quantity * it.unitPrice)
  }
  return [...map.entries()].map(([accountId, rawSubtotal]) => ({ accountId, rawSubtotal }))
}

/**
 * แบ่งยอดรวม (total) ลงบัญชีตามสัดส่วน rawSubtotal ของแต่ละ bucket — บรรทัดสุดท้ายรับเศษปัดทั้งหมด
 * เพื่อให้ผลรวมที่แบ่งแล้ว = total เป๊ะ (กันดุลไม่ลงเพราะปัดสตางค์แต่ละ bucket แยกกัน)
 */
function allocateByBucket(buckets: { accountId: string; rawSubtotal: number }[], total: number): { accountId: string; amount: number }[] {
  const r2 = (n: number) => Math.round(n * 100) / 100
  if (buckets.length === 0 || total <= 0.005) return []
  const rawTotal = buckets.reduce((s, b) => s + b.rawSubtotal, 0)
  if (rawTotal <= 0.005) return []
  let allocated = 0
  return buckets.map((b, i) => {
    if (i === buckets.length - 1) return { accountId: b.accountId, amount: r2(total - allocated) }
    const amt = r2(total * (b.rawSubtotal / rawTotal))
    allocated = r2(allocated + amt)
    return { accountId: b.accountId, amount: amt }
  })
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
  /** กลุ่มบัญชีค่าใช้จ่ายของส่วน skip_stock แยกตามบัญชีที่เลือกต่อบรรทัด — ว่างถ้าไม่มีบรรทัด skip_stock หรือผู้ใช้เลือก drAccountId เอง */
  expenseBuckets: { accountId: string; rawSubtotal: number }[]
  /** สัดส่วนมูลค่า skip_stock ต่อ subtotal ทั้งใบ (0 ถ้าไม่มี/ผู้ใช้เลือกบัญชีเอง) */
  skipShare: number
}

/**
 * คำนวณยอด VAT/ส่วนลด + resolve บัญชีปลายทางทั้งหมด — ทำนอก transaction เสมอ (auto-create
 * บัญชีในผังบัญชีถ้ายังไม่มี + throw ก่อนแตะ DB ถ้าบัญชีปลายทางที่เลือกไม่ถูกต้อง)
 *
 * skipBuckets = ผลรวม qty×unitPrice ของบรรทัด skip_stock (ของไม่นับสต็อก เช่นน้ำมัน/ของใช้สำนักงาน)
 * ภายในใบนี้ แยกตามบัญชีค่าใช้จ่ายที่เลือกต่อบรรทัด (accountId: null = ยังไม่เลือก → fallback 5403)
 * ใช้หาสัดส่วนที่ต้องแยกไปลงบัญชีค่าใช้จ่ายแทนสต็อกวัตถุดิบ (1107) — ไม่แยกถ้าผู้ใช้เลือก drAccountId
 * เอง (เขาตั้งใจเลือกบัญชีนั้นสำหรับทั้งใบแล้ว)
 */
function calcPurchaseInvoiceTotals(
  tenantId: string,
  subtotalRaw: number,
  taxRate: number,
  discountAmount: number,
  inclusive: boolean,
  drAccountId?: string | null,
  crAccountId?: string | null,
  skipBuckets: { accountId: string | null; rawSubtotal: number }[] = []
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

  // ผู้ใช้เลือกบัญชีปลายทางเอง (resolvedDrAccId) = ตั้งใจเลือกแล้ว ไม่ต้องแยก skip_stock ออกให้
  const skipRawTotal = skipBuckets.reduce((s, b) => s + b.rawSubtotal, 0)
  const skipShare = (!resolvedDrAccId && subtotalRaw > 0.005)
    ? Math.max(0, Math.min(1, skipRawTotal / subtotalRaw))
    : 0
  // รวม bucket ที่ resolve ไปบัญชีเดียวกัน (เช่นหลายบรรทัด NULL ปน บรรทัดที่เลือก 5403 เอง) ให้เป็น Dr เดียว
  let expenseBuckets: { accountId: string; rawSubtotal: number }[] = []
  if (skipShare > 0.0001) {
    const fallbackExpenseAccId = getOrCreateAccount(tenantId, ACC.OTHER_EXPENSE, ACC_META[ACC.OTHER_EXPENSE]!.name, ACC_META[ACC.OTHER_EXPENSE]!.type, ACC_META[ACC.OTHER_EXPENSE]!.category, ACC_META[ACC.OTHER_EXPENSE]!.normalBalance)
    const merged = new Map<string, number>()
    for (const b of skipBuckets) {
      if (b.rawSubtotal <= 0) continue
      const accId = b.accountId || fallbackExpenseAccId
      merged.set(accId, (merged.get(accId) || 0) + b.rawSubtotal)
    }
    expenseBuckets = [...merged.entries()].map(([accountId, rawSubtotal]) => ({ accountId, rawSubtotal }))
  }

  return { subtotal, discount, taxAmount, totalAmount, resolvedDrAccId, inventoryAccId, payableAccId, vatAccId, vatClaimable, expenseBuckets, skipShare }
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
    /** คำอธิบายบรรทัดฝั่ง Cr — ค่าเริ่มต้นเจ้าหนี้การค้า (เงินจาก POS ใช้ข้อความของตัวเอง) */
    creditLabel?: string
  }
) {
  const { piId, piNumber, invoiceDate, notes, grIds, totals, taxRate, supplierName, supplierTaxId } = params
  const { taxAmount, totalAmount, resolvedDrAccId, inventoryAccId, payableAccId, vatAccId, vatClaimable, expenseBuckets, skipShare } = totals
  const now = new Date().toISOString()
  const r2 = (n: number) => Math.round(n * 100) / 100
  const drAccLabel = resolvedDrAccId
    ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(resolvedDrAccId) as any)?.name ?? 'ค่าใช้จ่าย'
    : 'สต็อกวัตถุดิบ'
  // ของที่ใบนี้อ้างอิงถูกตั้งค้างรับไว้แล้วตอนยืนยันใบรับสินค้า (Dr สต็อก / Cr 2109)
  // ใบแจ้งหนี้จึงมาปิด 2109 ไม่ใช่ Dr สต็อกซ้ำอีกรอบ — grIds ตรงนี้ต้องเป็น "ทุก GR" ที่ใบนี้อ้างอิง
  // (รวม PO หลายใบ) ไม่ใช่แค่ GR ของ PO หลัก ไม่งั้นยอดปิด 2109 จะขาดเป็นส่วนของ PO ที่เอามารวม
  // หักส่วนที่คืนสินค้าก่อนออกใบแจ้งหนี้ (Dr 2109 ตอนยืนยันใบคืน) ออก — เหลือเท่าที่ยังค้างจริง
  const grPh = grIds.map(() => '?').join(', ')
  const accruedForGRs = grIds.length > 0
    ? (db.prepare(`
        SELECT COALESCE(SUM(l.credit - l.debit), 0) AS total
        FROM journal_lines l
        JOIN journal_entries je ON je.id = l.journal_entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE je.tenant_id = ? AND a.code = ? AND (
          (je.reference_type = 'GOODS_RECEIPT' AND je.reference_id IN (${grPh}))
          OR (je.reference_type = 'PURCHASE_RETURN' AND je.reference_id IN (
            SELECT id FROM purchase_returns WHERE tenant_id = je.tenant_id AND grni_return = 1 AND goods_receipt_id IN (${grPh}))))
      `).get(tenantId, ACC.GRNI, ...grIds, ...grIds) as any).total as number
    : 0
  // ลงบัญชีเป็นสตางค์เสมอ แล้วให้ฝั่งเดบิตของสินค้า = เจ้าหนี้ − ภาษี พอดี (ไม่ใช้ subtotal ตรง ๆ)
  // เพราะ calcVat โหมดแยก VAT คืน subtotal แบบไม่ปัด (เช่น 168.585) แต่ total ปัดแล้ว (180.39)
  // เดิม Dr 168.58 + 11.80 ≠ Cr 180.39 (PI-025-021026) / Dr 976.916 (PI-018-021026) — เศษสตางค์
  // ที่เหลือหลังปิด 2109 ลงบัญชีสต็อก/บัญชีที่เลือก ไม่ทิ้งหาย (และ subtotal ฝั่ง EXCLUSIVE คือยอดก่อนหัก
  // ส่วนลดท้ายบิล ถ้าใช้ตรง ๆ จะไม่ดุลทุกครั้งที่มีส่วนลด)
  const payableTotal = r2(totalAmount)
  const vatDebit = vatAccId && taxAmount > 0 ? r2(taxAmount) : 0
  const goodsDebit = r2(payableTotal - vatDebit)
  // ส่วน skip_stock (ของไม่นับสต็อก เช่นน้ำมัน/ของใช้สำนักงาน) ของยอดสินค้า — คิดจาก goodsDebit ทั้งก้อน
  // ก่อนหัก GRNI (ไม่ใช่หลัง) ให้ตรงกับสัดส่วนมูลค่าที่แท้จริงในบิล ไม่ใช่ตัวเลขที่เหลือจากปิด 2109
  const hasExpenseBuckets = expenseBuckets.length > 0
  const expensePortion = hasExpenseBuckets ? Math.max(0, Math.min(goodsDebit, r2(goodsDebit * skipShare))) : 0
  // ยังไม่จด VAT: vatAccId ชี้มาที่ inventoryAccId (ภาษีซื้อขอคืนไม่ได้ รวมเป็นต้นทุนของ) — ส่วน skip_stock
  // ของภาษีนี้ก็ต้องแยกไปบัญชีค่าใช้จ่ายเหมือนกัน ถ้าจด VAT แล้ว vatDebit ลง 1110 เต็มจำนวนไม่ต้องแยก
  const vatExpensePortion = (!vatClaimable && hasExpenseBuckets) ? Math.max(0, Math.min(vatDebit, r2(vatDebit * skipShare))) : 0
  const vatStockPortion = r2(vatDebit - vatExpensePortion)
  // ยังไม่จด VAT + PO ราคารวม VAT: GR ตั้ง 2109 ไว้รวมภาษี (qty × ราคารวม VAT) → ปิด 2109 จากยอดของ+ภาษี
  // รวมกัน ไม่ใช่จากยอดของอย่างเดียว เดิมปิดได้แค่ส่วนของ เศษภาษีค้าง 2109 ถาวร + Dr สต็อกซ้ำอีกเท่าภาษี
  // (ปิดเต็ม accruedForGRs แล้วยังลงบรรทัดภาษีอีก = นับภาษีสองรอบ เดบิตเกินเครดิต postJournal ปฏิเสธ)
  const goodsStockPortion = r2(goodsDebit - expensePortion)
  // ปิด 2109 เต็มยอดที่ GR ตั้งไว้เสมอ ส่วนต่างกับต้นทุนในบิลปรับเข้า/ออกสต็อก:
  //   บิลแพงกว่า → Dr สต็อกเพิ่ม · บิลถูกกว่า (ส่วนลดท้ายบิล/ราคาลด) → Cr สต็อก (overAccrued)
  // เดิม min(ยอดตั้ง, ยอดบิล) — บิลถูกกว่าเมื่อไร ส่วนต่างค้าง 2109 ถาวร และสต็อกในงบสูงเกินจริง
  const grniPortion = Math.max(0, r2(accruedForGRs))
  const grniFromGoods = Math.min(grniPortion, goodsStockPortion)
  const grniFromVat = vatClaimable ? 0 : Math.max(0, Math.min(vatStockPortion, r2(grniPortion - grniFromGoods)))
  const overAccrued = r2(grniPortion - grniFromGoods - grniFromVat)
  const inventoryPortion = r2(goodsStockPortion - grniFromGoods)
  const vatInventoryPortion = r2(vatStockPortion - grniFromVat)
  // แบ่ง expensePortion/vatExpensePortion ลงแต่ละบัญชีตามสัดส่วน rawSubtotal ของ bucket นั้น ๆ
  // (บรรทัดสุดท้ายรับเศษปัดทั้งหมด กันดุลไม่ลง) — 1 Dr ต่อบัญชีค่าใช้จ่ายที่ต่างกัน
  const expenseAllocations = allocateByBucket(expenseBuckets, expensePortion)
  const vatExpenseAllocations = allocateByBucket(expenseBuckets, vatExpensePortion)

  const lines: JournalLineInput[] = []
  if (grniPortion > 0.005) {
    lines.push({ accountId: getOrCreateAccount(tenantId, ACC.GRNI), description: `ปิดค้างรับของ - ${piNumber}`, debit: grniPortion })
  }
  if (inventoryPortion > 0.005) {
    lines.push({ accountId: inventoryAccId, description: `${drAccLabel} - ${piNumber}`, debit: inventoryPortion })
  }
  for (const alloc of expenseAllocations) {
    if (alloc.amount > 0.005) {
      lines.push({ accountId: alloc.accountId, description: `ค่าใช้จ่ายไม่นับสต็อก - ${piNumber}`, debit: alloc.amount })
    }
  }
  if (vatInventoryPortion > 0.005) {
    lines.push({ accountId: vatAccId!, description: `${vatClaimable ? 'ภาษีซื้อ' : 'ภาษีซื้อที่ขอคืนไม่ได้ (ยังไม่จด VAT)'} - ${piNumber}`, debit: vatInventoryPortion })
  }
  for (const alloc of vatExpenseAllocations) {
    if (alloc.amount > 0.005) {
      lines.push({ accountId: alloc.accountId, description: `ภาษีซื้อที่ขอคืนไม่ได้ (ไม่นับสต็อก) - ${piNumber}`, debit: alloc.amount })
    }
  }
  if (overAccrued > 0.005) {
    // GR ลง Dr 1107 เสมอ (ไม่ใช่บัญชีที่เลือกในบิล) จึงปรับลดที่ 1107
    lines.push({ code: ACC.RAW_MATERIAL, description: `ปรับลดต้นทุนตามใบแจ้งหนี้ (ส่วนลด/ราคาต่ำกว่าใบรับ) - ${piNumber}`, credit: overAccrued })
  }
  lines.push({ accountId: payableAccId, description: `${params.creditLabel || 'เจ้าหนี้การค้า'} - ${piNumber}`, credit: payableTotal })

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
      r2(totalAmount - taxAmount), taxRate, taxAmount, totalAmount, journalId, now)
  }

  return { journalId, journalNumber }
}

/**
 * ฝั่ง Cr ของใบแจ้งหนี้ = เงินจาก POS (1182) — ตรวจว่ารายการเงินออกนั้นมีจริงและยอดเหลือพอจับคู่
 * แล้วสลับบัญชีเจ้าหนี้ใน totals เป็น 1182 · คืนข้อความบรรทัด Cr ไว้ใส่ journal
 * (ต้องเรียกนอก transaction ก่อนเบิร์นเลขเอกสาร)
 */
function applyPosCashCredit(tenantId: string, movementId: string, totals: PurchaseInvoiceTotals, excludeInvoiceId?: string): string {
  const mv = listPosCashUnmatched(tenantId, movementId, { excludeInvoiceId })[0]
  if (!mv) throw new PurchaseBillingError('POS_CASH_NOT_FOUND', 'ไม่พบรายการเงินออกจาก POS ที่เลือก')
  if (totals.totalAmount > mv.remaining + 0.005) {
    throw new PurchaseBillingError('POS_CASH_OVER',
      `ยอดบิล ฿${totals.totalAmount.toLocaleString()} มากกว่าเงินจาก POS ที่เหลือให้จับคู่ ฿${mv.remaining.toLocaleString()} (${mv.shift_number || '-'} · ${mv.reason || '-'})`)
  }
  totals.payableAccId = getOrCreateAccount(tenantId, ACC.POS_PAYOUT_PENDING)
  return `เงินจาก POS ${mv.shift_number || ''}${mv.reason ? ` (${mv.reason})` : ''}`.trim()
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
      skipStock: d.skipStock,
      expenseAccountId: d.expenseAccountId,
    }
  })
  const subtotalRaw = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
  const skipBuckets = buildSkipBuckets(items)

  // ── 5) VAT/ส่วนลด สืบทอดจาก PO — อัตราภาษี/โหมดรวม VAT จาก PO ของ GR ใบแรก, ส่วนลดรวมทุก PO ที่เกี่ยวข้อง ──
  // ทุก PO ในใบต้องโหมด VAT เดียวกัน — ใบเดียวคิดภาษีได้แบบเดียว (เดิมใช้ของใบแรกกับทุกบรรทัด)
  const modeOf = (r: any) => vatModeOf(r.po_tax_rate ?? 7, r.po_vat_inclusive === 1)
  const mixed = orderedGrRows.find(r => modeOf(r) !== modeOf(orderedGrRows[0]))
  if (mixed) {
    throw new PurchaseBillingError('VAT_MODE_MISMATCH',
      `ใบรับสินค้า ${mixed.gr_number} (${mixed.po_number}) คิด VAT คนละแบบกับ ${orderedGrRows[0].po_number} รวมเป็นบิลเดียวไม่ได้ — แยกออกใบแจ้งหนี้`)
  }
  const taxRate = reqTaxRate != null ? Number(reqTaxRate) : (orderedGrRows[0].po_tax_rate ?? 7)
  const inclusive = orderedGrRows[0].po_vat_inclusive === 1
  // ส่วนลดท้ายบิลของ PO ใช้ได้ครั้งเดียว — ใบแรกรับไป ใบถัดไปได้เฉพาะที่เหลือ (เดิมทุกใบได้ส่วนลดเต็มซ้ำ)
  // shortcut: ใบรวมหลาย PO นับส่วนลดของทั้งใบเป็นของทุก PO ในใบ — ถ้าภายหลังแยกบิล PO นั้นข้ามใบรวมอาจได้ส่วนลดน้อยกว่าจริง ให้ส่ง discountAmount เอง
  const discountTaken = db.prepare(`
    SELECT COALESCE(SUM(discount_amount), 0) AS s FROM purchase_invoices
    WHERE tenant_id = ? AND status != 'CANCELLED' AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)`)
  const discountAmount = payload.discountAmount != null
    ? Number(payload.discountAmount)
    : allPoIds.reduce((sum, poId) => {
        const poDiscount = Number(orderedGrRows.find(r => r.purchase_order_id === poId)!.po_discount_amount) || 0
        if (poDiscount <= 0) return sum
        const taken = (discountTaken.get(tenantId, poId, `%"${poId}"%`) as any).s as number
        return sum + Math.max(0, poDiscount - taken)
      }, 0)

  // งวดปิดบัญชี — กติกาเดียวกับ updatePurchaseInvoice (ห้ามลง journal ย้อนเข้างวดที่ปิดแล้ว)
  const finalInvoiceDate = invoiceDate || new Date().toISOString()
  const closedLabel = closedPeriodLabel(tenantId, finalInvoiceDate)
  if (closedLabel) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${closedLabel} ปิดแล้ว บันทึกใบแจ้งหนี้วันที่นี้ไม่ได้`)

  // กันเลขบิล/ใบกำกับภาษีผู้ขายซ้ำในผู้ขายรายเดียวกัน (เฉพาะใบที่ยังไม่ยกเลิก)
  const cleanSupInv = supplierInvoiceNumber?.trim()
  if (cleanSupInv) {
    const dupPi = db.prepare(`
      SELECT pi_number FROM purchase_invoices
      WHERE tenant_id = ? AND supplier_id = ? AND status != 'CANCELLED'
        AND LOWER(TRIM(supplier_invoice_number)) = LOWER(?)
      LIMIT 1
    `).get(tenantId, baseSupplierId, cleanSupInv) as { pi_number: string } | undefined
    if (dupPi) {
      throw new PurchaseBillingError(
        'DUPLICATE_SUPPLIER_INVOICE',
        `เลขที่ใบแจ้งหนี้/ใบกำกับภาษีผู้ขาย "${cleanSupInv}" ซ้ำกับใบแจ้งหนี้ซื้อ ${dupPi.pi_number} ของผู้ขายรายนี้`
      )
    }
  }

  // Resolve บัญชีปลายทาง + คำนวณยอด — ทำนอก transaction (auto-create บัญชีในผังบัญชีถ้ายังไม่มี)
  const posCashMovementId = payload.posCashMovementId || null
  const totals = calcPurchaseInvoiceTotals(tenantId, subtotalRaw, taxRate, discountAmount, inclusive, drAccountId, posCashMovementId ? null : crAccountId, skipBuckets)
  const posCashLabel = posCashMovementId ? applyPosCashCredit(tenantId, posCashMovementId, totals) : null

  // Auto-settle: ผู้เรียกสั่ง (autoPay) หรือทุก PO ในใบติดธงจ่ายแล้ว — เงินจาก POS ปิดเป็นจ่ายแล้วตั้งแต่สร้าง ไม่ต้องจ่ายซ้ำ
  const allPos = allPoIds.map(poId => db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(poId, tenantId) as any)
  const primaryPo = allPos[0]
  const allPosPaid = allPos.every(po => po?.is_paid === 1)
  const shouldAutoPay = !posCashMovementId && (payload.autoPay !== undefined ? !!payload.autoPay : allPosPaid)

  // ── ตรวจครบทุกอย่างมาถึงตรงนี้แล้ว — เพิ่งเบิร์นเลขที่เอกสาร ไม่งั้น request ที่ถูกปฏิเสธจะกินเลขไปเปล่า ๆ ──
  const id = generateId()
  // เลขที่ตามวันที่ใบแจ้งหนี้ (บิลย้อนหลังได้เลขของวันบนบิล) ไม่ใช่วันที่กดสร้าง
  const piNumber = formatDocumentNumber('PI', tenantId, 'PURCHASE_INVOICE', docYear(finalInvoiceDate), 5, finalInvoiceDate)
  const now = new Date().toISOString()
  let paymentResult: any = null

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_invoice_number, purchase_order_id,
        supplier_id, goods_receipt_id, goods_receipt_ids, purchase_order_ids, invoice_date, due_date, subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive,
        paid_amount, balance_amount, status, payment_status, pos_cash_movement_id, notes, created_at, updated_at, dr_account_id, cr_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, piNumber, supplierInvoiceNumber || '', purchaseOrderId, baseSupplierId,
      grIds[0], JSON.stringify(grIds), JSON.stringify(allPoIds), finalInvoiceDate, dueDate || null,
      totals.subtotal, totals.discount, taxRate, totals.taxAmount, totals.totalAmount, inclusive ? 1 : 0,
      // เงินจาก POS = จ่ายไปแล้วตั้งแต่เงินออกจากลิ้นชัก ใบปิดเป็นจ่ายแล้วทันที
      posCashMovementId ? totals.totalAmount : 0, posCashMovementId ? 0 : totals.totalAmount,
      posCashMovementId ? 'PAID' : 'UNPAID', posCashMovementId, notes || '', now, now,
      totals.resolvedDrAccId, totals.payableAccId)

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
      supplierName: supplier?.name, supplierTaxId: supplier?.tax_id, creditLabel: posCashLabel || undefined,
    })

    // จ่ายใน transaction เดียวกัน — จ่ายไม่ผ่านต้องแจ้ง error และไม่ออกใบค้างครึ่งทาง (เดิมกลืน error เงียบ)
    // PO ติดธงจ่ายแล้ว: จ่ายเท่าที่ PO จ่ายจริง (poPaymentTarget รองรับจ่ายบางส่วน) ไม่ใช่เต็มใบเสมอ
    if (shouldAutoPay) {
      const cap = allPosPaid ? allPos.reduce((s, po) => s + poPaymentTarget(tenantId, po).remaining, 0) : Infinity
      const amount = Math.round(Math.min(totals.totalAmount, cap) * 100) / 100
      if (amount > 0.005) {
        paymentResult = paySupplier(tenantId, actorEmail, {
          supplierId: baseSupplierId,
          purchaseInvoiceId: id,
          paymentDate: finalInvoiceDate,
          paymentMethod: payload.paymentMethod || primaryPo?.payment_method || 'TRANSFER',
          paymentReference: payload.paymentReference || primaryPo?.payment_reference || '',
          bankAccountId: payload.bankAccountId || primaryPo?.bank_account_id || null,
          amount,
          notes: `[Auto-Settle from ${primaryPo?.po_number || ''}] ${notes || ''}`.trim(),
        })
      }
    }
  })

  transaction()

  // จำโหมด VAT ของใบนี้ไว้กับผู้ขายรายนี้ — ใบแจ้งหนี้ซื้อถัดไปจะ default ให้ถูกโดยไม่ต้องเลือกใหม่
  rememberContactVatMode(tenantId, 'supplier', baseSupplierId, taxRate, inclusive)

  const invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any

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
    const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(dateStr).getFullYear(), 5, dateStr)

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
  /** ต้องตรงกับโหมดของ PO — ไม่ตรงปฏิเสธ (ยอด GR/2109 ตั้งตามโหมดของ PO ไปแล้ว) */
  vatInclusive?: boolean | number | null
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
    || (payload.vatInclusive !== undefined && payload.vatInclusive !== null)

  // งวดปิดบัญชี: เช็คทั้งวันที่เดิมของใบ (แก้ใบเก่าที่อยู่ในงวดปิดไม่ได้เลย) และวันที่ใหม่ถ้าเปลี่ยน
  const oldClosed = closedPeriodLabel(tenantId, pi.invoice_date)
  if (oldClosed) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${oldClosed} ปิดแล้ว แก้ไขใบแจ้งหนี้นี้ไม่ได้`)
  const newInvoiceDate = payload.invoiceDate || pi.invoice_date
  if (hasFinancialChange) {
    const newClosed = closedPeriodLabel(tenantId, newInvoiceDate)
    if (newClosed) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${newClosed} ปิดแล้ว บันทึกวันที่นี้ไม่ได้`)
  }

  const cleanSupInv = payload.supplierInvoiceNumber?.trim()
  if (cleanSupInv) {
    const dupPi = db.prepare(`
      SELECT pi_number FROM purchase_invoices
      WHERE tenant_id = ? AND supplier_id = ? AND status != 'CANCELLED'
        AND id != ? AND LOWER(TRIM(supplier_invoice_number)) = LOWER(?)
      LIMIT 1
    `).get(tenantId, pi.supplier_id, id, cleanSupInv) as { pi_number: string } | undefined
    if (dupPi) {
      throw new PurchaseBillingError(
        'DUPLICATE_SUPPLIER_INVOICE',
        `เลขที่ใบแจ้งหนี้/ใบกำกับภาษีผู้ขาย "${cleanSupInv}" ซ้ำกับใบแจ้งหนี้ซื้อ ${dupPi.pi_number} ของผู้ขายรายนี้`
      )
    }
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
  // join poi.skip_stock/expense_account_id เพื่อแยกส่วนไม่นับสต็อกให้ตรงกับตอนสร้าง
  // (purchase_invoice_items ไม่มี 2 คอลัมน์นี้เอง)
  const existingItems = db.prepare(`
    SELECT pii.*, COALESCE(poi.skip_stock, 0) as skipStock, poi.expense_account_id as expenseAccountId
    FROM purchase_invoice_items pii
    LEFT JOIN purchase_order_items poi ON poi.id = pii.purchase_order_item_id
    WHERE pii.purchase_invoice_id = ?
  `).all(id) as any[]
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
      skipStock: e.skipStock,
      expenseAccountId: e.expenseAccountId,
    }
  })
  const subtotalRaw = newItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
  const skipBuckets = buildSkipBuckets(newItems)

  const taxRate = payload.taxRate != null ? Number(payload.taxRate) : pi.tax_rate
  const discountAmount = payload.discountAmount != null ? Number(payload.discountAmount) : pi.discount_amount
  let inclusive = pi.vat_inclusive === 1
  if (payload.vatInclusive !== undefined && payload.vatInclusive !== null) {
    const want = payload.vatInclusive === true || payload.vatInclusive === 1
    const poInclusive = (db.prepare('SELECT vat_inclusive FROM purchase_orders WHERE id = ? AND tenant_id = ?')
      .get(pi.purchase_order_id, tenantId) as any)?.vat_inclusive === 1
    if (want !== poInclusive) {
      throw new PurchaseBillingError('VAT_MODE_MISMATCH', `โหมด VAT ต้องตรงกับใบสั่งซื้อ (${poInclusive ? 'ราคารวม VAT' : 'VAT แยก'}) — แก้ที่ใบสั่งซื้อแล้วออกใบแจ้งหนี้ใหม่`)
    }
    inclusive = want
  }
  // ไม่ส่งมา = ใช้บัญชีที่ใบนี้ลงไว้ (เดิมเด้งกลับเป็น 1107/2101 ทุกครั้งที่แก้ยอด)
  const drAccountId = payload.drAccountId !== undefined ? payload.drAccountId : pi.dr_account_id
  const crAccountId = payload.crAccountId !== undefined ? payload.crAccountId : pi.cr_account_id

  // ใบที่จับคู่เงินจาก POS ไว้: ฝั่ง Cr คง 1182 ตลอด (เปลี่ยนบัญชีปลายทางไม่ได้) และยอดจ่ายเดินตามยอดใบ
  const posCashMovementId: string | null = pi.pos_cash_movement_id || null
  const totals = calcPurchaseInvoiceTotals(tenantId, subtotalRaw, taxRate, discountAmount, inclusive, drAccountId, posCashMovementId ? null : crAccountId, skipBuckets)
  const posCashLabel = posCashMovementId ? applyPosCashCredit(tenantId, posCashMovementId, totals, pi.id) : null

  // จ่ายเงินไปแล้ว: ใบจ่ายเงิน Dr บัญชีหนี้เดิมไปแล้ว ย้ายบัญชีหนี้ตอนนี้ = บัญชีเดิมค้าง บัญชีใหม่ไม่มีวันปิด
  const oldCrAccId = pi.cr_account_id || getOrCreateAccount(tenantId, ACC.AP)
  if (!posCashMovementId && (pi.paid_amount || 0) > 0.005 && totals.payableAccId !== oldCrAccId) {
    throw new PurchaseBillingError('CR_ACCOUNT_INVALID', 'ใบนี้จ่ายเงินไปแล้ว เปลี่ยนบัญชีปลายทางของหนี้ไม่ได้ — ยกเลิกการจ่ายเงินก่อน')
  }

  if (!posCashMovementId && totals.totalAmount < (pi.paid_amount || 0) - 0.005) {
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

    const paidAmount = posCashMovementId ? totals.totalAmount : (pi.paid_amount || 0)
    const newBalance = Math.round((totals.totalAmount - paidAmount) * 100) / 100
    const newPaymentStatus = newBalance <= 0.005 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
    db.prepare(`
      UPDATE purchase_invoices SET supplier_invoice_number = COALESCE(?, supplier_invoice_number),
        due_date = COALESCE(?, due_date), notes = COALESCE(?, notes),
        invoice_date = ?, tax_rate = ?, discount_amount = ?, subtotal = ?, tax_amount = ?, total_amount = ?,
        paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?,
        vat_inclusive = ?, dr_account_id = ?, cr_account_id = ?
      WHERE id = ? AND tenant_id = ?
    `).run(payload.supplierInvoiceNumber ?? null, payload.dueDate ?? null, payload.notes ?? null,
      newInvoiceDate, taxRate, totals.discount, totals.subtotal, totals.taxAmount, totals.totalAmount,
      paidAmount, newBalance, newPaymentStatus, now, inclusive ? 1 : 0, totals.resolvedDrAccId, totals.payableAccId, id, tenantId)

    postPurchaseInvoiceJournal(tenantId, actorEmail, {
      piId: id, piNumber: pi.pi_number, invoiceDate: newInvoiceDate, notes: payload.notes ?? pi.notes,
      grIds, totals, taxRate, supplierName: supplier?.name, supplierTaxId: supplier?.tax_id,
      creditLabel: posCashLabel || undefined,
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

/** 'CASH' (REST) หรือข้อความที่มีคำว่า "เงินสด" (บิลที่ AI อ่านผ่าน MCP) */
export function isCashMethod(method?: string | null): boolean {
  return /^cash$|เงินสด/i.test(String(method || '').trim())
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
  /** วิธีจ่าย POS_CASH — รายการเงินออกจากลิ้นชัก (pos_shift_cash_movements บัญชี 1182) ที่บิลนี้จับคู่ */
  posCashMovementId?: string | null
}

/** วิธีจ่าย "เงินจาก POS" — เงินออกจากลิ้นชักไปก่อนแล้ว ใบจ่ายนี้แค่จับคู่บิลเข้ากับรายการนั้น */
export const POS_CASH_METHOD = 'POS_CASH'

export interface PosCashUnmatched {
  id: string
  type: string
  amount: number
  remaining: number
  reason: string | null
  created_at: string
  shift_number: string | null
  created_by_name: string | null
}

/**
 * เงินออกจากลิ้นชัก POS ที่ยังไม่ได้จับคู่บิลครบ (ลงบัญชี 1182 ไว้)
 * ยอดคงเหลือ = ยอดที่เอาออก − ผลรวมใบจ่ายเงินผู้ขายที่ผูกไว้และยังไม่ถูกยกเลิก
 * ส่ง movementId มาเพื่อดูรายการเดียว (รวมที่จับคู่ครบแล้วด้วย)
 */
export function listPosCashUnmatched(tenantId: string, movementId?: string, opts: { excludeInvoiceId?: string } = {}): PosCashUnmatched[] {
  // จับคู่ได้สองทาง: ใบแจ้งหนี้ที่ฝั่ง Cr เลือกเงินจาก POS (ทางหลัก) หรือใบจ่ายเงินวิธี POS_CASH
  // excludeInvoiceId = ใบที่กำลังแก้ไข ไม่นับยอดของตัวเองซ้ำตอนตรวจว่าพอจับคู่ไหม
  const rows = db.prepare(`
    SELECT m.id, m.type, m.amount, m.reason, m.created_at, s.shift_number, u.name AS created_by_name,
      ROUND(m.amount - COALESCE((
        SELECT SUM(sp.net_amount) FROM supplier_payments sp
        WHERE sp.tenant_id = m.tenant_id AND sp.pos_cash_movement_id = m.id
          AND (sp.status IS NULL OR sp.status != 'CANCELLED')
      ), 0) - COALESCE((
        SELECT SUM(pi.total_amount) FROM purchase_invoices pi
        WHERE pi.tenant_id = m.tenant_id AND pi.pos_cash_movement_id = m.id
          AND pi.status != 'CANCELLED' AND pi.id != ?
      ), 0), 2) AS remaining
    FROM pos_shift_cash_movements m
    JOIN accounts a ON a.id = m.account_id AND a.code = ?
    LEFT JOIN pos_shifts s ON s.id = m.shift_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.tenant_id = ? AND m.type IN ('PAID_OUT', 'OPENING_GAP') ${movementId ? 'AND m.id = ?' : ''}
    ORDER BY m.created_at
  `).all(...[opts.excludeInvoiceId || '', ACC.POS_PAYOUT_PENDING, tenantId, ...(movementId ? [movementId] : [])]) as PosCashUnmatched[]
  return movementId ? rows : rows.filter(r => r.remaining > 0.005)
}

/**
 * บันทึกจ่ายเงินผู้ขาย (รองรับจ่ายบางส่วน + ภาษีหัก ณ ที่จ่าย) ลง journal
 * Dr เจ้าหนี้การค้า = Cr เงินสด/ธนาคาร + Cr ภาษีหัก ณ ที่จ่าย (ถ้ามี)
 */
export function paySupplier(tenantId: string, actorEmail: string, payload: PaySupplierPayload) {
  const { supplierId, purchaseInvoiceId, paymentDate, paymentMethod, paymentReference, notes } = payload
  const r2 = (n: number) => Math.round(n * 100) / 100
  // ยอดเงินมาจาก client — ปัดสตางค์ และต้องเป็นบวก (เดิม amount ติดลบผ่าน !amount ไปลดยอดจ่ายของใบได้)
  const amount = r2(Number(payload.amount))
  const wht = r2(Number(payload.withholdingTax) || 0)
  const isPosCash = paymentMethod === POS_CASH_METHOD
  // เงินจาก POS ไม่ได้ออกจากบัญชีธนาคาร — ไม่สนใจ bankAccountId ที่ติดมาจากฟอร์ม
  const bankAccountId = isPosCash ? null : payload.bankAccountId
  const posCashMovementId = isPosCash ? (payload.posCashMovementId || null) : null
  if (!supplierId) throw new PurchaseBillingError('SUPPLIER_REQUIRED', 'Supplier and amount are required')
  if (!(amount > 0)) throw new PurchaseBillingError('AMOUNT_REQUIRED', 'ยอดจ่ายต้องมากกว่า 0')
  if (!(wht >= 0 && wht < amount)) throw new PurchaseBillingError('WHT_INVALID', 'ภาษีหัก ณ ที่จ่ายต้องไม่ติดลบ และน้อยกว่ายอดจ่าย')

  let invoice: any = null
  if (purchaseInvoiceId) {
    invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
    if (!invoice) throw new PurchaseBillingError('INVOICE_NOT_FOUND', 'Purchase invoice not found')
    // เดิมเช็คแค่ใน MCP tool — REST จ่ายใบที่ยกเลิกแล้วได้ ย้ายมาไว้ที่ service ให้ทุกทางเข้าโดนเหมือนกัน
    if (invoice.status === 'CANCELLED') throw new PurchaseBillingError('INVOICE_CANCELLED', 'ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว จ่ายเงินไม่ได้')
    // เผื่อเศษ float ครึ่งสตางค์ (เช่นยอดคงค้าง 180.38999999 แต่จ่าย 180.39)
    if (amount > (invoice.balance_amount || 0) + 0.005) throw new PurchaseBillingError('OVER_BALANCE', 'Payment amount exceeds invoice balance')
    if (invoice.supplier_id !== supplierId) throw new PurchaseBillingError('SUPPLIER_MISMATCH', 'ผู้ขายที่เลือกไม่ตรงกับผู้ขายของใบแจ้งหนี้นี้')
  } else if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND tenant_id = ?').get(supplierId, tenantId)) {
    throw new PurchaseBillingError('SUPPLIER_MISMATCH', 'ไม่พบผู้ขายนี้ในกิจการ')
  }

  // งวดปิดบัญชี — กติกาเดียวกับ updatePurchaseInvoice
  const closedLabel = closedPeriodLabel(tenantId, paymentDate || new Date().toISOString())
  if (closedLabel) throw new PurchaseBillingError('PERIOD_CLOSED', `งวด ${closedLabel} ปิดแล้ว บันทึกการจ่ายเงินวันที่นี้ไม่ได้`)

  let posCashAccId: string | null = null
  if (isPosCash) {
    if (!posCashMovementId) throw new PurchaseBillingError('POS_CASH_REQUIRED', 'เลือกรายการเงินออกจาก POS ที่จะจับคู่กับบิลนี้ก่อน')
    const mv = listPosCashUnmatched(tenantId, posCashMovementId)[0]
    if (!mv) throw new PurchaseBillingError('POS_CASH_NOT_FOUND', 'ไม่พบรายการเงินออกจาก POS ที่เลือก')
    if (amount - wht > mv.remaining + 0.005) {
      throw new PurchaseBillingError('POS_CASH_OVER', `รายการเงินออกจาก POS นี้เหลือให้จับคู่ ฿${mv.remaining.toLocaleString()} แต่จะจ่าย ฿${(amount - wht).toLocaleString()}`)
    }
    posCashAccId = getOrCreateAccount(tenantId, ACC.POS_PAYOUT_PENDING)
  }

  const id = generateId()
  // prefix 'SP' ใช้เฉพาะตอนยังไม่เปิดรูปแบบใน Settings (ถ้าเปิด จะใช้ prefix ที่ตั้งไว้ เช่น PAY)
  const paymentNumber = formatDocumentNumber('SP', tenantId, 'SUPPLIER_PAYMENT', docYear(paymentDate), 5, paymentDate)
  const now = new Date().toISOString()
  const netAmount = r2(amount - wht)

  // Resolve accounts before transaction
  // Dr บัญชีหนี้ที่ใบแจ้งหนี้ลงไว้ (เลือกบัญชีหนี้สินอื่นได้ตอนออกใบ) — ไม่มี/ใบเก่า = เจ้าหนี้การค้า
  const invoiceCrAccId = invoice?.cr_account_id
    ? (db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(invoice.cr_account_id, tenantId) as any)?.id
    : null
  const payableAccId = invoiceCrAccId || getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
  // Dr/Cr บัญชีธนาคารที่เลือกโดยตรงถ้ามี ไม่งั้น fallback ตาม paymentMethod (CASH -> 1101, อื่นๆ -> 1102)
  const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId)
  // MCP เก็บวิธีจ่ายเป็นข้อความไทยจากบิล ("เงินสด") — เดิมเทียบแค่ === 'CASH' บิลเงินสดเลยไปลงธนาคาร
  const cashCode = isCashMethod(paymentMethod) ? ACC.CASH : ACC.BANK
  // เงินจาก POS: เงินสดถูกตัดไปแล้วตอนเอาออกจากลิ้นชัก (Dr 1182 / Cr เงินสด) ขานี้จึงปิด 1182 แทนเงินสด
  const cashAccId = posCashAccId || linkedAccountId || getOrCreateAccount(
    tenantId, cashCode, ACC_META[cashCode]!.name, ACC_META[cashCode]!.type, ACC_META[cashCode]!.category, ACC_META[cashCode]!.normalBalance
  )
  const whtAccId = wht > 0 ? getOrCreateAccount(tenantId, ACC.WHT_PAYABLE, ACC_META[ACC.WHT_PAYABLE]!.name, ACC_META[ACC.WHT_PAYABLE]!.type, ACC_META[ACC.WHT_PAYABLE]!.category, ACC_META[ACC.WHT_PAYABLE]!.normalBalance) : null

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
        payment_date, payment_method, payment_reference, amount, withholding_tax, net_amount, notes, bank_account_id, pos_cash_movement_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, paymentNumber, supplierId, purchaseInvoiceId || null, paymentDate || now,
      paymentMethod || 'TRANSFER', paymentReference || '', amount, wht, netAmount, notes || '', bankAccountId || null, posCashMovementId, now, now)

    if (invoice) {
      const newPaid = r2((invoice.paid_amount || 0) + amount)
      const newBalance = Math.max(0, r2(invoice.total_amount - newPaid))
      const newPaymentStatus = newBalance <= 0.005 ? 'PAID' : 'PARTIAL'

      db.prepare(`
        UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, newPaymentStatus, now, purchaseInvoiceId, tenantId)
    }

    // Dr บัญชีหนี้ = Cr เงินสด/ธนาคาร/1182 + Cr ภาษีหัก ณ ที่จ่าย (2105) — postJournal ตรวจดุลให้
    postJournal({
      tenantId, date: (paymentDate || now).substring(0, 10), referenceType: 'SUPPLIER_PAYMENT', referenceId: id,
      description: `จ่ายชำระ ${paymentNumber}`, createdBy: actorEmail, notes: notes || null,
      lines: [
        { accountId: payableAccId, description: `เจ้าหนี้การค้า - ${paymentNumber}`, debit: amount },
        { accountId: cashAccId, description: `จ่ายเงิน - ${paymentNumber}`, credit: netAmount },
        ...(whtAccId && wht > 0 ? [{ accountId: whtAccId, description: `ภาษีหัก ณ ที่จ่าย - ${paymentNumber}`, credit: wht }] : []),
      ],
    })
  })

  transaction()

  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const updatedInvoice = purchaseInvoiceId
    ? db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
    : null
  return { ...payment, invoice: updatedInvoice }
}
