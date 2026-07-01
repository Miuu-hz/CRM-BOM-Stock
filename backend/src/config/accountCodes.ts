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
  [ACC.INVENTORY]:        { name: 'สต็อกสินค้า', type: 'ASSET', category: 'INVENTORY', normalBalance: 'DEBIT' },
  [ACC.RAW_MATERIAL]:     { name: 'สต็อกวัตถุดิบ', type: 'ASSET', category: 'INVENTORY', normalBalance: 'DEBIT' },
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
}

export default ACC
