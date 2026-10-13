import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { postJournal } from './accounting.service'
import { ACC } from '../config/accountCodes'

// ============================================================
// บัญชีขายผ่านแพลตฟอร์ม (Shopee/Lazada/TikTok) — นิติบุคคลเดียวกับหน้าร้าน
// แยกกำไรด้วย business_unit='ONLINE' เท่านั้น ไม่แยก tenant
//
// กติกาที่ตกลงกับเจ้าของร้าน: ลงยอดเต็มเสมอ ห้ามลงยอดสุทธิ เพราะแพลตฟอร์มโอนเงินมาเป็น
// ยอดหลังหักค่าธรรมเนียมแล้ว ถ้าบันทึกแค่ยอดที่เข้าบัญชีจริง รายได้จะต่ำกว่าจริงและ
// ค่าใช้จ่ายทั้งก้อนจะหายไปจากงบ (กำไรสุทธิบังเอิญเท่ากัน แต่มองไม่เห็นว่า GP กินไปเท่าไร
// และยอดขายจะไม่ตรงกับที่แพลตฟอร์มรายงานต่อสรรพากร) — จึงต้องแยกลง 3 ขั้นเสมอ โดยพักทุกขั้น
// ไว้ที่ 1181 (ลูกหนี้การค้า-แพลตฟอร์ม) ครบ 3 ขั้นแล้ว 1181 ต้องเหลือศูนย์
// ============================================================

export interface SettlementFee {
  /** ประเภทค่าธรรมเนียม เช่น 'COMMISSION' — ต้องมีแถวผูกบัญชีไว้แล้วใน platform_fee_mappings */
  feeType: string
  amount: number
}

export interface SettlementBatch {
  platform: string // SHOPEE | LAZADA | TIKTOK
  periodStart: string
  periodEnd: string
  /** ยอดขายเต็มก่อนหักอะไรทั้งสิ้น (รวม VAT) — ห้ามส่งยอดสุทธิมาที่นี่ */
  grossSales: number
  /** ไม่ระบุ = ไฟล์ไม่มีคอลัมน์ VAT แยก จะคำนวณจาก grossSales ด้วยอัตรา VAT มาตรฐานให้ */
  vatAmount?: number
  /** ต้นทุนของที่ขายไปรอบนั้น (คำนวณจาก stock_items.unit_cost ของรายการที่ตัดสต็อกจริง) */
  cogsAmount?: number
  fees: SettlementFee[]
  /** เงินที่แพลตฟอร์มโอนเข้าจริง — ไม่ระบุ = ยังไม่ถึงรอบโอน (ข้ามขั้น 3 ไปก่อน) */
  payoutAmount?: number
}

export interface PostSettlementInput extends SettlementBatch {
  tenantId: string
  createdBy?: string
  sourceFilename?: string
}

export interface PostSettlementResult {
  batchId: string
  salesJournalId: string
  feesJournalId: string | null
  payoutJournalId: string | null
  status: 'PENDING_PAYOUT' | 'COMPLETED'
}

export class SettlementError extends Error {}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

// อัตรา VAT มาตรฐาน — ใช้ค่าเดียวกับดีฟอลต์ใน purchaseBilling.service.ts เวลาไม่ระบุ taxRate
const DEFAULT_VAT_RATE = 7

/** แยกยอดขายรวม VAT ออกเป็นรายได้สุทธิ + VAT ขาย เมื่อไฟล์ settlement ไม่มีคอลัมน์ VAT แยกให้ */
function splitVat(grossSales: number, vatAmount?: number): { revenue: number; vat: number } {
  if (vatAmount != null) return { revenue: r2(grossSales - vatAmount), vat: r2(vatAmount) }
  const vat = r2((grossSales * DEFAULT_VAT_RATE) / (100 + DEFAULT_VAT_RATE))
  return { revenue: r2(grossSales - vat), vat }
}

// ============================================================
// การผูกค่าธรรมเนียม ↔ บัญชี (ตาราง platform_fee_mappings)
// ตั้งครั้งเดียวใช้ตลอด แก้ได้ผ่าน GET/PUT /fee-mappings — ไม่ต้องแก้โค้ดตรงนี้เลย
// เจ้าของร้านตอบไม่ได้ว่า "จะ Dr บัญชีไหน" แต่ตอบได้ว่า "ค่าคอมมิชชั่นควรลงบัญชีไหน"
// ============================================================

// รหัสบัญชีเหล่านี้ไม่มีชื่อเรียกใน ACC (accountCodes.ts) เพราะเป็นรหัสมาตรฐานที่มีอยู่แล้ว
// ในผังบัญชีทุก tenant (ดู config/chartOfAccounts.ts) ไม่ใช่บัญชีระบบที่ getOrCreateAccount
// ต้องสร้างเอง — อ้างเป็น literal ตรงนี้พอ ไม่ต้องเพิ่มใน ACC
// columnAliases = ชื่อหัวคอลัมน์ที่ให้ถือว่าเป็นค่าธรรมเนียมตัวนี้
// ⚠ ยังไม่ได้ยืนยันกับไฟล์รายงานจริงของ Shopee/Lazada/TikTok — เป็นจุดตั้งต้นให้แก้เท่านั้น
// พอได้ไฟล์จริงมาสักรอบ ให้แก้รายการนี้ผ่านหน้าตั้งค่า (PUT /fee-mappings) ไม่ต้องแก้โค้ด
// เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และช่องว่าง คอลัมน์ไหนไม่ตรงสักตัว preview จะฟ้องว่า "ไม่รู้จัก"
// vatClaimable: สำหรับค่าธรรมเนียม (รายจ่าย) = ขอคืนภาษีซื้อได้ไหม (ต้องมีใบกำกับภาษีจากแพลตฟอร์ม)
// ของ SHIPPING_REVENUE (รายรับ) เท่านั้น คอลัมน์เดียวกันแปลว่า "มีภาษีขาย" แทน (ดูคำอธิบายที่แถวนั้น)
// ⚠️ 2026-10-13 เจ้าของยืนยัน: Shopee ยังไม่ออกใบกำกับภาษีค่าธรรมเนียมให้ร้าน → ตั้งค่าเริ่มต้นของ
// ค่าธรรมเนียมทุกตัว (รายจ่าย) เป็น false (ลงต้นทุนเต็มจำนวนไปก่อน) เปิดเองได้ทีหลังถ้าขอใบกำกับได้แล้ว
const DEFAULT_FEE_ACCOUNTS: Array<{ feeType: string; accountCode: string; label: string; columnAliases: string[]; vatClaimable: boolean }> = [
  { feeType: 'COMMISSION',      accountCode: '5203', label: 'ค่าคอมมิชชั่น (GP/ค่าต๋ง)', vatClaimable: false,
    columnAliases: ['Commission Fee', 'Commission', 'Service Fee', 'Platform commission', 'Payment Fee', 'ค่าคอมมิชชั่น', 'ค่าบริการ'] },
  { feeType: 'SHIPPING',        accountCode: '5202', label: 'ค่าขนส่งสินค้า (ฝั่งจ่าย/ถูกเรียกเก็บ)', vatClaimable: false,
    columnAliases: ['Shipping Fee', 'Actual shipping fee', 'Shipping cost', 'ค่าจัดส่ง', 'ค่าขนส่ง'] },
  { feeType: 'ADS',             accountCode: '5201', label: 'ค่าโฆษณา', vatClaimable: false,
    columnAliases: ['Ads Cost', 'Ad Cost', 'Advertising Fee', 'ค่าโฆษณา'] },
  { feeType: 'TRANSACTION',     accountCode: '5309', label: 'ค่าธรรมเนียมชำระเงิน/ธนาคาร', vatClaimable: false,
    columnAliases: ['Transaction Fee', 'Payment processing fee', 'ค่าธรรมเนียมการทำรายการ', 'ค่าธรรมเนียมชำระเงิน'] },
  { feeType: 'PACKAGING',       accountCode: '5204', label: 'ค่าบรรจุภัณฑ์', vatClaimable: false,
    columnAliases: ['Packaging Fee', 'Fulfilment Fee', 'ค่าบรรจุภัณฑ์'] },
  { feeType: 'SELLER_DISCOUNT', accountCode: '4301', label: 'ส่วนลดผู้ขายร่วมจ่าย', vatClaimable: false,
    columnAliases: ['Seller Discount', 'Seller Voucher', 'Seller Coupon', 'ส่วนลดจากผู้ขาย'] },
  // ── เฟส 3 (2026-10-13): ค่าธรรมเนียมประเภทใหม่จากไฟล์ income.โอนเงินสำเร็จ ของ Shopee ──────
  { feeType: 'SERVICE',         accountCode: '5203', label: 'ค่าบริการแพลตฟอร์ม (Service Fee)', vatClaimable: false,
    columnAliases: ['Service Fee'] },
  { feeType: 'INFRASTRUCTURE',  accountCode: '5203', label: 'ค่าโครงสร้างพื้นฐาน (Infrastructure Fee)', vatClaimable: false,
    columnAliases: ['Infrastructure Fee'] },
  { feeType: 'AFFILIATE',       accountCode: '5201', label: 'ค่าคอมมิชชั่นนักการตลาด/affiliate (AMS)', vatClaimable: false,
    columnAliases: ['AMS Commission Fee'] },
  { feeType: 'OTHER',           accountCode: '5403', label: 'ค่าธรรมเนียมอื่น', vatClaimable: false,
    columnAliases: [] },
  // ยอดขนส่งฝั่งรับ — แยก 2 ก้อนตามที่มา เพราะสถานะทาง VAT ต่างกัน (ม.79 ฐานภาษี = สิ่งที่ "ผู้ประกอบการ
  // เรียกเก็บจากผู้ซื้อ" เท่านั้น เงินอุดหนุนจากบุคคลที่สามไม่ใช่ค่าตอบแทนการขาย/บริการ):
  // 1) shipping_buyer_paid = ค่าส่งที่ร้านเรียกเก็บจากผู้ซื้อเอง "ในชื่อร้าน" (ร้านไม่ได้ประกอบกิจการขนส่ง
  //    เป็นปกติธุระ) → เข้าฐาน VAT ขายตามปกติ — default เปิดภาษีขาย (true)
  // 2) shipping_shopee_subsidy = เงินที่ Shopee ออกแทนลูกค้า (เงินอุดหนุนจากแพลตฟอร์ม ไม่ใช่สิ่งที่ร้าน
  //    เรียกเก็บจากผู้ซื้อ) → เป็นรายได้ แต่ไม่เข้าฐาน VAT ขาย (อ้างอิงบทความ Prosoft iBiz ที่อ้าง iliketax)
  //    — default ปิดภาษีขาย (false) แก้ได้ถ้านักบัญชียืนยันเป็นอย่างอื่น
  { feeType: 'SHIPPING_REVENUE', accountCode: '4203', label: 'รายได้ค่าขนส่งที่เรียกเก็บจากผู้ซื้อ', vatClaimable: true,
    columnAliases: [] },
  { feeType: 'SHIPPING_SUBSIDY', accountCode: '4203', label: 'รายได้เงินอุดหนุนค่าขนส่งจาก Shopee', vatClaimable: false,
    columnAliases: [] },
]

// ฟิลด์หลักที่ไม่ใช่ค่าธรรมเนียม (บัญชีปลายทางตายตัวตามกติกาบัญชี ไม่ให้แก้ผ่านหน้านี้)
// มีแถวไว้ในตารางเดียวกันเพื่อให้ "โครงไฟล์เป็นข้อมูล" ครบทุกคอลัมน์ ไม่ใช่แค่ค่าธรรมเนียม
const CORE_FIELDS: Array<{ targetField: string; label: string; columnAliases: string[] }> = [
  { targetField: 'GROSS_SALES',  label: 'ยอดขายเต็ม (ก่อนหักอะไรทั้งสิ้น)',
    columnAliases: ['Original Price', 'Product Subtotal', 'Gross Sales', 'Total Sales', 'ยอดขายสินค้า', 'ยอดขายรวม'] },
  { targetField: 'VAT',          label: 'ภาษีขาย (VAT)',
    columnAliases: ['VAT', 'Tax', 'ภาษีขาย', 'ภาษีมูลค่าเพิ่ม'] },
  { targetField: 'COGS',         label: 'ต้นทุนสินค้าที่ขายไปรอบนี้',
    columnAliases: [] },
  { targetField: 'PAYOUT',       label: 'ยอดที่แพลตฟอร์มโอนเข้าจริง',
    columnAliases: ['Total Released Amount', 'Settlement Amount', 'Payout', 'Payout Amount', 'ยอดเงินที่ได้รับ', 'ยอดโอนเข้า'] },
  { targetField: 'PERIOD_START', label: 'วันที่เริ่มรอบ',
    columnAliases: ['Period Start', 'Start Date', 'วันที่เริ่ม'] },
  { targetField: 'PERIOD_END',   label: 'วันที่สิ้นสุดรอบ',
    columnAliases: ['Period End', 'End Date', 'วันที่สิ้นสุด'] },
]

/**
 * seed ค่าเริ่มต้นให้ tenant นี้ถ้ายังไม่เคยมี — ทำแบบ lazy (ไม่ใช่ loop ทุก tenant ตอน migrate)
 * เพื่อให้ tenant ที่สมัครทีหลัง migration ก็ได้ default เดียวกันโดยอัตโนมัติ
 */
export function ensureDefaultFeeMappings(tenantId: string): void {
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO platform_fee_mappings
      (id, tenant_id, target_field, fee_type, account_code, label, column_aliases, vat_claimable, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)
  // INSERT OR IGNORE — แถวที่มีอยู่แล้วไม่ถูกทับ ของที่ผู้ใช้แก้เองจึงไม่หาย
  // (แลกกับการที่ tenant เก่าจะไม่ได้ alias ชุดใหม่อัตโนมัติ ต้องไปเพิ่มเองในหน้าตั้งค่า)
  for (const f of DEFAULT_FEE_ACCOUNTS) {
    insert.run(`${tenantId}-fee-${f.feeType}`, tenantId, 'FEE', f.feeType, f.accountCode, f.label,
      JSON.stringify(f.columnAliases), f.vatClaimable ? 1 : 0, now, now)
  }
  for (const c of CORE_FIELDS) {
    insert.run(`${tenantId}-core-${c.targetField}`, tenantId, c.targetField, null, null, c.label,
      JSON.stringify(c.columnAliases), 0, now, now)
  }
}

export interface FeeMappingRow {
  id: string
  targetField: string
  feeType: string | null
  accountCode: string | null
  label: string
  columnAliases: string[]
  /** รายจ่าย: ขอคืนภาษีซื้อได้ไหม (มีใบกำกับ) — ใช้แยก Dr 1110 / รายรับ (SHIPPING_REVENUE): มีภาษีขายไหม — ใช้แยก Cr 2104 (เฟส 3) */
  vatClaimable: boolean
  isActive: boolean
}

function rowToFeeMapping(r: any): FeeMappingRow {
  let aliases: string[] = []
  try { aliases = JSON.parse(r.column_aliases || '[]') } catch { aliases = [] }
  return {
    id: r.id,
    targetField: r.target_field,
    feeType: r.fee_type,
    accountCode: r.account_code,
    label: r.label,
    columnAliases: aliases,
    vatClaimable: !!r.vat_claimable,
    isActive: !!r.is_active,
  }
}

export function getFeeMappings(tenantId: string): FeeMappingRow[] {
  ensureDefaultFeeMappings(tenantId)
  const rows = db.prepare(
    `SELECT * FROM platform_fee_mappings WHERE tenant_id = ? ORDER BY target_field, fee_type`
  ).all(tenantId) as any[]
  return rows.map(rowToFeeMapping)
}

export interface FeeMappingUpdate {
  id: string
  accountCode?: string | null
  columnAliases?: string[]
  vatClaimable?: boolean | null
}

/** แก้บัญชีปลายทาง/รายชื่อคอลัมน์/ขอคืน VAT ได้ไหมของแถวหนึ่ง — ไม่แตะ target_field/fee_type (คงที่ตามตัวตนของแถว) */
export function updateFeeMappings(tenantId: string, updates: FeeMappingUpdate[]): FeeMappingRow[] {
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE platform_fee_mappings
    SET account_code = COALESCE(?, account_code),
        column_aliases = COALESCE(?, column_aliases),
        vat_claimable = COALESCE(?, vat_claimable),
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `)
  const tx = db.transaction((rows: FeeMappingUpdate[]) => {
    for (const u of rows) {
      stmt.run(
        u.accountCode ?? null,
        u.columnAliases ? JSON.stringify(u.columnAliases) : null,
        u.vatClaimable == null ? null : (u.vatClaimable ? 1 : 0),
        now, u.id, tenantId
      )
    }
  })
  tx(updates)
  return getFeeMappings(tenantId)
}

/** หาบัญชีปลายทางของค่าธรรมเนียมประเภทหนึ่ง — throw ชัดเจนถ้ายังไม่ได้ผูกไว้ (ห้ามเดา/ห้ามลงบัญชีมั่ว) */
function resolveFeeAccount(tenantId: string, feeType: string): string {
  return resolveFeeMapping(tenantId, feeType).accountCode
}

export interface FeeAccountResolution {
  accountCode: string
  /** ขอคืนภาษีซื้อได้ไหม (มีใบกำกับ) — ใช้โดยเฟส 3 (platformMonthPosting.service.ts) แยก Dr 1110 */
  claimable: boolean
}

/** เหมือน resolveFeeAccount แต่คืน vat_claimable มาด้วย — เฟส 3 ใช้ตัดสินใจแยก VAT ซื้อ */
export function resolveFeeMapping(tenantId: string, feeType: string): FeeAccountResolution {
  ensureDefaultFeeMappings(tenantId)
  const row = db.prepare(
    `SELECT account_code, vat_claimable FROM platform_fee_mappings WHERE tenant_id = ? AND target_field = 'FEE' AND fee_type = ? AND is_active = 1`
  ).get(tenantId, feeType) as { account_code: string | null; vat_claimable: number } | undefined
  if (!row || !row.account_code) {
    throw new SettlementError(`ยังไม่ได้ผูกบัญชีให้ค่าธรรมเนียมประเภท "${feeType}" — ไปตั้งค่าที่หน้าผูกค่าธรรมเนียมก่อน`)
  }
  return { accountCode: row.account_code, claimable: row.vat_claimable === 1 }
}

// ============================================================
// ลงบัญชีรอบ settlement — หัวใจของงานนี้
// ============================================================

/** กันลงซ้ำ: รอบเดียวกัน (platform + ช่วงวันที่) ของ tenant เดียวกัน ลงได้ครั้งเดียวเท่านั้น */
function findExistingBatch(tenantId: string, platform: string, periodStart: string, periodEnd: string) {
  return db.prepare(
    `SELECT * FROM platform_settlements WHERE tenant_id = ? AND platform = ? AND period_start = ? AND period_end = ?`
  ).get(tenantId, platform, periodStart, periodEnd) as any
}

export function postPlatformSettlement(input: PostSettlementInput): PostSettlementResult {
  const { tenantId, platform, periodStart, periodEnd, grossSales, cogsAmount, fees, payoutAmount, createdBy, sourceFilename } = input

  if (!(grossSales > 0)) throw new SettlementError('ยอดขายเต็มต้องมากกว่าศูนย์')

  const existing = findExistingBatch(tenantId, platform, periodStart, periodEnd)
  if (existing) {
    // รอบที่ยังไม่ได้รับเงินโอน ไม่ใช่ของซ้ำ — ให้ไปใช้ recordSettlementPayout() เติมขั้น 3 แทน
    if (existing.status === 'PENDING_PAYOUT') {
      throw new SettlementError(
        `รอบนี้ลงยอดขายกับค่าธรรมเนียมไว้แล้ว รอเงินโอนอยู่ (${platform} ${periodStart} ถึง ${periodEnd}) — ` +
        `ถ้าเงินเข้าแล้วให้บันทึกยอดที่โอนเข้าจริงแทนการยืนยันรอบซ้ำ`
      )
    }
    throw new SettlementError(`ยืนยันรอบนี้ไปแล้ว (${platform} ${periodStart} ถึง ${periodEnd}) — ดูได้ที่ประวัติ ไม่ลงซ้ำ`)
  }

  const { revenue, vat } = splitVat(grossSales, input.vatAmount)
  const cogs = r2(cogsAmount || 0)
  const now = new Date().toISOString()
  const dateStr = periodEnd || now.substring(0, 10)
  const batchId = generateId()

  return db.transaction((): PostSettlementResult => {
    // ---------- ขั้น 1: รับรู้รายได้ + ต้นทุนขายเต็มจำนวน ----------
    const salesJournalId = postJournal({
      tenantId,
      date: dateStr,
      referenceType: 'PLATFORM_SETTLEMENT_SALES',
      referenceId: batchId,
      description: `ขายผ่าน ${platform} รอบ ${periodStart} ถึง ${periodEnd}`,
      createdBy,
      businessUnit: 'ONLINE',
      lines: [
        { code: ACC.PLATFORM_CLEARING, description: 'ลูกหนี้การค้า-แพลตฟอร์ม (ยอดเต็ม)', debit: grossSales },
        { code: ACC.REVENUE_PRODUCT,   description: 'รายได้ขายสินค้า', credit: revenue },
        { code: ACC.OUTPUT_VAT,        description: 'ภาษีขาย', credit: vat },
        { code: ACC.COGS_PRODUCT,      description: 'ต้นทุนสินค้าขาย', debit: cogs },
        { code: ACC.RAW_MATERIAL,      description: 'สต็อกสินค้า', credit: cogs },
      ],
    })

    // ---------- ขั้น 2: หักค่าธรรมเนียมตามที่แพลตฟอร์มแจ้ง ----------
    let feesJournalId: string | null = null
    const totalFees = r2(fees.reduce((s, f) => s + (f.amount || 0), 0))
    if (fees.length > 0 && totalFees > 0) {
      const feeLines = fees
        .filter(f => f.amount)
        .map(f => ({
          code: resolveFeeAccount(tenantId, f.feeType),
          description: f.feeType,
          debit: r2(f.amount),
        }))
      feesJournalId = postJournal({
        tenantId,
        date: dateStr,
        referenceType: 'PLATFORM_SETTLEMENT_FEES',
        referenceId: batchId,
        description: `ค่าธรรมเนียม ${platform} รอบ ${periodStart} ถึง ${periodEnd}`,
        createdBy,
        businessUnit: 'ONLINE',
        lines: [
          ...feeLines,
          { code: ACC.PLATFORM_CLEARING, description: 'หักจากลูกหนี้การค้า-แพลตฟอร์ม', credit: totalFees },
        ],
      })
    }

    const receivable = r2(grossSales - totalFees) // "ควรได้รับ" หลังหักค่าธรรมเนียม

    // ---------- ขั้น 3: แพลตฟอร์มโอนเงินเข้าจริง (ข้ามได้ถ้ายังไม่ถึงรอบโอน) ----------
    let payoutJournalId: string | null = null
    let status: 'PENDING_PAYOUT' | 'COMPLETED' = 'PENDING_PAYOUT'
    if (payoutAmount != null) {
      // โอนมาไม่ตรงยอดที่ควรได้รับ → ส่วนต่างเข้า 5901 เหมือนเงินขาด/เงินเกินของ POS
      // shortfall > 0 = โอนมาน้อยกว่าที่ควร (ขาด, Dr 5901) / < 0 = โอนมาเกิน (Cr 5901)
      const shortfall = r2(receivable - payoutAmount)
      payoutJournalId = postJournal({
        tenantId,
        date: dateStr,
        referenceType: 'PLATFORM_SETTLEMENT_PAYOUT',
        referenceId: batchId,
        description: `แพลตฟอร์ม ${platform} โอนเงินเข้ารอบ ${periodStart} ถึง ${periodEnd}`,
        createdBy,
        businessUnit: 'ONLINE',
        lines: [
          { code: ACC.BANK,             description: 'รับโอนจากแพลตฟอร์ม', debit: payoutAmount },
          { code: ACC.CASH_OVER_SHORT,  description: 'โอนมาขาดจากที่ควรได้รับ', debit: shortfall > 0 ? shortfall : 0 },
          { code: ACC.CASH_OVER_SHORT,  description: 'โอนมาเกินจากที่ควรได้รับ', credit: shortfall < 0 ? -shortfall : 0 },
          { code: ACC.PLATFORM_CLEARING, description: 'ปิดยอดลูกหนี้การค้า-แพลตฟอร์ม', credit: receivable },
        ],
      })
      status = 'COMPLETED'
    }

    db.prepare(`
      INSERT INTO platform_settlements
        (id, tenant_id, platform, period_start, period_end, gross_sales, vat_amount, cogs_amount,
         fees_json, payout_amount, status, je_sales_id, je_fees_id, je_payout_id, source_filename,
         created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId, tenantId, platform, periodStart, periodEnd, grossSales, vat, cogs,
      JSON.stringify(fees), payoutAmount ?? null, status, salesJournalId, feesJournalId, payoutJournalId,
      sourceFilename ?? null, createdBy ?? null, now, now
    )

    return { batchId, salesJournalId, feesJournalId, payoutJournalId, status }
  })()
}

export function listSettlements(tenantId: string, platform?: string) {
  if (platform) {
    return db.prepare(`SELECT * FROM platform_settlements WHERE tenant_id = ? AND platform = ? ORDER BY period_end DESC`).all(tenantId, platform)
  }
  return db.prepare(`SELECT * FROM platform_settlements WHERE tenant_id = ? ORDER BY period_end DESC`).all(tenantId)
}

// ============================================================
// รับเงินโอนของรอบที่ลงไว้ก่อนแล้ว — ขั้น 3 ที่มาทีหลัง
// ------------------------------------------------------------
// แพลตฟอร์มส่งรายงานยอดขายก่อน แล้วโอนเงินอีกเป็นสัปดาห์ จังหวะจริงจึงเป็นคนละครั้งกัน
// เดิมยืนยันรอบเดิมซ้ำจะโดนเด้งว่า "ลงซ้ำ" ทำให้ 1181 ค้างตลอดกาล ปิดบัญชีพักไม่ได้เลย
// ============================================================

export interface RecordPayoutInput {
  tenantId: string
  batchId: string
  /** ยอดที่แพลตฟอร์มโอนเข้าบัญชีจริง */
  payoutAmount: number
  createdBy?: string
}

export function recordSettlementPayout(input: RecordPayoutInput): { batchId: string; payoutJournalId: string; status: 'COMPLETED' } {
  const { tenantId, batchId, payoutAmount, createdBy } = input

  const batch = db.prepare(
    'SELECT * FROM platform_settlements WHERE id = ? AND tenant_id = ?'
  ).get(batchId, tenantId) as any
  if (!batch) throw new SettlementError('ไม่พบรอบ settlement นี้')
  if (batch.status === 'COMPLETED') throw new SettlementError('รอบนี้รับเงินโอนไปแล้ว ไม่บันทึกซ้ำ')
  if (!(payoutAmount >= 0)) throw new SettlementError('ยอดที่โอนเข้าต้องไม่ติดลบ')

  // "ควรได้รับ" = ยอดเต็ม ลบค่าธรรมเนียมที่หักไปแล้วตอนขั้น 2 — อ่านจากที่บันทึกไว้
  // ไม่คำนวณใหม่จาก input เพราะต้องปิด 1181 ให้เท่ากับที่เคย Dr ไว้เป๊ะ ๆ
  let fees: Array<{ amount: number }> = []
  try { fees = JSON.parse(batch.fees_json || '[]') } catch { fees = [] }
  const totalFees = r2(fees.reduce((t, f) => t + (Number(f.amount) || 0), 0))
  const receivable = r2(Number(batch.gross_sales) - totalFees)
  const payout = r2(payoutAmount)
  const shortfall = r2(receivable - payout)

  return db.transaction(() => {
    const payoutJournalId = postJournal({
      tenantId,
      date: new Date().toISOString().substring(0, 10),
      referenceType: 'PLATFORM_SETTLEMENT_PAYOUT',
      referenceId: batchId,
      description: `แพลตฟอร์ม ${batch.platform} โอนเงินเข้ารอบ ${batch.period_start} ถึง ${batch.period_end}`,
      createdBy,
      businessUnit: 'ONLINE',
      lines: [
        { code: ACC.BANK, description: 'รับโอนจากแพลตฟอร์ม', debit: payout },
        { code: ACC.CASH_OVER_SHORT, description: 'โอนมาขาดจากที่ควรได้รับ', debit: shortfall > 0 ? shortfall : 0 },
        { code: ACC.CASH_OVER_SHORT, description: 'โอนมาเกินจากที่ควรได้รับ', credit: shortfall < 0 ? -shortfall : 0 },
        { code: ACC.PLATFORM_CLEARING, description: 'ปิดยอดลูกหนี้การค้า-แพลตฟอร์ม', credit: receivable },
      ],
    })

    db.prepare(
      `UPDATE platform_settlements SET payout_amount = ?, status = 'COMPLETED', je_payout_id = ? WHERE id = ? AND tenant_id = ?`
    ).run(payout, payoutJournalId, batchId, tenantId)

    return { batchId, payoutJournalId, status: 'COMPLETED' as const }
  })()
}
