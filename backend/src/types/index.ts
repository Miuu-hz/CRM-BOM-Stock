export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
export type NormalBalance = 'DEBIT' | 'CREDIT'

export interface Account {
  id: string
  tenant_id: string
  code: string
  name: string
  name_en?: string | null
  type: AccountType
  category: string
  parent_id?: string | null
  parent_code?: string | null
  parent_name?: string | null
  level: number
  is_active: number | boolean
  is_system: number | boolean
  normal_balance: NormalBalance
  description?: string | null
  tax_related: number | boolean
  tax_code?: string | null
  transaction_count?: number
  created_at?: string
  updated_at?: string
}

export interface JournalEntry {
  id: string
  tenant_id: string
  entry_number: string
  date: string
  reference_type?: string | null
  reference_id?: string | null
  description: string
  total_debit: number
  total_credit: number
  is_auto_generated?: number | boolean
  is_posted?: number | boolean
  posted_at?: string | null
  posted_by?: string | null
  notes?: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
  line_count?: number
}

export interface JournalLine {
  id: string
  tenant_id: string
  journal_entry_id: string
  account_id: string
  line_number: number
  description?: string | null
  debit: number
  credit: number
}

export interface JournalLineWithAccount extends JournalLine {
  account_code: string
  account_name: string
  account_type: AccountType
  account_normal_balance: NormalBalance
}

export interface JournalEntryWithLines extends JournalEntry {
  lines: JournalLineWithAccount[]
}

export interface AccountBalance {
  id: string
  tenant_id: string
  account_id: string
  fiscal_year: number
  period: number
  beginning_balance: number
  debit_amount: number
  credit_amount: number
  ending_balance: number
}

export interface POSBill {
  id: string
  bill_number: string
  display_name: string
  customer_name?: string | null
  // ผูกกับลูกค้าจริงเมื่อบิลถูกระบุชื่อ — ใช้ดึงเลขภาษีผู้ซื้อลงใบกำกับภาษี
  customer_id?: string | null
  subtotal: number
  service_charge_amount: number
  tax_rate?: number
  tax_amount: number
  total_amount: number
}

export interface POSPayment {
  payment_method: string
  amount: number
  bank_account_id?: string | null
}

export interface ChartOfAccountRow {
  code: string
  name: string
  type: AccountType
  category: string
  level: number
  parent_code?: string
  normal_balance: NormalBalance
  tax_related?: number
}

export interface AccountBalanceTuple {
  total_debit: number
  total_credit: number
}
