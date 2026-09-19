import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
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


// ============================================================
// ประตูเดียวสำหรับลงสมุดรายวัน
// ------------------------------------------------------------
// เดิมมี INSERT INTO journal_entries กระจาย 23 จุดใน 13 ไฟล์ ต่างคนต่างออกเลข JV
// ต่างคนต่างเช็คดุลเอง (บางจุดไม่เช็คเลย) แก้กติกาบัญชีทีต้องไล่แก้ทุกไฟล์
//
// ที่นี่ทำสามอย่างที่ทุกจุดต้องการเหมือนกัน: แปลงรหัสบัญชีเป็น id, ตรวจว่าเดบิตเท่ากับ
// เครดิตจริง (ไม่ดุลให้ throw — ห้ามปล่อยรายการเสียลงฐานข้อมูล), และออกเลข JV
//
// เรียกอยู่ใน db.transaction ของผู้เรียกได้เลย better-sqlite3 รองรับ transaction ซ้อน
// ============================================================

export interface JournalLineInput {
  /** รหัสบัญชีในผังบัญชี เช่น '1180' — ไม่มีก็สร้างจาก ACC_META ให้ */
  code?: string
  /** ใช้แทน code เมื่อรู้ id อยู่แล้ว (เช่นบัญชีย่อยธนาคาร 1102-NN ที่ผูกไว้ใน Settings) */
  accountId?: string
  description?: string
  debit?: number
  credit?: number
}

export interface PostJournalInput {
  tenantId: string
  /** YYYY-MM-DD */
  date: string
  referenceType: string
  referenceId?: string | null
  description: string
  lines: JournalLineInput[]
  createdBy?: string
  businessUnit?: string
  sourceNumber?: string | null
  soNumber?: string | null
  notes?: string | null
}

export class JournalError extends Error {}

/** ปัดทศนิยม 2 ตำแหน่งก่อนเทียบเสมอ ไม่งั้นเศษ floating point ทำให้ดุลหลุดเอง */
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function postJournal(input: PostJournalInput): string {
  const { tenantId, date, referenceType, referenceId, description, createdBy } = input

  // บรรทัดที่ทั้งเดบิตและเครดิตเป็นศูนย์ = ไม่มีความหมาย ตัดทิ้งก่อนตรวจดุล
  const lines = input.lines
    .map(l => ({ ...l, debit: r2(l.debit || 0), credit: r2(l.credit || 0) }))
    .filter(l => l.debit !== 0 || l.credit !== 0)

  if (lines.length === 0) throw new JournalError('ลงบัญชีไม่ได้: ไม่มีบรรทัดที่มียอด')

  for (const l of lines) {
    if (l.debit !== 0 && l.credit !== 0) {
      throw new JournalError(`ลงบัญชีไม่ได้: บรรทัด ${l.code || l.accountId} มีทั้งเดบิตและเครดิต`)
    }
    if (l.debit < 0 || l.credit < 0) {
      throw new JournalError(`ลงบัญชีไม่ได้: บรรทัด ${l.code || l.accountId} มียอดติดลบ — ให้สลับข้างแทน`)
    }
    if (!l.code && !l.accountId) throw new JournalError('ลงบัญชีไม่ได้: บรรทัดไม่มีบัญชีปลายทาง')
  }

  const totalDebit = r2(lines.reduce((t, l) => t + l.debit, 0))
  const totalCredit = r2(lines.reduce((t, l) => t + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new JournalError(
      `ลงบัญชีไม่ได้: เดบิต ${totalDebit.toFixed(2)} ไม่เท่ากับเครดิต ${totalCredit.toFixed(2)} (${referenceType})`
    )
  }

  const now = new Date().toISOString()
  const entryId = generateId()
  const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(date || now).getFullYear(), 5)
  const actor = createdBy || 'system'

  db.prepare(`
    INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
      source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted,
      posted_at, posted_by, notes, created_by, created_at, updated_at, business_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(entryId, tenantId, entryNumber, (date || now).substring(0, 10), referenceType, referenceId ?? null,
    input.sourceNumber ?? null, input.soNumber ?? null, description, totalDebit, totalCredit,
    now, actor, input.notes ?? null, actor, now, now, input.businessUnit ?? null)

  const insertLine = db.prepare(`
    INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let lineNo = 1
  for (const l of lines) {
    const accountId = l.accountId || getOrCreateAccount(tenantId, l.code!)
    insertLine.run(generateId(), tenantId, entryId, accountId, lineNo++, l.description || description, l.debit, l.credit)
  }

  return entryId
}
