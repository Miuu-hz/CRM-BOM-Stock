// ============================================================
// Standard Thai Chart of Account Codes
// Shared across all modules to prevent duplicate / mismatched accounts
// Must stay in sync with DEFAULT_CHART_OF_ACCOUNTS in accounts.routes.ts
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

export default ACC
