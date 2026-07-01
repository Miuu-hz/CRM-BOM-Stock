import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { ACC_META } from '../config/accountCodes'
import type { Account, AccountType, NormalBalance } from '../types'

/**
 * Get a full account row by chart-of-accounts code.
 */
export function getAccountByCode(
  tenantId: string,
  code: string
): Account | undefined {
  return db
    .prepare('SELECT * FROM accounts WHERE code = ? AND tenant_id = ?')
    .get(code, tenantId) as Account | undefined
}

/**
 * Get only the account id by chart-of-accounts code.
 */
export function getAccountIdByCode(
  tenantId: string,
  code: string
): string | undefined {
  const row = db
    .prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
    .get(code, tenantId) as { id: string } | undefined
  return row?.id
}

/**
 * Get an existing account id or create a system account from ACC_META.
 * ponytail: single helper replaces duplicated inline closures in POS accounting.
 */
export function getOrCreateAccount(
  tenantId: string,
  code: string,
  fallbackName?: string,
  fallbackType?: AccountType,
  fallbackCategory?: string,
  fallbackNormalBalance?: NormalBalance
): string {
  const existingId = getAccountIdByCode(tenantId, code)
  if (existingId) return existingId

  const meta = ACC_META[code]
  const name = fallbackName ?? meta?.name ?? code
  const type: AccountType = fallbackType ?? meta?.type ?? 'EXPENSE'
  const category = fallbackCategory ?? meta?.category ?? 'OTHER'
  const normalBalance: NormalBalance = fallbackNormalBalance ?? meta?.normalBalance ?? 'DEBIT'

  const id = generateId()
  db.prepare(
    `INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
  ).run(id, tenantId, code, name, type, category, normalBalance)

  return id
}
