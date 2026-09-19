import Papa from 'papaparse'
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
const DEFAULT_FEE_ACCOUNTS: Array<{ feeType: string; accountCode: string; label: string }> = [
  { feeType: 'COMMISSION',      accountCode: '5203', label: 'ค่าคอมมิชชั่น (GP/ค่าต๋ง)' },
  { feeType: 'SHIPPING',        accountCode: '5202', label: 'ค่าขนส่งสินค้า' },
  { feeType: 'ADS',             accountCode: '5201', label: 'ค่าโฆษณา' },
  { feeType: 'TRANSACTION',     accountCode: '5309', label: 'ค่าธรรมเนียมชำระเงิน/ธนาคาร' },
  { feeType: 'PACKAGING',       accountCode: '5204', label: 'ค่าบรรจุภัณฑ์' },
  { feeType: 'SELLER_DISCOUNT', accountCode: '4301', label: 'ส่วนลดผู้ขายร่วมจ่าย' },
]

// ฟิลด์หลักที่ไม่ใช่ค่าธรรมเนียม (บัญชีปลายทางตายตัวตามกติกาบัญชี ไม่ให้แก้ผ่านหน้านี้)
// มีแถวไว้ในตารางเดียวกันเพื่อให้ "โครงไฟล์เป็นข้อมูล" ครบทุกคอลัมน์ ไม่ใช่แค่ค่าธรรมเนียม
const CORE_FIELDS: Array<{ targetField: string; label: string }> = [
  { targetField: 'GROSS_SALES',  label: 'ยอดขายเต็ม (ก่อนหักอะไรทั้งสิ้น)' },
  { targetField: 'VAT',          label: 'ภาษีขาย (VAT)' },
  { targetField: 'COGS',         label: 'ต้นทุนสินค้าที่ขายไปรอบนี้' },
  { targetField: 'PAYOUT',       label: 'ยอดที่แพลตฟอร์มโอนเข้าจริง' },
  { targetField: 'PERIOD_START', label: 'วันที่เริ่มรอบ' },
  { targetField: 'PERIOD_END',   label: 'วันที่สิ้นสุดรอบ' },
]

/**
 * seed ค่าเริ่มต้นให้ tenant นี้ถ้ายังไม่เคยมี — ทำแบบ lazy (ไม่ใช่ loop ทุก tenant ตอน migrate)
 * เพื่อให้ tenant ที่สมัครทีหลัง migration ก็ได้ default เดียวกันโดยอัตโนมัติ
 */
export function ensureDefaultFeeMappings(tenantId: string): void {
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO platform_fee_mappings
      (id, tenant_id, target_field, fee_type, account_code, label, column_aliases, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)
  `)
  for (const f of DEFAULT_FEE_ACCOUNTS) {
    insert.run(`${tenantId}-fee-${f.feeType}`, tenantId, 'FEE', f.feeType, f.accountCode, f.label, now, now)
  }
  for (const c of CORE_FIELDS) {
    insert.run(`${tenantId}-core-${c.targetField}`, tenantId, c.targetField, null, null, c.label, now, now)
  }
}

export interface FeeMappingRow {
  id: string
  targetField: string
  feeType: string | null
  accountCode: string | null
  label: string
  columnAliases: string[]
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
}

/** แก้บัญชีปลายทาง/รายชื่อคอลัมน์ที่รู้จักของแถวหนึ่ง — ไม่แตะ target_field/fee_type (คงที่ตามตัวตนของแถว) */
export function updateFeeMappings(tenantId: string, updates: FeeMappingUpdate[]): FeeMappingRow[] {
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE platform_fee_mappings
    SET account_code = COALESCE(?, account_code),
        column_aliases = COALESCE(?, column_aliases),
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `)
  const tx = db.transaction((rows: FeeMappingUpdate[]) => {
    for (const u of rows) {
      stmt.run(u.accountCode ?? null, u.columnAliases ? JSON.stringify(u.columnAliases) : null, now, u.id, tenantId)
    }
  })
  tx(updates)
  return getFeeMappings(tenantId)
}

/** หาบัญชีปลายทางของค่าธรรมเนียมประเภทหนึ่ง — throw ชัดเจนถ้ายังไม่ได้ผูกไว้ (ห้ามเดา/ห้ามลงบัญชีมั่ว) */
function resolveFeeAccount(tenantId: string, feeType: string): string {
  ensureDefaultFeeMappings(tenantId)
  const row = db.prepare(
    `SELECT account_code FROM platform_fee_mappings WHERE tenant_id = ? AND target_field = 'FEE' AND fee_type = ? AND is_active = 1`
  ).get(tenantId, feeType) as { account_code: string | null } | undefined
  if (!row || !row.account_code) {
    throw new SettlementError(`ยังไม่ได้ผูกบัญชีให้ค่าธรรมเนียมประเภท "${feeType}" — ไปตั้งค่าที่หน้าผูกค่าธรรมเนียมก่อน`)
  }
  return row.account_code
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
        { code: ACC.INVENTORY,         description: 'สต็อกสินค้า', credit: cogs },
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
// อ่านไฟล์ CSV แบบ generic — ไม่ผูกกับโครงไฟล์ของแพลตฟอร์มไหนเป็นพิเศษ
// header ไหนไม่รู้จักคืนกลับไปว่า "ไม่รู้จัก" แทนที่จะเงียบหรือเดา
// ============================================================

export interface PreviewColumn {
  header: string
  targetField: string | null // null = ไม่รู้จัก
  feeType: string | null
  matchedTotal: number | null // ผลรวมคอลัมน์นี้ (เฉพาะที่แม็ปได้และเป็นตัวเลข)
}

export interface PreviewResult {
  rowCount: number
  headers: string[]
  columns: PreviewColumn[]
  unknownHeaders: string[]
  computed: Partial<SettlementBatch>
}

const norm = (s: string) => s.trim().toLowerCase()

export function previewSettlementCsv(tenantId: string, platform: string, csvText: string): PreviewResult {
  ensureDefaultFeeMappings(tenantId)
  const mappings = getFeeMappings(tenantId)

  // ดัชนี alias -> mapping แบบ normalize แล้ว (ตัดช่องว่าง/ตัวพิมพ์เล็กใหญ่ทิ้ง)
  const aliasIndex = new Map<string, FeeMappingRow>()
  for (const m of mappings) {
    for (const alias of m.columnAliases) aliasIndex.set(norm(alias), m)
  }

  // ปูอัตแปลงข้อความเป็นตัวเลข (ตัดคอมมา/สัญลักษณ์เปอร์เซ็นต์แบบเดียวกับ csvParser.service.ts เดิม
  // แต่เขียนแยกไว้ที่นี่เพราะห้ามแก้ไฟล์นั้น)
  const toNumber = (v: any): number => {
    if (typeof v === 'string') {
      const cleaned = v.replace(/,/g, '').replace('%', '').trim()
      const n = parseFloat(cleaned)
      return isNaN(n) ? 0 : n
    }
    const n = parseFloat(v)
    return isNaN(n) ? 0 : n
  }

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const rows: any[] = parsed.data || []
  const headers: string[] = (parsed.meta?.fields || []) as string[]

  const columns: PreviewColumn[] = []
  const unknownHeaders: string[] = []
  const computed: Partial<SettlementBatch> = { platform, fees: [] }
  const feeTotals = new Map<string, number>()

  for (const header of headers) {
    const match = aliasIndex.get(norm(header))
    if (!match) {
      unknownHeaders.push(header)
      columns.push({ header, targetField: null, feeType: null, matchedTotal: null })
      continue
    }

    if (match.targetField === 'PERIOD_START' || match.targetField === 'PERIOD_END') {
      const firstVal = rows[0]?.[header]
      if (match.targetField === 'PERIOD_START') computed.periodStart = firstVal
      else computed.periodEnd = firstVal
      columns.push({ header, targetField: match.targetField, feeType: null, matchedTotal: null })
      continue
    }

    const total = r2(rows.reduce((s, row) => s + toNumber(row[header]), 0))
    if (match.targetField === 'GROSS_SALES') computed.grossSales = total
    else if (match.targetField === 'VAT') computed.vatAmount = total
    else if (match.targetField === 'COGS') computed.cogsAmount = total
    else if (match.targetField === 'PAYOUT') computed.payoutAmount = total
    else if (match.targetField === 'FEE' && match.feeType) {
      feeTotals.set(match.feeType, (feeTotals.get(match.feeType) || 0) + total)
    }

    columns.push({ header, targetField: match.targetField, feeType: match.feeType, matchedTotal: total })
  }

  computed.fees = Array.from(feeTotals.entries()).map(([feeType, amount]) => ({ feeType, amount: r2(amount) }))

  return { rowCount: rows.length, headers, columns, unknownHeaders, computed }
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
