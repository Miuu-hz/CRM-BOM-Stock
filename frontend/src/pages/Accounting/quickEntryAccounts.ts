import type { Account } from '../../services/accounting'

export interface AccountLike {
  id: string
  code?: string
  name?: string
  type?: string
  category?: string
  parentId?: string | null
  parent_id?: string | null
  isActive?: boolean
  is_active?: boolean | number
}

function isAccountActive(a: AccountLike): boolean {
  if (a.isActive === false) return false
  if (a.is_active === false || a.is_active === 0) return false
  return true
}

export function headerAccountIds(accounts: AccountLike[]): Set<string> {
  const ids = new Set<string>()
  for (const a of accounts) {
    const pid = a.parentId ?? a.parent_id
    if (pid) ids.add(pid)
  }
  return ids
}

/**
 * Returns active accounts with category === 'CASH' that are NOT headers
 * (header = some other account has parent_id / parentId === its id), sorted by code.
 */
export function moneyAccountsOf<T extends AccountLike = Account>(accounts: T[]): T[] {
  const headers = headerAccountIds(accounts)
  return accounts
    .filter(a => isAccountActive(a) && a.category === 'CASH' && !headers.has(a.id))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
}

/**
 * Returns active accounts of a specific type (e.g. EXPENSE, REVENUE) that are NOT headers.
 */
export function leafAccountsOfType<T extends AccountLike = Account>(accounts: T[], type: string): T[] {
  const headers = headerAccountIds(accounts)
  return accounts
    .filter(a => isAccountActive(a) && a.type === type && !headers.has(a.id))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
}

/**
 * Returns all active leaf accounts (non-headers), sorted by code.
 */
export function leafAccountsOf<T extends AccountLike = Account>(accounts: T[]): T[] {
  const headers = headerAccountIds(accounts)
  return accounts
    .filter(a => isAccountActive(a) && !headers.has(a.id))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
}
