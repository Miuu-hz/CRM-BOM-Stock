import api from './api'

export interface BankAccount {
  id: string
  tenant_id: string
  bank_name: string
  account_name: string
  account_number: string
  qr_code_base64?: string | null
  account_id: string
  gl_code?: string
  gl_name?: string
  is_default: number | boolean
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface BankAccountInput {
  bankName: string
  accountName: string
  accountNumber: string
  qrCodeBase64?: string | null
  isDefault?: boolean
}

const LS_KEY = 'crm_bank_accounts'

export function getCachedBankAccounts(): BankAccount[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

// Used by the shared bill template (utils/printBill.ts) — mirrors
// getCachedCompanySettings()'s sync-read pattern so print call sites don't
// need to await a network call.
export function getCachedDefaultBankAccount(): BankAccount | undefined {
  const list = getCachedBankAccounts()
  return list.find((b) => Number(b.is_default) === 1) || list[0]
}

function cacheBankAccounts(list: BankAccount[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

const bankAccountsService = {
  async list(): Promise<BankAccount[]> {
    const { data } = await api.get('/bank-accounts')
    const rows: BankAccount[] = data.data || []
    cacheBankAccounts(rows)
    return rows
  },

  async create(payload: BankAccountInput): Promise<BankAccount> {
    const { data } = await api.post('/bank-accounts', payload)
    await bankAccountsService.list()
    return data.data
  },

  async update(id: string, payload: Partial<BankAccountInput>): Promise<BankAccount> {
    const { data } = await api.put(`/bank-accounts/${id}`, payload)
    await bankAccountsService.list()
    return data.data
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/bank-accounts/${id}`)
    await bankAccountsService.list()
  },
}

export default bankAccountsService
