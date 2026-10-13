import db from '../db/sqlite'
import { postJournal, isVatRegistered } from './accounting.service'
import { reverseJournalEntryForReference } from '../routes/purchase.routes'
import { closedPeriodLabel } from '../routes/journal.routes'
import { ACC, ACC_META } from '../config/accountCodes'
import { calcVat, VAT_RATE } from '../utils/vat'
import { PlatformMonthError, getMonthStatus, type IncomePayload, type BalancePayload } from './platformMonth.service'
import { resolveFeeMapping } from './platformSettlement.service'
import type { CogsLine } from './platformMonthSale.service'

// ============================================================
// เฟส 3: ลงบัญชีรอบเดือนแพลตฟอร์ม — เชื่อม Phase 1 (income/balance) + Phase 2 (cogs_amount/cogs_breakdown)
// เข้า GL จริงผ่าน postJournal() ประตูเดียวเดิม (accounting.service.ts)
//
// JV ต่อรอบ (ข้ามได้ถ้าไม่มีรายการ): ขาย / ต้นทุนขาย / ค่าธรรมเนียม / ปรับปรุง / ถอนเงิน (1 ใบ/ครั้ง)
// + ยอดยกมา (เดือนแรกที่ลงบัญชีของร้านนี้เท่านั้น) ทุกใบพักที่ 1181 (ลูกหนี้การค้า-แพลตฟอร์ม)
// โอนเงินเข้าแล้วเท่าไร 1181 ต้องลดลงเท่านั้น
//
// ไม่ลงหัก ณ ที่จ่าย — Shopee เป็นผู้หักค่าธรรมเนียมเองจากยอดขายในกระเป๋า (ไม่ใช่ร้านจ่ายเงินให้ Shopee
// โดยตรงที่จะต้องหัก ณ ที่จ่าย) ไม่มีอะไรให้ร้านหักส่งสรรพากรในธุรกรรมกลุ่มนี้
// ไม่ลงเงินเติม Ads จากภายนอก (ads_topup_from_escrow คือเติมจากยอดขายในกระเป๋าเอง ไม่ใช่โอนเงินจาก
// บริษัทมาเติม — เงินเติม Ads จากธนาคารจริงไปลงทางใบซื้อ/ค่าใช้จ่ายปกติ)
// ============================================================

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const abs2 = (n: number) => Math.abs(r2(n))

export interface PlanLine {
  code: string
  description: string
  debit: number
  credit: number
  /** ชื่อบัญชีจริงของ tenant — ใส่ให้เฉพาะตอน preview (ดู withAccountNames) ไม่ใช้ตอน post */
  name?: string
}

export interface JournalPlan {
  referenceType: string
  referenceId?: string
  description: string
  date: string
  lines: PlanLine[]
  totalDebit: number
  totalCredit: number
}

function ln(code: string, description: string, debit: number, credit: number): PlanLine {
  return { code, description, debit: r2(debit), credit: r2(credit) }
}

function mkPlan(referenceType: string, description: string, date: string, lines: PlanLine[], referenceId?: string): JournalPlan {
  return {
    referenceType,
    referenceId,
    description,
    date,
    lines,
    totalDebit: r2(lines.reduce((s, l) => s + l.debit, 0)),
    totalCredit: r2(lines.reduce((s, l) => s + l.credit, 0)),
  }
}

/** แยกยอดรวม VAT ออกเป็นก่อนภาษี + ภาษีซื้อ/ขาย — ใช้สูตรกลางเดียวกับทุกเอกสาร (utils/vat.ts calcVat) */
function splitVat(amount: number): { ex: number; vat: number } {
  const { subtotal, taxAmount } = calcVat(amount, { rate: VAT_RATE, inclusive: true, roundTax: 'satang' })
  return { ex: subtotal, vat: taxAmount }
}

function getMonthRow(tenantId: string, monthId: string): any {
  const row = db.prepare(`SELECT * FROM platform_months WHERE id = ? AND tenant_id = ?`).get(monthId, tenantId) as any
  if (!row) throw new PlatformMonthError('ไม่พบรอบเดือนนี้')
  return row
}

const FEE_LABELS: Record<string, string> = {
  COMMISSION: 'ค่าคอมมิชชั่น',
  SERVICE: 'ค่าบริการแพลตฟอร์ม',
  TRANSACTION: 'ค่าธรรมเนียมการทำรายการ',
  INFRASTRUCTURE: 'ค่าโครงสร้างพื้นฐาน',
  AFFILIATE: 'ค่าคอมมิชชั่นนักการตลาด/affiliate (AMS)',
  ADS: 'ค่าโฆษณา (เติมเงินจากยอดขายในกระเป๋า)',
  OTHER: 'ค่าธรรมเนียมอื่น',
  SHIPPING: 'ค่าขนส่ง (ฝั่งถูกเรียกเก็บ/ของคืน)',
  SHIPPING_REVENUE: 'รายได้ค่าขนส่งที่เรียกเก็บจากผู้ซื้อ',
  SHIPPING_SUBSIDY: 'รายได้เงินอุดหนุนค่าขนส่งจาก Shopee',
}

const FEE_FIELDS: Array<{ key: keyof IncomePayload; feeType: string }> = [
  { key: 'commission', feeType: 'COMMISSION' },
  { key: 'service_fee', feeType: 'SERVICE' },
  { key: 'transaction_fee', feeType: 'TRANSACTION' },
  { key: 'infrastructure_fee', feeType: 'INFRASTRUCTURE' },
  { key: 'ams_commission', feeType: 'AFFILIATE' },
  { key: 'ads_topup_from_escrow', feeType: 'ADS' },
  { key: 'other_fees', feeType: 'OTHER' },
]

// ── JV ขาย ───────────────────────────────────────────────────────────────────
function buildSalesPlan(month: any, income: IncomePayload, vatOn: boolean, dateStr: string): JournalPlan {
  const totalIncome = r2(income.total_income)
  const sellerDiscount = abs2(income.seller_discount)
  const refundToBuyer = abs2(income.refund_to_buyer)

  const lines: PlanLine[] = [ln(ACC.PLATFORM_CLEARING, 'ลูกหนี้การค้า-แพลตฟอร์ม (ยอดเต็ม)', totalIncome, 0)]

  if (vatOn) {
    const discEx = splitVat(sellerDiscount).ex
    const refundEx = splitVat(refundToBuyer).ex
    const outputVat = splitVat(totalIncome).vat
    lines.push(ln(ACC.SALES_DISCOUNT, 'ส่วนลดผู้ขายร่วมจ่าย (ไม่รวม VAT)', discEx, 0))
    lines.push(ln(ACC.SALES_RETURN, 'คืนเงินให้ผู้ซื้อ (ไม่รวม VAT)', refundEx, 0))
    lines.push(ln(ACC.OUTPUT_VAT, 'ภาษีขาย', 0, outputVat))
    // บรรทัดรายได้ = เศษที่ทำให้ดุล (เศษปัดจาก VAT ที่แยกทีละยอดอิสระ) — ตามกติกาเฟส 3
    const drTotal = r2(totalIncome + discEx + refundEx)
    const revenueLine = r2(drTotal - outputVat)
    lines.push(ln(ACC.REVENUE_PRODUCT, 'รายได้ขายสินค้า (ไม่รวม VAT)', 0, revenueLine))
  } else {
    lines.push(ln(ACC.SALES_DISCOUNT, 'ส่วนลดผู้ขายร่วมจ่าย', sellerDiscount, 0))
    lines.push(ln(ACC.SALES_RETURN, 'คืนเงินให้ผู้ซื้อ', refundToBuyer, 0))
    const drTotal = r2(totalIncome + sellerDiscount + refundToBuyer)
    lines.push(ln(ACC.REVENUE_PRODUCT, 'รายได้ขายสินค้า', 0, drTotal))
  }

  return mkPlan('PLATFORM_MONTH_SALES', `ขายผ่าน ${month.platform} รอบ ${month.month}`, dateStr, lines)
}

// ── JV ต้นทุนขาย — จากเฟส 2 (cogs_amount/cogs_breakdown ที่ confirmSale เก็บไว้แล้ว) ──────────
function buildCogsPlan(month: any, dateStr: string): JournalPlan | null {
  const cogsAmount = r2(month.cogs_amount)
  if (!(cogsAmount > 0)) return null

  let breakdown: CogsLine[] = []
  try { breakdown = JSON.parse(month.cogs_breakdown || '[]') } catch { breakdown = [] }

  const grouped = new Map<string, number>()
  for (const b of breakdown) grouped.set(b.inventoryAccount, r2((grouped.get(b.inventoryAccount) || 0) + b.amount))

  const lines: PlanLine[] = [ln(ACC.COGS_PRODUCT, 'ต้นทุนสินค้าขาย', cogsAmount, 0)]
  for (const [code, amt] of grouped) lines.push(ln(code, 'ตัดสต็อกจากยืนยันการขาย', 0, amt))

  return mkPlan('PLATFORM_MONTH_COGS', `ต้นทุนขายผ่าน ${month.platform} รอบ ${month.month}`, dateStr, lines)
}

// ── JV ค่าธรรมเนียม (ไม่รวมค่าขนส่ง — แยกไปอยู่ JV ของตัวเอง ดู buildShippingPlan) ──────────
function buildFeesPlan(tenantId: string, month: any, income: IncomePayload, vatOn: boolean, dateStr: string): JournalPlan | null {
  const lines: PlanLine[] = []
  let debitTotal = 0

  const addFeeLine = (feeType: string, amount: number) => {
    if (amount <= 0) return
    const { accountCode, claimable } = resolveFeeMapping(tenantId, feeType)
    if (vatOn && claimable) {
      const { ex, vat } = splitVat(amount)
      lines.push(ln(accountCode, FEE_LABELS[feeType] || feeType, ex, 0))
      lines.push(ln(ACC.INPUT_VAT, `ภาษีซื้อ (${FEE_LABELS[feeType] || feeType})`, vat, 0))
      debitTotal = r2(debitTotal + ex + vat)
    } else {
      lines.push(ln(accountCode, FEE_LABELS[feeType] || feeType, amount, 0))
      debitTotal = r2(debitTotal + amount)
    }
  }

  for (const f of FEE_FIELDS) addFeeLine(f.feeType, abs2((income as any)[f.key] || 0))
  if (lines.length === 0) return null

  // ยอด "ควรหักจาก 1181" ของ JV นี้ = total_expense หักส่วนที่ไปลงใน JV ค่าขนส่งแล้ว (shippingNet)
  // เงื่อนไขตรวจ: feesJV + shippingNet ≈ |total_expense| (เจ้าของยืนยัน 2026-10-13 ให้แยก JV ขนส่งออกไป)
  const shippingNet = r2(
    abs2(income.shipping_charged + income.shipping_return) - r2(income.shipping_buyer_paid + income.shipping_shopee_subsidy)
  )
  const expectedExpense = abs2(income.total_expense)
  if (Math.abs(debitTotal + shippingNet - expectedExpense) > 1) {
    throw new PlatformMonthError(
      `ลงบัญชีค่าธรรมเนียมไม่ได้: ค่าธรรมเนียม ${debitTotal} + ค่าขนส่งสุทธิ ${shippingNet} ไม่ตรงกับ total_expense ของไฟล์ income (${expectedExpense})`
    )
  }

  lines.push(ln(ACC.PLATFORM_CLEARING, 'หักจากลูกหนี้การค้า-แพลตฟอร์ม', 0, debitTotal))
  return mkPlan('PLATFORM_MONTH_FEES', `ค่าธรรมเนียม ${month.platform} รอบ ${month.month}`, dateStr, lines)
}

// ── JV ค่าขนส่ง — เงินก้อนนี้ไม่ผ่านบัญชีธนาคารร้านเลย เข้า/ออกอยู่ในกระเป๋า Shopee (1181) ล้วน ๆ
// เจ้าของขอให้เห็นเป็น double entry ชัดเจนแยกจาก JV ค่าธรรมเนียม (2026-10-13) ────────────────
// ขารับ: ลูกค้าจ่ายค่าส่ง (shipping_buyer_paid) + Shopee ช่วยจ่ายแทนลูกค้า (shipping_shopee_subsidy)
//   → Dr 1181 (เงินเข้ากระเป๋า Shopee) / Cr 4203 ทั้งสองก้อน แยกภาษีขายเฉพาะก้อนที่ลูกค้าจ่ายเอง
//   (ม.79 ฐานภาษี = สิ่งที่ "ผู้ประกอบการเรียกเก็บจากผู้ซื้อ" เท่านั้น — เงินอุดหนุนจาก Shopee ไม่เข้าฐาน
//   ตามบทความ Prosoft iBiz ที่อ้าง iliketax) ปรับ flag ได้ที่หน้าตั้งค่าถ้านักบัญชีเห็นต่าง
// ขาจ่าย: Shopee หักค่าส่งที่เรียกเก็บจากร้าน + ของคืน ออกจากกระเป๋าแทนร้าน
//   → Dr 5202 ค่าขนส่ง / Cr 1181 (เงินออกจากกระเป๋า Shopee)
function buildShippingPlan(tenantId: string, month: any, income: IncomePayload, vatOn: boolean, dateStr: string): JournalPlan | null {
  const buyerPaid = r2(income.shipping_buyer_paid)
  const subsidy = r2(income.shipping_shopee_subsidy)
  const revenueGross = r2(buyerPaid + subsidy)
  const expenseGross = abs2(income.shipping_charged + income.shipping_return)
  if (revenueGross <= 0 && expenseGross <= 0) return null

  const lines: PlanLine[] = []

  if (revenueGross > 0) {
    lines.push(ln(ACC.PLATFORM_CLEARING, 'ค่าส่งที่ลูกค้าจ่าย + Shopee ช่วยจ่าย (เข้ากระเป๋า Shopee)', revenueGross, 0))
    if (buyerPaid > 0) {
      const { accountCode, claimable: hasOutputVat } = resolveFeeMapping(tenantId, 'SHIPPING_REVENUE')
      if (vatOn && hasOutputVat) {
        const { ex, vat } = splitVat(buyerPaid)
        lines.push(ln(accountCode, 'รายได้ค่าขนส่งที่เรียกเก็บจากผู้ซื้อ (ผ่านกระเป๋า Shopee)', 0, ex))
        lines.push(ln(ACC.OUTPUT_VAT, 'ภาษีขาย (ค่าขนส่งที่เรียกเก็บจากผู้ซื้อ)', 0, vat))
      } else {
        lines.push(ln(accountCode, 'รายได้ค่าขนส่งที่เรียกเก็บจากผู้ซื้อ (ผ่านกระเป๋า Shopee)', 0, buyerPaid))
      }
    }
    if (subsidy > 0) {
      const { accountCode, claimable: hasOutputVat } = resolveFeeMapping(tenantId, 'SHIPPING_SUBSIDY')
      if (vatOn && hasOutputVat) {
        const { ex, vat } = splitVat(subsidy)
        lines.push(ln(accountCode, 'Shopee ช่วยจ่ายค่าขนส่งแทนลูกค้า (ผ่านกระเป๋า Shopee)', 0, ex))
        lines.push(ln(ACC.OUTPUT_VAT, 'ภาษีขาย (เงินอุดหนุนค่าขนส่งจาก Shopee)', 0, vat))
      } else {
        lines.push(ln(accountCode, 'Shopee ช่วยจ่ายค่าขนส่งแทนลูกค้า (ผ่านกระเป๋า Shopee)', 0, subsidy))
      }
    }
  }

  if (expenseGross > 0) {
    const { accountCode, claimable } = resolveFeeMapping(tenantId, 'SHIPPING')
    if (vatOn && claimable) {
      const { ex, vat } = splitVat(expenseGross)
      lines.push(ln(accountCode, 'Shopee จ่ายค่าขนส่งแทนร้าน (หักจากกระเป๋า Shopee)', ex, 0))
      lines.push(ln(ACC.INPUT_VAT, 'ภาษีซื้อ (ค่าขนส่ง)', vat, 0))
    } else {
      lines.push(ln(accountCode, 'Shopee จ่ายค่าขนส่งแทนร้าน (หักจากกระเป๋า Shopee)', expenseGross, 0))
    }
    lines.push(ln(ACC.PLATFORM_CLEARING, 'หักค่าขนส่งจากกระเป๋า Shopee', 0, expenseGross))
  }

  return mkPlan(
    'PLATFORM_MONTH_SHIPPING',
    `ค่าขนส่ง ${month.platform} รอบ ${month.month} (เงินไม่ผ่านบัญชีธนาคารร้าน — เข้า/ออกในกระเป๋า Shopee)`,
    dateStr,
    lines
  )
}

// ── JV ปรับปรุง — จาก income.adjustments (ชีต Adjustment ของไฟล์ income) ───────────────────
// ไม่แยก VAT ที่นี่ (เป็นเรื่องใบลดหนี้/เพิ่มหนี้ ให้ผู้ทำบัญชีจัดการเองถ้าจำเป็น)
function buildAdjustPlan(tenantId: string, month: any, income: IncomePayload, dateStr: string): JournalPlan | null {
  const adj = income.adjustments
  if (!adj || r2(adj.total) === 0) return null

  const lines: PlanLine[] = []
  const refund = abs2(adj.refund_after_complete || 0)
  if (refund > 0) lines.push(ln(ACC.SALES_RETURN, 'คืนเงินหลังจบรายการ (ปรับปรุง)', refund, 0))

  const marketing = abs2(adj.marketing || 0)
  if (marketing > 0) lines.push(ln(resolveFeeMapping(tenantId, 'AFFILIATE').accountCode, 'ค่าใช้จ่ายการตลาด (ปรับปรุง)', marketing, 0))

  const shippingClaim = abs2(adj.shipping_claim || 0)
  if (shippingClaim > 0) lines.push(ln(resolveFeeMapping(tenantId, 'SHIPPING').accountCode, 'เคลมค่าขนส่งคืน (ปรับปรุง ลดค่าใช้จ่าย)', 0, shippingClaim))

  const other = r2(adj.other || 0)
  if (other > 0) lines.push(ln(ACC.OTHER_EXPENSE, 'ปรับปรุงอื่น', other, 0))
  else if (other < 0) lines.push(ln(ACC.OTHER_EXPENSE, 'ปรับปรุงอื่น', 0, -other))

  if (lines.length === 0) return null

  const debitSum = r2(lines.reduce((s, l) => s + l.debit, 0))
  const creditSum = r2(lines.reduce((s, l) => s + l.credit, 0))
  const net = r2(debitSum - creditSum)
  if (net > 0) lines.push(ln(ACC.PLATFORM_CLEARING, 'ปรับปรุงยอดลูกหนี้การค้า-แพลตฟอร์ม', 0, net))
  else if (net < 0) lines.push(ln(ACC.PLATFORM_CLEARING, 'ปรับปรุงยอดลูกหนี้การค้า-แพลตฟอร์ม', -net, 0))

  return mkPlan('PLATFORM_MONTH_ADJUST', `ปรับปรุงรายรับ ${month.platform} รอบ ${month.month}`, dateStr, lines)
}

// ── JV ถอนเงิน — 1 ใบต่อครั้งที่แพลตฟอร์มโอนเข้าธนาคารจริง ──────────────────────────────────
function buildPayoutPlans(month: any, balance: BalancePayload): JournalPlan[] {
  const withdrawals = balance?.withdrawals || []
  return withdrawals.map((w, idx) => {
    const amt = abs2(w.amount)
    const lines: PlanLine[] = [
      ln(ACC.BANK, 'รับโอนจากแพลตฟอร์มเข้าธนาคาร', amt, 0),
      ln(ACC.PLATFORM_CLEARING, 'ปิดยอดลูกหนี้การค้า-แพลตฟอร์ม (ถอนเงิน)', 0, amt),
    ]
    // ponytail: referenceId ต้องแยกต่อครั้ง (ไม่ใช่ monthId เดียวกันทุกใบ) ไม่งั้น reverseJournalEntryForReference
    // (ซึ่งหาใบเดิมด้วย referenceType+referenceId คู่เดียว) จะเจอแค่ใบแรกแล้วไปซ้อนใบอื่น — W<index> กันชนกัน
    return mkPlan('PLATFORM_MONTH_PAYOUT', `แพลตฟอร์ม ${month.platform} โอนเงินเข้า ${w.date}`, w.date, lines, `${month.id}:W${idx}`)
  })
}

// ── JV ยอดยกมา — เฉพาะรอบแรกที่ลงบัญชีของร้านนี้เท่านั้น (เงินที่ Shopee เป็นหนี้ร้านอยู่ก่อนวันที่
// เริ่มใช้ระบบ ไม่มีเอกสารต้นทางอื่นมายัน 1181 จึงต้องลงเองครั้งเดียวตรงนี้) ────────────────────
function buildOpeningPlan(tenantId: string, month: any, balance: BalancePayload, dateStr: string): JournalPlan | null {
  const hasEarlierPosted = db.prepare(`
    SELECT 1 FROM platform_months WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND status = 'POSTED' AND month < ?
  `).get(tenantId, month.platform, month.shop_key, month.month)
  if (hasEarlierPosted) return null

  const opening = r2(balance.opening)
  if (!(opening > 0)) return null

  const lines: PlanLine[] = [
    ln(ACC.PLATFORM_CLEARING, 'ยอดยกมาก่อนใช้ระบบ (เงินที่แพลตฟอร์มเป็นหนี้ร้านอยู่ก่อนวันเริ่มระบบ)', opening, 0),
    ln(ACC.RETAINED_EARNINGS, 'กำไรสะสม (ยอดยกมา)', 0, opening),
  ]
  return mkPlan('PLATFORM_MONTH_OPENING', `ยอดยกมาก่อนใช้ระบบ ${month.platform} · ${month.shop_key}`, dateStr, lines)
}

function parseIncomeBalance(month: any): { income: IncomePayload | null; balance: BalancePayload | null } {
  let income: IncomePayload | null = null
  let balance: BalancePayload | null = null
  try { income = month.income_json ? JSON.parse(month.income_json) : null } catch { income = null }
  try { balance = month.balance_json ? JSON.parse(month.balance_json) : null } catch { balance = null }
  return { income, balance }
}

// ============================================================
// Preview — คำนวณ JV ทั้งหมดแบบ pure (ไม่เขียน DB) ให้ดูก่อนกดลงบัญชีจริง
// ============================================================

export interface PostingPreviewResult {
  monthId: string
  status: string
  vatRegistered: boolean
  journals: {
    opening: JournalPlan | null
    sales: JournalPlan
    shipping: JournalPlan | null
    cogs: JournalPlan | null
    fees: JournalPlan | null
    adjust: JournalPlan | null
    payouts: JournalPlan[]
  }
  ledgerBalance1181: number
  walletClosing: number
  difference: number
  expectedNetMovement: number
}

/** ชื่อบัญชีจริงของ tenant ถ้ามีแล้ว ไม่งั้น fallback ชื่อมาตรฐานจาก ACC_META เพื่อโชว์ใน preview */
export function accountDisplayName(tenantId: string, code: string): string {
  const row = db.prepare(`SELECT name FROM accounts WHERE tenant_id = ? AND code = ?`).get(tenantId, code) as any
  return row?.name || ACC_META[code]?.name || code
}

/** แปะชื่อบัญชีจริงลงทุกบรรทัดของแผน — ใช้เฉพาะตอนส่งออกไปให้หน้าเว็บดู preview เท่านั้น */
function withAccountNames(tenantId: string, plan: JournalPlan | null): JournalPlan | null {
  if (!plan) return null
  return { ...plan, lines: plan.lines.map((l) => ({ ...l, name: accountDisplayName(tenantId, l.code) })) }
}

export function previewPosting(tenantId: string, monthId: string): PostingPreviewResult {
  const month = getMonthRow(tenantId, monthId)
  const { income, balance } = parseIncomeBalance(month)
  if (!income || !balance) throw new PlatformMonthError('ต้องมีไฟล์ income และ balance ครบก่อนดูตัวอย่างการลงบัญชี')

  const vatOn = isVatRegistered(tenantId)
  const dateStr = income.period_end || month.period_end || new Date().toISOString().substring(0, 10)

  const opening = buildOpeningPlan(tenantId, month, balance, balance.period_start || dateStr)
  const sales = buildSalesPlan(month, income, vatOn, dateStr)
  const shipping = buildShippingPlan(tenantId, month, income, vatOn, dateStr)
  const cogs = buildCogsPlan(month, dateStr)
  const fees = buildFeesPlan(tenantId, month, income, vatOn, dateStr)
  const adjust = buildAdjustPlan(tenantId, month, income, dateStr)
  const payouts = buildPayoutPlans(month, balance)

  const ledger = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l
    JOIN journal_entries e ON l.journal_entry_id = e.id
    JOIN accounts a ON l.account_id = a.id
    WHERE e.tenant_id = ? AND a.code = ?
  `).get(tenantId, ACC.PLATFORM_CLEARING) as any
  const ledgerBalance1181 = r2(ledger?.bal || 0)
  const walletClosing = r2(balance.closing)

  return {
    monthId,
    status: month.status,
    vatRegistered: vatOn,
    journals: {
      opening: withAccountNames(tenantId, opening),
      sales: withAccountNames(tenantId, sales) as JournalPlan,
      shipping: withAccountNames(tenantId, shipping),
      cogs: withAccountNames(tenantId, cogs),
      fees: withAccountNames(tenantId, fees),
      adjust: withAccountNames(tenantId, adjust),
      payouts: payouts.map((p) => withAccountNames(tenantId, p) as JournalPlan),
    },
    ledgerBalance1181,
    walletClosing,
    difference: r2(ledgerBalance1181 - walletClosing),
    expectedNetMovement: r2(income.total_income + income.total_expense + income.adjustments.total + balance.withdrawals_total),
  }
}

// ============================================================
// Post — ลงบัญชีจริงทุกใบในทรานแซกชันเดียว
// ============================================================

export function postMonth(tenantId: string, monthId: string, userId: string): { journalIds: string[] } {
  const month = getMonthRow(tenantId, monthId)
  if (month.status === 'POSTED') throw new PlatformMonthError('รอบนี้ลงบัญชีไปแล้ว')
  if (month.status !== 'SALE_CONFIRMED') throw new PlatformMonthError('ต้องยืนยันการขาย (ตัดสต็อก) ให้เสร็จก่อนลงบัญชี')

  const { income, balance } = parseIncomeBalance(month)
  if (!income || !balance) throw new PlatformMonthError('ต้องมีไฟล์ income และ balance ครบก่อนลงบัญชี')

  const status = getMonthStatus(tenantId, month.platform, month.shop_key, month.month)
  if (!status.allChecksPass) throw new PlatformMonthError('สมการของรอบนี้ยังไม่ผ่านครบทุกข้อ — แก้ให้ผ่านก่อนลงบัญชี')

  const vatOn = isVatRegistered(tenantId)
  const dateStr = income.period_end || month.period_end || new Date().toISOString().substring(0, 10)
  const closed = closedPeriodLabel(tenantId, dateStr)
  if (closed) throw new PlatformMonthError(`งวด ${closed} ปิดแล้ว ลงบัญชีรอบนี้ไม่ได้`)

  const opening = buildOpeningPlan(tenantId, month, balance, balance.period_start || dateStr)
  const sales = buildSalesPlan(month, income, vatOn, dateStr)
  const shipping = buildShippingPlan(tenantId, month, income, vatOn, dateStr)
  const cogs = buildCogsPlan(month, dateStr)
  const fees = buildFeesPlan(tenantId, month, income, vatOn, dateStr)
  const adjust = buildAdjustPlan(tenantId, month, income, dateStr)
  const payouts = buildPayoutPlans(month, balance)

  return db.transaction((): { journalIds: string[] } => {
    const now = new Date().toISOString()
    // token กันชนกันของ referenceId ข้ามรอบ post→unpost→post ซ้ำบนเดือนเดียวกัน (ดูหมายเหตุที่ unpostMonth)
    const token = now
    const journalIds: string[] = []
    const post = (p: JournalPlan | null) => {
      if (!p) return
      const id = postJournal({
        tenantId,
        date: p.date,
        referenceType: p.referenceType,
        referenceId: `${p.referenceId || monthId}:${token}`,
        description: p.description,
        createdBy: userId,
        businessUnit: 'ONLINE',
        lines: p.lines.map((l) => ({ code: l.code, description: l.description, debit: l.debit, credit: l.credit })),
      })
      journalIds.push(id)
    }

    post(opening)
    post(sales)
    post(shipping)
    post(cogs)
    post(fees)
    post(adjust)
    payouts.forEach(post)

    db.prepare(`
      UPDATE platform_months SET status = 'POSTED', journal_ids = ?, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(journalIds), token, userId, now, monthId)

    return { journalIds }
  })()
}

// ============================================================
// Unpost — กลับรายการทุกใบที่ลงไปตอน post ด้วย reverseJournalEntryForReference ตัวเดิม
// (purchase.routes.ts — มิร์เรอร์เดบิต/เครดิตสลับข้างเป็นใบใหม่ กัน double-reverse ในตัวอยู่แล้ว)
//
// ponytail: referenceId ของทุกใบต่อท้ายด้วย token = posted_at ตอนลงครั้งนั้น (ไม่ใช่ monthId เปล่า)
// เพื่อไม่ให้ post→unpost→post ซ้ำบนเดือนเดียวกันชนกับใบรอบก่อน — reverseJournalEntryForReference
// หาใบเดิมด้วย (referenceType, referenceId) คู่เดียว ถ้าใช้ referenceId ซ้ำข้ามรอบ unpost ครั้งที่ 2
// จะหาใบผิดรอบ (เจอว่า "กลับไปแล้ว" ทั้งที่ยังไม่ได้กลับใบของรอบใหม่)
// ============================================================

const FIXED_REFERENCE_TYPES = ['PLATFORM_MONTH_OPENING', 'PLATFORM_MONTH_SALES', 'PLATFORM_MONTH_SHIPPING', 'PLATFORM_MONTH_COGS', 'PLATFORM_MONTH_FEES', 'PLATFORM_MONTH_ADJUST']

export function unpostMonth(tenantId: string, monthId: string, userId: string): void {
  const month = getMonthRow(tenantId, monthId)
  if (month.status !== 'POSTED') throw new PlatformMonthError('รอบนี้ยังไม่ได้ลงบัญชี')

  const { income, balance } = parseIncomeBalance(month)
  const dateStr = income?.period_end || month.period_end || new Date().toISOString().substring(0, 10)
  const closed = closedPeriodLabel(tenantId, dateStr)
  if (closed) throw new PlatformMonthError(`งวด ${closed} ปิดแล้ว ยกเลิกการลงบัญชีไม่ได้`)

  const token = month.posted_at // ต้องเหมือนตัวที่ใช้ตอน post เป๊ะ — อ่านจากคอลัมน์ที่ post เขียนไว้
  db.transaction(() => {
    const now = new Date().toISOString()
    const desc = `ยกเลิกการลงบัญชีรอบ ${month.platform} ${month.month}`

    for (const t of FIXED_REFERENCE_TYPES) {
      reverseJournalEntryForReference(tenantId, t, `${t}_UNPOST`, `${monthId}:${token}`, desc, userId, dateStr)
    }
    const withdrawals = balance?.withdrawals || []
    withdrawals.forEach((w, idx) => {
      reverseJournalEntryForReference(tenantId, 'PLATFORM_MONTH_PAYOUT', 'PLATFORM_MONTH_PAYOUT_UNPOST', `${monthId}:W${idx}:${token}`, desc, userId, dateStr)
    })

    db.prepare(`
      UPDATE platform_months SET status = 'SALE_CONFIRMED', journal_ids = NULL, posted_at = NULL, posted_by = NULL, updated_at = ? WHERE id = ?
    `).run(now, monthId)
  })()
}
