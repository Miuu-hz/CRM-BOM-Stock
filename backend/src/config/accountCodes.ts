// ============================================================
// Standard Thai Chart of Account Codes
// Shared across all modules to prevent duplicate / mismatched accounts
// Must stay in sync with DEFAULT_CHART_OF_ACCOUNTS in config/chartOfAccounts.ts
// ============================================================

export const ACC = {
  // Assets
  CASH:              '1101',
  BANK:              '1102',
  AR:                '1104',  // ลูกหนี้การค้า
  OTHER_RECEIVABLE:  '1105',
  INVENTORY:         '1106',  // สต็อกสินค้า
  RAW_MATERIAL:      '1107',  // สต็อกวัตถุดิบ
  PREPAID:           '1109',
  INPUT_VAT:         '1110',  // ภาษีซื้อ
  // NOTE: 1108 is already allocated to "สินค้าส่งเดิมเรียกคืน" in DEFAULT_CHART_OF_ACCOUNTS
  // (accounts.routes.ts) and already exists in production tenant data with that name.
  // 1109-1111 are also taken (ค่าใช้จ่ายจ่ายล่วงหน้า / ภาษีซื้อ / เงินประกัน). Next free code
  // in the 11xx (current asset) range is 1112.
  SUBCON_MATERIAL:   '1112',  // วัตถุดิบที่ผู้รับจ้างช่วง (Phase 3)

  // Liabilities
  AP:                '2101',  // เจ้าหนี้การค้า
  OTHER_PAYABLE:     '2102',
  SHORT_TERM_LOAN:   '2103',
  OUTPUT_VAT:        '2104',  // ภาษีขาย
  WHT_PAYABLE:       '2105',  // ภาษีหัก ณ ที่จ่าย
  ACCRUED:           '2107',
  DEFERRED_REVENUE:  '2108',

  // Equity
  CAPITAL:           '3101',
  RESERVE:           '3102',
  RETAINED_EARNINGS: '3103',
  ACCUMULATED_LOSS:  '3104',

  // Revenue
  REVENUE_PRODUCT:   '4101',  // รายได้ขายสินค้า
  REVENUE_SERVICE:   '4201',
  SALES_DISCOUNT:    '4301',
  SALES_RETURN:      '4302',

  // COGS
  COGS_PRODUCT:      '5101',  // ต้นทุนสินค้าขาย
  COGS_RAW_MATERIAL: '5102',  // ต้นทุนวัตถุดิบใช้ไป
  DIRECT_LABOR:      '5103',
  // NOTE: 5104 is already allocated to "ค่าใช้จ่ายผลิตแปรผัน" (Variable Overhead) in
  // DEFAULT_CHART_OF_ACCOUNTS (accounts.routes.ts) and already exists in production tenant
  // data with that name. Using 5106 instead keeps subcontract labor on its own account
  // instead of silently reusing the Variable Overhead account via getOrCreateAccount().
  SUBCON_LABOR:      '5106',  // ค่าจ้างเหมาช่วง (Phase 2)

  // Operating Expenses (examples)
  DEPRECIATION:      '5201',
  // ส่วนของใบแจ้งหนี้ซื้อที่ skip_stock (น้ำมัน/ของใช้สำนักงาน ไม่เข้าคลัง) — เดิมหลุดไปลง 1107
  // เป็นสินทรัพย์ทั้งที่เป็นค่าใช้จ่ายจริง (2026-10) ตรงกับ 5403 ใน DEFAULT_CHART_OF_ACCOUNTS
  OTHER_EXPENSE:     '5403',  // ค่าใช้จ่ายอื่น

  // เดิมเป็น string ดิบตาม call site จนชื่อบัญชีขึ้นกับว่าธุรกรรมไหนเกิดก่อน
  POS_CLEARING:      '1180',  // ลูกหนี้การค้า-POS (พักเงินก่อนนำเข้าบัญชี)
  // บัญชีพักคู่ขนานกับ 1180 — ขายบนแพลตฟอร์มแล้วเงินยังอยู่ในกระเป๋าร้านค้า รอรอบโอน
  // ตั้งรหัสล้อ 1180 ให้จำง่ายว่าทั้งคู่คือ 'ขายแล้วแต่เงินยังไม่ถึงบัญชีบริษัท'
  PLATFORM_CLEARING: '1181',  // ลูกหนี้การค้า-แพลตฟอร์ม (Shopee/Lazada/TikTok)
  // บัญชีพักตัวที่สามในตระกูล 118x — เงินออกจากลิ้นชัก POS ไปซื้อของแล้ว แต่บิลยังไม่ได้ลงระบบซื้อ
  // ศูนย์เมื่อจับคู่ครบกับใบจ่ายเงินผู้ขาย (วิธีจ่าย POS_CASH ใน paySupplier)
  POS_PAYOUT_PENDING: '1182', // เงินจ่ายจาก POS รอจับคู่บิล
  // ของเข้าคลังแล้วแต่ผู้ขายยังไม่ออกใบแจ้งหนี้ — คู่บัญชีของใบรับสินค้า
  // 2103 = เงินกู้ระยะสั้น, 2106 = ประกันสังคม จึงต้องใช้ 2109 ซึ่งเป็นรหัสว่างตัวถัดไป
  GRNI:              '2109',  // ของรับแล้วยังไม่ได้รับใบแจ้งหนี้ (Goods Received Not Invoiced)
  OTHER_REVENUE:     '4203',
  CASH_OVER_SHORT:   '5901',  // เงินขาด/เงินเกินจากการปิดกะ/นำเงินเข้า
  STOCK_ADJUSTMENT:  '5902',  // ค่าใช้จ่ายปรับปรุงสต็อก (แยกจาก 5901)
  // แยกจาก 5902 เพราะ "ของเสีย" กับ "นับผิดรอบก่อน" คนละเรื่องกันในสายตาเจ้าของร้าน
  // ตัวแรกคือของหายไปจริงและกันไม่ได้ทั้งหมด ตัวหลังคือตัวเลขเคยผิดเฉย ๆ ของไม่เคยหาย
  STOCK_WASTE:       '5903',  // ผลขาดทุนของเสีย (ของเสีย/หมดอายุ/แตก/ชำรุด)
  STOCK_SHRINKAGE:   '5904',  // ผลขาดทุนสินค้าสูญหาย (ของหาย หาไม่เจอ)

  // ปิดบัญชีรายเดือน / รูปแบบกิจการ (2026-10-26) — รหัสที่ว่างในทุก tenant ณ วันที่เพิ่ม (ตรวจ dev.db จริงแล้ว)
  PETTY_CASH:        '1113',  // เงินสดย่อย (imprest) — ของเล็กน้อยที่ไม่ผ่านลิ้นชัก POS
  DIRECTOR_LOAN:     '1114',  // เงินให้กู้ยืมแก่กรรมการ/หุ้นส่วน (หจก./บจก.) — ม.65 ทวิ (4) ประเมินดอกเบี้ยได้
  SUSPENSE:          '1190',  // บัญชีพักรอตรวจสอบ — เงินเข้า/ออกที่หาที่มาไม่ได้ ต้องล้างภายในเดือนถัดไป
  OWNER_ADVANCE:     '2110',  // เงินทดรองจ่าย/เงินกู้ยืมจากเจ้าของ-กรรมการ (ร้านค้างเจ้าของ)
  OWNER_DRAWINGS:    '3106',  // ถอนใช้ส่วนตัว (บุคคลธรรมดา) — ม.65 ตรี (3) ห้ามเป็นรายจ่ายของกิจการ
  PRIOR_PERIOD_ADJ:  '3107',  // ปรับปรุงกำไรสะสมงวดก่อน (ข้อผิดพลาดของงวดที่ปิดแล้ว — TFRS for NPAEs)
  INTEREST_INCOME:   '4202',  // รายได้ดอกเบี้ย (มีในผังอยู่แล้ว)
  BANK_CHARGE:       '5309',  // ค่าธรรมเนียมธนาคาร (มีในผังอยู่แล้ว)
} as const

import type { AccountType, NormalBalance } from '../types'

export interface AccountMeta {
  name: string
  type: AccountType
  category: string
  normalBalance: NormalBalance
  taxRelated?: number
}

// Account metadata for getOrCreateAccount calls
export const ACC_META: Record<string, AccountMeta> = {
  [ACC.CASH]:             { name: 'เงินสด', type: 'ASSET', category: 'CASH', normalBalance: 'DEBIT' },
  [ACC.BANK]:             { name: 'เงินฝากธนาคาร', type: 'ASSET', category: 'CASH', normalBalance: 'DEBIT' },
  [ACC.AR]:               { name: 'ลูกหนี้การค้า', type: 'ASSET', category: 'RECEIVABLE', normalBalance: 'DEBIT' },
  [ACC.OTHER_RECEIVABLE]: { name: 'ลูกหนี้อื่น', type: 'ASSET', category: 'RECEIVABLE', normalBalance: 'DEBIT' },
  [ACC.INVENTORY]:        { name: 'สต็อกสินค้า', type: 'ASSET', category: 'INVENTORY', normalBalance: 'DEBIT' },
  [ACC.RAW_MATERIAL]:     { name: 'สต็อกวัตถุดิบ', type: 'ASSET', category: 'INVENTORY', normalBalance: 'DEBIT' },
  [ACC.SUBCON_MATERIAL]:  { name: 'วัตถุดิบที่ผู้รับจ้างช่วง', type: 'ASSET', category: 'INVENTORY', normalBalance: 'DEBIT' },
  [ACC.INPUT_VAT]:        { name: 'ภาษีซื้อ', type: 'ASSET', category: 'TAX', normalBalance: 'DEBIT', taxRelated: 1 },

  [ACC.AP]:               { name: 'เจ้าหนี้การค้า', type: 'LIABILITY', category: 'PAYABLE', normalBalance: 'CREDIT' },
  [ACC.OUTPUT_VAT]:       { name: 'ภาษีขาย', type: 'LIABILITY', category: 'TAX', normalBalance: 'CREDIT', taxRelated: 1 },
  [ACC.WHT_PAYABLE]:      { name: 'ภาษีหัก ณ ที่จ่าย', type: 'LIABILITY', category: 'TAX', normalBalance: 'CREDIT', taxRelated: 1 },

  [ACC.RETAINED_EARNINGS]:{ name: 'กำไรสะสม', type: 'EQUITY', category: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },

  [ACC.REVENUE_PRODUCT]:  { name: 'รายได้ขายสินค้า', type: 'REVENUE', category: 'PRODUCT_SALES', normalBalance: 'CREDIT' },
  [ACC.REVENUE_SERVICE]:  { name: 'รายได้ค่าบริการ', type: 'REVENUE', category: 'SERVICE', normalBalance: 'CREDIT' },
  [ACC.SALES_RETURN]:     { name: 'รับคืนสินค้า', type: 'REVENUE', category: 'SALES_RETURN', normalBalance: 'DEBIT' },

  [ACC.COGS_PRODUCT]:     { name: 'ต้นทุนสินค้าขาย', type: 'EXPENSE', category: 'COGS', normalBalance: 'DEBIT' },
  [ACC.COGS_RAW_MATERIAL]:{ name: 'ต้นทุนวัตถุดิบใช้ไป', type: 'EXPENSE', category: 'COGS', normalBalance: 'DEBIT' },
  [ACC.DIRECT_LABOR]:     { name: 'ค่าแรงทางตรง', type: 'EXPENSE', category: 'COGS', normalBalance: 'DEBIT' },
  [ACC.SUBCON_LABOR]:     { name: 'ค่าจ้างเหมาช่วง', type: 'EXPENSE', category: 'COGS', normalBalance: 'DEBIT' },

  [ACC.ACCRUED]:          { name: 'ค่าใช้จ่ายค้างจ่าย', type: 'LIABILITY', category: 'PAYABLE', normalBalance: 'CREDIT' },
  [ACC.OTHER_PAYABLE]:    { name: 'เจ้าหนี้อื่น', type: 'LIABILITY', category: 'PAYABLE', normalBalance: 'CREDIT' },

  [ACC.POS_CLEARING]:     { name: 'ลูกหนี้การค้า-POS', type: 'ASSET', category: 'RECEIVABLE', normalBalance: 'DEBIT' },
  [ACC.PLATFORM_CLEARING]:{ name: 'ลูกหนี้การค้า-แพลตฟอร์ม', type: 'ASSET', category: 'RECEIVABLE', normalBalance: 'DEBIT' },
  [ACC.POS_PAYOUT_PENDING]:{ name: 'เงินจ่ายจาก POS รอจับคู่บิล', type: 'ASSET', category: 'RECEIVABLE', normalBalance: 'DEBIT' },
  [ACC.GRNI]:             { name: 'ของรับแล้วยังไม่ได้รับใบแจ้งหนี้', type: 'LIABILITY', category: 'PAYABLE', normalBalance: 'CREDIT' },
  [ACC.OTHER_REVENUE]:    { name: 'รายได้อื่น', type: 'REVENUE', category: 'OTHER', normalBalance: 'CREDIT' },
  [ACC.CASH_OVER_SHORT]:  { name: 'เงินขาด/เงินเกิน', type: 'EXPENSE', category: 'OTHER_EXPENSE', normalBalance: 'DEBIT' },
  [ACC.STOCK_ADJUSTMENT]: { name: 'ค่าใช้จ่ายปรับปรุงสต็อก', type: 'EXPENSE', category: 'OTHER_EXPENSE', normalBalance: 'DEBIT' },
  [ACC.STOCK_WASTE]:      { name: 'ผลขาดทุนของเสีย', type: 'EXPENSE', category: 'OTHER_EXPENSE', normalBalance: 'DEBIT' },
  [ACC.STOCK_SHRINKAGE]:  { name: 'ผลขาดทุนสินค้าสูญหาย', type: 'EXPENSE', category: 'OTHER_EXPENSE', normalBalance: 'DEBIT' },
  [ACC.OTHER_EXPENSE]:    { name: 'ค่าใช้จ่ายอื่น', type: 'EXPENSE', category: 'OTHER', normalBalance: 'DEBIT' },

  [ACC.PETTY_CASH]:       { name: 'เงินสดย่อย', type: 'ASSET', category: 'CASH', normalBalance: 'DEBIT' },
  [ACC.DIRECTOR_LOAN]:    { name: 'เงินให้กู้ยืมแก่กรรมการ/หุ้นส่วน', type: 'ASSET', category: 'DIRECTOR_LOAN', normalBalance: 'DEBIT' },
  [ACC.SUSPENSE]:         { name: 'บัญชีพักรอตรวจสอบ', type: 'ASSET', category: 'SUSPENSE', normalBalance: 'DEBIT' },
  [ACC.OWNER_ADVANCE]:    { name: 'เงินทดรองจ่าย/เงินกู้ยืมจากเจ้าของ-กรรมการ', type: 'LIABILITY', category: 'OWNER_ADVANCE', normalBalance: 'CREDIT' },
  [ACC.OWNER_DRAWINGS]:   { name: 'ถอนใช้ส่วนตัว', type: 'EQUITY', category: 'DRAWINGS', normalBalance: 'DEBIT' },
  [ACC.PRIOR_PERIOD_ADJ]: { name: 'ปรับปรุงกำไรสะสมงวดก่อน', type: 'EQUITY', category: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },
  [ACC.INTEREST_INCOME]:  { name: 'รายได้ดอกเบี้ย', type: 'REVENUE', category: 'INTEREST', normalBalance: 'CREDIT' },
  [ACC.BANK_CHARGE]:      { name: 'ค่าธรรมเนียมธนาคาร', type: 'EXPENSE', category: 'BANK_CHARGE', normalBalance: 'DEBIT' },
}

// ============================================================
// Bank-account-aware GL resolver — shared by sales receipts, purchase
// payments, and POS payments. Looks up the GL sub-account linked to a
// specific bank_accounts row (set up in Settings) so a payment made via
// that bank account posts to its own ledger line instead of the generic
// CASH/BANK account. Returns null when no bank account was selected —
// callers fall back to their existing CASH-vs-BANK logic in that case.
// ============================================================
import db from '../db/sqlite'

export function resolveBankAccountGL(tenantId: string, bankAccountId?: string | null): string | null {
  if (!bankAccountId) return null
  const row = db.prepare(
    'SELECT account_id FROM bank_accounts WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).get(bankAccountId, tenantId) as { account_id: string } | undefined
  return row?.account_id ?? null
}

/**
 * บัญชีธนาคารที่ใช้แทน 1102 เมื่อรายการไม่ได้ระบุบัญชีธนาคาร: บัญชีที่ตั้งเป็นค่าเริ่มต้น หรือบัญชีเดียวที่มี
 * ไม่มีบัญชีธนาคาร/มีหลายบัญชีแต่ไม่ได้ตั้งค่าเริ่มต้น = null (ผู้เรียกใช้ 1102 ซึ่งถ้ามีบัญชีย่อยจะโดน trigger ห้ามลงบัญชีหัว)
 * เหตุผล: 1102 มีบัญชีย่อยแล้วต้องไม่ถูกลงตรง (Kids House ลง 1102 หัวไป 4 ครั้ง ยอดแตกสองก้อนเทียบ statement ไม่ได้)
 */
export function defaultBankAccountGL(tenantId: string): string | null {
  const rows = db.prepare(
    'SELECT account_id, is_default FROM bank_accounts WHERE tenant_id = ? AND is_active = 1 ORDER BY is_default DESC, created_at'
  ).all(tenantId) as { account_id: string; is_default: number }[]
  return rows.length > 0 && (rows[0].is_default === 1 || rows.length === 1) ? rows[0].account_id : null
}

export default ACC
